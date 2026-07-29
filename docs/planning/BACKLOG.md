# Initial backlog

## Status and priority

- Status: `proposed`, `ready`, `in_progress`, `blocked`, `done`.
- Priority: P0 blocks the meeting foundation, P1 is required for the meeting release, P2 follows the meeting release.

## Epics

| Epic                             | Priority | Outcome                                                        |
| -------------------------------- | -------: | -------------------------------------------------------------- |
| EPIC-001 Engineering system      |       P0 | Reproducible spec-driven development and quality gates         |
| EPIC-002 macOS audio capture     |       P0 | Reliable separate microphone and remote meeting audio          |
| EPIC-003 Session and transcript  |       P0 | Deterministic lifecycle and isolated timeline                  |
| EPIC-004 STT and diarization     |       P0 | Low-latency transcript with multiple remote speakers           |
| EPIC-005 Meeting copilot         |       P1 | Timely suggestions, follow-ups, recap, and actions             |
| EPIC-006 Privacy and security    |       P0 | Explicit provider, credential, retention, and package controls |
| EPIC-007 Interview profile       |       P1 | Context-aware interview support                                |
| EPIC-008 Screen and coding       |       P2 | Explicit screen-grounded assistance                            |
| EPIC-009 macOS application shell |       P1 | Movable overlay and standard menu bar lifecycle controls       |

## Ordered backlog

| ID                      | Epic     | Priority | Status      | Deliverable                                                                         | Dependencies                                 |
| ----------------------- | -------- | -------: | ----------- | ----------------------------------------------------------------------------------- | -------------------------------------------- |
| DOC-001                 | EPIC-001 |       P0 | done        | Engineering documentation baseline                                                  | None                                         |
| DEC-001                 | EPIC-001 |       P0 | done        | Accept languages and code-switching requirements                                    | DOC-001                                      |
| DEC-002                 | EPIC-001 |       P0 | done        | Accept participant-count target                                                     | DOC-001                                      |
| DEC-003                 | EPIC-001 |       P0 | done        | Accept latency SLOs                                                                 | DOC-001                                      |
| DEC-004                 | EPIC-006 |       P0 | done        | Accept retention and recording policy                                               | DOC-001                                      |
| DEC-005                 | EPIC-006 |       P0 | done        | Select default STT and LLM providers                                                | DOC-001                                      |
| TOOL-001                | EPIC-001 |       P0 | done        | Select test, coverage, mutation, lint, and type-check toolchain                     | DOC-001                                      |
| CI-001                  | EPIC-001 |       P0 | done        | Add pull-request CI with reproducible dependency installation                       | TOOL-001                                     |
| CI-002                  | EPIC-001 |       P0 | proposed    | Add self-hosted target-Mac test lane                                                | CI-001                                       |
| SPIKE-AUDIO-001         | EPIC-002 |       P0 | done        | Modern Electron/CoreAudio Tap feasibility spike                                     | TOOL-001                                     |
| BUG-AUDIO-001           | EPIC-002 |       P0 | done        | Prevent duplicate concurrent system-audio start                                     | SPIKE-AUDIO-001                              |
| BUG-AUDIO-002           | EPIC-002 |       P0 | done        | Restore and expose macOS CoreAudio Tap system capture                               | SPIKE-AUDIO-001, TEST-AUDIO-001              |
| BUG-AUDIO-003           | EPIC-006 |       P0 | done        | Remove implicit ScreenCapture permission from Meeting mode                          | BUG-AUDIO-002                                |
| ADR-DEVICE-001          | EPIC-002 |       P0 | done        | Accept cue input/output selection and fallback policy                               | SPIKE-AUDIO-001                              |
| AUDIO-DEVICE-001        | EPIC-002 |       P0 | in_progress | Explicit cue input/output selectors and effective-device diagnostics                | ADR-DEVICE-001, TEST-AUDIO-001               |
| AUDIO-DIAG-001          | EPIC-002 |       P0 | done        | Local provider-free microphone/output diagnostics                                   | AUDIO-DEVICE-001, TEST-AUDIO-001             |
| BUG-PKG-001             | EPIC-006 |       P0 | done        | Стабилизировать identity `com.cue.overlay` в тестовых macOS-пакетах                 | SPIKE-AUDIO-001                              |
| TEST-AUDIO-001          | EPIC-002 |       P0 | done        | Capture adapter contract suite and deterministic audio fixtures                     | TOOL-001                                     |
| TEST-AUDIO-002          | EPIC-002 |       P0 | proposed    | Zoom/Teams/Meet x accepted audio-route automation matrix                            | SPIKE-AUDIO-001, AUDIO-DEVICE-001, CI-002    |
| ADR-AUDIO-001           | EPIC-002 |       P0 | done        | Accept native CoreAudio Tap helper based on spike evidence                          | SPIKE-AUDIO-001                              |
| TEST-NATIVE-AUDIO-001   | EPIC-002 |       P0 | done        | Complete Swift structural/mutation gates with an injected CoreAudio policy boundary | ADR-AUDIO-001                                |
| BUG-AUDIO-004           | EPIC-002 |       P0 | done        | Terminate native helper and release CoreAudio resources on parent death             | ADR-AUDIO-001, TEST-NATIVE-AUDIO-001         |
| ADR-CAPTURE-SCOPE-001   | EPIC-006 |       P0 | done        | Accept explicit application scope and disclosed browser-wide Chrome capture         | ADR-AUDIO-001                                |
| AUDIO-CAPTURE-SCOPE-001 | EPIC-002 |       P0 | done        | Implement verified application scope, cue exclusion, and no-global-fallback policy  | ADR-CAPTURE-SCOPE-001, TEST-NATIVE-AUDIO-001 |
| ARCH-SESSION-001        | EPIC-003 |       P0 | proposed    | Pure session state machine with generation cancellation                             | TOOL-001                                     |
| ARCH-TIMELINE-001       | EPIC-003 |       P0 | proposed    | Session-scoped transcript event model                                               | ARCH-SESSION-001                             |
| ARCH-PROVIDER-001       | EPIC-006 |       P0 | proposed    | Provider policy with fallback disabled by default                                   | TOOL-001                                     |
| SEC-KEYCHAIN-001        | EPIC-006 |       P0 | proposed    | Move provider credentials to macOS Keychain                                         | TOOL-001                                     |
| SEC-IPC-001             | EPIC-006 |       P0 | proposed    | Typed, bounded, sender-validated IPC contracts                                      | TOOL-001                                     |
| STT-001                 | EPIC-004 |       P0 | proposed    | Realtime transcription adapter behind a stable port                                 | DEC-005, ARCH-PROVIDER-001                   |
| STT-002                 | EPIC-004 |       P0 | proposed    | Remote speaker diarization and reconciliation                                       | DEC-001, DEC-002, STT-001                    |
| MEET-001                | EPIC-005 |       P1 | proposed    | Meeting session UI and status model                                                 | ARCH-SESSION-001                             |
| MEET-002                | EPIC-005 |       P1 | proposed    | On-demand reply suggestion                                                          | ARCH-TIMELINE-001, STT-001                   |
| MEET-003                | EPIC-005 |       P1 | proposed    | Follow-up questions                                                                 | MEET-002                                     |
| MEET-004                | EPIC-005 |       P1 | proposed    | Recap, decisions, and action items                                                  | STT-002                                      |
| MEET-005                | EPIC-005 |       P1 | proposed    | Speaker label rename and correction UI                                              | STT-002                                      |
| UI-WINDOW-001           | EPIC-009 |       P1 | ready       | Add a safe upper drag region for moving the overlay across displays                 | None                                         |
| UI-MENUBAR-001          | EPIC-009 |       P1 | ready       | Add a menu bar status item with graceful `Close app` action                         | None                                         |
| PKG-001                 | EPIC-006 |       P1 | proposed    | Signed, hardened, notarized daily-use package                                       | ADR-AUDIO-001                                |
| REL-001                 | EPIC-001 |       P1 | proposed    | Long-session, fault-injection, and performance release gate                         | Meeting MVP                                  |
| INT-001                 | EPIC-007 |       P1 | proposed    | Interview profile and isolated professional context                                 | Meeting MVP                                  |
| CODE-001                | EPIC-008 |       P2 | proposed    | Explicit screen/coding profile                                                      | Meeting MVP                                  |

