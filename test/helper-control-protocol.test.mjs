import { describe, expect, it } from 'vitest';

import {
  DIAGNOSTIC_GLOBAL_CAPTURE,
  encodeHelperCaptureConfiguration,
  encodeHelperInventoryRequest,
} from '../src/core/helper-control-protocol.mjs';

describe('helper control protocol v1', () => {
  it('encodes the exact bounded diagnostic-global capture envelope', () => {
    expect(encodeHelperCaptureConfiguration(DIAGNOSTIC_GLOBAL_CAPTURE)).toEqual(
      Buffer.from(
        '{"command":"capture","protocolVersion":1,"scope":{"kind":"diagnostic-global"}}\n',
      ),
    );
    expect(Object.isFrozen(DIAGNOSTIC_GLOBAL_CAPTURE)).toBe(true);
    expect(Object.isFrozen(DIAGNOSTIC_GLOBAL_CAPTURE.scope)).toBe(true);
  });

  it('encodes only the native application selection fields from an exact requested scope', () => {
    const configuration = {
      scope: {
        kind: 'application',
        verified: false,
        inventoryGeneration: 42,
        responsiblePid: 2_000,
        bundleIdentifier: 'com.google.Chrome',
        displayName: 'Google Chrome',
        browserWideAcknowledged: true,
        requiresBrowserWideAcknowledgement: true,
      },
    };

    expect(encodeHelperCaptureConfiguration(configuration)).toEqual(
      Buffer.from(
        '{"command":"capture","protocolVersion":1,"scope":{"kind":"application","inventoryGeneration":42,"responsiblePid":2000,"bundleIdentifier":"com.google.Chrome","browserWideAcknowledged":true}}\n',
      ),
    );
  });

  it('encodes an acknowledged non-browser application without inventing a browser requirement', () => {
    const configuration = {
      scope: {
        kind: 'application',
        verified: false,
        inventoryGeneration: 1,
        responsiblePid: 2,
        bundleIdentifier: 'us.zoom.xos',
        displayName: 'zoom.us',
        browserWideAcknowledged: false,
        requiresBrowserWideAcknowledgement: false,
      },
    };

    expect(encodeHelperCaptureConfiguration(configuration)).toEqual(
      Buffer.from(
        '{"command":"capture","protocolVersion":1,"scope":{"kind":"application","inventoryGeneration":1,"responsiblePid":2,"bundleIdentifier":"us.zoom.xos","browserWideAcknowledged":false}}\n',
      ),
    );
  });

  it.each([
    [undefined],
    [null],
    [{}],
    [{ scope: null }],
    [{ scope: {} }],
    [{ scope: { kind: '' } }],
    [{ scope: { kind: 'application' } }],
    [
      {
        scope: {
          kind: 'application',
          verified: true,
          inventoryGeneration: 1,
          responsiblePid: 2,
          bundleIdentifier: 'com.google.Chrome',
          displayName: 'Chrome',
          browserWideAcknowledged: true,
          requiresBrowserWideAcknowledgement: true,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'other',
          verified: false,
          inventoryGeneration: 1,
          responsiblePid: 2,
          bundleIdentifier: 'us.zoom.xos',
          displayName: 'zoom.us',
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: false,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: 0,
          responsiblePid: 2,
          bundleIdentifier: 'us.zoom.xos',
          displayName: 'zoom.us',
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: false,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: 1,
          responsiblePid: 2,
          bundleIdentifier: 7,
          displayName: 'zoom.us',
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: false,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: false,
          responsiblePid: 2,
          bundleIdentifier: 'us.zoom.xos',
          displayName: 'zoom.us',
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: false,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: 1,
          responsiblePid: 2,
          bundleIdentifier: 'us.zoom.xos',
          displayName: 7,
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: false,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: 1,
          responsiblePid: 0,
          bundleIdentifier: 'us.zoom.xos',
          displayName: 'zoom.us',
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: false,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: 1,
          responsiblePid: false,
          bundleIdentifier: 'us.zoom.xos',
          displayName: 'zoom.us',
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: false,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: 1,
          responsiblePid: 2,
          bundleIdentifier: '',
          displayName: 'zoom.us',
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: false,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: 1,
          responsiblePid: 2,
          bundleIdentifier: ' us.zoom.xos',
          displayName: 'zoom.us',
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: false,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: 1,
          responsiblePid: 2,
          bundleIdentifier: 'us.zoom.xos',
          displayName: '',
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: false,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: 1,
          responsiblePid: 2,
          bundleIdentifier: 'us.zoom.xos',
          displayName: ' zoom.us',
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: false,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: 1,
          responsiblePid: 2,
          bundleIdentifier: 'us.zoom.xos',
          displayName: 'zoom.us',
          browserWideAcknowledged: 0,
          requiresBrowserWideAcknowledgement: false,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: 1,
          responsiblePid: 2,
          bundleIdentifier: 'us.zoom.xos',
          displayName: 'zoom.us',
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: 0,
        },
      },
    ],
    [
      {
        scope: {
          kind: 'application',
          verified: false,
          inventoryGeneration: 1,
          responsiblePid: 2,
          bundleIdentifier: 'com.google.Chrome',
          displayName: 'Google Chrome',
          browserWideAcknowledged: false,
          requiresBrowserWideAcknowledgement: true,
        },
      },
    ],
    [{ scope: { kind: 'diagnostic-global', extra: true } }],
    [{ scope: { kind: 'diagnostic-global' }, extra: true }],
  ])('rejects unsupported configuration %j without guessing a fallback', (configuration) => {
    expect(() => encodeHelperCaptureConfiguration(configuration)).toThrow(
      new TypeError('Unsupported native helper capture configuration.'),
    );
  });

  it('rejects a function that imitates the accepted scope fields', () => {
    const scope = () => {};
    scope.kind = 'diagnostic-global';

    expect(() => encodeHelperCaptureConfiguration({ scope })).toThrow(
      new TypeError('Unsupported native helper capture configuration.'),
    );
  });

  it('rejects inherited configuration and application scope fields', () => {
    const configuration = Object.create({ scope: { kind: 'diagnostic-global' } });
    const scope = Object.assign(Object.create({ inherited: true }), {
      kind: 'diagnostic-global',
    });

    expect(() => encodeHelperCaptureConfiguration(configuration)).toThrow(TypeError);
    expect(() => encodeHelperCaptureConfiguration({ scope })).toThrow(TypeError);
  });

  it('rejects non-string objects that imitate string operations', () => {
    const fakeString = {
      length: 1,
      trim() {
        return this;
      },
    };
    const scope = {
      kind: 'application',
      verified: false,
      inventoryGeneration: 1,
      responsiblePid: 2,
      bundleIdentifier: fakeString,
      displayName: 'zoom.us',
      browserWideAcknowledged: false,
      requiresBrowserWideAcknowledgement: false,
    };

    expect(() => encodeHelperCaptureConfiguration({ scope })).toThrow(
      new TypeError('Unsupported native helper capture configuration.'),
    );
  });

  it('encodes an exact versioned application inventory request', () => {
    expect(encodeHelperInventoryRequest(42)).toEqual(
      Buffer.from('{"command":"inventory","generation":42,"protocolVersion":1}\n'),
    );
  });

  it.each([undefined, null, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid inventory generation %j',
    (generation) => {
      expect(() => encodeHelperInventoryRequest(generation)).toThrow(
        new TypeError('Invalid native helper inventory generation.'),
      );
    },
  );
});
