const DIAGNOSTIC_SCOPE = Object.freeze({ kind: 'diagnostic-global' });

export const DIAGNOSTIC_GLOBAL_CAPTURE = Object.freeze({
  scope: DIAGNOSTIC_SCOPE,
});

export function encodeHelperCaptureConfiguration(configuration) {
  if (
    configuration === null ||
    typeof configuration !== 'object' ||
    Array.isArray(configuration) ||
    Object.keys(configuration).length !== 1 ||
    configuration.scope === null ||
    typeof configuration.scope !== 'object' ||
    Array.isArray(configuration.scope) ||
    Object.keys(configuration.scope).length !== 1 ||
    configuration.scope.kind !== 'diagnostic-global'
  ) {
    throw new TypeError('Unsupported native helper capture configuration.');
  }

  return Buffer.from(
    `${JSON.stringify({
      command: 'capture',
      protocolVersion: 1,
      scope: { kind: configuration.scope.kind },
    })}\n`,
  );
}
