# Validation Gate Extension

An automatic post-turn validation gate for pi that prevents false "done" states.

## Overview

This extension automatically runs the canonical validation suite after any mutating coding turn. It prevents scenarios where static checks pass but the application is broken at runtime.

## How It Works

1. **Mutation Detection**: After each turn, the extension checks if the turn mutated project state (via `edit`, `write`, or mutating `bash` commands)

2. **Validation Execution**: If a mutating turn is detected, it runs the canonical validation suite in order:
   - `npm run typecheck`
   - `npm test`
   - `npm run smoke:web`
   - `npm run smoke:observability`
   - `npm run smoke:tracker-local`
   - `npm run smoke:session-control`

3. **Failure Handling**: If validation fails:
   - The failure is fed back to the agent automatically
   - The agent is instructed to fix the failures before claiming completion
   - Up to 3 auto-fix retries are allowed

4. **Success Handling**: If validation passes:
   - A success message is displayed
   - The retry counter is reset

## Disable Switch

The validation gate can be disabled by setting the environment variable:

```bash
export PIPHONY_VALIDATION_GATE=0
```

When disabled, the extension becomes a no-op.

## Retry Policy

- Maximum 3 auto-fix retries per user prompt/session branch
- After 3 failed attempts, the extension stops auto-repairing and notifies the human
- Retry state persists across session branches

## Expected Skips

Some smoke tests are environment-sensitive, particularly `smoke:session-control`. If a smoke returns structured JSON indicating an expected skip (`{"ok": true, "skipped": true, "reason": "..."}`), it's treated as a pass-with-skip rather than a failure.

## Artifact Locations

Validation logs are stored in:
- `.piphony/validation/<timestamp>/typecheck.log`
- `.piphony/validation/<timestamp>/test.log`
- `.piphony/validation/<timestamp>/smoke-web.log`
- etc.

A machine-readable summary is at:
- `.piphony/validation/<timestamp>/summary.json`

## Mutating Commands

The extension treats these bash patterns as mutating (V1 heuristic):
- Package installation: `npm install`, `yarn add`, `pnpm add`
- File operations: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git operations: `git checkout`, `git apply`, `git cherry-pick`, `git merge`, `git rebase`, `git reset`
- Redirections: `echo ... >`, `cat ... >`
- Permissions: `chmod`, `chown`
- HTTP mutating: `curl -X POST/PUT/DELETE/PATCH`

Non-mutating patterns (read-only):
- Search: `rg`, `find`, `ls`
- Git read: `git status`, `git log`
- Running tests: `npm test`

## Architecture

The extension is designed with clean separation:
- **Mutation detector**: Analyzes tool calls to determine if turn was mutating
- **Validation runner**: Executes validation commands in order
- **Result classifier**: Distinguishes failures from expected skips
- **Retry manager**: Handles bounded retry logic
- **Artifact writer**: Persists logs and summaries
- **Feedback formatter**: Creates structured messages for agent

## Installation

The extension is auto-discovered from `.pi/extensions/` in the project root. No additional configuration required.
