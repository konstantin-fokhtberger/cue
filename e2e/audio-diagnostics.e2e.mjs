import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

function audioFixtureScript({ captureMode, macosDefaults, microphoneMode, workletFailures }) {
  const state = {
    macosDefaultInputId: macosDefaults.inputId,
    macosDefaultOutputId: macosDefaults.outputId,
    microphoneMode,
    openedInputIds: [],
    microphoneOpenCount: 0,
    stoppedTrackCount: 0,
    trackStopCallCount: 0,
    createdContextCount: 0,
    closedContextCount: 0,
    contextCloseCallCount: 0,
    createdWorkletCount: 0,
    disconnectedWorkletCount: 0,
    workletDisconnectCallCount: 0,
    activeWorkletCount: 0,
    deliveredPcmCount: 0,
    postStopPcmCount: 0,
    pendingMediaRequestCount: 0,
    outputSinkIds: [],
    outputPlayCount: 0,
    failWorkletInitialization: workletFailures === 'until-released',
    workletFailuresRemaining: workletFailures,
  };
  Object.defineProperty(window, '__cueE2eAudio', { value: state });
  const pendingMediaResolvers = [];
  state.resolvePendingMediaRequests = () => {
    for (const resolve of pendingMediaResolvers.splice(0)) resolve();
  };
  state.allowWorkletInitialization = () => {
    state.failWorkletInitialization = false;
  };

  class FixtureTrack {
    constructor(kind, deviceId, label) {
      this.kind = kind;
      this.label = label;
      this.deviceId = deviceId;
      this.stopped = false;
    }

    getSettings() {
      return { deviceId: this.deviceId };
    }

    stop() {
      state.trackStopCallCount += 1;
      if (this.stopped) return;
      this.stopped = true;
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

    getVideoTracks() {
      return this.tracks.filter((track) => track.kind === 'video');
    }

    removeTrack(track) {
      this.tracks = this.tracks.filter((candidate) => candidate !== track);
    }
  }

  function node() {
    let disconnected = false;
    return {
      connect() {},
      disconnect() {
        if (disconnected) return;
        disconnected = true;
      },
    };
  }

  class FixtureAudioContext {
    constructor() {
      state.createdContextCount += 1;
      this.closed = false;
      this.audioWorklet = {
        addModule: async () => {
          if (state.failWorkletInitialization) {
            throw new Error('fixture worklet initialization failed');
          }
          if (state.workletFailuresRemaining > 0) {
            state.workletFailuresRemaining -= 1;
            throw new Error('fixture worklet initialization failed');
          }
        },
      };
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

    async close() {
      state.contextCloseCallCount += 1;
      if (this.closed) return;
      this.closed = true;
      state.closedContextCount += 1;
    }
  }

  class FixtureAudioWorkletNode {
    constructor() {
      state.createdWorkletCount += 1;
      state.activeWorkletCount += 1;
      this.disconnected = false;
      this.port = { onmessage: null };
      setTimeout(() => {
        if (!this.port.onmessage) return;
        if (this.disconnected || state.activeWorkletCount === 0) {
          state.postStopPcmCount += 1;
        }
        state.deliveredPcmCount += 1;
        this.port.onmessage({
          data: Int16Array.from([500, -500, 750, -750]).buffer,
        });
      }, 20);
    }

    connect() {}

    disconnect() {
      state.workletDisconnectCallCount += 1;
      if (this.disconnected) return;
      this.disconnected = true;
      state.disconnectedWorkletCount += 1;
      state.activeWorkletCount -= 1;
    }
  }

  let devices = [
    { kind: 'audioinput', deviceId: 'default', label: 'System default' },
    {
      kind: 'audioinput',
      deviceId: 'built-in-input',
      label: 'MacBook Air Microphone (fixture)',
    },
    {
      kind: 'audioinput',
      deviceId: 'sony-input',
      label: 'Sony Bluetooth Microphone (fixture)',
    },
    { kind: 'audioinput', deviceId: 'hyperx', label: 'HyperX SoloCast (fixture)' },
    { kind: 'audiooutput', deviceId: 'default', label: 'System default' },
    {
      kind: 'audiooutput',
      deviceId: 'built-in-output',
      label: 'MacBook Air Speakers (fixture)',
    },
    { kind: 'audiooutput', deviceId: 'sony', label: 'Sony Bluetooth (fixture)' },
  ];
  const deviceChangeListeners = new Set();
  state.removeOutputDevice = (deviceId) => {
    devices = devices.filter(
      (device) => device.kind !== 'audiooutput' || device.deviceId !== deviceId,
    );
    for (const listener of deviceChangeListeners) listener();
  };
  state.restoreOutputDevice = (deviceId, label) => {
    devices = devices.filter(
      (device) => device.kind !== 'audiooutput' || device.deviceId !== deviceId,
    );
    devices.push({ kind: 'audiooutput', deviceId, label });
    for (const listener of deviceChangeListeners) listener();
  };

  function resolveMediaRequest(createStream) {
    if (captureMode !== 'deferred') return Promise.resolve(createStream());
    state.pendingMediaRequestCount += 1;
    return new Promise((resolve) => {
      pendingMediaResolvers.push(() => {
        state.pendingMediaRequestCount -= 1;
        resolve(createStream());
      });
    });
  }

  const mediaDevices = {
    addEventListener(type, listener) {
      if (type === 'devicechange') deviceChangeListeners.add(listener);
    },
    async enumerateDevices() {
      return devices;
    },
    async getUserMedia(constraints) {
      const requestedId = constraints.audio.deviceId?.exact || 'default';
      state.openedInputIds.push(requestedId);
      state.microphoneOpenCount += 1;
      if (microphoneMode === 'permission-denied') {
        throw new DOMException('fixture permission denied', 'NotAllowedError');
      }
      const label =
        devices.find((device) => device.kind === 'audioinput' && device.deviceId === requestedId)
          ?.label || 'Unknown fixture input';
      return resolveMediaRequest(
        () => new FixtureStream([new FixtureTrack('audio', requestedId, label)]),
      );
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

function systemAudioHelperFixtureScript() {
  return `#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const logPath = process.env.CUE_E2E_AUDIO_HELPER_LOG;
const mode = process.env.CUE_E2E_AUDIO_HELPER_MODE || 'healthy';
const frame = Buffer.alloc(48 * 4);
for (let index = 0; index < 48; index += 1) frame.writeFloatLE(index % 2 ? 0.25 : -0.25, index * 4);
let timer;
let parentMonitor;
let started = false;
const stop = () => {
  if (!started) process.exit(0);
  started = false;
  clearInterval(timer);
  clearInterval(parentMonitor);
  appendFileSync(logPath, 'stop\\n');
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
let control = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  control += chunk;
  const newline = control.indexOf('\\n');
  if (newline === -1) return;
  if (newline !== control.length - 1) process.exit(2);
  let message;
  try {
    message = JSON.parse(control.slice(0, newline));
  } catch {
    process.exit(2);
  }
  if (
    message.command === 'inventory' &&
    message.protocolVersion === 1 &&
    Number.isSafeInteger(message.generation) &&
    message.generation > 0 &&
    Object.keys(message).sort().join(',') === 'command,generation,protocolVersion'
  ) {
    process.stderr.write(JSON.stringify({
      event: 'inventory',
      generation: message.generation,
      sources: [
        {
          identity: {
            pid: 1000,
            bundleIdentifier: 'com.google.Chrome',
            displayName: 'Google Chrome',
          },
          status: 'available',
          failure: null,
          audioProcessObjectIds: [101, 102],
          outputDeviceUids: ['sony'],
          requiresBrowserWideAcknowledgement: true,
        },
        {
          identity: {
            pid: 2000,
            bundleIdentifier: 'us.zoom.xos',
            displayName: 'zoom.us',
          },
          status: 'available',
          failure: null,
          audioProcessObjectIds: [201],
          outputDeviceUids: ['sony'],
          requiresBrowserWideAcknowledgement: false,
        },
      ],
    }) + '\\n');
    process.exit(0);
  }
  const captureScopes = new Map([
    ['us.zoom.xos', {
      browserWideAcknowledged: false,
      displayName: 'zoom.us',
      responsiblePid: 2000,
    }],
    ['com.google.Chrome', {
      browserWideAcknowledged: true,
      displayName: 'Google Chrome',
      responsiblePid: 1000,
    }],
  ]);
  const expectedScope = captureScopes.get(message.scope?.bundleIdentifier);
  if (
    message.command !== 'capture' ||
    message.protocolVersion !== 1 ||
    message.scope?.kind !== 'application' ||
    !Number.isSafeInteger(message.scope.inventoryGeneration) ||
    message.scope.inventoryGeneration <= 0 ||
    expectedScope === undefined ||
    message.scope.responsiblePid !== expectedScope.responsiblePid ||
    message.scope.browserWideAcknowledged !== expectedScope.browserWideAcknowledged ||
    Object.keys(message).sort().join(',') !== 'command,protocolVersion,scope' ||
    Object.keys(message.scope).sort().join(',') !==
      'browserWideAcknowledged,bundleIdentifier,inventoryGeneration,kind,responsiblePid'
  ) process.exit(2);
  started = true;
  appendFileSync(
    logPath,
    \`start:\${process.ppid}:\${process.pid}:\${message.scope.bundleIdentifier}\\n\`,
  );
  if (mode === 'initialization-failed') {
    process.stderr.write('{"event":"error","message":"fixture failure"}\\n');
    process.exit(1);
  }
  process.stderr.write(JSON.stringify({
    channels: 1,
    event: 'started',
    format: 'float32le',
    sampleRate: 48000,
    scope: {
      kind: 'application',
      verified: true,
      inventoryGeneration: message.scope.inventoryGeneration,
      responsiblePid: expectedScope.responsiblePid,
      bundleIdentifier: message.scope.bundleIdentifier,
      displayName: expectedScope.displayName,
    },
  }) + '\\n');
  timer = setInterval(() => process.stdout.write(frame), 5);
  const ownerPID = process.ppid;
  parentMonitor = setInterval(() => {
    try {
      const actualParentPID = Number(
        execFileSync('/bin/ps', ['-o', 'ppid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim(),
      );
      if (actualParentPID !== ownerPID) stop();
    } catch {
      stop();
    }
  }, 25);
});
process.stdin.on('end', stop);
process.stdin.on('close', stop);
process.stdin.resume();
`;
}

async function launchCue(microphoneMode, fixtureOptions = {}) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'cue-e2e-'));
  const userDataDir = path.join(temporaryRoot, 'user-data');
  await mkdir(userDataDir);
  await writeFile(
    path.join(userDataDir, 'cue-data.json'),
    JSON.stringify({
      onboarded: true,
      provider: 'openai',
      audioDevices: fixtureOptions.audioDevices || { inputId: 'default', outputId: 'default' },
      apiKeys: { openai: '', anthropic: '', gemini: '', nvidia: '' },
    }),
  );
  const helperPath = path.join(temporaryRoot, 'fake-system-audio-helper.mjs');
  const helperLogPath = path.join(temporaryRoot, 'system-audio-helper.log');
  await writeFile(helperPath, systemAudioHelperFixtureScript());
  await chmod(helperPath, 0o755);
  await writeFile(helperLogPath, '');

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
        CUE_E2E_AUDIO_HELPER_PATH: helperPath,
        CUE_E2E_AUDIO_HELPER_LOG: helperLogPath,
        CUE_E2E_AUDIO_HELPER_MODE: fixtureOptions.systemMode || 'healthy',
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
  await page.addInitScript(audioFixtureScript, {
    captureMode: fixtureOptions.captureMode || 'immediate',
    macosDefaults: fixtureOptions.macosDefaults || {
      inputId: 'default',
      outputId: 'default',
    },
    microphoneMode,
    workletFailures: fixtureOptions.workletFailures || 0,
  });
  await page.reload();
  await page.locator('#more-btn').click();
  await page.locator('#audio-input').waitFor();
  if (fixtureOptions.selectApplication !== false) {
    const application = page.locator('#capture-application');
    await application.locator('option', { hasText: 'zoom.us' }).waitFor({ state: 'attached' });
    await application.selectOption({ label: 'zoom.us' });
    await page
      .locator('#capture-application-status')
      .filter({ hasText: 'Requested: zoom.us.' })
      .waitFor();
  }

  return {
    electronApp,
    networkRequests,
    page,
    temporaryRoot,
    async helperEvents() {
      const content = await readFile(helperLogPath, 'utf8');
      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((event) => event.split(':', 1)[0]);
    },
    async helperRawEvents() {
      const content = await readFile(helperLogPath, 'utf8');
      return content.trim().split('\n').filter(Boolean);
    },
    async close() {
      try {
        await electronApp.close();
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
    async cleanup() {
      await rm(temporaryRoot, { recursive: true, force: true });
    },
  };
}

async function waitForHelperEventCount(fixture, expectedCount, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  let observedEvents = await fixture.helperEvents();
  while (observedEvents.length !== expectedCount) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for ${expectedCount} native-helper lifecycle events; observed ${JSON.stringify(observedEvents)}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    observedEvents = await fixture.helperEvents();
  }
}

async function waitForProcessExit(processID, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(processID, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for native helper process ${processID} to exit.`);
}

const deterministicAudioRoutes = [
  {
    id: 'built-in-aligned',
    defaultInputId: 'built-in-input',
    defaultOutputId: 'built-in-output',
    inputId: 'built-in-input',
    inputLabel: 'MacBook Air Microphone (fixture)',
    outputId: 'built-in-output',
    outputLabel: 'MacBook Air Speakers (fixture)',
  },
  {
    id: 'bluetooth-aligned',
    defaultInputId: 'sony-input',
    defaultOutputId: 'sony',
    inputId: 'sony-input',
    inputLabel: 'Sony Bluetooth Microphone (fixture)',
    outputId: 'sony',
    outputLabel: 'Sony Bluetooth (fixture)',
  },
  {
    id: 'usb-bluetooth-aligned',
    defaultInputId: 'hyperx',
    defaultOutputId: 'sony',
    inputId: 'hyperx',
    inputLabel: 'HyperX SoloCast (fixture)',
    outputId: 'sony',
    outputLabel: 'Sony Bluetooth (fixture)',
  },
  {
    id: 'explicit-app-override',
    defaultInputId: 'sony-input',
    defaultOutputId: 'sony',
    inputId: 'hyperx',
    inputLabel: 'HyperX SoloCast (fixture)',
    outputId: 'sony',
    outputLabel: 'Sony Bluetooth (fixture)',
  },
];

async function runDeterministicApplicationRouteMatrix(application) {
  for (const route of deterministicAudioRoutes) {
    const fixture = await launchCue('healthy', {
      audioDevices: { inputId: route.inputId, outputId: route.outputId },
      macosDefaults: { inputId: route.defaultInputId, outputId: route.defaultOutputId },
      selectApplication: false,
    });
    try {
      const applicationSelector = fixture.page.locator('#capture-application');
      await applicationSelector
        .locator('option', { hasText: application.optionLabel })
        .waitFor({ state: 'attached' });
      await applicationSelector.selectOption({ label: application.optionLabel });
      if (application.browserWide) {
        await fixture.page.locator('#capture-browser-ack').check();
      }
      await fixture.page
        .locator('#capture-application-status')
        .filter({ hasText: `Requested: ${application.displayName}.` })
        .waitFor();
      await fixture.page
        .locator('#audio-output-effective')
        .filter({ hasText: `Effective: ${route.outputLabel}` })
        .waitFor();

      await fixture.page.locator('#s-close').click();
      await fixture.page.locator('#stop-btn').click();
      await fixture.page.waitForFunction(() => window.__cueE2eAudio.microphoneOpenCount === 1);
      await waitForHelperEventCount(fixture, 1);
      await fixture.page.waitForFunction(
        ({ applicationText, inputText }) =>
          document
            .querySelector('#capture-application-status')
            ?.textContent.includes(applicationText) &&
          document.querySelector('#audio-input-effective')?.textContent.includes(inputText),
        {
          applicationText: `Effective: verified ${application.displayName}.`,
          inputText: `Effective: ${route.inputLabel}`,
        },
      );

      await fixture.page.locator('#stop-btn').click();
      await fixture.page.waitForFunction(
        () =>
          !document.querySelector('#stop-btn')?.classList.contains('active') &&
          window.__cueE2eAudio.stoppedTrackCount === 1 &&
          window.__cueE2eAudio.activeWorkletCount === 0,
      );
      await waitForHelperEventCount(fixture, 2);

      const state = await fixture.page.evaluate(() => window.__cueE2eAudio);
      assert.equal(state.macosDefaultInputId, route.defaultInputId, route.id);
      assert.equal(state.macosDefaultOutputId, route.defaultOutputId, route.id);
      assert.deepEqual(state.openedInputIds, [route.inputId], route.id);
      assert.equal(state.outputSinkIds.at(-1), route.outputId, route.id);
      assert.equal(state.createdContextCount, 1, route.id);
      assert.equal(state.closedContextCount, 1, route.id);
      assert.equal(state.createdWorkletCount, 1, route.id);
      assert.equal(state.disconnectedWorkletCount, 1, route.id);
      assert.equal(state.postStopPcmCount, 0, route.id);
      assert.deepEqual(
        (await fixture.helperRawEvents())
          .filter((event) => event.startsWith('start:'))
          .map((event) => event.split(':')[3]),
        [application.bundleIdentifier],
        route.id,
      );
      assert.deepEqual(fixture.networkRequests, [], route.id);
    } finally {
      await fixture.close();
    }
  }
}

test(
  'E2E-AUDIO-MATRIX-ZOOM-001 covers Zoom across deterministic cue route variants',
  { timeout: 30_000 },
  () =>
    runDeterministicApplicationRouteMatrix({
      browserWide: false,
      bundleIdentifier: 'us.zoom.xos',
      displayName: 'zoom.us',
      optionLabel: 'zoom.us',
    }),
);

test(
  'E2E-AUDIO-MATRIX-MEET-001 covers browser-wide Chrome/Meet across deterministic cue route variants',
  { timeout: 30_000 },
  () =>
    runDeterministicApplicationRouteMatrix({
      browserWide: true,
      bundleIdentifier: 'com.google.Chrome',
      displayName: 'Google Chrome',
      optionLabel: 'Google Chrome - all audible tabs in this browser instance',
    }),
);

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

test('E2E-AUDIO-DEVICE-OUTPUT-LOSS-001 fails closed and restores the exact output', async () => {
  const fixture = await launchCue('healthy');
  try {
    await fixture.page.locator('#audio-output').selectOption('sony');
    await fixture.page
      .locator('#audio-output-effective')
      .filter({ hasText: 'Effective: Sony Bluetooth (fixture)' })
      .waitFor();
    const sinkSelectionsBeforeLoss = await fixture.page.evaluate(
      () => window.__cueE2eAudio.outputSinkIds.length,
    );

    await fixture.page.evaluate(() => window.__cueE2eAudio.removeOutputDevice('sony'));
    await fixture.page
      .locator('#audio-output-effective')
      .filter({ hasText: 'Selected output is unavailable' })
      .waitFor();
    assert.equal(
      await fixture.page.locator('#audio-output option:checked').textContent(),
      'Unavailable device',
    );

    await fixture.page.locator('#audio-test-output').click();
    await fixture.page
      .locator('#audio-output-diagnostic-status')
      .filter({ hasText: 'Output test failed: selected sink is unavailable.' })
      .waitFor();
    let state = await fixture.page.evaluate(() => window.__cueE2eAudio);
    assert.equal(state.outputSinkIds.length, sinkSelectionsBeforeLoss);
    assert.equal(state.outputPlayCount, 0);

    await fixture.page.evaluate(() =>
      window.__cueE2eAudio.restoreOutputDevice('sony', 'Sony Bluetooth (fixture)'),
    );
    await fixture.page
      .locator('#audio-output-effective')
      .filter({ hasText: 'Effective: Sony Bluetooth (fixture)' })
      .waitFor();
    assert.equal(
      await fixture.page.locator('#audio-output option:checked').textContent(),
      'Sony Bluetooth (fixture)',
    );
    assert.deepEqual(fixture.networkRequests, []);
  } finally {
    await fixture.close();
  }
});

test('E2E-AUDIO-DIAG-MANUAL-STOP-001 stops once without restarting the microphone', async () => {
  const fixture = await launchCue('healthy');
  try {
    await fixture.page.locator('#audio-input').selectOption('hyperx');
    const microphoneButton = fixture.page.locator('#audio-test-input');
    await microphoneButton.click();
    await fixture.page
      .locator('#audio-diagnostic-status')
      .filter({ hasText: 'Signal detected · input: HyperX SoloCast (fixture)' })
      .waitFor();

    await microphoneButton.click();
    await fixture.page
      .locator('#audio-diagnostic-status')
      .filter({ hasText: 'Stopped · input: HyperX SoloCast (fixture)' })
      .waitFor();
    assert.equal(await microphoneButton.textContent(), 'Test selected microphone');

    const state = await fixture.page.evaluate(() => window.__cueE2eAudio);
    assert.deepEqual(state.openedInputIds, ['hyperx']);
    assert.equal(state.microphoneOpenCount, 1);
    assert.equal(state.stoppedTrackCount, 1);
    assert.equal(state.activeWorkletCount, 0);
    assert.equal(state.postStopPcmCount, 0);
    assert.deepEqual(fixture.networkRequests, []);
  } finally {
    await fixture.close();
  }
});

test('E2E-AUDIO-DIAG-SLEEP-WAKE-001 disposes diagnostics and revalidates routes', async () => {
  const fixture = await launchCue('healthy');
  try {
    await fixture.page.locator('#audio-input').selectOption('hyperx');
    await fixture.page.locator('#audio-output').selectOption('sony');
    const microphoneButton = fixture.page.locator('#audio-test-input');
    await microphoneButton.click();
    await fixture.page
      .locator('#audio-diagnostic-status')
      .filter({ hasText: 'Signal detected · input: HyperX SoloCast (fixture)' })
      .waitFor();

    await fixture.electronApp.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'));
    await fixture.page
      .locator('#cue-status')
      .filter({ hasText: 'Mac is sleeping. Audio capture stopped.' })
      .waitFor();
    await fixture.page
      .locator('#audio-diagnostic-status')
      .filter({ hasText: 'Stopped · input: HyperX SoloCast (fixture)' })
      .waitFor();
    let state = await fixture.page.evaluate(() => window.__cueE2eAudio);
    assert.equal(state.microphoneOpenCount, 1);
    assert.equal(state.stoppedTrackCount, 1);
    assert.equal(state.activeWorkletCount, 0);

    await fixture.electronApp.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
    await fixture.page
      .locator('#cue-status')
      .filter({
        hasText: 'Mac woke from sleep. Audio routes were refreshed; start capture explicitly.',
      })
      .waitFor();
    await fixture.page
      .locator('#audio-output-effective')
      .filter({ hasText: 'Effective: Sony Bluetooth (fixture)' })
      .waitFor();
    assert.equal(await microphoneButton.textContent(), 'Test selected microphone');
    state = await fixture.page.evaluate(() => window.__cueE2eAudio);
    assert.equal(state.microphoneOpenCount, 1);

    await microphoneButton.click();
    await fixture.page
      .locator('#audio-diagnostic-status')
      .filter({ hasText: 'Signal detected · input: HyperX SoloCast (fixture)' })
      .waitFor();
    await microphoneButton.click();
    state = await fixture.page.evaluate(() => window.__cueE2eAudio);
    assert.equal(state.microphoneOpenCount, 2);
    assert.equal(state.stoppedTrackCount, 2);
    assert.equal(state.activeWorkletCount, 0);
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

test('E2E-CAPTURE-SCOPE-001 / E2E-BROWSER-SCOPE-DISCLOSURE-001 requires explicit browser-wide acknowledgement', async () => {
  const fixture = await launchCue('healthy');
  try {
    const application = fixture.page.locator('#capture-application');
    await application
      .locator('option', {
        hasText: 'Google Chrome - all audible tabs in this browser instance',
      })
      .waitFor({ state: 'attached' });
    await application.selectOption({
      label: 'Google Chrome - all audible tabs in this browser instance',
    });
    await fixture.page
      .locator('#capture-application-status')
      .filter({ hasText: 'Confirm browser-wide capture' })
      .waitFor();
    await assert.doesNotReject(() =>
      fixture.page.locator('#capture-browser-ack-wrap:not(.hidden)').waitFor(),
    );

    await fixture.page.locator('#capture-browser-ack').check();
    await fixture.page
      .locator('#capture-application-status')
      .filter({
        hasText: 'Requested: Google Chrome. Effective: not verified until native capture starts.',
      })
      .waitFor();
    assert.deepEqual(fixture.networkRequests, []);
  } finally {
    await fixture.close();
  }
});

test('E2E-CAPTURE-SCOPE-REQUIRED-001 fails closed before microphone or helper start', async () => {
  const fixture = await launchCue('healthy', { selectApplication: false });
  try {
    await fixture.page.locator('#s-close').click();
    await fixture.page.locator('#stop-btn').click();
    await fixture.page
      .locator('#capture-health')
      .filter({
        hasText:
          'System audio unavailable: application-selection-required. Microphone remains active; remote participants are not being captured.',
      })
      .waitFor();

    assert.equal(
      await fixture.page
        .locator('#stop-btn')
        .evaluate((button) => button.classList.contains('active')),
      false,
    );
    const state = await fixture.page.evaluate(() => window.__cueE2eAudio);
    assert.equal(state.microphoneOpenCount, 0);
    assert.deepEqual(await fixture.helperEvents(), []);
    assert.deepEqual(fixture.networkRequests, []);
  } finally {
    await fixture.close();
  }
});

test(
  'E2E-CAPTURE-UI-001 starts one native system helper and releases both channels',
  { timeout: 10_000 },
  async () => {
    const fixture = await launchCue('healthy');
    try {
      await fixture.page.locator('#s-close').click();
      await fixture.page.locator('#stop-btn').click();
      await fixture.page.waitForFunction(
        () =>
          window.__cueE2eAudio.microphoneOpenCount === 1 &&
          window.__cueE2eAudio.createdContextCount === 1,
      );
      await waitForHelperEventCount(fixture, 1);
      await fixture.page.waitForFunction(() =>
        document
          .querySelector('#capture-application-status')
          ?.textContent.includes('Effective: verified zoom.us.'),
      );

      await fixture.page.locator('#stop-btn').click();
      await fixture.page.waitForFunction(
        () =>
          window.__cueE2eAudio.closedContextCount === 1 &&
          window.__cueE2eAudio.stoppedTrackCount === 1,
      );
      await fixture.page.waitForTimeout(50);

      const state = await fixture.page.evaluate(() => window.__cueE2eAudio);
      assert.equal(state.createdWorkletCount, 1);
      assert.equal(state.disconnectedWorkletCount, 1);
      assert.equal(state.workletDisconnectCallCount, 1);
      assert.equal(state.contextCloseCallCount, 1);
      assert.equal(state.trackStopCallCount, 1);
      assert.equal(state.postStopPcmCount, 0);
      assert.deepEqual(await fixture.helperEvents(), ['start', 'stop']);
      assert.deepEqual(fixture.networkRequests, []);
    } finally {
      await fixture.close();
    }
  },
);

test(
  'E2E-SESSION-SLEEP-WAKE-001 stops capture and requires an explicit restart',
  { timeout: 30_000 },
  async () => {
    const fixture = await launchCue('healthy');
    try {
      await fixture.page.locator('#s-close').click();
      await fixture.page.locator('#stop-btn').click();
      await fixture.page.waitForFunction(() => window.__cueE2eAudio.microphoneOpenCount === 1);
      await waitForHelperEventCount(fixture, 1);

      await fixture.electronApp.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'));
      await fixture.page
        .locator('#cue-status')
        .filter({ hasText: 'Mac is sleeping. Audio capture stopped.' })
        .waitFor();
      await fixture.page.waitForFunction(
        () =>
          window.__cueE2eAudio.closedContextCount === 1 &&
          window.__cueE2eAudio.stoppedTrackCount === 1,
      );
      await waitForHelperEventCount(fixture, 2);
      assert.equal(
        await fixture.page
          .locator('#stop-btn')
          .evaluate((button) => button.classList.contains('active')),
        false,
      );

      await fixture.electronApp.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
      await fixture.page.waitForFunction(
        () =>
          document.querySelector('#cue-status')?.textContent ===
          'Mac woke from sleep. Audio routes were refreshed; start capture explicitly.',
      );
      await fixture.page.waitForFunction(() =>
        document
          .querySelector('#capture-application-status')
          ?.textContent.includes('Select one application.'),
      );
      let state = await fixture.page.evaluate(() => window.__cueE2eAudio);
      assert.equal(state.microphoneOpenCount, 1);
      assert.deepEqual(await fixture.helperEvents(), ['start', 'stop']);

      await fixture.page.locator('#more-btn').click();
      await fixture.page.waitForFunction(
        () =>
          !document
            .querySelector('#capture-application-status')
            ?.textContent.includes('Detecting audible applications'),
      );
      const application = fixture.page.locator('#capture-application');
      await application.locator('option', { hasText: 'zoom.us' }).waitFor({ state: 'attached' });
      await application.selectOption({ label: 'zoom.us' });
      await fixture.page.locator('#s-close').click();
      await fixture.page.locator('#stop-btn').click();
      await fixture.page.waitForFunction(() => window.__cueE2eAudio.microphoneOpenCount === 2);
      await waitForHelperEventCount(fixture, 3);
      await fixture.page.locator('#stop-btn').click();
      await waitForHelperEventCount(fixture, 4);

      state = await fixture.page.evaluate(() => window.__cueE2eAudio);
      assert.equal(state.stoppedTrackCount, 2);
      assert.deepEqual(await fixture.helperEvents(), ['start', 'stop', 'start', 'stop']);
      assert.deepEqual(fixture.networkRequests, []);
    } finally {
      await fixture.close();
    }
  },
);

test(
  'E2E-HELPER-PARENT-DEATH-001 exits the helper after abrupt Electron exit',
  { timeout: 10_000 },
  async () => {
    const fixture = await launchCue('healthy');
    let parentKilled = false;
    try {
      await fixture.page.locator('#s-close').click();
      await fixture.page.locator('#stop-btn').click();
      await waitForHelperEventCount(fixture, 1);

      const electronProcess = fixture.electronApp.process();
      const [event, helperParentPID, helperProcessID] = (await fixture.helperRawEvents())[0].split(
        ':',
      );
      assert.equal(event, 'start');
      assert.equal(Number(helperParentPID), electronProcess.pid);
      const electronExit = new Promise((resolve) => electronProcess.once('exit', resolve));
      assert.equal(electronProcess.kill('SIGKILL'), true);
      parentKilled = true;
      await electronExit;
      await waitForProcessExit(Number(helperProcessID));

      assert.deepEqual(
        (await fixture.helperEvents()).filter((helperEvent) => helperEvent !== 'stop'),
        ['start'],
      );
      assert.deepEqual(fixture.networkRequests, []);
    } finally {
      if (parentKilled) {
        await fixture.cleanup();
      } else {
        await fixture.close();
      }
    }
  },
);

test(
  'E2E-SYSTEM-DEGRADED-001 / E2E-SYSTEM-FAIL-SINGLE-001 reports one system failure while microphone remains active',
  { timeout: 10_000 },
  async () => {
    const fixture = await launchCue('healthy', { systemMode: 'initialization-failed' });
    try {
      await fixture.page.locator('#s-close').click();
      await fixture.page.locator('#stop-btn').click();
      await fixture.page
        .locator('#capture-health')
        .filter({
          hasText:
            'System audio unavailable: helper-error. Microphone remains active; remote participants are not being captured.',
        })
        .waitFor({ timeout: 2_000 });
      await fixture.page.waitForFunction(
        () =>
          window.__cueE2eAudio.microphoneOpenCount === 1 &&
          window.__cueE2eAudio.activeWorkletCount === 1,
        undefined,
        { timeout: 2_000 },
      );

      const state = await fixture.page.evaluate(() => window.__cueE2eAudio);
      assert.equal(state.microphoneOpenCount, 1);
      assert.equal(state.activeWorkletCount, 1);
      assert.deepEqual(await fixture.helperEvents(), ['start']);
      await assert.doesNotReject(() =>
        fixture.page.locator('#live-dot.degraded').waitFor({ timeout: 2_000 }),
      );

      await fixture.page.locator('#stop-btn').click();
      await fixture.page.locator('#capture-health').waitFor({ state: 'hidden', timeout: 2_000 });
      await fixture.page.waitForFunction(
        () =>
          window.__cueE2eAudio.activeWorkletCount === 0 &&
          window.__cueE2eAudio.postStopPcmCount === 0,
        undefined,
        { timeout: 2_000 },
      );
      assert.deepEqual(fixture.networkRequests, []);
    } finally {
      await fixture.close();
    }
  },
);

test(
  'E2E-CAPTURE-STOP-RACE-001 disposes microphone and system streams resolved after Stop',
  { timeout: 10_000 },
  async () => {
    const fixture = await launchCue('healthy', { captureMode: 'deferred' });
    try {
      await fixture.page.locator('#s-close').click();
      await fixture.page.locator('#stop-btn').click();
      await fixture.page.waitForFunction(
        () =>
          document.querySelector('#stop-btn')?.classList.contains('active') &&
          window.__cueE2eAudio.pendingMediaRequestCount === 1,
      );

      await fixture.page.locator('#stop-btn').click();
      await fixture.page.waitForFunction(
        () => !document.querySelector('#stop-btn')?.classList.contains('active'),
      );
      await fixture.page.evaluate(() => window.__cueE2eAudio.resolvePendingMediaRequests());
      await fixture.page.waitForFunction(
        () =>
          window.__cueE2eAudio.pendingMediaRequestCount === 0 &&
          window.__cueE2eAudio.createdContextCount === 1 &&
          window.__cueE2eAudio.closedContextCount === 1 &&
          window.__cueE2eAudio.stoppedTrackCount === 1,
      );
      await fixture.page.waitForTimeout(50);

      const state = await fixture.page.evaluate(() => window.__cueE2eAudio);
      assert.equal(state.createdWorkletCount, 1);
      assert.equal(state.disconnectedWorkletCount, 1);
      assert.equal(state.workletDisconnectCallCount, 1);
      assert.equal(state.contextCloseCallCount, 1);
      assert.equal(state.trackStopCallCount, 1);
      assert.equal(state.activeWorkletCount, 0);
      assert.equal(state.deliveredPcmCount, 0);
      assert.equal(state.postStopPcmCount, 0);
      assert.deepEqual(fixture.networkRequests, []);
    } finally {
      await fixture.close();
    }
  },
);

test(
  'E2E-CAPTURE-RECOVERY-001 retries cleanly after microphone worklet initialization fails',
  { timeout: 10_000 },
  async () => {
    const fixture = await launchCue('healthy', {
      captureMode: 'deferred',
      workletFailures: 'until-released',
    });
    try {
      await fixture.page.locator('#s-close').click();
      await fixture.page.locator('#stop-btn').click();
      await fixture.page.waitForFunction(() => window.__cueE2eAudio.pendingMediaRequestCount === 1);
      await fixture.page.waitForFunction(
        () => document.documentElement.dataset.systemCaptureStatus === 'active',
      );
      await fixture.page.evaluate(() => window.__cueE2eAudio.resolvePendingMediaRequests());
      await fixture.page.waitForFunction(
        () =>
          window.__cueE2eAudio.createdContextCount === 1 &&
          window.__cueE2eAudio.closedContextCount === 1 &&
          window.__cueE2eAudio.pendingMediaRequestCount === 0,
      );
      await fixture.page.locator('#stop-btn').click();
      await fixture.page.waitForFunction(
        () => !document.querySelector('#stop-btn')?.classList.contains('active'),
      );
      await fixture.page.evaluate(() => window.__cueE2eAudio.allowWorkletInitialization());

      await fixture.page.locator('#stop-btn').click();
      await fixture.page.waitForFunction(() => window.__cueE2eAudio.pendingMediaRequestCount === 1);
      await fixture.page.waitForFunction(
        () => document.documentElement.dataset.systemCaptureStatus === 'active',
      );
      await fixture.page.evaluate(() => window.__cueE2eAudio.resolvePendingMediaRequests());
      await fixture.page.waitForFunction(
        () =>
          window.__cueE2eAudio.createdContextCount === 2 &&
          window.__cueE2eAudio.createdWorkletCount === 1 &&
          window.__cueE2eAudio.activeWorkletCount === 1,
      );
      await fixture.page.locator('#stop-btn').click();
      await fixture.page.waitForFunction(
        () =>
          window.__cueE2eAudio.closedContextCount === 2 &&
          window.__cueE2eAudio.stoppedTrackCount === 2 &&
          window.__cueE2eAudio.activeWorkletCount === 0,
      );

      const state = await fixture.page.evaluate(() => window.__cueE2eAudio);
      assert.equal(state.microphoneOpenCount, 2);
      assert.equal(state.disconnectedWorkletCount, 1);
      assert.equal(state.workletDisconnectCallCount, 1);
      assert.equal(state.contextCloseCallCount, 2);
      assert.equal(state.trackStopCallCount, 2);
      assert.equal(state.postStopPcmCount, 0);
      await waitForHelperEventCount(fixture, 4);
      assert.deepEqual(await fixture.helperEvents(), ['start', 'stop', 'start', 'stop']);
      assert.deepEqual(fixture.networkRequests, []);
    } finally {
      await fixture.close();
    }
  },
);

test(
  'STRESS-CAPTURE-100-001 completes one hundred leak-free renderer Start and Stop cycles',
  { timeout: 30_000 },
  async () => {
    const fixture = await launchCue('healthy');
    try {
      await fixture.page.locator('#s-close').click();
      await fixture.page.evaluate(async (cycles) => {
        const button = document.querySelector('#stop-btn');
        const waitUntil = async (predicate) => {
          const deadline = performance.now() + 2_000;
          while (!predicate()) {
            if (performance.now() >= deadline) throw new Error('fixture lifecycle timeout');
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
        };

        for (let cycle = 1; cycle <= cycles; cycle += 1) {
          button.click();
          await waitUntil(
            () =>
              button.classList.contains('active') &&
              window.__cueE2eAudio.createdContextCount === cycle &&
              window.__cueE2eAudio.activeWorkletCount === 1 &&
              document.documentElement.dataset.systemCaptureStatus === 'active',
          );
          button.click();
          await waitUntil(
            () =>
              !button.classList.contains('active') &&
              window.__cueE2eAudio.closedContextCount === cycle &&
              window.__cueE2eAudio.stoppedTrackCount === cycle &&
              window.__cueE2eAudio.activeWorkletCount === 0 &&
              document.documentElement.dataset.systemCaptureStatus === 'idle',
          );
        }
      }, 100);
      const deliveredAtStop = await fixture.page.evaluate(
        () => window.__cueE2eAudio.deliveredPcmCount,
      );
      await fixture.page.waitForTimeout(50);

      const state = await fixture.page.evaluate(() => window.__cueE2eAudio);
      assert.equal(state.microphoneOpenCount, 100);
      assert.equal(state.createdContextCount, 100);
      assert.equal(state.closedContextCount, 100);
      assert.equal(state.contextCloseCallCount, 100);
      assert.equal(state.createdWorkletCount, 100);
      assert.equal(state.disconnectedWorkletCount, 100);
      assert.equal(state.workletDisconnectCallCount, 100);
      assert.equal(state.activeWorkletCount, 0);
      assert.equal(state.stoppedTrackCount, 100);
      assert.equal(state.trackStopCallCount, 100);
      assert.equal(state.deliveredPcmCount, deliveredAtStop);
      assert.equal(state.postStopPcmCount, 0);
      await waitForHelperEventCount(fixture, 200);
      assert.equal((await fixture.helperEvents()).filter((event) => event === 'start').length, 100);
      assert.equal((await fixture.helperEvents()).filter((event) => event === 'stop').length, 100);
      assert.deepEqual(fixture.networkRequests, []);
    } finally {
      await fixture.close();
    }
  },
);
