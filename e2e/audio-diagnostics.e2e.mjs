import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { _electron as electron } from 'playwright';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagedExecutable = path.join(
  repositoryRoot,
  'dist',
  'mac-arm64',
  'cue.app',
  'Contents',
  'MacOS',
  'cue',
);
const sourceExecutable = path.join(
  repositoryRoot,
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'MacOS',
  'Electron',
);

function audioFixtureScript({ microphoneMode }) {
  const state = {
    microphoneMode,
    openedInputIds: [],
    stoppedTrackCount: 0,
    outputSinkIds: [],
    outputPlayCount: 0,
  };
  Object.defineProperty(window, '__cueE2eAudio', { value: state });

  class FixtureTrack {
    constructor(deviceId, label) {
      this.kind = 'audio';
      this.label = label;
      this.deviceId = deviceId;
    }

    getSettings() {
      return { deviceId: this.deviceId };
    }

    stop() {
      state.stoppedTrackCount += 1;
    }
  }

  class FixtureStream {
    constructor(tracks) {
      this.tracks = tracks;
    }

    getTracks() {
      return this.tracks;
    }

    getAudioTracks() {
      return this.tracks.filter((track) => track.kind === 'audio');
    }

    removeTrack(track) {
      this.tracks = this.tracks.filter((candidate) => candidate !== track);
    }
  }

  const node = () => ({
    connect() {},
    disconnect() {},
  });

  class FixtureAudioContext {
    constructor() {
      this.audioWorklet = { addModule: async () => {} };
      this.destination = {};
    }

    createMediaStreamSource() {
      return node();
    }

    createGain() {
      return { ...node(), gain: { value: 1 } };
    }

    createOscillator() {
      return {
        ...node(),
        frequency: { value: 0 },
        start() {},
        stop() {},
      };
    }

    createMediaStreamDestination() {
      return { stream: new FixtureStream([]) };
    }

    async close() {}
  }

  class FixtureAudioWorkletNode {
    constructor() {
      this.port = { onmessage: null };
      setTimeout(() => {
        this.port.onmessage?.({
          data: Int16Array.from([500, -500, 750, -750]).buffer,
        });
      }, 20);
    }

    connect() {}

    disconnect() {}
  }

  const devices = [
    { kind: 'audioinput', deviceId: 'default', label: 'System default' },
    { kind: 'audioinput', deviceId: 'hyperx', label: 'HyperX SoloCast (fixture)' },
    { kind: 'audiooutput', deviceId: 'default', label: 'System default' },
    { kind: 'audiooutput', deviceId: 'sony', label: 'Sony Bluetooth (fixture)' },
  ];
  const mediaDevices = {
    addEventListener() {},
    async enumerateDevices() {
      return devices;
    },
    async getUserMedia(constraints) {
      const requestedId = constraints.audio.deviceId?.exact || 'default';
      state.openedInputIds.push(requestedId);
      if (microphoneMode === 'permission-denied') {
        throw new DOMException('fixture permission denied', 'NotAllowedError');
      }
      const label =
        devices.find((device) => device.kind === 'audioinput' && device.deviceId === requestedId)
          ?.label || 'Unknown fixture input';
      return new FixtureStream([new FixtureTrack(requestedId, label)]);
    },
  };

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: mediaDevices,
  });
  Object.defineProperty(window, 'MediaStream', { configurable: true, value: FixtureStream });
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    value: FixtureAudioContext,
  });
  Object.defineProperty(window, 'AudioWorkletNode', {
    configurable: true,
    value: FixtureAudioWorkletNode,
  });

  const sinks = new WeakMap();
  const sourceObjects = new WeakMap();
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get() {
      return sourceObjects.get(this) || null;
    },
    set(value) {
      sourceObjects.set(this, value);
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'sinkId', {
    configurable: true,
    get() {
      return sinks.get(this) || '';
    },
  });
  HTMLMediaElement.prototype.setSinkId = async function setSinkId(id) {
    sinks.set(this, id);
    state.outputSinkIds.push(id);
  };
  HTMLMediaElement.prototype.play = async function play() {
    state.outputPlayCount += 1;
  };
  HTMLMediaElement.prototype.pause = function pause() {};
}

