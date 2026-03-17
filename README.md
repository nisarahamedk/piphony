# Piphony

> AI Agent Orchestration Platform for autonomous coding workflows

Piphony is a TypeScript-based orchestration platform that coordinates AI agents (Pi coding agent) to perform autonomous coding tasks. It provides a local tracker, runtime management, smoke testing, and validation systems.

## Features

- **Repo Onboarding**: Canonical repo-local `.piphony/` project configuration via `npm run onboard`
- **Tracker Providers**: Local, Linear, and Jira providers normalized into one canonical internal work-item model
- **Orchestrator**: Coordinates work items and run execution
- **Runtime Management**: Docker-based runtime provisioning
- **Validation Gate**: Automatic post-turn validation via Pi extension
- **Smoke Tests**: Automated runtime and UI validation against onboarded temp fixture repos
- **Web UI**: React-based dashboard for monitoring
- **Browser Extension**: Real extension validation through the stack smoke

## Architecture

```
src/
├── cli/           # CLI commands
├── config/        # Configuration management
├── core/          # Core domain models
├── cos/           # Actor system
├── git/           # Git operations
├── observability/ # Logging and metrics
├── pi/            # Pi agent integration
├── runtime/       # Runtime provisioning (Docker)
├── stack/         # Stack extension worker
├── tracker/       # Local issue tracker
├── ui/            # UI components
├── validation/    # Validation runners
├── workflow/      # Workflow execution
└── smoke/         # Smoke test harness
```

## Getting Started

### Prerequisites

- Node.js 22+
- Docker (for runtime provisioning)
- pnpm (recommended) or npm

### Installation

```bash
npm install
```

### Development

```bash
# Onboard the checked-out repo (writes repo-local .piphony/ config)
npm run onboard

# List the canonical smoke suite
npm run smoke

# Run the full canonical smoke suite
npm run smoke:all

# Run the canonical final runtime-backed smoke
npm run smoke:stack

# Run the automated browser-extension control-plane smoke
npm run smoke:extension-stack

# Run validation
npm run validate:main

# Start the dev stack for an onboarded repo in the current directory
npm run dev:stack

# Start the dev stack against a temp onboarded OpenClawsseum fixture repo
npm run dev:stack -- --fixture openclawsseum
# or the convenience alias
npm run dev:stack:openclawsseum

# Watch orchestrator
npm run orchestrator:watch

# For onboarded repos, orchestrated runs always execute through repo-local .piphony/extensions/*.ts
# (prepare -> agent execution in the declared target -> teardown)

# Run local tracker CLI
npm run tracker:local
```

### Building

```bash
# Build all targets (core, web, extension)
npm run build

# Build individually
npm run build:core
npm run build:web
npm run build:extension
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build all targets |
| `npm run build:core` | Build core TypeScript |
| `npm run build:web` | Build web UI |
| `npm run build:extension` | Build browser extension |
| `npm run test` | Run unit tests |
| `npm run typecheck` | Type check all targets |
| `npm run web:dev` | Start web dev server |
| `npm run web:preview` | Preview built web UI |
| `npm run dev:stack` | Start the dev stack against the current onboarded repo, honoring that repo's workflow/execution target; or pass `-- --fixture openclawsseum` for a temp onboarded fixture |
| `npm run dev:stack:openclawsseum` | Start the dev stack against a temp onboarded OpenClawsseum fixture repo |
| `npm run onboard` | Write canonical repo-local `.piphony/` project config |
| `npm run status` | Show system status |
| `npm run tracker:local` | Local tracker CLI |
| `npm run orchestrator:watch` | Watch orchestrator mode |
| `npm run smoke` | List canonical smoke entrypoints |
| `npm run smoke:all` | Run the canonical smoke suite |
| `npm run smoke:stack` | Run the canonical final runtime-backed OpenClawsseum smoke |
| `npm run smoke:extension-stack` | Run the automated browser-extension + Chief of Staff control-plane smoke |
| `npm run smoke:tracker-live:linear` | Opt-in live Linear provider validation |
| `npm run smoke:tracker-live:jira` | Opt-in live Jira provider validation |
| `npm run validate:main` | Run full validation suite |
| `npm run validate:deterministic` | Run deterministic validation |
| `npm run validate:live` | Run live validation |
| `npm run smoke:pull-based-workflow` | Pull-based workflow execution |
| `npm run ship:openclawsseum` | Ship OpenClawsseum feature |

## Smoke Tests

Smoke tests validate runtime behavior.

Canonical rule:
- repo-touching smoke tests run against **onboarded temp fixture repos**, not the Piphony repo itself
- `smoke:stack` is the **canonical final runtime-backed smoke**

Core smoke entrypoints:
- `smoke:tracker-local` - Local tracker functionality
- `smoke:orchestrator` - Orchestrator coordination
- `smoke:pi` - Pi agent integration
- `smoke:local-e2e` - Local end-to-end workflow
- `smoke:web` - Web UI runtime
- `smoke:stack` - Temp clone + onboard + create TODO issue + provision real OpenClawsseum runtime + run implementation agent + transition to human review + tear down (requires Docker)
- `smoke:restart` - Service restart functionality
- `smoke:observability` - Logging and metrics
- `smoke:session-control` - Session management
- `smoke:cos` - Actor system
- `smoke:pull-based-workflow` - Pull-based workflow execution

Live control-plane / extension smoke:
- `smoke:extension-stack` - Piphony dev stack + real browser extension against a temp repo fixture

Opt-in live tracker provider checks:
- `smoke:tracker-live:linear` - Runs only when Linear creds + team/project selection are configured
- `smoke:tracker-live:jira` - Runs only when Jira creds + project selection are configured

## Validation Gate

The validation gate is a Pi extension (`.pi/extensions/`) that automatically runs validation after mutating turns:

1. Type checking
2. Unit tests
3. Runtime smoke tests
4. Opt-in live Linear/Jira tracker checks when the required env is configured

Live tracker provider checks are only added to the validation lane when their provider credentials and default project/team selection are present. They do not silently fall back to the local tracker.

See `agent_stop_extension_spec.md` for details.

## Documentation

- [Production North Star](docs/PRODUCTION_NORTH_STAR.md) - Architecture standards
- [AGENTS.md](AGENTS.md) - Development guidelines

## License

Private - All rights reserved
