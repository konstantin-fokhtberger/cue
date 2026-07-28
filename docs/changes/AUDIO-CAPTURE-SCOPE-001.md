# Change specification: AUDIO-CAPTURE-SCOPE-001 verified application capture

## Control

| Field           | Value                                    |
| --------------- | ---------------------------------------- |
| Backlog ID      | AUDIO-CAPTURE-SCOPE-001                  |
| Requirement IDs | FR-AUDIO-003, FR-AUDIO-010, FR-PRIV-007  |
| Status          | in_progress                              |
| Owner           | project maintainer                       |
| Target revision | `spike/SPIKE-AUDIO-001-electron-capture` |

## Outcome

Meeting PCM can reach transcription only when the helper resolves and verifies the exact
user-selected application instance. Missing, ambiguous, stale, or diagnostic-global scope fails
closed.

## Confirmed facts

- The current tap is global and can include unrelated browser video, music, notifications, and
  cue-owned playback.
- CoreAudio exposes audio process object IDs, PIDs, bundle IDs, and associated devices, but no
  Chrome tab identity.
- The accepted Chrome boundary is all audible tabs in one selected browser instance.
- Bundle-ID-only matching can merge multiple Chrome instances and therefore cannot satisfy the
  accepted boundary.
- ADR-007 already requires application inventory, explicit selection, browser-wide disclosure,
  and no global fallback.

## Assumptions

- A responsible application instance can be represented by its current PID plus bundle ID.
- CoreAudio helper processes can be attributed to that instance through bounded parent-process
  ancestry.
- A restarted responsible application receives a new PID and invalidates the selected scope.

## Scope

- Inventory active output processes without collecting command lines, URLs, titles, or content.
- Normalize helper processes to one responsible application instance.
- Present requested and effective scope in the UI.
- Require explicit Chrome browser-wide acknowledgement.
- Resolve the selected instance to an inclusion-only CoreAudio process tap.
- Use only devices associated with the selected process set.
- Exclude cue-owned processes and fail closed on ambiguity, disappearance, restart, or route
  invalidation.
- Prevent provider dispatch until effective scope is verified.

## Non-goals

- Exact Chrome tab capture.
- Automatic application selection.
- Cross-provider fallback.
- Process restart recovery without explicit user confirmation.
- ScreenCaptureKit or global-mix fallback.

## Architecture and affected boundaries

- Components: Swift inventory/resolver, CoreAudio inclusion tap, Electron policy/IPC, scope UI,
  provider dispatch gate.
- Trust boundaries: process metadata, PID ancestry, renderer IPC, stale inventory, provider
  boundary.
- State transitions: absent -> inventory -> requested -> verified -> stale/disappeared -> stopped.
- Data and retention: application identity and sanitized resolution state only; no process command
  lines or meeting content.

## Alternatives considered

| Option                              | Benefits                         | Costs and risks                               | Decision |
| ----------------------------------- | -------------------------------- | --------------------------------------------- | -------- |
| Bundle ID only                      | Simple                           | Merges multiple instances and Chrome profiles | Rejected |
| CoreAudio object IDs from inventory | Exact at one instant             | IDs are ephemeral and inventory becomes stale | Rejected |
| Responsible PID + bundle ID         | Instance-bound and explainable   | Requires bounded process ancestry resolution  | Accepted |
| Auto-restore after process restart  | Lower user friction              | Can bind to the wrong new instance            | Rejected |
| Fail closed after restart           | Strong privacy and session truth | Requires explicit user restart                | Accepted |

## Acceptance criteria

1. Inventory returns normalized responsible application instances with stable fields for the
   current inventory generation.
2. Two fixtures with different responsible PIDs can be selected independently.
3. Multiple matching instances remain distinct and never collapse to bundle-ID-only selection.
4. Selected source disappearance or PID restart invalidates scope without global fallback.
5. cue-owned process ancestry is excluded.
6. Requested and effective scope remain visible throughout the active session.
7. Diagnostic-global capture cannot reach provider dispatch.
8. Chrome is labeled `Google Chrome - all audible tabs in this browser instance` and requires
   acknowledgement.
9. Zoom and Chrome target-Mac tests show selected signal and unrelated-fixture rejection.
10. Resolver, policy, IPC, and lifecycle logic meet structural and mutation gates.

## Failure modes

