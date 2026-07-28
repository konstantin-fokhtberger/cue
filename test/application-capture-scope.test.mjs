import { describe, expect, it } from 'vitest';

import {
  ApplicationCaptureScopeCoordinator,
  ApplicationCaptureScopeError,
  applicationSourceLabel,
  requestApplicationScope,
  validateApplicationInventory,
} from '../src/core/application-capture-scope.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function inventoryEvent() {
  return {
    event: 'inventory',
    generation: 7,
    sources: [
      {
        identity: {
          pid: 1_000,
          bundleIdentifier: 'com.google.Chrome',
          displayName: 'Google Chrome',
        },
        status: 'available',
        failure: null,
        audioProcessObjectIds: [101, 102],
        outputDeviceUids: ['sony'],
        requiresBrowserWideAcknowledgement: true,
      },
      {
        identity: {
          pid: 2_000,
          bundleIdentifier: 'us.zoom.xos',
          displayName: 'zoom.us',
        },
        status: 'available',
        failure: null,
        audioProcessObjectIds: [201],
        outputDeviceUids: ['sony'],
        requiresBrowserWideAcknowledgement: false,
      },
      {
        identity: null,
        status: 'unresolved',
        failure: 'missing-process-metadata',
        audioProcessObjectIds: [301],
        outputDeviceUids: [],
        requiresBrowserWideAcknowledgement: false,
      },
    ],
  };
}

function selection(overrides = {}) {
  return {
    inventoryGeneration: 7,
    responsiblePid: 2_000,
    bundleIdentifier: 'us.zoom.xos',
    browserWideAcknowledged: false,
    ...overrides,
  };
}

