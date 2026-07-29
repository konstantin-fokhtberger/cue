# Change specification: UI-MENUBAR-001 macOS menu bar shutdown

## Control

| Field           | Value                                  |
| --------------- | -------------------------------------- |
| Backlog ID      | UI-MENUBAR-001                         |
| Requirement IDs | FR-SHELL-002                           |
| Status          | verified                               |
| Owner           | Codex                                  |
| Target revision | spike/SPIKE-AUDIO-001-electron-capture |

## Outcome

Пользователь видит cue в строке меню macOS и может завершить приложение через пункт
`Close app`. Завершение проходит через единый graceful shutdown path, который останавливает
активный захват и освобождает ресурсы до выхода основного процесса.

## Confirmed facts

- cue является `LSUIElement`-приложением, скрывает Dock icon и не имеет стандартного меню
  приложения.
- Текущий shortcut завершения вызывает `app.quit()`.
- Текущий обработчик `will-quit` вызывает `systemAudioCapture.stop()` без ожидания Promise и
  отдельно снимает global shortcuts.
- Swift helper имеет parent-death cleanup, но это аварийная страховка, а не замена graceful
  shutdown.
- Принятая пользовательская метка пункта меню - `Close app`.

## Assumptions

- Один status item достаточен для текущей однопроцессной оболочки cue.
- Завершение renderer-процесса освобождает принадлежащий Chromium microphone stream; отдельная
  IPC-команда завершения renderer не требуется, пока real-device и E2E evidence не показывают
  обратное.

## Scope

- Один template status item в macOS menu bar на всё время жизни приложения.
- Контекстное меню с одним пользовательским действием `Close app`.
- Единый идемпотентный shutdown coordinator для menu action, shortcut и стандартного
  `app.quit()`.
- Ожидаемая остановка flush timer, system-audio helper, capture state и global shortcuts.
- Contract, unit, source/package E2E и target-Mac acceptance.

## Non-goals

- Управление capture state из menu bar.
- Показ/скрытие окна через status item.
- Несколько status items или динамическое меню.
- Изменение принятой метки на стандартную macOS `Quit cue`.
- Восстановление Electron display-media либо глобального system-audio fallback.

## Architecture and affected boundaries

- Components: `main.js`, menu bar controller, shutdown coordinator, packaged resources.
- Trust boundaries: menu action не принимает внешние данные и только инициирует локальное
  завершение.
- State transitions: `running -> shutting-down -> terminated`; повторные запросы завершения не
  запускают cleanup повторно.
- Data and retention: новые пользовательские данные не создаются и не сохраняются.

## Alternatives considered

| Option                                    | Benefits                                         | Costs and risks                                  | Decision |
| ----------------------------------------- | ------------------------------------------------ | ------------------------------------------------ | -------- |
| Только `Tray` и прямой `app.quit()`       | Минимальный diff                                 | Асинхронный helper cleanup не ожидается          | Отклонён |
| `Tray` и общий async shutdown coordinator | Детерминированный cleanup, единый lifecycle path | Небольшое усложнение lifecycle                   | Принят   |
| Отдельный native Swift status item        | Полный AppKit control                            | Дублирование shell lifecycle и высокая стоимость | Отклонён |

## Acceptance criteria

1. В течение жизни packaged cue в menu bar виден один status item с cue template icon.
2. Его меню содержит ровно один пользовательский пункт `Close app`.
3. Пункт вызывает нормальный `app.quit()` path, а не принудительное завершение процесса.
4. При активном capture system-audio helper получает stop и завершается до Electron process.
5. Flush timer, capture buffers, capture state и global shortcuts очищаются идемпотентно.
6. Завершение не отправляет provider/STT/LLM network requests.

## Failure modes

| Failure                                 | Expected behavior                                         | Test ID                    |
| --------------------------------------- | --------------------------------------------------------- | -------------------------- |
| Повторный quit во время cleanup         | Используется тот же Promise, cleanup выполняется один раз | UT-SHUTDOWN-IDEMPOTENT-001 |
| Cleanup отклоняет Promise               | Ошибка логируется, приложение всё равно завершается       | UT-SHUTDOWN-FAILURE-001    |
| Menu action вызван при активном capture | Helper останавливается до выхода Electron                 | E2E-MENUBAR-SHUTDOWN-001   |
| Status item уничтожается при shutdown   | Tray resource освобождается один раз                      | UT-MENUBAR-DISPOSE-001     |
| Иконка или label отсутствуют            | Contract gate завершается ошибкой                         | CT-MENUBAR-CLOSE-001       |

## Test plan

| Level       | Test IDs                                                                    | Purpose                                 |
| ----------- | --------------------------------------------------------------------------- | --------------------------------------- |
| Unit        | UT-SHUTDOWN-IDEMPOTENT-001, UT-SHUTDOWN-FAILURE-001, UT-MENUBAR-DISPOSE-001 | Lifecycle и idempotency                 |
| Property    | N/A                                                                         | Конечное меню без входного пространства |
| Mutation    | Автоматически для новых core-модулей                                        | Проверить значимость branches           |
| Contract    | CT-MENUBAR-CLOSE-001                                                        | Wiring, label и packaged resource       |
| Integration | E2E-MENUBAR-SHUTDOWN-001                                                    | Общий Electron quit path                |
| E2E         | Source и packaged E2E                                                       | Helper cleanup и отсутствие сети        |
| Real device | RT-MAC-MENUBAR-001                                                          | Видимость status item и реальный click  |

## Security and privacy

- Inputs and trust: статическое локальное меню без renderer-controlled labels или commands.
- Secrets: не затрагиваются.
- Provider/data boundary: shutdown не вызывает provider operations.
- Logging and redaction: логируется только категория cleanup failure без payload и секретов.

## Rollout

1. Добавить тесты и core lifecycle abstractions.
2. Подключить Tray и общий shutdown path.
3. Проверить source/package E2E.
4. Выполнить target-Mac click acceptance на подписанном package.

## Rollback

Удалить создание status item и вернуть прежний lifecycle wiring. Capture helper сохраняет
parent-death cleanup как аварийную защиту.

## Verification evidence

- CI: required on the pushed exact SHA; terminal result is recorded in the delivery handoff
- Coverage: local quality gate - 299 tests, 100% statements, branches, functions, and lines
- Mutation: 1682 killed, 4 timeout, 0 survived, 100% score
- Performance: status item не участвует в audio hot path
- Real device: signed-package status item was visible; `Close app` closed the application and
  left no cue or audio-helper process
- Package: source and signed-package E2E 19/19; local Team ID `6VS347Y94Z`, stable TCC identity

## Residual risks and follow-up

- Playwright не управляет macOS menu bar; физический status-item path покрыт отдельным
  `RT-MAC-MENUBAR-001` на целевом Mac.
