import { describe, expect, it } from 'vitest';

import { systemCaptureFailureMessage } from '../src/core/system-capture-status.mjs';

describe('systemCaptureFailureMessage', () => {
  it('reports a typed degraded state without implying microphone failure', () => {
    expect(systemCaptureFailureMessage('helper-error')).toBe(
      'System audio unavailable: helper-error. Microphone remains active; remote participants are not being captured.',
    );
  });
});
