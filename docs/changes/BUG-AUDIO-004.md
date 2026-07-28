# Change specification: BUG-AUDIO-004 parent-liveness control channel

## Control

| Field           | Value                                    |
| --------------- | ---------------------------------------- |
| Backlog ID      | BUG-AUDIO-004                            |
| Requirement IDs | FR-SESSION-003, NFR-REL-002              |
| Status          | done                                     |
| Owner           | project maintainer                       |
| Target revision | `spike/SPIKE-AUDIO-001-electron-capture` |

## Outcome

The native audio helper cannot outlive Electron main silently: stdin EOF triggers graceful
cleanup, while a bounded `getppid()` check terminates an orphan even when a Chromium descendant
retains a copy of the pipe writer.

## Confirmed facts

- Electron spawns the helper with a writable stdin control pipe.
- A Chromium descendant can inherit and retain the pipe writer after Electron main exits, so
  stdin EOF alone is not deterministic parent-liveness evidence.
- Closing a file descriptor from another thread does not reliably interrupt an already blocked
  Darwin `read(2)`.
- ADR-007 requires one bounded versioned stdin message followed by an open parent-liveness
  channel.
- The existing session cleanup path already destroys IO, aggregate, and tap resources in reverse
  order.

## Assumptions

- Protocol version 1 may initially carry only explicit diagnostic-global capture while the
  application resolver is implemented; the envelope must be extensible without weakening
  fail-closed parsing.

## Scope

- Define a bounded newline-delimited JSON control envelope.
- Require `protocolVersion: 1`, `command: "capture"`, and an explicit scope object.
- Keep stdin open after configuration as the parent-liveness channel.
- Stop gracefully on stdin EOF.
- Poll stdin in bounded intervals and treat a changed PPID or `PPID <= 1` as owner death.
- Preserve normal process-level `SIGTERM` and `SIGINT` termination.
- Reject missing, malformed, oversized, unsupported, or additional control data.
- Update the Electron adapter and packaged E2E helper fixture to use the protocol.
- Add structural, mutation, contract, packaged E2E, and target-Mac process evidence.

## Non-goals

- Resolve native applications or Chrome process ancestry.
- Claim that diagnostic-global PCM is production-safe for STT.
- Add a separate heartbeat socket or application-level heartbeat traffic.
- Support Windows or Linux.

## Architecture and affected boundaries

- Components: Electron `NativeSystemAudioCapture`, Swift control parser, helper runner, executable
  stdin/signal boundary.
- Trust boundaries: Electron-to-helper JSON, stdin lifetime, parent PID, signals, CoreAudio
  cleanup.
- State transitions: awaiting-config -> active -> parent-closed/orphaned/signal/protocol-error ->
  stopped.
- Data and retention: the control message contains only protocol and scope metadata; PCM remains
  memory-only.

## Alternatives considered

| Option                            | Benefits                                           | Costs and risks                                      | Decision |
| --------------------------------- | -------------------------------------------------- | ---------------------------------------------------- | -------- |
| stdin EOF only                    | Minimal protocol                                   | Inherited writer can suppress EOF                    | Rejected |
| `DispatchSourceProcess` only      | Event-driven                                       | Was not delivered reliably in the blocking CLI path  | Rejected |
| Separate heartbeat socket         | Rich supervision semantics                         | Additional IPC, timers, packaging, and failure modes | Rejected |
| stdin EOF plus bounded PPID check | Graceful normal path; independent orphan detection | 100 ms bounded polling overhead; macOS-specific      | Accepted |
| Signals only                      | Minimal implementation                             | Cannot prove cleanup after abrupt parent death       | Rejected |

## Acceptance criteria

1. Electron spawns the helper with a writable stdin pipe.
2. Exactly one bounded version-1 JSON line is written before helper startup can succeed.
3. stdin remains open during capture and EOF causes graceful cleanup and exit code 0.
4. Missing, malformed, oversized, unsupported-version, or unsupported-scope configuration fails
   before any CoreAudio resource is acquired.
