# Symphony Rebuild V2 Specification

Status: Draft v0.5
Reference inspiration: OpenAI Symphony reference spec at `symphony/SPEC.md`

This document defines a larger, simpler, pi-native rebuild of Symphony.

---

## 1. Executive Summary

V1 is intentionally scoped as:

> **A Symphony-like orchestrator, but pi-native, multi-tracker-capable, and multi-runtime-capable.**

It keeps the core loop close to the current Symphony model:
- poll tracker,
- select eligible work,
- create isolated execution per issue,
- keep working while the issue remains active,
- and restart simply.

But it changes the agent and extensibility model substantially:
- `pi` is the native agent runtime,
- custom behavior lives in pi Agent Profiles,
- guardrails live in pi extensions,
- tracker support is adapter-based,
- runtime support is provider-based.

V1 is intentionally **not** a durable workflow engine, not a full enterprise control plane, and not a generalized multi-agent platform.

---

## 2. Purpose

Symphony Rebuild V2 is a work orchestration system for autonomous software execution.

It is designed to:
- read work from issue trackers,
- provision isolated per-issue development environments,
- run a coding agent inside those environments,
- support custom pi-based agent profiles,
- enforce deterministic transition gates through pi extensions,
- and coordinate work with a simple, restart-tolerant orchestration loop.

Unlike the OpenAI reference implementation, this rebuild is intended to support:
- `pi` as the native coding agent runtime,
- multiple models/providers through `pi`,
- multiple runtime backends such as Docker Compose, Kubernetes, and Okteto,
- multiple tracker providers such as Linear, Jira, GitHub Issues, and a local tracker for smoke testing,
- and specialized custom agents such as implementation, review, QA, and merge agents.

---

## 3. V1 Scope

### 3.1 What V1 Is

V1 is:
- a long-running orchestrator process,
- a pi-native issue execution system,
- a multi-tracker orchestration layer,
- a multi-runtime orchestration layer,
- and a profile-driven agent workflow platform.

### 3.2 What V1 Explicitly Includes

- `pi` as the only supported agent runtime
- pi Agent Profiles
- pi extension-based guardrails
- tracker adapters
- local tracker CLI smoke surface
- runtime providers
- fresh runtime per attempt
- valid branch reuse when appropriate
- `.symphony/PROGRESS.md` as the handoff mechanism
- simple restart/retry behavior
- TypeScript implementation
- self-host-friendly architecture
- single-orchestrator deployment model
- current-Symphony-style operator surface

### 3.3 What V1 Explicitly Defers

The following are intentionally de-scoped for later:

- durable workflow engines
- persistent retry queues
- lease/heartbeat-based distributed orchestration
- exact resumability of in-flight runs
- runtime reuse after restart
- dirty workspace recovery
- standalone policy proxy service
- generic multi-agent runtime abstraction
- rich web control plane as a hard requirement
- database-backed authority as a hard requirement
- full enterprise RBAC / tenancy / approval systems
- replay of raw agent session logs as a continuity requirement

---

## 4. Locked V1 Decisions

These are considered locked unless later product learning forces a change.

### 4.1 First Tracker

- **Linear first** as the first real external tracker adapter
- A **local tracker adapter** is also required early as a first-class smoke-test surface
- Jira and GitHub Issues are deferred until after the first working adapter

### 4.2 First Runtime Provider

- **Docker Compose first**
- Kubernetes and Okteto come later

### 4.3 Tracker Mutation Style

- V1 uses **raw tracker tools** for mutations where appropriate
- Example: `linear_graphql`
- Guardrails inspect and govern these raw tool calls through pi extensions
- V1 does **not** require replacing raw tracker tools with higher-level custom write tools

### 4.4 Execution Tool Style

- Pi runs on the **control plane**, not inside the target runtime
- The built-in tool name `bash` should be preserved
- A pi extension overrides `bash` and proxies commands to the selected target runtime
- This keeps the tool in the model's familiar training distribution while letting execution happen remotely
- V1 does **not** require remote `read`, `write`, or `edit` tools

### 4.5 Branch Naming

- Issue branches use the **issue identifier itself** as the branch name
- Example: `LIN-123`

### 4.6 Branch Reuse Rule

- If a branch exists with the same issue identifier, it should be reused
- This reuse rule applies as long as the issue itself is not already in a finalized/terminal state

### 4.7 Invalid Branch / PR Handling

