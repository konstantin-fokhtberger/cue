# ADR-001: macOS-only first release

- Status: Accepted
- Date: 2026-07-24

## Context

The personal target environment is a MacBook Air 15-inch with Apple M2 running macOS 26.5.2 build 25F84. Meeting copilot reliability is the highest priority. Cross-platform abstractions would increase scope before the critical macOS audio path is proven.

## Decision

The first personalized release supports only the specified macOS environment. Windows and Linux code may remain upstream-compatible where inexpensive, but they are not release criteria.

## Consequences

### Positive

- Smaller compatibility and test matrix.
- Direct use of macOS capture, Keychain, signing, and notarization capabilities.
- Faster validation of the meeting workflow.

### Negative

- Platform-neutral refactoring is not a release objective.
- Future Windows support may require new capture adapters and tests.
- Passing on the target Mac does not justify a general macOS compatibility claim.

## Revisit when

- A second device or macOS version becomes a required target.
- Windows support becomes a product priority.

