# Piphony Runtime Platform Abstraction

This document proposes the canonical runtime abstraction Piphony should converge toward.

It is intended to work for both:

- simple local setups
- org-standard Internal Development Platforms (IDPs)

Examples considered:

- local host execution
- local Docker Compose
- Okteto
- DevSpace
- DevPod
- Signadot
- org/self-hosted platform deployments
- external portal/catalog systems such as Backstage

---

## 1. The problem this abstraction solves

Piphony should be thought of as **work-definition driven**.

In the simple case, that work definition may be just one ticket.
In a larger org flow, it may be:

- PRD / feature request
- planner decomposition
- repo-scoped implementation slices
- implementation agents per slice
- end-to-end QA agent
- done

So the long-term workflow is not just:

- pick one repo
- run one agent in one shell
- stop

It is increasingly:

- prepare a shared workspace for the work definition
- attach one or more repos into that workspace
- run implementation work repo-by-repo
- validate end-to-end across the resulting stack
- tear the shared workspace down when the work is complete

At the same time, Piphony must still remain clean and simple for local use cases.

So the abstraction must scale both:

- **down** to a single-repo local runtime
- **up** to a multi-repo shared workspace on an org-standard IDP

---

## 2. Canonical model

The canonical model should be:

## A. Shared workspace lifecycle

A **workspace** is the environment prepared for the work definition.

Responsibilities:

- create or resolve the environment for the work definition
- deploy or ensure the shared stack
- expose stack-wide endpoints and shared runtime context
- own workspace-scoped teardown

Examples:

- local host: trivial local workspace
- Docker Compose: one compose project for the run
- Okteto: one namespace + full-stack deploy
- DevSpace: one namespace / deployed runtime context
- DevPod: one created workspace

## B. Repo attachment lifecycle

A **repo attachment** is how one repo participates in that shared workspace.

Responsibilities:

- attach the repo to the workspace
- provide one or more execution targets for that repo
- run implementation commands inside the attached runtime target
- detach the repo cleanly when that repo slice is done

Examples:

- local host: attach = repo on local machine
- Docker Compose: attach = execution target in runtime container/service
- Okteto: attach = `okteto up` for the repo
- DevSpace: attach = active dev session for the repo target
- DevPod: attach = repo-specific devcontainer context inside the workspace

---

## 3. Canonical rule

> Every work definition runs inside one prepared workspace.  
> Every repo implementation runs through a repo attachment into that workspace.

For simple use cases, the work definition may be just one ticket.
For larger flows, it may be a PRD or feature broken into multiple repo slices.

This is the one rule that should hold across both simple and complex setups.

---

## 4. Why this is the right abstraction

Because it separates two concepts that should not be conflated:

### Shared environment concerns

- namespace / cluster / deployment lifecycle
- shared endpoints
- stack readiness
- workspace-level cleanup

### Repo execution concerns

- dev container / shell target
- repo-specific attach/detach
- command execution target resolution
- repo-local runtime behavior

If these are collapsed into one generic `prepareEnv -> run -> tearDownEnv` lifecycle, the meaning becomes ambiguous.

For example, teardown would sometimes mean:

- detach one repo
- destroy the whole workspace
- maybe both

That is not a clean model.

---

## 5. Why it still works for simple use cases

This model is not only for enterprise platforms.

It also scales down cleanly.

### Host runtime

- workspace = trivial local machine context
- repo attachment = local repo working tree
- detach = no-op
- teardown = no-op

### Docker Compose

- workspace = compose project / shared stack
- repo attachment = runtime service execution target
- detach = usually no-op
- teardown = `docker compose down`

So simple setups are not forced into enterprise complexity.
They just use trivial implementations of the same model.

---

## 6. Which platforms fit this model well

Strong fit:

- Okteto
- DevSpace
- DevPod
- local Docker Compose
- local host execution

Partial or different fit:

- **Loft / vCluster**: useful as an infrastructure substrate, but usually one layer below the runtime platform. Teams would more likely run Okteto, DevSpace, or another runtime platform inside it.
- **Telepresence**: primarily a connectivity / traffic interception tool for local development against a remote cluster. It does not naturally provide shared workspace lifecycle + repo attachment lifecycle in the same way.
- **Garden**: primarily a deploy/build/test orchestrator with dependency graph awareness. It is closer to deployment automation than to repo dev-environment attachment.
- **Signadot**: primarily a preview environment / sandbox routing platform. It is closer to request-level isolation for testing than to ticket workspace provisioning plus repo dev-container attachment. It is also not a strong self-hosted OSS validation target for Piphony because the core control-plane/operator model is not open in the same way as DevSpace or DevPod.
- **Backstage**: portal/catalog/metadata platform, not a runtime platform.

So the point is not that these tools are unimportant.
The point is that they belong to different categories and should not distort the runtime abstraction.

---

## 7. What Piphony should treat as primary runtime platforms

Piphony's **primary** runtime abstraction should target workspace-oriented development platforms.

These are systems that can provide one or both of:

- a shared workspace lifecycle
- a repo attachment lifecycle

Examples:

