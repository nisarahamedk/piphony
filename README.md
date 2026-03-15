# Piphony

> AI Agent Orchestration Platform for autonomous coding workflows

Piphony is a TypeScript-based orchestration platform that coordinates AI agents (Pi coding agent) to perform autonomous coding tasks. It provides a local tracker, runtime management, smoke testing, and validation systems.

## Features

- **Local Tracker**: Issue tracking system with local persistence
- **Orchestrator**: Coordinates work items and run execution
- **Runtime Management**: Docker-based runtime provisioning
- **Validation Gate**: Automatic post-turn validation via Pi extension
- **Smoke Tests**: Automated runtime and UI validation
- **Web UI**: React-based dashboard for monitoring
- **Browser Extension**: Stack UI extension for browser integration

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
# Start web UI dev server
npm run web:dev

# Run all smoke tests
npm run smoke:all

# Run validation
npm run validate:main

# Start Stack extension dev server
npm run dev:stack

# Watch orchestrator
npm run orchestrator:watch

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
| `npm run dev:stack` | Start Stack extension dev server |
| `npm run status` | Show system status |
| `npm run tracker:local` | Local tracker CLI |
| `npm run orchestrator:watch` | Watch orchestrator mode |
| `npm run smoke:all` | Run all smoke tests |
| `npm run validate:main` | Run full validation suite |
| `npm run validate:deterministic` | Run deterministic validation |
| `npm run validate:live` | Run live validation |

## Smoke Tests

Smoke tests validate runtime behavior:

- `smoke:tracker-local` - Local tracker functionality
- `smoke:orchestrator` - Orchestrator coordination
- `smoke:pi` - Pi agent integration
- `smoke:local-e2e` - Local end-to-end workflow
- `smoke:web` - Web UI runtime
- `smoke:stack` / `smoke:extension` - Stack extension UI
- `smoke:docker` - Docker runtime provisioning
- `smoke:restart` - Service restart functionality
- `smoke:observability` - Logging and metrics
- `smoke:session-control` - Session management
- `smoke:cos` - Actor system
- `smoke:pull-based-workflow` - Pull-based workflow execution

## Validation Gate

The validation gate is a Pi extension (`.pi/extensions/`) that automatically runs validation after mutating turns:

1. Type checking
2. Unit tests
3. Runtime smoke tests

See `agent_stop_extension_spec.md` for details.

## Documentation

- [Production North Star](docs/PRODUCTION_NORTH_STAR.md) - Architecture standards
- [AGENTS.md](AGENTS.md) - Development guidelines

## License

Private - All rights reserved
