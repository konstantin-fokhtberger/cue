import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const helperBuildSource = await readFile(
  new URL('../tools/build-audio-helper.mjs', import.meta.url),
  'utf8',
);

describe('IT-PACKAGE-AUDIO-USAGE-001 macOS CoreAudio Tap package contract', () => {
  it('uses a stable bundle identity and declares system-audio capture purpose', () => {
    expect(packageJson.build.appId).toBe('com.cue.overlay');
    expect(packageJson.build.mac.extendInfo.NSAudioCaptureUsageDescription).toBe(
      'cue captures system audio to transcribe the other participant in a call.',
    );
  });

  it('uses an Electron release with the macOS CoreAudio Tap path', () => {
    const electronMajor = Number.parseInt(packageJson.devDependencies.electron, 10);

    expect(electronMajor).toBeGreaterThanOrEqual(39);
  });

  it('builds and packages the narrow native helper as an app resource', () => {
    expect(packageJson.scripts['pack:local']).toContain('build:native-audio');
    expect(packageJson.scripts['pack:ci']).toContain('build:native-audio');
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/native/cue-audio-tap-helper',
      to: 'native/cue-audio-tap-helper',
    });
    expect(helperBuildSource).toContain("native', 'audio-tap-helper', 'main.swift");
    expect(helperBuildSource).toContain("native', 'audio-tap-helper', 'Info.plist");
  });
});