- If restart/retry logic determines a prior PR is stale/invalid, it should be **closed**
- If the issue is terminal/finalized, the orchestrator should not be attempting a new active run in the first place

### 4.8 Progress File Location

- The handoff file lives at:
  - `.symphony/PROGRESS.md`

### 4.9 Operator Surface

- V1 should target **parity with current Symphony**
- At minimum this implies:
  - structured logs,
  - operator-readable runtime status,
  - and a minimal status surface comparable to current Symphony’s operational posture
- A rich standalone SaaS-style web control plane is not required in v1
- A CLI-driven local tracker surface is part of the expected operator/testing experience

### 4.10 Deployment Model

- V1 assumes a **single orchestrator process** running on one machine/container
- Optional remote runtimes can be added later through runtime providers

### 4.11 Config Shape

- Prefer a shape **close to current Symphony**
- This means:
  - a repository-owned `WORKFLOW.md` remains a primary contract surface
  - machine-readable configuration should stay simple and near the repo
  - agent instructions should remain versioned with the codebase

---

## 5. Product Direction

This rebuild intentionally optimizes for:
- simplicity,
- pi-native extensibility,
- fast iteration,
- and a clean self-hostable OSS story.

It intentionally does **not** optimize for, in v1:
- durable workflow execution,
- exact recovery of in-flight work,
- complex distributed coordination,
- or full SaaS control-plane infrastructure.

The core bet is:
- `pi` already provides excellent primitives,
- custom behavior should live in pi profiles/extensions,
- runtime isolation matters more than runtime reuse,
- and restart/retry behavior can be simple in v1.

---

## 6. Core Decisions

### 6.1 Agent Runtime

- `pi` is the **native and only supported agent runtime** in v1.
- There is no generic multi-agent adapter abstraction in v1.
- Custom agents are implemented as **Agent Profiles** on top of `pi`.

### 6.2 Guardrails

- Guardrails are implemented as **pi extensions**.
- The primary enforcement hook is pi `tool_call` interception.
- Transition gates are enforced by intercepting tracker mutation tools before they execute.
- There is **no separate policy proxy layer** in v1.

### 6.3 Runtime Recovery

- Runtimes are **ephemeral**.
- On retry or restart, the system creates a **fresh runtime**.
- V1 does **not** attempt runtime reuse.

### 6.4 Progress Continuity

- Branches are the durable source of code progress.
- If a valid upstream branch already exists for an issue, a fresh runtime should check it out.
- Agents are expected to continuously maintain a committed `.symphony/PROGRESS.md` file for handoff.
- V1 does **not** depend on raw agent session log replay.

### 6.5 Workflow Durability

- V1 does **not** require a durable workflow engine.
- The orchestrator may keep active run state in memory.
- Restart behavior is best-effort and based on tracker state + branch state.
- Stronger workflow durability can be added later.

### 6.6 UI and Persistence Posture

- V1 does **not** require a dedicated web control plane.
- V1 does **not** require Postgres, SQLite, or Convex as a hard dependency.
- V1 may operate primarily from config files, tracker state, git state, and runtime/process state.
- Additional persistence and control-plane surfaces can be added later.

---

## 7. Goals and Non-Goals

### 7.1 Goals

- Orchestrate issue-driven work with a simple pi-native control plane.
- Support isolated full-stack dev environments.
- Support tracker-agnostic work fetching through adapters.
- Support specialized pi Agent Profiles.
- Support deterministic tracker transition gates through pi extensions.
- Support clean restart behavior through branch reuse and `.symphony/PROGRESS.md`.
- Be easy to self-host.
- Be easy to extend with TypeScript packages.

### 7.2 Non-Goals

- Recreating the exact OpenAI Symphony architecture.
- Designing a generic pluggable agent-runtime abstraction in v1.
- Building a standalone policy service in v1.
- Implementing durable workflow execution in v1.
- Resuming in-flight runtime state after crash.
- Preserving attempt-local workspace state across retries.
- Requiring a database-backed control plane in v1.
- Requiring a dedicated web dashboard in v1.

---

## 8. Design Principles

1. **Pi-native first**  
   Build around `pi`, not around speculative agent abstractions.

2. **Keep v1 operationally simple**  
   Fresh runtime, simple retry model, minimal orchestration assumptions.

3. **Profiles over platforms**  
   Most custom behavior should be expressed as pi Agent Profiles, not core orchestration features.

