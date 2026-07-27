import {
  EMPTY_PCM_HEALTH,
  analyzePcm16,
  classifyCaptureHealth,
  mergePcmHealth,
  rmsFromPcmHealth,
} from './audio-health.mjs';

export const AUDIO_DIAGNOSTIC_DEFAULTS = Object.freeze({
  autoStopMs: 10_000,
  deadAfterMs: 2_000,
  healthTickMs: 250,
  signalRmsThreshold: 240,
  toneDurationMs: 500,
  toneFrequencyHz: 440,
  toneGain: 0.03,
});

export function createAudioDiagnosticState() {
  return {
    phase: 'idle',
    startedAt: null,
    stoppedAt: null,
    effectiveInput: null,
    errorCode: null,
    health: EMPTY_PCM_HEALTH,
  };
}

export function beginAudioDiagnostic(_state, now) {
  return {
    ...createAudioDiagnosticState(),
    phase: 'starting',
    startedAt: now,
  };
}

export function activateAudioDiagnostic(state, effectiveInput) {
  return {
    ...state,
    phase: 'active',
    effectiveInput,
  };
}

function pcm16Samples(pcm) {
  let buffer;
  let byteOffset;
  let byteLength;
  if (pcm instanceof ArrayBuffer) {
    buffer = pcm;
    byteOffset = 0;
    byteLength = pcm.byteLength;
  } else if (ArrayBuffer.isView(pcm)) {
    buffer = pcm.buffer;
    byteOffset = pcm.byteOffset;
    byteLength = pcm.byteLength;
  } else {
    throw new TypeError('PCM diagnostic frames must be an ArrayBuffer or typed array.');
  }
  if (byteLength % Int16Array.BYTES_PER_ELEMENT !== 0) {
    throw new TypeError('PCM diagnostic frames must contain complete Int16 samples.');
  }
  return new Int16Array(buffer, byteOffset, byteLength / Int16Array.BYTES_PER_ELEMENT);
}

export function recordAudioDiagnosticPcm(state, pcm) {
  if (state.phase !== 'active') {
    return state;
  }
  const frame = analyzePcm16(pcm16Samples(pcm));
  return {
    ...state,
    health: mergePcmHealth(state.health, frame),
  };
}

export function failAudioDiagnostic(state, errorCode, now) {
  return {
    ...state,
    phase: 'error',
    stoppedAt: now,
    errorCode,
  };
}

export function stopAudioDiagnostic(state, now) {
  return {
    ...state,
    phase: 'idle',
    stoppedAt: now,
  };
}

function elapsedAudioDiagnosticMs(state, now) {
  if (state.startedAt === null) {
    return 0;
  }
  const end = state.stoppedAt === null ? now : state.stoppedAt;
  return Math.max(0, end - state.startedAt);
}

export function describeAudioDiagnostic(state, now, options = {}) {
  const config = { ...AUDIO_DIAGNOSTIC_DEFAULTS, ...options };
  const elapsedMs = elapsedAudioDiagnosticMs(state, now);
  const running = state.phase === 'starting' || state.phase === 'active';
  return {
    phase: state.phase,
    elapsedMs,
    healthStatus: classifyCaptureHealth({
      active: running,
      elapsedMs,
      health: state.health,
      expectSignal: true,
      deadAfterMs: config.deadAfterMs,
      signalRmsThreshold: config.signalRmsThreshold,
    }),
    rms: rmsFromPcmHealth(state.health),
    peak: state.health.peak,
    frameCount: state.health.frameCount,
    sampleCount: state.health.sampleCount,
    effectiveInput: state.effectiveInput,
    errorCode: state.errorCode,
  };
}

export function shouldAutoStopAudioDiagnostic(
  state,
  now,
  maxDurationMs = AUDIO_DIAGNOSTIC_DEFAULTS.autoStopMs,
) {
  const running = state.phase === 'starting' || state.phase === 'active';
  return running && elapsedAudioDiagnosticMs(state, now) >= maxDurationMs;
}
