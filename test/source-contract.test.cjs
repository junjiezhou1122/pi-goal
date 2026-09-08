const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const indexSource = readFileSync(join(__dirname, "../.pi/extensions/pi-goal/index.ts"), "utf8");
const goalStateSource = readFileSync(join(__dirname, "../.pi/extensions/pi-goal/goal-state.ts"), "utf8");
const readme = readFileSync(join(__dirname, "../README.md"), "utf8");

test("create_goal tool carries strong goal-writing contract", () => {
	assert.match(indexSource, /A goal must be a durable, evidence-checkable work contract/);
	for (const phrase of [
		"outcome, verification surface, constraints, boundaries, iteration policy, and blocked stop condition",
		"Do not infer goals from ordinary coding tasks or one-off prompts",
		"Use this objective shape when possible",
		"verified by <specific evidence>, while preserving <constraints>",
		"Prefer a self-contained objective that survives continuation turns and context compaction",
		"ask a clarifying question if missing success criteria or boundaries materially affect the contract",
	]) {
		assert.match(indexSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
});

test("create_goal uses upsert semantics for explicitly requested goals", () => {
	assert.match(indexSource, /sets or replaces the current thread goal/);
	assert.match(indexSource, /When called, create_goal replaces any existing goal with the new objective/);
	assert.doesNotMatch(indexSource, /replaceExisting/);
	assert.doesNotMatch(indexSource, /This thread already has a goal/);
});

test("update_goal schema and guidance forbid lifecycle side effects", () => {
	assert.match(indexSource, /name: "update_goal"/);
	assert.match(indexSource, /Do not use update_goal to pause, resume, abandon, or budget-limit a goal/);
});

test("update_goal runs independent verification before completing", () => {
	assert.match(indexSource, /runVerifier\(/);
	assert.match(indexSource, /--no-extensions/);
	assert.match(indexSource, /Completion REJECTED by an independent verifier/);
	assert.match(indexSource, /paused for user review/);
});

test("blocked claims are audited and share the verification budget", () => {
	assert.match(indexSource, /enum: \["complete", "blocked"\]/);
	assert.match(indexSource, /status=blocked requires a reason/);
	assert.match(indexSource, /blockedVerifierPrompt\(/);
	assert.match(indexSource, /\["genuine", "premature"\]/);
	assert.match(indexSource, /Blocked claim REJECTED by an independent verifier/);
	assert.match(indexSource, /status: "blocked", verifyRounds: round/);
	assert.match(goalStateSource, /Treat uncertainty as premature|blocked: "blocked"/);
	assert.match(indexSource, /status \"blocked\" instead of repeating blocked reports|blocked claims are independently audited/s);
});

test("verification flags are user-only and absent from create_goal", () => {
	assert.match(goalStateSource, /--verify must be a non-negative integer/);
	assert.match(goalStateSource, /Verification flags are intentionally absent from the create_goal tool schema/);
	const createGoalBlock = indexSource.slice(indexSource.indexOf('name: "create_goal"'), indexSource.indexOf('name: "get_goal"'));
	assert.doesNotMatch(createGoalBlock, /verifyRounds|verify-model|verify-tools|verify-cwd|GoalVerifyConfig/);
});

test("continuation prompt re-injects verifier findings", () => {
	assert.match(indexSource, /Previous independent verification REJECTED a completion attempt/);
	assert.match(indexSource, /state\.verifyFindings/);
});

test("README documents the model-set goal and completion accounting contracts", () => {
	assert.match(readme, /`create_goal` tool: model can set or replace the current goal only when explicitly requested/);
	assert.match(readme, /The final turn is still accounted even when the model completes the goal mid-turn/);
});
