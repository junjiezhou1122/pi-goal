const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createJiti } = require("jiti");

const jiti = createJiti(__filename);
const {
	accountGoalTurn,
	createGoalState,
	DEFAULT_VERIFY,
	formatElapsed,
	formatTokens,
	goalEventStatus,
	goalUsage,
	normalizeTokenBudget,
	parseGoalArgs,
	parseTokenBudget,
	parseVerdict,
	statusLine,
	truncateObjective,
} = jiti("../.pi/extensions/pi-goal/goal-state.ts");

test("parseTokenBudget returns trimmed objective with no budget", () => {
	assert.deepEqual(parseTokenBudget("  finish the migration  "), {
		objective: "finish the migration",
		tokenBudget: null,
	});
});

test("parseTokenBudget accepts equals, spaces, decimals, k, and m", () => {
	assert.deepEqual(parseTokenBudget("--tokens=50k finish migration"), {
		objective: "finish migration",
		tokenBudget: 50_000,
	});
	assert.deepEqual(parseTokenBudget("finish --tokens 1.5m migration"), {
		objective: "finish migration",
		tokenBudget: 1_500_000,
	});
	assert.deepEqual(parseTokenBudget("finish --tokens 250 migration"), {
		objective: "finish migration",
		tokenBudget: 250,
	});
});

test("parseTokenBudget preserves objective and reports invalid budget", () => {
	assert.deepEqual(parseTokenBudget("ship --tokens 0 now"), {
		objective: "ship --tokens 0 now",
		tokenBudget: null,
		error: "Token budget must be positive.",
	});
});

test("parseTokenBudget reports invalid explicit token flag values", () => {
	assert.deepEqual(parseTokenBudget("ship --tokens soon"), {
		objective: "ship --tokens soon",
		tokenBudget: null,
		error: "Token budget must be positive.",
	});
	assert.deepEqual(parseTokenBudget("ship --tokens -5 now"), {
		objective: "ship --tokens -5 now",
		tokenBudget: null,
		error: "Token budget must be positive.",
	});
});

test("normalizeTokenBudget accepts absent and positive numeric values", () => {
	assert.deepEqual(normalizeTokenBudget(undefined), { tokenBudget: null });
	assert.deepEqual(normalizeTokenBudget(null), { tokenBudget: null });
	assert.deepEqual(normalizeTokenBudget("1500.4"), { tokenBudget: 1500 });
	assert.deepEqual(normalizeTokenBudget(1500.6), { tokenBudget: 1501 });
});

test("normalizeTokenBudget rejects non-positive and non-numeric values", () => {
	assert.deepEqual(normalizeTokenBudget(0), {
		tokenBudget: null,
		error: "tokenBudget must be a positive number when provided.",
	});
	assert.deepEqual(normalizeTokenBudget("nope"), {
		tokenBudget: null,
		error: "tokenBudget must be a positive number when provided.",
	});
});

test("formatTokens uses compact K and M suffixes", () => {
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(1_000), "1K");
	assert.equal(formatTokens(12_340), "12.3K");
	assert.equal(formatTokens(1_250_000), "1.3M");
});

test("formatElapsed keeps seconds, minutes, and hours readable", () => {
	assert.equal(formatElapsed(59), "59s");
	assert.equal(formatElapsed(60), "1m");
	assert.equal(formatElapsed(3_599), "59m");
	assert.equal(formatElapsed(3_600), "1h");
	assert.equal(formatElapsed(5_460), "1h 31m");
});

test("statusLine covers all lifecycle states", () => {
	assert.equal(statusLine(null), undefined);
	assert.equal(statusLine({ status: "active", tokenBudget: 1000, tokensUsed: 500, timeUsedSeconds: 10 }), "Pursuing goal (500 / 1K)");
	assert.equal(statusLine({ status: "paused", tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 10 }), "Goal paused (/goal resume)");
	assert.equal(statusLine({ status: "budget_limited", tokenBudget: 1000, tokensUsed: 1000, timeUsedSeconds: 10 }), "Goal unmet (1K / 1K)");
	assert.equal(statusLine({ status: "budget_limited", tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 10 }), "Goal abandoned");
	assert.equal(statusLine({ status: "complete", tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 61 }), "Goal achieved (1m)");
});

