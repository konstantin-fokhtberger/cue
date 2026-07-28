import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { swiftEnvironment } from './swift-helper-toolchain.mjs';

const execute = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = path.join(projectRoot, 'native', 'audio-tap-helper');
const coreRelativePath = path.join('Sources', 'CueAudioTapCore', 'HelperCore.swift');
const platformRelativePath = path.join(
  'Sources',
  'CueAudioTapPlatform',
  'CoreAudioTapPlatform.swift',
);
const environment = await swiftEnvironment();

const coreMutations = [
  {
    id: 'format-linear-pcm-required',
    from: 'guard isLinearPCM, isFloat, bitsPerChannel == 32, channelsPerFrame == 1,',
    to: 'guard true, isFloat, bitsPerChannel == 32, channelsPerFrame == 1,',
  },
  {
    id: 'format-float-required',
    from: 'guard isLinearPCM, isFloat, bitsPerChannel == 32, channelsPerFrame == 1,',
    to: 'guard isLinearPCM, true, bitsPerChannel == 32, channelsPerFrame == 1,',
  },
  {
    id: 'format-bits-required',
    from: 'guard isLinearPCM, isFloat, bitsPerChannel == 32, channelsPerFrame == 1,',
    to: 'guard isLinearPCM, isFloat, true, channelsPerFrame == 1,',
  },
  {
    id: 'format-mono-required',
    from: 'guard isLinearPCM, isFloat, bitsPerChannel == 32, channelsPerFrame == 1,',
    to: 'guard isLinearPCM, isFloat, bitsPerChannel == 32, true,',
  },
  {
    id: 'format-finite-rate-required',
    from: 'sampleRate.isFinite',
    to: 'true',
  },
  {
    id: 'format-positive-rate-required',
    from: 'sampleRate > 0',
    to: 'sampleRate >= 0',
  },
  {
    id: 'metrics-callback-increment',
    from: 'callbacks: snapshotValue.callbacks + 1,',
    to: 'callbacks: snapshotValue.callbacks + 0,',
  },
  {
    id: 'payload-nonzero-classification',
    from: 'if absolute > 0 {',
    to: 'if absolute >= 0 {',
  },
  {
    id: 'payload-alignment-required',
    from: 'guard data.count.isMultiple(of: MemoryLayout<Float>.stride) else {',
    to: 'guard true else {',
  },
  {
    id: 'payload-peak-maximum',
    from: 'if absolute > peak {',
    to: 'if absolute < peak {',
  },
  {
    id: 'payload-sample-count',
    from: 'sampleCount: UInt64(data.count / MemoryLayout<Float>.stride),',
    to: 'sampleCount: UInt64(data.count * MemoryLayout<Float>.stride),',
  },
  {
    id: 'metrics-sample-accumulation',
    from: 'samples: snapshotValue.samples + payload.sampleCount,',
    to: 'samples: snapshotValue.samples + 0,',
  },
  {
    id: 'metrics-nonzero-accumulation',
    from: 'nonzero: snapshotValue.nonzero + payload.nonzeroCount,',
    to: 'nonzero: snapshotValue.nonzero + 0,',
  },
  {
    id: 'metrics-peak-maximum',
    from: 'peak: max(snapshotValue.peak, payload.peak)',
    to: 'peak: min(snapshotValue.peak, payload.peak)',
  },
  {
    id: 'pending-boundary-inclusive',
    from: 'guard pendingBytes <= maximumPendingBytes - payload.data.count else {',
    to: 'guard pendingBytes < maximumPendingBytes - payload.data.count else {',
  },
  {
    id: 'pending-payload-subtraction',
    from: 'guard pendingBytes <= maximumPendingBytes - payload.data.count else {',
    to: 'guard pendingBytes <= maximumPendingBytes + payload.data.count else {',
  },
  {
    id: 'pending-reservation',
    from: 'pendingBytes += payload.data.count',
    to: 'pendingBytes -= payload.data.count',
  },
  {
    id: 'pending-release',
    from: 'pendingBytes -= payload.data.count',
    to: 'pendingBytes += payload.data.count',
  },
  {
    id: 'active-session-guard',
    from: 'guard tapID == nil, aggregateID == nil, !ioCreated, !ioStarted else {',
    to: 'guard tapID == nil, aggregateID == nil, !ioCreated, ioStarted else {',
  },
  {
    id: 'tap-resource-tracked',
    from: 'tapID = createdTapID',
    to: 'tapID = nil',
  },
  {
    id: 'tap-uid-required',
    from: 'guard !tapUID.isEmpty else {',
    to: 'guard true else {',
  },
  {
    id: 'output-device-required',
    from: 'guard !outputDeviceUIDs.isEmpty else {',
    to: 'guard true else {',
  },
  {
    id: 'aggregate-resource-tracked',
    from: 'aggregateID = createdAggregateID',
    to: 'aggregateID = nil',
  },
  {
    id: 'io-created-state-tracked',
    from: 'ioCreated = true',
    to: 'ioCreated = false',
  },
  {
    id: 'io-start-state-tracked',
    from: 'ioStarted = true',
    to: 'ioStarted = false',
  },
  {
    id: 'io-cleanup-guard',
    from: 'if ioStarted, let aggregateID {',
    to: 'if false, let aggregateID {',
  },
  {
    id: 'io-created-cleanup-guard',
    from: 'if ioCreated, let aggregateID {',
    to: 'if false, let aggregateID {',
  },
  {
    id: 'io-resource-cleanup',
    from: 'platform.destroyIO(aggregateID: aggregateID)',
    to: '_ = aggregateID',
  },
  {
    id: 'aggregate-cleanup',
    from: 'platform.destroyAggregate(aggregateID)',
    to: '_ = aggregateID',
  },
  {
    id: 'tap-cleanup',
    from: 'platform.destroyTap(tapID)',
    to: '_ = tapID',
  },
  {
    id: 'protocol-started-name',
    from: '"event": "started",',
    to: '"event": "active",',
  },
  {
    id: 'protocol-stopped-name',
    from: '"event": "stopped",',
    to: '"event": "idle",',
  },
  {
    id: 'protocol-error-name',
    from: 'object = ["event": "error", "message": message]',
    to: 'object = ["event": "failure", "message": message]',
  },
  {
    id: 'protocol-newline',
    from: 'data.append(0x0A)',
    to: 'data.append(0x20)',
  },
  {
    id: 'runner-waits-for-termination',
    from: 'termination.wait()',
    to: '_ = termination',
  },
  {
    id: 'runner-drains-before-stop-event',
    from: 'session.drain()',
    to: '_ = session',
  },
  {
    id: 'runner-success-code',
    from: 'return 0',
    to: 'return 2',
  },
  {
    id: 'runner-error-code',
    from: 'return 1',
    to: 'return 2',
  },
];
const platformMutations = [
  {
    id: 'platform-process-unknown-filter',
    from: 'for processID in processIDs where processID != 0 {',
    to: 'for processID in processIDs where true {',
  },
  {
    id: 'platform-running-output-required',
    from: 'running != 0',
    to: 'running == 0',
  },
  {
    id: 'platform-device-unknown-filter',
    from: 'discovered.filter { $0 != 0 }',
    to: 'discovered.filter { _ in true }',
  },
  {
    id: 'platform-default-fallback-required',
    from: 'if deviceIDs.isEmpty {',
    to: 'if false {',
  },
  {
    id: 'platform-default-unknown-filter',
    from: 'if defaultID != 0 {',
    to: 'if true {',
  },
  {
    id: 'platform-device-id-deduplication',
    from: 'for deviceID in deviceIDs where seenDeviceIDs.insert(deviceID).inserted {',
    to: 'for deviceID in deviceIDs where true {',
  },
  {
    id: 'platform-empty-uid-filter',
    from: 'if !uid.isEmpty, seenUIDs.insert(uid).inserted {',
    to: 'if true, seenUIDs.insert(uid).inserted {',
  },
  {
    id: 'platform-uid-deduplication',
    from: 'if !uid.isEmpty, seenUIDs.insert(uid).inserted {',
    to: 'if !uid.isEmpty, true {',
  },
  {
    id: 'platform-aggregate-main-device',
    from: 'mainSubdeviceUID: mainSubdeviceUID,',
    to: 'mainSubdeviceUID: outputDeviceUIDs.last!,',
  },
  {
    id: 'platform-drift-compensation',
    from: 'AggregateSubdevicePlan(uid: uid, driftCompensation: index != 0)',
    to: 'AggregateSubdevicePlan(uid: uid, driftCompensation: true)',
  },
  {
    id: 'platform-aggregate-privacy',
    from: 'isPrivate: true,',
    to: 'isPrivate: false,',
  },
  {
    id: 'platform-callback-enabled-after-create',
    from: 'setCallbackActive(true)\n    } catch {',
    to: 'setCallbackActive(false)\n    } catch {',
  },
  {
    id: 'platform-callback-disabled-after-create-failure',
    from: '} catch {\n      setCallbackActive(false)\n      throw error',
    to: '} catch {\n      setCallbackActive(true)\n      throw error',
  },
  {
    id: 'platform-callback-disabled-after-destroy',
    from: 'public func destroyIO(aggregateID: UInt32) {\n    setCallbackActive(false)',
    to: 'public func destroyIO(aggregateID: UInt32) {\n    setCallbackActive(true)',
  },
  {
    id: 'platform-inactive-callback-filter',
    from: 'guard ioCallbackActive, let buffers else {',
    to: 'guard true, let buffers else {',
  },
  {
    id: 'platform-null-buffer-filter',
    from: 'for data in buffers.compactMap({ $0 }) {',
    to: 'for data in buffers.compactMap({ _ in Data() }) {',
  },
  {
    id: 'platform-malformed-payload-filter',
    from: 'if let payload = AudioPayload(float32LE: data) {',
    to: 'if let payload = AudioPayload(float32LE: Data()) {',
  },
  {
    id: 'platform-create-tap-error-contract',
    from: 'try require(calls.createTap(), operation: "AudioHardwareCreateProcessTap")',
    to: 'try require(calls.createTap(), operation: "create tap")',
  },
  {
    id: 'platform-tap-uid-error-contract',
    from: 'operation: "AudioObjectGetPropertyData(tap UID)"',
    to: 'operation: "tap UID"',
  },
  {
    id: 'platform-tap-format-error-contract',
    from: 'operation: "AudioObjectGetPropertyData(tap format)"',
    to: 'operation: "tap format"',
  },
  {
    id: 'platform-aggregate-error-contract',
    from: 'operation: "AudioHardwareCreateAggregateDevice"',
    to: 'operation: "create aggregate"',
  },
  {
    id: 'platform-create-io-error-contract',
    from: 'try require(result, operation: "AudioDeviceCreateIOProcID")',
    to: 'try require(result, operation: "create IO")',
  },
  {
    id: 'platform-start-error-contract',
    from: 'operation: "AudioDeviceStart"',
    to: 'operation: "start IO"',
  },
  {
    id: 'platform-stop-forwarding',
    from: 'calls.stopIO(aggregateID: aggregateID)',
    to: '_ = aggregateID',
  },
  {
    id: 'platform-destroy-io-forwarding',
    from: 'calls.destroyIO(aggregateID: aggregateID)',
    to: '_ = aggregateID',
  },
  {
    id: 'platform-destroy-aggregate-forwarding',
    from: 'calls.destroyAggregate(aggregateID)',
    to: '_ = aggregateID',
  },
  {
    id: 'platform-destroy-tap-forwarding',
    from: 'calls.destroyTap(tapID)',
    to: '_ = tapID',
  },
];
const mutations = [
  ...coreMutations.map((mutation) => ({ ...mutation, relativePath: coreRelativePath })),
  ...platformMutations.map((mutation) => ({
    ...mutation,
    relativePath: platformRelativePath,
  })),
];

