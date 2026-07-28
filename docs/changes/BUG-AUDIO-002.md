# Change specification: BUG-AUDIO-002 macOS system-audio capture preflight

## Control

| Field           | Value                                        |
| --------------- | -------------------------------------------- |
| Backlog ID      | BUG-AUDIO-002                                |
| Requirement IDs | FR-AUDIO-002, 004; NFR-OBS-001, NFR-COMP-001 |
| Status          | in progress                                  |
| Owner           | project maintainer                           |
| Target revision | `spike/SPIKE-AUDIO-001-electron-capture`     |

## Outcome

cue захватывает системный звук Google Meet через отдельный канал на целевом Mac либо
переходит в явное degraded/error состояние с диагностируемой причиной. Активный microphone
channel не может маскировать неработающий system channel.

## Confirmed facts

- На подписанном package Electron 43.2.0 microphone callback получает PCM, а system callback
  не вызывается.
- System Start завершается `PcmCaptureStartError` с `code=initialization-failed`; исходная
  причина Chromium - `AbortError: Invalid capture constraints`.
- TCC log фиксирует несовпадение сохраненной code requirement для `com.cue.overlay` отдельно
  по `kTCCServiceScreenCapture` и `kTCCServiceAudioCapture`.
- Текущая designated requirement имеет ожидаемый SHA-256 `7860224d...` и совпадает с
  предыдущей стабильной локальной package identity.
- Renderer повторяет system Start после быстрого отказа, поэтому одна пользовательская
  операция создает два одинаковых сообщения об ошибке.
- Текущий packaged E2E подменяет `getDisplayMedia` и не проверяет реальный TCC/CoreAudio Tap
  boundary.

## Assumptions

- После удаления stale TCC record и повторного добавления текущего signed bundle CoreAudio
  Tap сможет открыть system stream без legacy feature flag.
- `NSAudioCaptureUsageDescription` в package уже достаточен для Electron 43; это должно быть
  подтверждено package policy test и реальным запуском.
- Если новый CoreAudio Tap flow остается неработоспособным после исправления TCC, legacy
  ScreenCaptureKit permission flow допустим только как явно зафиксированный fallback spike.

## Scope

- Зафиксировать macOS display-media и package policy как project-owned production logic.
- Проверять platform-specific display-media grant до передачи callback в Electron.
- Классифицировать и показывать system-channel failure без ложного общего active состояния.
- Предотвратить вторую Start-попытку в рамках одного неуспешного UI transition.
- Добавить regression tests для TCC/code-requirement mismatch и platform policy.
- Повторить Google Meet с HyperX input и Sony Bluetooth output на целевом Mac.

## Non-goals

- Zoom и Teams certification.
- Автоматическое изменение или сброс TCC database.
- Скрытый cross-platform fallback.
- Swift helper до завершения Electron/CoreAudio Tap spike.
- STT и транскрипция.

## Architecture and affected boundaries

- Components: main-process display-media policy, renderer capture status, package metadata.
- Trust boundaries: Electron display-media request, macOS TCC, CoreAudio Tap, MediaStream.
- State transitions: session starting -> microphone active + system active/degraded -> stopped.
- Data and retention: только локальные sanitized errors и счетчики; PCM не сохраняется.

## Alternatives considered

| Option                                      | Benefits                              | Costs and risks                              | Decision               |
| ------------------------------------------- | ------------------------------------- | -------------------------------------------- | ---------------------- |
| Сразу включить legacy Chromium feature flag | Быстрый возврат старого permission UX | Маскирует CoreAudio Tap и создает tech debt  | Deferred               |
| Считать общий session active по микрофону   | Нет изменений UI                      | Ложный статус, удаленная речь теряется       | Rejected               |
| Автоматически вызвать `tccutil reset`       | Убирает stale record                  | Разрушительное изменение privacy permissions | Rejected               |
| CoreAudio Tap-first + явный preflight       | Современный путь и честная деградация | Нужен target-Mac acceptance test             | Provisionally accepted |

## Acceptance criteria

