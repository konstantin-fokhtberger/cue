# ADR-004: JavaScript quality toolchain

- Status: Accepted
- Date: 2026-07-24
- Amended: 2026-07-27 - Playwright Electron E2E

## Context

The repository is a CommonJS Electron application with three Node built-in tests and no coverage, mutation, lint, format, property-test, or type-check gate. The accepted quality strategy requires structural coverage, mutation testing, property-based testing, adapter contracts, and deterministic CI.

The first toolchain must work on Node 22, preserve the current CommonJS runtime, and support an incremental move toward pure domain modules without forcing an application rewrite.

## Options

| Option                                 | Advantages                                                                   | Limitations                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Node test runner and built-in coverage | Minimal dependencies and migration                                           | No optimized official Stryker runner; fewer integrated testing facilities |
| Vitest and V8 coverage                 | Strong CommonJS/ESM support, native coverage thresholds, Stryker integration | Adds Vite/Vitest dependency layer                                         |
| Jest                                   | Mature ecosystem and Stryker support                                         | Heavier configuration and less attractive incremental ESM path            |

## Decision

Use:

- Vitest 4 for unit, contract, integration, and property-based tests.
- V8 coverage with 100% line, statement, function, and branch thresholds per file.
- StrykerJS with the Vitest runner and a 100% break threshold for critical modules.
- fast-check for property and model-based testing.
- ESLint 10 flat configuration.
- Prettier for deterministic formatting.
- TypeScript `checkJs` immediately for the enforced module set, followed by incremental TypeScript migration for new domain code.
- Playwright 1.62 for Electron renderer and packaged-application E2E on macOS.

Versions are pinned in `package-lock.json`.
TypeScript is pinned to 6.0.3 because the tested Stryker 9.6 preprocessor is incompatible with TypeScript 7.

## Transitional coverage boundary

The current platform-heavy monolith cannot honestly meet the accepted release gate without first extracting deterministic boundaries. The initial enforced set is:

- `src/profile-context.js`;
- all new files under `src/core/`.

Temporary legacy exclusions are recorded in `docs/quality/LEGACY_COVERAGE_BASELINE.md`. They expire before the Meeting MVP release gate and do not permit new uncovered behavior in excluded files.

## Consequences

- New core code cannot merge below 100% structural coverage.
- Critical core modules cannot merge below 100% mutation score.
- Legacy runtime behavior must be characterized and extracted incrementally.
- Mutation testing runs separately because it is more expensive than the normal pull-request gate.
- Browser and macOS behavior still require E2E and real-device gates.
- E2E fixtures must use isolated temporary `userData`, synthetic media, and no test-only
  preload or production IPC command.
