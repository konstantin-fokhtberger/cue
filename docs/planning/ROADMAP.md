# Delivery roadmap

## Phase 0: Engineering baseline

### Objective

Establish requirements, architecture, quality gates, process, backlog, and traceability before runtime changes.

### Exit evidence

- Documentation set reviewed and accepted.
- Open product decisions assigned.
- Initial backlog prioritized.
- CI/test tooling backlog ready.

## Phase 1: Audio feasibility

### Objective

Prove reliable separate microphone and system-audio capture on the target Mac.

### Scope

- Supported modern Electron evaluation.
- CoreAudio Tap packaging and permissions.
- Dead-stream detection.
- Zoom, Teams, and Meet.
- Built-in and Bluetooth routes.
- Repeated lifecycle and sleep/wake behavior.
- Swift ScreenCaptureKit fallback decision.

### Exit gate

ADR-002 is accepted or replaced based on recorded evidence.

## Phase 2: Testable foundation

### Objective

Create the architecture needed for reliable meeting development.

### Scope

- Test framework and coverage enforcement.
- Mutation testing.
- Session state machine.
- Capture ports and fake adapters.
- Provider policy.
- Timeline model.
- Keychain.
- IPC schema and security baseline.
- CI and self-hosted target-Mac runner.

### Exit gate

All foundation P0 requirements are automated and pass quality gates.

## Phase 3: Meeting MVP

### Objective

Deliver a reliable meeting copilot for the primary workflow.

### Scope

- Realtime transcription.
- Remote speaker diarization.
- Session timeline.
- Reply suggestion.
- Follow-up questions.
- Recap, decisions, and action items.
- Speaker rename.
- Capture/provider/attachment status UI.

### Exit gate

Zoom, Teams, and Meet pass the accepted device and participant matrix with no open P0/P1 defects.

## Phase 4: Reliability and daily-use packaging

### Objective

Make the application safe and stable for daily personal use.

### Scope

- Long-session and fault-injection testing.
- Performance and resource SLOs.
- Signing, hardened runtime, notarization.
- Stable permission identity.
- Sanitized diagnostics.
- Upgrade and rollback procedure.

## Phase 5: Interview copilot

### Objective

Add the second-priority profile without weakening meeting reliability.

### Scope

- Professional context policy.
- Interview-specific prompts.
- Concise answer modes.
- Interview regression corpus.

## Phase 6: Screen and coding assistant

### Objective

Add explicit screen-based assistance as an isolated capability.

### Scope

- Explicit screenshot capture.
- Coding response modes.
- Screen-content safety and prompt-injection tests.
- Language and formatting preferences.
