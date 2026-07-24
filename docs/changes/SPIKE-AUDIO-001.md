# Change specification: SPIKE-AUDIO-001 modern Electron audio capture

## Control

| Field           | Value                                    |
| --------------- | ---------------------------------------- |
| Backlog ID      | SPIKE-AUDIO-001                          |
| Requirement IDs | FR-AUDIO-001, 002, 003, 004              |
| Status          | in progress                              |
| Owner           | project maintainer                       |
| Target revision | `spike/SPIKE-AUDIO-001-electron-capture` |

## Outcome

Determine with executable evidence whether a supported Electron release can provide a
healthy, lifecycle-safe macOS system-audio stream while keeping microphone and system audio
separate. The result will determine whether the product keeps a pure Electron capture adapter
or introduces a native Swift helper.

## Confirmed facts

- Target hardware is Apple M2 arm64.
- Target OS is macOS 26.5.2 build 25F84.
- The inherited app uses Electron 33.2.1, which reached end of support on 2025-04-29.
- Electron enabled Apple's CoreAudio Tap path by default from Electron 39.
- Electron 43.2.0 is the current supported stable release as of 2026-07-24.
- The packaged app already contains `NSAudioCaptureUsageDescription`.
- A created audio track is insufficient evidence because a missing CoreAudio permission can
  yield a silent dead stream.

## Assumptions

- A deterministic locally played fixture is a valid first proof of system-audio capture.
- Zoom, Teams, and Meet evidence is a later phase gate and cannot be inferred from a local
  fixture.
- The existing unsigned identity is sufficient for a spike but not for stable TCC operations
  or distribution.

## Scope

- Upgrade the spike branch to a supported Electron version.
- Preserve microphone and system audio as separate channels.
- Add capture health metrics based on PCM frames, elapsed time, and signal energy.
- Detect silent/dead tracks instead of reporting capture success on track creation alone.
- Verify packaged arm64 launch on the target Mac.
- Record permission, lifecycle, route, and failure evidence.

## Non-goals

- Production STT or diarization.
- Zoom, Teams, and Meet certification.
- Signing, notarization, hardened runtime, or stable TCC identity.
- Final selection of a Swift helper before the Electron path is measured.
- Multi-speaker identity inference from a mixed stream.

## Architecture and affected boundaries

- Components: Electron main process, renderer capture adapter, AudioWorklet, packaged app.
- Trust boundaries: macOS TCC, Chromium capture implementation, renderer-to-main IPC.
- State transitions: idle -> requesting -> active/dead -> stopping -> idle.
- Data and retention: only aggregate health metrics; raw audio remains in memory and is not
  persisted.

## Alternatives considered

| Option                             | Benefits                               | Costs and risks                                             | Decision   |
| ---------------------------------- | -------------------------------------- | ----------------------------------------------------------- | ---------- |
| Keep Electron 33                   | No migration work                      | Unsupported and predates default CoreAudio Tap path         | Rejected   |
| Upgrade to Electron 43 and measure | Simplest supported architecture        | Chromium dead-stream behavior and limited diagnostics       | Test first |
| Implement Swift CoreAudio Tap now  | Native lifecycle and process selection | IPC, signing, packaging, and TCO before necessity is proven | Deferred   |
| Virtual audio driver               | Quick manual workaround                | User configuration and route fragility                      | Rejected   |

## Acceptance criteria

1. Electron and packaging dependencies are on supported versions and all quality gates pass.
2. A packaged arm64 application launches on the target Mac.
3. Microphone and system audio produce independently observable PCM health events.
4. Playing a deterministic fixture produces nonzero system-audio frames and energy.
5. With no system frames during an active fixture, the adapter reports `dead`, not `active`.
6. Stop prevents later PCM acceptance and releases all media tracks and audio nodes.
7. Ten repeated Start/Stop cycles complete without a duplicate stream or accepted late frame.
8. Permission denied and missing-track paths are explicit and testable.
9. The spike report separates proven behavior from untested Zoom/Teams/Meet scenarios.

## Failure modes

| Failure                                | Expected behavior                            | Test ID                      |
| -------------------------------------- | -------------------------------------------- | ---------------------------- |
| Microphone permission denied           | Microphone channel fails independently       | CT-CAPTURE-MIC-DENIED-001    |
| System-audio permission denied         | System channel reports permission failure    | CT-CAPTURE-SYSTEM-DENIED-001 |
| Audio track exists but emits no frames | Health state becomes `dead`                  | CT-CAPTURE-DEAD-001          |
| Stop races with media request          | Late stream is stopped and discarded         | CT-CAPTURE-STOP-RACE-001     |
| Duplicate async Start                  | One in-flight system capture request         | CT-CAPTURE-SINGLE-FLIGHT-001 |
| Audio route changes                    | Stream termination or recovery is observable | RT-MAC-ROUTE-001             |
| Chromium/Electron regression           | Package or fixture test fails                | RT-MAC-ELECTRON-001          |

## Test plan

| Level       | Test IDs               | Purpose                             |
| ----------- | ---------------------- | ----------------------------------- |
| Unit        | UT-CAPTURE-HEALTH-001  | Health and silence classification   |
| Property    | PT-AUDIO-BOUNDS-001    | Frame and energy bounds             |
| Mutation    | MT-AUDIO-HEALTH-001    | Assertion strength                  |
| Contract    | CT-CAPTURE-001         | Capture adapter lifecycle           |
| Integration | IT-CAPTURE-FIXTURE-001 | Renderer, worklet, IPC, and fixture |
| E2E         | E2E-CAPTURE-UI-001     | User-gesture start and stop         |
| Real device | RT-MAC-ELECTRON-001    | Packaged M2 capture                 |

## Security and privacy

- Inputs and trust: capture permission and media tracks originate outside application trust.
- Secrets: no provider credentials are needed for this spike.
- Provider/data boundary: no audio leaves the device.
- Logging and redaction: only state, counts, timing, format, and aggregate energy may be logged.

## Rollout

- Run only on the spike branch.
- Merge reusable health, test, and run infrastructure after evidence review.
- Accept an Electron adapter only through `ADR-AUDIO-001`.

## Rollback

- Revert the dependency migration and spike adapter changes.
- macOS permissions may remain associated with the existing bundle identifier and must be
  reset explicitly only when a test requires a fresh prompt.

## Verification evidence

- CI: pending.
- Coverage: 37 tests pass with 100% statements, branches, functions, and lines for the
  currently enforced scope.
- Mutation: 213/213 mutants killed; mutation score 100%.
- Performance: pending.
- Real device: packaged Electron 43.2.0 captures separate microphone and system PCM on the
  target M2. `BUG-AUDIO-001` regression creates exactly two worklets and closes both with zero
  post-Stop messages.
- Package: Electron 43.2.0 and electron-builder 26.15.3 produce an arm64 app containing the
  expected bundle identifier and audio-capture usage description.

## Residual risks and follow-up

- GitHub-hosted M1 packaging cannot prove M2/TCC behavior.
- Unsigned development builds can produce unstable permission identity.
- Mixed system audio does not itself identify 1-8 remote speakers.
- Bluetooth route, sleep/wake, and meeting-app behavior remain separate matrix dimensions.
- Four moderate dependency advisories remain; two are in the production dependency graph.
- Runtime instrumentation found and verified the fix for `BUG-AUDIO-001`: duplicate
  concurrent system-capture requests are coalesced by a generation-aware resource slot, and
  Stop disposes both live channels.
