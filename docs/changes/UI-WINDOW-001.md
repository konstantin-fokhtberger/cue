# Change specification: UI-WINDOW-001 dedicated overlay drag region

## Control

| Field           | Value                            |
| --------------- | -------------------------------- |
| Backlog ID      | UI-WINDOW-001                    |
| Requirement IDs | FR-SHELL-001                     |
| Status          | verified                         |
| Owner           | project maintainer               |
| Target revision | current audio feasibility branch |

## Outcome

Пользователь может предсказуемо перемещать frameless overlay cue за отдельную видимую область
в верхней части окна, не попадая в кнопки и другие интерактивные элементы.

## Confirmed facts

- `BrowserWindow` создается с `frame: false`, поэтому стандартная macOS title bar отсутствует.
- Текущий `#toolbar` помечен как `-webkit-app-region: drag`.
- Все кнопки помечены `-webkit-app-region: no-drag`, а почти вся видимая площадь toolbar занята
  кнопками. Практически доступными остаются только узкие зазоры и divider-ы.
- В интерфейсе нет отдельного видимого или семантически обозначенного drag handle.

## Assumptions

- Chromium `-webkit-app-region` остается поддерживаемым Electron механизмом перемещения
  frameless window на целевой macOS.
- Cross-display acceptance требует двух доступных display spaces и поэтому остается отдельной
  проверкой на целевом Mac.

## Scope

1. Добавить ровно одну отдельную drag region в верхний toolbar.
2. Сделать ее визуально различимой и снабдить семантическим label/tooltip.
3. Сделать toolbar и все интерактивные controls явно `no-drag`.
4. Автоматически проверить структуру, rendered geometry, отсутствие overlap и неизменность
   always-on-top state.
5. Физическим OS input проверить native movement и отсутствие влияния на capture state.

## Non-goals

- Кастомная логика pointer tracking или ручное вычисление coordinates.
- Запоминание позиции окна между перезапусками.
- Window snapping, resize handles или автоматический выбор display.
- Изменение always-on-top, content protection или workspace behavior.

## Architecture and affected boundaries

- Components: renderer HTML/CSS and packaged Electron E2E.
- Trust boundaries: no new IPC or privileged API.
- State transitions: pointer drag changes only native window bounds.
- Data and retention: no state is persisted.

## Alternatives considered

| Option                                            | Benefits                               | Costs and risks                                            | Decision |
| ------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------- | -------- |
| Keep whole toolbar draggable                      | No visual change                       | Buttons remove nearly all usable drag area                 | Rejected |
| Implement pointer events plus IPC window movement | Full control                           | Extra privileged surface, coordinate and display-edge bugs | Rejected |
| Add a dedicated CSS application drag region       | Native Electron behavior, minimal code | Requires explicit no-drag contract and real-window test    | Accepted |

## Acceptance criteria

1. Верхний toolbar содержит ровно одну dedicated drag region.
2. Region имеет ненулевую видимую площадь, tooltip и accessibility label.
3. Region не содержит интерактивных controls и не пересекает их bounding boxes.
4. Toolbar и controls вне region остаются `no-drag`.
5. Rendered packaged E2E подтверждает native drag CSS, размеры handle и отсутствие overlap.
6. Физический drag меняет native `BrowserWindow` bounds.
7. Capture остается активным во время drag и корректно останавливается после него.
8. Always-on-top state не меняется.
9. Target-Mac multi-display проверка подтверждает перенос между display spaces.

## Test plan

| Level       | Test ID                      | Purpose                                       |
| ----------- | ---------------------------- | --------------------------------------------- |
| Contract    | CT-WINDOW-DRAG-REGION-001    | Exact HTML/CSS structure and no-drag boundary |
| E2E         | E2E-WINDOW-DRAG-REGION-001   | Rendered handle geometry and overlay flags    |
| Real device | RT-MAC-MULTIDISPLAY-DRAG-001 | Move overlay between two connected displays   |

## Risks

- Playwright renderer pointer input does not synthesize native macOS window movement; physical
  OS input is mandatory for the movement assertion.
- A single-display E2E cannot prove cross-display movement.
- A handle that is too small technically passes structure tests but remains inconvenient;
  minimum dimensions are part of the contract.
- Settings scrim covers the toolbar while open; the overlay is movable from its normal operating
  state, not through modal settings.

## Rollout

- Ship the handle in the existing toolbar without changing window creation flags.
- Perform target-Mac physical drag after packaged E2E.

## Rollback

- Remove the handle and restore the prior toolbar CSS without changing main-process behavior.

## Verification evidence

- `CT-WINDOW-DRAG-REGION-001` verifies one labeled non-interactive handle, exact drag/no-drag
  CSS boundaries and minimum `44 x 28` dimensions.
- `E2E-WINDOW-DRAG-REGION-001` verifies the rendered `44 x 28` handle, zero overlap with all
  toolbar buttons, computed `-webkit-app-region: drag`, `cursor: grab`, unchanged inactive
  capture and always-on-top state.
- Full source Electron E2E passes 18/18 scenarios.
- Full packaged Electron E2E passes 18/18 scenarios.
- The local package retains `Identifier=com.cue.overlay`, `TeamIdentifier=6VS347Y94Z` and the
  accepted designated-requirement fingerprint.
- JavaScript quality passes 293 tests at 100% statements (769/769), branches (443/443),
  functions (148/148) and lines (749/749).
- Mutation gate passes at 100% with 1,651 killed, 4 timed out and 0 survived.
- A Playwright renderer drag did not synthesize native macOS movement, as expected for this
  platform boundary. A Computer Use drag action also produced no observable bounds change and
  is not accepted as physical evidence.
- `RT-MAC-MULTIDISPLAY-DRAG-001`: the target Mac had the built-in Color LCD
  (`1710 x 1107`) and Mi Monitor (`3440 x 1440`) connected. The product owner physically moved
  the signed-package cue window within a display and between both displays using the new handle,
  and confirmed that adjacent controls remained operable.
- Physical native movement and cross-display acceptance pass. `UI-WINDOW-001` is complete.
