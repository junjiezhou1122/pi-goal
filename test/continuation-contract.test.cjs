const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const indexSource = readFileSync(join(__dirname, "../.pi/extensions/pi-goal/index.ts"), "utf8");

test("persisting a non-active goal cancels any queued continuation", () => {
	assert.match(
		indexSource,
		/if \(next\?\.status !== "active"\) \{\s*continuationQueued = false;\s*\}/,
	);
});

test("agent_end defers the abort/error pause instead of stopping the goal immediately", () => {
	assert.match(
		indexSource,
		/if \(lastAssistant\?\.stopReason === "aborted" \|\| lastAssistant\?\.stopReason === "error"\) \{[\s\S]*?lastRunFailed = true;\s*return;\s*\}/,
	);
});

test("agent_settled pauses the active goal once Pi will not retry again", () => {
	assert.match(
		indexSource,
		/pi\.on\("agent_settled", \(_event, ctx\) => \{\s*const failed = lastRunFailed;\s*lastRunFailed = false;\s*if \(!failed \|\| !goal \|\| goal\.status !== "active"\) return;\s*persist\(pi, ctx, \{ \.\.\.goal, status: "paused", updatedAt: Date\.now\(\) \}\);\s*\}\);/,
	);
});

test("/goal pause aborts in-flight turn if agent is running", () => {
	assert.match(
		indexSource,
		/if \(status === "paused" && !ctx\.isIdle\(\)\) ctx\.abort\(\);/,
	);
});

