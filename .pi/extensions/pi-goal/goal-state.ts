export type GoalStatus = "active" | "paused" | "budget_limited" | "complete" | "blocked";

// Verification strength for the independent completion verifier.
// Only the user can configure this (via /goal flags); the model cannot.
export type GoalVerifyConfig = {
	maxRounds: number; // max update_goal completion attempts that may run verification; 0 disables
	model: string | null; // model for the verifier process; null = same as the session
	tools: string[] | null; // tool allowlist for the verifier; null = all tools
	cwd: string | null; // working directory for the verifier; null = session cwd
};

export const DEFAULT_VERIFY: GoalVerifyConfig = { maxRounds: 3, model: null, tools: null, cwd: null };

export type GoalState = {
	version: 2;
	id: string;
	objective: string;
	status: GoalStatus;
	tokenBudget: number | null;
	tokensUsed: number;
	timeUsedSeconds: number;
	createdAt: number;
	updatedAt: number;
	verify?: GoalVerifyConfig;
	verifyRounds?: number;
	verifyFindings?: string;
	blockedReason?: string;
};

export type GoalEventKind = "active" | "continuation" | "paused" | "resumed" | "cleared" | "budget_limited" | "complete" | "blocked";

const VERDICTS = ["pass", "fail", "genuine", "premature"] as const;

export type VerifyReport = {
	verdict: (typeof VERDICTS)[number];
	gaps: string[];
};

export function parseTokenBudget(input: string): { objective: string; tokenBudget: number | null; error?: string } {
	const match = input.match(/(?:^|\s)--tokens(?:=|\s+)(\S+\s*[kKmM]?)(?:\s|$)/);
	if (!match) return { objective: input.trim(), tokenBudget: null };

	const raw = match[1].replace(/\s+/g, "");
	const suffix = raw.slice(-1).toLowerCase();
	const numeric = suffix === "k" || suffix === "m" ? raw.slice(0, -1) : raw;
	const value = Number(numeric);
	if (!Number.isFinite(value) || value <= 0) {
		return { objective: input.trim(), tokenBudget: null, error: "Token budget must be positive." };
	}
	const multiplier = suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1;
	const tokenBudget = Math.round(value * multiplier);
	const objective = (input.slice(0, match.index) + " " + input.slice((match.index ?? 0) + match[0].length)).trim();
	return { objective, tokenBudget };
}

export function normalizeTokenBudget(value: unknown): { tokenBudget: number | null; error?: string } {
	if (value == null) return { tokenBudget: null };
	const tokenBudget = Math.round(Number(value));
	if (!Number.isFinite(tokenBudget) || tokenBudget <= 0) {
		return { tokenBudget: null, error: "tokenBudget must be a positive number when provided." };
	}
	return { tokenBudget };
}

function stripFlagValue(input: string, flag: string): { value: string; rest: string } | null {
	const match = input.match(new RegExp(`(?:^|\\s)--${flag}(?:=|\\s+)(\\S+)(?:\\s|$)`));
	if (!match) return null;
	const rest = (input.slice(0, match.index) + " " + input.slice(match.index + match[0].length)).replace(/\s+/g, " ").trim();
	return { value: match[1], rest };
}

export type ParseGoalArgsResult = {
	objective: string;
	tokenBudget: number | null;
	verify: GoalVerifyConfig | null;
	error?: string;
};

// Parse /goal arguments: --tokens (via parseTokenBudget) plus verification flags.
// Verification flags are intentionally absent from the create_goal tool schema so
// the model can never weaken its own completion gate.
export function parseGoalArgs(input: string): ParseGoalArgsResult {
	const base = parseTokenBudget(input);
	if (base.error) {
		return { objective: base.objective, tokenBudget: null, verify: null, error: base.error };
	}
	let rest = base.objective;
	const verify: GoalVerifyConfig = { ...DEFAULT_VERIFY };

	const rounds = stripFlagValue(rest, "verify");
	if (rounds) {
		rest = rounds.rest;
		const n = Number(rounds.value);
		if (!Number.isInteger(n) || n < 0) {
			return { objective: input.trim(), tokenBudget: null, verify: null, error: "--verify must be a non-negative integer (0 disables verification)." };
		}
		verify.maxRounds = n;
	}
	const model = stripFlagValue(rest, "verify-model");
	if (model) {
		rest = model.rest;
		verify.model = model.value;
	}
	const tools = stripFlagValue(rest, "verify-tools");
	if (tools) {
		rest = tools.rest;
		const list = tools.value.split(",").map((tool) => tool.trim()).filter(Boolean);
		if (list.length === 0) {
			return { objective: input.trim(), tokenBudget: null, verify: null, error: "--verify-tools must list at least one tool." };
		}
		verify.tools = list;
	}
	const cwd = stripFlagValue(rest, "verify-cwd");
	if (cwd) {
		rest = cwd.rest;
		verify.cwd = cwd.value;
	}

	return { objective: rest, tokenBudget: base.tokenBudget, verify };
}