5. Additional bytes after configuration cause a typed protocol failure and cleanup.
6. `SIGTERM` and `SIGINT` remain valid process shutdown paths.
7. Parent death leaves no helper process after the bounded acceptance interval, even when another
   process retains the stdin writer.
8. All project-owned parser, runner, and adapter branches meet structural and mutation gates.

## Failure modes

| Failure                          | Expected behavior                            | Test ID                       |
| -------------------------------- | -------------------------------------------- | ----------------------------- |
| stdin closes before config       | Typed error; no CoreAudio start              | UT-SWIFT-CONTROL-001          |
| Config exceeds the byte limit    | Typed error; bounded memory                  | UT-SWIFT-CONTROL-002          |
| Version or schema is unsupported | Typed error; no compatibility guessing       | CT-HELPER-CONTROL-V1-001      |
| Extra control bytes arrive       | Stop, typed protocol error, resource cleanup | UT-SWIFT-CONTROL-003          |
| Parent exits after Start         | Helper process exits within bounded interval | E2E-HELPER-PARENT-DEATH-001   |
| Descendant retains stdin writer  | PPID change still terminates Swift helper    | E2E-HELPER-INHERITED-PIPE-001 |
| Signal races stdin EOF           | Cleanup and final event occur once           | STRESS-HELPER-TERMINATION-001 |

## Test plan

| Level       | Test IDs                                                   | Purpose                                        |
| ----------- | ---------------------------------------------------------- | ---------------------------------------------- |
| Unit        | UT-SWIFT-CONTROL-001..003                                  | bounded parser and EOF behavior                |
| Property    | PT-HELPER-CONTROL-CHUNKS-001                               | arbitrary chunk boundaries                     |
| Mutation    | MT-HELPER-CONTROL-001                                      | parser and lifecycle assertions                |
| Contract    | CT-HELPER-CONTROL-V1-001                                   | Electron/Swift schema parity                   |
| Integration | IT-PACKAGE-AUDIO-USAGE-001                                 | packaged helper protocol                       |
| E2E         | E2E-HELPER-PARENT-DEATH-001, E2E-HELPER-INHERITED-PIPE-001 | abrupt owner exit and inherited-writer cleanup |
| Real device | RT-MAC-HELPER-PARENT-DEATH-001                             | CoreAudio resource cleanup                     |

## Security and privacy

- Inputs and trust: stdin is untrusted even though Electron owns the child process.
- Secrets: none.
- Provider/data boundary: this change does not authorize diagnostic-global PCM for providers.
- Logging and redaction: protocol errors and scope kind only; no process command lines or PCM.

## Rollout

- Land the versioned protocol and EOF cleanup before application-scope fields are added.
- Keep EOF as the graceful primary path and PPID supervision as the orphan backstop.

## Rollback

- Revert the protocol slice and keep the P0 release blocker open. Do not restore a helper that can
  outlive its owner as release-ready behavior.

## Verification evidence

- CI: run `30363532849` passed both `quality` and `package-macos-arm64`, including packaged E2E
  9/9.
- Coverage: local `npm run test:swift` passed with 100% functions, instantiations, lines, and
  regions for `HelperCore.swift`, `HelperControl.swift`, and `CoreAudioTapPlatform.swift`.
- Mutation: local `npm run test:swift:mutation` killed 74/74 viable mutants; 0 survived and 0
  were unviable.
- Performance: `STRESS-CAPTURE-100-001` passed after the protocol change.
- Real device: `E2E-HELPER-INHERITED-PIPE-001` killed the initialized production Swift helper's
  owner while a separate keeper retained the stdin writer; helper exit passed 20/20 iterations.
- Package: ad-hoc arm64 package build passed; packaged E2E passed 9/9, including the retained-writer
  lifecycle regression.
- E2E: `E2E-HELPER-PARENT-DEATH-001` now observes actual helper-process exit instead of requiring
  an optional fixture `stop` log; the corrected oracle passed 30/30 iterations.

## Residual risks and follow-up

- A 100 ms PPID check adds negligible wakeups but remains macOS-specific platform supervision.
- Parent death proves ownership loss, not why Electron exited.
- Application-scope semantics remain owned by `AUDIO-CAPTURE-SCOPE-001`.
