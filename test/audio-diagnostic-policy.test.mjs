import { describe, expect, it } from 'vitest';

import {
  AUDIO_DIAGNOSTIC_DEFAULTS,
  activateAudioDiagnostic,
  beginAudioDiagnostic,
  createAudioDiagnosticState,
  describeAudioDiagnostic,
  failAudioDiagnostic,
  recordAudioDiagnosticPcm,
  shouldAutoStopAudioDiagnostic,
  stopAudioDiagnostic,
} from '../src/core/audio-diagnostic-policy.mjs';

describe('audio diagnostic policy', () => {
  it('defines the accepted bounded local diagnostic defaults', () => {
    expect(AUDIO_DIAGNOSTIC_DEFAULTS).toEqual({
      autoStopMs: 10_000,
      deadAfterMs: 2_000,
      healthTickMs: 250,
      signalRmsThreshold: 240,
      toneDurationMs: 500,
      toneFrequencyHz: 440,
      toneGain: 0.03,
    });
    expect(Object.isFrozen(AUDIO_DIAGNOSTIC_DEFAULTS)).toBe(true);
  });

  it('starts from an empty idle state and resets prior evidence for a new run', () => {
    const idle = createAudioDiagnosticState();
    expect(idle).toEqual({
      phase: 'idle',
      startedAt: null,
      stoppedAt: null,
      effectiveInput: null,
      errorCode: null,
      health: {
        frameCount: 0,
        sampleCount: 0,
        nonZeroSampleCount: 0,
        sumSquares: 0,
        peak: 0,
      },
    });

    expect(
      beginAudioDiagnostic(
        {
          ...idle,
          phase: 'error',
          errorCode: 'permission-denied',
          effectiveInput: { effectiveLabel: 'Old input' },
          health: {
            frameCount: 1,
            sampleCount: 1,
            nonZeroSampleCount: 1,
            sumSquares: 100,
            peak: 10,
          },
        },
        1_000,
      ),
    ).toEqual({
      ...idle,
      phase: 'starting',
      startedAt: 1_000,
    });
  });

  it('activates with exact effective input metadata and accumulates PCM locally', () => {
    const effectiveInput = {
      requestedId: 'hyperx',
      effectiveId: 'hyperx',
      effectiveLabel: 'HyperX SoloCast',
    };
    let state = activateAudioDiagnostic(
      beginAudioDiagnostic(createAudioDiagnosticState(), 1_000),
      effectiveInput,
    );
    state = recordAudioDiagnosticPcm(state, Int16Array.from([0, 300, -400]).buffer);
    state = recordAudioDiagnosticPcm(state, Int16Array.from([500]));

    expect(state).toEqual({
      phase: 'active',
      startedAt: 1_000,
      stoppedAt: null,
      effectiveInput,
      errorCode: null,
      health: {
        frameCount: 2,
        sampleCount: 4,
        nonZeroSampleCount: 3,
        sumSquares: 500_000,
        peak: 500,
      },
    });
    expect(describeAudioDiagnostic(state, 1_500)).toEqual({
      phase: 'active',
      elapsedMs: 500,
      healthStatus: 'healthy',
      rms: Math.sqrt(125_000),
      peak: 500,
      frameCount: 2,
      sampleCount: 4,
      effectiveInput,
      errorCode: null,
    });
  });

  it('ignores PCM outside an active run and rejects malformed PCM', () => {
    const idle = createAudioDiagnosticState();
    expect(recordAudioDiagnosticPcm(idle, new ArrayBuffer(2))).toBe(idle);

    const active = activateAudioDiagnostic(beginAudioDiagnostic(idle, 0), {
      effectiveLabel: 'HyperX',
    });
    expect(() => recordAudioDiagnosticPcm(active, new ArrayBuffer(3))).toThrow(
      new TypeError('PCM diagnostic frames must contain complete Int16 samples.'),
    );
    expect(() => recordAudioDiagnosticPcm(active, 'raw audio')).toThrow(
      new TypeError('PCM diagnostic frames must be an ArrayBuffer or typed array.'),
    );
  });

  it('classifies waiting, dead, silent, and healthy states deterministically', () => {
    const starting = beginAudioDiagnostic(createAudioDiagnosticState(), 1_000);
    expect(describeAudioDiagnostic(starting, 2_999).healthStatus).toBe('waiting');
    expect(describeAudioDiagnostic(starting, 3_000).healthStatus).toBe('dead');

    const active = activateAudioDiagnostic(starting, { effectiveLabel: 'HyperX' });
    const silent = recordAudioDiagnosticPcm(active, Int16Array.from([0, 0]));
    expect(describeAudioDiagnostic(silent, 1_500).healthStatus).toBe('silent');

    const healthy = recordAudioDiagnosticPcm(active, Int16Array.from([240, -240]));
    expect(describeAudioDiagnostic(healthy, 1_500).healthStatus).toBe('healthy');
  });

  it('uses stopped time for a stable final snapshot and never reports negative elapsed time', () => {
    expect(describeAudioDiagnostic(createAudioDiagnosticState(), 99_000)).toMatchObject({
      phase: 'idle',
      elapsedMs: 0,
      healthStatus: 'idle',
    });

    const active = activateAudioDiagnostic(
      beginAudioDiagnostic(createAudioDiagnosticState(), 2_000),
      { effectiveLabel: 'HyperX' },
    );
    const stopped = stopAudioDiagnostic(active, 3_500);

    expect(stopped).toMatchObject({ phase: 'idle', stoppedAt: 3_500 });
    expect(describeAudioDiagnostic(stopped, 99_000)).toMatchObject({
      phase: 'idle',
      elapsedMs: 1_500,
      healthStatus: 'idle',
    });
    expect(
      describeAudioDiagnostic(beginAudioDiagnostic(createAudioDiagnosticState(), 2_000), 1_000)
        .elapsedMs,
    ).toBe(0);
  });

  it('records a sanitized typed failure without inventing input or signal', () => {
    const failed = failAudioDiagnostic(
      beginAudioDiagnostic(createAudioDiagnosticState(), 1_000),
      'permission-denied',
      1_250,
    );
    expect(failed).toMatchObject({
      phase: 'error',
      startedAt: 1_000,
      stoppedAt: 1_250,
      effectiveInput: null,
      errorCode: 'permission-denied',
    });
    expect(describeAudioDiagnostic(failed, 10_000)).toMatchObject({
      phase: 'error',
      elapsedMs: 250,
      healthStatus: 'idle',
      rms: 0,
      peak: 0,
      errorCode: 'permission-denied',
    });
  });

  it('triggers automatic Stop only for bounded running diagnostics', () => {
    const idle = createAudioDiagnosticState();
    const starting = beginAudioDiagnostic(idle, 1_000);
    const active = activateAudioDiagnostic(starting, { effectiveLabel: 'HyperX' });

    expect(shouldAutoStopAudioDiagnostic(idle, 50_000)).toBe(false);
    expect(
      shouldAutoStopAudioDiagnostic(failAudioDiagnostic(starting, 'failed', 50_000), 50_000),
    ).toBe(false);
    expect(shouldAutoStopAudioDiagnostic(stopAudioDiagnostic(active, 50_000), 50_000)).toBe(false);
    expect(shouldAutoStopAudioDiagnostic(starting, 10_999)).toBe(false);
    expect(shouldAutoStopAudioDiagnostic(starting, 11_000)).toBe(true);
    expect(shouldAutoStopAudioDiagnostic(active, 11_000, 12_000)).toBe(false);
    expect(shouldAutoStopAudioDiagnostic(active, 13_000, 12_000)).toBe(true);
  });
});
