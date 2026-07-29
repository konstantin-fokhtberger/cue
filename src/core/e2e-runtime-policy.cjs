const path = require('node:path');
const os = require('node:os');

function resolveE2eRuntime({ enabled, userDataDir }) {
  if (enabled !== '1') {
    return {
      enabled: false,
      userDataDir: null,
    };
  }
  if (typeof userDataDir !== 'string' || userDataDir.trim().length === 0) {
    throw new Error('CUE_E2E_USER_DATA_DIR is required');
  }
  if (!path.isAbsolute(userDataDir)) {
    throw new Error('CUE_E2E_USER_DATA_DIR must be absolute');
  }
  const resolved = path.resolve(userDataDir);
  if (resolved === path.parse(resolved).root) {
    throw new Error('CUE_E2E_USER_DATA_DIR cannot be a filesystem root');
  }
  const temporaryRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${temporaryRoot}${path.sep}`)) {
    throw new Error('CUE_E2E_USER_DATA_DIR must be inside the OS temporary directory');
  }
  return {
    enabled: true,
    userDataDir: resolved,
  };
}

module.exports = { resolveE2eRuntime };
