const INVENTORY_KEYS = ['event', 'generation', 'sources'];
const SOURCE_KEYS = [
  'audioProcessObjectIds',
  'failure',
  'identity',
  'outputDeviceUids',
  'requiresBrowserWideAcknowledgement',
  'status',
];
const IDENTITY_KEYS = ['bundleIdentifier', 'displayName', 'pid'];
const SELECTION_KEYS = [
  'browserWideAcknowledged',
  'bundleIdentifier',
  'inventoryGeneration',
  'responsiblePid',
];
const UNRESOLVED_FAILURES = new Set([
  'cue-owned-ancestry',
  'ancestry-cycle',
  'missing-process-metadata',
  'ancestry-limit-exceeded',
  'missing-responsible-identity',
]);
const MAXIMUM_INVENTORY_SOURCES = 256;

export class ApplicationCaptureScopeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ApplicationCaptureScopeError';
    this.code = code;
  }
}

export class ApplicationCaptureScopeCoordinator {
  #generation = 0;
  #inventory = null;
  #inventoryClient;
  #isCaptureActive;
  #requestedScope = null;
  #refreshing = false;

  constructor({ inventoryClient, isCaptureActive = Boolean }) {
    this.#inventoryClient = inventoryClient;
    this.#isCaptureActive = isCaptureActive;
  }

  async refresh() {
    this.#requireCaptureIdle();
    if (this.#refreshing) {
      throw new ApplicationCaptureScopeError('application-inventory-refresh-active');
    }
    this.#refreshing = true;
    this.#generation += 1;
    this.#inventory = null;
    this.#requestedScope = null;
    try {
      const inventory = await this.#inventoryClient.refresh(this.#generation);
      this.#requireCaptureIdle();
      this.#inventory = inventory;
      return { inventory, requestedScope: null };
    } finally {
      this.#refreshing = false;
    }
  }

  select(selection) {
    this.#requireCaptureIdle();
    if (!this.#inventory) {
      throw new ApplicationCaptureScopeError('application-inventory-required');
    }
    const requestedScope = requestApplicationScope(this.#inventory, selection);
    this.#requestedScope = requestedScope;
    return requestedScope;
  }

  captureConfiguration() {
    this.#requireCaptureIdle();
    if (!this.#requestedScope) {
      throw new ApplicationCaptureScopeError('application-selection-required');
    }
    return { scope: { ...this.#requestedScope } };
  }

  #requireCaptureIdle() {
    if (this.#isCaptureActive()) {
      this.#inventory = null;
      this.#requestedScope = null;
      throw new ApplicationCaptureScopeError('capture-active');
    }
  }
}

export function validateApplicationInventory(event, expectedGeneration) {
  if (
    !plainObjectWithKeys(event, INVENTORY_KEYS) ||
    event.event !== 'inventory' ||
    !Number.isSafeInteger(expectedGeneration) ||
    expectedGeneration <= 0 ||
    event.generation !== expectedGeneration ||
    !Array.isArray(event.sources) ||
    event.sources.length > MAXIMUM_INVENTORY_SOURCES
  ) {
    throw new ApplicationCaptureScopeError('invalid-application-inventory');
  }

  return {
    event: 'inventory',
    generation: event.generation,
    sources: event.sources.map(validateSource),
  };
}

export function applicationSourceLabel(source) {
  if (source.status !== 'available') {
    return 'Unavailable audio process';
  }
  return source.requiresBrowserWideAcknowledgement
    ? `${source.identity.displayName} - all audible tabs in this browser instance`
    : source.identity.displayName;
}

export function requestApplicationScope(inventory, selection) {
  if (!plainObjectWithKeys(selection, SELECTION_KEYS)) {
    throw new ApplicationCaptureScopeError('invalid-application-selection');
  }
  if (selection.inventoryGeneration !== inventory.generation) {
    throw new ApplicationCaptureScopeError('stale-application-inventory');
  }
  if (
    !Number.isSafeInteger(selection.responsiblePid) ||
    selection.responsiblePid <= 0 ||
    !nonemptyString(selection.bundleIdentifier) ||
    typeof selection.browserWideAcknowledged !== 'boolean'
  ) {
    throw new ApplicationCaptureScopeError('invalid-application-selection');
  }

  const source = inventory.sources.find(
    (candidate) =>
      candidate.status === 'available' &&
      candidate.identity.pid === selection.responsiblePid &&
      candidate.identity.bundleIdentifier === selection.bundleIdentifier,
  );
  if (!source) {
    throw new ApplicationCaptureScopeError('application-source-disappeared');
  }
  if (source.requiresBrowserWideAcknowledgement && !selection.browserWideAcknowledged) {
    throw new ApplicationCaptureScopeError('browser-wide-acknowledgement-required');
  }
  if (source.outputDeviceUids.length === 0) {
    throw new ApplicationCaptureScopeError('application-output-device-missing');
  }

  return {
    kind: 'application',
    verified: false,
    inventoryGeneration: inventory.generation,
    responsiblePid: source.identity.pid,
    bundleIdentifier: source.identity.bundleIdentifier,
    displayName: source.identity.displayName,
    browserWideAcknowledged: selection.browserWideAcknowledged,
    requiresBrowserWideAcknowledgement: source.requiresBrowserWideAcknowledgement,
  };
}

function validateSource(source) {
  if (
    !plainObjectWithKeys(source, SOURCE_KEYS) ||
    !Array.isArray(source.audioProcessObjectIds) ||
    !source.audioProcessObjectIds.every(
      (objectID) => Number.isSafeInteger(objectID) && objectID > 0,
    ) ||
    !Array.isArray(source.outputDeviceUids) ||
    !source.outputDeviceUids.every(nonemptyString) ||
    typeof source.requiresBrowserWideAcknowledgement !== 'boolean'
  ) {
    throw new ApplicationCaptureScopeError('invalid-application-inventory');
  }

  let identity = null;
  if (source.status === 'available') {
    if (
      source.failure !== null ||
      !plainObjectWithKeys(source.identity, IDENTITY_KEYS) ||
      !Number.isSafeInteger(source.identity.pid) ||
      source.identity.pid <= 0 ||
      !nonemptyString(source.identity.bundleIdentifier) ||
      !nonemptyString(source.identity.displayName)
    ) {
      throw new ApplicationCaptureScopeError('invalid-application-inventory');
    }
    identity = {
      pid: source.identity.pid,
      bundleIdentifier: source.identity.bundleIdentifier,
      displayName: source.identity.displayName,
    };
  } else if (
    source.status !== 'unresolved' ||
    source.identity !== null ||
    !UNRESOLVED_FAILURES.has(source.failure) ||
    source.requiresBrowserWideAcknowledgement
  ) {
    throw new ApplicationCaptureScopeError('invalid-application-inventory');
  }

  return {
    identity,
    status: source.status,
    failure: source.failure,
    audioProcessObjectIds: [...source.audioProcessObjectIds],
    outputDeviceUids: [...source.outputDeviceUids],
    requiresBrowserWideAcknowledgement: source.requiresBrowserWideAcknowledgement,
  };
}

function plainObjectWithKeys(value, expectedKeys) {
  return (
    value != null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join('\0') === expectedKeys.join('\0')
  );
}

function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}
