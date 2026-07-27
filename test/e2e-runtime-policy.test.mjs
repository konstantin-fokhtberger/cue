import path from 'node:path';
import os from 'node:os';

import { describe, expect, it } from 'vitest';

import runtimePolicy from '../src/core/e2e-runtime-policy.cjs';

const { resolveE2eRuntime } = runtimePolicy;
const acceptedUserDataDir = path.join(os.tmpdir(), 'cue-e2e-run-123', 'user-data');

describe('Electron E2E runtime policy', () => {
  it('keeps the test runtime disabled unless the exact opt-in value is present', () => {
    for (const enabled of [undefined, null, '', '0', 'true', 'yes', 1]) {
      expect(resolveE2eRuntime({ enabled, userDataDir: acceptedUserDataDir })).toEqual({
        enabled: false,
        userDataDir: null,
      });
    }
  });

  it('accepts an isolated absolute user-data directory only with exact opt-in', () => {
    expect(
      resolveE2eRuntime({
        enabled: '1',
        userDataDir: acceptedUserDataDir,
      }),
    ).toEqual({
      enabled: true,
      userDataDir: path.resolve(acceptedUserDataDir),
    });
  });

  it.each([
    [undefined, 'CUE_E2E_USER_DATA_DIR is required'],
    ['', 'CUE_E2E_USER_DATA_DIR is required'],
    ['   ', 'CUE_E2E_USER_DATA_DIR is required'],
    ['relative/cue-e2e', 'CUE_E2E_USER_DATA_DIR must be absolute'],
    [path.parse(process.cwd()).root, 'CUE_E2E_USER_DATA_DIR cannot be a filesystem root'],
    [
      path.join(path.parse(process.cwd()).root, 'Users', 'shared', 'cue-e2e'),
      'CUE_E2E_USER_DATA_DIR must be inside the OS temporary directory',
    ],
  ])('rejects unsafe enabled user-data path %j', (userDataDir, message) => {
    expect(() => resolveE2eRuntime({ enabled: '1', userDataDir })).toThrow(new Error(message));
  });
});
