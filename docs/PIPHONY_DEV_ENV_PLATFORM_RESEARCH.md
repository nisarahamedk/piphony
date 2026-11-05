# Piphony Dev Environment Platform Research

This note compares multiple developer-environment platforms against the proposed Piphony runtime direction.

The goal is to validate whether the abstraction should be shaped around:

- a shared workspace lifecycle
- a repo attachment lifecycle

This document stays at the architectural level.

---

## Platforms studied

Local reference repos inspected:

- `reference/okteto`
- `reference/devspace`
- `reference/telepresence`
- `reference/devpod`
- `reference/loft`
- `reference/garden`

---

## Platform-by-platform findings

### Okteto

**Fit:** strong fit for workspace + repo attachment

Operating model:

- namespace-scoped development environment
- full stack can be deployed into that namespace
- repo-specific `okteto up` attaches a dev container for the repo
- `okteto down` detaches it
- namespace deletion tears the whole ticket environment down

Piphony interpretation:

- workspace = ticket namespace + deployed stack
- repo attachment = repo dev container session

---

### DevSpace

**Fit:** strong fit for workspace + repo attachment

Operating model:

- Kubernetes-focused dev workflow with `devspace.yaml`
- deploys runtime resources and attaches dev containers / sync sessions
- supports dependencies and richer runtime configuration than Okteto
- lifecycle still breaks cleanly into shared environment + repo dev attachment

Piphony interpretation:

- workspace = namespace / deployed runtime context
- repo attachment = active dev mode session for the repo target

---

### DevPod

**Fit:** strong fit for workspace + repo attachment

Operating model:

- workspace abstraction over multiple backends
- repo development happens inside a devcontainer-backed workspace
- backend can vary, but the core user-facing model is still a workspace with an attached repo environment

Piphony interpretation:

- workspace = created DevPod workspace
- repo attachment = running repo-specific devcontainer context inside that workspace

---

### Loft / vCluster

**Fit:** partial fit, but it is a different layer

Operating model:

- virtual cluster / multi-tenancy platform
- more of an infrastructure substrate than a repo dev environment in itself
- teams could run Okteto or DevSpace inside it

Piphony interpretation:

- not the primary runtime abstraction
- better thought of as a cluster substrate under a runtime platform

---

### Telepresence

**Fit:** weak fit

Operating model:

- traffic interception between local development and a remote cluster
- does not primarily provide a ticket-scoped workspace lifecycle
- does not naturally map to full-stack namespace creation + repo attach/detach

Piphony interpretation:

- not a canonical runtime platform for this model
- if supported later, it would likely belong to a different extension category

---

### Garden

**Fit:** weak fit

Operating model:

- dependency-aware build / deploy / test orchestrator
- strong at deployment graph management
- not primarily a repo dev-container attachment platform

Piphony interpretation:

- not a canonical runtime platform
- if useful later, better treated as a deploy/build orchestration integration

---

## Cross-platform pattern

Across the platforms that are the closest fit for Piphony's long-term ticket workflow, the same structure keeps appearing:

### 1. Shared workspace lifecycle

A shared environment must exist for the ticket.

Responsibilities:

- create the shared environment
- deploy or ensure the stack
- expose stack-wide endpoints
- destroy the environment when the ticket flow is complete

### 2. Repo attachment lifecycle

Each participating repo needs its own attach/detach behavior.

Responsibilities:

- attach the repo into the existing workspace
- provide an execution target for implementation work
- detach the repo when that slice is complete

This pattern is the best fit for:

- Okteto
- DevSpace
- DevPod
- simple Docker Compose style local runtimes

---

## Recommended canonical Piphony abstraction

The runtime abstraction should be centered on:

1. **workspace lifecycle**
2. **repo attachment lifecycle**

That gives one model that scales both:

- down to simple local runtimes
- up to org-standard remote development platforms

### Why this is the right model

Because the long-term ticket workflow is not repo-run-centric.

It is:

- prepare workspace once per ticket
- attach one or more repos into that workspace
- implement per repo attachment
- validate end-to-end against the shared workspace
- tear workspace down once at the end

That is cleaner than overloading one environment lifecycle to mean both shared stack setup and repo-specific attach/detach.

---

## Which platforms do not fit the same abstraction

### Telepresence

Does not naturally fit the same model because it is primarily about connectivity/interception rather than workspace provisioning.

### Garden

Does not naturally fit the same model because it is primarily about deployment/test orchestration rather than repo dev environment attachment.

### Loft / vCluster

Useful as an underlying infrastructure substrate, but not the primary runtime abstraction itself.

---

## Recommended extension ownership model for self-hosted orgs

For org-scale self-hosted Piphony, the clean ownership model is:

### 1. Core runtime contracts in Piphony

Piphony core owns:

- workspace lifecycle contract
- repo attachment lifecycle contract
- orchestration ownership of the ticket workflow
- observability and policy boundaries

### 2. Org-scoped runtime extension

The org platform team owns:

- platform-specific runtime behavior
- namespace/workspace naming policy
- stack deployment behavior
- readiness checks
- endpoint derivation
- teardown policy

This is where an Okteto org integration should live.

### 3. Repo-local thin config

Each repo owns only:

- repo target identity
- minimal repo-specific runtime hints
- attachment metadata

Repos should not each reimplement org-wide infrastructure policy.

---

## Implication for extension scopes

Project-local and user-local scopes are not enough for the org-scale operating model.

Piphony should likely support a trusted scope conceptually equivalent to:

- **installation-scoped** or **org-scoped** extensions

That scope would let a self-hosted Piphony deployment centrally install trusted platform integrations.

---

## Main conclusion

The research supports the following conclusion:

- the correct long-term Piphony runtime model is **shared workspace + repo attachment**
- that model holds up across the strongest comparable platforms
- it still scales down to simple local runtimes
- not every dev tool belongs in that runtime abstraction
- org/self-hosted deployments need a clear **org-scoped extension ownership model**

---

## Open questions

1. Should installation-scoped extensions become a formal first-class scope in Piphony?
2. Should workspace identity be surfaced explicitly in logs, artifacts, and UI?
3. How should concurrent repo attachments against one ticket workspace be coordinated?
4. How restrictive should repo-local config be in a self-hosted deployment?
5. Should non-runtime tools like Telepresence or Garden be modeled as separate extension categories later?
