# Piphony Handoff

This document primes a new session to continue building Piphony.

## Repo / Paths

Project root:
- `/Users/nisar/Workspace/piphony`

Primary spec:
- `/Users/nisar/Workspace/piphony/doc/symphony_rebuild_v2_spec.md`

Reference copy of original Symphony:
- `/Users/nisar/Workspace/piphony/reference/symphony`

## Project Identity

**Piphony** is a pi-native rebuild of Symphony.

V1 is intentionally:
- Symphony-like in orchestration loop
- pi-native in agent model
- Linear-first
- Docker-Compose-first
- multi-tracker-capable later
- multi-runtime-capable later
- explicitly de-scoped in durable workflow / heavy control plane complexity

## Locked V1 Decisions

### Core architecture
- `pi` is the only supported agent runtime in v1.
- Custom agents are **Agent Profiles** on top of pi.
- Guardrails are implemented as **pi extensions**.
- No standalone policy proxy layer in v1.
- No durable workflow engine in v1.
- Single orchestrator process in v1.

### Execution model
- The **pi session runs on the control plane**.
- Preserve the tool name **`bash`**.
- Override `bash` via a pi extension and proxy commands to the selected target runtime.
- Do **not** build remote `read` / `write` / `edit` tools in v1.
- Tracker writes happen through pi-visible tools.

### Tracker / runtime
- First real tracker: **Linear**.
- Also build a **local tracker adapter** early for full smoke testing.
- First runtime provider: **Docker Compose**.
- Kubernetes / Okteto later.

### Retry / restart model
- Always create a **fresh runtime** on retry/restart.
- Reuse branch if a branch with the issue identifier already exists and the issue is not terminal.
- Branch name = issue identifier.
- Close stale/invalid PRs.
- Durable continuity comes from:
  - branch state
  - tracker/workpad state
  - `.symphony/PROGRESS.md`

### Handoff mechanism
- Use `.symphony/PROGRESS.md` in the repo being worked on.
- Agents should keep it current and commit it.
- No raw session-log replay required in v1.

### Config
- Keep config shape close to current Symphony.
- `WORKFLOW.md` remains a primary repo-owned contract surface.

## Important Runtime / Testing Mental Model

### Local tracker requirement
The local tracker is a **first-class adapter**, not a mock.
It should match real tracker behavior in both directions:
1. tracker -> orchestrator
2. agent -> tracker

This gives a full smoke-test surface:
- orchestrator pulls from local tracker
- agent mutates the same local tracker through tracker tools
- no Linear dependency required for end-to-end testing

### Runtime execution
The right v1 model is:
- orchestrator provisions runtime
- orchestrator chooses target runtime
- pi runs on control plane
- `bash` is proxied to the selected target runtime via extension

Examples:
- Docker Compose target -> `docker compose exec ... bash -lc ...`
- Okteto target -> `okteto exec ... -- bash -lc ...`
- Kubernetes target -> likely `kubectl exec ... -- bash -lc ...`

## Recommended First Build Slice

Build these first, in order:

1. **tracker-local**
   - file-backed local tracker state
   - adapter contract
   - issue state transitions
   - comments / artifact attachment basics

2. **local tracker CLI**
   - create issue
   - move issue state
   - comment on issue
   - inspect issue
   - reset / dump state

3. **minimal orchestrator loop**
   - poll local tracker
   - pick candidate issue
   - start a run
   - log status

4. **pi session runner**
   - start pi on control plane
   - load a minimal Agent Profile

5. **target-proxied `bash` override**
   - override pi `bash` with extension
   - route execution to selected target runtime
   - start with simple local/dev target transport if helpful, then Docker Compose

6. **local tracker tool path for the agent**
   - expose tracker tool(s) against local tracker
   - prove end-to-end state mutation works

This slice should allow a real smoke test of:
- issue created in local tracker
- orchestrator picks it up
- pi runs
- agent executes bash against target
- agent updates tracker
- orchestrator sees updated state

## Suggested Immediate Next Step

Start by scaffolding:
- package layout from the spec
- `tracker-local`
- local tracker CLI
- core tracker interface
- minimal orchestrator loop against local tracker

## Final Reminder

Avoid over-engineering v1.

Do **not** start with:
- Postgres
- TanStack Start UI
- durable workflows
- multi-instance coordination
- generic policy proxy system
- remote read/write/edit tools

The immediate goal is to validate the core loop with:
- pi-native agent profiles
- proxied bash execution
- tracker guardrails
- local smoke testing
