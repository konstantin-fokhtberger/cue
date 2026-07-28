# Change specification: TEST-NATIVE-AUDIO-001 native helper quality gate

## Control

| Field           | Value                                    |
| --------------- | ---------------------------------------- |
| Backlog ID      | TEST-NATIVE-AUDIO-001                    |
| Requirement IDs | NFR-TEST-001, NFR-TEST-002, FR-AUDIO-002 |
| Status          | blocked                                  |
| Owner           | project maintainer                       |
| Target revision | `spike/SPIKE-AUDIO-001-electron-capture` |

## Outcome

The project can change the native audio helper without relying on manual confidence: deterministic
Swift logic, failure paths, bounds, protocol output, and cleanup are executable under a mandatory
coverage and mutation gate.

## Confirmed facts

- At the start of this change, the production helper was one 401-line `main.swift` file compiled
  directly with `swiftc`.
- At the start of this change, no Swift package, Swift unit tests, Swift structural coverage, or
  Swift mutation gate existed.
- JavaScript coverage does not instrument the helper and cannot be described as whole-product
  coverage.
- SwiftPM supports coverage instrumentation, but the current LLVM report does not provide a
  distinct source-language statement metric automatically.
- CoreAudio/TCC behavior still requires packaged and target-Mac evidence even after structural
  coverage passes.

## Assumptions

- The GitHub macOS arm64 runner has the repository-selected Swift toolchain and `llvm-cov`.
- Acceptance of a deterministic reviewed mutation manifest and the exact structural coverage
  boundary remains an explicit owner decision.

## Scope

- Introduce a SwiftPM package for the helper.
- Extract protocol, format, buffer-bound, lifecycle, and cleanup behavior into testable modules.
- Inject platform operations, event writing, and termination waiting.
- Add Swift unit and failure-path tests.
- Enforce 100% line, function, branch, and executable-region coverage for the declared
  project-owned Swift logic scope.
- Add a deterministic source mutation gate with an explicit mutation manifest and 100% required
  score.
- Run the Swift gates in GitHub Actions before packaging.

## Non-goals

- Implement application-scoped capture from `AUDIO-CAPTURE-SCOPE-001`.
- Implement the parent-liveness protocol from `BUG-AUDIO-004`.
- Replace packaged CoreAudio/TCC or real-device acceptance with unit tests.
- Claim structural coverage for Apple frameworks or generated SwiftPM code.

## Architecture and affected boundaries

- Components: Swift core module, CoreAudio platform adapter, executable bootstrap, build tooling,
  GitHub Actions.
- Trust boundaries: CoreAudio return values, stdout PCM, stderr JSON events, termination signal.
- State transitions: idle -> partial start -> active -> stopped/error.
- Data and retention: PCM remains memory-only and is never added to test artifacts.

## Alternatives considered

| Option                                   | Benefits                                  | Costs and risks                                        | Decision |
| ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------ | -------- |
| Test the monolithic executable only      | Small source change                       | Cannot deterministically cover failures or cleanup     | Rejected |
| Adopt a young third-party Swift mutator  | Generic mutation operators                | New supply-chain dependency and unstable CI behavior   | Deferred |
| Reviewed deterministic mutation manifest | No runtime dependency; exact reproducible | Manifest must evolve with critical production behavior | Accepted |

## Acceptance criteria

1. `swift test` passes for the helper package.
2. The Swift structural gate reports 100% lines, functions, instantiations, and executable regions
   for the declared production-logic scope; branch-equivalent evidence is supplied by condition
   and lifecycle mutants because Swift/LLVM emits zero native branch records.
3. Partial-start failures destroy every previously acquired resource exactly once in reverse
   order.
4. Stop is idempotent and cannot destroy unknown resources.
5. Protocol events are deterministic, newline-delimited, and contain no raw PCM.
6. Pending PCM output is bounded and overflow does not corrupt accounting.
7. Every declared lifecycle, protocol, bounds, and cleanup mutant is killed; mutation score is
   100%.
8. The release helper still builds, packages, signs, and passes packaged E2E.

## Failure modes

