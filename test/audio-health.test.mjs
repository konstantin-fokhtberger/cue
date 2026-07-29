import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_PCM_HEALTH,
  analyzePcm16,
  classifyCaptureHealth,
  mergePcmHealth,
  rmsFromPcmHealth,
} from '../src/core/audio-health.mjs';

describe('PCM capture health', () => {
  it('measures an empty frame without inventing signal', () => {
    expect(analyzePcm16(new Int16Array())).toEqual({
      frameCount: 1,
      sampleCount: 0,
      nonZeroSampleCount: 0,
      sumSquares: 0,
      peak: 0,
    });
  });

  it('measures sample count, energy, nonzero count, and absolute peak', () => {
    expect(analyzePcm16(Int16Array.from([-32768, -3, 0, 4, 32767]))).toEqual({
      frameCount: 1,
      sampleCount: 5,
      nonZeroSampleCount: 4,
      sumSquares: 2_147_418_138,
      peak: 32768,
    });
  });

  it('keeps metrics bounded and exact for arbitrary Int16 frames', () => {
    fc.assert(
      fc.property(fc.int16Array({ maxLength: 2048 }), (samples) => {
        const health = analyzePcm16(samples);
        const expectedSquares = [...samples].reduce((sum, sample) => sum + sample * sample, 0);

        expect(health.frameCount).toBe(1);
        expect(health.sampleCount).toBe(samples.length);
        expect(health.nonZeroSampleCount).toBe(samples.filter((sample) => sample !== 0).length);
        expect(health.sumSquares).toBe(expectedSquares);
        expect(health.peak).toBe(
          samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0),
        );
        expect(health.peak).toBeGreaterThanOrEqual(0);
        expect(health.peak).toBeLessThanOrEqual(32768);
      }),
      { numRuns: 500 },
    );
  });

  it('merges independent frames without losing the highest peak', () => {
    const first = analyzePcm16(Int16Array.from([3, -4]));
    const second = analyzePcm16(Int16Array.from([0, 12, -5]));

    expect(mergePcmHealth(mergePcmHealth(EMPTY_PCM_HEALTH, first), second)).toEqual({
      frameCount: 2,
      sampleCount: 5,
      nonZeroSampleCount: 4,
      sumSquares: 194,
      peak: 12,
    });
  });

  it('computes RMS and returns zero for no samples', () => {
    expect(rmsFromPcmHealth(EMPTY_PCM_HEALTH)).toBe(0);
    expect(
      rmsFromPcmHealth({
        frameCount: 1,
        sampleCount: 2,
        nonZeroSampleCount: 2,
        sumSquares: 50,
        peak: 5,
      }),
    ).toBe(5);
  });

  const base = {
    elapsedMs: 2_000,
    health: EMPTY_PCM_HEALTH,
    expectSignal: true,
    deadAfterMs: 2_000,
    signalRmsThreshold: 10,
  };

  it('classifies an inactive capture as idle regardless of signal expectation', () => {
    expect(classifyCaptureHealth({ ...base, active: false })).toBe('idle');
  });

  it('keeps a frameless capture waiting before the deadline or without an expected signal', () => {
    expect(classifyCaptureHealth({ ...base, active: true, elapsedMs: 1_999 })).toBe('waiting');
    expect(classifyCaptureHealth({ ...base, active: true, expectSignal: false })).toBe('waiting');
  });

  it('classifies a frameless capture as dead at the expected-signal deadline', () => {
    expect(classifyCaptureHealth({ ...base, active: true })).toBe('dead');
  });

  it('distinguishes silent frames from healthy signal', () => {
    const silentHealth = analyzePcm16(Int16Array.from([0, 0, 0]));
    const signalHealth = analyzePcm16(Int16Array.from([10, -10]));

    expect(classifyCaptureHealth({ ...base, active: true, health: silentHealth })).toBe('silent');
    expect(classifyCaptureHealth({ ...base, active: true, health: signalHealth })).toBe('healthy');
  });

  it('does not call received silence unhealthy when no signal is expected', () => {
    expect(
      classifyCaptureHealth({
        ...base,
        active: true,
        health: analyzePcm16(Int16Array.from([0, 0])),
        expectSignal: false,
      }),
    ).toBe('healthy');
  });
});
