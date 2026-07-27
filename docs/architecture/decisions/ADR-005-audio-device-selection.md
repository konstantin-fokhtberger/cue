# ADR-005: independent cue microphone selection

- Status: Proposed
- Date: 2026-07-27

## Context

На macOS существуют независимые уровни конфигурации audio devices:

1. macOS default input/output.
2. Input/output, выбранные внутри Zoom, Microsoft Teams или Google Meet.
3. Устройство, которое запрашивает и фактически открывает cue.

Например, macOS может использовать Sony как default input/output, а Google Meet - HyperX
SoloCast input и Sony output. Вызов cue без точного `deviceId` не гарантирует захват того же
микрофона, который использует meeting-приложение.

## Options

| Option                                              | Benefits                                                        | Costs and risks                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Всегда использовать macOS default                   | Минимальная реализация                                          | cue может захватывать не тот микрофон, который использует встреча                   |
| Пытаться автоматически читать настройки meeting app | Возможное автоматическое согласование                           | Нет стабильного общего API, высокая связность, хрупкая автоматизация и privacy risk |
| Собственный cue selector с явным fallback           | Детерминированный выбор, прозрачно для пользователя, тестируемо | Дополнительный UI, device lifecycle и recovery logic                                |

## Proposed decision

Использовать собственный selector микрофона cue:

- точный cue selection имеет приоритет;
- macOS default применяется только при отсутствии cue selection;
- UI и диагностика показывают requested и effective device;
- недоступный requested device не заменяется другим input молча;
- настройки meeting-приложения не считаются доступными через capture contract и фиксируются
  как отдельное test evidence.

## Consequences

- `MicrophoneCapturePort` принимает explicit device selection вместо неявного default-only
  поведения.
- Device disappearance и смена selection проходят через session lifecycle и generation
  cancellation.
- Для Zoom/Teams/Meet real-device matrix требуется два варианта: aligned и app override.
- Автоматическое обнаружение mismatch с meeting app не обещается, если приложение не
  предоставляет стабильный публичный интерфейс.

## Acceptance evidence

- `CT-AUDIO-DEVICE-POLICY-001`.
- `E2E-AUDIO-DEVICE-SELECT-001`.
- `RT-MAC-APP-OVERRIDE-001`.
- Change specification `AUDIO-DEVICE-001`.
