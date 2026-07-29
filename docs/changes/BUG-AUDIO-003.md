# Change specification: BUG-AUDIO-003 least-privilege meeting audio permission

## Control

| Field           | Value                                    |
| --------------- | ---------------------------------------- |
| Backlog ID      | BUG-AUDIO-003                            |
| Requirement IDs | FR-AUDIO-002, FR-CODE-001, FR-PRIV-006   |
| Status          | done                                     |
| Owner           | project maintainer                       |
| Target revision | `spike/SPIKE-AUDIO-001-electron-capture` |

## Outcome

Meeting capture obtains system audio on the target Mac without requesting screen-recording
permission. Screen permission remains lazy and exclusive to an explicitly invoked screen/coding
feature.

## Confirmed facts

- The original renderer called `getDisplayMedia({ video: true, audio: true })`, and the original
  main process enumerated and granted a screen source before discarding the video track.
- Electron rejected an audio-only display-media grant on macOS with
  `initialization-failed`; this path produced no system PCM.
- The legacy `getUserMedia` desktop-audio constraint also invoked `ScreenCapture` through
  `replayd` and did not resolve without screen permission.
- A narrow signed Swift CoreAudio Tap helper captures system audio without using Electron display
  media or enumerating screen sources.
- Google Meet with one participant on the Mac and one on a phone produced 247,441 nonzero system
  samples out of 391,168 through the signed package, with peak 29,521.
- After Stop and a five-second observation interval, capture state and metrics remained unchanged,
  and no native helper process remained.
- TCC recorded an allowed `kTCCServiceAudioCapture` request and only internal
  `kTCCServiceScreenCapture` preflight checks. It recorded no screen authorization request,
  `preflight=no`, or prompting transition for Meeting Start.

## Assumptions

- A future macOS/CoreAudio release may change process-tap or TCC behavior and therefore still
  requires a target-Mac release gate.
- Silently restoring screen capture is not an acceptable fallback.

## Scope

- Remove screen-source enumeration from Meeting mode.
- Grant only the CoreAudio loopback channel on macOS.
- Preserve the existing typed degraded state when the audio-only path is unavailable.
- Add automated policy, E2E failure, coverage, and mutation evidence.
- Verify the signed package against TCC logs and a live Google Meet.

## Non-goals

- Implement the screen/coding assistant.
- Ask for or reset screen-recording permission automatically.
- Enable the legacy ScreenCaptureKit fallback flag.
- Support Windows or Linux.

## Architecture and affected boundaries

- Components: main-process native-helper adapter, signed Swift helper, renderer capture status.
- Trust boundaries: Electron IPC, helper process protocol, macOS TCC, CoreAudio Tap.
- State transitions: meeting start -> audio-only system active/degraded -> stopped.
- Data and retention: PCM remains memory-only and is not persisted.

## Alternatives considered

| Option                                 | Benefits                              | Costs and risks                                  | Decision |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------ | -------- |
| Keep screen permission in Meeting mode | Already captures system audio         | Excess privilege and recurring user-facing alert | Rejected |
| Legacy desktop `getUserMedia`          | Small renderer-only change            | Still invokes `ScreenCapture`; probe hung        | Rejected |
| Electron audio-only display grant      | Minimal change, retains CoreAudio Tap | Rejected by Electron; no system PCM              | Rejected |
| Swift CoreAudio Tap helper             | Explicit native audio-only boundary   | Packaging, lifecycle, maintenance complexity     | Accepted |

## Acceptance criteria

1. Meeting Start does not enumerate screen sources.
2. Meeting Start does not create a screen authorization/non-preflight request or user prompt;
   CoreAudio-internal permission preflight is allowed.
3. A denied or absent screen permission does not block system audio.
4. Google Meet produces nonzero system PCM through the signed package.
5. Stop produces zero microphone and system callback delta after the bounded drain interval.
6. Screen permission is not added to onboarding or package instructions for Meeting mode.

## Failure modes

| Failure                              | Expected behavior              | Test ID                         |
| ------------------------------------ | ------------------------------ | ------------------------------- |
| Audio-only grant rejected            | Explicit system degraded state | E2E-SYSTEM-DEGRADED-001         |
| Screen source enumeration regresses  | Contract test fails            | CT-MEETING-NO-SCREEN-SOURCE-001 |
| Screen authorization request appears | Real-device acceptance fails   | RT-MAC-MEET-NO-SCREEN-TCC-001   |
| CoreAudio Tap returns silent stream  | Signal acceptance fails        | RT-MAC-MEET-SYSTEM-SIGNAL-001   |
| Stop leaks callbacks                 | Post-Stop delta remains zero   | RT-MAC-MEET-SYSTEM-STOP-001     |

## Test plan

| Level       | Test IDs                                                     | Purpose                       |
| ----------- | ------------------------------------------------------------ | ----------------------------- |
| Unit        | UT-NATIVE-SYSTEM-AUDIO-001                                   | helper protocol and lifecycle |
| Property    | PT-PCM-RESAMPLER-001                                         | chunk and rate combinations   |
| Mutation    | MT-NATIVE-SYSTEM-AUDIO-001                                   | assertion strength            |
| Contract    | CT-MEETING-NO-SCREEN-SOURCE-001                              | no desktop source enumeration |
| Integration | IT-PACKAGE-AUDIO-USAGE-001                                   | CoreAudio usage description   |
| E2E         | E2E-SYSTEM-DEGRADED-001                                      | explicit failure state        |
| Real device | RT-MAC-MEET-NO-SCREEN-TCC-001, RT-MAC-MEET-SYSTEM-SIGNAL-001 | permission and signal         |

## Security and privacy

- Inputs and trust: Electron media requests and TCC state are untrusted.
- Secrets: none.
- Provider/data boundary: provider dispatch remains disabled for acceptance.
- Logging and redaction: permission class, typed status, and aggregate signal metrics only.

## Rollout

- Keep the implementation in the draft spike PR until target-Mac TCC and Meet evidence pass.
- Do not restore screen capture as an automatic fallback.

## Rollback

- Revert the audio-only experiment while retaining this failing privacy requirement and evidence.

## Verification evidence

- CI: [Pull request quality run 30331220452](https://github.com/konstantin-fokhtberger/cue/actions/runs/30331220452)
  passed both `quality` and `package-macos-arm64`.
- Coverage: 100% statements, branches, functions, and lines across 173 tests.
- Mutation: 100% score, 1,029 killed and 4 timed-out mutants, 0 survivors.
- Performance: 2,292 PCM chunks during the accepted Meet interval; formal latency gate pending.
- Real device: Google Meet system signal, no-screen authorization, and five-second post-Stop
  invariants passed on the target Mac.
- Package: `com.cue.overlay`, Team ID `6VS347Y94Z`, designated requirement SHA-256
  `7860224d176c5e9c8edbfa97baacfbea5e8e571c9f224e265d7f5275c5848d7e`; packaged
  E2E passed 7/7 and strict codesign verification passed for the app and native helper.

## Residual risks and follow-up

- TCC cannot be fully automated on GitHub-hosted CI.
- A self-hosted target-Mac lane remains required for release-grade permission regression.
