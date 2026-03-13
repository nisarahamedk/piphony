# Piphony Build Slices

Status: slices 0-7 and 9 implemented + smoke-tested; slice 8 intentionally deferred

Implementation note:
- Codebase was later refactored from `packages/*` into a single-app `src/` structure.
- Repo `.pi/extensions` is now treated as the primary extension/guardrail surface.
- Piphony provides runtime/tracker tools programmatically; workflow guardrails are not baked into the app.
- New hosted-first workflow boundary implemented:
  - control plane is repo/toolchain agnostic
  - explicit repo workflow contract now lives in `.piphony/workflow.json`
  - workflow phases are scope-aware (`control_plane` vs `runtime`)
  - `reference/openclawsseum` was refactored to match this model via `scripts/piphony/*`
Source docs:
- `doc/handoff.md`
- `doc/symphony_rebuild_v2_spec.md`
- `reference/symphony/**`
- local pi docs/examples

## Current architecture checkpoint

Shipped now:
- built-in TanStack Start local tracker + observability UI in `apps/web`
- local pull-based orchestrator loop via `npm run orchestrator:watch`
- browser-driven E2E smoke using `agent-browser`
- UI now behaves like a tracker client:
  - create issues
  - edit issues
  - transition issues
  - observe comments / runs / transcripts
- orchestrator is again pull-based; UI does not directly start runs
- agent is responsible for in-run tracker writes through tracker tools

Important: this is directionally aligned with Symphony again, but not yet parity-complete.
The next work is specifically about hardening the local tracker/orchestrator model so it can support:
- Symphony-style claim / lease / reconcile semantics
- worker swarms
- stronger state-model alignment
- UI-visible worker health

## Next testable slices — Symphony-aligned local tracker hardening

### Slice 10 — SQLite-backed local tracker authority

**Goal:** Replace JSON-file tracker state with a lightweight SQLite authority suitable for issue lifecycle, comments, transitions, artifacts, and UI queries.

### Includes
- SQLite-backed local tracker store
- schema for:
  - issues
  - comments
  - artifacts
  - transitions/history
  - worker heartbeats
- adapter surface preserved at the `TrackerAdapter` level
- UI reads issue/comment state from SQLite-backed local tracker
- local CLI updated to operate on SQLite-backed tracker state

### Spec anchors
- `reference/symphony/SPEC.md` §7, §8, §11.5, §16
- `reference/symphony/elixir/WORKFLOW.md`

### Test / smoke exit criteria
- create issue
- transition issue
- append comment
- inspect issue
- restart process and confirm state persists
- UI still renders tracker state correctly from the new store

### Status checklist
- [x] SQLite schema added
- [x] local tracker store migrated from JSON authority to SQLite authority
- [x] adapter surface preserved
- [x] CLI updated
- [x] UI updated
- [x] SQLite tracker smoke passes

---

### Slice 11 — Symphony-style claim / heartbeat / reconcile loop

**Goal:** Make local orchestration correctness match Symphony’s pull-based single-authority claim model.

### Includes
- in-memory orchestrator claim set owned by a single poller instance
- orchestrator claim attempt before dispatch
- worker heartbeat updates while work is active
- reconcile behavior for:
  - completed workers
  - dead/stale worker visibility
  - terminal issues
  - non-runnable issues
- restart-safe recovery via issue-state authority + ephemeral claims
- configurable local concurrency for swarm-style local runs

### Spec anchors
- `reference/symphony/SPEC.md` §7.2, §7.3, §8, §16.2
- `reference/symphony/elixir/AGENTS.md`

### Test / smoke exit criteria
- non-runnable issue is not dispatched
- active issue is claimed before dispatch
- completed worker is reconciled and claim is released
- process restart leaves issue state authoritative and claimable again when still active
- local concurrency can dispatch more than one active issue when configured

### Status checklist
- [x] claim model implemented
- [x] worker heartbeat / claim visibility implemented
- [x] reconcile loop implemented
- [x] active-vs-non-runnable dispatch tests added
- [x] local swarm-concurrency test passes

---

### Slice 12 — State model alignment with Symphony

**Goal:** Align local tracker workflow semantics to Symphony instead of using a Piphony-only approximation.

