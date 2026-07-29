# Change specification: AUDIO-DEVICE-001 explicit cue input/output selection

## Control

| Field           | Value                                                  |
| --------------- | ------------------------------------------------------ |
| Backlog ID      | AUDIO-DEVICE-001                                       |
| Requirement IDs | FR-AUDIO-001, FR-AUDIO-007, FR-AUDIO-008, FR-AUDIO-009 |
| Status          | in progress                                            |
| Owner           | project maintainer                                     |
| Target revision | after ADR-005 acceptance                               |

## Outcome

Отделить выбор input и playback output cue от macOS defaults и внутренних настроек Zoom,
Teams и Google Meet. Пользователь должен явно видеть requested/effective devices.

## Confirmed facts

- macOS default input/output и настройки конкретного meeting-приложения могут различаться.
- Browser/Electron `getUserMedia()` без точного `deviceId` использует доступный default, а не
  гарантированно тот же микрофон, который выбрало другое приложение.
- Track label cue подтверждает только effective device cue. Он не доказывает настройки Meet,
  Zoom или Teams.

## Accepted implementation policy

1. cue имеет собственные input и playback-output selectors.
2. При отсутствии cue-specific selection используется macOS default, явно обозначенный как
   fallback.
3. После открытия stream/sink cue отображает requested и effective device.
4. Недоступный requested device не заменяется другим микрофоном молча.
5. Автоматическое чтение приватных настроек meeting-приложений не входит в capture contract.
   В real-device evidence эти настройки фиксируются отдельно либо получают статус `unknown`.

6. Output selector управляет только cue-owned playback. Он не меняет output внутри
   Zoom/Teams/Meet и не влияет на CoreAudio system capture.

## Acceptance criteria

1. При macOS default input `Sony` cue может явно открыть `HyperX SoloCast`.
2. Requested и effective device доступны UI и диагностике без записи raw audio.
3. Если requested device исчез, session переходит в degraded/error либо предлагает явный
   fallback; другой input не открывается молча.
4. Повторный Start не создает второй stream для того же выбора.
5. Смена cue selection проходит через controlled restart и generation cancellation.
6. Real-device evidence отдельно содержит macOS defaults, meeting-app selections, cue
   requested input и cue effective input.
7. Выбор cue output применяет exact sink, сохраняется и отображает effective sink.
8. UI явно сообщает, что meeting-app output выбирается отдельно.

## Test plan

| Level       | Test ID                          | Purpose                                             |
| ----------- | -------------------------------- | --------------------------------------------------- |
| Unit        | UT-AUDIO-DEVICE-POLICY-001       | Explicit selection and default fallback             |
| Contract    | CT-AUDIO-DEVICE-POLICY-001       | Exact device constraints and no silent swap         |
| Contract    | CT-AUDIO-OUTPUT-POLICY-001       | Exact cue playback sink and default fallback        |
| E2E         | E2E-AUDIO-DEVICE-SELECT-001      | Selector and effective-device presentation          |
| E2E         | E2E-AUDIO-DEVICE-OUTPUT-LOSS-001 | Output loss is fail-closed and exact route recovers |
| Real device | RT-MAC-APP-OVERRIDE-001          | macOS Sony, meeting app HyperX, cue HyperX          |
| Real device | RT-MAC-DEVICE-LOSS-001           | Sony disconnect/reconnect without fallback          |
| Mutation    | MT-AUDIO-DEVICE-POLICY-001       | Fallback and mismatch assertion strength            |

## Risks

- Device labels may be unavailable before microphone permission is granted.
- Browser device IDs may change after permission reset or device reconnection.
- Automatically reverse-engineering settings of each meeting app would be brittle,
  privacy-sensitive, and expensive to maintain.
- System audio is a mixed capture lane; output-device evidence does not provide remote
  speaker identity.

## Verification evidence

- `audio-device-policy.mjs` owns normalization, exact input constraints, device-option
  construction, effective-input diagnostics, exact output sink routing, and typed failures.
- 28 focused policy tests cover default and explicit selections, unavailable devices,
  unlabeled devices, metadata normalization, unsupported output selection, permission
  failure, and effective-sink mismatch.
- Browser capture contract classifies `NotFoundError` and `OverconstrainedError` as
  `device-unavailable`; exact input selection therefore cannot silently degrade to default.
- Full automated scope after signing-policy work: 100% statements/branches/functions/lines
  and 653/653 mutants killed.
- Development Electron UI smoke test displayed independent Input and Output selectors,
  requested/effective status, and the explicit warning that meeting-app devices are separate.
- Stable team-signed target package enumerated the real CoreAudio inventory. Explicit HyperX
  input and built-in output selection passed, and both selections persisted across a full app
  restart.
- With Sony reconnected, CoreAudio reported Sony Bluetooth as the macOS default input and
  output while HyperX remained available as a separate USB input. cue retained explicit
  HyperX input, accepted `.Sony (Bluetooth)` as its exact output sink, displayed it as
  effective, and persisted both selections across a full Quit/launch cycle.
- Provider-free diagnostic opened exact HyperX, completed a controlled input restart and
  automatically stopped without parallel streams or provider traffic.
- The local output diagnostic applied exact `.Sony (Bluetooth)` and the user confirmed the
  bounded 440 Hz tone was audible in the selected headphones.
- `RT-MAC-DEVICE-LOSS-001` on the signed target package disconnected only Sony while cue
  retained explicit HyperX input and Sony output. cue rendered the missing output as
  `Unavailable device`, refused the output test with `selected sink is unavailable`, did not
  offer a silent fallback, then restored exact `.Sony (Bluetooth)` after reconnection.
- Sleep/wake recovery remains open and is intentionally a separate target-Mac acceptance
  because suspending the machine interrupts the current control session.

## Escaped-defect analysis: stale output sink after disconnect

- Observation: the first target-Mac disconnect run retained the stale Sony `deviceId` as the
  effective output and reported a successful test tone after the device disappeared.
- Root cause: `applyCueOutput()` trusted `HTMLMediaElement.setSinkId()` to reject a stale
  identifier. On the target Electron/macOS combination the call could retain that identifier
  without proving that it was still present in the latest `enumerateDevices()` inventory.
- Correction: explicit output routing now fails before `setSinkId()` unless the requested ID
  exists in the current available-output map. Status rendering uses the same availability
  gate and never exposes a stale raw ID as effective.
- Regression model: `E2E-AUDIO-DEVICE-OUTPUT-LOSS-001` removes Sony from the runtime inventory,
  asserts zero new sink selection and zero playback, verifies typed failure, restores Sony and
  confirms the exact route is reapplied.
