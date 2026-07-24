# Target architecture

## 1. Status

This target architecture is accepted. The Electron audio path must still pass the feasibility spike before its concrete capture adapter is accepted.

## 2. Architecture drivers

1. Deterministic capture lifecycle.
2. Separate microphone and system-audio channels.
3. Multiple remote speakers over a mixed meeting-audio stream.
4. Low-latency assistance with later diarization refinement.
5. Strict session and provider boundaries.
6. Complete automated testing of project-owned logic.
7. Minimal platform complexity for one Apple Silicon Mac.

## 3. Recommended style

Use an incremental ports-and-adapters structure inside the Electron application:

```text
UI / Electron adapters
        |
Application use cases
        |
Pure domain model
        |
Infrastructure adapters
  - macOS audio capture
  - STT providers
  - LLM providers
  - Keychain
  - local persistence
```

The current monolith should be migrated by vertical slices. A full rewrite is not justified.

## 4. Component model

| Component | Responsibility | Must not own |
|---|---|---|
| `SessionController` | Session state machine, generation token, cancellation, lifecycle events | Electron UI, provider SDK details |
| `MicrophoneCapturePort` | Local-user PCM stream | STT selection or transcript state |
| `SystemAudioCapturePort` | Mixed remote PCM stream and health status | Speaker identity or prompts |
| `AudioPipeline` | Format normalization, bounded buffering, VAD, backpressure | Provider fallback policy |
| `RealtimeTranscription` | Low-latency partial/final text | Long-term speaker identity |
| `DiarizationPipeline` | Stable session-scoped remote speaker labels | Microphone speaker classification |
| `ConversationTimeline` | Ordered immutable transcript segments and corrections | UI rendering |
| `ProviderPolicy` | Selected provider, consented fallback, attachment rules | Provider SDK transport |
| `CopilotEngine` | Meeting, interview, and coding use cases | Capture lifecycle |
| `CredentialStore` | macOS Keychain access | Renderer-visible secret values |
| `TelemetryPort` | Sanitized local diagnostics and metrics | Raw audio, keys, transcript text |

## 5. Session state machine

```text
idle
  -> requesting_permissions
  -> starting
  -> active
  -> stopping
  -> stopped

requesting_permissions | starting | active
  -> degraded
  -> error

stopped | error
  -> idle
```

Rules:

- Every start attempt owns a unique generation token.
- Callbacks from an older generation are rejected.
- Only `active` sessions accept PCM.
- Stop first closes the acceptance gate, then drains/cancels adapters.
- End meeting finalizes the timeline and applies retention policy.
- Recovery never silently creates a new logical session.

## 6. Audio capture decision

### Preferred path

Upgrade to a supported Electron version and validate CoreAudio Tap based desktop audio capture on macOS 26.5.2.

### Fallback path

Introduce a signed Swift helper using ScreenCaptureKit only if the preferred path fails an accepted feasibility criterion.

### Decision gate

The capture adapter is accepted only after:

- Zoom, Teams, and Meet pass;
- built-in and Bluetooth routes pass;
- dead-stream detection passes;
- 100 repeated Start/Stop cycles pass;
- sleep/wake and route-change behavior is characterized;
- packaged execution outside the development environment passes.

## 7. Transcription strategy

Use two logical lanes:

1. Realtime lane
   - optimizes partial transcript latency;
   - keeps microphone and remote channels separate;
   - may temporarily label system audio as `Remote`.

2. Diarization lane
   - resolves remote speech to stable `Speaker A/B/C` identities;
   - corrects the session timeline;
   - supports recap, decisions, and action items;
   - must not block immediate suggestions.

A sequence of unrelated 3.5-second transcription requests is not an acceptable diarization design because speaker identity can reset between chunks.

## 8. Canonical transcript model

```text
TranscriptSegment
  sessionId
  segmentId
  sourceChannel: microphone | system
  speakerId
  speakerDisplayName?
  startTimeMs
  endTimeMs
  text
  status: partial | final | corrected
  confidence?
  providerId
```

Transcript updates are append/correct events. Presentation aliases do not mutate raw speaker evidence.

## 9. Provider and privacy boundary

- STT and LLM providers are independently selected.
- Provider selection is immutable for an active request.
- Automatic cross-provider audio fallback is disabled by default.
- Every outbound request records a sanitized local envelope: provider, model, session, attachment types, duration, and outcome.
- The renderer receives provider status but never raw API keys.
- Credential storage uses macOS Keychain.

## 10. Failure model

| Failure | Required behavior |
|---|---|
| Permission denied | Remain non-active and show exact remediation |
| Dead system stream | Mark degraded, stop claiming full capture, offer controlled restart |
| Device route change | Rebind or transition to degraded according to accepted policy |
| STT timeout | Preserve buffered segment within bounds; retry only the selected provider policy |
| LLM timeout | Keep transcript active; fail only the requested assistance action |
| Renderer crash | Main process closes capture acceptance and tears down adapters |
| App sleep/wake | Revalidate all streams before returning to active |
| Buffer overflow | Apply defined drop/backpressure policy and record sanitized diagnostic event |

## 11. Security boundaries

- Enable Chromium sandboxing after compatibility verification.
- Validate IPC sender, channel, payload schema, size, and state preconditions.
- Allow only `https` external URLs from an explicit hostname policy.
- Keep captured content inert in the renderer.
- Use signed, hardened, notarized packages for the daily-use build.
- Treat overlay exclusion as best-effort usability, not a security control.

## 12. Testability consequences

- Domain and application components accept ports and clocks as dependencies.
- Time, provider responses, stream callbacks, permissions, and device changes are injectable.
- State transitions produce deterministic events.
- Audio fixtures are synthetic or explicitly consented and contain no secrets.
- Platform adapters have contract suites shared by fake, Electron, and possible Swift implementations.
