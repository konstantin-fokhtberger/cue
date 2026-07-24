import { describe, expect, it, vi } from 'vitest';

import { AsyncResourceSlot } from '../src/core/async-resource-slot.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('AsyncResourceSlot', () => {
  it('coalesces concurrent starts into one resource creation', async () => {
    const creation = deferred();
    const create = vi.fn(() => creation.promise);
    const dispose = vi.fn();
    const slot = new AsyncResourceSlot(dispose);

    const first = slot.start(create);
    const second = slot.start(create);
    creation.resolve({ id: 'system' });

    await expect(first).resolves.toEqual({ id: 'system' });
    await expect(second).resolves.toEqual({ id: 'system' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(slot.active).toBe(true);
  });

  it('returns the active resource without creating another one', async () => {
    const resource = { id: 'system' };
    const create = vi.fn().mockResolvedValue(resource);
    const slot = new AsyncResourceSlot(vi.fn());

    await expect(slot.start(create)).resolves.toBe(resource);
    await expect(slot.start(create)).resolves.toBe(resource);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('stops and disposes an active resource exactly once', async () => {
    const resource = { id: 'system' };
    const dispose = vi.fn().mockResolvedValue(undefined);
    const slot = new AsyncResourceSlot(dispose);

    await slot.start(() => resource);
    await slot.stop();
    await slot.stop();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(resource);
    expect(slot.active).toBe(false);
  });

  it('disposes a resource that completes after Stop without publishing it', async () => {
    const creation = deferred();
    const resource = { id: 'late-system' };
    const dispose = vi.fn().mockResolvedValue(undefined);
    const slot = new AsyncResourceSlot(dispose);

    const start = slot.start(() => creation.promise);
    await slot.stop();
    creation.resolve(resource);

    await expect(start).resolves.toBeNull();
    expect(dispose).toHaveBeenCalledWith(resource);
    expect(slot.active).toBe(false);
  });

  it('allows a new generation to start while an obsolete creation is pending', async () => {
    const obsolete = deferred();
    const current = deferred();
    const createCurrent = vi.fn(() => current.promise);
    const dispose = vi.fn().mockResolvedValue(undefined);
    const slot = new AsyncResourceSlot(dispose);

    const obsoleteStart = slot.start(() => obsolete.promise);
    await slot.stop();
    const currentStart = slot.start(createCurrent);
    obsolete.resolve({ id: 'obsolete' });
    await expect(obsoleteStart).resolves.toBeNull();

    const sharedCurrentStart = slot.start(createCurrent);

    current.resolve({ id: 'current' });
    await expect(currentStart).resolves.toEqual({ id: 'current' });
    await expect(sharedCurrentStart).resolves.toEqual({ id: 'current' });
    expect(createCurrent).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith({ id: 'obsolete' });
    expect(slot.active).toBe(true);
  });

  it('returns to idle after creation failure and permits retry', async () => {
    const failure = new Error('permission denied');
    const resource = { id: 'retry' };
    const create = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(resource);
    const slot = new AsyncResourceSlot(vi.fn());

    await expect(slot.start(create)).rejects.toBe(failure);
    expect(slot.active).toBe(false);
    await expect(slot.start(create)).resolves.toBe(resource);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
