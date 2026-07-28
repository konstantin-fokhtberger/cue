import { spawn as nodeSpawn } from 'node:child_process';

import { Float32Pcm16Resampler } from './float32-pcm16-resampler.mjs';

const MAXIMUM_PRESTART_BYTES = 1_048_576;

export class NativeSystemAudioCaptureError extends Error {
  constructor(code) {
    super(code);
    this.name = 'NativeSystemAudioCaptureError';
    this.code = code;
  }
}

export class NativeSystemAudioCapture {
  #active = false;
  #child = null;
  #generation = null;
  #helperPath;
  #metrics = createMetrics();
  #onPcm;
  #onState;
  #pendingReject = null;
  #pendingResolve = null;
  #prestartAudio = [];
  #prestartBytes = 0;
  #resampler = null;
  #resource = null;
  #spawn;
  #startPromise = null;
  #stderrRemainder = '';

  constructor({ helperPath, onPcm, onState, spawn = nodeSpawn }) {
    this.#helperPath = helperPath;
    this.#onPcm = onPcm;
    this.#onState = onState;
    this.#spawn = spawn;
  }

  start() {
    if (this.#active) {
      return Promise.resolve(this.#resource);
    }
    if (this.#startPromise) {
      return this.#startPromise;
    }

    const generation = {};
    this.#generation = generation;
    this.#metrics = createMetrics();
    const child = this.#spawn(this.#helperPath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.#child = child;
    this.#onState({ status: 'starting' });
    this.#startPromise = new Promise((resolve, reject) => {
      this.#pendingResolve = resolve;
      this.#pendingReject = reject;
    });

    child.stdout.on('data', (chunk) => this.#handleAudio(generation, chunk));
    child.stderr.on('data', (chunk) => this.#handleMetadata(generation, chunk));
    child.on('error', () => this.#fail(generation, 'helper-spawn-failed', false));
    child.on('exit', () => {
      this.#fail(generation, this.#active ? 'helper-exited' : 'helper-exited-before-start', false);
    });
    return this.#startPromise;
  }

  stop() {
    if (this.#child === null) {
      return Promise.resolve();
    }
    const child = this.#child;
    const reject = this.#pendingReject;
    this.#generation = null;
    this.#detach(child);
    const metrics = { ...this.#metrics };
    this.#reset();
    child.kill('SIGTERM');
    if (reject) {
      reject(new NativeSystemAudioCaptureError('start-cancelled'));
    }
    this.#onState({ status: 'idle', metrics });
    return Promise.resolve();
  }

  #handleAudio(generation, chunk) {
    if (generation !== this.#generation) {
      return;
    }
    if (this.#resampler === null) {
      this.#prestartBytes += chunk.length;
      if (this.#prestartBytes > MAXIMUM_PRESTART_BYTES) {
        this.#fail(generation, 'helper-protocol-overflow', true);
        return;
      }
      this.#prestartAudio.push(Buffer.from(chunk));
      return;
    }
    this.#forwardPcm(chunk);
  }

  #handleMetadata(generation, chunk) {
    if (generation !== this.#generation) {
      return;
    }
    this.#stderrRemainder += chunk.toString('utf8');
    let newline = this.#stderrRemainder.indexOf('\n');
    while (newline !== -1) {
      const line = this.#stderrRemainder.slice(0, newline);
      this.#stderrRemainder = this.#stderrRemainder.slice(newline + 1);
      this.#handleMetadataLine(generation, line);
      newline = this.#stderrRemainder.indexOf('\n');
    }
  }

  #handleMetadataLine(generation, line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      this.#fail(generation, 'invalid-helper-event', true);
      return;
    }

    if (event.event === 'error') {
      this.#fail(generation, 'helper-error', true);
      return;
    }
    if (event.event !== 'started') {
      return;
    }
    if (
      event.channels !== 1 ||
      event.format !== 'float32le' ||
      !Number.isFinite(event.sampleRate) ||
      event.sampleRate < 16_000
    ) {
      this.#fail(generation, 'unsupported-helper-format', true);
      return;
    }

    this.#resampler = new Float32Pcm16Resampler({
      inputSampleRate: event.sampleRate,
      outputSampleRate: 16_000,
    });
    this.#active = true;
    this.#resource = { inputSampleRate: event.sampleRate };
    const resolve = this.#pendingResolve;
    this.#pendingResolve = null;
    this.#pendingReject = null;
    this.#startPromise = null;
    this.#onState({ status: 'active', inputSampleRate: event.sampleRate });
    for (const audio of this.#prestartAudio) {
      this.#forwardPcm(audio);
    }
    this.#prestartBytes = 0;
    resolve(this.#resource);
  }

  #forwardPcm(chunk) {
    const pcm = this.#resampler.push(chunk);
    if (pcm.length > 0) {
      recordPcmMetrics(this.#metrics, pcm);
      this.#onPcm(pcm);
    }
  }

  #fail(generation, code, terminate) {
    if (generation !== this.#generation) {
      return;
    }
    const child = this.#child;
    const reject = this.#pendingReject;
    this.#generation = null;
    this.#detach(child);
    this.#reset();
    if (terminate) {
      child.kill('SIGTERM');
    }
    if (reject) {
      reject(new NativeSystemAudioCaptureError(code));
    }
    this.#onState({ status: 'error', code });
  }

  #detach(child) {
    child.stdout.removeAllListeners();
    child.stderr.removeAllListeners();
    child.removeAllListeners();
  }

  #reset() {
    this.#active = false;
    this.#child = null;
    this.#pendingReject = null;
    this.#pendingResolve = null;
    this.#prestartAudio = [];
    this.#prestartBytes = 0;
    this.#resampler = null;
    this.#resource = null;
    this.#startPromise = null;
    this.#stderrRemainder = '';
  }
}

function createMetrics() {
  return { chunks: 0, samples: 0, nonzero: 0, peak: 0 };
}

function recordPcmMetrics(metrics, pcm) {
  metrics.chunks += 1;
  metrics.samples += pcm.length / Int16Array.BYTES_PER_ELEMENT;
  for (let offset = 0; offset < pcm.length; offset += 2) {
    const sample = pcm.readInt16LE(offset);
    const absolute = Math.abs(sample);
    if (absolute > 0) {
      metrics.nonzero += 1;
    }
    // Stryker disable next-line EqualityOperator: assigning the same numeric peak is observationally equivalent.
    if (absolute > metrics.peak) {
      metrics.peak = absolute;
    }
  }
}
