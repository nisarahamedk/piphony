# Piphony Handoff

This document is the starting point for the next session.

## Project root

- `/Users/nisar/Workspace/piphony`

## Primary spec / reference

- Spec: `doc/symphony_rebuild_v2_spec.md`
- Progress plan: `slice.md`
- Symphony reference: `reference/symphony/`
- Openclawsseum reference repo: `reference/openclawsseum/`

## Current product direction

Piphony is now explicitly **hosted-first** and **pull-based**:

- the **UI is a tracker client**, not a run launcher
- the **orchestrator polls** runnable tracker items, Symphony-style
- the **agent updates tracker state/comments** through tracker tools while it works
- the **control plane must not depend on repo toolchains**
- repo/toolchain execution belongs in runtime or repo-owned scripts
- no baked-in policy/guardrails in Piphony core; repo/user `.pi/extensions` are the governance surface

## What is implemented now

### Core / orchestration

Implemented in `src/`:

- SQLite-backed local tracker authority
- local tracker adapter
- pull-based orchestrator watch loop
- worker heartbeat persistence + reconciliation
- Symphony-aligned state model
- hosted-safe workflow loader/executor/runtime separation
- GitHub CLI wrapper tool
- Docker runtime + Openclawsseum smoke
- real feature-shipping smoke against GitHub-backed `reference/openclawsseum`

Key files:

- `src/core/orchestrator.ts`
- `src/core/types.ts`
- `src/tracker/local/state.ts`
- `src/tracker/local/adapter.ts`
- `src/tracker/local/status-sink.ts`
- `src/ui/worker.ts`
- `src/cli/orchestrator-watch.ts`
- `src/workflow/*`

### Local tracker state model

Canonical states now are:

- `backlog`
- `todo`
- `in_progress`
- `human_review`
- `rework`
- `merging`
- `done`
- `cancelled`

Runnable states:

- `todo`
- `in_progress`
- `rework`
- `merging`

Terminal states:

- `done`
- `cancelled`

### Built-in web UI

Implemented under `apps/web/`:

- TanStack Start app
- board view
- runs view
- local tracker data reads
- worker health visibility
- issue create/edit/transition
- browser smoke using `agent-browser`

Key files:

- `apps/web/src/features/dashboard/board-page.tsx`
- `apps/web/src/features/dashboard/runs-page.tsx`
- `apps/web/src/features/dashboard/shell.tsx`
- `apps/web/src/lib/models.ts`
- `apps/web/src/lib/server/functions.ts`
- `apps/web/src/lib/server/piphony-data.ts`
- `apps/web/src/styles.css`
- `src/smoke/web-ui.ts`

## Validation status

These were passing at the end of this session:

- `npm run typecheck:web`
- `npm test`
- `npm run build`
- `npm run smoke:web`
- `npm run smoke:tracker-local`
- `npm run smoke:orchestrator`
- `npm run smoke:observability`

The browser smoke proves:

1. create issue in UI
2. issue starts in `backlog`
3. transition issue to `todo`
4. separate orchestrator poller claims it
5. implementation agent appends tracker comments
6. issue lands in `human_review`
7. runs view shows transcript / run detail

## Important current user feedback

The user is happy with the **visual direction** of the UI after the latest pass.

However, the UI is still considered **not functional enough**.

### Meaning of “looks good visually, but not functional”

Be careful here: the issue is no longer mainly aesthetics.

The latest UI now looks closer to the desired Linear/Jira-like surface, but several pieces still behave like a prototype rather than a serious tracker client.

## Highest-priority next-session goal

Turn the UI from a visually good mock/prototype into a genuinely functional tracker + observability client.

## Most likely functional gaps to address next

These are the areas to inspect first.

### 1. Right rail still contains prototype/advisory content

In `apps/web/src/features/dashboard/board-page.tsx`:

- the “Global Observability” chat panel is still mostly static/advisory
- the “Agent Steering” panel is also static/advisory
- these panes look polished, but they are not yet meaningfully interactive

Likely next move:

- either replace them with truly useful live views
- or deliberately simplify/remove pseudo-chat behavior and make the rail clearly operational

A better functional right rail would emphasize:

- selected issue metadata
- state transitions
- comments timeline
- latest linked run
- worker claim/heartbeat for that issue
- validation / artifact pointers