test("goalUsage prefers token budget usage when budgeted", () => {
	assert.equal(goalUsage({ tokenBudget: 1000, tokensUsed: 250, timeUsedSeconds: 99 }), "250 / 1K tokens");
	assert.equal(goalUsage({ tokenBudget: null, tokensUsed: 250, timeUsedSeconds: 99 }), "1m");
});

test("truncateObjective collapses whitespace and truncates at max", () => {
	assert.equal(truncateObjective("  one\n two\tthree  "), "one two three");
	assert.equal(truncateObjective("abcdef", 4), "abc…");
});

test("goalEventStatus maps event kinds to display labels", () => {
	assert.equal(goalEventStatus("active"), "active");
	assert.equal(goalEventStatus("continuation"), "continuing");
	assert.equal(goalEventStatus("budget_limited"), "budget reached");
	assert.equal(goalEventStatus("complete"), "achieved");
});

test("createGoalState creates a deterministic active goal when time and random are supplied", () => {
	assert.deepEqual(createGoalState("ship it", 123, 42, 0.5), {
		version: 2,
		id: "42-8",
		objective: "ship it",
		status: "active",
		tokenBudget: 123,
		tokensUsed: 0,
		timeUsedSeconds: 0,
		createdAt: 42,
		updatedAt: 42,
	});
});

test("createGoalState attaches verify config when supplied", () => {
	const verify = { maxRounds: 0, model: "x/y", tools: ["read", "bash"], cwd: "/tmp" };
	const goal = createGoalState("ship it", null, 42, 0.5, verify);
	assert.equal(goal.version, 2);
	assert.deepEqual(goal.verify, verify);
	assert.deepEqual(DEFAULT_VERIFY, { maxRounds: 3, model: null, tools: null, cwd: null });
});

test("accountGoalTurn adds usage and marks active budgeted goals budget-limited", () => {
	const goal = createGoalState("ship it", 100, 42, 0.5);
	assert.deepEqual(accountGoalTurn(goal, 70, 5, 50), {
		...goal,
		tokensUsed: 70,
		timeUsedSeconds: 5,
		updatedAt: 50,
		status: "active",
	});
	assert.equal(accountGoalTurn(goal, 100, 5, 50).status, "budget_limited");
});

test("accountGoalTurn preserves complete status while charging final turn usage", () => {
	const completed = { ...createGoalState("ship it", 100, 42, 0.5), status: "complete" };
	assert.deepEqual(accountGoalTurn(completed, 25, 7, 55), {
		...completed,
		tokensUsed: 25,
		timeUsedSeconds: 7,
		updatedAt: 55,
		status: "complete",
	});
});

test("accountGoalTurn clamps negative usage deltas", () => {
	const goal = createGoalState("ship it", null, 42, 0.5);
	assert.deepEqual(accountGoalTurn(goal, -25, -7, 55), {
		...goal,
		tokensUsed: 0,
		timeUsedSeconds: 0,
		updatedAt: 55,
	});
});

test("parseGoalArgs defaults to verification with 3 rounds", () => {
	assert.deepEqual(parseGoalArgs("ship the thing"), {
		objective: "ship the thing",
		tokenBudget: null,
		verify: { maxRounds: 3, model: null, tools: null, cwd: null },
	});
});

test("parseGoalArgs accepts all verify flags alongside tokens", () => {
	assert.deepEqual(parseGoalArgs("--tokens 50k --verify 1 --verify-model openai/gpt-4o --verify-tools read,bash --verify-cwd /tmp/repo ship it"), {
		objective: "ship it",
		tokenBudget: 50_000,
		verify: { maxRounds: 1, model: "openai/gpt-4o", tools: ["read", "bash"], cwd: "/tmp/repo" },
	});
});

test("parseGoalArgs supports equals form and inline flags", () => {
	assert.deepEqual(parseGoalArgs("--verify=0 finish migration fast"), {
		objective: "finish migration fast",
		tokenBudget: null,
		verify: { maxRounds: 0, model: null, tools: null, cwd: null },
	});
	assert.deepEqual(parseGoalArgs("finish --verify 2 --tokens=10k it"), {
		objective: "finish it",
		tokenBudget: 10_000,
		verify: { maxRounds: 2, model: null, tools: null, cwd: null },
	});
});