function replaceExactlyOnce(source, mutation) {
  const firstIndex = source.indexOf(mutation.from);
  const lastIndex = source.lastIndexOf(mutation.from);
  if (firstIndex === -1 || firstIndex !== lastIndex) {
    throw new Error(
      `${mutation.id}: expected exactly one source match, found ${
        firstIndex === -1 ? 0 : 'multiple'
      }`,
    );
  }
  return `${source.slice(0, firstIndex)}${mutation.to}${source.slice(
    firstIndex + mutation.from.length,
  )}`;
}

async function runSwift(directory, arguments_) {
  try {
    await execute('/usr/bin/xcrun', ['swift', ...arguments_, '--package-path', directory], {
      env: environment,
      maxBuffer: 30 * 1024 * 1024,
      timeout: 120_000,
    });
    return true;
  } catch {
    return false;
  }
}

if (!(await runSwift(packageDirectory, ['test']))) {
  throw new Error('Swift mutation baseline tests failed.');
}

const sourceByRelativePath = new Map(
  await Promise.all(
    [coreRelativePath, platformRelativePath].map(async (relativePath) => [
      relativePath,
      await readFile(path.join(packageDirectory, relativePath), 'utf8'),
    ]),
  ),
);
const rootTemporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'cue-swift-mutation-'));
const results = [];
try {
  const mutantDirectory = path.join(rootTemporaryDirectory, 'package');
  await cp(packageDirectory, mutantDirectory, {
    recursive: true,
    filter: (sourcePath) => !sourcePath.includes(`${path.sep}.build${path.sep}`),
  });
  for (const mutation of mutations) {
    for (const [relativePath, source] of sourceByRelativePath) {
      await writeFile(path.join(mutantDirectory, relativePath), source);
    }
    const source = sourceByRelativePath.get(mutation.relativePath);
    await writeFile(
      path.join(mutantDirectory, mutation.relativePath),
      replaceExactlyOnce(source, mutation),
    );
    const viable = await runSwift(mutantDirectory, ['build']);
    const survived = viable && (await runSwift(mutantDirectory, ['test']));
    const status = viable ? (survived ? 'survived' : 'killed') : 'unviable';
    results.push({ id: mutation.id, status });
    process.stdout.write(`${status.toUpperCase()} ${mutation.id}\n`);
  }
} finally {
  await rm(rootTemporaryDirectory, { recursive: true, force: true });
}

const survived = results.filter((result) => result.status === 'survived');
const unviable = results.filter((result) => result.status === 'unviable');
const killed = results.filter((result) => result.status === 'killed').length;
const score = results.length === 0 ? 0 : (killed / results.length) * 100;
process.stdout.write(
  `${JSON.stringify({
    total: results.length,
    killed,
    survived: survived.length,
    unviable: unviable.length,
    score,
  })}\n`,
);
if (survived.length > 0 || unviable.length > 0) {
  throw new Error(
    `Swift mutation gate failed: ${results
      .filter(({ status }) => status !== 'killed')
      .map(({ id, status }) => `${id}=${status}`)
      .join(', ')}`,
  );
}
