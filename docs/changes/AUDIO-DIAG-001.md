# Change specification: AUDIO-DIAG-001 provider-free local audio diagnostics

## Control

| Field           | Value                                                  |
| --------------- | ------------------------------------------------------ |
| Backlog ID      | AUDIO-DIAG-001                                         |
| Requirement IDs | FR-AUDIO-001, FR-AUDIO-004, FR-AUDIO-008, FR-AUDIO-009 |
| Status          | verified                                               |
| Owner           | project maintainer                                     |
| Target revision | after BUG-PKG-001                                      |

## Outcome

Позволить проверить выбранные input/output и lifecycle аудиозахвата на target Mac без
настройки облачного transcription provider и без передачи аудио за пределы приложения.

## Confirmed facts

- Stable team-signed cue перечисляет реальные CoreAudio input/output devices.
- Explicit HyperX input и built-in output сохраняются после перезапуска.
- Текущий Listen flow прекращает запуск до открытия media stream, если отсутствует
  transcription key.
- Поэтому UI selection и persistence проверяются локально, но effective input track,
  controlled restart и signal health без ключа не наблюдаемы.

## Scope

- Явно запускаемый локальный microphone diagnostic для выбранного exact `deviceId`.
- Requested/effective input, sample count, RMS/peak и lifecycle state без raw-audio logging.
- Короткий cue-owned output test tone через выбранный exact sink.
- Controlled restart при смене input во время diagnostic.
- Автоматический Stop по ограниченному timeout и ручной Stop.

## Accepted implementation policy

1. Microphone diagnostic использует отдельный `BrowserPcmCapture` и никогда не вызывает
   `cue.micPcm`, `cue.systemPcm`, STT или LLM IPC.
2. Diagnostic автоматически останавливается через 10 секунд; health обновляется каждые
   250 мс, отсутствие frames считается dead через 2 секунды.
3. Signal threshold использует существующий PCM health model и RMS 240, совпадающий с
   текущим main-process silence gate.
4. Output test воспроизводит локальный 440 Hz tone длительностью 500 мс с gain 0.03 через
   exact выбранный cue sink.
5. Закрытие Settings останавливает mic diagnostic и output tone.
6. Смена input во время starting/active diagnostic выполняет последовательный Stop/Start.
7. Electron E2E запускается только при exact `CUE_E2E=1`, использует отдельный absolute
   `userData` directory и не читает пользовательский `cue-data.json`.
8. Media mocks устанавливаются Playwright init script внутри renderer; preload API и
   production IPC не получают test-only команд.
9. Packaged E2E выполняется после `pack:ci` на GitHub-hosted macOS arm64 runner.

## Non-goals

- Транскрипция, LLM, diarization или отправка аудио провайдеру.
- Изменение macOS defaults или настроек Zoom, Teams, Google Meet.
- Проверка remote/system-audio lane вместо отдельного system-capture diagnostic.
- Постоянная запись или сохранение raw audio.
- Автоматизация реального TCC prompt: permission-denied UX проверяется инъекцией адаптера,
  а stable signed package отдельно проверяется с уже выданными разрешениями.

## Acceptance criteria

1. Diagnostic запускается без любого API key и не делает сетевых запросов.
2. Exact selected input открывается, а UI показывает фактический track label/device ID.
3. Signal meter отличает healthy signal, silence и отсутствие frames.
4. Смена input выполняет controlled restart без параллельных streams и late-frame leakage.
5. Output tone применяется к exact selected cue sink либо возвращает typed failure без
   silent fallback.
6. Raw PCM, recording и device identifiers не записываются в постоянные логи.
7. Diagnostic автоматически останавливается и освобождает все tracks/audio nodes.

## Failure modes

| Failure                          | Expected behavior                                    | Test ID                  |
| -------------------------------- | ---------------------------------------------------- | ------------------------ |
| Permission denied                | Typed local error, no provider dispatch              | E2E-AUDIO-DIAG-DENY-001  |
| Selected device disconnected     | `device-unavailable`, no default fallback            | CT-AUDIO-DIAG-DEVICE-001 |
| Stream emits no frames           | `dead` after deterministic deadline                  | CT-AUDIO-DIAG-DEAD-001   |
| Input changes during Start       | Obsolete generation disposed                         | CT-AUDIO-DIAG-RACE-001   |
| Exact output sink is unsupported | Typed error, no implicit system-default substitution | CT-AUDIO-DIAG-SINK-001   |

