/*
Adapted from Apple's "Capturing system audio with Core Audio taps" sample.
Copyright © 2024 Apple Inc. Used under the sample's MIT license.
*/

import CoreAudio
import Darwin
import Foundation

private enum TapError: Error, CustomStringConvertible {
    case coreAudio(operation: String, status: OSStatus)
    case missingTapUID
    case unsupportedFormat

    var description: String {
        switch self {
        case let .coreAudio(operation, status):
            return "\(operation) failed with OSStatus \(status)"
        case .missingTapUID:
            return "The process tap did not expose a UID."
        case .unsupportedFormat:
            return "The tap did not provide mono Float32 linear PCM."
        }
    }
}

private func check(_ status: OSStatus, _ operation: String) throws {
    guard status == noErr else {
        throw TapError.coreAudio(operation: operation, status: status)
    }
}

private func propertyAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
}

private final class SignalMetrics {
    private let metricsQueue = DispatchQueue(label: "com.cue.audio-tap-helper.metrics")
    private let writerQueue = DispatchQueue(label: "com.cue.audio-tap-helper.stdout")
    private let pendingLock = NSLock()
    private let maximumPendingBytes = 1_048_576
    private var pendingBytes = 0
    private var callbackCount: UInt64 = 0
    private var sampleCount: UInt64 = 0
    private var nonzeroCount: UInt64 = 0
    private var peak: Float = 0

    func record(_ inputData: UnsafePointer<AudioBufferList>?) {
        guard let inputData else {
            return
        }

        let buffers = UnsafeMutableAudioBufferListPointer(
            UnsafeMutablePointer(mutating: inputData)
        )
        var localSamples: UInt64 = 0
        var localNonzero: UInt64 = 0
        var localPeak: Float = 0
        var payloads = [Data]()

        for buffer in buffers {
            guard let data = buffer.mData else {
                continue
            }
            payloads.append(Data(bytes: data, count: Int(buffer.mDataByteSize)))
            let count = Int(buffer.mDataByteSize) / MemoryLayout<Float>.stride
            let samples = data.assumingMemoryBound(to: Float.self)
            localSamples += UInt64(count)
            for index in 0..<count {
                let absolute = abs(samples[index])
                if absolute > 0 {
                    localNonzero += 1
                }
                if absolute > localPeak {
                    localPeak = absolute
                }
            }
        }

        metricsQueue.async {
            self.callbackCount += 1
            self.sampleCount += localSamples
            self.nonzeroCount += localNonzero
            self.peak = max(self.peak, localPeak)
        }

        let payloadBytes = payloads.reduce(0) { $0 + $1.count }
        guard reserve(payloadBytes) else {
            return
        }
        writerQueue.async {
            for payload in payloads {
                FileHandle.standardOutput.write(payload)
            }
            self.release(payloadBytes)
        }
    }

    func snapshot() -> [String: Any] {
        metricsQueue.sync {
            [
                "callbacks": callbackCount,
                "samples": sampleCount,
                "nonzero": nonzeroCount,
                "peak": peak,
            ]
        }
    }

    func drain() {
        writerQueue.sync {}
    }

    private func reserve(_ byteCount: Int) -> Bool {
        pendingLock.lock()
        defer { pendingLock.unlock() }
        guard pendingBytes + byteCount <= maximumPendingBytes else {
            return false
        }
        pendingBytes += byteCount
        return true
    }

    private func release(_ byteCount: Int) {
        pendingLock.lock()
        pendingBytes -= byteCount
        pendingLock.unlock()
    }
}

private final class AudioTapProbe {
    private let metrics = SignalMetrics()
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?

    deinit {
        stop()
    }