4. **Guardrails where the agent acts**  
   Enforce workflow policy through pi extension interception of tracker mutation tools.

5. **Branch state over workspace state**  
   Durable progress lives in git and tracker context, not in long-lived runtime state.

6. **Human-debuggable handoff**  
   `.symphony/PROGRESS.md` should be enough for a new agent or human to understand prior progress.

7. **Runtime isolation over runtime reuse**  
   Clean fresh environments are preferable to clever reuse in v1.

8. **Defer infrastructure until justified**  
   Databases, dashboards, durable workflow engines, and richer control planes should only be introduced when product needs justify them.

---

## 9. High-Level Architecture

### 9.1 Main Components

1. **Orchestrator**
   - polls tracker adapters
   - selects candidate work
   - dispatches runs
   - tracks active runs in memory
   - handles simple restart/retry behavior

2. **Run Worker**
   - provisions a fresh runtime
   - resolves the correct Agent Profile
   - selects the correct execution target
   - launches a control-plane pi session
   - streams events and collects outputs

3. **Pi Session Runner**
   - embeds `pi` through its SDK
   - loads prompts, tracker tools, and extensions from the chosen Agent Profile
   - overrides `bash` so commands are executed against the selected target runtime

4. **Target Executor**
   - routes proxied `bash` commands to the selected target runtime
   - reports target/runtime failures back to the control plane
   - supports different execution backends such as Docker Compose, Okteto, and Kubernetes

5. **Runtime Providers**
   - Docker Compose
   - Kubernetes
   - Okteto
   - future providers as needed

6. **Tracker Adapters**
   - Linear
   - Local tracker for smoke testing and development
   - Jira
   - GitHub Issues
   - future providers as needed

7. **Optional Operator Surface**
   - logs
   - CLI status
   - local tracker CLI
   - minimal status UI if desired

### 9.2 Simplified Shape

```text
Tracker Adapter --> Orchestrator --> Run Worker --> Runtime Provider
                                          |
                                          v
                                   Pi Session Runner
                                          |
                                          v
                                     Target Executor
                                          |
                                          v
                                    Selected Target Runtime

Pi session stays on the control plane.
The `bash` tool is overridden and proxied to the selected target runtime.
```

### 9.3 What Is Not in the Core V1 Architecture

The core v1 architecture does **not** require:
- a dedicated API server,
- a database,
- a workflow engine,
- or a separate policy proxy service.

A minimal status surface may exist for parity with current Symphony, but a rich standalone SaaS control plane is out of scope for v1.

---

## 10. Technology Direction

### 10.1 Language

**TypeScript** is the implementation language.

### 10.2 Runtime

**Node 22** is the recommended runtime for v1.

Rationale:
- maximum compatibility with `pi`,
- stable subprocess/process behavior,
- lower runtime risk for an OSS/self-hosted orchestration tool,
- boring and predictable deployment target.

### 10.3 Persistence Posture

V1 does not require a database.

Acceptable v1 sources of truth include:
- tracker state,
- git branch/PR state,
- `.symphony/PROGRESS.md`,
- pi session JSONL history,
- config files,
- filesystem logs,
- runtime provider state.

### 10.4 Future Persistence

Future versions may add:
- SQLite,
- Postgres,
- richer event stores,
- or a dedicated control plane.

These are explicitly later-phase concerns.

---

## 11. Canonical Concepts

### 11.1 Work Item

A normalized tracker item.

Fields may include:
- `provider`
- `externalId`
- `identifier`
- `title`
- `description`
- `state`
- `labels`
- `assignee`
- `url`
- `metadata`

### 11.2 Run

A run is one active orchestration of a work item.

Fields may include:
- `runId`
- `workItemId`
- `agentProfile`
- `runtimeProvider`
- `status`
- `attemptNumber`
- `startedAt`
- `updatedAt`

### 11.3 Runtime Instance

A fresh per-attempt dev environment.

Fields may include:
- `runtimeId`
- `provider`
- `workspacePath`
- `serviceEndpoints`
- `status`

### 11.4 Tracker Mutation Attempt

A tracker write attempted through a pi-visible tool.

Examples:
- issue transition
- comment update
- artifact attachment

### 11.5 Guardrail Decision

A result of extension-enforced workflow control.

Values:
- `allow`
- `block`
- `warn`

### 11.6 Validation Result

