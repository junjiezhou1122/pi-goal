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

test("agent_end pauses goal and stops continuation when run is aborted or errored", () => {
	assert.match(
		indexSource,
		/if \(lastAssistant\?\.stopReason === "aborted" \|\| lastAssistant\?\.stopReason === "error"\) \{\s*persist\(pi, ctx, \{ \.\.\.goal, status: "paused", updatedAt: Date\.now\(\) \}\);\s*return;\s*\}/,
	);
});

test("/goal pause aborts in-flight turn if agent is running", () => {
	assert.match(
		indexSource,
		/if \(status === "paused" && !ctx\.isIdle\(\)\) ctx\.abort\(\);/,
	);
});

