export const EMPTY_PCM_HEALTH = Object.freeze({
  frameCount: 0,
  sampleCount: 0,
  nonZeroSampleCount: 0,
  sumSquares: 0,
  peak: 0,
});

export function analyzePcm16(samples) {
  let nonZeroSampleCount = 0;
  let sumSquares = 0;
  let peak = 0;

  for (const sample of samples) {
    const absolute = Math.abs(sample);
    if (sample !== 0) {
      nonZeroSampleCount += 1;
    }
    sumSquares += sample * sample;
    peak = Math.max(peak, absolute);
  }

  return {
    frameCount: 1,
    sampleCount: samples.length,
    nonZeroSampleCount,
    sumSquares,
    peak,
  };
}

export function mergePcmHealth(total, frame) {
  return {
    frameCount: total.frameCount + frame.frameCount,
    sampleCount: total.sampleCount + frame.sampleCount,
    nonZeroSampleCount: total.nonZeroSampleCount + frame.nonZeroSampleCount,
    sumSquares: total.sumSquares + frame.sumSquares,
    peak: Math.max(total.peak, frame.peak),
  };
}

export function rmsFromPcmHealth(health) {
  return health.sampleCount === 0 ? 0 : Math.sqrt(health.sumSquares / health.sampleCount);
}

export function classifyCaptureHealth({
  active,
  elapsedMs,
  health,
  expectSignal,
  deadAfterMs,
  signalRmsThreshold,
}) {
  if (!active) {
    return 'idle';
  }
  if (health.frameCount === 0) {
    return expectSignal && elapsedMs >= deadAfterMs ? 'dead' : 'waiting';
  }
  if (expectSignal && rmsFromPcmHealth(health) < signalRmsThreshold) {
    return 'silent';
  }
  return 'healthy';
}