- local host
- Docker Compose
- Okteto
- DevSpace
- DevPod

These belong in Piphony's core runtime platform architecture.

### Why this is the primary target

Because these platforms answer the core question Piphony must solve:

- where implementation agents execute
- how repos attach into that execution environment
- how shared endpoints are exposed for validation
- how the environment is cleaned up

This is the common denominator across both simple use cases and org-standard IDPs.

---

## 8. Secondary integration categories Piphony should keep separate

### Backstage

Backstage is a developer portal / software catalog.
It is not a runtime platform.

It may be useful as an external integration for:

- ownership metadata
- catalog lookups
- publishing workspace metadata

But it should not influence the runtime platform abstraction itself.

### Telepresence / Garden / Signadot style tools

These may be useful integrations later, but they should not redefine the primary runtime abstraction.

- Telepresence is about connectivity/interception.
- Garden is about deploy/build/test orchestration.
- Signadot is about preview sandboxes and request routing.

The key point is not that these tools are unrelated to developer workflows.
The key point is that they stress a different primitive than the one Piphony needs at its core.

### Important clarification on Signadot

Signadot can absolutely be relevant to AI-agent or developer workflows.
It is often discussed in the same broader IDP conversation as Okteto because both help teams validate changes against cloud-native systems.

But the primary pressure Signadot puts on architecture is:

- sandbox lifecycle
- selective service isolation
- request routing to changed variants
- in-context validation topology

That is different from the primary pressure of workspace-oriented platforms like Okteto, DevSpace, or DevPod, which is:

- where implementation agents execute
- how repos attach to that environment
- how shared endpoints are exposed

So the recommended stance is:

- **primary abstraction target** = workspace-oriented runtime platforms
- **secondary integration category** = sandbox / routing / validation-topology platforms like Signadot

Different tool category should mean different integration category.

---

## 9. Recommended extension ownership model

For org/self-hosted deployments, Piphony should separate ownership into three layers.

## A. Piphony core

Owns:

- runtime contracts
- orchestration
- tracker integration
- observability
- policy boundaries

## B. Org-scoped runtime extension

Owned by the org platform team.

Owns:

- platform-specific runtime behavior
- workspace creation and teardown
- stack deployment logic
- endpoint derivation
- attach/detach policy
- org runtime rules

This is where an org-standard Okteto or DevSpace integration should live.

## C. Repo-local thin config

Owned by each repo.

Owns:

- repo target identity
- minimal repo-specific hints
- attachment metadata only

Repos should not each reimplement org-wide infrastructure policy.

---

## 10. Recommended extension scope model

For self-hosted org deployments, project-local and user-local scopes are not enough.

Piphony should likely support a trusted scope conceptually equivalent to:

- **installation-scoped** or **org-scoped** extensions

That allows:

- central rollout
- stable versioning
- policy control
- security boundaries
- one canonical org integration across many repos

### Clarification

Installation-scoped extensions are **not** necessarily the default for simple Docker or Docker Compose use cases.

For simple setups, first-party local providers may still be perfectly fine.

Installation-scoped extensions matter when:

- an org wants one canonical runtime integration across many repos
- the platform team needs central control over rollout and policy
- repo-local config should stay thin and declarative

So the recommendation is:

- simple local runtimes do not require org-scoped distribution by default
- org-standard IDP integrations should strongly prefer it

---

## 11. Example: org-standard Okteto model

### Shared inputs

- one org-managed `okteto-manifest` repo for full-stack deploy
- repo-local config for repo-specific dev container attachment

### Piphony interpretation

#### Workspace lifecycle

- derive workspace identity
- create namespace
- deploy shared stack from `okteto-manifest`
- expose stack endpoints
- delete namespace when the whole work definition completes

#### Repo attachment lifecycle

- run `okteto up` from the target repo
- proxy execution into that repo dev container
- run `okteto down` when the repo slice completes or when cleanup requires it

This is the right separation of concerns.

---

## 12. Orchestration implication

The workspace lifecycle should be owned above individual implementation runs.

That means long-term Piphony orchestration should look like:

1. planner decomposes the work definition into repo slices
2. prepare shared workspace once
3. attach repos and run implementation slices
4. run end-to-end QA against workspace endpoints
5. tear workspace down once at the end

This is different from a purely per-run runtime lifecycle.

---

## 13. Concurrency and lifecycle recommendations

### Concurrent repo attachments

Concurrent repo attachments should be allowed when the runtime platform supports them.

For example, in an Okteto-style model, each implementation agent should be able to attach its own repo dev container into the shared namespace/workspace.

So the responsibility split should be:

- workspace lifecycle = ensure the shared environment exists and remains valid
- implementation agent lifecycle = own the repo attachment it needs for its slice

### Attachment duration

Repo attachments should stay alive at least until the slice is completed.

Follow-up work should be able to re-attach to a repo dev container when needed.
The durable state is the code / branch / PR, not the container itself.

So the canonical stance should be:

- attachments may be detached and recreated when needed
- re-attachment is normal
- workspace teardown is the real terminal boundary for the whole flow

---

