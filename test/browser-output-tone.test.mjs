import { describe, expect, it, vi } from 'vitest';

import { BrowserOutputTone, OutputToneError } from '../src/core/browser-output-tone.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fakeNode(extra = {}) {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    ...extra,
  };
}

function createHarness(overrides = {}) {
  const oscillator = fakeNode({
    frequency: { value: 0 },
    start: vi.fn(),
    stop: vi.fn(),
  });
  const gain = fakeNode({ gain: { value: 1 } });
  const destination = { stream: { id: 'diagnostic-tone-stream' } };
  const context = {
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
    createMediaStreamDestination: vi.fn(() => destination),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const target = {
    srcObject: null,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  };
  const scheduled = [];
  const dependencies = {
    target,
    createAudioContext: vi.fn(() => context),
    setTimeoutFn: vi.fn((callback, delay) => {
      const token = { callback, delay };
      scheduled.push(token);
      return token;
    }),
    clearTimeoutFn: vi.fn(),
    durationMs: 500,
    frequencyHz: 440,
    gainValue: 0.03,
    ...overrides,
  };
  return {
    adapter: new BrowserOutputTone(dependencies),
    dependencies,
    target,
    context,
    oscillator,
    gain,
    destination,
    scheduled,
  };
}

describe('BrowserOutputTone', () => {
  it('plays a bounded low-volume tone through the configured target', async () => {
    const harness = createHarness();

    const resource = await harness.adapter.start();
    expect(resource).toMatchObject({
      context: harness.context,
      oscillator: harness.oscillator,
      gain: harness.gain,
      destination: harness.destination,
      timer: harness.scheduled[0],
    });

    expect(harness.context.createOscillator).toHaveBeenCalledTimes(1);
    expect(harness.context.createGain).toHaveBeenCalledTimes(1);
    expect(harness.context.createMediaStreamDestination).toHaveBeenCalledTimes(1);
    expect(harness.oscillator.frequency.value).toBe(440);
    expect(harness.gain.gain.value).toBe(0.03);
    expect(harness.oscillator.connect).toHaveBeenCalledWith(harness.gain);
    expect(harness.gain.connect).toHaveBeenCalledWith(harness.destination);
    expect(harness.target.srcObject).toBe(harness.destination.stream);
    expect(harness.target.play).toHaveBeenCalledTimes(1);
    expect(harness.oscillator.start).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 500);
    expect(harness.adapter.active).toBe(true);
  });

  it('coalesces concurrent and active starts into one tone graph', async () => {
    const playing = deferred();
    const harness = createHarness({
      target: {
        srcObject: null,
        play: vi.fn(() => playing.promise),
        pause: vi.fn(),
      },
    });

    const first = harness.adapter.start();
    const second = harness.adapter.start();
    playing.resolve();

    const resource = await first;
    await expect(second).resolves.toBe(resource);
    await expect(harness.adapter.start()).resolves.toBe(resource);
    expect(harness.dependencies.createAudioContext).toHaveBeenCalledTimes(1);
  });

  it('auto-stops and disposes every resource exactly once', async () => {
    const harness = createHarness();
    await harness.adapter.start();

    await harness.scheduled[0].callback();
    expect(harness.adapter.active).toBe(false);
    await harness.adapter.stop();

    expect(harness.dependencies.clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(harness.oscillator.stop).toHaveBeenCalledTimes(1);
    expect(harness.oscillator.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.gain.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.target.pause).toHaveBeenCalledTimes(1);
    expect(harness.target.srcObject).toBeNull();
    expect(harness.context.close).toHaveBeenCalledTimes(1);
    expect(harness.adapter.active).toBe(false);
  });

  it('stops a graph that finishes creation after Stop wins the race', async () => {
    const playing = deferred();
    const target = {
      srcObject: null,
      play: vi.fn(() => playing.promise),
      pause: vi.fn(),
    };
    const harness = createHarness({ target });

    const start = harness.adapter.start();
    await harness.adapter.stop();
    playing.resolve();

    await expect(start).resolves.toBeNull();
    expect(harness.oscillator.stop).toHaveBeenCalledTimes(1);
    expect(target.pause).toHaveBeenCalledTimes(1);
    expect(harness.context.close).toHaveBeenCalledTimes(1);
    expect(harness.adapter.active).toBe(false);
  });

  it('classifies playback rejection and disposes the partial graph', async () => {
    const cause = new Error('autoplay rejected');
    const target = {
      srcObject: null,
      play: vi.fn().mockRejectedValue(cause),
      pause: vi.fn(),
    };
    const harness = createHarness({ target });

    const failure = await harness.adapter.start().catch((error) => error);
    expect(failure).toBeInstanceOf(OutputToneError);
    expect(failure).toMatchObject({
      name: 'OutputToneError',
      message: 'output-tone:playback-failed',
      code: 'playback-failed',
      cause,
    });
    expect(harness.oscillator.start).not.toHaveBeenCalled();
    expect(harness.oscillator.stop).not.toHaveBeenCalled();
    expect(harness.dependencies.setTimeoutFn).not.toHaveBeenCalled();
    expect(harness.oscillator.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.gain.disconnect).toHaveBeenCalledTimes(1);
    expect(target.pause).toHaveBeenCalledTimes(1);
    expect(target.srcObject).toBeNull();
    expect(harness.context.close).toHaveBeenCalledTimes(1);
  });

  it('classifies initialization failure before playback', async () => {
    const cause = new Error('context failed');
    const harness = createHarness({
      createAudioContext: vi.fn(() => {
        throw cause;
      }),
    });

    const failure = await harness.adapter.start().catch((error) => error);
    expect(failure).toBeInstanceOf(OutputToneError);
    expect(failure).toMatchObject({
      name: 'OutputToneError',
      message: 'output-tone:initialization-failed',
      code: 'initialization-failed',
      cause,
    });
    expect(harness.target.play).not.toHaveBeenCalled();
    expect(harness.dependencies.clearTimeoutFn).not.toHaveBeenCalled();
    expect(harness.adapter.active).toBe(false);
  });
});
