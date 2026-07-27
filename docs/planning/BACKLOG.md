# Initial backlog

## Status and priority

- Status: `proposed`, `ready`, `in_progress`, `blocked`, `done`.
- Priority: P0 blocks the meeting foundation, P1 is required for the meeting release, P2 follows the meeting release.

## Epics

| Epic                            | Priority | Outcome                                                        |
| ------------------------------- | -------: | -------------------------------------------------------------- |
| EPIC-001 Engineering system     |       P0 | Reproducible spec-driven development and quality gates         |
| EPIC-002 macOS audio capture    |       P0 | Reliable separate microphone and remote meeting audio          |
| EPIC-003 Session and transcript |       P0 | Deterministic lifecycle and isolated timeline                  |
| EPIC-004 STT and diarization    |       P0 | Low-latency transcript with multiple remote speakers           |
| EPIC-005 Meeting copilot        |       P1 | Timely suggestions, follow-ups, recap, and actions             |
| EPIC-006 Privacy and security   |       P0 | Explicit provider, credential, retention, and package controls |
| EPIC-007 Interview profile      |       P1 | Context-aware interview support                                |
| EPIC-008 Screen and coding      |       P2 | Explicit screen-grounded assistance                            |

## Ordered backlog

| ID                | Epic     | Priority | Status   | Deliverable                                                          | Dependencies                              |
| ----------------- | -------- | -------: | -------- | -------------------------------------------------------------------- | ----------------------------------------- |
| DOC-001           | EPIC-001 |       P0 | done     | Engineering documentation baseline                                   | None                                      |
| DEC-001           | EPIC-001 |       P0 | done     | Accept languages and code-switching requirements                     | DOC-001                                   |
| DEC-002           | EPIC-001 |       P0 | done     | Accept participant-count target                                      | DOC-001                                   |
| DEC-003           | EPIC-001 |       P0 | done     | Accept latency SLOs                                                  | DOC-001                                   |
| DEC-004           | EPIC-006 |       P0 | done     | Accept retention and recording policy                                | DOC-001                                   |
| DEC-005           | EPIC-006 |       P0 | done     | Select default STT and LLM providers                                 | DOC-001                                   |
| TOOL-001          | EPIC-001 |       P0 | done     | Select test, coverage, mutation, lint, and type-check toolchain      | DOC-001                                   |
| CI-001            | EPIC-001 |       P0 | done     | Add pull-request CI with reproducible dependency installation        | TOOL-001                                  |
| CI-002            | EPIC-001 |       P0 | proposed | Add self-hosted target-Mac test lane                                 | CI-001                                    |
| SPIKE-AUDIO-001   | EPIC-002 |       P0 | active   | Modern Electron/CoreAudio Tap feasibility spike                      | TOOL-001                                  |
| BUG-AUDIO-001     | EPIC-002 |       P0 | done     | Prevent duplicate concurrent system-audio start                      | SPIKE-AUDIO-001                           |
| ADR-DEVICE-001    | EPIC-002 |       P0 | done     | Accept cue input/output selection and fallback policy                | SPIKE-AUDIO-001                           |
| AUDIO-DEVICE-001  | EPIC-002 |       P0 | active   | Explicit cue input/output selectors and effective-device diagnostics | ADR-DEVICE-001, TEST-AUDIO-001            |
| AUDIO-DIAG-001    | EPIC-002 |       P0 | done     | Local provider-free microphone/output diagnostics                    | AUDIO-DEVICE-001, TEST-AUDIO-001          |
| BUG-PKG-001       | EPIC-006 |       P0 | done     | Стабилизировать identity `com.cue.overlay` в тестовых macOS-пакетах  | SPIKE-AUDIO-001                           |
| TEST-AUDIO-001    | EPIC-002 |       P0 | done     | Capture adapter contract suite and deterministic audio fixtures      | TOOL-001                                  |
| TEST-AUDIO-002    | EPIC-002 |       P0 | proposed | Zoom/Teams/Meet x accepted audio-route automation matrix             | SPIKE-AUDIO-001, AUDIO-DEVICE-001, CI-002 |
| ADR-AUDIO-001     | EPIC-002 |       P0 | proposed | Accept Electron adapter or Swift helper based on spike               | SPIKE-AUDIO-001, TEST-AUDIO-002           |
| ARCH-SESSION-001  | EPIC-003 |       P0 | proposed | Pure session state machine with generation cancellation              | TOOL-001                                  |
| ARCH-TIMELINE-001 | EPIC-003 |       P0 | proposed | Session-scoped transcript event model                                | ARCH-SESSION-001                          |
| ARCH-PROVIDER-001 | EPIC-006 |       P0 | proposed | Provider policy with fallback disabled by default                    | TOOL-001                                  |
| SEC-KEYCHAIN-001  | EPIC-006 |       P0 | proposed | Move provider credentials to macOS Keychain                          | TOOL-001                                  |
| SEC-IPC-001       | EPIC-006 |       P0 | proposed | Typed, bounded, sender-validated IPC contracts                       | TOOL-001                                  |
| STT-001           | EPIC-004 |       P0 | proposed | Realtime transcription adapter behind a stable port                  | DEC-005, ARCH-PROVIDER-001                |
| STT-002           | EPIC-004 |       P0 | proposed | Remote speaker diarization and reconciliation                        | DEC-001, DEC-002, STT-001                 |
| MEET-001          | EPIC-005 |       P1 | proposed | Meeting session UI and status model                                  | ARCH-SESSION-001                          |
| MEET-002          | EPIC-005 |       P1 | proposed | On-demand reply suggestion                                           | ARCH-TIMELINE-001, STT-001                |
| MEET-003          | EPIC-005 |       P1 | proposed | Follow-up questions                                                  | MEET-002                                  |
| MEET-004          | EPIC-005 |       P1 | proposed | Recap, decisions, and action items                                   | STT-002                                   |
| MEET-005          | EPIC-005 |       P1 | proposed | Speaker label rename and correction UI                               | STT-002                                   |
| PKG-001           | EPIC-006 |       P1 | proposed | Signed, hardened, notarized daily-use package                        | ADR-AUDIO-001                             |
| REL-001           | EPIC-001 |       P1 | proposed | Long-session, fault-injection, and performance release gate          | Meeting MVP                               |
| INT-001           | EPIC-007 |       P1 | proposed | Interview profile and isolated professional context                  | Meeting MVP                               |
| CODE-001          | EPIC-008 |       P2 | proposed | Explicit screen/coding profile                                       | Meeting MVP                               |

## Next executable package

The next implementation package should contain:

1. `SPIKE-AUDIO-001` - complete Electron PCM and TCC feasibility evidence.
2. `BUG-AUDIO-001` - add a tested single-flight system-capture start guard.
3. `TEST-AUDIO-001` - capture adapter contract and deterministic fixture foundation.
4. `BUG-PKG-001` - стабилизировать identity target-Mac пакета между тестовыми сборками.
5. `AUDIO-DEVICE-001` - отделить cue microphone selection от macOS default и фиксировать
   effective device.
6. `AUDIO-DIAG-001` - отделить локальную проверку capture/output от наличия облачного
   transcription key.

Feature work must not begin before the audio feasibility and session-testability gates.