### Includes
- review local canonical states against Symphony workflow semantics
- add `backlog` waiting state
- align runnable / waiting / review / terminal states
- replace `agent_review` with `human_review`
- update UI labels and board semantics
- update orchestrator eligibility rules
- update agent instructions so tracker transitions match Symphony’s model

### Spec anchors
- `reference/symphony/SPEC.md` §8.2, §11.5
- `reference/symphony/elixir/WORKFLOW.md` state handling sections

### Test / smoke exit criteria
- issue in non-runnable state is ignored by orchestrator
- issue in runnable state is claimed and moved correctly
- human review / rework loop works end-to-end
- terminal issues are not redispatched

### Status checklist
- [x] state mapping decided
- [x] tracker state semantics updated
- [x] orchestrator eligibility updated
- [x] UI board/status labels updated
- [x] review/rework smoke passes

---

### Slice 13 — Worker health + swarm visibility in the UI

**Goal:** Surface orchestrator/worker health clearly in the built-in web UI.

### Includes
- worker heartbeat view in UI
- last poll time
- current claims / active runs
- claimed issue -> worker mapping
- stale/offline worker indication
- live status panel suitable for local swarms

### Spec anchors
- `reference/symphony/SPEC.md` §19, §24
- local operator-surface requirements derived from current built-in UI direction

### Test / smoke exit criteria
- orchestrator watch loop appears alive in UI
- stopping the poller marks worker as stale/offline
- active claim is visible while issue is being worked
- local concurrency surfaces multiple active worker rows when configured

### Status checklist
- [x] worker heartbeat persisted
- [x] worker status API added
- [x] UI status panel added
- [x] stale worker detection added
- [x] worker-health smoke passes

---

### Slice 14 — Full UI-driven Symphony-style workflow smoke

**Goal:** Prove the final local workflow shape through the built-in UI with no direct UI run trigger.

### Includes
- `agent-browser` smoke drives the UI like a human tracker client
- browser flow:
  - create issue in backlog
  - transition to runnable state
  - observe orchestrator claim it
  - observe agent comments / progress / transition updates
  - observe final `human_review` state in UI
  - inspect linked run transcript/events in UI
- no UI API may directly start a run for a selected issue

### Spec anchors
- `reference/symphony/SPEC.md` §8, §11.5, §16
- `reference/symphony/elixir/WORKFLOW.md`

### Test / smoke exit criteria
- full browser-driven local workflow passes with separate poller process
- screenshots captured for board + run views
- resulting issue history proves:
  - human/UI transition into runnable state
  - orchestrator pull + claim
  - agent-owned tracker writes
  - final review transition

### Status checklist
- [x] UI smoke updated for pull-only flow
- [x] separate poller launched in smoke
- [x] browser-driven workflow smoke passes
- [x] screenshots/artifacts captured

## Planning principles

1. Setup first
2. Build a real local smoke surface before full implementation
3. Every slice ends with a test or smoke demo
4. Do not start Linear until the local loop works
5. Defer non-v1 concerns:
   - no durable workflow engine
   - no k8s/okteto early
   - no Jira/GitHub Issues early
   - no generic multi-agent runtime abstraction
   - no direct UI-triggered run dispatch path

## Smoke-test model policy

For smoke testing and cheap iterative validation, use the pi agent with:
- `model: Minimax-M2.5`
- `thinking: off`

Apply this by default to local smoke runs and routine end-to-end validation unless a slice explicitly requires a stronger model for debugging or quality comparison.

---

## Slice 0 — Repo setup / workspace scaffold

**Goal:** Create the monorepo and minimum dev/test foundation.

### Includes
- Node 22 + TypeScript workspace setup
- package scaffolding:
  - `packages/core`
  - `packages/pi-runner`
  - `packages/tracker-local`
  - `packages/runtime-docker`
  - `packages/validator-command`
  - `packages/tracker-linear` (scaffold only)
  - `profiles/implementation-agent`
  - placeholder profiles for `review-agent`, `qa-agent`, `merge-agent`
- root scripts for build/test/smoke/typecheck
- fixture directories for local smoke scenarios
- basic structured logging utilities