async function launchCue(microphoneMode) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'cue-e2e-'));
  const userDataDir = path.join(temporaryRoot, 'user-data');
  await mkdir(userDataDir);
  await writeFile(
    path.join(userDataDir, 'cue-data.json'),
    JSON.stringify({
      onboarded: true,
      provider: 'openai',
      audioDevices: { inputId: 'default', outputId: 'default' },
      apiKeys: { openai: '', anthropic: '', gemini: '', nvidia: '' },
    }),
  );

  const packaged = process.env.CUE_E2E_PACKAGED === '1';
  let electronApp;
  try {
    electronApp = await electron.launch({
      executablePath: packaged ? packagedExecutable : sourceExecutable,
      args: packaged ? [] : [repositoryRoot],
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CUE_E2E: '1',
        CUE_E2E_USER_DATA_DIR: userDataDir,
        CUE_NO_PROTECT: '1',
      },
    });
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  const page = await electronApp.firstWindow();
  const networkRequests = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) networkRequests.push(request.url());
  });
  await page.addInitScript(audioFixtureScript, { microphoneMode });
  await page.reload();
  await page.locator('#more-btn').click();
  await page.locator('#audio-input').waitFor();

  return {
    electronApp,
    networkRequests,
    page,
    temporaryRoot,
    async close() {
      try {
        await electronApp.close();
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
  };
}

test('E2E-AUDIO-DIAG-001 uses exact local routes without provider traffic', async () => {
  const fixture = await launchCue('healthy');
  try {
    await fixture.page.locator('#audio-input').selectOption('hyperx');
    await fixture.page.locator('#audio-output').selectOption('sony');
    await fixture.page.locator('#audio-test-input').click();
    await assert.doesNotReject(() =>
      fixture.page
        .locator('#audio-diagnostic-status')
        .filter({ hasText: 'Signal detected · input: HyperX SoloCast (fixture)' })
        .waitFor(),
    );
    await fixture.page.locator('#audio-test-output').click();
    await fixture.page.waitForFunction(
      () =>
        !document
          .querySelector('#audio-output-diagnostic-status')
          ?.textContent.includes('Preparing selected cue output'),
    );
    assert.equal(
      await fixture.page.locator('#audio-output-diagnostic-status').textContent(),
      '440 Hz test tone sent to the selected cue output for 500 ms.',
    );

    const state = await fixture.page.evaluate(() => window.__cueE2eAudio);
    assert.deepEqual(state.openedInputIds, ['hyperx']);
    assert.equal(state.outputSinkIds.at(-1), 'sony');
    assert.equal(state.outputPlayCount, 1);
    assert.deepEqual(fixture.networkRequests, []);
  } finally {
    await fixture.close();
  }
});

test('E2E-AUDIO-DIAG-DENY-001 reports typed permission denial locally', async () => {
  const fixture = await launchCue('permission-denied');
  try {
    await fixture.page.locator('#audio-input').selectOption('hyperx');
    await fixture.page.locator('#audio-test-input').click();
    await assert.doesNotReject(() =>
      fixture.page
        .locator('#audio-diagnostic-status')
        .filter({ hasText: 'Microphone test failed: permission-denied' })
        .waitFor(),
    );

    assert.equal(
      await fixture.page.locator('#audio-test-input').textContent(),
      'Test selected microphone',
    );
    const state = await fixture.page.evaluate(() => window.__cueE2eAudio);
    assert.deepEqual(state.openedInputIds, ['hyperx']);
    assert.equal(state.outputPlayCount, 0);
    assert.deepEqual(fixture.networkRequests, []);
  } finally {
    await fixture.close();
  }
});
