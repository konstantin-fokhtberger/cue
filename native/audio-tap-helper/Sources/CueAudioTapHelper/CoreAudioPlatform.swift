// Adapted from Apple's "Capturing system audio with Core Audio taps" sample.
// Copyright © 2024 Apple Inc. Used under the sample's MIT license.

import CoreAudio
import CueAudioTapCore
import Foundation

private func check(_ status: OSStatus, _ operation: String) throws {
  guard status == noErr else {
    throw HelperError.operation(name: operation, status: status)
  }
}

private func propertyAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress
{
  AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
}

final class CoreAudioTapPlatform: AudioTapPlatform {
  private var ioProcID: AudioDeviceIOProcID?
  private var onPayload: ((AudioPayload) -> Void)?

  func createTap() throws -> UInt32 {
    let description = CATapDescription(monoGlobalTapButExcludeProcesses: [])
    description.name = "cue global system audio probe"
    description.isPrivate = true
    description.muteBehavior = .unmuted
    var tapID = AudioObjectID(kAudioObjectUnknown)
    try check(AudioHardwareCreateProcessTap(description, &tapID), "AudioHardwareCreateProcessTap")
    return tapID
  }

  func tapUID(for tapID: UInt32) throws -> String {
    var address = propertyAddress(kAudioTapPropertyUID)
    var size = UInt32(MemoryLayout<CFString>.stride)
    var uid: CFString = "" as CFString
    try withUnsafeMutablePointer(to: &uid) { pointer in
      try check(
        AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, pointer),
        "AudioObjectGetPropertyData(tap UID)"
      )
    }
    return uid as String
  }

  func tapFormat(for tapID: UInt32) throws -> TapFormat {
    var address = propertyAddress(kAudioTapPropertyFormat)
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.stride)
    var format = AudioStreamBasicDescription()
    try check(
      AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, &format),
      "AudioObjectGetPropertyData(tap format)"
    )
    return TapFormat(
      isLinearPCM: format.mFormatID == kAudioFormatLinearPCM,
      isFloat: format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
      bitsPerChannel: format.mBitsPerChannel,
      channelsPerFrame: format.mChannelsPerFrame,
      sampleRate: format.mSampleRate
    )
  }

  func runningOutputDeviceUIDs() throws -> [String] {
    let systemObject = AudioObjectID(kAudioObjectSystemObject)
    var processAddress = propertyAddress(kAudioHardwarePropertyProcessObjectList)
    let processIDs = try readObjectIDs(systemObject, &processAddress)
    var deviceIDs = [AudioObjectID]()

    for processID in processIDs {
      var runningAddress = propertyAddress(kAudioProcessPropertyIsRunningOutput)
      var running: UInt32 = 0
      var runningSize = UInt32(MemoryLayout<UInt32>.stride)
      guard
        AudioObjectGetPropertyData(
          processID,
          &runningAddress,
          0,
          nil,
          &runningSize,
          &running
        ) == noErr, running != 0
      else {
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

  func createAggregate(tapUID: String, outputDeviceUIDs: [String]) throws -> UInt32 {
    let subdevices: [[String: Any]] = outputDeviceUIDs.enumerated().map { index, uid in
      [
        kAudioSubDeviceUIDKey: uid,
        kAudioSubDeviceDriftCompensationKey: index == 0 ? 0 : 1,
      ]
    }
    let description: [String: Any] = [
      kAudioAggregateDeviceNameKey: "cue audio tap probe",
      kAudioAggregateDeviceUIDKey: "com.cue.overlay.audio-tap-helper.\(UUID().uuidString)",
      kAudioAggregateDeviceIsPrivateKey: true,
      kAudioAggregateDeviceSubDeviceListKey: subdevices,
      kAudioAggregateDeviceMainSubDeviceKey: outputDeviceUIDs[0],
      kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: tapUID]],
    ]
    var aggregateID = AudioObjectID(kAudioObjectUnknown)
    try check(
      AudioHardwareCreateAggregateDevice(description as CFDictionary, &aggregateID),
      "AudioHardwareCreateAggregateDevice"
    )
    return aggregateID
  }

  func createIO(
    aggregateID: UInt32,
    onPayload: @escaping (AudioPayload) -> Void
  ) throws {
    self.onPayload = onPayload
    let callback: AudioDeviceIOProc = {
      _, _, inputData, _, _, _, clientData in
      guard let clientData else {
        return noErr
      }
      let platform = Unmanaged<CoreAudioTapPlatform>.fromOpaque(clientData)
        .takeUnretainedValue()
      platform.record(inputData)
      return noErr
    }
    do {
      try check(
        AudioDeviceCreateIOProcID(
          aggregateID,
          callback,
          Unmanaged.passUnretained(self).toOpaque(),
          &ioProcID
        ),
        "AudioDeviceCreateIOProcID"
      )
    } catch {
      ioProcID = nil
      self.onPayload = nil
      throw error
    }
  }

  func startIO(aggregateID: UInt32) throws {
    try check(AudioDeviceStart(aggregateID, ioProcID), "AudioDeviceStart")
  }

  func stopIO(aggregateID: UInt32) {
    if let ioProcID {
      AudioDeviceStop(aggregateID, ioProcID)
    }
  }

  func destroyIO(aggregateID: UInt32) {
    if let ioProcID {
      AudioDeviceDestroyIOProcID(aggregateID, ioProcID)
      self.ioProcID = nil
    }
    onPayload = nil
  }

  func destroyAggregate(_ aggregateID: UInt32) {
    AudioHardwareDestroyAggregateDevice(aggregateID)
  }

  func destroyTap(_ tapID: UInt32) {
    AudioHardwareDestroyProcessTap(tapID)
  }

  private func record(_ inputData: UnsafePointer<AudioBufferList>?) {
    guard let inputData else {
      return
    }
    let buffers = UnsafeMutableAudioBufferListPointer(
      UnsafeMutablePointer(mutating: inputData)
    )
    for buffer in buffers {
      guard let data = buffer.mData else {
        continue
      }
      if let payload = AudioPayload(
        float32LE: Data(bytes: data, count: Int(buffer.mDataByteSize))
      ) {
        onPayload?(payload)
      }
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
    var address = propertyAddress(kAudioDevicePropertyDeviceUID)
    var size = UInt32(MemoryLayout<CFString>.stride)
    var uid: CFString = "" as CFString
    try withUnsafeMutablePointer(to: &uid) { pointer in
      try check(
        AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, pointer),
        "AudioObjectGetPropertyData(output UID)"
      )
    }
    return uid as String
  }
}
