# Validation Gate Extension Spec

> Filename requested as `agent_stop_extension_spec.md`, but the actual feature described here is **not** a stop command. It is an **automatic post-turn validation gate** for pi that prevents false "done" states.

## Goal

Build a **project-local pi extension** that automatically runs the required validation/smoke suite after any mutating coding turn, feeds failures back to the agent, and only lets work be considered complete when the suite passes.

This extension exists because static validation alone is insufficient. We already had a real regression where:
- TypeScript passed
- tests passed
- some smokes passed
- but the web app was broken at runtime in the browser

The extension must make that class of mistake much harder.

---

## Core Product Requirement

After an agent turn completes:
- if the turn **did not mutate project state**, do nothing
- if the turn **did mutate project state**, automatically run the canonical validation gate
- if the gate fails, automatically feed the failure back to the agent in the same session
- let the agent fix issues and retry
- only stop involving the human when:
  - the gate passes, or
  - the loop hits an explicit retry/block limit

The human should ideally only need to step in when the repo is genuinely blocked.

---

## Scope

Implement as a **project-local pi extension** under:
- `.pi/extensions/validation-gate.ts`

Do **not** build this as a manual slash command first.
Do **not** optimize for optional/manual use first.
Do **not** make this a vague framework.

Build the canonical repo-specific version first.

---

## Required Behavior

### 1. Detect mutating turns

The extension must distinguish between:
- read-only turns
- mutating turns

For V1, treat a turn as mutating if it used any of:
- `edit`
- `write`
- `bash` that likely mutates repo state

Heuristic is acceptable for mutating `bash` in V1, but it should be explicit and conservative.

Examples of mutating bash patterns:
- `npm install`
- `rm`, `mv`, `cp`, `mkdir`
- `git checkout`, `git apply`
- `touch`
- codegen/build scripts that write files

Examples of non-mutating bash patterns:
- `rg`
- `find`
- `ls`
- `git status`
- `npm test`
- `npm run typecheck`

If uncertain, prefer treating the turn as mutating.

### 2. Run validation automatically after mutating turns

When a mutating turn ends, run this canonical validation suite in order:

1. `npm run typecheck`
2. `npm test`
3. `npm run smoke:web`
4. `npm run smoke:observability`
5. `npm run smoke:tracker-local`
6. `npm run smoke:session-control`

V1 should use this exact suite. Do **not** add affected-files optimization yet.

### 3. Structured handling for expected skips

Some smokes are environment-sensitive.

In particular:
- `npm run smoke:session-control` may be blocked by external Pi auth/org restrictions

This must be treated canonically:
- if the smoke returns structured JSON indicating an expected skip, count it as **pass-with-skip**, not failure
- if it crashes, exits non-zero unexpectedly, or produces unrecognized failure output, count it as failure

### 4. Feed failures back to the agent automatically

If any validation command fails:
- collect the failing command
- collect exit code
- collect concise stdout/stderr excerpt
- store full logs to artifacts
- inject a structured message into the pi session
- automatically send a follow-up user message telling the agent to fix the failures before claiming completion

The injected follow-up must be explicit, e.g.:
- validation failed
- do not claim completion
- fix the listed failures and let validation rerun

### 5. Bounded retry loop

The extension must prevent infinite self-repair loops.

V1 requirement:
- max auto-fix retries per user prompt/session branch: **3**

Behavior:
- if validation fails and retry count < max: feed back to agent automatically
- if retry count reaches max: stop auto-looping and notify user clearly

### 6. Success path

If the full validation gate passes:
- emit a visible validation-passed message
- include command results summary
- include any expected skip summary
- reset retry state

### 7. Prevent recursive confusion

The extension must not trigger endlessly on its own follow-up turns.

Required safeguards:
- persistent session state for whether validation is in progress
- persistent retry count
- mark extension-generated fixup prompts distinctly
- avoid treating the validation commands themselves as mutation-causing work
- do not trigger nested validation runs while validation is already executing

---

## Non-Goals for V1

Do **not** implement these yet:
- affected-files-based test selection
- per-surface smart validation routing
- custom TUI widgets
- manual commands as primary interface
- multi-repo abstraction
- background daemon architecture
- GitHub/PR integration

Keep V1 boring, deterministic, and robust.

---

## Extension Design Requirements

### Events / hooks

