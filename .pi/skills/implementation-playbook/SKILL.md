---
name: implementation-playbook
description: Use when the slice is already defined and you should run a staff-level implementation workflow through subagents. clarify the exact acceptance bar, delegate research if needed, delegate coding to the implementation subagent, review the actual diff, require the right smoke/live coverage, and do not accept the slice until full validation is green. Do not use for early requirement discovery, open-ended architecture exploration, or tiny direct edits where a heavyweight subagent workflow would add unnecessary overhead.
---

# Implementation Playbook

Use this skill when the user has already discussed and finalized a slice and now wants the work implemented through subagents rather than by direct coding in the main chat.

This playbook is for **you** in your staff engineer / architect role. The subagents are executors.

## Non-negotiable stance

For this repository:

- `AGENTS.md` and `docs/PRODUCTION_NORTH_STAR.md` win over local precedent.
- There is no room for "good enough" architecture.
- Green validation is necessary but not sufficient.
- The main agent must still review the actual diff and architectural boundaries.
- A mutating slice is **not done** until the full validation suite is green:
  ```bash
  DOCKER_CONFIG=/tmp/piphony-docker-config npm run validate:main
  ```
- If the slice changes a UI/runtime/live path, require explicit smoke coverage for that path. Do not assume existing smoke covers it without checking.

## Roles

### Main agent owns
- requirement clarification
- architectural decisions
- slice boundary definition
- acceptance criteria
- choosing required validation/smoke coverage
- reviewing the actual diff
- deciding whether the result is canonical enough

### `researcher` subagent owns
- local-first repo/spec/reference investigation
- identifying constraints, relevant files, risks, and likely implementation touchpoints

### `implementation` subagent owns
- making code changes
- iterating on corrections
- running full validation
- returning only when the code is green or genuinely blocked externally

## When to use researcher first

Use `researcher` before implementation if any of these are true:
- the slice touches an unfamiliar subsystem
- there is ambiguity about the canonical boundary
- smoke ownership is unclear
- multiple existing files/patterns could apply
- you need evidence before telling the implementation subagent what exact shape to build

If requirements are already fully settled and the implementation path is obvious, you may skip researcher.

## Main workflow

### 1. Restate the slice precisely
Before delegating, write down for yourself:
- the concrete user-visible behavior to add/change
- the canonical architectural boundary
- files/subsystems likely involved
- required validation, especially smoke/live coverage
- what must **not** happen (fallbacks, inference, duplicate patterns, bypass paths)

### 2. Define the acceptance bar explicitly
Your subagent prompt must include:
- the exact goal
- the architecture decisions already made
- required files/surfaces if known
- the required smoke/integration expectations
- the exact validation command:
  ```bash
  DOCKER_CONFIG=/tmp/piphony-docker-config npm run validate:main
  ```
- the rule that the subagent must keep iterating until validation is green unless blocked externally

Never delegate with only “implement this cleanly.”

### 3. Delegate implementation
Use the `implementation` subagent, not direct edits, for mutating work.

A strong prompt usually contains:
- **Goal**
- **Architecture / acceptance decisions already made**
- **Required behavior**
- **Implementation guidance**
- **Validation requirement**
- **Exact return format**

### 4. Review the actual diff, not just the summary
After the subagent returns:
- read the changed files directly
- inspect the current diff
- verify the implementation uses the intended canonical source/boundary
- check for any ambiguity, inference, fallback, or split-brain path
- verify smoke coverage really exercises the changed behavior

Never accept a slice purely because:
- the subagent says it is done
- tests are green
- the UI “looks right”

### 5. Send correction passes when needed
If the code is not strict enough, send the subagent back with a **sharp correction brief**.

Correction prompts should be concrete, e.g.:
- remove directory scanning entirely
- use the exact attached session file path
- do not infer from multiple sources
- add live smoke coverage to the existing canonical smoke path instead of creating a new smoke

Prefer surgical correction passes over vague “make it more canonical.”

### 6. Confirm validation and smoke match the slice
For any slice, ask:
- Did the full validation suite run?
- Did the changed behavior get exercised by the right smoke/live path?
- Is the smoke proving the real runtime-backed contract or only a deterministic approximation?

If the answer is no, the slice is not done.

### 7. Only then summarize / commit / push
Do not present the slice as finished until:
- architecture is acceptable
- full validation is green
- smoke coverage is appropriate for the changed behavior

If the user asks to commit/push, do that only after the above are true.

## Smoke review checklist

Use this checklist whenever the slice touches UI, observability, runtime, extension, tracker, or workflow behavior.

### UI changes
- Is there browser smoke for the exact UI path changed?
- If not, can the existing canonical browser smoke be extended rather than adding a new path?
- Are `data-testid`s added only when needed and in a clean, stable way?

### Observability changes
- Is the canonical source explicit?
- Are corrupt/missing artifacts fail-loud?
- Does a live smoke prove that a real runtime/agent flow renders in the UI?

### Runtime / workflow changes
- Does `smoke:stack` remain the canonical backend/runtime proof?
- Are lifecycle boundaries preserved (`prepare -> execution -> teardown`)?
- Was any repo-owned contract incorrectly re-implemented in Piphony?

### Extension / CoS changes
- If browser-visible behavior changed, does `smoke:extension-stack` prove it live?
- If the dashboard/UI is changed as part of an extension-visible flow, prefer extending the existing live browser smoke instead of inventing a parallel one.

## Architecture review checklist

Before accepting a delegated implementation, explicitly check:

- **One canonical shape per concept**
  - no duplicate shapes
  - no split sources of truth

- **Normalize once at the boundary**
  - no raw parsing in UI components
  - no re-normalization deep inside the stack

- **No silent fallbacks**
  - no guessing across multiple sources
  - no “first file wins” behavior
  - no hidden compatibility shims

- **Required types internally**
  - avoid optionality drifting inward without a real domain reason

- **Fail loudly**
  - corrupt/missing declared artifacts should error, not disappear silently

- **Canonical smoke surface**
  - extend the right smoke instead of creating overlapping one-off validation paths

## External blocker rule

The implementation subagent may return before green validation only if blocked by a true external issue, such as:
- provider quota/rate-limit/unavailable model
- Docker daemon unavailable
- host/browser environment issue outside the repo

If that happens, require the subagent to report:
- the exact command attempted
- the exact blocker text
- why it is external rather than a repo regression

## Recommended delegation template

Use a prompt shaped like this:

```text
Implement the next bounded slice.

Goal:
[exact user-visible outcome]

Architecture / acceptance decisions already made:
1. [...]
2. [...]
3. [...]

Required behavior:
- [...]
- [...]

Implementation guidance:
- reuse existing canonical boundaries
- do not add fallback behavior
- do not create a new smoke path if an existing canonical one should be extended

Validation requirement:
- Do not return until full validation is green.
- Run:
  DOCKER_CONFIG=/tmp/piphony-docker-config npm run validate:main
- If validation fails because of repo/code issues, fix them and rerun.
- Only return early for a genuine external blocker.

Return exactly:
1. Summary
2. Files changed
3. Validation run
4. Risks / follow-ups
```

## Final reminder

This skill does **not** authorize the main agent to relax standards because the subagent produced a working result.

The whole point of this playbook is:
- decide strictly
- delegate clearly
- review the real diff
- reject slop
- require full validation
- only then accept the slice
