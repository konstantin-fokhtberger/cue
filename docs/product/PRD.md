# Product Requirements Document

## 1. Document control

| Field | Value |
|---|---|
| Product | Personalized cue for macOS |
| Status | Accepted baseline |
| Primary device | MacBook Air 15-inch, Apple M2 |
| Primary OS | macOS 26.5.2, build 25F84 |
| Primary workflow | Meeting copilot |
| Secondary workflow | Interview copilot |
| Tertiary workflow | Screen and coding assistant |

## 2. Product vision

Create a reliable personal macOS copilot that understands live meetings, distinguishes the local user from multiple remote speakers, maintains a bounded session transcript, and provides timely context-aware assistance without silently changing providers or retaining data beyond an explicit policy.

The product is an assistive tool. It must not promise guaranteed invisibility from screen capture, bypass platform controls, or replace user judgment.

## 3. Priorities

1. Meeting copilot for Zoom, Microsoft Teams, and Google Meet.
2. Interview copilot using meeting context and personal professional context.
3. Screen and coding assistant.

Meeting infrastructure is the shared foundation for the interview profile. Coding functionality must not delay meeting reliability.

## 4. Target user and environment

### Confirmed

- One primary user.
- One primary MacBook Air 15-inch with Apple M2.
- macOS 26.5.2 build 25F84.
- Zoom, Microsoft Teams, and Google Meet.
- Multiple remote meeting participants.

### Accepted baseline

- Initial distribution is a signed and notarized personal build outside the Mac App Store.
- Russian and English are supported, including code-switching inside one session.
- The target range is 1 to 8 remote speakers.
- Suggestions are explicitly requested by the user in the first release.
- Raw audio is not persisted.
- Transcript data exists only in memory for the active session.
- OpenAI diarization is the default STT path; cross-provider fallback is disabled.
- STT and LLM providers are selected independently.
- Remote speakers may initially be shown as `Speaker A`, `Speaker B`, and so on.

## 5. Product outcomes

| ID | Outcome | Success evidence |
|---|---|---|
| OUT-001 | The application reliably captures local microphone and remote meeting audio | Automated device integration suite and application matrix pass |
| OUT-002 | The user can understand who said what | Diarized transcript with stable session-scoped speaker labels |
| OUT-003 | Suggestions arrive while they are still useful | Accepted latency SLOs pass under a defined test workload |
| OUT-004 | Stop means stop | No audio accepted after the stop deadline in race and real-device tests |
| OUT-005 | Sensitive data follows explicit policy | Provider, retention, and attachment behavior is visible and testable |
| OUT-006 | Changes do not regress existing behavior | Required coverage, mutation, integration, E2E, and regression gates pass |

## 6. In-scope capabilities

### Meeting copilot

- Create, start, stop, and end a meeting session.
- Capture microphone and system audio as separate channels.
- Transcribe both channels.
- Label the local microphone as `You`.
- Apply diarization to the mixed remote-audio channel.
- Maintain a session-scoped ordered transcript.
- Offer on-demand reply suggestions.
- Offer follow-up questions.
- Produce recap, decisions, and action items.
- Allow speaker labels to be renamed.
- Display capture, provider, and error state clearly.

### Interview copilot

- Reuse the meeting capture and transcript pipeline.
- Attach approved professional context.
- Provide concise answer drafts and follow-up support.
- Keep interview prompts and retention rules separate from ordinary meetings.

### Screen and coding assistant

- Capture a screenshot only on explicit invocation.
- Answer questions grounded in the screenshot and optional session context.
- Keep this capability isolated from the critical meeting audio path.

## 7. Out of scope for the first release

- Windows and Linux.
- Mac App Store distribution.
- Guaranteed hiding from screen-sharing, recording, proctoring, or camera capture.
- Meeting-bot participation through Zoom, Teams, or Google APIs.
- Cloud account, multi-user synchronization, team administration, or shared storage.
- Automatic reliable mapping of a diarized voice to a participant's real name without user confirmation.
- Permanent raw audio recording by default.
- Fully offline STT or LLM unless later accepted as a requirement.

## 8. Product principles

- Meeting reliability before feature breadth.
- Explicit state before implicit behavior.
- Provider selection is a privacy boundary.
- Stop and session termination are deterministic operations.
- Data minimization by default.
- No silent cross-provider fallback.
- Testability is an architectural requirement.
- A simple Electron-only design wins unless evidence requires a native helper.

## 9. Release definition

The meeting MVP is not releasable until:

1. The audio feasibility gate passes for Zoom, Teams, and Google Meet on the target Mac.
2. All accepted P0 and P1 requirements have automated acceptance evidence.
3. Project-owned production logic meets the 100% coverage gate.
4. Critical modules meet the accepted mutation score.
5. The real-device lifecycle suite passes repeatedly.
6. Security, privacy, signing, and packaging gates pass.
7. No unresolved P0 or P1 defects remain.

## 10. Product decisions

| ID | Decision | Why it matters |
|---|---|---|
| DEC-001 | Accepted | Russian and English with code-switching |
| DEC-002 | Accepted | 1 to 8 remote speakers |
| DEC-003 | Accepted | Partial transcript p95 <= 2 seconds; reply first token p95 <= 3 seconds; Stop p95 <= 500 ms |
| DEC-004 | Accepted | No raw-audio persistence; transcript retained only in active-session memory |
| DEC-005 | Accepted | OpenAI diarization as default STT; LLM selected independently; no automatic cross-provider fallback |
| DEC-006 | Accepted | Signed and notarized personal distribution outside the Mac App Store |
