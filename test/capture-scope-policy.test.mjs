import { describe, expect, it } from 'vitest';

import { canDispatchSystemPcm } from '../src/core/capture-scope-policy.mjs';

describe('capture scope provider boundary', () => {
  it.each([
    undefined,
    null,
    false,
    {},
    { kind: 'diagnostic-global', verified: false },
    { kind: 'diagnostic-global', verified: true },
    { kind: 'application', verified: false },
    { kind: 'application', verified: 1 },
  ])('rejects an unverified or non-application scope: %j', (scope) => {
    expect(canDispatchSystemPcm(scope)).toBe(false);
  });

  it('accepts only an explicitly verified application scope', () => {
    expect(
      canDispatchSystemPcm({
        kind: 'application',
        verified: true,
        responsiblePid: 123,
        bundleIdentifier: 'com.google.Chrome',
      }),
    ).toBe(true);
  });

  it('rejects inherited authorization fields', () => {
    const scope = Object.create({ kind: 'application', verified: true });
    expect(canDispatchSystemPcm(scope)).toBe(false);
  });
});
