# Requirements specification

## 1. Requirement rules

- Each requirement has a stable ID.
- `accepted` requirements are binding.
- `proposed` requirements are working targets and must not silently become implementation commitments.
- Every accepted P0/P1 requirement requires automated acceptance coverage in `docs/planning/TRACEABILITY.md`.
- A requirement change must update the PRD, backlog, tests, and applicable ADRs.

## 2. Functional requirements

### Session lifecycle

| ID | Priority | Status | Requirement | Acceptance criteria |
|---|---:|---|---|---|
| FR-SESSION-001 | P0 | accepted | The user can start one capture session | Exactly one session becomes active and receives a unique `sessionId` |
| FR-SESSION-002 | P0 | accepted | Start is idempotent while a session is starting or active | Repeated Start cannot create duplicate streams, timers, or provider sessions |
| FR-SESSION-003 | P0 | accepted | Stop terminates active capture deterministically | New audio is rejected within 500 ms after Stop is accepted |
| FR-SESSION-004 | P0 | accepted | A stale async start cannot reactivate a stopped session | Generation-token race tests cover delayed permission and stream completion |
| FR-SESSION-005 | P0 | accepted | End meeting closes the transcript boundary | The next session cannot read or send prior transcript data |
| FR-SESSION-006 | P1 | accepted | Sleep, wake, device change, and stream failure are observable | The UI reports degraded state and recovery follows the accepted policy |

### Audio capture

| ID | Priority | Status | Requirement | Acceptance criteria |
|---|---:|---|---|---|
| FR-AUDIO-001 | P0 | accepted | Capture the user's microphone as a dedicated channel | Frames are tagged `microphone` and never merged before transcription policy applies |
| FR-AUDIO-002 | P0 | accepted | Capture meeting/system audio as a dedicated channel | Remote audio is captured from Zoom, Teams, and Meet on the target Mac |
| FR-AUDIO-003 | P0 | accepted | Exclude cue's own generated audio where supported | Test playback from cue does not re-enter the remote transcript path |
| FR-AUDIO-004 | P0 | accepted | Detect a dead or silent system stream | Health check transitions the session to degraded/error state instead of showing false active status |
| FR-AUDIO-005 | P1 | accepted | Audio buffers are bounded | Backpressure and overflow behavior are deterministic and tested |
| FR-AUDIO-006 | P1 | accepted | Bluetooth and built-in audio routes are supported on the target Mac | The accepted device matrix passes |

### Transcription and diarization

| ID | Priority | Status | Requirement | Acceptance criteria |
|---|---:|---|---|---|
| FR-STT-001 | P0 | accepted | Transcribe microphone and system channels independently | Each segment retains its source channel |
| FR-STT-002 | P0 | accepted | Label microphone speech as `You` | Remote diarization cannot relabel microphone segments |
| FR-STT-003 | P0 | accepted | Distinguish multiple remote speakers | Remote segments receive stable session-scoped speaker IDs under the accepted range of 1 to 8 remote speakers |
| FR-STT-004 | P0 | accepted | Honor the selected STT provider | Only the selected provider receives audio unless explicit fallback consent exists |
| FR-STT-005 | P0 | accepted | Do not silently retry audio through another provider | Cross-provider tests prove no secondary dispatch under default policy |
| FR-STT-006 | P1 | accepted | Support partial and final transcript segments | Corrections replace or finalize the correct segment without duplication |
| FR-STT-007 | P1 | accepted | Preserve ordering across asynchronous results | The session timeline is monotonically ordered by media time |

### Meeting assistance

| ID | Priority | Status | Requirement | Acceptance criteria |
|---|---:|---|---|---|
| FR-MEET-001 | P0 | accepted | Generate an on-demand suggested reply | The prompt uses only the active session and approved context |
| FR-MEET-002 | P1 | accepted | Generate relevant follow-up questions | Output is tied to the latest final transcript window |
| FR-MEET-003 | P1 | accepted | Produce recap, decisions, and action items | Output distinguishes facts, decisions, owners when present, and unresolved questions |
| FR-MEET-004 | P1 | accepted | Rename speaker labels | Renaming updates presentation without rewriting raw transcript evidence |
| FR-MEET-005 | P1 | accepted | Show what data is being attached | Before dispatch, the UI identifies transcript, screen, and professional context attachments |

### Interview and coding profiles

