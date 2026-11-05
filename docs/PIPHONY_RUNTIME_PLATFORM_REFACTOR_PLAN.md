# Piphony Runtime Platform Refactor Plan

This plan breaks the runtime-platform refactor into small, testable slices.

It is aligned with:

- `docs/PIPHONY_RUNTIME_PLATFORM_ABSTRACTION.md`
- `docs/PRODUCTION_NORTH_STAR.md`
- `AGENTS.md`
- `.pi/skills/implementation-playbook/SKILL.md`

The implementation strategy is:

- define a bounded slice
- execute it through subagents
- review the actual diff
- require the right smoke/live coverage
- do not accept the slice until validation is green

---

## Chosen validation target

### Primary OSS IDP target

**DevSpace on Minikube**

### Acceptable local fallback

**DevSpace on kind**

### Why this is the right first proof

We want the first real validation target to be:

- open source
- runnable locally on a Mac
- Kubernetes-native
- close to the semantics of the customers we ultimately care about
- capable of proving a shared workspace plus repo attachment model against a multi-repo, multi-service app

DevSpace fits that better than DevPod for this refactor.

---

## Refactor target

Piphony should converge toward a runtime model with:

1. **workspace lifecycle**
2. **repo attachment lifecycle**
3. orchestration ownership of workspace lifecycle above individual implementation runs
4. extension-backed runtime platform providers
5. smoke coverage against:
   - the existing simple local runtime path
   - one real Kubernetes-native OSS IDP path

---

## Execution model for this refactor

Every slice below should be implemented with the `implementation-playbook` process.

For each slice:

1. clarify the exact acceptance bar
2. delegate implementation through subagents
3. inspect the actual diff
4. run the required validation and smoke
5. reject the slice if the architecture is still muddy

Do not batch multiple slices into one giant change.

---

# Slice breakdown

## Slice 0 — Local DevSpace proving ground

### Goal

Create the local environment, fixture app, and smoke harness that the rest of the refactor will target.

This slice comes first on purpose.
We want a real proving ground before changing core runtime architecture.

### Scope

#### 0.1 Local environment setup

Add the minimal local setup path for macOS:

- Minikube bootstrap instructions/scripts
- kind fallback instructions/scripts
- DevSpace CLI prerequisites
- local cleanup/reset commands

#### 0.2 Multi-repo fixture app

Create a minimal but realistic multi-repo fixture set with at least:

- React frontend repo
- Apollo GraphQL gateway repo
- FastAPI backend repo
- Postgres dependency

The fixture should prove:

- shared workspace deployment
- repo-specific work targets
- one deterministic end-to-end user journey

#### 0.3 Standalone DevSpace smoke harness

Add a standalone smoke that:

1. clones the fixture repos to temp dirs
2. starts Minikube (or uses an already running local cluster if policy says so)
3. deploys the shared workspace through DevSpace
4. validates the fixture app end-to-end
5. tears the workspace down cleanly

This slice does **not** need the new Piphony runtime abstraction yet.
It only needs a reliable local proving ground.

### Expected files/surfaces

- `reference/` fixture repos and/or fixture source
- smoke harness scripts/commands
- local docs for running the smoke

### Tests and smoke

Required:

- deterministic checks for fixture repo wiring where practical
- one local DevSpace smoke on macOS
- explicit teardown verification

### Acceptance bar

- a Mac can run the DevSpace fixture smoke locally
- the fixture is multi-repo and multi-service
- one deterministic end-to-end journey passes
- setup and teardown are explicit and observable
- rerunning the smoke is practical and boring

---

## Slice 1 — Core runtime platform contract

### Goal

Introduce the canonical runtime platform interface without changing runtime behavior yet.

### Scope

Add explicit core contracts for:

- workspace prepare/teardown
- repo attach/detach
- workspace identity metadata
- repo attachment identity metadata
- execution targets returned by repo attachments

### Constraints

- one canonical interface only
- no compatibility maze
- no provider-specific behavior in core types
- keep simple providers lightweight

### Expected files/surfaces

