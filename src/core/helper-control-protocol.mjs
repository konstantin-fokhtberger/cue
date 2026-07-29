const DIAGNOSTIC_SCOPE = Object.freeze({ kind: 'diagnostic-global' });

export const DIAGNOSTIC_GLOBAL_CAPTURE = Object.freeze({
  scope: DIAGNOSTIC_SCOPE,
});

export function encodeHelperCaptureConfiguration(configuration) {
  if (!plainObjectWithKeys(configuration, ['scope'])) {
    throw new TypeError('Unsupported native helper capture configuration.');
  }
  const scope = configuration.scope;
  let encodedScope;
  if (plainObjectWithKeys(scope, ['kind']) && scope.kind === 'diagnostic-global') {
    encodedScope = { kind: 'diagnostic-global' };
  } else if (
    plainObjectWithKeys(scope, [
      'browserWideAcknowledged',
      'bundleIdentifier',
      'displayName',
      'inventoryGeneration',
      'kind',
      'requiresBrowserWideAcknowledgement',
      'responsiblePid',
      'verified',
    ]) &&
    scope.kind === 'application' &&
    scope.verified === false &&
    Number.isSafeInteger(scope.inventoryGeneration) &&
    scope.inventoryGeneration > 0 &&
    Number.isSafeInteger(scope.responsiblePid) &&
    scope.responsiblePid > 0 &&
    nonemptyString(scope.bundleIdentifier) &&
    nonemptyString(scope.displayName) &&
    typeof scope.browserWideAcknowledged === 'boolean' &&
    typeof scope.requiresBrowserWideAcknowledgement === 'boolean' &&
    (!scope.requiresBrowserWideAcknowledgement || scope.browserWideAcknowledged)
  ) {
    encodedScope = {
      kind: 'application',
      inventoryGeneration: scope.inventoryGeneration,
      responsiblePid: scope.responsiblePid,
      bundleIdentifier: scope.bundleIdentifier,
      browserWideAcknowledged: scope.browserWideAcknowledged,
    };
  } else {
    throw new TypeError('Unsupported native helper capture configuration.');
  }

  return Buffer.from(
    `${JSON.stringify({
      command: 'capture',
      protocolVersion: 1,
      scope: encodedScope,
    })}\n`,
  );
}

export function encodeHelperInventoryRequest(generation) {
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw new TypeError('Invalid native helper inventory generation.');
  }
  return Buffer.from(
    `${JSON.stringify({
      command: 'inventory',
      generation,
      protocolVersion: 1,
    })}\n`,
  );
}

function plainObjectWithKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join('\0') === keys.join('\0')
  );
}

function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}
