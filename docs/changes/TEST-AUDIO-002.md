# Change specification: TEST-AUDIO-002 meeting application and audio route matrix

## Control

| Field           | Value                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Backlog ID      | TEST-AUDIO-002                                                                                                   |
| Requirement IDs | FR-AUDIO-001, FR-AUDIO-002, FR-AUDIO-006, FR-AUDIO-007, FR-AUDIO-010, FR-SESSION-003; NFR-PERF-001, NFR-COMP-001 |
| Status          | in_progress                                                                                                      |
| Owner           | project maintainer                                                                                               |
| Target revision | current audio feasibility branch                                                                                 |

## Outcome

Получить воспроизводимую и проверяемую матрицу meeting application x audio route, которая
отделяет deterministic application/Electron coverage от фактического результата на целевом Mac.
Недоступный сценарий остается явным release gap и не получает статус `passed` по результатам
fixture-теста.

## Confirmed facts

- Подписанный пакет уже получил ненулевой system PCM в двухучастниковых Google Meet и Zoom.
- Изоляция application scope для browser-wide Chrome и Zoom проверена отдельно от Spotify.
- HyperX SoloCast input и Sony Bluetooth output работают как независимые cue routes.
- Microsoft Teams conference сейчас недоступна и остается непроверенным release requirement.
- STT еще не реализован, поэтому критерий transcript из полной acceptance matrix не может быть
  закрыт этим пакетом.
- GitHub-hosted macOS runner не является целевым Mac и не имеет пользовательских TCC grants,
  физических HyperX/Sony routes или живых meeting applications.

## Assumptions

- Google Meet automation использует принятый browser-wide Chrome scope. Отдельный tab-level
  capture не вводится.
- Deterministic E2E доказывает только cue selection, application-scope contract, разделение
  microphone/system resources и Stop lifecycle.
- Выбор input/output внутри meeting application считается `unknown`, пока он не прочитан
  устойчивым автоматическим способом или не подтвержден вручную.

## Scope

1. Добавить source и packaged Electron E2E для Zoom и browser-wide Chrome/Meet.
2. Для каждого доступного application scope проверить:
   - built-in input/output;
   - Sony Bluetooth input/output;
   - HyperX USB input + Sony Bluetooth output;
   - explicit HyperX cue override при несовпадающем default route.
3. Проверить exact cue input/output, browser acknowledgement, verified native application
   scope, независимый lifecycle microphone/helper, Stop cleanup и отсутствие provider traffic.
4. Обновить backlog и traceability без ложного закрытия Teams, transcript или полной
   real-device matrix.

## Non-goals

- Автоматическое создание Zoom, Teams или Google Meet conferences.
- Имитация remote participant speech как доказательство реального CoreAudio capture.
- Чтение внутренних настроек meeting applications через undocumented files or APIs.
- Transcript/STT acceptance.
- Закрытие `TEST-AUDIO-002` до выполнения всех real-device и participant-count rows.
- Добавление tab-level Chrome capture.

## Architecture and affected boundaries

- Components: Electron E2E fixture, native-helper test double, planning and traceability docs.
- Trust boundaries: fixture PCM never counts as real meeting evidence and never reaches provider.
- State transitions: settings selection -> verified application scope -> active capture -> Stop.
- Data and retention: synthetic PCM remains process-local; raw fixture audio is not persisted.

## Alternatives considered

| Option                                                         | Benefits                                                | Costs and risks                                                            | Decision |
| -------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| Mark existing real smokes as the complete matrix               | No implementation cost                                  | False coverage claim; no route or participant breadth                      | Rejected |
| Automate meeting UIs through brittle selectors                 | Can create closer-to-live flows                         | Authentication, anti-automation, UI drift and TCC make CI nondeterministic | Deferred |
| Deterministic Electron matrix plus separate real-device ledger | Stable regression coverage and honest evidence boundary | Cannot prove CoreAudio, participants or transcript alone                   | Accepted |
| Add tab-level Chrome capture                                   | Narrower Meet scope                                     | Extra architecture and privacy complexity without accepted product value   | Rejected |

