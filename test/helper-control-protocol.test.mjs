import { describe, expect, it } from 'vitest';

import {
  DIAGNOSTIC_GLOBAL_CAPTURE,
  encodeHelperCaptureConfiguration,
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

  it.each([
    [undefined],
    [null],
    [{}],
    [{ scope: null }],
    [{ scope: {} }],
    [{ scope: { kind: '' } }],
    [{ scope: { kind: 'application' } }],
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
});
