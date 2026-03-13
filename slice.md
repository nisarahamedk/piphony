# Piphony Build Slices

Status: slices 0-7 and 9-20 implemented + smoke-tested; slice 8 intentionally deferred; slice 21 implemented and validated via tests + targeted CoS/browser smokes

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
- local shared-stack startup via `npm run dev:stack` (web + orchestrator + CoS server)
- local pull-based orchestrator loop still available via `npm run orchestrator:watch`
- browser-driven E2E smoke now uses Playwright for strict browser validation
- Chief of Staff now ships as a true browser extension surface (MV3 side panel / extension page runtime), not an in-app embedded panel
- UI now behaves like a tracker client:
  - create issues
  - edit issues
  - transition issues
  - observe comments / runs / transcripts
- orchestrator is again pull-based; UI does not directly start runs
- agent is responsible for in-run tracker writes through tracker tools

Important: the local tracker/orchestrator/UI hardening slices are now shipped for the current built-in web surface.

The next work is a deliberate product pivot:
- keep the existing pull-based orchestrator
- keep `RunWorker` for v1
- keep tracker providers as issue authority
- keep runtime providers as execution authority
- add a sessionful Pi control layer for active runs
- add a true browser extension as the primary end-user UX
- remove the temporary in-web CoS embedding so extension UX lives only in the browser extension runtime
- add a Rivet-backed `ChiefOfStaffActor` as the only browser-facing realtime actor in v1

## Completed local hardening slices

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

---

## Locked v1 assumptions — extension-first Chief of Staff

- single-user OSS deployment
- orchestrator remains pull-based and is still the only thing that launches work
- extension / built-in UI do not directly launch runs
- `RunWorker` remains the active-run execution abstraction in v1
- active Pi sessions are disposable; exact resume is not required
- tracker providers remain issue authority
- runtime providers remain execution authority
- Rivet is introduced only for `ChiefOfStaffActor`
- one `ChiefOfStaffActor` per user
- extension should support both issue-page and board/overview contexts
- tracker page detection should be generic in shape, even if the first implementation only deeply supports one provider at a time
- the CoS agent may plan work and create tickets, in addition to observing and steering active runs

## Next testable slices — extension-first Chief-of-Staff v1

### Slice 15 — Sessionful Pi control for active `RunWorker` sessions

**Goal:** Keep `RunWorker` but replace the fire-and-forget Pi wrapper with a live controllable Pi session layer.

### Includes
- new sessionful Pi controller abstraction for active runs
- support for:
  - `start`
  - `steer`
  - `followUp`
  - `snapshot`
  - `abort`
- `RunWorker` integration that keeps the current orchestrator model intact
- active session lifecycle cleanup on completion/failure

### Spec / design anchors
- `doc/handoff.md`
- `doc/symphony_rebuild_v2_spec.md` §4.4, §13, §14, §15
- local pi docs/examples

### Test / smoke exit criteria
- create one runnable issue and dispatch a real Pi-backed worker
- while the run is active, fetch a session snapshot
- send a steer/follow-up message into the active Pi session
- abort an active run cleanly
- completed/failed runs release their active session handles

### Status checklist
- [x] sessionful Pi controller abstraction added
- [x] `RunWorker` path migrated to use live session control
- [x] steer/followUp/abort plumbing added
- [x] real Pi smoke passes with `Minimax-M2.5` and `thinking: off`

---

### Slice 16 — Active run registry + session artifact index

**Goal:** Make active runs discoverable and probeable by the control plane, CoS agent, and extension surfaces.

### Includes
- active run registry keyed by `runId`
- mapping from issue/work item -> active run
- current phase / heartbeat / worker metadata
- latest session artifact pointers:
  - transcript
  - summary
  - events/jsonl
- registry hooks for live steering into active sessions

### Spec / design anchors
- `doc/handoff.md`
- `src/core/orchestrator.ts`
- `src/observability/logger.ts`

### Test / smoke exit criteria
- dispatch two active issues with local concurrency > 1
- registry lists both runs while active
- registry exposes issue linkage + latest artifact paths
- finished runs disappear from the active registry but keep artifact history inspectable
- steering can locate the correct active run by issue context

### Status checklist
- [x] active run registry added
- [x] issue/run lookup surface added
- [x] session artifact indexing added
- [x] multi-run smoke passes

---

### Slice 17 — Piphony Chief-of-Staff tool surface

**Goal:** Expose the minimal backend tool surface a Pi-based Chief of Staff needs.

### Includes
- CoS-facing tools/APIs for:
  - issue context lookup
  - active run listing
  - run detail / artifact lookup
  - steer/followUp/abort active run
  - create issue / create child tickets
- clear separation between:
  - observability reads
  - live session control
  - tracker mutations