| Failure                    | Expected behavior                   | Test ID                          |
| -------------------------- | ----------------------------------- | -------------------------------- |
| Empty bundle identity      | Explicit unresolved source          | UT-SCOPE-EMPTY-IDENTITY-001      |
| Multiple app instances     | Separate selectable instances       | CT-SCOPE-INSTANCE-001            |
| Stale inventory generation | Start rejected; refresh required    | CT-SCOPE-STALE-001               |
| Selected process exits     | Scope becomes stale; no fallback    | E2E-CAPTURE-SCOPE-EXIT-001       |
| Chrome not acknowledged    | Start rejected locally              | E2E-BROWSER-SCOPE-DISCLOSURE-001 |
| cue output is active       | Zero accepted remote-channel signal | RT-MAC-SELF-AUDIO-001            |

## Test plan

| Level       | Test IDs                                                                                     | Purpose                       |
| ----------- | -------------------------------------------------------------------------------------------- | ----------------------------- |
| Unit        | UT-SCOPE-RESOLVER-001, UT-SCOPE-EMPTY-IDENTITY-001                                           | normalization and fail-closed |
| Property    | PT-SCOPE-PROCESS-GRAPH-001                                                                   | ancestry graph combinations   |
| Mutation    | MT-SCOPE-POLICY-001, MT-SCOPE-INVENTORY-001                                                  | policy assertion strength     |
| Contract    | CT-CAPTURE-SCOPE-001, CT-SCOPE-INSTANCE-001, CT-SCOPE-LIVE-INVENTORY-001, CT-SCOPE-STALE-001 | IPC, resolver, live inventory |
| Integration | CT-NO-GLOBAL-STT-001                                                                         | provider boundary             |
| E2E         | E2E-CAPTURE-SCOPE-001, E2E-BROWSER-SCOPE-DISCLOSURE-001                                      | selection and disclosure UI   |
| Real device | RT-MAC-APP-SCOPE-001, RT-MAC-SELF-AUDIO-001                                                  | isolation and self-exclusion  |

## Security and privacy

- Inputs and trust: process metadata and renderer scope requests are untrusted.
- Secrets: none.
- Provider/data boundary: only verified application PCM may be dispatched.
- Logging and redaction: PID, bundle ID, display label, and resolution status only.

## Rollout

- Reuse the versioned stdin control channel from `BUG-AUDIO-004`.
- Enable provider dispatch only after resolver, UI, and target-Mac isolation evidence pass.

## Rollback

- Disable system-audio provider dispatch and retain explicit degraded state. Never fall back to
  diagnostic-global capture.

## Implemented vertical slice

- Pure Swift resolver model accepts only a current inventory generation and exact responsible
  PID plus bundle ID.
- Audio helper processes are grouped through bounded ancestry under one regular responsible
  application while simultaneous same-bundle application instances remain separate.
- cue-owned ancestry, cycles, missing process metadata, excessive ancestry depth, and missing
  responsible identity produce explicit non-selectable states.
- Device UIDs are normalized and deduplicated; a selected source without an associated output
  device fails closed.
- Chrome and Chrome variants require explicit browser-wide acknowledgement.
- The platform adapter composes active CoreAudio process objects, PIDs, bundle IDs, and output
  device UIDs with bounded AppKit/libproc ancestry into the pure resolver.
- Missing or invalid CoreAudio process identity is skipped fail-closed; missing process metadata,
  responsible identity, or cue-owned ancestry remains explicitly non-selectable.
- Direct CoreAudio, AppKit, and libproc calls are isolated behind injected ports; cue-owned and
  application classification remains in the structurally covered platform policy.
- Renderer selection UI, application-scope control protocol, and inclusion-tap wiring remain
  outside this slice.

## Verification evidence

- CI: resolver slice passed [Pull request quality run 30364461891](https://github.com/konstantin-fokhtberger/cue/actions/runs/30364461891);
  the changed live-inventory slice is pending.
- Coverage: `CaptureScopeResolver.swift` passed the Swift structural gate with 26/26 functions,
  27/27 instantiations, 187/187 lines, and 61/61 regions. The expanded
  `CoreAudioTapPlatform.swift` passed with 34/34 functions, 34/34 instantiations, 284/284 lines,
  and 102/102 regions.
- Mutation: all 16 resolver-specific and all 12 live-inventory-specific mutants were killed; the
  complete local Swift gate killed 102/102 viable mutants with 0 survived and 0 unviable.
- Performance: pending.
- Real device: pending.
- Package: the changed live-inventory slice passed local arm64 ad-hoc packaging, strict signing
  inspection, and packaged E2E 9/9; changed CI package evidence is pending.
- Provider boundary: `CT-NO-GLOBAL-STT-001` policy rejects absent, inherited, diagnostic-global,
  and unverified scopes. The pure resolver and injected live inventory composition are verified;
  live CoreAudio metadata acceptance and application-scope IPC integration remain pending.

## Residual risks and follow-up

- Chromium process ancestry may change across releases and requires target-Mac regression.
- Teams remains unverified until a conference is available.
