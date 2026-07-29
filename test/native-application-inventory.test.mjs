import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  NativeApplicationInventory,
  NativeApplicationInventoryError,
} from '../src/core/native-application-inventory.mjs';

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const end = child.stdin.end.bind(child.stdin);
  child.stdin.end = vi.fn((...arguments_) => end(...arguments_));
  child.kill = vi.fn(() => true);
  return child;
}

function inventoryLine(generation = 3) {
  return `${JSON.stringify({
    event: 'inventory',
    generation,
    sources: [
      {
        identity: {
          pid: 123,
          bundleIdentifier: 'us.zoom.xos',
          displayName: 'zoom.us',
        },
        status: 'available',
        failure: null,
        audioProcessObjectIds: [11],
        outputDeviceUids: ['sony'],
        requiresBrowserWideAcknowledgement: false,
      },
    ],
  })}\n`;
}

function createHarness(overrides = {}) {
  const child = fakeChild();
  const spawn = vi.fn(() => child);
  const inventory = new NativeApplicationInventory({
    helperPath: '/Applications/cue.app/Contents/Resources/cue-audio-tap-helper',
    spawn,
    ...overrides,
  });
  return { child, inventory, spawn };
}

describe('NativeApplicationInventory', () => {
  it('exposes stable typed errors', () => {
    expect(new NativeApplicationInventoryError('fixture-code')).toMatchObject({
      name: 'NativeApplicationInventoryError',
      code: 'fixture-code',
      message: 'fixture-code',
    });
  });

  it('supports the production dependencies without spawning eagerly', () => {
    expect(new NativeApplicationInventory({ helperPath: '/unused' })).toBeInstanceOf(
      NativeApplicationInventory,
    );
  });

  it('requests one generation and resolves only after a clean helper exit', async () => {
    let timeoutCallback;
    const clearTimeoutFn = vi.fn();
    const { child, inventory, spawn } = createHarness({
      setTimeoutFn: vi.fn((callback) => {
        timeoutCallback = callback;
        return 99;
      }),
      clearTimeoutFn,
    });
    const pending = inventory.refresh(3);
    const exitListener = child.listeners('exit')[0];
    child.stderr.write(inventoryLine().slice(0, 20));
    child.stderr.write(inventoryLine().slice(20));
    child.emit('exit', 0, null);

    await expect(pending).resolves.toMatchObject({ generation: 3 });
    expect(() => exitListener(0, null)).not.toThrow();
    expect(() => timeoutCallback()).not.toThrow();
    expect(() => child.stdin.emit('error', new Error('late detached error'))).not.toThrow();
    expect(spawn).toHaveBeenCalledWith(
      '/Applications/cue.app/Contents/Resources/cue-audio-tap-helper',
      [],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    expect(child.stdin.end).toHaveBeenCalledWith(
      Buffer.from('{"command":"inventory","generation":3,"protocolVersion":1}\n'),
    );
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.eventNames()).toEqual([]);
    expect(clearTimeoutFn).toHaveBeenCalledWith(99);

    const next = inventory.refresh(4);
    child.stderr.write(inventoryLine(4));
    child.emit('exit', 0, null);
    await expect(next).resolves.toMatchObject({ generation: 4 });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['stdout bytes', (child) => child.stdout.write(Buffer.from([1])), 'unexpected-helper-audio'],
    ['invalid JSON', (child) => child.stderr.write('invalid\n'), 'invalid-helper-inventory'],
    [
      'multiple events',
      (child) => child.stderr.write(inventoryLine() + inventoryLine()),
      'invalid-helper-inventory',
    ],
    [
      'stale generation',
      (child) => child.stderr.write(inventoryLine(4)),
      'invalid-helper-inventory',
    ],
    [
      'helper error',
      (child) => child.stderr.write('{"event":"error","message":"denied"}\n'),
      'helper-error',
    ],
  ])('rejects %s on helper exit', async (_label, arrange, code) => {
    const { child, inventory } = createHarness();
    const pending = inventory.refresh(3);
    arrange(child);
    child.emit('exit', 0, null);

    await expect(pending).rejects.toEqual(new NativeApplicationInventoryError(code));
    expect(child.eventNames()).toEqual([]);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('accepts the exact event bound then rejects overflow and terminates the helper', async () => {
    const { child, inventory } = createHarness({ maximumEventBytes: 8 });
    const pending = inventory.refresh(3);
    child.stderr.write('12345678');
    expect(child.kill).not.toHaveBeenCalled();
    child.stderr.write('9');

    await expect(pending).rejects.toEqual(
      new NativeApplicationInventoryError('helper-inventory-overflow'),
    );
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('maps spawn, control, nonzero-exit, and timeout failures', async () => {
    const spawned = createHarness();
    const spawnPending = spawned.inventory.refresh(3);
    spawned.child.emit('error', new Error('spawn'));
    await expect(spawnPending).rejects.toEqual(
      new NativeApplicationInventoryError('helper-spawn-failed'),
    );
    expect(spawned.child.kill).not.toHaveBeenCalled();

    const pipe = createHarness();
    const pipePending = pipe.inventory.refresh(3);
    pipe.child.stdin.emit('error', new Error('broken pipe'));
    await expect(pipePending).rejects.toEqual(
      new NativeApplicationInventoryError('helper-control-failed'),
    );
    expect(pipe.child.kill).toHaveBeenCalledWith('SIGTERM');

    const controlled = createHarness();
    controlled.child.stdin.end = vi.fn(() => {
      throw new Error('closed');
    });
    await expect(controlled.inventory.refresh(3)).rejects.toEqual(
      new NativeApplicationInventoryError('helper-control-failed'),
    );
    expect(controlled.child.kill).toHaveBeenCalledWith('SIGTERM');

    const exited = createHarness();
    const exitPending = exited.inventory.refresh(3);
    exited.child.emit('exit', 7, null);
    await expect(exitPending).rejects.toEqual(new NativeApplicationInventoryError('helper-exited'));
    expect(exited.child.kill).not.toHaveBeenCalled();

    let timeoutCallback;
    const timed = createHarness({
      setTimeoutFn: vi.fn((callback) => {
        timeoutCallback = callback;
        return 99;
      }),
      clearTimeoutFn: vi.fn(),
    });
    const timeoutPending = timed.inventory.refresh(3);
    timeoutCallback();
    await expect(timeoutPending).rejects.toEqual(
      new NativeApplicationInventoryError('helper-inventory-timeout'),
    );
    expect(timed.child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it.each([
    ['missing newline', inventoryLine().slice(0, -1)],
    ['empty event', '\n'],
    ['additional newline', `${inventoryLine()}\n`],
  ])('rejects invalid %s framing without terminating an exited helper', async (_label, data) => {
    const { child, inventory } = createHarness();
    const pending = inventory.refresh(3);
    child.stderr.write(data);
    child.emit('exit', 0, null);

    await expect(pending).rejects.toEqual(
      new NativeApplicationInventoryError('invalid-helper-inventory'),
    );
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('rejects concurrent refresh and invalid generation before spawning', async () => {
    const { child, inventory, spawn } = createHarness();
    const first = inventory.refresh(3);
    await expect(inventory.refresh(4)).rejects.toEqual(
      new NativeApplicationInventoryError('inventory-refresh-active'),
    );
    child.stderr.write(inventoryLine());
    child.emit('exit', 0, null);
    await first;

    await expect(inventory.refresh(0)).rejects.toEqual(
      new NativeApplicationInventoryError('invalid-inventory-generation'),
    );
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