Use pi extension lifecycle hooks that fit this flow, likely including:
- tool call tracking
- agent turn/session end hook suitable for post-turn validation

The implementation must be grounded in actual pi extension APIs from the docs and examples.

### Command execution

Run validation via pi-supported execution primitives, not ad hoc shelling where avoidable.

### State management

Persist enough state so behavior survives session continuity and does not get confused by branch/follow-up turns.

Store state in a way consistent with pi extension patterns.

Minimum state:
- current validation status
- whether current turn mutated files
- retry count
- last validated turn marker
- whether the next follow-up message was extension-generated

### Artifact logging

Store full validation logs under a deterministic artifact directory, e.g.:
- `.piphony/validation/<timestamp>/typecheck.log`
- `.piphony/validation/<timestamp>/test.log`
- `.piphony/validation/<timestamp>/smoke-web.log`
- etc.

Also write a machine-readable summary file, e.g.:
- `.piphony/validation/<timestamp>/summary.json`

### User/agent feedback format

Keep context payload compact.

Do **not** paste huge logs into the conversation.

Instead include:
- short summary
- failing commands
- top excerpt for each failure
- artifact path(s)

---

## Acceptance Criteria

The implementation is only done when all of the following are true.

### A. Mutation detection works
- read-only turns do not run validation
- mutating turns do run validation

### B. Validation executes deterministically
- the exact required suite runs in the specified order
- logs are captured per command

### C. Failure feedback loop works
- if a validation command fails, the agent receives a structured follow-up message automatically
- the human does not need to manually re-prompt the agent for the first few retries

### D. Retry bound works
- after 3 failed auto-fix cycles, auto-repair stops and the user is notified clearly

### E. Expected skip handling works
- `smoke:session-control` expected structured skip does not fail the whole gate
- unexpected errors still fail the gate

### F. Browser/runtime regression is caught
- a deliberate runtime web regression similar to the recent Node-import leakage would fail the gate via `smoke:web`

### G. No recursive runaway
- the extension does not trigger duplicate nested validation loops
- validation commands themselves do not cause spurious new validation cycles

### H. Disable switch exists
- there must be a fast disable mechanism, e.g. env var:
  - `PIPHONY_VALIDATION_GATE=0`

When disabled, the extension should become a no-op.

---

## Recommended Implementation Shape

### Suggested file layout
- `.pi/extensions/validation-gate.ts`
- optional helper files if needed, but keep architecture simple

### Suggested internal components
- turn mutation tracker
- validation runner
- command result classifier
- retry state manager
- artifact writer
- feedback message formatter

Keep these as small local functions/modules, not a giant monolith.

---

## Validation of the Extension Itself

The implementing session must validate the extension with explicit scenarios.

### Scenario 1: read-only turn
- ask agent to inspect files only
- confirm validation gate does not run

### Scenario 2: successful mutating turn
- make a safe trivial code edit
- confirm validation runs
- confirm success message appears

### Scenario 3: failing mutating turn
- introduce a temporary deliberate failure
- confirm validation fails
- confirm failure is fed back to the agent automatically

### Scenario 4: browser/runtime-only regression
- simulate a regression that typecheck may miss but `smoke:web` catches
- confirm the extension blocks false completion

### Scenario 5: expected skip path
- confirm `smoke:session-control` structured skip is classified as non-fatal

### Scenario 6: retry limit
- keep a failure unresolved intentionally
- confirm loop stops after 3 attempts and notifies user

---

## Required Deliverables

1. The extension implementation
2. Any small helper files required
3. A short README or inline docs explaining:
   - how it works
   - retry policy
   - disable switch
   - artifact locations
4. Evidence from manual/automated exercise of the acceptance scenarios

---

## Constraints

- Follow `docs/PRODUCTION_NORTH_STAR.md`
- Follow repo `AGENTS.md`
- Prefer one canonical behavior, not optional fallback-heavy behavior
- No silent swallowing of failures
- No ambiguous "maybe validated" outcomes
- Be explicit about whether validation passed, failed, or skipped

---

## Final Definition of Done

This work is done only when:
- the extension is active in a project-local pi session
- a mutating coding turn automatically triggers the full validation gate
- failures automatically come back to the agent without human intervention
- success is clearly indicated
- retries are bounded
- expected skips are handled correctly
- the system demonstrably catches at least one runtime UI regression that static checks alone would miss
