# Change specification: BUG-AUDIO-001 single-flight system capture

## Control

| Field           | Value                                    |
| --------------- | ---------------------------------------- |
| Backlog ID      | BUG-AUDIO-001                            |
| Requirement IDs | FR-SESSION-002, 003, 004; FR-AUDIO-004   |
| Status          | verified                                 |
| Owner           | project maintainer                       |
| Target revision | `spike/SPIKE-AUDIO-001-electron-capture` |

## Outcome

One logical Start owns at most one system-audio resource. Stop invalidates every active or
in-flight generation and disposes a resource that completes after cancellation.

## Confirmed facts

- The click handler and `capture:state` handler both invoke `startSystemAudio()`.
- One packaged Start created two system AudioWorklet nodes.
- Stop closed one system context but the orphan context accepted 2125 additional worklet
  messages during a subsequent fixture.
- Main-process buffering rejected late PCM because `state.capturing` was false, but macOS
  capture and renderer resources remained active.

## Assumptions

- The two call sites may remain temporarily if a tested single-flight resource boundary makes
  duplicate calls idempotent.
- The reusable boundary must also handle Stop while resource creation is pending.

## Scope

- Reusable asynchronous resource slot with generation invalidation.
- System-audio renderer integration.
- Unit, concurrency, mutation, and packaged runtime regression evidence.

## Non-goals

- Microphone lifecycle migration, which remains in `TEST-AUDIO-001`.
- TCC reset or permission UI automation.
- Meeting-app certification.

## Architecture and affected boundaries

- Components: pure async resource slot and renderer system-audio adapter.
- Trust boundaries: asynchronous browser media resource creation.
- State transitions: idle -> starting -> active -> stopping -> idle.
- Data and retention: no audio data is persisted.

## Alternatives considered

| Option                                       | Benefits                                                 | Costs and risks                                           | Decision |
| -------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- | -------- |
| Remove one call site only                    | Small diff                                               | Does not solve double events or Stop-during-start         | Rejected |
| Boolean `starting` flag                      | Prevents immediate duplicate                             | Error, cancellation, and restart semantics remain fragile | Rejected |
| Generation-aware single-flight resource slot | Covers duplicate Start, cancellation, retry, and restart | Small reusable abstraction                                | Accepted |

## Acceptance criteria

1. Concurrent Start calls execute the create operation once and return the same resource.
2. Stop disposes the active resource once.
3. Stop during Start disposes the late resource and never publishes it as active.
4. A new Start after cancellation is independent of the obsolete pending generation.
5. Failed creation can be retried.
6. Packaged runtime creates one microphone and one system worklet.
7. After Stop, a new system fixture produces zero additional worklet messages.

## Failure modes

| Failure                    | Expected behavior                     | Test ID                      |
| -------------------------- | ------------------------------------- | ---------------------------- |
| Concurrent Start           | One create operation                  | UT-CAPTURE-SINGLE-FLIGHT-001 |
| Stop while active          | Dispose once                          | UT-CAPTURE-DISPOSE-001       |
| Stop while starting        | Dispose late resource                 | UT-CAPTURE-STOP-RACE-001     |
| Restart after cancellation | New generation becomes active         | UT-CAPTURE-RESTART-001       |
| Create rejects             | State returns to idle and retry works | UT-CAPTURE-RETRY-001         |

## Test plan

| Level       | Test IDs                                             | Purpose                                |
| ----------- | ---------------------------------------------------- | -------------------------------------- |
| Unit        | UT-CAPTURE-SINGLE-FLIGHT-001, UT-CAPTURE-DISPOSE-001 | Ownership                              |
| Property    | PT-CAPTURE-SEQUENCE-001                              | Deferred to TEST-AUDIO-001 model suite |
| Mutation    | MT-CAPTURE-SLOT-001                                  | Assertion strength                     |
| Contract    | CT-CAPTURE-STOP-RACE-001                             | Browser adapter lifecycle              |
| Integration | IT-CAPTURE-FIXTURE-001                               | Worklet and IPC behavior               |
| E2E         | E2E-CAPTURE-UI-001                                   | One click, one system resource         |
| Real device | RT-MAC-STOP-001                                      | No post-Stop system frames             |

## Security and privacy

- Inputs and trust: media resources are untrusted asynchronous results.
- Secrets: none.
- Provider/data boundary: no provider calls.
- Logging and redaction: aggregate counters only.

## Rollout

- Fix remains in the draft spike PR while the broader feasibility matrix is completed.

## Rollback

- Revert the slot integration and restore the spike branch for further diagnosis.

## Verification evidence

- Regression: six resource-slot tests cover concurrent Start, active Stop, Stop-during-Start,
  obsolete/current generation ordering, active reuse, and retry after failure.
- Coverage: 37 tests pass; statements 110/110, branches 53/53, functions 28/28, and lines
  107/107.
- Mutation: 213/213 mutants killed; mutation score 100%.
- Package: Electron 43.2.0 arm64 directory package completes.
- CI: [Pull request quality run 30111375553](https://github.com/konstantin-fokhtberger/cue/actions/runs/30111375553)
  passed (`quality` and `package-macos-arm64`).
- Real device: one Start produced exactly two worklets with 828 messages each before Stop.
  Their RMS values were 156 and 3906, separating ambient microphone input from the synthesized
  system fixture.
- Stop regression: both contexts reached `closed`; a second synthesized system fixture
  produced message deltas `[0, 0]`.
- Lifecycle regression: ten sequential Start/Stop cycles on `.Sony` Bluetooth input/output
  created exactly 20 worklets, closed every context, and produced aggregate post-Stop message
  delta `0` while browser playback continued.
- Privacy: instrumentation retained aggregate counters only; no raw audio was saved or sent.

## Residual risks and follow-up

- `TEST-AUDIO-001` subsequently extracted a shared generation-safe adapter for microphone and
  system capture and added deterministic browser-media contract tests.
- Bounded buffering, main IPC validation, and the 100-cycle stress gate remain open.