A structured validator result.

Fields may include:
- `validatorName`
- `status`
- `summary`
- `details`
- `artifacts`

---

## 12. Pi Agent Profiles

### 12.1 Definition

A custom agent is an **Agent Profile**.

An Agent Profile is:
- `pi`
- plus prompt configuration,
- plus tool configuration,
- plus skills,
- plus extensions,
- plus model defaults.

### 12.2 Example Profiles

- `implementation-agent`
- `review-agent`
- `qa-agent`
- `merge-agent`

### 12.3 Profile Responsibilities

A profile may define:
- system prompt additions or overrides,
- task prompt templates,
- active built-in tools,
- custom tools,
- disabled tools,
- skills,
- extensions/guardrails,
- model defaults,
- workflow-specific behavior.

### 12.4 Example

A `review-agent` might be:
- pi
- review-specific prompt
- read-mostly tool set
- PR/review tools
- review-specific skills
- extensions that block file edits and enforce review quality

### 12.5 Routing

The platform must support routing work items to profiles based on:
- tracker state/column,
- labels,
- issue type,
- project,
- or workflow config.

Example:
- tracker column `AgentReview` routes to `review-agent`.

---

## 13. Runtime Providers

### 13.1 Purpose

A runtime provider creates and manages the per-attempt execution environment.

This includes:
- repository checkout/worktree,
- app services,
- backend services,
- browser/test services if needed,
- and one or more target runtimes that can execute proxied commands from the control plane.

### 13.2 Initial Runtime Targets

- Docker Compose
- Kubernetes
- Okteto

### 13.3 Contract

Each runtime provider should support operations like:
- prepare
- start
- waitUntilReady
- selectTarget
- execOnTarget
- getEndpoints
- collectArtifacts
- stop
- destroy

The runtime provider does not have to host the pi agent loop. It must provide a target execution surface that the control-plane pi session can use.

### 13.4 Isolation Requirement

The agent should reason against stable in-environment service identities such as:
- `http://web:3000`
- `http://runtime:8787`
- `http://convex-backend:3210`

not host-randomized ports.

Even though the pi session runs on the control plane, its proxied `bash` execution should occur against the selected target runtime so the command semantics match the target environment.

### 13.5 Retry / Restart Rule

For v1:
- always create a fresh runtime for a new attempt,
- do not attempt to reuse stale runtime state,
- clean up stale envs opportunistically.

---

## 14. Tracker Adapters

### 14.1 Purpose

Tracker adapters normalize issue systems into work items and expose read/write operations.

### 14.2 Initial Targets

- Linear
- Local tracker
- Jira
- GitHub Issues

### 14.3 Contract

Each adapter should support:
- fetchCandidateWorkItems
- fetchWorkItemById
- fetchWorkItemsByState
- normalize
- applyMutation
- appendComment
- attachArtifact

The same contract must work for both:
1. tracker -> orchestrator reads
2. agent -> tracker writes

### 14.4 State Mapping

Each adapter should map provider states into canonical workflow concepts such as:
- `todo`
- `in_progress`
- `agent_review`
- `human_review`
- `rework`
- `merging`
- `done`
- `cancelled`

### 14.5 Local Tracker Requirement

The local tracker is a first-class adapter, not a throwaway mock.

It should closely match real tracker integration behavior in both directions:
1. **tracker -> orchestrator**
2. **agent -> tracker**

This means the orchestrator should be able to pull candidate work from the local tracker, and agent-facing tracker tools should be able to mutate that same local tracker surface.

### 14.6 Local Tracker CLI

The local tracker should be controllable from a CLI so developers can drive end-to-end scenarios without Linear.

Typical operations should include:
- create issue
- move issue state
- comment on issue
- attach artifact
- inspect issue
- reset/dump tracker state

---

## 15. Pi-Native Guardrails

### 15.1 Mechanism

Deterministic workflow control is implemented through **pi extensions attached to Agent Profiles**.

The same extension mechanism can also override the built-in `bash` tool so that shell commands are routed to the selected target runtime instead of executing locally on the control plane.

### 15.2 Primary Enforcement Hook

The preferred enforcement point is:
- pi `tool_call` interception

This allows an extension to:
- inspect a tracker mutation attempt,
- detect target-state transitions,
- run validation before the mutation occurs,
- block the mutation if validation fails,
- and return feedback to the agent in the same turn.