describe('application capture scope boundary', () => {
  it('exposes stable typed errors', () => {
    const error = new ApplicationCaptureScopeError('fixture-code');
    expect(error).toMatchObject({
      name: 'ApplicationCaptureScopeError',
      code: 'fixture-code',
      message: 'fixture-code',
    });
  });

  it('validates and owns an exact helper inventory without retaining helper objects', () => {
    const event = inventoryEvent();
    const inventory = validateApplicationInventory(event, 7);

    expect(inventory).toEqual(event);
    expect(inventory).not.toBe(event);
    expect(inventory.sources[0]).not.toBe(event.sources[0]);
    event.sources[0].identity.displayName = 'tampered';
    expect(inventory.sources[0].identity.displayName).toBe('Google Chrome');
  });

  it.each([
    [null],
    [{ event: 'inventory', generation: 7, sources: [], extra: true }],
    [{ event: 'other', generation: 7, sources: [] }],
    [{ event: 'inventory', generation: 8, sources: [] }],
    [{ event: 'inventory', generation: 7, sources: 'not-array' }],
    [{ event: 'inventory', generation: 7, sources: Array.from({ length: 257 }, () => ({})) }],
    [
      {
        event: 'inventory',
        generation: 7,
        sources: [{ ...inventoryEvent().sources[0], extra: true }],
      },
    ],
    [
      {
        event: 'inventory',
        generation: 7,
        sources: [{ ...inventoryEvent().sources[0], identity: null }],
      },
    ],
    [
      {
        event: 'inventory',
        generation: 7,
        sources: [{ ...inventoryEvent().sources[2], failure: 'unknown' }],
      },
    ],
    [
      {
        event: 'inventory',
        generation: 7,
        sources: [{ ...inventoryEvent().sources[0], audioProcessObjectIds: [0] }],
      },
    ],
    [
      {
        event: 'inventory',
        generation: 7,
        sources: [{ ...inventoryEvent().sources[0], outputDeviceUids: [' '] }],
      },
    ],
  ])('rejects malformed, stale, or oversized helper inventory %j', (event) => {
    expect(() => validateApplicationInventory(event, 7)).toThrow(
      new ApplicationCaptureScopeError('invalid-application-inventory'),
    );
  });

  it.each([undefined, null, 0, -1, 1.5])(
    'rejects invalid expected inventory generation %j',
    (generation) => {
      const event = inventoryEvent();
      event.generation = generation;
      expect(() => validateApplicationInventory(event, generation)).toThrow(
        new ApplicationCaptureScopeError('invalid-application-inventory'),
      );
    },
  );

  it('accepts the exact inventory source bound and every declared unresolved reason', () => {
    const base = inventoryEvent().sources[2];
    const failures = [
      'cue-owned-ancestry',
      'ancestry-cycle',
      'missing-process-metadata',
      'ancestry-limit-exceeded',
      'missing-responsible-identity',
    ];
    const sources = Array.from({ length: 256 }, (_, index) => ({
      ...base,
      failure: failures[index % failures.length],
      audioProcessObjectIds: [index + 1],
    }));

    expect(
      validateApplicationInventory({ event: 'inventory', generation: 7, sources }, 7).sources,
    ).toHaveLength(256);
    expect(() =>
      validateApplicationInventory(
        {
          event: 'inventory',
          generation: 7,
          sources: [...sources, { ...sources[0], audioProcessObjectIds: [257] }],
        },
        7,
      ),
    ).toThrow(new ApplicationCaptureScopeError('invalid-application-inventory'));
  });

  it('rejects mixed invalid arrays and every invalid source discriminator', () => {
    const cases = [
      { ...inventoryEvent().sources[0], audioProcessObjectIds: [1, 0] },
      { ...inventoryEvent().sources[0], requiresBrowserWideAcknowledgement: 1 },
      { ...inventoryEvent().sources[0], failure: 'unexpected' },
      {
        ...inventoryEvent().sources[0],
        identity: { ...inventoryEvent().sources[0].identity, pid: 0 },
      },
      { ...inventoryEvent().sources[2], status: 'other' },
      { ...inventoryEvent().sources[2], identity: inventoryEvent().sources[0].identity },
      { ...inventoryEvent().sources[2], requiresBrowserWideAcknowledgement: true },
    ];
    for (const source of cases) {
      expect(() =>
        validateApplicationInventory({ event: 'inventory', generation: 7, sources: [source] }, 7),
      ).toThrow(new ApplicationCaptureScopeError('invalid-application-inventory'));
    }
  });

  it('rejects non-plain envelopes and invalid identity strings', () => {
    const functionEnvelope = () => {};
    Object.assign(functionEnvelope, inventoryEvent());
    const nonStringIdentity = {
      length: 1,
      trim() {
        return this;
      },
    };
    const invalidStrings = [
      { bundleIdentifier: 42 },
      { bundleIdentifier: '' },
      { bundleIdentifier: ' us.zoom.xos' },
      { displayName: 42 },
      { displayName: '' },
      { displayName: ' zoom.us' },
      { bundleIdentifier: nonStringIdentity },
    ];
    expect(() => validateApplicationInventory(functionEnvelope, 7)).toThrow(
      new ApplicationCaptureScopeError('invalid-application-inventory'),
    );
    for (const identityPatch of invalidStrings) {
      const event = inventoryEvent();
      event.sources[1].identity = {
        ...event.sources[1].identity,
        ...identityPatch,
      };
      expect(() => validateApplicationInventory(event, 7)).toThrow(
        new ApplicationCaptureScopeError('invalid-application-inventory'),
      );
    }
  });

  it('builds accurate normal and browser-wide source labels', () => {
    const inventory = validateApplicationInventory(inventoryEvent(), 7);
    expect(applicationSourceLabel(inventory.sources[0])).toBe(
      'Google Chrome - all audible tabs in this browser instance',
    );
    expect(applicationSourceLabel(inventory.sources[1])).toBe('zoom.us');
    expect(applicationSourceLabel(inventory.sources[2])).toBe('Unavailable audio process');
  });

  it('accepts an exact current selectable instance but never marks it verified', () => {
    const inventory = validateApplicationInventory(inventoryEvent(), 7);
    expect(requestApplicationScope(inventory, selection())).toEqual({
      kind: 'application',
      verified: false,
      inventoryGeneration: 7,
      responsiblePid: 2_000,
      bundleIdentifier: 'us.zoom.xos',
      displayName: 'zoom.us',
      browserWideAcknowledged: false,
      requiresBrowserWideAcknowledgement: false,
    });
  });

  it('requires browser-wide acknowledgement and preserves the exact Chrome instance', () => {
    const inventory = validateApplicationInventory(inventoryEvent(), 7);
    const chrome = selection({
      responsiblePid: 1_000,
      bundleIdentifier: 'com.google.Chrome',
    });
    expect(() => requestApplicationScope(inventory, chrome)).toThrow(
      new ApplicationCaptureScopeError('browser-wide-acknowledgement-required'),
    );
    expect(
      requestApplicationScope(inventory, {
        ...chrome,
        browserWideAcknowledged: true,
      }),
    ).toMatchObject({
      responsiblePid: 1_000,
      bundleIdentifier: 'com.google.Chrome',
      browserWideAcknowledged: true,
      verified: false,
    });
  });

  it.each([
    [null, 'invalid-application-selection'],
    [{ ...selection(), extra: true }, 'invalid-application-selection'],
    [selection({ responsiblePid: 0 }), 'invalid-application-selection'],
    [selection({ bundleIdentifier: ' ' }), 'invalid-application-selection'],
    [selection({ browserWideAcknowledged: 1 }), 'invalid-application-selection'],
    [selection({ inventoryGeneration: 6 }), 'stale-application-inventory'],
    [selection({ responsiblePid: 9_999 }), 'application-source-disappeared'],
    [
      selection({ responsiblePid: 1_000, bundleIdentifier: 'us.zoom.xos' }),
      'application-source-disappeared',
    ],
  ])('fails closed for selection %j', (candidate, code) => {
    const inventory = validateApplicationInventory(inventoryEvent(), 7);
    expect(() => requestApplicationScope(inventory, candidate)).toThrow(
      new ApplicationCaptureScopeError(code),
    );
  });

  it('rejects an otherwise available application without an output device', () => {
    const event = inventoryEvent();
    event.sources[1].outputDeviceUids = [];
    const inventory = validateApplicationInventory(event, 7);
    expect(() => requestApplicationScope(inventory, selection())).toThrow(
      new ApplicationCaptureScopeError('application-output-device-missing'),
    );
  });
});