## Test plan

| Level       | Test IDs                                    | Purpose                         |
| ----------- | ------------------------------------------- | ------------------------------- |
| Unit        | UT-AUDIO-DIAG-STATE-001                     | Deterministic state transitions |
| Mutation    | MT-AUDIO-DIAG-001                           | Lifecycle assertion strength    |
| Contract    | CT-AUDIO-DIAG-DEVICE-001, CT-AUDIO-DIAG-001 | Exact route and cleanup         |
| E2E         | E2E-AUDIO-DIAG-001, E2E-AUDIO-DIAG-DENY-001 | Provider-free UI flow           |
| Real device | RT-MAC-HYPERX-DIAG-001, RT-MAC-SONY-OUT-001 | Target hardware evidence        |

## Security and privacy

- Diagnostic is local-only and must not invoke STT/LLM adapters.
- No API key is required or read.
- UI must state that microphone signal is being sampled locally.
- Telemetry may contain state/error codes and bounded numeric health metrics only.

## Evidence captured

### Automated - 2026-07-27

- `npm run quality`: 139 tests, 100% statements, branches, functions and lines.
- `npm run test:mutation`: 814/814 mutants killed, mutation score 100%.
- `npm run pack:local`: stable `com.cue.overlay` team-signed arm64 package produced.
- GitHub Actions run `30254447031`: `quality` and `package-macos-arm64` passed for
  implementation commit `8e43bb6`.
- GitHub Actions run `30255830958`: `quality`, arm64 packaging and the new packaged
  Electron E2E step passed for commit `35311c2`.
- `UT-AUDIO-DIAG-STATE-001`: deterministic state, health, timeout and malformed-frame
  behavior.
- `CT-AUDIO-DIAG-001`: local PCM graph isolation, late-start cancellation and complete
  disposal reuse the tested `BrowserPcmCapture` contract.
- `CT-AUDIO-DIAG-SINK-001`: bounded tone graph, exact playback target, typed failures and
  complete cleanup.
- `E2E-AUDIO-DIAG-001`: Playwright launched the real renderer with synthetic HyperX/Sony
  devices, verified exact routes, healthy PCM, output tone and zero HTTP(S) requests.
- `E2E-AUDIO-DIAG-DENY-001`: both source Electron and the team-signed package converted
  an injected `NotAllowedError` into the typed local `permission-denied` UI state, made no
  provider request and returned the control to idle.
- E2E settings were isolated under a generated OS temporary directory. The runtime rejects
  missing, relative, filesystem-root and non-temporary E2E data paths.
- Packaged local E2E passed against `com.cue.overlay`, team `6VS347Y94Z`, with stable
  designated-requirement SHA-256
  `7860224d176c5e9c8edbfa97baacfbea5e8e571c9f224e265d7f5275c5848d7e`.

### Target Mac - 2026-07-27

- Environment: MacBook Air 15-inch M2, macOS 26.5.2 build 25F84.
- `RT-MAC-HYPERX-DIAG-001`: with no provider key, diagnostic opened exact
  `HyperX SoloCast (03f0:0592)`, reported healthy PCM, RMS 463-525, peak 28617 and
  1234 frames, then automatically stopped after 10 seconds.
- `RT-MAC-HYPERX-RESTART-001`: during an active built-in microphone diagnostic, selection
  changed to HyperX; the old capture stopped and a new exact HyperX capture reported
  healthy PCM without a parallel visible session.
- `RT-MAC-SETTINGS-STOP-001`: closing Settings during an active HyperX diagnostic stopped
  the capture; reopening Settings showed a stopped state.
- `RT-MAC-SONY-OUT-001`: exact `.Sony (Bluetooth)` sink remained effective and the local
  440 Hz / 500 ms tone completed without typed error or fallback; the user confirmed
  hearing the tone in the Sony headphones.

## Residual risks and follow-up

- Output tone can acoustically re-enter an open microphone. Keep it short and low-volume,
  display a warning, and do not use it for echo-cancellation acceptance.
- System-audio diagnostics require a separate flow because they cross the ScreenCaptureKit/
  CoreAudio Tap permission boundary.
- Permission denial is injected at the media-adapter boundary; automating the real macOS
  TCC prompt is intentionally excluded because it is not a deterministic CI target.
- Real TCC prompt automation remains intentionally out of scope; injected denial plus
  stable-identity target-Mac evidence are the accepted deterministic controls.
