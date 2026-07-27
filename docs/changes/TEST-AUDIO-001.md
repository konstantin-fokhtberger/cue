# Change specification: TEST-AUDIO-001 capture adapter contracts

## Control

| Field           | Value                                      |
| --------------- | ------------------------------------------ |
| Backlog ID      | TEST-AUDIO-001                             |
| Requirement IDs | FR-AUDIO-001, 004, 005; FR-SESSION-002-004 |
| Status          | in progress                                |
| Owner           | project maintainer                         |
| Target revision | `spike/SPIKE-AUDIO-001-electron-capture`   |

## Outcome

Microphone and system audio use the same deterministic, channel-scoped capture contract.
Project-owned lifecycle and failure behavior can be tested without macOS permissions, real
devices, or Electron globals.

## Confirmed facts

- The inherited renderer implemented microphone and system capture as separate mutable blocks.
- `BUG-AUDIO-001` initially added generation-safe ownership only to system capture.
- The extracted adapter now gives both channels the same generation-safe lifecycle.
- The main-process PCM arrays are currently unbounded.
- The temporary legacy baseline requires new renderer business rules to be extracted into
  covered `src/core/` modules.

## Assumptions

- Web media APIs can remain thin injected dependencies around a project-owned adapter.
- A fake Web Audio graph is sufficient for lifecycle and channel-routing contract tests.
- Real CoreAudio, TCC, and output-route behavior still require packaged target-Mac evidence.

## Scope

- Extract a reusable browser PCM capture adapter for microphone and system channels.
- Inject stream creation, Web Audio constructors, and PCM sinks.
- Give both channels generation-safe Start/Stop and partial-start cleanup.
- Add deterministic contract fixtures for graph wiring, PCM routing, permission denial,
  missing tracks, duplicate Start, and Stop races.
- Add a bounded PCM buffer with deterministic overflow policy as a following slice.
- Exercise the real Electron renderer boundary with deterministic microphone and system-audio
  fixtures, including duplicate renderer Start requests.
- Require a 100-cycle Start/Stop stress gate and late-resolution race gate in both source and
  packaged E2E runs.

## Non-goals

- Meeting-application certification.
- TCC dialog automation.
- Device route switching or sleep/wake recovery.
- STT transport, diarization, or transcript state.
- Final Electron-versus-Swift decision.

## Architecture and affected boundaries

- Components: renderer media glue, browser PCM capture adapter, async resource slot, PCM buffer.
- Trust boundaries: browser media promises, external MediaStreams, AudioWorklet messages, IPC.
- State transitions: idle -> starting -> active -> stopping -> idle/error.
- Data and retention: raw PCM remains memory-only and is never logged or persisted.

## Alternatives considered

| Option                                 | Benefits                         | Costs and risks                               | Decision |
| -------------------------------------- | -------------------------------- | --------------------------------------------- | -------- |
| Keep two renderer implementations      | No refactor                      | Divergent races and weak automated evidence   | Rejected |
| Mock the entire renderer file          | Exercises legacy lines           | Brittle DOM coupling and low behavioral value | Rejected |
| Inject browser APIs into one core port | Deterministic contract and reuse | Small adapter abstraction                     | Accepted |
| Implement a native Swift adapter now   | Native lifecycle control         | Premature IPC, signing, packaging, and TCO    | Deferred |

## Acceptance criteria

1. Microphone and system instances forward PCM only to their configured channel sink.
2. Concurrent Start calls create one media resource.
3. Stop disposes active streams, nodes, worklets, sinks, and contexts exactly once.
4. Stop during media creation disposes the late resource and does not publish it.
5. Permission denial reports a channel-scoped typed error and leaves the adapter idle.
6. A stream without audio tracks fails explicitly and releases all tracks.
7. Failure during Web Audio initialization releases every resource created so far.
8. Deterministic fake fixtures validate the complete Web Audio connection graph.
9. The bounded-buffer slice never exceeds its accepted byte limit under arbitrary frames.
10. Packaged microphone/system capture and the Bluetooth lifecycle regression remain green.
11. One renderer Start transition creates exactly one microphone graph and one system graph,
    even when UI and main-process state notifications request Start concurrently.
12. One hundred sequential renderer Start/Stop cycles close every graph, stop every fixture
    track, emit no PCM after Stop, and make no provider network request.
13. If Stop wins while microphone and system media requests are pending, all late streams and
    partial graphs are disposed and cannot publish post-Stop PCM.
14. A deterministic initialization failure releases partial resources and a following Start
    can create a healthy graph without relaunching the application.

## Failure modes

