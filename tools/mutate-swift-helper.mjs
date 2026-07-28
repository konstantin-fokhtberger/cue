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
const controlRelativePath = path.join('Sources', 'CueAudioTapCore', 'HelperControl.swift');
const resolverRelativePath = path.join('Sources', 'CueAudioTapCore', 'CaptureScopeResolver.swift');
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
    id: 'application-process-set-forwarding',
    from: 'processObjectIDs: verifiedScope.audioProcessObjectIDs',
    to: 'processObjectIDs: []',
  },
  {
    id: 'application-output-devices-forwarding',
    from: 'outputDeviceUIDs: verifiedScope.outputDeviceUIDs',
    to: 'outputDeviceUIDs: []',
  },
  {
    id: 'application-selection-tracked',
    from: 'applicationSelection = selection',
    to: 'applicationSelection = nil',
  },
  {
    id: 'application-effective-scope-tracked',
    from: 'verifiedApplicationScope = verifiedScope',
    to: 'verifiedApplicationScope = nil',
  },
  {
    id: 'application-effective-scope-emitted',
    from: 'scope: .application(verifiedScope)',
    to: 'scope: .diagnosticGlobal',
  },
  {
    id: 'application-scope-health-comparison',
    from: '(try? platform.verifyApplicationScope(applicationSelection)) == verifiedApplicationScope',
    to: '(try? platform.verifyApplicationScope(applicationSelection)) != verifiedApplicationScope',
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
    id: 'protocol-application-verified',
    from: '"verified": true,',
    to: '"verified": false,',
  },
  {
    id: 'protocol-stopped-name',
    from: '"event": "stopped",',
    to: '"event": "idle",',
  },
  {
    id: 'protocol-inventory-name',
    from: '"event": "inventory",',
    to: '"event": "applications",',
  },
  {
    id: 'protocol-inventory-generation',
    from: '"generation": inventory.generation,',
    to: '"generation": inventory.generation + 1,',
  },
  {
    id: 'protocol-inventory-sources',
    from: '"sources": inventory.sources.map(encodeInventorySource),',
    to: '"sources": [],',
  },
  {
    id: 'protocol-inventory-available-status',
    from: 'status = "available"',
    to: 'status = "unresolved"',
  },
  {
    id: 'protocol-inventory-available-failure',
    from: 'failure = NSNull()',
    to: 'failure = "missing-process-metadata"',
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
    from: 'try termination.wait()',
    to: '_ = termination',
  },
  {
    id: 'runner-requested-scope-forwarding',
    from: 'let started = try session.start(scope: scope)',
    to: 'let started = CaptureStart(sampleRate: try session.start(), scope: .diagnosticGlobal)',
  },
  {
    id: 'runner-inventory-generation-forwarding',
    from: 'try writeEvent(encode(.inventory(try inventory(generation))))',
    to: 'try writeEvent(encode(.inventory(try inventory(generation + 1))))',
  },
  {
    id: 'runner-inventory-starts-capture',
    from: 'case .inventory(_, let generation):\n        try writeEvent',
    to: 'case .inventory(_, let generation):\n        _ = try session.start()\n        try writeEvent',
  },
  {
    id: 'runner-drains-before-stop-event',
    from: 'session.drain()',
    to: '_ = session',
  },
  {
    id: 'runner-capture-success-code',
    from: 'try writeEvent(encode(.stopped(metrics: session.snapshot())))\n        return 0',
    to: 'try writeEvent(encode(.stopped(metrics: session.snapshot())))\n        return 2',
  },
  {
    id: 'runner-inventory-success-code',
    from: 'try writeEvent(encode(.inventory(try inventory(generation))))\n        return 0',
    to: 'try writeEvent(encode(.inventory(try inventory(generation))))\n        return 2',
  },
  {
    id: 'runner-error-code',
    from: 'return 1',
    to: 'return 2',
  },
];
const controlMutations = [
  {
    id: 'control-version-one-required',
    from: 'version == 1,',
    to: 'version >= 1,',
  },
  {
    id: 'control-command-required',
    from: 'let command = HelperCommand(rawValue: commandValue)',
    to: 'let command = HelperCommand(rawValue: "capture")',
  },
  {
    id: 'control-scope-required',
    from: 'scopeKind == "diagnostic-global"',
    to: 'scopeKind != "diagnostic-global"',
  },
  {
    id: 'control-application-envelope-required',
    from: 'Set(scope.keys) == [\n          "browserWideAcknowledged",\n          "bundleIdentifier",\n          "inventoryGeneration",\n          "kind",\n          "responsiblePid",\n        ],',
    to: 'true,',
  },
  {
    id: 'control-application-kind-required',
    from: 'scopeKind == "application",',
    to: 'true,',
  },
  {
    id: 'control-application-positive-generation',
    from: 'let generation = scope["inventoryGeneration"] as? Int,\n        generation > 0,',
    to: 'let generation = scope["inventoryGeneration"] as? Int,\n        generation >= 0,',
  },
  {
    id: 'control-application-positive-pid',
    from: 'let responsiblePID = scope["responsiblePid"] as? Int,\n        responsiblePID > 0,',
    to: 'let responsiblePID = scope["responsiblePid"] as? Int,\n        responsiblePID >= 0,',
  },
  {
    id: 'control-application-bundle-required',
    from: '!bundleIdentifier.isEmpty,',
    to: 'true,',
  },
  {
    id: 'control-application-generation-forwarding',
    from: 'inventoryGeneration: UInt64(generation),',
    to: 'inventoryGeneration: UInt64(generation + 1),',
  },
  {
    id: 'control-application-pid-forwarding',
    from: 'responsiblePID: Int32(responsiblePID),',
    to: 'responsiblePID: Int32(responsiblePID + 1),',
  },
  {
    id: 'control-application-bundle-forwarding',
    from: 'bundleIdentifier: bundleIdentifier,',
    to: 'bundleIdentifier: "",',
  },
  {
    id: 'control-application-acknowledgement-forwarding',
    from: 'browserWideAcknowledged: browserWideAcknowledged',
    to: 'browserWideAcknowledged: !browserWideAcknowledged',
  },
  {
    id: 'control-inventory-envelope-required',
    from: 'Set(object.keys) == ["command", "generation", "protocolVersion"],',
    to: 'true,',
  },
  {
    id: 'control-inventory-positive-generation',
    from: 'let generation = object["generation"] as? Int,\n        generation > 0,',
    to: 'let generation = object["generation"] as? Int,\n        generation >= 0,',
  },
  {
    id: 'control-inventory-safe-generation',
    from: 'Set(object.keys) == ["command", "generation", "protocolVersion"],\n        let generation = object["generation"] as? Int,\n        generation > 0,\n        generation <= 9_007_199_254_740_991',
    to: 'Set(object.keys) == ["command", "generation", "protocolVersion"],\n        let generation = object["generation"] as? Int,\n        generation > 0,\n        generation < 9_007_199_254_740_991',
  },
  {
    id: 'control-inventory-generation-forwarding',
    from: 'return .inventory(protocolVersion: version, generation: UInt64(generation))',
    to: 'return .inventory(protocolVersion: version, generation: UInt64(generation + 1))',
  },
  {
    id: 'control-message-bound-inclusive',
    from: 'line.count <= maximumMessageBytes',
    to: 'line.count < maximumMessageBytes',
  },
  {
    id: 'control-buffer-bound-inclusive',
    from: 'buffer.count <= maximumMessageBytes',
    to: 'buffer.count < maximumMessageBytes',
  },
  {
    id: 'control-rejects-trailing-data',
    from: 'guard buffer.index(after: newline) == buffer.endIndex else {',
    to: 'guard true else {',
  },
  {
    id: 'control-rejects-post-configuration-data',
    from: 'guard completedLine == nil else {',
    to: 'guard true else {',
  },
  {
    id: 'control-eof-before-configuration-fails',
    from: 'guard !chunk.isEmpty else {\n        throw HelperError.controlClosed\n      }\n      line = try framer.accept(chunk)',
    to: 'guard !chunk.isEmpty else {\n        throw HelperError.invalidControlMessage\n      }\n      line = try framer.accept(chunk)',
  },
  {
    id: 'control-eof-after-configuration-stops',
    from: 'guard chunk.isEmpty else {',
    to: 'guard !chunk.isEmpty else {',
  },
];
const resolverMutations = [
  {
    id: 'resolver-process-index',
    from: 'processByPID[process.pid] = process',
    to: 'processByPID.removeValue(forKey: process.pid)',
  },
  {
    id: 'resolver-object-id-grouping',
    from: 'accumulator.objectIDs.insert(observation.objectID)',
    to: 'accumulator.objectIDs.remove(observation.objectID)',
  },
  {
    id: 'resolver-device-grouping',
    from: 'accumulator.deviceUIDs.formUnion(normalizedDeviceUIDs(observation.deviceUIDs))',
    to: '_ = observation.deviceUIDs',
  },
  {
    id: 'resolver-source-order',
    from: '$0.audioProcessObjectIDs[0] < $1.audioProcessObjectIDs[0]',
    to: '$0.audioProcessObjectIDs[0] > $1.audioProcessObjectIDs[0]',
  },
  {
    id: 'resolver-generation-required',
    from: 'guard selection.inventoryGeneration == inventory.generation else {',
    to: 'guard true else {',
  },
  {
    id: 'resolver-instance-pid-required',
    from: 'source.identity?.pid == selection.responsiblePID',
    to: 'true',
  },
  {
    id: 'resolver-bundle-required',
    from: 'source.identity?.bundleIdentifier == selection.bundleIdentifier',
    to: 'true',
  },
  {
    id: 'resolver-browser-acknowledgement-required',
    from: 'guard !source.requiresBrowserWideAcknowledgement || selection.browserWideAcknowledged else {',
    to: 'guard true else {',
  },
  {
    id: 'resolver-output-device-required',
    from: 'guard !source.outputDeviceUIDs.isEmpty else {',
    to: 'guard true else {',
  },
  {
    id: 'resolver-cycle-rejected',
    from: 'guard visited.insert(currentPID).inserted else {',
    to: 'guard true else {',
  },
  {
    id: 'resolver-cue-ancestry-rejected',
    from: 'guard !process.isCueOwned else {',
    to: 'guard true else {',
  },
  {
    id: 'resolver-regular-app-required',
    from: 'if process.isRegularApplication {',
    to: 'if true {',
  },
  {
    id: 'resolver-parent-traversal',
    from: 'currentPID = parentPID',
    to: 'currentPID = process.pid',
  },
  {
    id: 'resolver-trims-identity',
    from: 'let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)',
    to: 'let trimmed = value',
  },
  {
    id: 'resolver-rejects-empty-identity',
    from: 'return trimmed.isEmpty ? nil : trimmed',
    to: 'return trimmed',
  },
  {
    id: 'resolver-chrome-prefix-disclosure',
    from: '|| bundleIdentifier.hasPrefix("com.google.Chrome.")',
    to: '|| false',
  },
];
const platformMutations = [
  {
    id: 'platform-application-process-required',
    from: 'guard !processObjectIDs.isEmpty else {',
    to: 'guard true else {',
  },
  {
    id: 'platform-application-process-forwarding',
    from: 'calls.createApplicationTap(processObjectIDs: processObjectIDs),',
    to: 'calls.createApplicationTap(processObjectIDs: []),',
  },
  {
    id: 'platform-application-generation-forwarding',
    from: 'in: applicationCaptureInventory(generation: selection.inventoryGeneration)',
    to: 'in: applicationCaptureInventory(generation: selection.inventoryGeneration + 1)',
  },
  {
    id: 'platform-process-unknown-filter',
    from: 'var deviceIDs = [UInt32]()\n\n    for processID in processIDs where processID != 0 {',
    to: 'var deviceIDs = [UInt32]()\n\n    for processID in processIDs where true {',
  },
  {
    id: 'platform-running-output-required',
    from: 'guard case .success(let running) = calls.isRunningOutput(processID: processID),\n        running != 0\n      else {',
    to: 'guard case .success(let running) = calls.isRunningOutput(processID: processID),\n        running == 0\n      else {',
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
  {
    id: 'platform-inventory-process-unknown-filter',
    from: 'var deviceUIDByID = [UInt32: String]()\n\n    for processID in processIDs where processID != 0 {',
    to: 'var deviceUIDByID = [UInt32: String]()\n\n    for processID in processIDs where true {',
  },
  {
    id: 'platform-inventory-running-output-required',
    from: 'running != 0,\n        case .success(let pid) = calls.processPID(processID: processID),\n        pid > 0',
    to: 'running == 0,\n        case .success(let pid) = calls.processPID(processID: processID),\n        pid > 0',
  },
  {
    id: 'platform-inventory-positive-pid-required',
    from: 'case .success(let pid) = calls.processPID(processID: processID),\n        pid > 0',
    to: 'case .success(let pid) = calls.processPID(processID: processID),\n        pid == 0',
  },
  {
    id: 'platform-inventory-device-unknown-filter',
    from: 'for deviceID in deviceIDs where deviceID != 0 {',
    to: 'for deviceID in deviceIDs where true {',
  },
  {
    id: 'platform-inventory-device-uid-cache',
    from: 'if let cached = deviceUIDByID[deviceID] {',
    to: 'if false, let cached = deviceUIDByID[deviceID] {',
  },
  {
    id: 'platform-inventory-coreaudio-bundle-forwarding',
    from: 'coreAudioBundleIDByPID[pid] = bundleIdentifier',
    to: 'coreAudioBundleIDByPID[pid] = nil',
  },
  {
    id: 'platform-inventory-process-node-deduplication',
    from: 'if nodes[currentPID] != nil {',
    to: 'if false {',
  },
  {
    id: 'platform-inventory-responsible-node-stop',
    from: 'if node.isCueOwned || node.isRegularApplication {',
    to: 'if false {',
  },
  {
    id: 'platform-inventory-parent-traversal',
    from: 'currentPID = parentPID',
    to: 'currentPID = node.pid',
  },
  {
    id: 'platform-inventory-root-bundle-fallback',
    from: 'coreAudioBundleIdentifier: currentPID == observation.pid\n            ? coreAudioBundleIDByPID[currentPID] : nil',
    to: 'coreAudioBundleIdentifier: false\n            ? coreAudioBundleIDByPID[currentPID] : nil',
  },
  {
    id: 'platform-inventory-bundle-fallback',
    from: 'normalized(node.bundleIdentifier)\n      ?? normalized(coreAudioBundleIdentifier)',
    to: 'normalized(node.bundleIdentifier)\n      ?? nil',
  },
  {
    id: 'platform-inventory-cue-prefix-exclusion',
    from: '|| bundleIdentifier?.hasPrefix("com.cue.overlay.") == true',
    to: '|| false',
  },
];
const mutations = [
  ...coreMutations.map((mutation) => ({ ...mutation, relativePath: coreRelativePath })),
  ...controlMutations.map((mutation) => ({
    ...mutation,
    relativePath: controlRelativePath,
  })),
  ...resolverMutations.map((mutation) => ({
    ...mutation,
    relativePath: resolverRelativePath,
  })),
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
    [coreRelativePath, controlRelativePath, resolverRelativePath, platformRelativePath].map(
      async (relativePath) => [
        relativePath,
        await readFile(path.join(packageDirectory, relativePath), 'utf8'),
      ],
    ),
  ),
);
for (const mutation of mutations) {
  replaceExactlyOnce(sourceByRelativePath.get(mutation.relativePath), mutation);
}
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