### Spec anchors
- `doc/symphony_rebuild_v2_spec.md` §10, §22, §23
- `doc/handoff.md` “Suggested Immediate Next Step”

### Test / smoke exit criteria
- workspace installs cleanly
- all packages build
- one trivial test passes
- one trivial smoke script emits a structured log event

### Status checklist
- [x] workspace created
- [x] packages scaffolded
- [x] root scripts added
- [x] base test runner working
- [x] base smoke script working

---

## Slice 1 — Local tracker test harness

**Goal:** Build the deterministic file-backed smoke surface first.

### Includes
- canonical local tracker state format on disk
- tracker fixture loader and reset utilities
- scenario runner utilities for smoke tests
- canonical workflow states:
  - `todo`
  - `in_progress`
  - `agent_review`
  - `human_review`
  - `rework`
  - `merging`
  - `done`
  - `cancelled`
- seeded tracker dataset
- golden-path smoke fixtures

### Spec anchors
- `doc/symphony_rebuild_v2_spec.md` §14.4, §14.5, §14.6, §23.1
- `doc/handoff.md` “Local tracker requirement”

### Test / smoke exit criteria
- deterministic scenario works entirely from local files:
  1. reset tracker state
  2. create issue
  3. inspect issue
  4. move issue state
  5. append comment
  6. dump state
  7. verify resulting on-disk state

### Status checklist
- [x] tracker state format defined
- [x] fixtures/reset utilities added
- [x] seeded dataset added
- [x] smoke scenario runner added
- [x] local file-based smoke passes

---

## Slice 2 — `tracker-local` adapter + CLI

**Goal:** Turn the harness into the first real adapter.

### Includes
- `tracker-local` adapter implementation:
  - `fetchCandidateWorkItems`
  - `fetchWorkItemById`
  - `fetchWorkItemsByState`
  - `normalize`
  - `applyMutation`
  - `appendComment`
  - `attachArtifact`
- CLI commands:
  - create issue
  - move issue state
  - comment on issue
  - attach artifact
  - inspect issue
  - reset
  - dump

### Spec anchors
- `doc/symphony_rebuild_v2_spec.md` §14.3–§14.6, §23.1
- `doc/handoff.md` “Recommended First Build Slice”

### Test / smoke exit criteria
CLI-only smoke:
- create issue
- list candidate work
- move to `in_progress`
- comment
- attach artifact
- inspect
- dump

This must prove orchestrator-facing reads and agent-facing writes use the same adapter surface.

### Status checklist
- [x] adapter contract implemented
- [x] normalization implemented
- [x] mutation/comment/artifact support added
- [x] CLI commands added
- [x] CLI smoke passes

---

## Slice 3 — Core contracts + orchestrator skeleton

**Goal:** Implement the thinnest orchestration loop against local tracker.

### Includes
- shared core domain types:
  - `WorkItem`
  - `Run`
  - `RuntimeInstance`
  - `GuardrailDecision`
  - `ValidationResult`
- orchestrator once-mode:
  - poll local tracker
  - choose one candidate item
  - create in-memory run record
  - log run lifecycle
- simple run worker boundary
- stub worker instead of real pi initially

### Spec anchors
- `doc/symphony_rebuild_v2_spec.md` §9, §11, §18, §19, §23.1

### Test / smoke exit criteria
Once-mode smoke:
1. local tracker contains one eligible issue
2. orchestrator polls it
3. orchestrator creates a run
4. orchestrator invokes stub worker
5. structured events are emitted:
   - `run.created`
   - `agent.turn.started` (or stub equivalent)
   - `run.completed`

### Status checklist
- [x] core types created
- [x] orchestrator polling implemented
- [x] candidate selection implemented
- [x] stub worker boundary implemented
- [x] once-mode smoke passes

---

## Slice 4 — Minimal `pi-runner` + first Agent Profile

**Goal:** Replace the stub worker with a real pi session on the control plane.

