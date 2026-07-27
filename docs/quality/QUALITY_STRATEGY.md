# Quality and automated testing strategy

## 1. Quality objective

The objective is not merely to reach a coverage number. The objective is to make every accepted behavior, failure mode, boundary, and regression executable and reviewable.

## 2. Quality model

| Layer                  | Purpose                                  | Examples                                          |
| ---------------------- | ---------------------------------------- | ------------------------------------------------- |
| Requirement acceptance | Prove user-visible outcomes              | Stop means stop, selected provider receives audio |
| Unit                   | Exhaust pure logic and state transitions | Session state machine, timeline correction        |
| Property-based         | Explore broad input/state spaces         | Event ordering, bounded buffers, idempotency      |
| Mutation               | Detect weak or missing assertions        | Lifecycle guards, provider routing, retention     |
| Contract               | Ensure adapters obey one interface       | Fake, Electron, Swift, STT providers              |
| Integration            | Exercise connected components            | Capture -> buffer -> STT -> timeline              |
| Electron E2E           | Validate UI, IPC, and process boundaries | Start/Stop, settings, errors, session UI          |
| Real-device            | Validate macOS and meeting applications  | CoreAudio Tap, permissions, Bluetooth             |
| Packaging/security     | Validate installable artifact            | Signing, notarization, entitlements, Gatekeeper   |

## 3. Coverage policy

### Required

- Lines: 100%.
- Statements: 100%.
- Functions: 100%.
- Branches: 100%.
- Accepted P0/P1 requirements with automated acceptance evidence: 100%.

### Scope

Included:

- domain logic;
- application use cases;
- provider routing and policy;
- IPC validation;
- Electron main and preload project logic;
- renderer behavior;
- macOS helper project logic if introduced.

Excluded by default:

- generated output;
- vendored or third-party packages;
- declarations with no executable behavior.

No other exclusion is automatic.

## 4. Mutation policy

Critical modules require a 100% mutation score:

- session lifecycle;
- capture generation and cancellation;
- provider selection and fallback policy;
- transcript session isolation and retention;
- timeline ordering and correction;
- credential redaction and IPC validation.

Other project-owned domain modules target at least 90%, subject to explicit acceptance before implementation begins.

Equivalent, timeout, and technically unviable mutants must be documented individually. Bulk ignore patterns are prohibited.

## 5. Critical test scenarios

### Lifecycle and concurrency

- Double Start.
- Stop during permission request.
- Stop during stream creation.
- Callback from an obsolete generation.
- Renderer crash during active capture.
- Provider request completes after session end.
- Sleep/wake.
- Audio route change.
- macOS default input differs from the meeting-app input.
- cue explicitly selects a non-default microphone and reports the effective device.
- requested cue microphone disappears; no silent fallback to another input occurs.
- Dead stream with active-looking track.
- Repeated Start/Stop under randomized callback order.

### Provider privacy

- One key configured.
- Several keys configured.
- Selected provider succeeds.
- Selected provider fails.
- Fallback disabled.
- Fallback explicitly enabled.
- Provider timeout and retry.
- Error sanitization.
- No audio or transcript from session N appears in session N+1.

### Transcript

- Partial replacement.
- Finalization.
- Out-of-order provider results.
- Duplicate result delivery.
- Diarization label correction.
- Speaker rename.
- Retention limit.
- Four-hour synthetic session.

## 6. Real-device automation

macOS capture and TCC behavior require a self-hosted test runner on the target Mac.

The automated runner should:

1. Start a deterministic local audio fixture.
2. Start the packaged cue build with permissions already provisioned for the stable signed identity.
3. Record macOS defaults, meeting-app selections, cue requested input, and cue effective input
   as independent evidence fields.
4. Capture microphone and system channels.
5. Compare received audio fingerprints and timestamps.
6. Execute repeated Start/Stop cycles.
7. Verify no frames are accepted after Stop.
8. Run meeting-application scenarios where automation is technically stable.

Permission dialogs themselves are not a reliable CI target. Permission-denied behavior is tested through injected adapters; the real runner verifies the already-provisioned signed application.

## 7. Defect escape policy

A defect found by the user is recorded as an escaped defect.

Before closure:

1. Reproduce it or document why reproduction is unavailable.
2. Identify the missing or ineffective test.
3. Add a failing regression test.
4. Fix the defect.
5. Run mutation analysis around the affected control.
6. Update requirement, risk, and traceability records.
7. Check for sibling failure modes.

The target is zero escaped P0/P1 defects. The process does not make the mathematically invalid claim that testing proves the absence of all possible defects.

## 8. Pull request gates

Every production change must pass:

- formatting and lint;
- static type checking after the TypeScript decision is accepted;
- unit and property-based tests;
- 100% structural coverage;
- required mutation suite;
- contract and integration tests;
- Electron E2E tests;
- dependency and security checks;
- build and package verification;
- traceability validation.

Changes affecting capture, permissions, signing, or macOS integration also require the target-Mac gate.

## 9. Test evidence

Each change stores:

- command and environment;
- pass/fail result;
- coverage summary;
- mutation summary;
- relevant benchmark/SLO result;
- packaged artifact identity when applicable;
- unresolved limitations.

CI output is evidence, not the only record. The change specification links the durable result.