1. macOS policy не использует Windows-only assumptions без явного platform branch.
2. Package содержит `NSAudioCaptureUsageDescription` и стабильную team-backed identity.
3. Stale/denied TCC не оставляет system channel в ложном active состоянии.
4. Одна пользовательская Start-операция публикует одну system failure.
5. Microphone и system health наблюдаются независимо.
6. При исправленных разрешениях Google Meet создает ненулевые system PCM frames.
7. Stop завершает оба канала и после Stop счетчики PCM не растут.
8. Legacy feature flag не включается без отдельного evidence-backed решения.

## Failure modes

| Failure                               | Expected behavior                        | Test ID                     |
| ------------------------------------- | ---------------------------------------- | --------------------------- |
| TCC code requirement mismatch         | Явный system degraded/error              | RT-MAC-TCC-MISMATCH-001     |
| Invalid display-media platform grant  | Policy отклоняет несовместимый grant     | UT-DISPLAY-MEDIA-POLICY-001 |
| Быстрый system Start failure          | Одна ошибка на UI transition             | E2E-SYSTEM-FAIL-SINGLE-001  |
| Microphone работает, system не открыт | Каналы имеют независимый health          | E2E-SYSTEM-DEGRADED-001     |
| CoreAudio Tap stream открыт           | Ненулевой system PCM без mic attribution | RT-MAC-MEET-SYSTEM-PCM-001  |
| Системный test tone                   | Ненулевой system PCM через CoreAudio Tap | RT-MAC-COREAUDIO-TONE-001   |
| Stop после system capture             | Нулевой post-Stop frame delta            | RT-MAC-MEET-SYSTEM-STOP-001 |

## Test plan

| Level       | Test IDs                                                                | Purpose                                    |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| Unit        | UT-DISPLAY-MEDIA-POLICY-001                                             | Platform grant policy                      |
| Property    | PT-DISPLAY-MEDIA-REQUEST-001                                            | Request combinations                       |
| Mutation    | MT-DISPLAY-MEDIA-POLICY-001                                             | Assertion strength                         |
| Contract    | CT-SYSTEM-CAPTURE-ERROR-001                                             | Typed system degradation                   |
| Integration | IT-PACKAGE-AUDIO-USAGE-001                                              | Package metadata                           |
| E2E         | E2E-SYSTEM-DEGRADED-001, E2E-SYSTEM-FAIL-SINGLE-001                     | Renderer state and UX                      |
| Real device | RT-MAC-TCC-MISMATCH-001, RT-MAC-COREAUDIO-TONE-001, MEET-SYSTEM-PCM-001 | TCC, CoreAudio Tap, and Google Meet signal |

## Security and privacy

- Inputs and trust: TCC state, Electron request metadata, and browser errors are untrusted.
- Secrets: none.
- Provider/data boundary: provider calls are disabled for the acceptance test.
- Logging and redaction: bundle ID, typed error, state, and aggregate counters only.

## Rollout

- Исправление остается в draft spike PR до target-Mac acceptance.
- CoreAudio Tap остается основным путем; fallback требует отдельного решения.

## Rollback

- Вернуть main-process policy и renderer status commit, сохранив failing real-device evidence.

## Verification evidence

- CI: local quality workflow passed; GitHub Actions remains pending until push.
- Coverage: 100% statements, branches, functions, and lines across 173 tests.
- Mutation: 100% score with 0 surviving mutants.
- Performance: pending.
- Real device: the initial Google Meet failure was reproduced and then corrected by clocking the
  aggregate tap from currently active output devices instead of a fixed default route.
- Google Meet acceptance: one Mac participant and one phone participant produced 2,292 PCM chunks,
  391,168 samples, 247,441 nonzero samples, and peak 29,521 through the signed package.
- Stop acceptance: state and metrics remained unchanged for five seconds after Stop and the native
  helper process exited.
- TCC recovery: stale `cue` records were removed and the current signed bundle was re-added
  manually; the next launch opened CoreAudio Tap without degraded/error.
- CoreAudio Tap smoke: eight macOS `Glass.aiff` signals produced 3,119 system PCM callbacks;
  after Stop, three additional signals produced a callback delta of exactly zero.
- Package: `com.cue.overlay`, Team ID `6VS347Y94Z`, designated requirement SHA-256
  `7860224d...`; packaged E2E passed 7/7 and strict codesign passed for the app and native
  helper.

## Residual risks and follow-up

- TCC cannot be fully automated on GitHub-hosted CI.
- A self-hosted target-Mac lane remains required for release-grade permission regression.