## 14. Workspace identity in logs, artifacts, and UI

Recommended default:

Every run that participates in a shared workspace should record at least:

- runtime platform id
- workspace id
- repo attachment id (if applicable)
- primary workspace endpoints summary

Presentation guidance:

- the UI should primarily show **implementation agents / runs**, not raw attachments
- workspace identity should be visible as supporting operational context for those runs
- raw attachment identity is mainly for logs, events, and artifacts

Why:

- operators care first about which implementation agents are active
- they still need to know which shared environment a run belongs to
- multi-repo work becomes hard to debug without workspace identity
- this gives enough visibility without forcing platform-specific internals into the core model

---

## 15. OSS validation targets for this abstraction

If we want to validate this abstraction against real IDP-style systems, we should prefer OSS platforms we can actually stand up locally or in CI.

Recommended validation order:

### 1. Docker Compose

This remains the baseline validation target because:

- it is already native to Piphony
- it exercises shared workspace + repo execution cleanly
- it is easy to run locally and in CI

### 2. DevPod

This is the strongest next OSS validation target because:

- it is open source
- it is backend-agnostic
- it has a workspace-oriented model
- it is practical to validate without requiring a heavy hosted control plane

### 3. DevSpace

This is the strongest Kubernetes-oriented OSS validation target because:

- it is fully open source
- it has a strong dev-environment lifecycle model
- it lets us test the abstraction against a more complex remote runtime platform

### 4. Okteto

Okteto remains strategically important, especially for org-scale workflows, but it is a later validation target because:

- it is a stronger operational lift
- it is less convenient as a minimal local/CI validation target than DevPod or DevSpace

### Not recommended as the primary validation target

#### Signadot

Signadot is useful to understand as a platform category, but it is not the right primary validation target for this abstraction because:

- it is closer to preview/sandbox routing than to developer workspace attachment
- it is not a strong self-hosted OSS target in the same way as DevPod or DevSpace

So if we want a fixture project to validate the abstraction, the best sequence is:

1. Docker Compose
2. DevPod
3. DevSpace
4. Okteto

---

## 16. Design rules

### Rule 1: one canonical model

Do not invent separate runtime models for:

- local simple use cases
- enterprise IDP use cases

Use one model that scales down and up.

### Rule 2: do not conflate workspace and repo attachment

These are different concepts and should stay explicit.

### Rule 3: keep IDP specifics out of core

Piphony core should not absorb concepts like:

- Okteto manifests
- Kubernetes namespace policy
- DevSpace config semantics
- provider-specific deploy behavior

Those belong in org/platform runtime extensions.

### Rule 4: keep repo config thin

Repo-local runtime config should identify how the repo participates in the platform, not redefine the platform.

### Rule 5: keep non-runtime systems external

Catalog/portal systems like Backstage should remain external integrations, not runtime-platform abstractions.

---

## 17. Smallest API shape recommendation

The smallest API shape that still expresses the right model without making simple providers noisy should be:

- one runtime platform provider contract
- one workspace prepare/teardown pair
- one repo attach/detach pair
- repo attachment returns execution targets in the same style Piphony already understands

In other words, the core should not create many unrelated runtime extension categories.
It should expose one runtime platform capability with two explicit lifecycle layers:

1. workspace lifecycle
2. repo attachment lifecycle

Why this is the smallest useful shape:

- simple providers can implement trivial workspace and attachment behavior
- richer IDP providers can implement real shared workspace + repo attachment semantics
- the execution-target model can stay familiar instead of being reinvented

So the smallest meaningful API is not "one more flag on the current environment lifecycle."
It is one runtime platform interface that makes both lifecycle levels explicit while keeping the simple case lightweight.

---

## 18. Smallest core change needed

The smallest meaningful core change is:

1. move workspace preparation / teardown above individual implementation runs
2. make repo attachment an explicit lifecycle around implementation execution

In practical terms, that means:

- today: one run prepares one environment and tears it down
- target: one higher-level workflow prepares one shared workspace, while individual implementation runs attach into it

This does **not** require Piphony to solve every enterprise concern immediately.
It just means the core should stop assuming that environment lifecycle is owned entirely by one implementation run.

That is the smallest architectural step that points in the right direction.

---

## 19. Recommended target

Piphony should target this runtime abstraction:

- **shared workspace lifecycle**
- **repo attachment lifecycle**
- **org-scoped runtime extensions** for self-hosted IDP integrations
- **repo-local thin config** for repo participation
- **external integration boundary** for portal/catalog systems like Backstage
- **separate secondary integration category** for sandbox / routing / validation-topology systems like Signadot

That is the cleanest model that:

- supports simple local execution
- supports org-standard workspace-oriented IDPs
- supports multi-repo work definitions
- avoids muddy runtime semantics
- preserves strict, canonical architecture

---

## 20. Remaining open questions

1. Should installation-scoped extensions become a formal first-class scope?
2. Should repo attachments have any optional retention optimization beyond slice completion, or should re-attachment remain the normal expectation?
3. How much workspace identity should be shown directly in the UI versus remaining in run artifacts and logs behind implementation-agent views?
