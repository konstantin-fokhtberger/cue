# ADR-003: combined quality gates

- Status: Proposed
- Date: 2026-07-24

## Context

The user requires complete automated testing and considers user-discovered defects evidence of an inadequate test system. Structural coverage alone cannot demonstrate correct assertions, concurrency behavior, provider contracts, or real macOS capture behavior.

## Decision

Use all of the following as release gates:

1. 100% requirement automation for accepted P0/P1 requirements.
2. 100% line, statement, function, and branch coverage for project-owned production logic.
3. 100% mutation score for critical domain modules.
4. Contract tests for every platform and provider adapter.
5. Integration and Electron E2E tests.
6. Automated real-device tests on the target Mac where macOS APIs are involved.
7. Security, dependency, signing, and packaging verification.

## Exclusions

An exclusion requires:

- exact file and lines;
- why deterministic automation is not technically possible;
- compensating evidence;
- named owner;
- expiry or review date.

Generated files and third-party dependencies are outside project-owned coverage. Platform glue is not excluded by default.

## Consequences

- Architecture must isolate platform effects behind testable ports.
- CI will take longer and may require a self-hosted target-Mac runner.
- Some low-value glue may need refactoring solely to become deterministic.
- 100% coverage remains necessary but is not treated as proof that no defects exist.