| Failure                              | Expected behavior                              | Test ID                    |
| ------------------------------------ | ---------------------------------------------- | -------------------------- |
| Tap creation fails                   | Typed error; no cleanup of unknown resources   | UT-SWIFT-PARTIAL-START-001 |
| Aggregate or IO creation fails       | Reverse cleanup of acquired resources          | UT-SWIFT-PARTIAL-START-002 |
| Unsupported tap format               | Typed error and tap cleanup                    | UT-SWIFT-FORMAT-001        |
| Writer backlog exceeds limit         | Payload rejected; accounting remains bounded   | UT-SWIFT-BOUNDS-001        |
| Event encoding fails                 | Error exit path and deterministic cleanup      | UT-SWIFT-PROTOCOL-001      |
| Weak assertion permits a code mutant | Swift mutation gate fails and names the mutant | CI-SWIFT-MUTATION-001      |

## Test plan

| Level       | Test IDs                                                        | Purpose                           |
| ----------- | --------------------------------------------------------------- | --------------------------------- |
| Unit        | UT-SWIFT-FORMAT-001, UT-SWIFT-BOUNDS-001, UT-SWIFT-PROTOCOL-001 | Pure helper policy                |
| Property    | PT-SWIFT-BOUNDS-001                                             | Bounded accounting sequences      |
| Mutation    | CI-SWIFT-MUTATION-001                                           | Assertion strength                |
| Contract    | CT-SWIFT-COREAUDIO-PORT-001                                     | Injected platform operation order |
| Integration | CI-SWIFT-COVERAGE-001, IT-PACKAGE-AUDIO-USAGE-001               | Coverage and package contract     |
| E2E         | E2E-NATIVE-AUDIO-001                                            | Packaged helper lifecycle         |
| Real device | RT-MAC-MEET-SYSTEM-SIGNAL-001                                   | CoreAudio/TCC behavior            |

## Security and privacy

- Inputs and trust: CoreAudio metadata and termination events are untrusted.
- Secrets: none.
- Provider/data boundary: no provider dispatch is introduced.
- Logging and redaction: tests use synthetic samples and typed metadata only.

## Rollout

- Land the test architecture in the existing draft PR.
- Keep `TEST-NATIVE-AUDIO-001` open until GitHub-hosted Swift gates pass and the owner explicitly
  accepts or rejects the documented CoreAudio binding/bootstrap structural-coverage boundary.

## Rollback

- Revert the SwiftPM/test architecture and keep the release blocker open. Do not replace it with a
  JavaScript-only coverage claim.

## Verification evidence

- CI: [Pull request quality run 30353488390](https://github.com/konstantin-fokhtberger/cue/actions/runs/30353488390)
  passed `quality`, the native Swift structural/mutation step, packaging, and packaged E2E.
- Coverage: `CueAudioTapCore` reports 246/246 lines, 32/32 functions, 33/33 instantiations, and
  86/86 executable regions. Swift/LLVM reports zero branch records.
- Mutation: 38/38 deterministic lifecycle, format, buffer, metrics, protocol, and cleanup mutants
  compiled and were killed; 0 survived; 0 unviable; score 100%.
- Performance: no production-path benchmark change expected.
- Real device: post-refactor CoreAudio probe captured 573,440 PCM bytes, 143,360 samples, 72,979
  nonzero samples, peak 0.1767, and exited cleanly after SIGTERM.
- Package: ad-hoc `com.cue.overlay` package passed strict signing verification and packaged E2E
  7/7, including 100 Start/Stop cycles.

## Residual risks and follow-up

- Structural tests cannot prove CoreAudio/TCC behavior on future macOS builds.
- The mutation manifest is intentionally explicit, so new critical logic requires new reviewed
  mutants.
- SwiftPM test coverage does not link the executable `CoreAudioTapPlatform` and signal bootstrap
  into the test binary. Their happy path is covered by the live CoreAudio probe and package tests,
  but they do not have 100% structural failure-path coverage. Closing this as an explicit platform
  exception requires owner approval; without that approval this backlog item remains blocked.