### 15.3 Raw Tool Governance

V1 explicitly supports governing **raw tracker tools**.

Example:
- `linear_graphql`

This means extensions may inspect raw GraphQL mutation shapes to determine whether a guarded transition is being attempted.

### 15.4 Example

An `implementation-agent` extension may enforce:
- the issue cannot move to `AgentReview` until the regression suite passes.

Flow:
1. agent attempts tracker transition to `AgentReview`,
2. extension intercepts the raw tracker mutation tool call,
3. extension inspects the mutation shape,
4. extension runs regression validators,
5. if validators fail, the tool call is blocked,
6. failure feedback is returned to the agent,
7. issue remains in its current active state.

### 15.5 Secondary Hooks

Useful secondary hooks include:
- `tool_result`
- `turn_end`
- `agent_end`

But these are secondary compared to `tool_call` for deterministic transition gating.

### 15.6 Explicit V1 Assumption

V1 assumes:
- tracker writes happen through pi-visible tools,
- `bash` remains the primary execution tool presented to the agent,
- and pi extensions can both govern tracker writes and override `bash` routing.

This assumption is intentional and exists to keep the architecture simple.

### 15.7 Local Tracker Parity

The same style of pi-visible tracker tools used for real trackers should also work against the local tracker.

This is required so that:
- orchestrator behavior can be smoke tested end-to-end,
- agent transition/comment behavior can be smoke tested end-to-end,
- and development can proceed without depending on Linear quality or availability.

---

## 16. Retry and Restart Model

### 16.1 Fresh Runtime Rule

Every retry or restart uses a **fresh runtime**.

### 16.2 Branch Reuse Rule

If a valid upstream branch already exists for the issue and is still relevant:
- check out that branch in the fresh runtime,
- and let the agent reason from current code state.

In v1, a practical validity rule is:
- a branch with the exact issue identifier exists,
- the issue is not terminal,
- and the associated PR is open or absent.

If no valid branch exists:
- start from the default branch,
- create a fresh issue branch,
- and proceed from scratch.

### 16.3 Invalid Branch Rule

If a prior branch/PR is clearly invalid for continuation, such as:
- merged,
- closed in a way that should not be resumed,
- or intentionally abandoned by workflow,

then the next attempt should start from a fresh branch and stale PRs should be closed.

### 16.4 Attempt-Local State

Attempt-local runtime state is disposable.

This includes:
- local process state,
- container state,
- temp files,
- uncommitted local workspace state.

### 16.5 Durable Handoff Context

The new agent should infer prior progress from durable external context such as:
- current branch contents,
- commit history,
- PR state,
- tracker notes/workpad,
- and `.symphony/PROGRESS.md`.

---

## 17. Progress Tracking and Handoff

### 17.1 V1 Handoff Mechanism

V1 uses a committed `.symphony/PROGRESS.md` file as the primary in-branch handoff mechanism.

### 17.2 Purpose

`.symphony/PROGRESS.md` should give a respawned agent enough context to understand:
- what was already done,
- what is currently broken,
- what remains,
- and what the next best step is.

### 17.3 Recommended Contents

`.symphony/PROGRESS.md` should include sections such as:
- issue / branch context,
- completed work,
- current plan,
- latest validation results,
- current blocker,
- next best step,
- important files.

### 17.4 Expected Behavior

Agent Profiles should instruct agents to:
- create `.symphony/PROGRESS.md` early,
- keep it up to date,
- update it after meaningful milestones,
- update it before handoff or review request,
- and commit it with relevant branch progress.

### 17.5 Non-Goal

V1 does not require raw session log replay or session-sidecar recovery.

---

## 18. V1 Reliability Posture

### 18.1 Active State Model

V1 may keep active orchestration state in memory.

### 18.2 Restart Behavior

On orchestrator restart:
1. reload config,
2. poll tracker for active work,
3. determine the right Agent Profile for each item,
4. create a fresh runtime,
5. check out an existing valid branch if present,
6. spawn a fresh pi session,
7. continue from branch + tracker + `.symphony/PROGRESS.md` context.

### 18.3 Guarantees Not Claimed in V1

V1 does not claim:
- exact resumability of in-flight attempts,
- exactly-once mutation execution,
- durable retry queue semantics,
- multi-instance leaderless coordination,
- or recovery of dirty local workspace state.

### 18.4 Future Hardening