- `src/extensions/types.ts`
- `src/extensions/api.ts`
- `src/extensions/runtime.ts`
- `src/project/execution.ts`
- new runtime-platform helper modules as needed

### Tests and smoke

Required:

- unit tests for workspace vs attachment lifecycle separation
- unit tests for identity shape and invalid states
- existing deterministic suite still green

### Acceptance bar

- the core model expresses workspace + repo attachment cleanly
- no runtime provider has been hardcoded into the abstraction
- simple implementations still look simple in code

---

## Slice 2 — Observability and artifact shape

### Goal

Make workspace identity and attachment identity observable before deeper behavior changes.

### Scope

Record, at minimum:

- runtime platform id
- workspace id
- attachment id
- primary workspace endpoint summary

Presentation rule:

- UI should primarily show implementation agents / runs
- workspace identity is supporting context
- raw attachment identity belongs mainly in logs and artifacts

### Expected files/surfaces

- run status artifacts
- run summary artifacts
- logger events
- any run detail UI touched by the current slice

### Tests and smoke

Required:

- deterministic artifact-shape tests
- log/event tests where appropriate
- existing smoke still green

### Acceptance bar

- shared-workspace context is visible in artifacts/logs
- the UI remains run-centric, not attachment-centric

---

## Slice 3 — Migrate simple local runtimes to the new contract

### Goal

Re-express host and Docker Compose runtimes using the new workspace + repo attachment model.

### Scope

#### 3.1 Host runtime
- trivial workspace
- host repo attachment
- no-op teardown where appropriate

#### 3.2 Docker Compose runtime
- workspace = compose project / shared stack
- repo attachment = runtime execution target
- teardown = compose shutdown

### Constraints

- Docker Compose remains the canonical simple runtime proof
- no hidden fallback layers
- no split-brain lifecycle semantics

### Expected files/surfaces

- runtime provider wiring
- onboarding/default environment scaffolding
- Docker Compose / host runtime modules

### Tests and smoke

Required:

- existing local Docker Compose smoke remains green
- deterministic tests for simple-provider lifecycle

### Acceptance bar

- simple local runtimes implement the new model cleanly
- the old per-run environment model is no longer the canonical source of truth

---

## Slice 4 — Workspace coordinator above implementation runs

### Goal

Move workspace ownership above individual implementation runs.

### Scope

Introduce the smallest higher-level coordinator that can:

- prepare a workspace once
- allow implementation runs to attach into it
- tear the workspace down once

This slice should focus on lifecycle ownership, not full planner/QA orchestration.

### Constraints

- do not hide lifecycle transitions inside workers
- fail fast on invalid workspace/attachment state
- keep cleanup observable

### Expected files/surfaces

- `src/core/orchestrator-run-executor.ts`
- `src/core/orchestrator.ts`
- new coordinator/session layer
- runtime/session state artifacts

### Tests and smoke

Required:

- deterministic tests proving workspace prepare is not repeated per slice
- deterministic tests proving attachment teardown does not destroy workspace
- existing local smoke still green

### Acceptance bar

- workspace lifecycle is clearly above the individual run
- repo attachment is clearly around implementation execution
- failure paths still leave evidence and cleanup attempts

---

## Slice 5 — DevSpace provider implementation

### Goal

Implement the first real OSS IDP provider using the new abstraction.

### Important architectural rule

This should be implemented as an **extension-backed runtime platform provider**, not as a core special case.

That means:

- core owns the generic workspace + attachment contracts
- DevSpace-specific behavior lives in provider-specific modules / extension-backed implementation

### Scope

#### 5.1 Workspace lifecycle

- create/resolve shared DevSpace-backed workspace on Minikube
- deploy the shared fixture stack
- capture workspace identity and endpoint summary

#### 5.2 Repo attachment lifecycle

- attach repo-specific dev sessions into the shared workspace
- provide execution targets for running bash/tool commands
- detach without destroying the workspace

### Expected files/surfaces

- DevSpace provider modules
- extension scaffolding/helpers
- smoke harness integration

### Tests and smoke

Required:

- deterministic provider tests where practical
- local DevSpace smoke against the fixture app
- explicit teardown verification

### Acceptance bar

- commands really execute through DevSpace-backed attachments
- one shared workspace exists above individual repo runs
- provider logic stays out of core

---

## Slice 6 — Multi-repo attachment smoke

### Goal

Prove the abstraction remains natural when multiple repos participate in the same workspace.

### Scope

Use the DevSpace fixture to prove:

- prepare one shared workspace
- attach repo A and run a deterministic task
- attach repo B and run a deterministic task
- optionally attach repo C if cost stays reasonable
- keep one shared workspace alive across those slices

### Tests and smoke

Required:

- multi-repo DevSpace smoke
- explicit evidence of one workspace with multiple repo runs

### Acceptance bar

- the abstraction still feels obvious under multi-repo participation
- no lifecycle ambiguity appears when more than one repo is involved

---

## Slice 7 — Workspace-scoped E2E QA smoke

### Goal

Prove that end-to-end QA is naturally workspace-scoped rather than repo-attachment-scoped.

### Scope

Run one deterministic end-to-end validation against the shared fixture workspace:

- FE -> GraphQL gateway -> backend -> Postgres

### Tests and smoke

Required:

- one canonical E2E smoke journey
- evidence that QA binds to workspace endpoints, not a single repo attachment

### Acceptance bar

- the workspace is the obvious scope for cross-service validation
- QA does not have to know too much about repo attachment internals

---

## Slice 8 — Failure-path and re-attachment hardening

### Goal

Lock in cleanup and continuation semantics.

### Scope

#### 8.1 Failure-path cleanup

Prove:

- workspace prepare succeeds, attachment fails
- attachment succeeds, implementation fails
- teardown still runs correctly

#### 8.2 Re-attachment model

Clarify and prove the canonical model:

- re-attachment is the default continuation and recovery mechanism
- containers/attachments may be ephemeral
- durable work state lives in branch / WIP branch / PR state
- continuation means: bring up a fresh repo-scoped attachment, restore/fetch branch/PR state, continue

This should support both:

- recovery after interruption/failure
- continuation when a slice moves to rework

### Tests and smoke

Required:

- failure-path smoke
- re-attachment smoke

### Acceptance bar

- no hidden assumption of immortal containers
- re-attachment is boring and explicit
- cleanup failures remain observable

---

# Validation matrix by slice

## Slice 0
- local DevSpace fixture smoke

## Slice 1
- deterministic contract tests
- existing suite green

## Slice 2
- deterministic artifact/log tests
- existing suite green

## Slice 3
- Docker Compose smoke
- deterministic simple-runtime tests

## Slice 4
- deterministic coordinator/lifecycle tests
- existing smoke still green

## Slice 5
- DevSpace provider tests
- local DevSpace smoke

## Slice 6
- multi-repo DevSpace smoke

## Slice 7
- workspace-scoped E2E smoke

## Slice 8
- failure cleanup smoke
- re-attachment smoke

Every mutating slice still ends with the full required validation gate before acceptance.

---

# Recommended implementation order

1. Slice 0 — local DevSpace proving ground
2. Slice 1 — core runtime platform contract
3. Slice 2 — observability and artifact shape
4. Slice 3 — migrate simple local runtimes
5. Slice 4 — workspace coordinator above runs
6. Slice 5 — DevSpace provider implementation
7. Slice 6 — multi-repo attachment smoke
8. Slice 7 — workspace-scoped E2E QA smoke
9. Slice 8 — failure-path and re-attachment hardening

---

# Explicit non-goals for the first refactor wave

- full Okteto provider implementation
- DevPod provider implementation
- Signadot integration
- Backstage integration
- formal installation-scoped extension distribution in the same slice unless required by the implementation path
- full production-grade planner-driven multi-agent workflow in one PR

The goal of this refactor wave is to:

- land the correct abstraction
- prove it against one simple local runtime
- prove it against one real Kubernetes-native OSS IDP runtime
- lock in the recovery and cleanup model before expanding platform coverage
