# Requirements traceability

## Rules

- Accepted P0/P1 requirements without an automated test ID block merge and release.
- Planned test IDs are placeholders until executable tests exist.
- `verified` is allowed only when CI or real-device evidence is linked.

## Initial matrix

| Requirement    | Backlog                                          | Planned automated evidence                                                       | Status  |
| -------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- | ------- |
| FR-SESSION-001 | ARCH-SESSION-001                                 | UT-SESSION-001, AT-SESSION-001                                                   | planned |
| FR-SESSION-002 | ARCH-SESSION-001                                 | PT-SESSION-001, MT-SESSION-001                                                   | planned |
| FR-SESSION-003 | ARCH-SESSION-001, TEST-AUDIO-002                 | AT-SESSION-STOP-001, RT-MAC-STOP-001                                             | planned |
| FR-SESSION-004 | ARCH-SESSION-001                                 | UT-SESSION-RACE-001, MT-SESSION-002                                              | planned |
| FR-SESSION-005 | ARCH-TIMELINE-001                                | AT-SESSION-BOUNDARY-001, MT-TIMELINE-001                                         | planned |
| FR-SESSION-006 | TEST-AUDIO-002                                   | RT-MAC-RECOVERY-001                                                              | planned |
| FR-AUDIO-001   | SPIKE-AUDIO-001, TEST-AUDIO-001                  | CT-CAPTURE-MIC-001, RT-MAC-MIC-001                                               | planned |
| FR-AUDIO-002   | SPIKE-AUDIO-001, TEST-AUDIO-002                  | CT-CAPTURE-SYSTEM-001, RT-MAC-APPS-001                                           | planned |
| FR-AUDIO-003   | SPIKE-AUDIO-001                                  | RT-MAC-SELF-AUDIO-001                                                            | planned |
| FR-AUDIO-004   | SPIKE-AUDIO-001                                  | UT-CAPTURE-HEALTH-001, CT-CAPTURE-HEALTH-001, RT-MAC-DEAD-001                    | planned |
| FR-AUDIO-005   | TEST-AUDIO-001                                   | PT-AUDIO-BOUNDS-001, MT-AUDIO-001                                                | planned |
| FR-AUDIO-006   | TEST-AUDIO-002                                   | RT-MAC-ROUTES-001                                                                | planned |
| FR-AUDIO-007   | SPIKE-AUDIO-001, TEST-AUDIO-002                  | RT-MAC-USB-BT-001, RT-MAC-APPS-USB-BT-001                                        | planned |
| FR-AUDIO-008   | ADR-DEVICE-001, AUDIO-DEVICE-001, TEST-AUDIO-002 | CT-AUDIO-DEVICE-POLICY-001, E2E-AUDIO-DEVICE-SELECT-001, RT-MAC-APP-OVERRIDE-001 | planned |
| FR-AUDIO-009   | ADR-DEVICE-001, AUDIO-DEVICE-001                 | CT-AUDIO-OUTPUT-POLICY-001, E2E-AUDIO-OUTPUT-SELECT-001                          | planned |
| FR-STT-001     | STT-001                                          | CT-STT-CHANNELS-001                                                              | planned |
| FR-STT-002     | STT-001                                          | AT-STT-YOU-001                                                                   | planned |
| FR-STT-003     | STT-002                                          | AT-DIARIZATION-001, EVAL-DIARIZATION-001                                         | planned |
| FR-STT-004     | ARCH-PROVIDER-001                                | UT-PROVIDER-SELECT-001, MT-PROVIDER-001                                          | planned |
| FR-STT-005     | ARCH-PROVIDER-001                                | AT-PROVIDER-NO-FALLBACK-001, MT-PROVIDER-002                                     | planned |
| FR-STT-006     | STT-001, ARCH-TIMELINE-001                       | UT-TIMELINE-PARTIAL-001                                                          | planned |
| FR-STT-007     | ARCH-TIMELINE-001                                | PT-TIMELINE-ORDER-001, MT-TIMELINE-002                                           | planned |
| FR-MEET-001    | MEET-002                                         | E2E-MEET-REPLY-001                                                               | planned |
| FR-MEET-002    | MEET-003                                         | E2E-MEET-FOLLOWUP-001                                                            | planned |
| FR-MEET-003    | MEET-004                                         | E2E-MEET-RECAP-001, EVAL-RECAP-001                                               | planned |
| FR-MEET-004    | MEET-005                                         | E2E-SPEAKER-RENAME-001                                                           | planned |
| FR-MEET-005    | MEET-001                                         | E2E-ATTACHMENTS-001                                                              | planned |
| FR-INT-001     | INT-001                                          | E2E-INTERVIEW-PROFILE-001                                                        | planned |
| FR-INT-002     | INT-001                                          | AT-CONTEXT-BOUNDARY-001                                                          | planned |
| FR-CODE-001    | CODE-001                                         | E2E-SCREEN-EXPLICIT-001                                                          | planned |
| FR-CODE-002    | CODE-001                                         | EVAL-CODING-001                                                                  | planned |
| FR-PRIV-001    | SEC-KEYCHAIN-001                                 | IT-KEYCHAIN-001, SCAN-SECRETS-001                                                | planned |
| FR-PRIV-002    | MEET-001                                         | E2E-STATUS-001                                                                   | planned |
| FR-PRIV-003    | DEC-004, ARCH-TIMELINE-001                       | AT-RETENTION-001, MT-RETENTION-001                                               | planned |
| FR-PRIV-004    | ARCH-TIMELINE-001                                | AT-CLEAR-001                                                                     | planned |
| FR-PRIV-005    | SEC-IPC-001                                      | PT-ERROR-REDACTION-001, MT-REDACTION-001                                         | planned |
| NFR-REL-001    | ARCH-SESSION-001, TEST-AUDIO-002                 | STRESS-SESSION-100-001                                                           | planned |
| NFR-REL-002    | ARCH-SESSION-001                                 | FUZZ-SESSION-EVENTS-001                                                          | planned |
| NFR-TEST-001   | TOOL-001, CI-001                                 | CI-COVERAGE-001                                                                  | planned |
| NFR-TEST-002   | TOOL-001, CI-001                                 | CI-MUTATION-001                                                                  | planned |
| NFR-TEST-003   | CI-001                                           | CI-TRACEABILITY-001                                                              | planned |
| NFR-SEC-001    | SEC-IPC-001                                      | CT-IPC-001, PT-IPC-NEGATIVE-001                                                  | planned |
| NFR-SEC-002    | BUG-PKG-001, PKG-001                             | PKG-TCC-IDENTITY-001, PKG-GATEKEEPER-001                                         | planned |
| NFR-PERF-001   | TEST-AUDIO-002                                   | PERF-STOP-001                                                                    | planned |
| NFR-PERF-002   | STT-001                                          | PERF-STT-001                                                                     | planned |
| NFR-PERF-003   | MEET-002                                         | PERF-SUGGESTION-001                                                              | planned |
| NFR-RES-001    | REL-001                                          | SOAK-4H-001                                                                      | planned |
| NFR-OBS-001    | REL-001                                          | AT-DIAGNOSTICS-001, SCAN-LOGS-001                                                | planned |
| NFR-COMP-001   | TEST-AUDIO-002                                   | ENV-TARGET-MAC-001                                                               | planned |