describe('ApplicationCaptureScopeCoordinator', () => {
  it('refreshes successive generations, invalidates failed inventory, and permits a clean retry', async () => {
    const generations = [];
    const inventoryClient = {
      async refresh(generation) {
        generations.push(generation);
        if (generation === 1) throw new Error('fixture-refresh-failed');
        const event = inventoryEvent();
        event.generation = generation;
        return validateApplicationInventory(event, generation);
      },
    };
    const coordinator = new ApplicationCaptureScopeCoordinator({ inventoryClient });

    await expect(coordinator.refresh()).rejects.toThrow('fixture-refresh-failed');
    expect(() => coordinator.select(selection())).toThrow(
      new ApplicationCaptureScopeError('application-inventory-required'),
    );
    await expect(coordinator.refresh()).resolves.toMatchObject({
      inventory: { event: 'inventory', generation: 2 },
      requestedScope: null,
    });
    expect(generations).toEqual([1, 2]);
    expect(
      coordinator.select(
        selection({
          inventoryGeneration: 2,
        }),
      ),
    ).toMatchObject({
      kind: 'application',
      verified: false,
      inventoryGeneration: 2,
      responsiblePid: 2_000,
    });
  });

  it('rejects a concurrent refresh without corrupting the in-flight generation', async () => {
    const pending = deferred();
    const inventoryClient = {
      refresh: () => pending.promise,
    };
    const coordinator = new ApplicationCaptureScopeCoordinator({ inventoryClient });
    const first = coordinator.refresh();

    await expect(coordinator.refresh()).rejects.toEqual(
      new ApplicationCaptureScopeError('application-inventory-refresh-active'),
    );
    const event = inventoryEvent();
    event.generation = 1;
    pending.resolve(validateApplicationInventory(event, 1));
    await expect(first).resolves.toMatchObject({
      inventory: { generation: 1 },
      requestedScope: null,
    });
  });

  it('fails closed when capture is active before or during inventory refresh', async () => {
    let captureActive = true;
    const pending = deferred();
    const inventoryClient = {
      refresh: () => pending.promise,
    };
    const coordinator = new ApplicationCaptureScopeCoordinator({
      inventoryClient,
      isCaptureActive: () => captureActive,
    });

    await expect(coordinator.refresh()).rejects.toEqual(
      new ApplicationCaptureScopeError('capture-active'),
    );
    expect(() => coordinator.select(selection())).toThrow(
      new ApplicationCaptureScopeError('capture-active'),
    );

    captureActive = false;
    const refresh = coordinator.refresh();
    captureActive = true;
    pending.resolve(validateApplicationInventory(inventoryEvent(), 7));
    await expect(refresh).rejects.toEqual(new ApplicationCaptureScopeError('capture-active'));

    captureActive = false;
    expect(() => coordinator.select(selection())).toThrow(
      new ApplicationCaptureScopeError('application-inventory-required'),
    );
  });
});