### Spec / design anchors
- `doc/handoff.md`
- `doc/symphony_rebuild_v2_spec.md` §14, §15
- current `src/pi/tracker-tools.ts`

### Test / smoke exit criteria
- CoS tool surface can list active runs
- CoS tool surface can resolve issue -> active run context
- CoS tool surface can steer one active run
- CoS tool surface can create a new ticket in the current tracker backend

### Status checklist
- [x] CoS tool surface designed
- [x] observability/read tools added
- [x] run-control tools added
- [x] issue creation/planning tools added
- [x] smoke passes end-to-end

---

### Slice 18 — Rivet `ChiefOfStaffActor` with Pi CoS profile

**Goal:** Introduce Rivet only for the browser-facing Chief of Staff session, with a Pi agent using a Piphony CoS profile as its brain.

### Includes
- one CoS actor per user
- websocket/realtime connection surface for extension and local testing
- Pi session inside the actor using a dedicated Piphony CoS profile
- CoS actor tools wired to the Piphony CoS tool surface
- session context handling for:
  - current issue page
  - current board/overview page
  - recent conversation state

### Spec / design anchors
- `reference/rivet/**`
- `reference/skills/**`
- `doc/handoff.md`

### Test / smoke exit criteria
- connect a local client to `ChiefOfStaffActor`
- ask for status on a current issue and receive a useful answer
- ask “what needs my attention?” and receive an overview answer
- steer an active worker Pi session through the CoS actor
- create a ticket through the CoS agent from planning context

### Status checklist
- [x] CoS Rivet actor added
- [x] Pi CoS profile added
- [x] CoS actor <-> Piphony tool surface wired
- [x] local realtime smoke passes

---

### Slice 19 — Extension context abstraction for issue + board pages

**Goal:** Build the extension around a generic tracker page-context abstraction instead of a one-off hardcoded page.

### Includes
- content-script page detection abstraction
- normalized context extraction for:
  - issue pages
  - board/overview pages
- connection from page context -> CoS actor session
- true MV3 extension runtime:
  - background/service worker
  - content script
  - side panel / extension page UI
- extension UI shell for:
  - current issue summary / steering
  - current board overview / planning
- no in-web CoS embedding in the native app

### Spec / design anchors
- `apps/extension/**`
- `doc/handoff.md`

### Test / smoke exit criteria
- start the shared local stack and open the native Piphony web UI with no special query params
- load the true browser extension surface against that page
- on an issue page fixture or supported tracker page, extension resolves issue context and shows CoS summary
- on a board/overview fixture or supported tracker page, extension resolves board context and shows CoS overview
- steering from issue view reaches the active worker session
- CoS board planning can create at least one new ticket visible in the tracker backend

### Status checklist
- [x] page-context abstraction added
- [x] issue surface added
- [x] board/overview surface added
- [x] extension smoke passes on both surfaces

---

### Slice 20 — Planning workflow through CoS

**Goal:** Let the CoS agent decompose work and create tracker tickets from issue/board context.

### Includes
- prompt/profile guidance for planning behavior
- ticket creation through tracker tools/services
- optional child-ticket / follow-up-ticket creation
- board-context planning path and issue-context planning path

### Spec / design anchors
- `doc/handoff.md`
- tracker provider abstractions in `src/core/types.ts`

### Test / smoke exit criteria
- ask CoS to break an initiative into tickets from board context
- CoS proposes a plan and creates tickets
- newly created tickets are visible in tracker state and extension context

### Status checklist
- [x] planning prompts/profile behavior added
- [x] ticket-creation flow wired
- [x] planning smoke passes

---

### Slice 21 — Single-user v1 hardening for active run probing + steering

**Goal:** Make the extension-first single-user swarm operationally reliable enough for v1 without introducing full distributed claim/lease complexity.

### Includes
- stale active-run detection
- safe active session cleanup on crash/failure paths
- cancel/retry controls through CoS tool surface
- clearer run ownership and phase visibility for the active registry
- smoke coverage for multiple runnable tickets with CoS visibility

### Spec / design anchors
- `doc/handoff.md`
- current local orchestrator model in `src/core/orchestrator.ts`

### Test / smoke exit criteria
- multiple runnable issues can be processed up to configured concurrency
- CoS can see multiple active runs from board/overview context
- a stalled run is surfaced as needing attention
- operator can abort/retry through CoS and see recovery

### Status checklist
- [x] stale-run detection added
- [x] active-session cleanup hardened
- [x] CoS abort/retry flow added
- [x] multi-run hardening coverage passes

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

Testing guidance:
- prefer deterministic fake/gated controllers in unit tests where possible
- use real Pi sessions with the cheap smoke model above where needed to cover the full surface end-to-end
- each new slice should begin with repo/reference research using researcher subagents before implementation

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