function tryParseVerdict(candidate: string, verdicts: readonly string[]): VerifyReport | null {
	let raw: any;
	try {
		raw = JSON.parse(candidate);
	} catch {
		return null;
	}
	if (typeof raw?.verdict !== "string" || !verdicts.includes(raw.verdict)) return null;
	const gaps = Array.isArray(raw.gaps)
		? raw.gaps
			.filter((gap: unknown) => gap != null)
			.map((gap: unknown) => (typeof gap === "string" ? gap.trim() : typeof gap === "object" && gap !== null ? String((gap as any).message ?? JSON.stringify(gap)) : String(gap)))
			.filter(Boolean)
		: raw.verdict === "fail"
			? ["Verifier reported fail without gap details."]
			: [];
	return { verdict: raw.verdict, gaps };
}

// Parse the verifier's final message into a VerifyReport. Fail-closed: any
// missing, malformed, or non-conforming output becomes a fail with a gap.
// `verdicts` narrows the accepted verdict vocabulary (e.g. genuine/premature
// for blocked-claim audits).
export function parseVerdict(text: string, verdicts: readonly string[] = VERDICTS): VerifyReport {
	const trimmed = (text ?? "").trim();
	if (!trimmed) return { verdict: "fail", gaps: ["Verifier returned no output."] };
	const fences = [...trimmed.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)];
	for (let i = fences.length - 1; i >= 0; i--) {
		const report = tryParseVerdict(fences[i][1].trim(), verdicts);
		if (report) return report;
	}
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start !== -1 && end > start) {
		const report = tryParseVerdict(trimmed.slice(start, end + 1), verdicts);
		if (report) return report;
	}
	return { verdict: "fail", gaps: [`Verifier output unparseable: ${truncateObjective(trimmed, 200)}`] };
}

export function formatTokens(value: number): string {
	if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
	if (value >= 1_000) return `${Math.round(value / 100) / 10}K`;
	return String(value);
}

export function formatElapsed(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remMinutes = minutes % 60;
	return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

export function statusLine(state: GoalState | null): string | undefined {
	if (!state) return undefined;
	const budget = state.tokenBudget ? ` (${formatTokens(state.tokensUsed)} / ${formatTokens(state.tokenBudget)})` : ` (${formatElapsed(state.timeUsedSeconds)})`;
	if (state.status === "active") return `Pursuing goal${budget}`;
	if (state.status === "paused") return "Goal paused (/goal resume)";
	if (state.status === "blocked") return "Goal blocked (/goal clear or /goal resume)";
	if (state.status === "budget_limited") return state.tokenBudget ? `Goal unmet${budget}` : "Goal abandoned";
	return `Goal achieved${budget}`;
}

export function goalUsage(state: GoalState): string {
	if (state.tokenBudget != null) return `${formatTokens(state.tokensUsed)} / ${formatTokens(state.tokenBudget)} tokens`;
	return formatElapsed(state.timeUsedSeconds);
}

export function truncateObjective(objective: string, max = 96): string {
	const singleLine = objective.replace(/\s+/g, " ").trim();
	return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine;
}

export function goalEventStatus(kind: GoalEventKind): string {
	const labels: Record<GoalEventKind, string> = {
		active: "active",
		continuation: "continuing",
		paused: "paused",
		resumed: "resumed",
		cleared: "cleared",
		budget_limited: "budget reached",
		complete: "achieved",
		blocked: "blocked",
	};
	return labels[kind];
}

export function createGoalState(objective: string, tokenBudget: number | null, now = Date.now(), random = Math.random(), verify?: GoalVerifyConfig): GoalState {
	const state: GoalState = {
		version: 2,
		id: `${now}-${random.toString(16).slice(2)}`,
		objective,
		status: "active",
		tokenBudget,
		tokensUsed: 0,
		timeUsedSeconds: 0,
		createdAt: now,
		updatedAt: now,
	};
	if (verify) state.verify = verify;
	return state;
}

export function accountGoalTurn(state: GoalState, tokenDelta: number, elapsedSeconds: number, now = Date.now()): GoalState {
	let next: GoalState = {
		...state,
		tokensUsed: state.tokensUsed + Math.max(0, tokenDelta),
		timeUsedSeconds: state.timeUsedSeconds + Math.max(0, elapsedSeconds),
		updatedAt: now,
	};
	if (next.status === "active" && next.tokenBudget != null && next.tokensUsed >= next.tokenBudget) {
		next = { ...next, status: "budget_limited" };
	}
	return next;
}
