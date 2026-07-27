import { describe, expect, it, vi } from 'vitest';

import {
  AudioDeviceSelectionError,
  applyOutputSelection,
  buildAudioDeviceOptions,
  buildMicrophoneConstraints,
  describeEffectiveInput,
  normalizeAudioDeviceId,
} from '../src/core/audio-device-policy.mjs';

describe('audio device selection policy', () => {
  it.each([undefined, null, '', '   ', 42, {}, []])(
    'normalizes invalid selection %j to the system default',
    (selection) => {
      expect(normalizeAudioDeviceId(selection)).toBe('default');
    },
  );

  it('preserves and trims an explicit device ID', () => {
    expect(normalizeAudioDeviceId('  hyperx-device  ')).toBe('hyperx-device');
  });

  it('uses processing constraints without forcing a device for the default input', () => {
    expect(buildMicrophoneConstraints('default')).toEqual({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
  });

  it('uses an exact device constraint for an explicit input', () => {
    expect(buildMicrophoneConstraints(' hyperx-device ')).toEqual({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
        deviceId: { exact: 'hyperx-device' },
      },
    });
  });

  it('builds stable labeled options, removes duplicates, and keeps a missing selection visible', () => {
    const devices = [
      { kind: 'audioinput', deviceId: 'default', label: 'Default - Sony' },
      { kind: 'audioinput', deviceId: 'sony', label: 'Sony' },
      { kind: 'audioinput', deviceId: 'sony', label: 'Sony duplicate' },
      { kind: 'audioinput', deviceId: 'hyperx', label: '' },
      { kind: 'audioinput', deviceId: 'trimmed', label: '  Trimmed label  ' },
      { kind: 'audiooutput', deviceId: 'speaker', label: 'Built-in output' },
      { kind: 'videoinput', deviceId: 'camera', label: 'Camera' },
    ];

    expect(buildAudioDeviceOptions(devices, 'audioinput', 'missing')).toEqual([
      { id: 'default', label: 'System default', available: true },
      { id: 'sony', label: 'Sony', available: true },
      { id: 'hyperx', label: 'Input 2', available: true },
      { id: 'trimmed', label: 'Trimmed label', available: true },
      { id: 'missing', label: 'Unavailable device', available: false },
    ]);
  });

  it('does not add an unavailable option when the default or explicit selection exists', () => {
    const devices = [{ kind: 'audiooutput', deviceId: 'sony', label: 'Sony' }];

    expect(buildAudioDeviceOptions(devices, 'audiooutput', 'default')).toEqual([
      { id: 'default', label: 'System default', available: true },
      { id: 'sony', label: 'Sony', available: true },
    ]);
    expect(buildAudioDeviceOptions(devices, 'audiooutput', 'sony')).toEqual([
      { id: 'default', label: 'System default', available: true },
      { id: 'sony', label: 'Sony', available: true },
    ]);
  });

  it('returns only the system default for an empty device list', () => {
    expect(buildAudioDeviceOptions([], 'audioinput', undefined)).toEqual([
      { id: 'default', label: 'System default', available: true },
    ]);
  });

  it('uses output-specific fallback labels', () => {
    expect(
      buildAudioDeviceOptions(
        [{ kind: 'audiooutput', deviceId: 'unknown-output', label: '' }],
        'audiooutput',
        'unknown-output',
      ),
    ).toEqual([
      { id: 'default', label: 'System default', available: true },
      { id: 'unknown-output', label: 'Output 1', available: true },
    ]);
  });

  it('reports requested and effective microphone identity from the opened track', () => {
    const track = {
      label: 'HyperX SoloCast',
      getSettings: vi.fn(() => ({ deviceId: 'effective-hyperx' })),
    };

    expect(describeEffectiveInput(track, 'requested-hyperx')).toEqual({
      requestedId: 'requested-hyperx',
      effectiveId: 'effective-hyperx',
      effectiveLabel: 'HyperX SoloCast',
    });
  });

  it('falls back to unknown effective input metadata when the track exposes none', () => {
    expect(describeEffectiveInput({ label: '', getSettings: () => ({}) }, undefined)).toEqual({
      requestedId: 'default',
      effectiveId: 'unknown',
      effectiveLabel: 'Unknown input',
    });
  });

  it('trims effective input metadata and treats whitespace as unknown', () => {
    expect(
      describeEffectiveInput(
        { label: '  HyperX SoloCast  ', getSettings: () => ({ deviceId: '  hyperx  ' }) },
        'hyperx',
      ),
    ).toEqual({
      requestedId: 'hyperx',
      effectiveId: 'hyperx',
      effectiveLabel: 'HyperX SoloCast',
    });
    expect(
      describeEffectiveInput({ label: '   ', getSettings: () => ({ deviceId: '   ' }) }, 'default'),
    ).toEqual({
      requestedId: 'default',
      effectiveId: 'unknown',
      effectiveLabel: 'Unknown input',
    });
  });

  it('applies the system output fallback as an empty sink ID', async () => {
    const target = {
      sinkId: '',
      setSinkId: vi.fn().mockResolvedValue(undefined),
    };

    await expect(applyOutputSelection(target, 'default')).resolves.toEqual({
      requestedId: 'default',
      effectiveId: 'default',
      supported: true,
    });
    expect(target.setSinkId).toHaveBeenCalledWith('');
  });

  it('applies an exact explicit cue playback sink', async () => {
    const target = {
      sinkId: 'sony-output',
      setSinkId: vi.fn().mockResolvedValue(undefined),
    };

    await expect(applyOutputSelection(target, ' sony-output ')).resolves.toEqual({
      requestedId: 'sony-output',
      effectiveId: 'sony-output',
      supported: true,
    });
    expect(target.setSinkId).toHaveBeenCalledWith('sony-output');
  });

  it('accepts the system default when output selection is unsupported', async () => {
    await expect(applyOutputSelection({}, 'default')).resolves.toEqual({
      requestedId: 'default',
      effectiveId: 'default',
      supported: false,
    });
  });

  it('rejects an unsupported explicit output without silently using the default', async () => {
    const error = await applyOutputSelection({}, 'sony-output').catch((caught) => caught);

    expect(error).toEqual(
      new AudioDeviceSelectionError('output', 'selection-unsupported', 'sony-output'),
    );
    expect(error.message).toBe('output:selection-unsupported:sony-output');
    expect(Object.hasOwn(error, 'cause')).toBe(false);
  });

  it('rejects an effective output that differs from the explicit request', async () => {
    const target = {
      sinkId: '',
      setSinkId: vi.fn().mockResolvedValue(undefined),
    };

    const error = await applyOutputSelection(target, 'sony-output').catch((caught) => caught);
    expect(error).toEqual(
      new AudioDeviceSelectionError('output', 'effective-mismatch', 'sony-output'),
    );
    expect(Object.hasOwn(error, 'cause')).toBe(false);
  });

  it('classifies a missing readable effective sink as a mismatch instead of throwing a TypeError', async () => {
    const target = {
      setSinkId: vi.fn().mockResolvedValue(undefined),
    };

    await expect(applyOutputSelection(target, 'sony-output')).rejects.toMatchObject({
      name: 'AudioDeviceSelectionError',
      code: 'effective-mismatch',
      requestedId: 'sony-output',
    });
  });

  it('normalizes whitespace around the effective sink ID', async () => {
    const target = {
      sinkId: '  sony-output  ',
      setSinkId: vi.fn().mockResolvedValue(undefined),
    };

    await expect(applyOutputSelection(target, 'sony-output')).resolves.toEqual({
      requestedId: 'sony-output',
      effectiveId: 'sony-output',
      supported: true,
    });
  });

  it('treats a whitespace effective sink as the system default', async () => {
    const target = {
      sinkId: '   ',
      setSinkId: vi.fn().mockResolvedValue(undefined),
    };

    await expect(applyOutputSelection(target, 'default')).resolves.toEqual({
      requestedId: 'default',
      effectiveId: 'default',
      supported: true,
    });
  });

  it.each([
    ['NotFoundError', 'device-unavailable'],
    ['NotAllowedError', 'permission-denied'],
    ['AbortError', 'selection-failed'],
  ])('classifies %s from an explicit output selection as %s', async (name, code) => {
    const cause = new Error(name);
    cause.name = name;
    const target = {
      setSinkId: vi.fn().mockRejectedValue(cause),
    };

    const error = await applyOutputSelection(target, 'sony-output').catch((caught) => caught);
    expect(error).toMatchObject({
      name: 'AudioDeviceSelectionError',
      kind: 'output',
      code,
      requestedId: 'sony-output',
      cause,
    });
  });
});
