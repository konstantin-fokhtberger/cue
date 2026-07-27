# Change specification: AUDIO-DIAG-001 provider-free local audio diagnostics

## Control

| Field           | Value                                                  |
| --------------- | ------------------------------------------------------ |
| Backlog ID      | AUDIO-DIAG-001                                         |
| Requirement IDs | FR-AUDIO-001, FR-AUDIO-004, FR-AUDIO-008, FR-AUDIO-009 |
| Status          | proposed                                               |
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

## Non-goals

- Транскрипция, LLM, diarization или отправка аудио провайдеру.
- Изменение macOS defaults или настроек Zoom, Teams, Google Meet.
- Проверка remote/system-audio lane вместо отдельного system-capture diagnostic.
- Постоянная запись или сохранение raw audio.

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

## Residual risks and follow-up

- Output tone can acoustically re-enter an open microphone. Keep it short and low-volume,
  display a warning, and do not use it for echo-cancellation acceptance.
- System-audio diagnostics require a separate flow because they cross the ScreenCaptureKit/
  CoreAudio Tap permission boundary.
