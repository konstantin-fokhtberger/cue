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

The native audio helper cannot outlive Electron main silently: closing the parent-owned stdin
channel stops capture, drains pending output, destroys CoreAudio resources, emits a final event,
and exits.

## Confirmed facts

- Electron currently spawns the helper with stdin set to `ignore`.
- The helper currently waits only for `SIGTERM` or `SIGINT`.
- If Electron main exits without sending a signal, the helper has no parent-liveness evidence.
- ADR-007 requires one bounded versioned stdin message followed by an open parent-liveness
  channel.
- The existing session cleanup path already destroys IO, aggregate, and tap resources in reverse
  order.

## Assumptions

- An OS pipe is closed when its owning Electron process exits or crashes.
- Protocol version 1 may initially carry only explicit diagnostic-global capture while the
  application resolver is implemented; the envelope must be extensible without weakening
  fail-closed parsing.

## Scope

- Define a bounded newline-delimited JSON control envelope.
- Require `protocolVersion: 1`, `command: "capture"`, and an explicit scope object.
- Keep stdin open after configuration as the parent-liveness channel.
- Stop gracefully on stdin EOF as well as `SIGTERM` and `SIGINT`.
- Reject missing, malformed, oversized, unsupported, or additional control data.
- Update the Electron adapter and packaged E2E helper fixture to use the protocol.
- Add structural, mutation, contract, packaged E2E, and target-Mac process evidence.

## Non-goals

- Resolve native applications or Chrome process ancestry.
- Claim that diagnostic-global PCM is production-safe for STT.
- Add heartbeat traffic when pipe EOF already provides deterministic owner death.
- Support Windows or Linux.

## Architecture and affected boundaries

- Components: Electron `NativeSystemAudioCapture`, Swift control parser, helper runner, executable
  stdin/signal boundary.
- Trust boundaries: Electron-to-helper JSON, stdin lifetime, signals, CoreAudio cleanup.
- State transitions: awaiting-config -> active -> parent-closed/signal/protocol-error -> stopped.
- Data and retention: the control message contains only protocol and scope metadata; PCM remains
  memory-only.

## Alternatives considered

| Option                      | Benefits                          | Costs and risks                                      | Decision |
| --------------------------- | --------------------------------- | ---------------------------------------------------- | -------- |
| Parent PID polling          | Works without open stdin          | Races PID reuse; periodic timer; more platform API   | Rejected |
| Separate heartbeat socket   | Rich supervision semantics        | Additional IPC, timers, packaging, and failure modes | Rejected |
| Stdin EOF ownership channel | Native OS lifecycle; no heartbeat | Requires a strict one-message protocol               | Accepted |
| Signals only                | Existing implementation           | Cannot prove cleanup after abrupt parent death       | Rejected |

## Acceptance criteria

1. Electron spawns the helper with a writable stdin pipe.
2. Exactly one bounded version-1 JSON line is written before helper startup can succeed.
3. stdin remains open during capture and EOF causes graceful cleanup and exit code 0.
4. Missing, malformed, oversized, unsupported-version, or unsupported-scope configuration fails
   before any CoreAudio resource is acquired.
5. Additional bytes after configuration cause a typed protocol failure and cleanup.
6. `SIGTERM` and `SIGINT` remain valid graceful shutdown paths.
7. Parent death leaves no helper process after the bounded acceptance interval.
8. All project-owned parser, runner, and adapter branches meet structural and mutation gates.

## Failure modes

| Failure                          | Expected behavior                            | Test ID                       |
| -------------------------------- | -------------------------------------------- | ----------------------------- |
| stdin closes before config       | Typed error; no CoreAudio start              | UT-SWIFT-CONTROL-001          |
| Config exceeds the byte limit    | Typed error; bounded memory                  | UT-SWIFT-CONTROL-002          |
| Version or schema is unsupported | Typed error; no compatibility guessing       | CT-HELPER-CONTROL-V1-001      |
| Extra control bytes arrive       | Stop, typed protocol error, resource cleanup | UT-SWIFT-CONTROL-003          |
| Parent exits after Start         | EOF, reverse cleanup, helper exit            | E2E-HELPER-PARENT-DEATH-001   |
| Signal races stdin EOF           | Cleanup and final event occur once           | STRESS-HELPER-TERMINATION-001 |

## Test plan

| Level       | Test IDs                       | Purpose                         |
| ----------- | ------------------------------ | ------------------------------- |
| Unit        | UT-SWIFT-CONTROL-001..003      | bounded parser and EOF behavior |
| Property    | PT-HELPER-CONTROL-CHUNKS-001   | arbitrary chunk boundaries      |
| Mutation    | MT-HELPER-CONTROL-001          | parser and lifecycle assertions |
| Contract    | CT-HELPER-CONTROL-V1-001       | Electron/Swift schema parity    |
| Integration | IT-PACKAGE-AUDIO-USAGE-001     | packaged helper protocol        |
| E2E         | E2E-HELPER-PARENT-DEATH-001    | abrupt owner exit cleanup       |
| Real device | RT-MAC-HELPER-PARENT-DEATH-001 | CoreAudio resource cleanup      |

## Security and privacy

- Inputs and trust: stdin is untrusted even though Electron owns the child process.
- Secrets: none.
- Provider/data boundary: this change does not authorize diagnostic-global PCM for providers.
- Logging and redaction: protocol errors and scope kind only; no process command lines or PCM.

## Rollout

- Land the versioned protocol and EOF cleanup before application-scope fields are added.
- Keep the existing signal shutdown path as a secondary mechanism.

## Rollback

- Revert the protocol slice and keep the P0 release blocker open. Do not restore a helper that can
  outlive its owner as release-ready behavior.

## Verification evidence

- CI: pending.
- Coverage: local `npm run test:swift` passed with 100% functions, instantiations, lines, and
  regions for `HelperCore.swift`, `HelperControl.swift`, and `CoreAudioTapPlatform.swift`.
- Mutation: local `npm run test:swift:mutation` killed 74/74 viable mutants; 0 survived and 0
  were unviable.
- Performance: `STRESS-CAPTURE-100-001` passed after the protocol change.
- Real device: `RT-MAC-HELPER-PARENT-DEATH-001` started the production Swift helper on the target
  Mac, killed its owner with `SIGKILL`, and observed helper PID exit through stdin EOF.
- Package: ad-hoc arm64 package build passed; packaged E2E passed 8/8, including
  `E2E-HELPER-PARENT-DEATH-001`.
- E2E: `E2E-HELPER-PARENT-DEATH-001` passed by killing Electron with `SIGKILL` and observing
  helper stdin EOF and shutdown; all 8 source E2E tests passed.

## Residual risks and follow-up

- Pipe EOF proves ownership loss, not why Electron exited.
- Application-scope semantics remain owned by `AUDIO-CAPTURE-SCOPE-001`.
