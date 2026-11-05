# Piphony Okteto Org Extension Model

This note captures the current architectural recommendation for supporting an org-standard Okteto workflow in Piphony.

It is intentionally focused on the operating model and abstraction boundary, not implementation detail.

---

## Problem framing

The target org workflow is not just "run code inside an Okteto dev container."

It is a ticket-scoped workflow where:

- one ticket maps to one namespace / workspace
- the full stack is deployed for that ticket
- multiple repos may participate in the same ticket
- each repo attaches its own dev container into that shared ticket workspace
- implementation happens repo-by-repo
- end-to-end QA happens against the whole deployed stack
- teardown happens after the whole ticket flow finishes

That means Piphony should not model Okteto as only a repo-local execution target.

---

## Canonical concepts

There are two different runtime concepts here.

### 1. Ticket workspace

A shared environment for the ticket.

Responsibilities:

- derive workspace identity from the ticket
- create the namespace
- deploy the full stack
- expose stack-wide endpoints
- own ticket-level cleanup

Examples:

- `okteto namespace create <TICKET-ID>`
- deploy from the org's `okteto-manifest` repo
- expose frontend, gateway, webhook, and observability endpoints
- `okteto namespace delete <TICKET-ID>`

### 2. Repo attachment

A repo-specific attach/detach lifecycle into that shared ticket workspace.

Responsibilities:

- run `okteto up` from the target repo
- expose the repo's execution target / shell target
- proxy bash/tool execution into that repo dev container
- run `okteto down` for that repo attachment

This is what implementation agents consume.

---

## Why the current runtime model is not enough long-term

The current environment model in Piphony is effectively repo-run-centric:

- prepare env
- get execution target
- run worker
- tear env down

That works for simple local runtimes.

It becomes ambiguous for the Okteto org workflow because one lifecycle would be forced to mean both:

- shared workspace lifecycle
- repo-specific attach lifecycle

That ambiguity is not the right long-term model.

---

## Recommended runtime abstraction direction

Piphony should evolve toward a single runtime platform abstraction with two explicit lifecycle layers:

1. **workspace lifecycle**
2. **repo attachment lifecycle**

Conceptually:

- prepare workspace once per ticket
- attach one or more repos into that workspace
- run implementation per repo attachment
- run QA against workspace endpoints
- tear workspace down once the whole ticket flow is done

This abstraction should still scale down to simple setups:

- local host runtime -> trivial workspace + host repo attachment
- docker compose -> prepare workspace with compose up, attach repo to runtime service, tear workspace down with compose down
- okteto -> prepare namespace + deploy stack, attach repo via `okteto up`, detach via `okteto down`, delete namespace at the end

---

## Org ownership model

From a self-hosted org point of view, extensions should be managed in three layers.

### A. Piphony core

Owned by Piphony / platform maintainers.

Responsibilities:

- orchestration engine
- runtime extension API
- tracker API
- workspace / repo attachment lifecycle contracts
- observability
- policy enforcement

### B. Org platform extension

Owned by the org's platform / developer infrastructure team.

This is where the Okteto-specific org logic should live.

Responsibilities:

- namespace naming from ticket IDs
- deploying the shared stack from `okteto-manifest`
- stack readiness checks
- endpoint derivation
- attach/detach policy
- teardown policy
- org-specific context/cluster rules

This should be the canonical implementation of "how our org uses Okteto with Piphony."

### C. Repo-local thin config / extension

Owned by each repo.

This should stay thin and declarative.

Responsibilities:

- declare that the repo uses the org Okteto platform
- identify the repo's dev target / service
- provide repo-specific hints only
- avoid re-implementing org-wide platform logic

---

## Role of the shared `okteto-manifest` repo

The shared `okteto-manifest` repo should be treated as runtime data / deployment source, not as the extension itself.

It is the source of truth for:

- full-stack deployment topology
- shared services
- org-standard runtime wiring

The org extension should know how to use it.

The app repos should not each re-encode that logic.

---

## Recommended extension distribution model for self-hosting

Project-local and user-local extensions are not enough for this org-scale operating model.

For self-hosted infrastructure, Piphony should eventually support an additional trusted scope conceptually equivalent to:

- **installation-scoped** or **org-scoped** extensions

That scope would allow the self-hosted Piphony deployment to centrally install and version trusted platform integrations like the Okteto org extension.

Recommended trust model:

- org-scoped extension = trusted, centrally deployed
- repo-local extension/config = thin, declarative, limited in scope

This avoids every repo shipping its own heavy infrastructure logic.

---

## Canonical runtime flow for the org Okteto model

### 1. Planning

A planner agent breaks the ticket into implementation slices across repos.

### 2. Workspace prepare

The org Okteto extension:

- derives namespace from ticket ID
- creates namespace
- deploys the shared stack from `okteto-manifest`
- records stack endpoints

### 3. Repo implementation attachments

For each repo slice:

- resolve repo-local attach metadata
- attach repo to the existing ticket workspace
- run `okteto up` from that repo
- proxy tool/bash execution into that repo's dev container
- detach when the repo implementation is complete

### 4. End-to-end QA

A QA agent validates user journeys against the shared workspace endpoints.

### 5. Ticket teardown

The org extension:

- ensures repo attachments are cleaned up
- deletes the namespace
- records teardown result

---

## Design rules

### Rule 1: Do not make Piphony core understand Okteto details

Piphony core should not absorb concepts like:

- namespaces
- Kubernetes contexts
- sync internals
- Okteto manifests
- deploy command semantics

Those belong in the Okteto org extension.

### Rule 2: Do not let repo-local config own org-wide platform behavior

Repos should not each define:

- namespace policy
- deploy policy
- teardown policy
- cluster routing behavior

That belongs in the org extension.

### Rule 3: Keep shared workspace lifecycle separate from repo attachment lifecycle

Do not overload one lifecycle hook to sometimes mean:

- attach repo
- detach repo
- create namespace
- destroy namespace

Those are different operations and should stay explicit.

### Rule 4: QA should bind to the workspace, not to one repo attachment

Cross-stack validation is a workspace concern.

---

## What this means for Piphony long-term

To support this cleanly, Piphony likely needs:

1. a runtime platform model that can represent:
   - workspace lifecycle
   - repo attachment lifecycle
2. orchestration that owns the ticket workspace above individual implementation runs
3. support for centrally managed trusted org extensions in self-hosted deployments

The goal is one canonical system that works for both:

- simple local runtimes
- large org-standard remote development platforms like Okteto

---

## Open questions for review

1. Should org-scoped extensions be a formal first-class scope in Piphony?
2. How restrictive should repo-local config be in a self-hosted deployment?
3. Should workspace identity be surfaced explicitly in logs / artifacts / UI?
4. Should repo attachments always detach after each implementation run, or can they be retained until ticket completion?
5. How should concurrent repo implementations against the same ticket workspace be coordinated?