    func start() throws -> Double {
        let description = CATapDescription(monoGlobalTapButExcludeProcesses: [])
        description.name = "cue global system audio probe"
        description.isPrivate = true
        description.muteBehavior = .unmuted
        try check(
            AudioHardwareCreateProcessTap(description, &tapID),
            "AudioHardwareCreateProcessTap"
        )

        let tapUID = try readTapUID()
        let tapFormat = try readTapFormat()
        guard tapFormat.mFormatID == kAudioFormatLinearPCM,
              tapFormat.mFormatFlags & kAudioFormatFlagIsFloat != 0,
              tapFormat.mBitsPerChannel == 32,
              tapFormat.mChannelsPerFrame == 1 else {
            throw TapError.unsupportedFormat
        }
        let clockDeviceUIDs = try readRunningOutputDeviceUIDs()
        let subdevices: [[String: Any]] = clockDeviceUIDs.enumerated().map { index, uid in
            [
                kAudioSubDeviceUIDKey: uid,
                kAudioSubDeviceDriftCompensationKey: index == 0 ? 0 : 1,
            ]
        }
        let aggregateDescription: [String: Any] = [
            kAudioAggregateDeviceNameKey: "cue audio tap probe",
            kAudioAggregateDeviceUIDKey: "com.cue.overlay.audio-tap-helper.\(UUID().uuidString)",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceSubDeviceListKey: subdevices,
            kAudioAggregateDeviceMainSubDeviceKey: clockDeviceUIDs[0],
            kAudioAggregateDeviceTapListKey: [
                [kAudioSubTapUIDKey: tapUID],
            ],
        ]
        try check(
            AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregateID),
            "AudioHardwareCreateAggregateDevice"
        )

        let callback: AudioDeviceIOProc = {
            _,
            _,
            inputData,
            _,
            _,
            _,
            clientData in
            guard let clientData else {
                return noErr
            }
            let probe = Unmanaged<AudioTapProbe>.fromOpaque(clientData).takeUnretainedValue()
            probe.metrics.record(inputData)
            return noErr
        }