test("parseGoalArgs reports invalid verify rounds and preserves the input", () => {
	assert.deepEqual(parseGoalArgs("ship --verify soon"), {
		objective: "ship --verify soon",
		tokenBudget: null,
		verify: null,
		error: "--verify must be a non-negative integer (0 disables verification).",
	});
	assert.deepEqual(parseGoalArgs("ship --verify -1"), {
		objective: "ship --verify -1",
		tokenBudget: null,
		verify: null,
		error: "--verify must be a non-negative integer (0 disables verification).",
	});
});

test("parseGoalArgs reports empty verify-tools", () => {
	assert.deepEqual(parseGoalArgs("ship --verify-tools ,"), {
		objective: "ship --verify-tools ,",
		tokenBudget: null,
		verify: null,
		error: "--verify-tools must list at least one tool.",
	});
});

test("parseGoalArgs forwards token budget errors", () => {
	assert.deepEqual(parseGoalArgs("ship --tokens 0"), {
		objective: "ship --tokens 0",
		tokenBudget: null,
		verify: null,
		error: "Token budget must be positive.",
	});
});

test("parseVerdict accepts bare, fenced, and embedded JSON", () => {
	assert.deepEqual(parseVerdict('{"verdict":"pass","gaps":[]}'), { verdict: "pass", gaps: [] });
	assert.deepEqual(parseVerdict('```json\n{"verdict":"pass","gaps":[]}\n```'), { verdict: "pass", gaps: [] });
	assert.deepEqual(
		parseVerdict('Audit complete.\n{"verdict":"fail","gaps":["test X still fails"]}\nEnd of report.'),
		{ verdict: "fail", gaps: ["test X still fails"] },
	);
});

test("parseVerdict fails closed on malformed or hostile output", () => {
	assert.equal(parseVerdict("").verdict, "fail");
	assert.equal(parseVerdict("   \n  ").verdict, "fail");
	assert.equal(parseVerdict("no json here at all").verdict, "fail");
	assert.equal(parseVerdict('{"verdict":"unqualified","gaps":[]}').verdict, "fail");
	assert.equal(parseVerdict('{"verdict":"pass"}').verdict, "pass");
	const unparseable = parseVerdict('{"verdict": "fail", broken');
	assert.equal(unparseable.verdict, "fail");
	assert.match(unparseable.gaps[0], /unparseable/);
});

test("parseVerdict normalizes gaps and synthesizes them for bare fails", () => {
	assert.deepEqual(parseVerdict('{"verdict":"fail","gaps":[" a ", 42, {"message":"b"}, null, ""]}').gaps, ["a", "42", "b"]);
	assert.deepEqual(parseVerdict('{"verdict":"fail"}').gaps, ["Verifier reported fail without gap details."]);
	assert.deepEqual(parseVerdict('{"verdict":"pass","gaps":null}').gaps, []);
});

test("parseVerdict accepts extended verdict vocabularies", () => {
	assert.deepEqual(parseVerdict('{"verdict":"genuine","gaps":[]}', ["genuine", "premature"]), { verdict: "genuine", gaps: [] });
	assert.deepEqual(parseVerdict('{"verdict":"premature","gaps":["write the report"]}', ["genuine", "premature"]), { verdict: "premature", gaps: ["write the report"] });
	assert.equal(parseVerdict('{"verdict":"genuine"}', ["pass", "fail"]).verdict, "fail");
	assert.equal(parseVerdict('{"verdict":"pass"}', ["genuine", "premature"]).verdict, "fail");
	assert.equal(parseVerdict('{"verdict":"fail","gaps":["x"]}', ["genuine", "premature"]).verdict, "fail");
});

test("statusLine covers blocked goals", () => {
	assert.equal(statusLine({ status: "blocked", tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 5 }), "Goal blocked (/goal clear or /goal resume)");
});

test("goalEventStatus maps blocked to a display label", () => {
	assert.equal(goalEventStatus("blocked"), "blocked");
});
