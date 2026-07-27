# Change specification: AUDIO-DEVICE-001 explicit cue microphone selection

## Control

| Field           | Value                                    |
| --------------- | ---------------------------------------- |
| Backlog ID      | AUDIO-DEVICE-001                         |
| Requirement IDs | FR-AUDIO-001, FR-AUDIO-007, FR-AUDIO-008 |
| Status          | proposed                                 |
| Owner           | project maintainer                       |
| Target revision | after ADR-005 acceptance                 |

## Outcome

Отделить выбор микрофона cue от macOS default и внутренних настроек Zoom, Teams и Google
Meet. Пользователь должен явно видеть, какой input запросил cue и какой input был фактически
открыт.

## Confirmed facts

- macOS default input/output и настройки конкретного meeting-приложения могут различаться.
- Browser/Electron `getUserMedia()` без точного `deviceId` использует доступный default, а не
  гарантированно тот же микрофон, который выбрало другое приложение.
- Track label cue подтверждает только effective device cue. Он не доказывает настройки Meet,
  Zoom или Teams.

## Proposed implementation policy

1. cue имеет собственный selector микрофона.
2. При отсутствии cue-specific selection используется macOS default, явно обозначенный как
   fallback.
3. После открытия stream cue отображает requested и effective device.
4. Недоступный requested device не заменяется другим микрофоном молча.
5. Автоматическое чтение приватных настроек meeting-приложений не входит в capture contract.
   В real-device evidence эти настройки фиксируются отдельно либо получают статус `unknown`.

Политика становится обязательной для реализации только после принятия ADR-005.

## Acceptance criteria

1. При macOS default input `Sony` cue может явно открыть `HyperX SoloCast`.
2. Requested и effective device доступны UI и диагностике без записи raw audio.
3. Если requested device исчез, session переходит в degraded/error либо предлагает явный
   fallback; другой input не открывается молча.
4. Повторный Start не создает второй stream для того же выбора.
5. Смена cue selection проходит через controlled restart и generation cancellation.
6. Real-device evidence отдельно содержит macOS defaults, meeting-app selections, cue
   requested input и cue effective input.

## Test plan

| Level       | Test ID                     | Purpose                                     |
| ----------- | --------------------------- | ------------------------------------------- |
| Unit        | UT-AUDIO-DEVICE-POLICY-001  | Explicit selection and default fallback     |
| Contract    | CT-AUDIO-DEVICE-POLICY-001  | Exact device constraints and no silent swap |
| E2E         | E2E-AUDIO-DEVICE-SELECT-001 | Selector and effective-device presentation  |
| Real device | RT-MAC-APP-OVERRIDE-001     | macOS Sony, meeting app HyperX, cue HyperX  |
| Mutation    | MT-AUDIO-DEVICE-POLICY-001  | Fallback and mismatch assertion strength    |

## Risks

- Device labels may be unavailable before microphone permission is granted.
- Browser device IDs may change after permission reset or device reconnection.
- Automatically reverse-engineering settings of each meeting app would be brittle,
  privacy-sensitive, and expensive to maintain.
- System audio is a mixed capture lane; output-device evidence does not provide remote
  speaker identity.