Future versions may add:
- durable run records,
- persistent retry scheduling,
- leases and heartbeats,
- stronger audit semantics,
- multi-instance orchestration,
- richer operator surfaces.

---

## 19. Observability

V1 should make it possible to inspect:
- current run state,
- current runtime health,
- pi transcript and tool usage,
- guardrail block/allow decisions,
- validator outputs,
- tracker mutation attempts,
- branch/PR context,
- artifact links,
- and local tracker state when using the local tracker adapter.

Useful structured events include:
- `run.created`
- `runtime.ready`
- `agent.turn.started`
- `tracker.mutation.attempted`
- `guardrail.blocked`
- `guardrail.allowed`
- `validator.completed`
- `tracker.mutation.applied`
- `run.completed`
- `run.failed`

V1 may satisfy this through logs and filesystem outputs rather than a full database-backed observability system.

---

## 20. Configuration Strategy

### 20.1 Guiding Principle

Configuration should stay **close to current Symphony** and **close to the repository**.

### 20.2 Primary Workflow Contract

V1 should continue to use a repository-owned `WORKFLOW.md` as a primary contract surface.

That file should contain:
- machine-readable config in YAML front matter,
- plus human-readable agent instructions in Markdown.

### 20.3 Additional Config

If needed, additional config may live in:
- profile package manifests,
- runtime provider config files,
- tracker adapter config,
- orchestrator startup config.

But the main project workflow contract should remain simple and repo-local.

---

## 21. Self-Hosting Principle

The architecture should stay friendly to OSS and self-hosting.

That implies:
- avoiding hosted-only coordination primitives in the core,
- keeping the system deployable as standard app + worker + runtime infrastructure,
- and keeping extensions/profile packaging straightforward for third parties.

V1 should be able to exist without forcing users to adopt:
- a database,
- a hosted workflow engine,
- or a hosted control plane.

---

## 22. Suggested Package Layout

```text
packages/
  core/                 # orchestration engine and shared domain types
  pi-runner/            # pi session runner and profile loader
  tracker-linear/       # Linear adapter
  tracker-local/        # Local tracker adapter + CLI-backed smoke surface
  tracker-jira/         # Jira adapter
  tracker-github/       # GitHub Issues adapter
  runtime-docker/       # Docker Compose runtime provider
  runtime-k8s/          # Kubernetes runtime provider
  runtime-okteto/       # Okteto runtime provider
  validator-command/    # shared command-based validator helpers
profiles/
  implementation-agent/
  review-agent/
  qa-agent/
  merge-agent/
```

Optional later packages:
- `server/`
- `dashboard/`
- `storage/`
- `db/`

---

## 23. MVP Scope

The MVP should deliver:
- TypeScript core
- Node 22 runtime
- control-plane pi session runner
- Agent Profile routing
- `bash` override via pi extension
- target executor abstraction
- Docker Compose runtime provider
- Linear tracker adapter
- local tracker adapter
- local tracker CLI for end-to-end smoke testing
- raw-tool pi extension-based transition gating
- fresh-runtime retry model
- branch reuse when valid
- `.symphony/PROGRESS.md` handoff model
- current-Symphony-style operator surface
- filesystem/log-based observability

### 23.1 Early Slice Requirement

One of the earliest implementation slices should be:
- the local tracker adapter,
- the local tracker CLI,
- orchestrator polling from the local tracker,
- agent mutation of the same local tracker through pi-visible tracker tools,
- and the control-plane `bash` override routed into the selected target runtime.

This slice exists so the system can be smoke tested end-to-end early, without depending on Linear integration quality.

---

## 24. Summary

Symphony Rebuild V2 v1 is:
- Symphony-like in orchestration loop,
- pi-native in agent model,
- control-plane pi with target-proxied `bash`,
- Linear-first,
- Docker-Compose-first,
- profile-driven,
- raw-tool-guarded,
- smoke-testable through a first-class local tracker surface,
- and intentionally de-scoped in durability and control-plane complexity.

It is designed to validate the core product idea first:
- can a pi-native orchestration daemon reliably coordinate real tracked work across multiple environments and trackers with custom agent profiles and transition guardrails?
- and can that loop be exercised end-to-end locally through a tracker abstraction that matches both orchestrator reads and agent writes?

If yes, later versions can add:
- durable workflows,
- richer persistence,
- multi-instance coordination,
- and a stronger control plane.
