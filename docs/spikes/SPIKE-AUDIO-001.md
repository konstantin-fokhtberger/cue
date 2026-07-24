# SPIKE-AUDIO-001 evidence report

## Status

In progress.

## Decision question

Can supported Electron capture microphone and macOS system audio as separate, healthy streams
with sufficient lifecycle diagnostics for the Meeting Copilot, or is a native Swift helper
required?

## Environment

| Dimension          | Observed value                |
| ------------------ | ----------------------------- |
| Device             | MacBook Air 15-inch, Apple M2 |
| Architecture       | arm64                         |
| macOS              | 26.5.2                        |
| Build              | 25F84                         |
| Existing Electron  | 33.2.1, unsupported           |
| Candidate Electron | 43.2.0, installed             |
| Bundle ID          | `com.cue.overlay`             |
| Signing            | Disabled for spike            |

## Primary-source findings

1. Electron supports only the latest three stable major releases. Electron 33 is outside that
   window and reached end of support on 2025-04-29.
2. Electron 39 made Apple's CoreAudio Tap path the default for desktop audio capture on macOS
   14.2 and later.
3. `NSAudioCaptureUsageDescription` is mandatory. Without it, Electron can create a dead audio
   stream without warning.
4. Apple's CoreAudio Tap API can capture outgoing audio from a process or a group of processes
   and requires system-audio recording permission.
5. Electron's current `session.setDisplayMediaRequestHandler` documentation still describes
   string `loopback` as Windows-only, while its `desktopCapturer` macOS caveat documents the
   Chromium CoreAudio Tap path. This documentation mismatch is a risk that must be resolved by
   executable evidence.

## Sources

- [Electron release schedule](https://releases.electronjs.org/schedule)
- [Electron supported-version policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)
- [Electron 39 CoreAudio Tap change](https://www.electronjs.org/blog/electron-39-0)
- [Electron desktopCapturer macOS caveats](https://www.electronjs.org/docs/latest/api/desktop-capturer/)
- [Electron display-media handler](https://www.electronjs.org/docs/latest/api/session)
- [Apple CoreAudio Tap sample](https://developer.apple.com/documentation/CoreAudio/capturing-system-audio-with-core-audio-taps)

## Experiment matrix

| Experiment                       | Expected evidence                             | Status                     |
| -------------------------------- | --------------------------------------------- | -------------------------- |
| Supported Electron clean install | Locked dependency graph                       | passed                     |
| Local quality and package        | Green gates, arm64 `.app`                     | passed                     |
| Packaged launch                  | Stable process and bundle metadata            | passed                     |
| Microphone-only fixture          | Nonzero mic frames, zero system contamination | pending                    |
| System playback fixture          | Nonzero system frames and energy              | passed                     |
| Silence/dead stream              | Explicit `dead` state                         | pending                    |
| Ten Start/Stop cycles            | No late frames or leaked tracks               | pending                    |
| Permission denied                | Explicit channel-specific failure             | pending                    |
| Built-in output                  | Healthy system stream                         | pending                    |
| Bluetooth output                 | Route result recorded                         | pending                    |
| Zoom/Teams/Meet                  | Separate target-app matrix                    | deferred to TEST-AUDIO-002 |

## Evidence log

### 2026-07-24 - environment baseline

- `sw_vers`: macOS 26.5.2 build 25F84.
- `uname -m`: arm64.
- CPU: Apple M2.
- Packaged Info.plist contains `NSAudioCaptureUsageDescription`.
- Existing code reports success when the system track is created but does not prove that PCM
  frames arrive. This is insufficient because Electron documents silent dead streams.

### 2026-07-24 - supported Electron migration

- Installed Electron 43.2.0 and electron-builder 26.15.3 from a clean locked graph.
- Full dependency advisories decreased from 13, including high and critical, to 4 moderate.
- Production dependency audit still reports 2 moderate transitive advisories through
  `gaxios`/`uuid`.
- `npm run quality:full` passes with 31 tests, 100% structural coverage, and 184/184 mutants
  killed.
- `npm run pack` produces `dist/mac-arm64/cue.app`.
- `script/build_and_run.sh --verify` launches the packaged process successfully.
- The packaged bundle identifier is `com.cue.overlay` and its Info.plist contains
  `NSAudioCaptureUsageDescription`.
- No conclusion about microphone or system-audio capture is drawn from process launch.

### 2026-07-24 - PCM health model

- Added reusable PCM16 frame analysis for frame count, sample count, nonzero samples, energy,
  RMS, and peak.
- Added explicit `idle`, `waiting`, `dead`, `silent`, and `healthy` classifications.
- Dead classification requires both an expected signal and expiry of the observation deadline;
  ordinary quiet system audio is not mislabeled as dead.
- The model has 100% structural coverage, 500 property-based generated cases, and 51/51 killed
  mutants.

### 2026-07-24 - packaged runtime probe

- Attached Chromium runtime instrumentation to the packaged Electron 43 renderer without
  changing production capture code.
- One Start gesture created three AudioWorklet nodes; the intended topology is one microphone
  node and one system-audio node.
- Root cause: the click handler calls `startSystemAudio()` directly and the subsequent
  `capture:state` event calls it again. `sysStream` is assigned only after the asynchronous
  media request completes, so the current guard does not prevent duplicate in-flight starts.
- Recorded as `BUG-AUDIO-001`.
- After TCC permissions were granted, the original implementation produced separate,
  nonzero microphone and system PCM. Stop closed the microphone and only one of the two system
  contexts; the orphan accepted 2125 additional messages during a post-Stop fixture.

### 2026-07-24 - BUG-AUDIO-001 packaged regression

- Added a generation-aware single-flight resource slot and integrated the complete system
  resource lifecycle: stream, context, source node, and processor.
- Six focused tests cover concurrent Start, active Stop, Stop-during-Start, cross-generation
  ordering, active reuse, and creation retry.
- Full quality gates pass with 37 tests, 100% statements/branches/functions/lines, and 213/213
  killed mutants.
- One packaged Start created exactly two AudioWorklet nodes, not three. Before Stop both
  received 828 messages and 105984 PCM16 samples.
- The ambient channel measured RMS 156 with peak 1717. The synthesized system fixture channel
  measured RMS 3906 with peak 32767.
- Stop closed both AudioContexts. A second synthesized system fixture produced message deltas
  `[0, 0]`.
- The probe retained aggregate counters only; it did not persist or transmit raw audio.

## Preliminary conclusion

No architecture decision yet. The inherited Electron 33 path is rejected as evidence. Electron
43.2.0 passes dependency, quality, package, launch, separate live PCM, and single-cycle Stop
gates. The next experiments must cover microphone isolation, dead-stream detection, repeated
Start/Stop, permission denial, output routes, and target meeting applications.
