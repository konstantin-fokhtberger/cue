import fc from 'fast-check';
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

  it('PT-CAPTURE-SEQUENCE-001 preserves single ownership across generated lifecycle sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom('start', 'double-start', 'failed-start', 'late-start-stop', 'stop'),
          { maxLength: 100 },
        ),
        async (operations) => {
          let nextResourceId = 0;
          let expectedActive = null;
          const createdResources = [];
          const disposedResources = [];
          const slot = new AsyncResourceSlot(async (resource) => {
            disposedResources.push(resource);
          });

          const createResource = () => {
            const resource = { id: nextResourceId };
            nextResourceId += 1;
            createdResources.push(resource);
            return resource;
          };

          for (const operation of operations) {
            if (operation === 'stop') {
              await slot.stop();
              expectedActive = null;
            } else if (operation === 'start') {
              const resource = await slot.start(createResource);
              expectedActive ??= resource;
              expect(resource).toBe(expectedActive);
            } else if (operation === 'double-start') {
              const first = slot.start(createResource);
              const second = slot.start(createResource);
              const [firstResource, secondResource] = await Promise.all([first, second]);
              expectedActive ??= firstResource;
              expect(firstResource).toBe(expectedActive);
              expect(secondResource).toBe(expectedActive);
            } else if (operation === 'failed-start') {
              const failure = new Error('generated creation failure');
              const result = await slot
                .start(() => Promise.reject(failure))
                .catch((error) => error);
              if (expectedActive === null) {
                expect(result).toBe(failure);
              } else {
                expect(result).toBe(expectedActive);
              }
            } else if (expectedActive !== null) {
              const resource = await slot.start(createResource);
              expect(resource).toBe(expectedActive);
              await slot.stop();
              expectedActive = null;
            } else {
              const creation = deferred();
              const start = slot.start(() => creation.promise);
              await slot.stop();
              const resource = createResource();
              creation.resolve(resource);
              await expect(start).resolves.toBeNull();
            }

            expect(slot.active).toBe(expectedActive !== null);
          }

          await slot.stop();
          expect(slot.active).toBe(false);
          expect(disposedResources).toHaveLength(createdResources.length);
          expect(new Set(disposedResources)).toEqual(new Set(createdResources));
        },
      ),
      { numRuns: 500 },
    );
  });
});