## Next executable package

The next implementation package should contain:

1. `AUDIO-DEVICE-001` - complete live route-switch, disconnect/reconnect, and sleep/wake
   acceptance.
2. `TEST-AUDIO-002` - automate the feasible provider x route matrix and preserve Teams as
   unverified until a conference is available.
3. `UI-WINDOW-001` - add the accepted drag region.
4. `UI-MENUBAR-001` - add graceful menu bar shutdown with capture cleanup evidence.

The global capture-scope privacy risk and parent-death lifecycle gap are closed. STT work can
begin after the remaining explicit-device acceptance is complete; meeting-assistance features
still depend on the session, timeline, and STT foundations.

## Current meeting-application evidence

- Google Meet passed signed-package system-audio signal, Stop lifecycle, and no-screen-prompt
  acceptance with one participant on the Mac and one participant on a phone.
- Zoom passed the current two-participant system-audio and Stop smoke on the target Mac:
  4,816 chunks, 827,562 samples, 225,162 nonzero samples, peak 11,294, and no helper process
  after Stop.
- The Zoom run was launched from Codex, so its TCC attribution is not accepted as an independent
  standalone identity test. The earlier signed-package Google Meet run remains the TCC evidence.
- Zoom application-scope isolation passed with Spotify continuously playing on the same Sony
  Bluetooth output. The verified Zoom tap was exactly zero before and after Zoom's own speaker
  fixture, while the fixture produced 446,374 nonzero samples with peak 0.69581. This deterministic
  fixture proves Zoom-vs-Spotify isolation; the earlier two-participant run remains the
  real-meeting-signal evidence.
- Microsoft Teams is waived only for the current manual spike because the product owner cannot
  create a test conference. It remains an unverified release requirement and is not recorded as
  passed.
- The full provider x route matrix, route switching, disconnect/reconnect, and sleep/wake remain
  in `TEST-AUDIO-002`.

## Application shell acceptance notes

### UI-WINDOW-001

1. The frameless window has one visually and semantically identifiable drag region in its upper
   area.
2. The drag region does not overlap buttons, text inputs, selectors, or other interactive
   controls.
3. Dragging moves the window within the current display and across connected displays.
4. Moving the window does not change capture state, always-on-top behavior, or content
   protection.
5. Automated tests cover the drag-region contract; a target-Mac multi-display test records the
   cross-display result.

### UI-MENUBAR-001

1. A cue status item is present in the macOS menu bar for the lifetime of the application.
2. Its menu contains the requested `Close app` action.
3. The action uses the normal application shutdown path rather than force-terminating the
   process.
4. Active microphone capture, the native system-audio helper, timers, and global shortcuts are
   released during shutdown.
5. Automated lifecycle tests cover action registration and cleanup; packaged target-Mac
   acceptance verifies the visible status item and shutdown behavior.

macOS convention normally labels an application termination action `Quit cue`. The requested
`Close app` label remains the accepted backlog wording; changing it requires an explicit product
decision before implementation.
