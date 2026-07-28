# Architecture Decision Records

| ADR                                                | Status   | Decision                                                                       |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| [ADR-001](ADR-001-macos-only-first-release.md)     | Accepted | First release targets one macOS Apple Silicon environment                      |
| [ADR-002](ADR-002-audio-capture-spike.md)          | Accepted | Validate modern Electron capture before introducing a Swift helper             |
| [ADR-003](ADR-003-quality-gates.md)                | Accepted | Use coverage, mutation, traceability, and real-device gates together           |
| [ADR-004](ADR-004-javascript-quality-toolchain.md) | Accepted | Use Vitest, V8, Stryker, fast-check, Playwright, ESLint, Prettier, and checkJs |
| [ADR-005](ADR-005-audio-device-selection.md)       | Accepted | Select cue input/output independently and expose requested/effective devices   |
| [ADR-006](ADR-006-native-coreaudio-tap-helper.md)  | Accepted | Use a signed Swift CoreAudio Process Tap helper behind SystemAudioCapturePort  |

New material architecture decisions require an ADR before implementation.