### 2. Board behavior is still basic

The board currently supports:

- create issue
- select issue
- edit issue fields in the inspector
- transition issue via select/save

But it still does **not** feel like a real tracker board yet.

Likely improvements:

- make board cards denser and more informative
- add more reliable latest-run / claim / state cues on cards
- consider drag/drop or at least quicker workflow transitions if helpful
- make lane semantics clearer for backlog/todo/in_progress/human_review/rework

### 3. Observability should feel first-class, not bolted on

Runs view exists and works, but the product story is still split:

- board is tracker-ish
- right rail is partly faux conversational
- runs page is real observability

Need stronger integration between:

- issue
- current claim/worker
- latest run
- transcript
- comments / review handoff

### 4. Worker visibility should be more obviously useful

Worker heartbeats are persisted and displayed, but likely need better UX:

- more obvious stale/offline state
- stronger mapping from worker -> claimed issue -> current run
- better operator-grade language

### 5. UI should mimic Jira/Linear semantics more literally

Remember the desired long-term behavior:

- UI creates/edits/transitions issues
- orchestrator pulls from tracker
- agent updates tracker via tracker tools
- UI observes runs/comments/state

That means the UI should feel like a tracker first, not a chat app.

## Practical next-session plan

### Step 1 — Reassess current UI against functionality, not aesthetics

Start by reading:

- `apps/web/src/features/dashboard/board-page.tsx`
- `apps/web/src/features/dashboard/runs-page.tsx`
- `apps/web/src/features/dashboard/shell.tsx`
- `apps/web/src/lib/server/piphony-data.ts`
- `apps/web/src/lib/server/functions.ts`
- `src/smoke/web-ui.ts`

Then make a short list of exactly which UI parts are:

- real/live
- partially real
- static/prototype-only

### Step 2 — Decide whether to keep or remove faux chat panes

This is the most likely product cleanup.

If the “Global Observability” / “Agent Steering” surfaces are not becoming real immediately, replace them with operational panels such as:

- issue activity feed
- run summary / latest transcript snippet
- worker assignment / heartbeat block
- workflow help / valid next transitions

### Step 3 — Tighten issue inspector functionality

Make the issue detail panel feel like the real center of work:

- field editing
- comments
- branch / PR metadata
- linked run
- status change UX
- current worker / last run visibility

### Step 4 — Improve board and run linkage

For each issue card and issue detail, make it obvious:

- whether it has a current/last run
- whether a worker currently owns it
- what happened last
- what the human should do next

### Step 5 — Update browser smoke if UI semantics change

If the right rail or workflow affordances change, update:

- `src/smoke/web-ui.ts`

Keep the architectural invariant:

- no direct UI run spawn path
- smoke must remain tracker-transition -> poller claim -> agent tracker writes -> observed final state

## Commands worth using next session

### Core

- `npm run typecheck`
- `npm test`
- `npm run build`

### Web / local UX

- `npm run web:dev`
- `npm run orchestrator:watch`
- `npm run smoke:web`

### Additional smoke coverage

- `npm run smoke:tracker-local`
- `npm run smoke:orchestrator`
- `npm run smoke:observability`
- `npm run smoke:docker`

## Notes about the current repo state

- There is an experimental worktree/prototype directory:
  - `.piphony-var-utility-v3/`
- It was used as design inspiration for the recent UI pass.
- Treat it as a reference/prototype source, not canonical app code.

There are also multiple modified files in the repo from the broader slice 10–14 work. Do not assume the only remaining work is UI.

## Key architectural constraints to preserve

Do **not** regress these:

- keep orchestration **pull-based**
- keep UI as tracker/observability client only
- keep tracker as the source of truth
- keep agent-owned tracker writes via tracker tools
- keep hosted-safe control-plane/runtime boundary
- no backward-compat fallbacks needed
- prefer repo-owned scripts over generic stack assumptions

## Recommended opening prompt for the next session

Use something like:

> Read `doc/handoff.md`, `slice.md`, and the current web UI files under `apps/web/src/features/dashboard/`. The UI now looks close to the desired Linear/Jira-like surface, but it still feels functionally prototype-ish. Keep the current pull-based architecture intact and make the UI genuinely useful as a tracker + observability client rather than a polished mock. Revalidate with `npm test`, `npm run build`, and `npm run smoke:web`.
