import { describe, expect, it, vi } from 'vitest';

import shutdownModule from '../src/core/shutdown-coordinator.cjs';

const { createShutdownCoordinator } = shutdownModule;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('application shutdown coordinator', () => {
  it('prevents quit until one shared cleanup promise completes', async () => {
    const cleanupResult = deferred();
    const app = { quit: vi.fn() };
    const cleanup = vi.fn(() => cleanupResult.promise);
    const onError = vi.fn();
    const coordinator = createShutdownCoordinator({ app, cleanup, onError });
    const firstEvent = { preventDefault: vi.fn() };
    const repeatedEvent = { preventDefault: vi.fn() };

    coordinator.handleBeforeQuit(firstEvent);
    coordinator.handleBeforeQuit(repeatedEvent);
    await Promise.resolve();

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();

    cleanupResult.resolve();
    await coordinator.waitForCleanup();
    expect(app.quit).toHaveBeenCalledOnce();

    const finalEvent = { preventDefault: vi.fn() };
    coordinator.handleBeforeQuit(finalEvent);
    expect(finalEvent.preventDefault).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('logs cleanup failure without trapping the application in a running state', async () => {
    const failure = new Error('fixture cleanup failed');
    const app = { quit: vi.fn() };
    const onError = vi.fn();
    const coordinator = createShutdownCoordinator({
      app,
      cleanup: vi.fn(() => Promise.reject(failure)),
      onError,
    });
    const event = { preventDefault: vi.fn() };

    coordinator.handleBeforeQuit(event);
    await coordinator.waitForCleanup();

    expect(onError).toHaveBeenCalledWith(failure);
    expect(app.quit).toHaveBeenCalledOnce();
  });
});