        try check(
            AudioDeviceCreateIOProcID(
                aggregateID,
                callback,
                Unmanaged.passUnretained(self).toOpaque(),
                &ioProcID
            ),
            "AudioDeviceCreateIOProcID"
        )
        try check(AudioDeviceStart(aggregateID, ioProcID), "AudioDeviceStart")
        return tapFormat.mSampleRate
    }

    func stop() {
        if aggregateID != kAudioObjectUnknown, let ioProcID {
            AudioDeviceStop(aggregateID, ioProcID)
            AudioDeviceDestroyIOProcID(aggregateID, ioProcID)
            self.ioProcID = nil
        }
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
    }

    func snapshot() -> [String: Any] {
        metrics.snapshot()
    }

    func drain() {
        metrics.drain()
    }

    private func readTapUID() throws -> String {
        var address = propertyAddress(kAudioTapPropertyUID)
        var size = UInt32(MemoryLayout<CFString>.stride)
        var uid: CFString = "" as CFString
        try withUnsafeMutablePointer(to: &uid) { pointer in
            try check(
                AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, pointer),
                "AudioObjectGetPropertyData(tap UID)"
            )
        }
        let value = uid as String
        guard !value.isEmpty else {
            throw TapError.missingTapUID
        }
        return value
    }

    private func readTapFormat() throws -> AudioStreamBasicDescription {
        var address = propertyAddress(kAudioTapPropertyFormat)
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.stride)
        var format = AudioStreamBasicDescription()
        try check(
            AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, &format),
            "AudioObjectGetPropertyData(tap format)"
        )
        return format
    }

    private func readRunningOutputDeviceUIDs() throws -> [String] {
        let systemObject = AudioObjectID(kAudioObjectSystemObject)
        var processAddress = propertyAddress(kAudioHardwarePropertyProcessObjectList)
        let processIDs = try readObjectIDs(systemObject, &processAddress)
        var deviceIDs = [AudioObjectID]()

        for processID in processIDs {
            var runningAddress = propertyAddress(kAudioProcessPropertyIsRunningOutput)
            var running: UInt32 = 0
            var runningSize = UInt32(MemoryLayout<UInt32>.stride)
            guard AudioObjectGetPropertyData(
                processID,
                &runningAddress,
                0,
                nil,
                &runningSize,
                &running
            ) == noErr, running != 0 else {
                continue
            }
            var devicesAddress = AudioObjectPropertyAddress(
                mSelector: kAudioProcessPropertyDevices,
                mScope: kAudioObjectPropertyScopeOutput,
                mElement: kAudioObjectPropertyElementMain
            )
            deviceIDs.append(contentsOf: try readObjectIDs(processID, &devicesAddress))
        }

        if deviceIDs.isEmpty {
            var defaultAddress = propertyAddress(kAudioHardwarePropertyDefaultOutputDevice)
            var defaultID = AudioObjectID(kAudioObjectUnknown)
            var defaultSize = UInt32(MemoryLayout<AudioObjectID>.stride)
            try check(
                AudioObjectGetPropertyData(
                    systemObject,
                    &defaultAddress,
                    0,
                    nil,
                    &defaultSize,
                    &defaultID
                ),
                "AudioObjectGetPropertyData(default output)"
            )
            deviceIDs.append(defaultID)
        }

        var seen = Set<String>()
        return try deviceIDs.compactMap { deviceID in
            let uid = try readDeviceUID(deviceID)
            return seen.insert(uid).inserted ? uid : nil
        }
    }

    private func readObjectIDs(
        _ objectID: AudioObjectID,
        _ address: inout AudioObjectPropertyAddress
    ) throws -> [AudioObjectID] {
        var size: UInt32 = 0
        try check(
            AudioObjectGetPropertyDataSize(objectID, &address, 0, nil, &size),
            "AudioObjectGetPropertyDataSize(object IDs)"
        )
        var values = [AudioObjectID](
            repeating: kAudioObjectUnknown,
            count: Int(size) / MemoryLayout<AudioObjectID>.stride
        )
        try check(
            AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, &values),
            "AudioObjectGetPropertyData(object IDs)"
        )
        return values.filter { $0 != kAudioObjectUnknown }
    }

    private func readDeviceUID(_ deviceID: AudioObjectID) throws -> String {
        var uidAddress = propertyAddress(kAudioDevicePropertyDeviceUID)
        var uidSize = UInt32(MemoryLayout<CFString>.stride)
        var uid: CFString = "" as CFString
        try withUnsafeMutablePointer(to: &uid) { pointer in
            try check(
                AudioObjectGetPropertyData(deviceID, &uidAddress, 0, nil, &uidSize, pointer),
                "AudioObjectGetPropertyData(output UID)"
            )
        }
        return uid as String
    }

}

private let probe = AudioTapProbe()

do {
    signal(SIGTERM, SIG_IGN)
    signal(SIGINT, SIG_IGN)
    let stopped = DispatchSemaphore(value: 0)
    let terminateSource = DispatchSource.makeSignalSource(signal: SIGTERM)
    let interruptSource = DispatchSource.makeSignalSource(signal: SIGINT)
    terminateSource.setEventHandler { stopped.signal() }
    interruptSource.setEventHandler { stopped.signal() }
    terminateSource.resume()
    interruptSource.resume()

    let sampleRate = try probe.start()
    let started = try JSONSerialization.data(
        withJSONObject: [
            "channels": 1,
            "event": "started",
            "format": "float32le",
            "sampleRate": sampleRate,
        ],
        options: [.sortedKeys]
    )
    FileHandle.standardError.write(started)
    FileHandle.standardError.write(Data("\n".utf8))

    stopped.wait()

    probe.stop()
    probe.drain()
    let stoppedPayload = try JSONSerialization.data(
        withJSONObject: ["event": "stopped", "metrics": probe.snapshot()],
        options: [.sortedKeys]
    )
    FileHandle.standardError.write(stoppedPayload)
    FileHandle.standardError.write(Data("\n".utf8))
} catch {
    probe.stop()
    let errorPayload = try? JSONSerialization.data(
        withJSONObject: ["event": "error", "message": String(describing: error)],
        options: [.sortedKeys]
    )
    if let errorPayload {
        FileHandle.standardError.write(errorPayload)
        FileHandle.standardError.write(Data("\n".utf8))
    }
    exit(1)
}
