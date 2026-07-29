import { describe, expect, it, vi } from 'vitest';

import { BrowserPcmCapture, PcmCaptureStartError } from '../src/core/browser-pcm-capture.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeNode() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function createHarness(overrides = {}) {
  const audioTrack = { kind: 'audio', stop: vi.fn() };
  const videoTrack = { kind: 'video', stop: vi.fn() };
  const stream = {
    getAudioTracks: vi.fn(() => [audioTrack]),
    getTracks: vi.fn(() => [audioTrack, videoTrack]),
  };
  const selectedStream = { id: 'selected-audio-stream' };
  const source = fakeNode();
  const processor = {
    ...fakeNode(),
    port: { onmessage: null },
  };
  const sink = {
    ...fakeNode(),
    gain: { value: 1 },
  };
  const context = {
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createMediaStreamSource: vi.fn(() => source),
    createGain: vi.fn(() => sink),
    destination: { id: 'destination' },
    close: vi.fn().mockResolvedValue(undefined),
  };
  const dependencies = {
    channel: 'microphone',
    openStream: vi.fn().mockResolvedValue(stream),
    createAudioContext: vi.fn(() => context),
    createMediaStream: vi.fn(() => selectedStream),
    createWorkletNode: vi.fn(() => processor),
    processorModuleUrl: './pcm-processor.js',
    processorName: 'pcm-processor',
    onStarted: vi.fn(),
    onPcm: vi.fn(),
    ...overrides,
  };

  return {
    adapter: new BrowserPcmCapture(dependencies),
    dependencies,
    stream,
    selectedStream,
    audioTrack,
    videoTrack,
    context,
    source,
    processor,
    sink,
  };
}

