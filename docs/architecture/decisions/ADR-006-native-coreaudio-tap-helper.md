# ADR-006: native CoreAudio Tap helper for meeting system audio

- Status: Accepted
- Date: 2026-07-28
- Backlog ID: `ADR-AUDIO-001`
- Completes: `ADR-002`

## Context

Meeting mode requires a dedicated system-audio channel on the target Mac without implicitly
requesting screen-recording permission. The feasibility spike produced these results:

- Electron `getDisplayMedia` required a screen-source path or failed the audio-only grant with
  `initialization-failed`.
- Legacy desktop-audio constraints still exercised ScreenCapture through `replayd`.
- A signed Swift helper using CoreAudio Process Tap captured nonzero Google Meet and Zoom PCM.
- The helper captured the active Sony output route even when it was not safe to infer the route
  from the macOS default device.
- Packaged lifecycle tests completed 100 Start/Stop cycles, and real-device Stop tests left no
  helper process.
- Google Meet signed-package acceptance produced system audio without a user-facing Screen
  Recording prompt.

Successful signal capture does not by itself prove release readiness. The current helper adds
native code, captures a global mix, has no parent-death channel, and is not included in the
JavaScript coverage gate.

## Options

| Option                             | Implementation complexity | Reliability and routing                                   | Security and privacy                                          | Operations and TCO                                       |
| ---------------------------------- | ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| Electron `getDisplayMedia`         | Low                       | Failed audio-only acceptance; weak route diagnostics      | Couples Meeting mode to screen-source permission              | Simple package, but unacceptable runtime behavior        |
| Swift ScreenCaptureKit helper      | High                      | Explicit native lifecycle                                 | Retains screen-capture permission semantics                   | Native IPC and packaging without solving least privilege |
| Swift CoreAudio Process Tap helper | Medium-high               | Meet and Zoom signal passed; active route is controllable | Audio-only boundary, but global-mix scope must be constrained | Native toolchain, signing, protocol, and test ownership  |
| Virtual audio device               | High                      | Can provide deterministic loopback                        | Adds a privileged external capture dependency                 | Installation, routing support, upgrades, and recovery    |

## Decision

Use a signed Swift CoreAudio Process Tap helper as the macOS implementation behind
`SystemAudioCapturePort`.

The decision accepts the backend architecture, not the complete meeting release matrix.

### Runtime boundary

1. Electron main process owns one `NativeSystemAudioCapture` adapter per active generation.
2. The adapter spawns only the helper shipped at the fixed application resource path.
3. The helper writes mono Float32 little-endian PCM to stdout.
4. The helper writes line-delimited JSON lifecycle metadata to stderr.
5. Main process validates the event schema and sample format, bounds pre-start bytes, resamples
   to 16 kHz PCM16, and applies the session acceptance gate before buffering.
6. Stop closes the generation, detaches callbacks, terminates the helper, and publishes final
   aggregate metrics.
7. Microphone capture remains a separate Electron media path with exact cue input selection.

### Permission boundary

- Meeting Start must not enumerate screen sources or call Electron display-media capture.
- ScreenCaptureKit is not an automatic fallback.
- A missing or denied audio permission produces an explicit system-channel error.
- Screen permission remains exclusive to a future explicitly invoked screen/coding feature.

### Mandatory release blockers

The backend must not be called release-ready until all of the following are complete:

1. `TEST-NATIVE-AUDIO-001`
   - extract testable Swift logic from the executable bootstrap;
   - inject CoreAudio operations, clock, writer, and termination sources;
   - enforce 100% line, statement, function, and branch coverage for project-owned Swift logic;
   - if the selected toolchain does not expose a statement metric, add a deterministic
     executable-region equivalent or present an exact policy exception for explicit owner
     approval; no automatic exclusion is allowed;
   - require 100% mutation score for extracted lifecycle, protocol, bounds, and cleanup logic, or
     present an exact tool limitation and replacement fault-injection gate for explicit owner
     approval;
   - add protocol, overflow, cleanup, partial-start, and CoreAudio failure tests.
2. `BUG-AUDIO-004`
   - provide a parent-liveness channel;
   - make helper exit and destroy tap/aggregate resources when Electron main exits or crashes;
   - prove the behavior in packaged E2E and target-Mac process tests.
3. `ADR-CAPTURE-SCOPE-001`
   - decide whether production capture is meeting-process allowlist, explicit application
     selection, or another bounded policy;
   - exclude cue-owned playback from the remote channel;
   - prevent unrelated system audio from being sent to STT without explicit user consent.
4. `TEST-AUDIO-002`
   - complete route switching, disconnect/reconnect, sleep/wake, and available meeting-app
     evidence;
   - keep Microsoft Teams unverified until a real conference is available.

No STT dispatch from the global system mix is accepted before `ADR-CAPTURE-SCOPE-001`.

## Consequences

### Positive

- Meeting capture no longer depends on screen-source enumeration.
- CoreAudio route and lifecycle failures are exposed through a narrow adapter contract.
- The implementation can follow active application output routes rather than only the default
  output device.
- Electron UI, session logic, transcription, and diarization remain independent from CoreAudio.
- A later helper replacement does not change `SystemAudioCapturePort`.

### Negative

- Swift, CoreAudio, process supervision, signing, and packaging become permanent owned
  components.
- CI requires both JavaScript and Swift coverage lanes plus target-Mac evidence.
- The helper protocol and binary compatibility require versioning before distribution.
- macOS changes can invalidate Process Tap behavior even when application code is unchanged.
- Global-mix capture is a privacy risk until the capture-scope decision is implemented.

## Operational rules

- Raw PCM remains memory-only and must not be logged or written to disk.
- Logs contain lifecycle state, typed errors, format, counts, and aggregate signal metrics only.
- The helper path, signature, bundle identity, and packaged presence are verified before release.
- Helper startup timeout, unexpected exit, invalid metadata, and output backpressure transition
  the system channel to an explicit error.
- Application shutdown, renderer crash handling, parent death, sleep/wake, and route change have
  deterministic cleanup or degradation evidence.

## Acceptance evidence

- `BUG-AUDIO-002` and `BUG-AUDIO-003`.
- `RT-MAC-MEET-SYSTEM-SIGNAL-001`.
- `RT-MAC-MEET-NO-SCREEN-TCC-001`.
- `RT-MAC-ZOOM-SYSTEM-SIGNAL-001`.
- `STRESS-CAPTURE-100-001`.
- Packaged E2E 7/7.
- Pull request quality run
  [30334000816](https://github.com/konstantin-fokhtberger/cue/actions/runs/30334000816).

## Revisit when

- A supported Electron release provides a tested audio-only API with equal permission, route,
  lifecycle, and observability behavior.
- macOS changes or deprecates CoreAudio Process Tap.
- A second operating system becomes an accepted release target.
- Meeting-process filtering cannot meet the supported Zoom/Meet/Teams scenarios.
