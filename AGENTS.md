# Repository working agreement

## Language and communication

- Project documentation is written in Russian unless an external interface requires English.
- Code identifiers, API names, test names, and commit prefixes remain in English.
- Separate confirmed facts, assumptions, open decisions, risks, and recommendations.
- Do not claim that a feature works until its acceptance tests and required evidence pass.

## Product priorities

1. Meeting copilot for Zoom, Microsoft Teams, and Google Meet on macOS.
2. Interview copilot.
3. Screen and coding assistant.

The first supported device is a MacBook Air 15-inch with Apple M2 running macOS 26.5.2 build 25F84. Broader macOS compatibility is not implied until tested and accepted.

## Source of truth

- Product scope and outcomes: `docs/product/PRD.md`.
- Detailed requirements: `docs/product/REQUIREMENTS.md`.
- Architecture: `docs/architecture/ARCHITECTURE.md` and accepted ADRs.
- Quality gates: `docs/quality/QUALITY_STRATEGY.md`.
- Delivery workflow: `docs/process/DEVELOPMENT_PROCESS.md`.
- Work priority and status: `docs/planning/BACKLOG.md`.
- Requirement-to-test mapping: `docs/planning/TRACEABILITY.md`.

When these artifacts conflict, stop and resolve the conflict before implementation. Current explicit user instructions take precedence and must then be reflected in the canonical documents.

## Change protocol

Before changing production code:

1. Identify the requirement IDs and backlog item.
2. Confirm acceptance criteria and open decisions.
3. Create or update a change specification from `docs/templates/CHANGE_SPEC.md`.
4. Write failing automated tests for the intended behavior and important failure modes.
5. Implement the smallest coherent vertical slice.
6. Run all required quality gates.
7. Update traceability and decision records.

Runtime changes without a requirement, acceptance criteria, and test evidence are not complete.

## Quality policy

- Target 100% line, statement, function, and branch coverage for project-owned production logic.
- Require 100% automated coverage of accepted P0 and P1 requirements.
- Critical modules require mutation testing, negative tests, race/lifecycle tests, and deterministic failure-path coverage.
- Coverage exclusions require a documented, reviewed reason. Platform glue is not automatically exempt.
- A user-discovered defect is an escaped defect. Its fix must include a regression test, root-cause analysis, and an update to the relevant test model.
- 100% coverage is a gate, not proof of correctness. Mutation testing, integration tests, end-to-end tests, security checks, and real-device validation remain mandatory.

## Architecture constraints

- macOS only for the first product version.
- Use the signed Swift CoreAudio Process Tap helper selected by ADR-006 behind `SystemAudioCapturePort`.
- Do not restore Electron display-media or ScreenCaptureKit as an automatic Meeting-mode fallback.
- Treat Swift coverage, parent-death cleanup, and capture-scope privacy as P0 release blockers.
- Keep microphone and system audio as separate streams.
- Treat remote participant identification as diarization over a mixed system-audio stream.
- Use an explicit capture session state machine and generation/cancellation tokens.
- Keep domain and application logic independent from Electron, provider SDKs, and macOS APIs.
- A selected provider is a security and privacy boundary. Cross-provider fallback is disabled unless explicitly approved.
- Never place API keys in source, tests, logs, fixtures, screenshots, or documentation.

## Git and review

- Preserve upstream history and keep `upstream` read-only in normal work.
- Use small branches and reviewable commits tied to backlog IDs.
- Do not mix documentation, architecture, dependency, and feature changes unless the change specification explains why they are inseparable.
- Never bypass failing tests, coverage, mutation, security, or packaging gates to merge a change.