## Acceptance criteria

1. Zoom and Chrome/Meet execute the four feasible cue-route variants in source Electron E2E.
2. The same matrix passes against the packaged application.
3. Chrome capture cannot start without explicit browser-wide acknowledgement.
4. Each case opens the exact requested cue microphone and applies the exact cue output.
5. Native helper reports the exact requested and verified application identity.
6. Stop disposes microphone and helper once and accepts no subsequent microphone PCM.
7. No matrix case performs a provider/network request.
8. Teams, meeting-app device selections, transcript and multiple-participant rows remain
   explicitly unverified.
9. Existing 100% JavaScript structural coverage, mutation, Swift structural/mutation and
   packaging gates remain green.

## Test plan

| Level       | Test ID                          | Purpose                                               |
| ----------- | -------------------------------- | ----------------------------------------------------- |
| E2E         | E2E-AUDIO-MATRIX-ZOOM-001        | Zoom x four deterministic cue-route variants          |
| E2E         | E2E-AUDIO-MATRIX-MEET-001        | Browser-wide Chrome/Meet x four cue-route variants    |
| E2E         | E2E-BROWSER-SCOPE-DISCLOSURE-001 | Chrome requires accurate acknowledgement              |
| Stress      | STRESS-CAPTURE-100-001           | Repeated microphone/helper cleanup                    |
| Real device | RT-MAC-AUDIO-MATRIX-001          | Full accepted meeting-app/device/participant evidence |
| Performance | PERF-STOP-001                    | Target-Mac p95 Stop latency <= 500 ms                 |

## Risks

- Deterministic fixtures can regress into being described as platform evidence. Test names,
  documentation and traceability must retain the evidence boundary.
- The accepted requirements currently repeat one fixed `app override` definition for every
  device row. This creates semantically duplicate cells and should be normalized before the
  final real-device campaign.
- Browser-wide Chrome may include unrelated audible tabs by design; the acknowledgement remains
  mandatory and the scope must not be labeled as Meet-only.
- Teams may differ in CoreAudio process topology and cannot be inferred from Zoom or Chrome.

## Rollout

- Land the deterministic matrix on the current audio feasibility branch.
- Keep `TEST-AUDIO-002` in progress.
- Run the real-device rows incrementally when the required conference, routes and participant
  counts are available.

## Rollback

- Remove the matrix fixture cases without changing production capture behavior.
- Preserve the real-device evidence and controlled gaps in planning documents.

## Verification evidence

- `E2E-AUDIO-MATRIX-ZOOM-001` passes four deterministic cue-route variants against the
  exact verified `us.zoom.xos` application scope.
- `E2E-AUDIO-MATRIX-MEET-001` passes the same four variants against acknowledged browser-wide
  `com.google.Chrome` capture. The test and UI retain the browser-wide label.
- Every route case records independent synthetic macOS defaults, opens the exact requested cue
  input, applies the exact cue output, starts one verified helper, stops both resources and
  observes zero post-Stop microphone PCM or provider traffic.
- Full source Electron E2E passes 17/17 scenarios.
- A team-signed local package retained `Identifier=com.cue.overlay`,
  `TeamIdentifier=6VS347Y94Z` and the accepted designated-requirement fingerprint.
- Full packaged Electron E2E passes 17/17 scenarios.
- The first packaged run exposed an assertion race in `E2E-CAPTURE-RECOVERY-001`: browser
  resources were already disposed, but the test read the helper log before its final `stop`
  record. The assertion now waits for the fourth lifecycle event; the focused and complete
  packaged reruns pass.
- JavaScript quality passes 291 tests at 100% statements (769/769), branches (443/443),
  functions (148/148) and lines (749/749).
- Mutation gate passes at 100% with 1,651 killed, 4 timed out and 0 survived.
- Two moderate transitive `uuid` advisories remain visible; the accepted production audit gate
  blocks at `high`.
- Teams, real meeting-app device settings, transcript, full participant-count coverage and the
  final target-Mac route matrix remain unverified. `TEST-AUDIO-002` therefore remains
  `in_progress`.
