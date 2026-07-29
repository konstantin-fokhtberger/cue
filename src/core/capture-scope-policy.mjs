export function canDispatchSystemPcm(scope) {
  return (
    scope !== null &&
    typeof scope === 'object' &&
    Object.hasOwn(scope, 'kind') &&
    Object.hasOwn(scope, 'verified') &&
    scope.kind === 'application' &&
    scope.verified === true
  );
}