| ID | Priority | Status | Requirement | Acceptance criteria |
|---|---:|---|---|---|
| FR-INT-001 | P1 | accepted | Activate a separate interview profile | Prompt, context, and retention configuration are isolated from ordinary meetings |
| FR-INT-002 | P1 | accepted | Use approved professional context | Context is bounded, explicitly attached, and never treated as instructions |
| FR-CODE-001 | P2 | accepted | Capture screen only on explicit invocation | No periodic or implicit screenshot capture occurs |
| FR-CODE-002 | P2 | accepted | Generate coding assistance grounded in the current screen | Response contains assumptions and does not claim unseen information |

### Privacy and provider control

| ID | Priority | Status | Requirement | Acceptance criteria |
|---|---:|---|---|---|
| FR-PRIV-001 | P0 | accepted | Store API keys in macOS Keychain | No provider secret appears in application JSON, logs, fixtures, or renderer state |
| FR-PRIV-002 | P0 | accepted | Display active capture and provider state | The user can always determine whether capture is active and where data is sent |
| FR-PRIV-003 | P0 | accepted | Apply explicit retention policy per session | Raw audio is never persisted and transcript exists only in active-session memory |
| FR-PRIV-004 | P1 | accepted | Clear session data on request | Clear operation removes all locally retained artifacts and reports completion |
| FR-PRIV-005 | P1 | accepted | Sanitize provider errors | Error UI and logs contain no keys, raw requests, audio, transcript, or professional context |

## 3. Non-functional requirements

| ID | Priority | Status | Requirement | Accepted measure |
|---|---:|---|---|---|
| NFR-REL-001 | P0 | accepted | Capture lifecycle must be deterministic | 100 consecutive automated Start/Stop cycles without leaked streams or duplicate events |
| NFR-REL-002 | P0 | accepted | Session isolation must hold under concurrency | Race, delayed callback, retry, and cancellation suites pass |
| NFR-TEST-001 | P0 | accepted | Project-owned production logic has complete structural coverage | 100% lines, statements, functions, and branches |
| NFR-TEST-002 | P0 | accepted | Critical behavior resists weak assertions | 100% mutation score for lifecycle, routing, retention, and timeline modules |
| NFR-TEST-003 | P0 | accepted | Every P0/P1 requirement is automated | Traceability contains no accepted P0/P1 requirement without a passing test reference |
| NFR-SEC-001 | P0 | accepted | Renderer cannot exercise ambient privileged APIs | Narrow IPC contracts, sender checks, schemas, bounds, and negative tests |
| NFR-SEC-002 | P0 | accepted | Distributed build has stable identity | Signed and notarized package passes Gatekeeper verification |
| NFR-PERF-001 | P1 | accepted | Stop latency remains bounded | p95 <= 500 ms on the target Mac |
| NFR-PERF-002 | P1 | accepted | Partial transcript is timely | p95 <= 2 seconds after speech boundary |
| NFR-PERF-003 | P1 | accepted | Reply suggestion is timely | First token p95 <= 3 seconds after explicit request, excluding provider outage |
| NFR-RES-001 | P1 | accepted | Memory use is bounded for long meetings | Four-hour synthetic session remains under an accepted RSS growth limit |
| NFR-OBS-001 | P1 | accepted | Failures are diagnosable without exposing sensitive data | Structured local events cover state transitions, provider timing, and sanitized errors |
| NFR-COMP-001 | P0 | accepted | First release supports only the specified personal Mac | No broader compatibility claim without explicit test evidence |

## 4. Acceptance test matrix

The first audio feasibility gate must cover:

| Meeting app | Output route | Participants | Required evidence |
|---|---|---:|---|
| Zoom | Built-in speakers/mic | 2 and multiple | Separate mic/system capture, transcript, Stop |
| Zoom | Bluetooth headset | 2 and multiple | Route stability and recovery |
| Microsoft Teams | Built-in speakers/mic | 2 and multiple | Separate mic/system capture, transcript, Stop |
| Microsoft Teams | Bluetooth headset | 2 and multiple | Route stability and recovery |
| Google Meet | Built-in speakers/mic | 2 and multiple | Separate mic/system capture, transcript, Stop |
| Google Meet | Bluetooth headset | 2 and multiple | Route stability and recovery |

## 5. Deferred refinements

- Language-specific evaluation thresholds for Russian, English, and code-switching.
- Whether automatic suggestions are introduced after the explicit-request MVP.
- Whether opt-in recording or transcript persistence is ever introduced after the memory-only MVP.
- Default LLM provider and acceptable monthly cost.
- Required offline/degraded behavior.
