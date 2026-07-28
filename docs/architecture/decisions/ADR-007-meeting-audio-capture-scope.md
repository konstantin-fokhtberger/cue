# ADR-007: explicit meeting-application audio capture scope

- Status: Accepted
- Date: 2026-07-28
- Backlog ID: `ADR-CAPTURE-SCOPE-001`
- Depends on: `ADR-006`

## Context

The accepted CoreAudio helper currently creates
`CATapDescription(monoGlobalTapButExcludeProcesses: [])`. This captures the global system mix.
It can include browser video, notifications, music, and cue-owned playback in the remote
transcript channel.

This behavior is acceptable for a bounded signal probe but not for production STT:

- unrelated audio can contaminate the transcript and diarization;
- the provider boundary becomes broader than the visible meeting context;
- cue cannot truthfully label the stream as Zoom or Google Meet audio;
- a successful global signal can hide a wrong-source defect.

Apple documents that `CATapDescription` can mix selected CoreAudio process object IDs and exposes
process and bundle-ID filters. The public CoreAudio model has no browser-tab identifier:

- [CATapDescription](https://developer.apple.com/documentation/coreaudio/catapdescription)
- [CoreAudio tap sample](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)
- [kAudioProcessPropertyBundleID](https://developer.apple.com/documentation/coreaudio/kaudioprocesspropertybundleid)

Chrome provides exact tab audio only through an extension API invoked after a user gesture:

- [chrome.tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [Chrome audio capture guide](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)

## Local evidence

On the target Mac:

- a running `afplay` fixture appeared as a CoreAudio process object with an empty bundle ID;
- an isolated Chrome instance playing a synthetic WebAudio tone appeared as a CoreAudio process
  object with bundle ID `com.google.Chrome.helper`;
- Chrome exposed the audio service process, not a Meet tab identity.

Therefore bundle-ID-only matching is insufficient, and CoreAudio application scope cannot promise
tab-level isolation for Google Meet.

## Options

| Option                                 | Privacy boundary                        | Accuracy and reliability                          | UX and operations                                        | Complexity and TCO |
| -------------------------------------- | --------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- | ------------------ |
| Global CoreAudio tap                   | All system audio                        | High availability, high contamination risk        | No source selection                                      | Low                |
| Automatic meeting-app detection        | Heuristic application scope             | Can select the wrong app or miss helper processes | Low friction but opaque                                  | Medium             |
| Explicit CoreAudio application scope   | Selected native app or browser instance | Good for Zoom/Teams; all audible tabs for Chrome  | One visible selector and browser-wide warning            | Medium             |
| Chrome `tabCapture` extension for Meet | Exact user-invoked browser tab          | Best Meet isolation; separate adapter/lifecycle   | Extension install, action click, version synchronization | High               |
| ScreenCaptureKit window/tab selection  | Window/process-dependent screen capture | Reintroduces screen permission                    | User-facing picker and screen indicator                  | High               |
| Virtual audio device                   | User-routed applications                | Deterministic after correct manual routing        | Driver install and fragile daily route management        | High               |

## Decision

Use explicit CoreAudio application scope as the default production policy.

1. Global tap is diagnostic-only. It cannot dispatch audio to STT.
2. Meeting Start requires one explicit capture source:
   - Zoom application;
   - Microsoft Teams application;
   - a specific browser application instance for Google Meet;
   - another explicitly selected audio-producing application.
3. No matching source means a typed error. There is no silent fallback to global audio.
4. Inclusion mode captures only resolved process objects for the selected application.
5. cue main, renderer, helper, and cue-owned playback processes are never included.
6. The aggregate device uses output devices associated with the selected processes, not every
   running output process.
7. The UI displays requested and effective capture scope for the entire active session.
8. Scope changes use a controlled generation-safe Stop/Start transition.
9. Provider dispatch is disabled unless the effective scope is verified.

### Browser limitation

For Google Meet in Chrome, the initial production label must be:

`Google Chrome - all audible tabs in this browser instance`

It must not be labeled `Google Meet only`.

Starting this scope requires explicit acknowledgement that another audible Chrome tab can enter
the transcript. cue should recommend pausing or muting other tabs during the meeting.

## Deferred alternative

If browser-wide capture is unacceptable, implement a second adapter using a Chrome extension and
`chrome.tabCapture`:

- exact user-invoked Meet tab;
- offscreen extension document for session continuity;
- explicit audio reconnection so the participant still hears the tab;
- authenticated, versioned extension-to-cue transport;
- separate extension packaging, installation, update, and E2E test process.

This has the strongest Meet privacy boundary but materially increases implementation and
operational cost. It should be P0 only if exact tab isolation is required for the first Meeting
MVP.

## Resolver design

The Swift helper should own CoreAudio process resolution.

1. An inventory operation returns active output process objects with:
   - CoreAudio object ID;
   - PID when available;
   - CoreAudio bundle ID when available;
   - associated output device UIDs;
   - normalized responsible application identity;
   - ambiguity status.
2. Electron presents normalized applications, not raw helper processes.
3. Start sends one bounded, versioned JSON configuration over stdin.
4. The helper keeps stdin open as the parent-liveness channel required by `BUG-AUDIO-004`.
5. The helper resolves the selected application into an inclusion set and creates
   `CATapDescription(monoMixdownOfProcesses:)`.
6. Empty bundle IDs, multiple matching instances, process restart, and disappearing sources are
   explicit states. None enables global fallback.

Using one stdin protocol for configuration and parent liveness reduces process-supervision
complexity compared with introducing a second IPC channel.

## Acceptance criteria

1. Two simultaneous synthetic application fixtures with distinct fingerprints are available.
2. Selecting fixture A captures A and rejects B within the accepted leakage threshold.
3. Selecting fixture B captures B and rejects A.
4. cue-owned output produces zero accepted remote-channel signal.
5. Empty bundle ID and ambiguous application instances produce explicit resolution behavior.
6. A selected process starting after inventory is handled according to the accepted restore
   policy.
7. Process exit/restart, route change, and source disappearance cannot fall back to global audio.
8. Requested and effective scope remain visible and are included in sanitized evidence.
9. Provider dispatch is impossible while scope is absent, ambiguous, stale, or diagnostic-global.
10. Chrome application scope is tested with two audible tabs and visibly reports browser-wide
    capture.
11. All project-owned resolver, policy, protocol, and lifecycle logic meets structural and
    mutation gates.
12. Target-Mac Zoom and Google Meet acceptance confirms nonzero selected-source signal and no
    unrelated fixture signal.

## Consequences

### Positive

- Smallest change that removes global-system capture from production STT.
- Reuses the accepted CoreAudio helper for Zoom, Teams, and browser applications.
- Explicit source identity improves diagnostics and prevents false meeting labels.
- Inclusion mode excludes cue playback by construction when cue is not selected.
- The stdin configuration channel also solves parent-death supervision.

### Negative

- Chrome scope includes every audible tab served by the selected Chrome audio process.
- Process inventory and application normalization are macOS/Chromium-sensitive.
- Multiple Chrome profiles or instances can remain ambiguous.
- The user must select or confirm a source before each capture session.
- Exact Meet tab isolation remains unavailable without a browser-specific adapter.

## Security and privacy

- Inventory exposes application identity and audio activity locally; it is not sent to providers.
- Raw PCM remains memory-only.
- Logs contain selected application identity, resolution state, counts, and typed errors only.
- Process command lines, window titles, URLs, tab titles, and meeting content are not required by
  the CoreAudio resolver and must not be collected for this policy.
- Global diagnostic mode visibly disables provider dispatch.

## Decision resolution

On 2026-07-28, the product owner accepted browser-wide Chrome capture for the first Meeting MVP.
Exact Google Meet tab isolation through a Chrome extension is deferred. The decision should be
reopened only if real contamination evidence or an operational requirement shows that
browser-wide capture is unacceptable.

The accurate browser-wide label and explicit user acknowledgement remain mandatory acceptance
conditions, not optional UX enhancements.
