export const DEFAULT_AUDIO_DEVICE_ID = 'default';

export class AudioDeviceSelectionError extends Error {
  constructor(kind, code, requestedId, cause) {
    super(`${kind}:${code}:${requestedId}`, cause === undefined ? undefined : { cause });
    this.name = 'AudioDeviceSelectionError';
    this.kind = kind;
    this.code = code;
    this.requestedId = requestedId;
  }
}

export function normalizeAudioDeviceId(value) {
  if (typeof value !== 'string') {
    return DEFAULT_AUDIO_DEVICE_ID;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : DEFAULT_AUDIO_DEVICE_ID;
}

export function buildMicrophoneConstraints(selectedId) {
  const requestedId = normalizeAudioDeviceId(selectedId);
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    channelCount: 1,
  };
  if (requestedId !== DEFAULT_AUDIO_DEVICE_ID) {
    audio.deviceId = { exact: requestedId };
  }
  return { audio };
}

export function buildAudioDeviceOptions(devices, kind, selectedId) {
  const prefix = kind === 'audiooutput' ? 'Output' : 'Input';
  const options = [
    {
      id: DEFAULT_AUDIO_DEVICE_ID,
      label: 'System default',
      available: true,
    },
  ];
  const seen = new Set([DEFAULT_AUDIO_DEVICE_ID]);

  for (const device of devices) {
    if (device.kind !== kind) {
      continue;
    }
    const id = normalizeAudioDeviceId(device.deviceId);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const number = options.length;
    options.push({
      id,
      label: device.label.trim() || `${prefix} ${number}`,
      available: true,
    });
  }

  const requestedId = normalizeAudioDeviceId(selectedId);
  if (!seen.has(requestedId)) {
    options.push({
      id: requestedId,
      label: 'Unavailable device',
      available: false,
    });
  }
  return options;
}

export function describeEffectiveInput(track, selectedId) {
  const settings = track.getSettings();
  return {
    requestedId: normalizeAudioDeviceId(selectedId),
    effectiveId: normalizeEffectiveId(settings.deviceId),
    effectiveLabel: track.label.trim() || 'Unknown input',
  };
}

function normalizeEffectiveId(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'unknown';
  }
  return value.trim();
}

function outputErrorCode(error) {
  if (error && error.name === 'NotFoundError') {
    return 'device-unavailable';
  }
  if (error && error.name === 'NotAllowedError') {
    return 'permission-denied';
  }
  return 'selection-failed';
}

export async function applyOutputSelection(target, selectedId) {
  const requestedId = normalizeAudioDeviceId(selectedId);
  if (typeof target.setSinkId !== 'function') {
    if (requestedId === DEFAULT_AUDIO_DEVICE_ID) {
      return {
        requestedId,
        effectiveId: DEFAULT_AUDIO_DEVICE_ID,
        supported: false,
      };
    }
    throw new AudioDeviceSelectionError('output', 'selection-unsupported', requestedId);
  }

  try {
    await target.setSinkId(requestedId === DEFAULT_AUDIO_DEVICE_ID ? '' : requestedId);
  } catch (error) {
    throw new AudioDeviceSelectionError('output', outputErrorCode(error), requestedId, error);
  }

  const effectiveId =
    typeof target.sinkId === 'string' && target.sinkId.trim().length > 0
      ? target.sinkId.trim()
      : DEFAULT_AUDIO_DEVICE_ID;
  if (effectiveId !== requestedId) {
    throw new AudioDeviceSelectionError('output', 'effective-mismatch', requestedId);
  }
  return { requestedId, effectiveId, supported: true };
}
