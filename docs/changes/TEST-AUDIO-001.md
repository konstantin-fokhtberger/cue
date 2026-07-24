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

## Test plan

| Level       | Test IDs                                         | Purpose                      |
| ----------- | ------------------------------------------------ | ---------------------------- |
| Unit        | UT-CAPTURE-ERROR-001, UT-PCM-BUFFER-001          | Errors and buffer operations |
| Property    | PT-CAPTURE-SEQUENCE-001, PT-AUDIO-BOUNDS-001     | Ordering and memory bounds   |
| Mutation    | MT-CAPTURE-ADAPTER-001, MT-AUDIO-001             | Assertion strength           |
| Contract    | CT-CAPTURE-DOUBLE-START-001 through CHANNELS-001 | Browser adapter behavior     |
| Integration | IT-CAPTURE-FIXTURE-001                           | Worklet-to-channel routing   |
| E2E         | E2E-CAPTURE-UI-001                               | Renderer Start/Stop          |
| Real device | RT-MAC-MIC-001, RT-MAC-STOP-001                  | Target-Mac regression        |

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

- CI: pending.
- Coverage: 46 tests pass; statements 165/165, branches 73/73, functions 38/38, and lines
  160/160.
- Mutation: 268/268 mutants killed; mutation score 100%.
- Performance: pending.
- Contract: nine deterministic adapter tests cover graph wiring, exact channel routing,
  duplicate Start, active Stop, Stop-during-Start, typed permission denial, missing tracks,
  and partial initialization failure.
- Acceptance: criteria 1-8 and 10 pass; bounded-buffer criterion 9 remains pending.
- Real device: Bluetooth ten-cycle baseline passed before extraction. After extraction, two
  packaged cycles retained `.Sony (Bluetooth)` and `System audio` labels, closed all four
  contexts, and produced post-Stop deltas `[0, 0]`.
- Package: Electron 43.2.0 arm64 directory package completes with the extracted adapter.

## Residual risks and follow-up

- Fake Web Audio contracts cannot prove Chromium or CoreAudio behavior.
- Main-process IPC validation remains `SEC-IPC-001`.
- Bounded buffering and 100-cycle stress remain separate slices within this backlog item.
