# pi-goal

![pi-goal](docs/assets/pi-goal-poster.png)

Persistent autonomous goals for [pi](https://github.com/badlogic/pi-mono).

`pi-goal` adds a `/goal` command and goal tools so Pi can keep working toward a long-running, thread-scoped objective until the goal is complete, blocked, paused, cleared, or token-budget-limited — and **no completion or blocked claim counts unless an independent verifier process confirms it against fresh evidence**.

## Install

```bash
pi install npm:@junjiezhou1122/pi-goal
```

Or from git:

```bash
pi install git:github.com/junjiezhou1122/pi-goal
```

> Independent fork of `Michaelliv/pi-goal` (MIT), extended with an audited completion/blocked gate. Upstream stays at `Michaelliv/pi-goal`.

## Usage

```text
/goal improve benchmark coverage until the suite has strong evidence
/goal --tokens 50k finish the migration and verify tests
/goal --verify 3 --verify-tools read,bash,grep audit the migration
/goal --verify 0 finish the docs rewrite
/goal
/goal status
/goal pause
/goal resume
/goal clear
/goal statusbar off
```

When a goal is active, the extension shows compact visible lifecycle markers like `Goal active` and `Goal continuing`; expand them with `ctrl+o` to inspect the objective and usage. The full continuation instructions ride along as the content of that custom message, so the model always has the objective and audit guidance in the transcript while the renderer keeps the visible UI compact.

The same Pi agent keeps running normal turns in the same session context until it calls `update_goal({ status: "complete" })`, the user pauses/clears it, or the token budget is reached. Reloading Pi pauses an active goal instead of silently resuming it; use `/goal resume` to continue.

## What it adds

- `pi-goal-writer` skill: draft and review strong `/goal` objectives with evidence-based success criteria
- `/goal [--tokens 50k] [--verify 3] <objective>`: set or replace a goal (verify flags below)
- `/goal` or `/goal status`: show the current goal
- `/goal pause`: stop autonomous continuation without deleting the goal
- `/goal resume`: reactivate a paused goal
- `/goal clear`: remove the goal
- `/goal statusbar on|off`: show or hide the footer status line
- `create_goal` tool: model can set or replace the current goal only when explicitly requested
- `get_goal` tool: read current goal state
- `update_goal` tool: model requests completion or reports blocked; both requests are audited by an independent verifier in an isolated process before they take effect
- `get_goal` and `update_goal` are only exposed to the model while a goal is `active`; paused, cleared, complete, and budget-limited goals hide them so unrelated sessions are not tempted to call them
- footer status: `Pursuing goal`, `Goal paused`, `Goal blocked`, `Goal achieved`, or `Goal unmet`

## Flow

```text
/goal <objective>
  -> persist goal in the current Pi session
  -> show compact Goal marker and footer status
  -> deliver continuation instructions as the marker's message content
  -> trigger an agent turn
  -> account time/tokens on turn_end
  -> queue another continuation on agent_end while active
  -> model calls update_goal({ status: "complete" | "blocked" })
       -> extension spawns an isolated verifier process
            pass / genuine   -> request lands (complete / blocked)
            fail / premature -> goal stays active, findings returned as tool
                                output and re-injected by every continuation
  -> stop when the verifier grants a claim, user pauses/clears,
     verification rounds are exhausted (goal paused for user review),
     or the token budget is hit
```

## Completion behavior

The model is instructed to audit completion against real evidence before calling `update_goal`. Calling `update_goal` is a completion request, not a declaration: the extension spawns an isolated `pi` process (`--mode json -p --no-session --no-extensions`) that re-derives the requirements from the objective and audits the workspace with fresh evidence. Only a `pass` verdict marks the goal complete.

On rejection, the goal stays active, the unmet gaps are returned to the model as tool output, and subsequent continuation prompts re-inject them until the next verification. After the configured verification rounds are exhausted, the goal is paused and the user decides (resume grants fresh attempts; `--verify 0` disables verification entirely). Verification flags are parsed from `/goal` arguments only; the `create_goal` tool schema deliberately does not accept them, so the model can never weaken its own completion gate. The final turn is still accounted even when the model completes the goal mid-turn.

The model can also declare a goal blocked with `update_goal({ status: "blocked", reason })` when it has verified that no useful work remains (missing credentials, user-only decisions, or a proven impossibility). Blocked claims get the same independent audit: `genuine` blocks the goal and notifies the user, while `premature` returns the concrete remaining work the auditor found. Both claim types share the same verification limit, and the continuation prompt tells the model the blocked escape hatch exists so impossible goals stop instead of looping. Uncertainty resolves to premature.

Verification flags:

- `--verify <N>`: max verification attempts (default 3; `0` disables the verifier)
- `--verify-model <provider/id>`: model for the verifier (default: same as the session)
- `--verify-tools <a,b,c>`: tool allowlist for the verifier (default: all tools)
- `--verify-cwd <path>`: working directory for the verifier (default: session cwd)

## State

Goal state is stored as Pi custom session entries with `customType: "pi-goal"` (schema `version: 2`). It follows the active session branch, survives reloads, and does not require an external database. v1 entries from older sessions load as-is; verification fields (`verify`, `verifyRounds`, `verifyFindings`, `blockedReason`) default sensibly when absent.

## Credits

Forked from [Michaelliv/pi-goal](https://github.com/Michaelliv/pi-goal); the independent verifier, blocked verdict, and auto-release pipeline are this fork's additions.

## License

MIT

## Links

- npm: [@junjiezhou1122/pi-goal](https://www.npmjs.com/package/@junjiezhou1122/pi-goal)
- Issues: https://github.com/junjiezhou1122/pi-goal/issues
