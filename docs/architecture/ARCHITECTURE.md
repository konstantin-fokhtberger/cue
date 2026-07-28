# Target architecture

## 1. Status

This target architecture is accepted. `ADR-006` selects a signed Swift CoreAudio Process Tap
helper as the macOS `SystemAudioCapturePort` implementation. Backend selection does not imply
release readiness; Swift coverage, parent-death cleanup, capture-scope privacy, and the remaining
target-Mac lifecycle matrix are explicit P0 gates.

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

| Component                | Responsibility                                                           | Must not own                             |
| ------------------------ | ------------------------------------------------------------------------ | ---------------------------------------- |
| `SessionController`      | Session state machine, generation token, cancellation, lifecycle events  | Electron UI, provider SDK details        |
| `MicrophoneCapturePort`  | Local-user PCM stream                                                    | STT selection or transcript state        |
| `AudioDevicePolicy`      | cue input/output selection, default fallback, effective-device reporting | Reading or changing meeting-app settings |
| `SystemAudioCapturePort` | Mixed remote PCM stream and health status                                | Speaker identity or prompts              |
| `AudioPipeline`          | Format normalization, bounded buffering, VAD, backpressure               | Provider fallback policy                 |
| `RealtimeTranscription`  | Low-latency partial/final text                                           | Long-term speaker identity               |
| `DiarizationPipeline`    | Stable session-scoped remote speaker labels                              | Microphone speaker classification        |
| `ConversationTimeline`   | Ordered immutable transcript segments and corrections                    | UI rendering                             |
| `ProviderPolicy`         | Selected provider, consented fallback, attachment rules                  | Provider SDK transport                   |
| `CopilotEngine`          | Meeting, interview, and coding use cases                                 | Capture lifecycle                        |
| `CredentialStore`        | macOS Keychain access                                                    | Renderer-visible secret values           |
| `TelemetryPort`          | Sanitized local diagnostics and metrics                                  | Raw audio, keys, transcript text         |

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

### Selected path

Use a signed Swift CoreAudio Process Tap helper behind `SystemAudioCapturePort`.

```text
CoreAudio Process Tap
        |
signed Swift helper
  stdout: Float32LE mono PCM
  stderr: validated JSON lifecycle events
        |
Electron main adapter
  generation gate
  bounded pre-start buffer
  16 kHz PCM16 resampling
        |
AudioPipeline(system channel)
```

Microphone capture remains a separate Electron media path. Meeting Start does not enumerate
screen sources, and ScreenCaptureKit is not an automatic fallback.

Production system-audio capture follows the accepted `ADR-007` scope policy:

- the user explicitly selects one application scope;
- Chrome means all audible tabs in the selected browser instance and is labeled accordingly;
- starting browser-wide capture requires explicit acknowledgement;
- global capture is diagnostic-only and cannot dispatch audio to STT;
- absent, ambiguous, or stale scope fails closed without a global fallback;
- exact Chrome tab capture through an extension is deferred.

### Release gate

Architecture selection is complete, but release acceptance additionally requires:

- 100% automated structural coverage for project-owned Swift helper logic;
- helper termination and CoreAudio cleanup after parent-process death;
- implemented and tested application-scoped capture that excludes cue playback, discloses
  browser-wide Chrome scope, and prevents global system audio from reaching STT;
- available Zoom, Teams, and Meet evidence without inferring one configuration layer from
  another;
- built-in, Bluetooth-headset, and USB-microphone/Bluetooth-output route evidence;
- dead-stream detection and recovery;
- 100 repeated Start/Stop cycles;
- sleep/wake, route-change, and disconnect/reconnect characterization;
- packaged execution outside the development environment.

Microsoft Teams is waived only for the current manual spike because no test conference is
available. It remains an unverified release requirement.

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

| Failure                         | Required behavior                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| Permission denied               | Remain non-active and show exact remediation                                         |
| Dead system stream              | Mark degraded, stop claiming full capture, offer controlled restart                  |
| Device route change             | Rebind or transition to degraded according to accepted policy                        |
| Requested cue input unavailable | Do not silently substitute another microphone; require an explicit fallback decision |
| STT timeout                     | Preserve buffered segment within bounds; retry only the selected provider policy     |
| LLM timeout                     | Keep transcript active; fail only the requested assistance action                    |
| Renderer crash                  | Main process closes capture acceptance and tears down adapters                       |
| App sleep/wake                  | Revalidate all streams before returning to active                                    |
| Buffer overflow                 | Apply defined drop/backpressure policy and record sanitized diagnostic event         |

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
- Device selection tests inject macOS defaults, cue requests, and effective track metadata as
  separate inputs. Meeting-app settings are evidence metadata, not an implicit capture API.
- State transitions produce deterministic events.
- Audio fixtures are synthetic or explicitly consented and contain no secrets.
- Platform adapters have contract suites shared by fake, Electron, and possible Swift implementations.
