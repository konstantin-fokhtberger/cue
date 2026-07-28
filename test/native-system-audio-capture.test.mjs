import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  NativeSystemAudioCapture,
  NativeSystemAudioCaptureError,
} from '../src/core/native-system-audio-capture.mjs';

function floatBuffer(samples) {
  const buffer = Buffer.alloc(samples.length * 4);
  samples.forEach((sample, index) => buffer.writeFloatLE(sample, index * 4));
  return buffer;
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

function createHarness() {
  const children = [];
  const spawn = vi.fn(() => {
    const child = fakeChild();
    children.push(child);
    return child;
  });
  const onPcm = vi.fn();
  const onState = vi.fn();
  const capture = new NativeSystemAudioCapture({
    helperPath: '/Applications/cue.app/Contents/Resources/cue-audio-tap-helper',
    onPcm,
    onState,
    spawn,
  });
  return { capture, children, onPcm, onState, spawn };
}

function startEvent(sampleRate = 48_000) {
  return `${JSON.stringify({
    channels: 1,
    event: 'started',
    format: 'float32le',
    sampleRate,
  })}\n`;
}

describe('NativeSystemAudioCapture', () => {
  it('supports the production spawn default without starting a process', () => {
    expect(
      new NativeSystemAudioCapture({
        helperPath: '/unused',
        onPcm: vi.fn(),
        onState: vi.fn(),
      }),
    ).toBeInstanceOf(NativeSystemAudioCapture);
  });

  it('starts one helper, accepts fragmented metadata, and forwards exact resampled PCM', async () => {
    const harness = createHarness();
    const started = harness.capture.start();
    const child = harness.children[0];
    const input = floatBuffer([0.1, 0.2, -1, 0.1, 0.2, 1]);
    child.stdout.write(input.subarray(0, 5));
    child.stderr.write(startEvent().slice(0, 17));
    child.stderr.write(startEvent().slice(17));
    child.stdout.write(input.subarray(5));

    await expect(started).resolves.toEqual({ inputSampleRate: 48_000 });
    expect(harness.spawn).toHaveBeenCalledWith(
      '/Applications/cue.app/Contents/Resources/cue-audio-tap-helper',
      [],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(harness.onState.mock.calls).toEqual([
      [{ status: 'starting' }],
      [{ status: 'active', inputSampleRate: 48_000 }],
    ]);
    expect(Buffer.concat(harness.onPcm.mock.calls.map(([pcm]) => pcm))).toEqual(
      Buffer.from([0x00, 0x80, 0xff, 0x7f]),
    );
  });

  it('coalesces concurrent and active starts into one helper generation', async () => {
    const harness = createHarness();
    const first = harness.capture.start();
    const second = harness.capture.start();
    harness.children[0].stderr.write(startEvent());

    const resource = await first;
    await expect(second).resolves.toBe(resource);
    await expect(harness.capture.start()).resolves.toBe(resource);
    expect(harness.spawn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid JSON', 'not-json\n', 'invalid-helper-event'],
    [
      'unsupported channels',
      `${JSON.stringify({
        channels: 2,
        event: 'started',
        format: 'float32le',
        sampleRate: 48_000,
      })}\n`,
      'unsupported-helper-format',
    ],
    [
      'unsupported encoding',
      `${JSON.stringify({
        channels: 1,
        event: 'started',
        format: 'pcm16le',
        sampleRate: 48_000,
      })}\n`,
      'unsupported-helper-format',
    ],
    [
      'invalid sample rate',
      `${JSON.stringify({
        channels: 1,
        event: 'started',
        format: 'float32le',
        sampleRate: 8_000,
      })}\n`,
      'unsupported-helper-format',
    ],
    ['explicit helper failure', '{"event":"error","message":"tap denied"}\n', 'helper-error'],
  ])('rejects %s metadata and terminates the helper', async (_label, line, code) => {
    const harness = createHarness();
    const started = harness.capture.start();
    harness.children[0].stderr.write(line);

    await expect(started).rejects.toMatchObject({
      name: 'NativeSystemAudioCaptureError',
      code,
    });
    expect(harness.children[0].kill).toHaveBeenCalledWith('SIGTERM');
    expect(harness.onState).toHaveBeenLastCalledWith({ status: 'error', code });
  });

  it('rejects process spawn errors and early exits with typed failures', async () => {
    const spawnFailure = createHarness();
    const failedStart = spawnFailure.capture.start();
    spawnFailure.children[0].emit('error', new Error('spawn failed'));
    await expect(failedStart).rejects.toEqual(
      new NativeSystemAudioCaptureError('helper-spawn-failed'),
    );
    expect(spawnFailure.children[0].kill).not.toHaveBeenCalled();
    expect(spawnFailure.children[0].eventNames()).toEqual([]);

    const earlyExit = createHarness();
    const exitedStart = earlyExit.capture.start();
    earlyExit.children[0].emit('exit', 7, null);
    await expect(exitedStart).rejects.toEqual(
      new NativeSystemAudioCaptureError('helper-exited-before-start'),
    );
    expect(earlyExit.children[0].kill).not.toHaveBeenCalled();
    expect(earlyExit.children[0].eventNames()).toEqual([]);
  });

  it('bounds pre-start audio and rejects helper protocol overflow', async () => {
    const harness = createHarness();
    const started = harness.capture.start();
    harness.children[0].stdout.write(Buffer.alloc(1_048_576));
    expect(harness.children[0].kill).not.toHaveBeenCalled();
    harness.children[0].stdout.write(Buffer.alloc(1));

    await expect(started).rejects.toEqual(
      new NativeSystemAudioCaptureError('helper-protocol-overflow'),
    );
    expect(harness.children[0].kill).toHaveBeenCalledWith('SIGTERM');
    expect(harness.children[0].stdout.eventNames()).toEqual([]);
    expect(harness.children[0].stderr.eventNames()).toEqual([]);
    expect(harness.children[0].eventNames()).toEqual([]);
  });

  it('stops one active generation, emits idle, and ignores all late data', async () => {
    const harness = createHarness();
    const started = harness.capture.start();
    const child = harness.children[0];
    child.stderr.write(startEvent());
    await started;
    child.stdout.write(floatBuffer([0, 0, 1]));
    expect(harness.onPcm).toHaveBeenCalledTimes(1);

    await harness.capture.stop();
    child.stdout.write(floatBuffer([0, 0, 1]));
    child.emit('exit', 0, null);

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(harness.onPcm).toHaveBeenCalledTimes(1);
    expect(harness.onState).toHaveBeenLastCalledWith({
      status: 'idle',
      metrics: { chunks: 1, samples: 1, nonzero: 1, peak: 32767 },
    });
    await expect(harness.capture.stop()).resolves.toBeUndefined();
  });

  it('ignores stale captured callbacks after cancellation', async () => {
    const harness = createHarness();
    const started = harness.capture.start();
    const child = harness.children[0];
    const staleAudio = child.stdout.listeners('data')[0];
    const staleMetadata = child.stderr.listeners('data')[0];
    const staleError = child.listeners('error')[0];
    const staleExit = child.listeners('exit')[0];
    await harness.capture.stop();
    await expect(started).rejects.toEqual(new NativeSystemAudioCaptureError('start-cancelled'));

    const current = harness.capture.start();
    staleAudio(floatBuffer([0, 0, 1]));
    staleMetadata(Buffer.from(startEvent(44_100)));
    staleError(new Error('late fixture error'));
    staleExit(0, null);
    expect(harness.onState).toHaveBeenLastCalledWith({ status: 'starting' });
    harness.children[1].stderr.write(startEvent(48_000));
    await expect(current).resolves.toEqual({ inputSampleRate: 48_000 });

    expect(harness.onPcm).not.toHaveBeenCalled();
    expect(harness.onState).toHaveBeenCalledTimes(4);
  });

  it('parses multiple helper events per chunk and ignores empty resampler output', async () => {
    const harness = createHarness();
    const started = harness.capture.start();
    const child = harness.children[0];
    child.stderr.write(`{"event":"diagnostic"}\n${startEvent()}`);
    await started;
    child.stdout.write(floatBuffer([0.25, 0.5]));

    expect(harness.onPcm).not.toHaveBeenCalled();
  });

  it('stops parsing a metadata chunk immediately after a terminal event', async () => {
    const harness = createHarness();
    const started = harness.capture.start();
    harness.children[0].stderr.write(`not-json\n${startEvent()}`);

    await expect(started).rejects.toEqual(
      new NativeSystemAudioCaptureError('invalid-helper-event'),
    );
    expect(harness.onState).toHaveBeenLastCalledWith({
      status: 'error',
      code: 'invalid-helper-event',
    });
  });

  it('accepts the exact 16 kHz helper format boundary', async () => {
    const harness = createHarness();
    const started = harness.capture.start();
    harness.children[0].stderr.write(startEvent(16_000));

    await expect(started).resolves.toEqual({ inputSampleRate: 16_000 });
  });

  it('reports aggregate signal metrics including silence and decreasing peaks', async () => {
    const harness = createHarness();
    const started = harness.capture.start();
    const child = harness.children[0];
    child.stderr.write(startEvent());
    await started;
    child.stdout.write(floatBuffer([0, 0, 0, 0, 0, 0.5, 0, 0, 0.25]));

    await harness.capture.stop();

    expect(harness.onState).toHaveBeenLastCalledWith({
      status: 'idle',
      metrics: { chunks: 1, samples: 3, nonzero: 2, peak: 16384 },
    });
  });

  it('cancels a pending start and permits a clean new generation', async () => {
    const harness = createHarness();
    const obsolete = harness.capture.start();
    await harness.capture.stop();

    await expect(obsolete).rejects.toEqual(new NativeSystemAudioCaptureError('start-cancelled'));
    const current = harness.capture.start();
    harness.children[1].stderr.write(startEvent(44_100));
    await expect(current).resolves.toEqual({ inputSampleRate: 44_100 });
    expect(harness.spawn).toHaveBeenCalledTimes(2);
  });

  it('reports an unexpected active-helper exit without forwarding post-exit data', async () => {
    const harness = createHarness();
    const started = harness.capture.start();
    const child = harness.children[0];
    child.stderr.write(startEvent());
    await started;
    child.emit('exit', null, 'SIGKILL');
    child.stdout.write(floatBuffer([0, 0, 1]));

    expect(harness.onState).toHaveBeenLastCalledWith({
      status: 'error',
      code: 'helper-exited',
    });
    expect(harness.onPcm).not.toHaveBeenCalled();
  });
});
