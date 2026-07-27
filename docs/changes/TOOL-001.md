# Change specification: TOOL-001 JavaScript quality toolchain

## Control

| Field           | Value                                    |
| --------------- | ---------------------------------------- |
| Backlog ID      | TOOL-001                                 |
| Requirement IDs | NFR-TEST-001, NFR-TEST-002, NFR-TEST-003 |
| Status          | verified                                 |
| Owner           | project maintainer                       |
| Target revision | `6607a8b`                                |

## Outcome

Create an executable quality baseline that rejects uncovered new core logic, weak critical assertions, lint/type errors, formatting drift, and high-severity production dependency advisories.

## Confirmed facts

- The project runs on Node 22.22.0 and npm 10.9.4.
- The inherited test suite contains three Node built-in tests.
- Runtime source is CommonJS JavaScript.
- The accepted release policy requires 100% structural coverage and 100% mutation score for critical modules.

## Assumptions

- Vitest and Stryker overhead is acceptable for this personal project.
- Full mutation testing may run outside the fastest pull-request lane.
- TypeScript migration is incremental and does not block the audio feasibility spike.

## Scope

- Vitest test runner.
- V8 structural coverage.
- Stryker mutation testing.
- fast-check property tests.
- ESLint flat configuration.
- Prettier check.
- TypeScript `checkJs`.
- Playwright Electron E2E.
- Package scripts and pinned dependencies.
- Migration of the existing profile-context tests.
- Explicit temporary legacy coverage baseline.

## Non-goals

- Refactoring runtime architecture.
- Fixing existing dependency advisories.
- Updating Electron or provider SDKs.
- Implementing audio capture.
- Adding GitHub Actions in this change.

## Architecture and affected boundaries

- Components: development toolchain and profile-context tests.
- Trust boundaries: no runtime boundary changes.
- State transitions: none.
- Data and retention: test fixtures contain no personal or secret data.

## Alternatives considered

| Option           | Benefits                                           | Costs and risks                               | Decision |
| ---------------- | -------------------------------------------------- | --------------------------------------------- | -------- |
| Node test runner | Minimal dependencies                               | No optimized Stryker integration              | Rejected |
| Vitest           | Integrated V8 coverage and official Stryker runner | Additional tooling dependencies               | Accepted |
| Jest             | Mature ecosystem                                   | Heavier and less aligned with incremental ESM | Rejected |

## Acceptance criteria

1. Existing behavior tests pass under Vitest.
2. The enforced module set passes 100% line, statement, function, and branch coverage per file.
3. `src/profile-context.js` reaches a 100% mutation score.
4. ESLint, Prettier, and TypeScript checks pass.
5. Production audit fails only for high or critical advisories.
6. Legacy exclusions are explicit, bounded, and expire before Meeting MVP.
7. No production runtime behavior changes.

## Failure modes

| Failure                        | Expected behavior               | Test ID         |
| ------------------------------ | ------------------------------- | --------------- |
| Uncovered branch in core       | Coverage command exits non-zero | CI-COVERAGE-001 |
| Surviving critical mutant      | Mutation command exits non-zero | CI-MUTATION-001 |
| Weak resume boundary assertion | Property or mutation test fails | MT-PROFILE-001  |
| High production advisory       | Production audit exits non-zero | CI-AUDIT-001    |

## Test plan

| Level       | Test IDs       | Purpose                                        |
| ----------- | -------------- | ---------------------------------------------- |
| Unit        | UT-PROFILE-001 | Preserve existing profile-context behavior     |
| Property    | PT-PROFILE-001 | Validate arbitrary context trimming and bounds |
| Mutation    | MT-PROFILE-001 | Prove assertions detect behavioral mutations   |
| Contract    | Not applicable | No runtime adapter change                      |
| Integration | Not applicable | No component integration change                |
| E2E         | Not applicable | No UI change                                   |
| Real device | Not applicable | No macOS behavior change                       |

## Security and privacy

- Development dependencies are pinned.
- Playwright E2E uses synthetic fixtures and an isolated temporary settings directory.
- No API key is required.
- Fixtures contain synthetic text only.
- Full and production-only audit results are reported separately.

## Rollout

- Merge after all TOOL-001 gates pass.
- CI-001 will invoke the same scripts without redefining policy.

## Rollback

- Revert TOOL-001 commit and restore `node --test`.

## Verification evidence

- CI: pending CI-001.
- Local full gate: `npm run quality:full` passed on Node 22.22.0.
- Tests: 11 Vitest tests passed, including 500 generated property cases.
- Coverage: 100% statements (7/7), branches (4/4), functions (1/1), and lines (6/6) for the enforced scope.
- Mutation: 18 of 18 mutants killed; mutation score 100%.
- Type checking: TypeScript 6.0.3 `checkJs` passed. TypeScript 7 was rejected after an observed Stryker 9.6 incompatibility.
- Lint and format: ESLint 10 and Prettier checks passed with zero warnings.
- Production dependency audit: no high or critical production advisories; two moderate transitive advisories remain.
- Full dependency audit: 13 advisories remain in inherited runtime/build dependencies, including Electron and electron-builder; remediation belongs to SPIKE-AUDIO-001.
- Performance: not applicable.
- Real device: not applicable.
- Package: `npm run pack` succeeded for macOS arm64; inherited warnings for ASAR, default icon, and unsigned packaging remain.

## Residual risks and follow-up

- Legacy runtime coverage debt remains until Phase 2.
- Electron and electron-builder advisories remain in SPIKE-AUDIO-001 scope.
- Tooling increases installation size and full audit advisory count.
