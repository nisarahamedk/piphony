# Piphony Backstage Architecture Fit

This note evaluates how Spotify's Backstage fits into Piphony's architecture from an org / self-hosted perspective.

It is intentionally high level.

---

## What Backstage is

Backstage is a developer portal and software catalog platform.

Its primary concerns are:

- software catalog / entity metadata
- ownership and discovery
- software templates / scaffolding
- documentation
- plugin-based integrations into external systems

Backstage is not primarily:

- a runtime platform
- a dev environment manager
- a ticket workspace provisioner
- a command execution target for implementation agents

---

## Core distinction from Piphony

Piphony's emerging runtime direction is about execution and orchestration:

- prepare a ticket-scoped workspace
- attach repos into that workspace
- run implementation work
- run end-to-end validation
- tear the workspace down

Backstage's core model is about metadata and discovery:

- what software exists
- who owns it
- how it is documented
- how teams discover and scaffold it

These are different layers.

---

## Architectural fit

Backstage does **not** change the recommended Piphony runtime abstraction.

The workspace + repo attachment model still looks correct.

Reason:

- Backstage does not challenge the runtime model because it does not operate at the same layer
- Backstage does not provide shared ticket workspaces or repo attachment lifecycles
- Backstage is orthogonal to dev environment platforms like Okteto, DevSpace, and DevPod

---

## Recommended Piphony stance

### 1. Do not treat Backstage as a runtime platform

Backstage should not be modeled as part of Piphony's runtime platform abstraction.

It is not the same category as:

- local Docker Compose
- Okteto
- DevSpace
- DevPod

### 2. Do not create a broad "plugin" umbrella just because Backstage is plugin-driven

Backstage's plugin system solves a different problem.

Piphony should avoid blurring:

- runtime execution
- catalog / metadata
- documentation
- scaffolding

### 3. Treat Backstage as an optional external integration

If Piphony integrates with Backstage, it should do so as an external system.

Possible examples:

- read ownership or entity metadata from Backstage
- register ticket workspaces or environments as Backstage resources
- link Piphony-managed runtime state back to catalog entities

Those are integration concerns, not core runtime concerns.

---

## What belongs where

### Backstage should own

- software catalog
- ownership / discovery
- software templates
- developer portal UX
- documentation aggregation

### Piphony should own

- ticket orchestration
- runtime workspace lifecycle
- repo attachment lifecycle
- implementation execution
- tracker-driven work coordination
- workspace teardown and operational state

---

## Self-hosted org view

For self-hosted org deployments:

- Backstage can be the portal where teams discover systems and metadata
- Piphony can be the execution/orchestration system that acts on tickets and prepares workspaces
- the two can be integrated, but they should remain separate architectural systems

In other words:

- Backstage = developer portal / metadata layer
- Piphony = execution control plane for ticket work

---

## Main conclusion

Backstage does not require a change to Piphony's runtime abstraction.

It reinforces the need to keep Piphony's boundaries clean:

- runtime platforms belong in the runtime/platform extension model
- catalog / portal concerns belong outside that model
- any Backstage integration should be explicit and external, not folded into the runtime abstraction

---

## Open questions

1. Should Piphony later support a small external integration surface for catalog systems like Backstage?
2. Should Piphony expose workspace metadata in a way that can optionally be published into a catalog?
3. Should repo ownership or system metadata from Backstage ever influence runtime policy, or should that remain entirely external?
