# Piphony Extension System

This document describes the current canonical extension model at a high level.

It is intentionally brief.
If a detail is obvious from the code, it does not need to be repeated here.

## Source of truth

For an onboarded project, runtime behavior comes from extension source files loaded from:

- project-local `.piphony/extensions/`
- user-global `~/.piphony/extensions/`

Piphony no longer uses `.piphony/workflow.json` as the active runtime selection mechanism.

## What extensions define

Extensions may register:

- one environment provider
- one tracker provider
- zero or more transition hooks

The runtime is strict:

- exactly one environment provider must be active
- exactly one tracker provider must be active
- ambiguity is a hard error

## Lifecycle model

The canonical run lifecycle is:

1. load extensions
2. resolve the active environment provider
3. prepare the environment
4. resolve the execution target returned by that environment
5. run the worker in that target
6. run transition hooks where applicable
7. always tear the environment down

Environment lifecycle is owned by the environment provider, not by a separate workflow hook system.

## Onboarding

`npm run onboard` writes the repo-local extension scaffolding for the managed project.

That onboarding output is the project-level default runtime definition.

## Overrides

Project extensions are the default runtime source.

Executable surfaces may still apply explicit tracker-selection overrides at the edge when they intentionally support them.
Those overrides must be resolved explicitly and must never be silently ignored.

## Documentation rule

This file is the architectural summary.

Implementation details, helper APIs, and exact module structure should be read from the codebase directly.