| Failure                           | Expected behavior                         | Test ID                      |
| --------------------------------- | ----------------------------------------- | ---------------------------- |
| Duplicate Start                   | One media request and one graph           | CT-CAPTURE-DOUBLE-START-001  |
| Stop during permission request    | Late stream is disposed                   | CT-CAPTURE-STOP-RACE-001     |
| Microphone permission denied      | Typed microphone error                    | CT-CAPTURE-MIC-DENIED-001    |
| System permission denied          | Typed system error                        | CT-CAPTURE-SYSTEM-DENIED-001 |
| Stream has no audio track         | Explicit error and full disposal          | CT-CAPTURE-NO-TRACK-001      |
| AudioWorklet initialization fails | Partial graph is fully disposed           | CT-CAPTURE-INIT-FAIL-001     |
| PCM arrives on each channel       | Configured sink receives the exact buffer | CT-CAPTURE-CHANNELS-001      |
| Buffer exceeds byte limit         | Oldest complete data is dropped           | PT-AUDIO-BOUNDS-001          |
| Renderer requests Start twice     | One graph exists per channel              | E2E-CAPTURE-UI-001           |
| One hundred Start/Stop cycles     | No graph, track, or PCM leak              | STRESS-CAPTURE-100-001       |
| Stop wins two pending requests    | Late resources are disposed               | E2E-CAPTURE-STOP-RACE-001    |
| Initialization fails then retries | Retry succeeds without stale ownership    | E2E-CAPTURE-RECOVERY-001     |

## Test plan

| Level       | Test IDs                                         | Purpose                      |
| ----------- | ------------------------------------------------ | ---------------------------- |
| Unit        | UT-CAPTURE-ERROR-001, UT-PCM-BUFFER-001          | Errors and buffer operations |
| Property    | PT-CAPTURE-SEQUENCE-001, PT-AUDIO-BOUNDS-001     | Ordering and memory bounds   |
| Mutation    | MT-CAPTURE-ADAPTER-001, MT-AUDIO-001             | Assertion strength           |
| Contract    | CT-CAPTURE-DOUBLE-START-001 through CHANNELS-001 | Browser adapter behavior     |
| Integration | IT-CAPTURE-FIXTURE-001                           | Worklet-to-channel routing   |
| E2E         | E2E-CAPTURE-UI-001, STOP-RACE-001, RECOVERY-001  | Renderer lifecycle           |
| Stress      | STRESS-CAPTURE-100-001                           | Repeated leak-free lifecycle |
| Real device | RT-MAC-MIC-001, RT-MAC-STOP-001                  | Target-Mac regression        |

The automated stress fixture is deliberately independent of the currently selected macOS
input/output route. Each completed cycle must have exactly two created and closed audio
contexts, two disconnected worklet nodes, and three stopped tracks: microphone audio, system
audio, and the display video track discarded by the system-audio adapter. The fixture must
observe zero provider requests and zero PCM callbacks after the cycle has reached Stop.

## Security and privacy

- Inputs and trust: streams and worklet payloads are untrusted browser results.
- Secrets: none.
- Provider/data boundary: no provider calls are introduced.
- Logging and redaction: errors may include channel and code, never PCM or track content.

## Rollout

- Land as incremental covered slices on the draft spike branch.
- Keep the legacy renderer as thin dependency wiring only.

## Rollback

- Revert adapter wiring while retaining the independent tests and spike evidence for diagnosis.

## Verification evidence

- CI: [Pull request quality run 30114466885](https://github.com/konstantin-fokhtberger/cue/actions/runs/30114466885)
  passed (`quality` and `package-macos-arm64`) for the adapter slice.
- Coverage: 56 tests pass; statements 196/196, branches 81/81, functions 46/46, and lines
  191/191.
- Mutation: 307/307 mutants killed; mutation score 100%.
- Current enforced suite: 140 tests pass; statements 413/413, branches 229/229, functions
  89/89, and lines 405/405.
- Current mutation gate: 814/814 mutants killed; mutation score 100%.
- Performance: pending.
- Contract: nine deterministic adapter tests cover graph wiring, exact channel routing,
  duplicate Start, active Stop, Stop-during-Start, typed permission denial, missing tracks,
  and partial initialization failure.
- Buffer: a 60-second, 1,920,000-byte limit per PCM16 mono channel retains newest audio and
  reports exact overflow bytes/events. Five hundred property-based sequences match the
  reference model.
- Acceptance: criteria 1-10 pass for the implemented adapter and buffer slices.
- Real device: Bluetooth ten-cycle baseline passed before extraction. After extraction, two
  packaged cycles retained `.Sony (Bluetooth)` and `System audio` labels, closed all four
  contexts, and produced post-Stop deltas `[0, 0]`.
- Package: Electron 43.2.0 arm64 directory package completes with the extracted adapter.
- Buffer integration runtime: both IPC channels received 187 frames and 23936 samples in a
  packaged cycle; both contexts closed and post-Stop deltas were `[0, 0]`.
- Property lifecycle: 500 generated sequences of up to 100 Start, duplicate Start, failed
  Start, late Start/Stop, and Stop operations preserve single ownership and dispose every
  created resource exactly once.
- Source and packaged Electron E2E: all six scenarios pass, including local route diagnostics,
  duplicate renderer Start coalescing, Stop-before-resolution cleanup, initialization-failure
  recovery, and the 100-cycle stress gate.
- Stress lifecycle: 100 microphone opens and 100 system opens create and close exactly 200
  AudioContexts, disconnect 200 worklets, stop 300 fixture tracks, produce no post-Stop PCM,
  and make no provider network requests.

## Residual risks and follow-up

- Fake Web Audio contracts cannot prove Chromium or CoreAudio behavior.
- Main-process IPC validation remains `SEC-IPC-001`.
- Overflow metrics are not yet emitted through the telemetry port.
- Zoom, Teams, Meet, TCC, and real route-switch automation remain in `TEST-AUDIO-002` and the
  target-Mac CI lane.