### Includes
- `packages/pi-runner`
- minimal profile loader
- first real profile: `profiles/implementation-agent`
- smoke/default profile settings use `model: Minimax-M2.5` with `thinking: off`
- profile wiring for prompt/model/tools/extensions
- baseline extension loading path in `pi-runner` so profiles can attach pi extensions deterministically
- a minimal extension bootstrap proving we can register/intercept tools without yet doing tracker mutations
- orchestrator invokes pi for a simple task against a local working directory
- no Docker runtime yet
- no tracker mutation tools yet

### Spec anchors
- `doc/symphony_rebuild_v2_spec.md` §6.1, §12, §20, §22, §23
- `doc/handoff.md` “pi session runner”

### Test / smoke exit criteria
Smoke run:
1. create local tracker issue
2. orchestrator picks it
3. run worker launches pi
4. pi reads local repo context
5. pi returns a result
6. orchestrator records completion

### Status checklist
- [x] pi-runner package added
- [x] profile loader added
- [x] implementation-agent profile added
- [x] orchestrator -> pi-runner wiring complete
- [x] minimal pi smoke passes

---

## Slice 5 — Agent-facing local tracker tools + full local E2E

**Goal:** Complete the first true end-to-end loop without Docker or Linear.

### Includes
- smoke runs continue using `model: Minimax-M2.5` with `thinking: off` unless explicitly overridden
- a dedicated pi extension for registering/exposing local tracker tools wired to `tracker-local`
- agent can through pi-visible tracker tools:
  - read current issue state
  - append comments
  - transition states
  - attach artifacts
- a minimal guardrail extension that intercepts tracker mutation tool calls
- mutation logging + basic allow/block checks through extension hooks
- orchestrator and agent mutate the same tracker surface

### Spec anchors
- `doc/symphony_rebuild_v2_spec.md` §14.5, §15.1–§15.7, §23.1
- `doc/handoff.md` “local tracker tool path for the agent”

### Test / smoke exit criteria
Full local smoke:
1. create issue in local tracker
2. orchestrator polls and selects it
3. pi session runs
4. pi uses tracker tools to comment and/or transition issue
5. orchestrator observes updated tracker state
6. run completes successfully

### Status checklist
- [x] tracker-tools pi extension implemented
- [x] tracker tools exposed to pi
- [x] comment/state mutation paths work
- [x] artifact attachment works
- [x] guardrail pi extension installed
- [x] mutation interception/logging works
- [x] full local E2E smoke passes

---

## Slice 6 — `runtime-docker` + proxied `bash`

**Goal:** Prove the control-plane pi / target-runtime execution model.

### Includes
- Docker smoke runs continue using `model: Minimax-M2.5` with `thinking: off` unless explicitly overridden
- `runtime-docker` provider
- runtime contract:
  - `prepare`
  - `start`
  - `waitUntilReady`
  - `selectTarget`
  - `execOnTarget`
  - `getEndpoints`
  - `collectArtifacts`
  - `stop`
  - `destroy`
- a dedicated pi extension that preserves `bash` and proxies execution into the Docker Compose target
- extension-level interception/logging for bash invocations routed to the target runtime
- stable in-environment service identities
- preferred Docker smoke target repo: `https://github.com/nisarahamedk/openclawsseum` (TanStack Start + local Convex + Cloudflare stack)

### Spec anchors
- `doc/symphony_rebuild_v2_spec.md` §4.4, §13, §15.1, §23
- `doc/handoff.md` “Execution model”, “Runtime execution”

### Test / smoke exit criteria
Docker smoke:
1. start test runtime with Docker Compose
2. use `openclawsseum` as the preferred smoke app target if available
3. orchestrator provisions runtime
4. pi runs on control plane
5. agent calls `bash`
6. command executes inside target container/service
7. output returns through pi
8. tracker gets updated

### Status checklist
- [x] runtime-docker package added
- [x] provider lifecycle implemented
- [x] target selection implemented
- [x] bash proxy pi extension implemented
- [x] bash interception/logging works
- [x] `openclawsseum` smoke target prepared
- [x] Docker smoke passes

---

## Slice 7 — Branch/worktree lifecycle + `.symphony/PROGRESS.md` + retry semantics

**Goal:** Implement restart-tolerant continuity the v1 way.

### Includes
- branch naming = issue identifier
- branch reuse validation
- fresh runtime per attempt
- `.symphony/PROGRESS.md` bootstrap + update helpers
- worktree/checkout helpers
- stale PR/branch handling policy structure
- retry/restart orchestration rules