describe('BrowserPcmCapture contract', () => {
  it('builds the silent Web Audio graph and forwards exact PCM to its configured sink', async () => {
    const harness = createHarness();
    const pcm = new ArrayBuffer(8);

    await expect(harness.adapter.start()).resolves.toMatchObject({
      stream: harness.stream,
      context: harness.context,
      source: harness.source,
      processor: harness.processor,
      sink: harness.sink,
    });

    expect(harness.dependencies.openStream).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.createAudioContext).toHaveBeenCalledTimes(1);
    expect(harness.context.audioWorklet.addModule).toHaveBeenCalledWith('./pcm-processor.js');
    expect(harness.dependencies.createMediaStream).toHaveBeenCalledWith([harness.audioTrack]);
    expect(harness.context.createMediaStreamSource).toHaveBeenCalledWith(harness.selectedStream);
    expect(harness.dependencies.createWorkletNode).toHaveBeenCalledWith(
      harness.context,
      'pcm-processor',
    );
    expect(harness.sink.gain.value).toBe(0);
    expect(harness.source.connect).toHaveBeenCalledWith(harness.processor);
    expect(harness.processor.connect).toHaveBeenCalledWith(harness.sink);
    expect(harness.sink.connect).toHaveBeenCalledWith(harness.context.destination);
    expect(harness.dependencies.onStarted).toHaveBeenCalledTimes(1);

    harness.processor.port.onmessage({ data: pcm });
    expect(harness.dependencies.onPcm).toHaveBeenCalledWith(pcm);
    expect(harness.adapter.active).toBe(true);
  });

  it('keeps microphone and system PCM sinks isolated', async () => {
    const microphone = createHarness({ channel: 'microphone', onPcm: vi.fn() });
    const system = createHarness({ channel: 'system', onPcm: vi.fn() });
    const microphonePcm = new ArrayBuffer(2);
    const systemPcm = new ArrayBuffer(4);

    await microphone.adapter.start();
    await system.adapter.start();
    microphone.processor.port.onmessage({ data: microphonePcm });
    system.processor.port.onmessage({ data: systemPcm });

    expect(microphone.dependencies.onPcm).toHaveBeenCalledTimes(1);
    expect(microphone.dependencies.onPcm.mock.calls[0][0]).toBe(microphonePcm);
    expect(system.dependencies.onPcm).toHaveBeenCalledTimes(1);
    expect(system.dependencies.onPcm.mock.calls[0][0]).toBe(systemPcm);
  });

  it('coalesces concurrent and active Start calls into one graph', async () => {
    const opening = deferred();
    const harness = createHarness({ openStream: vi.fn(() => opening.promise) });

    const first = harness.adapter.start();
    const second = harness.adapter.start();
    opening.resolve(harness.stream);

    const resource = await first;
    await expect(second).resolves.toBe(resource);
    await expect(harness.adapter.start()).resolves.toBe(resource);
    expect(harness.dependencies.openStream).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.createAudioContext).toHaveBeenCalledTimes(1);
  });

  it('stops and disposes the complete active graph exactly once', async () => {
    const harness = createHarness();
    await harness.adapter.start();

    await harness.adapter.stop();
    await harness.adapter.stop();

    expect(harness.processor.port.onmessage).toBeNull();
    expect(harness.processor.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.source.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.sink.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.context.close).toHaveBeenCalledTimes(1);
    expect(harness.audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(harness.videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(harness.adapter.active).toBe(false);
  });

  it('disposes a late stream when Stop wins the media-request race', async () => {
    const opening = deferred();
    const harness = createHarness({ openStream: vi.fn(() => opening.promise) });

    const start = harness.adapter.start();
    await harness.adapter.stop();
    opening.resolve(harness.stream);

    await expect(start).resolves.toBeNull();
    expect(harness.context.close).toHaveBeenCalledTimes(1);
    expect(harness.audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(harness.videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(harness.adapter.active).toBe(false);
  });

  it.each(['microphone', 'system'])(
    'reports %s permission denial as a channel-scoped typed error',
    async (channel) => {
      const cause = new Error('permission denied');
      cause.name = 'NotAllowedError';
      const harness = createHarness({
        channel,
        openStream: vi.fn().mockRejectedValue(cause),
      });

      const error = await harness.adapter.start().catch((caught) => caught);
      expect(error).toMatchObject({
        name: 'PcmCaptureStartError',
        channel,
        code: 'permission-denied',
        cause,
      });
      expect(error.message).toBe(`${channel}:permission-denied`);
      expect(harness.dependencies.createAudioContext).not.toHaveBeenCalled();
      expect(harness.adapter.active).toBe(false);
    },
  );

  it.each(['NotFoundError', 'OverconstrainedError'])(
    'reports %s as a device-unavailable start failure',
    async (name) => {
      const cause = new Error(name);
      cause.name = name;
      const harness = createHarness({
        openStream: vi.fn().mockRejectedValue(cause),
      });

      await expect(harness.adapter.start()).rejects.toMatchObject({
        name: 'PcmCaptureStartError',
        channel: 'microphone',
        code: 'device-unavailable',
        cause,
      });
      expect(harness.dependencies.createAudioContext).not.toHaveBeenCalled();
      expect(harness.adapter.active).toBe(false);
    },
  );

  it('rejects a stream without audio tracks and releases every track', async () => {
    const harness = createHarness();
    harness.stream.getAudioTracks.mockReturnValue([]);

    const error = await harness.adapter.start().catch((caught) => caught);
    expect(error).toEqual(new PcmCaptureStartError('microphone', 'no-audio-track'));
    expect(error.message).toBe('microphone:no-audio-track');
    expect(Object.hasOwn(error, 'cause')).toBe(false);
    expect(harness.dependencies.createAudioContext).not.toHaveBeenCalled();
    expect(harness.audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(harness.videoTrack.stop).toHaveBeenCalledTimes(1);
  });

  it('classifies initialization failure and disposes partial resources', async () => {
    const cause = new Error('worklet module failed');
    const harness = createHarness();
    harness.context.audioWorklet.addModule.mockRejectedValue(cause);

    await expect(harness.adapter.start()).rejects.toMatchObject({
      name: 'PcmCaptureStartError',
      channel: 'microphone',
      code: 'initialization-failed',
      cause,
    });
    expect(harness.context.close).toHaveBeenCalledTimes(1);
    expect(harness.audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(harness.videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(harness.source.disconnect).not.toHaveBeenCalled();
    expect(harness.processor.disconnect).not.toHaveBeenCalled();
    expect(harness.sink.disconnect).not.toHaveBeenCalled();
  });
});