## Implemented quality controls

| Requirement    | Change                        | Executable evidence                                    | Status                                                                                                                     |
| -------------- | ----------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| NFR-TEST-001   | TOOL-001, CI-001              | `npm run test:coverage`, CI-COVERAGE-001               | verified in GitHub Actions for the enforced scope                                                                          |
| NFR-TEST-002   | TOOL-001, CI-001              | `npm run test:mutation`, CI-MUTATION-001               | verified in GitHub Actions for enforced modules                                                                            |
| NFR-TEST-003   | CI-001                        | `npm run validate:traceability`, CI-TRACEABILITY-001   | structural matrix validation implemented; requirement-wide executable evidence remains incremental                         |
| FR-AUDIO-004   | SPIKE-AUDIO-001               | UT-CAPTURE-HEALTH-001                                  | PCM health classification verified; platform dead-stream evidence remains open                                             |
| FR-AUDIO-001   | TEST-AUDIO-001                | CT-CAPTURE-CHANNELS-001, RT-MAC-MIC-001                | adapter channel isolation and packaged microphone/system routing verified; main IPC boundary remains open                  |
| FR-AUDIO-002   | SPIKE-AUDIO-001               | RT-MAC-MEET-001                                        | Google Meet с четырьмя участниками дал здоровый system PCM; Zoom, Teams и transcript evidence остаются открытыми           |
| FR-AUDIO-005   | TEST-AUDIO-001                | PT-AUDIO-BOUNDS-001, MT-AUDIO-001                      | 60-second per-channel bound matches the newest-byte model across 500 generated sequences                                   |
| FR-AUDIO-007   | SPIKE-AUDIO-001               | RT-MAC-USB-BT-001                                      | cue открыл HyperX SoloCast при системном Sony Bluetooth output; выбор устройств внутри Google Meet не был зафиксирован     |
| FR-AUDIO-008   | AUDIO-DEVICE-001              | UT-AUDIO-DEVICE-POLICY-001, CT-AUDIO-DEVICE-POLICY-001 | exact input constraints и no-silent-fallback verified; Electron UI smoke passed; HyperX real-device selection remains open |
| FR-AUDIO-009   | AUDIO-DEVICE-001              | CT-AUDIO-OUTPUT-POLICY-001                             | exact/default sink policy verified; UI separation warning passed; Sony effective-sink evidence remains open                |
| FR-SESSION-002 | BUG-AUDIO-001, TEST-AUDIO-001 | CT-CAPTURE-DOUBLE-START-001                            | duplicate Start coalescing verified for microphone and system adapters                                                     |
| FR-SESSION-003 | BUG-AUDIO-001, TEST-AUDIO-001 | CT-CAPTURE-STOP-001, RT-MAC-STOP-001                   | full graph disposal and zero post-Stop frames verified                                                                     |
| FR-SESSION-004 | BUG-AUDIO-001, TEST-AUDIO-001 | CT-CAPTURE-STOP-RACE-001                               | late media creation is disposed and cannot reactivate the adapter                                                          |

## Test ID prefixes

| Prefix | Meaning                        |
| ------ | ------------------------------ |
| UT     | Unit test                      |
| PT     | Property-based test            |
| MT     | Mutation test gate             |
| CT     | Adapter contract test          |
| IT     | Integration test               |
| AT     | Acceptance test                |
| E2E    | Electron end-to-end test       |
| RT-MAC | Real target-Mac test           |
| PERF   | Performance test               |
| STRESS | Repetition/stress test         |
| SOAK   | Long-duration test             |
| FUZZ   | Model/state fuzzing            |
| EVAL   | AI output evaluation           |
| SCAN   | Security or secret scan        |
| PKG    | Packaging/signing verification |
| CI     | Pipeline policy check          |
