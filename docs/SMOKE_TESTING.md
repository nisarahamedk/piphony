# Smoke Testing

Canonical repo-touching smoke pattern:

1. Clone a local reference repo into a temp directory.
2. Onboard that temp repo.
3. Run Piphony package code from the package root, but point managed-project behavior at the temp repo via explicit project-root configuration.
4. Write tracker state, runs, sessions, and artifacts inside the temp repo's `.piphony/`.
5. Clean up only the processes and temp paths created by the smoke itself.

Use:
- `src/fixtures/project.ts` for temp clone + onboarding
- `src/smoke/harness.ts` for shared control-plane web/stack process startup and readiness checks
- `npm run smoke:stack` as the canonical final smoke: provision the real OpenClawsseum runtime stack in a temp onboarded repo, run the implementation agent inside it, and tear it down (requires Docker). It must reuse the same project workflow/execution bootstrap as production surfaces like `dev:stack` and `orchestrator:watch`.
- `npm run smoke:extension-stack` for automated browser-extension coverage on top of the control-plane stack; it is part of the live smoke suite because it exercises the real extension + Chief of Staff flow.
- `npm run smoke:tracker-live:linear` / `npm run smoke:tracker-live:jira` for opt-in live external tracker checks when env is configured
- `docs/PRODUCTION_NORTH_STAR.md` as the source-of-truth architectural rule

Do not:
- use the Piphony repo itself as the managed project under test
- use broad process cleanup like `pkill` against shared dev commands
- mix package-root state with managed-project state in one smoke run
