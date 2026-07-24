# ADR-002: validate Electron audio capture before a native helper

- Status: Accepted
- Date: 2026-07-24

## Context

The repository uses Electron 33 and a loopback configuration that is not a reliable macOS implementation. Modern Electron versions use Apple's CoreAudio Tap path for desktop audio capture on recent macOS versions. ScreenCaptureKit can provide stronger native control but introduces Swift code, IPC, signing, packaging, and operational complexity.

## Options

| Option | Benefits | Costs and risks |
|---|---|---|
| Modern Electron/CoreAudio Tap | Smallest architecture, one process family, simpler packaging | Chromium behavior, silent dead-stream failure modes, less native control |
| Swift ScreenCaptureKit helper | Explicit outputs and lifecycle, richer diagnostics | Native toolchain, IPC, signing, failure recovery, higher TCO |
| Virtual audio device | Fast workaround | User configuration, route fragility, external dependency |

## Decision

Run a bounded feasibility spike using a supported Electron version. Accept Electron only if the complete application, route, lifecycle, and packaged-build matrix passes. Otherwise adopt a Swift ScreenCaptureKit helper behind the same `SystemAudioCapturePort`.

## Acceptance evidence

- `SPIKE-AUDIO-001` report.
- Automated adapter contract tests.
- Automated repeated lifecycle test.
- Real-device Zoom, Teams, and Meet evidence.
- Packaged application evidence.

## Consequences

The spike is not throwaway code. It must use the proposed capture port and produce reusable tests, but it must not trigger the full architecture migration before feasibility is known.