### Spec anchors
- `doc/symphony_rebuild_v2_spec.md` §4.5–§4.8, §16, §17, §18
- `doc/handoff.md` “Retry / restart model”, “Handoff mechanism”

### Test / smoke exit criteria
Restart smoke:
1. issue has an existing valid branch
2. new run creates a fresh runtime
3. branch is reused
4. `.symphony/PROGRESS.md` is present and read
5. run continues from current branch state

Failure-mode smoke:
- invalid branch/PR triggers fresh-branch path

### Status checklist
- [x] branch naming/reuse rules implemented
- [x] fresh runtime retry semantics implemented
- [x] progress file helpers added
- [x] restart smoke passes
- [x] invalid branch smoke passes

---

## Slice 8 — `tracker-linear` + raw-tool guardrails

**Goal:** Introduce the first real external tracker after local parity exists.

### Includes
- Linear adapter
- state mapping to canonical workflow states
- raw tracker mutation path
- pi extension interception for guarded transitions
- first `validator-command` integration for transition gating

### Spec anchors
- `doc/symphony_rebuild_v2_spec.md` §4.1, §14, §15.2–§15.4, §23
- `doc/handoff.md` “Tracker / runtime”

### Test / smoke exit criteria
Linear integration smoke:
- fetch candidate issue
- start run
- attempt guarded transition
- validator passes or blocks
- resulting tracker state matches guardrail result

### Status checklist
- [ ] tracker-linear package implemented
- [ ] state mapping implemented
- [ ] raw mutation path implemented
- [ ] guardrail interception implemented
- [ ] Linear smoke passes

---

## Slice 9 — Observability + operator surface + MVP hardening

**Goal:** Make the system operable, inspectable, and demoable before introducing the first external tracker.

### Includes
- structured event stream
- run status summary
- runtime health summary
- guardrail decision logs
- transcript/artifact paths
- local tracker state introspection
- basic CLI/operator commands
- failure-mode and cleanup hardening

### Spec anchors
- `doc/symphony_rebuild_v2_spec.md` §19, §23, §24
- `doc/handoff.md` “Operator Surface”

### Test / smoke exit criteria
Operator smoke (must validate against the local smoke surface before Linear):
- run a full local issue lifecycle using `tracker-local`
- inspect logs/status/artifacts after completion
- inspect failed run details after forced error
- confirm enough visibility exists without a dashboard
- then verify the same observability surface still works for Docker-backed runs

### Status checklist
- [x] structured events finalized
- [x] status/reporting commands added
- [x] artifacts/transcript visibility added
- [x] failure-path observability added
- [x] operator smoke passes

---

## Phase grouping

### Phase A — foundation
- Slice 0
- Slice 1
- Slice 2

### Phase B — prove the local orchestration thesis
- Slice 3
- Slice 4
- Slice 5

### Phase C — prove target-runtime execution
- Slice 6
- Slice 7

### Phase D — observability before external tracker
- Slice 9
- Slice 8

---

## First three meaningful demos

### Demo 1: Local tracker harness
After Slice 2:
- CLI can create/move/comment/inspect issues
- deterministic local state exists
- no pi required yet

### Demo 2: Local full E2E
After Slice 5:
- local tracker -> orchestrator -> pi -> local tracker
- first major proof point

### Demo 3: Docker-isolated E2E
After Slice 6:
- pi on control plane
- `bash` inside target runtime
- tracker updated from same run

---

## Explicit deferrals
- Kubernetes runtime
- Okteto runtime
- Jira adapter
- GitHub Issues adapter
- durable workflow engine
- multi-instance orchestration beyond the Symphony-style claim/lease groundwork
- advanced profile routing beyond MVP
- deep review/qa/merge specialization early

---

## Recommended immediate implementation order

1. Slice 0
2. Slice 1
3. Slice 2
4. Slice 3
5. Slice 4
6. Slice 5
7. Slice 6
8. Slice 7
9. Slice 9
10. Slice 8

Do not start Linear or Docker until Slice 5 is working.
Validate observability on the local smoke surface before introducing Linear.