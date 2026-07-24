# Temporary legacy coverage baseline

## Status

- Owner: project maintainer
- Accepted by: TOOL-001
- Created: 2026-07-24
- Expiry: completion of Phase 2, before Meeting MVP implementation can pass its release gate

## Why this exists

The inherited Electron implementation places platform APIs, mutable global state, IPC, provider SDKs, and UI behavior directly inside large runtime files. Claiming 100% meaningful automated coverage immediately would require shallow mocks that execute lines without validating macOS, concurrency, privacy, or provider behavior.

The transition therefore enforces 100% coverage on the already isolated profile-context module and every new `src/core/` module. Existing runtime files remain visible debt, not accepted quality.

## Temporary exclusions

| Paths            | Reason                                                                                     | Removal work                                                   |
| ---------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `main.js`        | Electron lifecycle, global mutable capture state, IPC, and provider calls are not isolated | Extract session, timeline, provider policy, and IPC validation |
| `preload.js`     | Bridge behavior needs an Electron contract harness                                         | Implement SEC-IPC-001 contract tests                           |
| `renderer/*.js`  | DOM and media APIs require browser/Electron harnesses                                      | Add Electron E2E and capture adapter boundaries                |
| `src/llm.js`     | Provider SDKs and streaming callbacks are directly constructed                             | Extract LLM port and provider contracts                        |
| `src/prompts.js` | Pure but currently coupled to the legacy transcript shape                                  | Move to core after session timeline contract                   |
| `src/screen.js`  | Electron desktop capture is constructed directly                                           | Add screen adapter contract                                    |
| `src/store.js`   | Filesystem and secrets are coupled                                                         | Replace secret storage with Keychain port                      |
| `src/stt.js`     | Provider routing and transport are coupled                                                 | Implement ARCH-PROVIDER-001 and STT contracts                  |
| `src/wav.js`     | Pure conversion helper lacks malformed-input contract                                      | Move to core with property and mutation tests                  |

`src/profile-context.js` is not excluded and must pass all configured gates.

## Guardrails

- No new business rule may be added to an excluded file without first extracting that rule to `src/core/`.
- A touched excluded file requires characterization tests for the changed behavior.
- Coverage exclusions cannot expand without a new ADR.
- The repository is not considered Meeting MVP releaseable while this file lists executable legacy exclusions.

## Compensating evidence during transition

- JavaScript syntax validation.
- Existing and new characterization tests.
- Security scan and dependency audit.
- Package build.
- Focused Electron and target-Mac tests as they become available.

These controls reduce risk but do not satisfy the final 100% release gate.
