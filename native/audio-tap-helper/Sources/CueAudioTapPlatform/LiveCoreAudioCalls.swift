// Adapted from Apple's "Capturing system audio with Core Audio taps" sample.
// Copyright © 2024 Apple Inc. Used under the sample's MIT license.

import CoreAudio
import CueAudioTapCore
import Foundation

final class LiveCoreAudioCalls: CoreAudioCalls {
  private var ioProcID: AudioDeviceIOProcID?
  private var onBuffers: (([Data?]?) -> Void)?

  func createTap() -> CoreAudioResult<UInt32> {
    let description = CATapDescription(monoGlobalTapButExcludeProcesses: [])
    description.name = "cue global system audio probe"
    description.isPrivate = true
    description.muteBehavior = .unmuted
    var tapID = AudioObjectID(kAudioObjectUnknown)
    let status = AudioHardwareCreateProcessTap(description, &tapID)
    return result(status, value: tapID)
  }

  func tapUID(for tapID: UInt32) -> CoreAudioResult<String> {
    var address = propertyAddress(kAudioTapPropertyUID)
    var size = UInt32(MemoryLayout<CFString>.stride)
    var uid: CFString = "" as CFString
    let status = withUnsafeMutablePointer(to: &uid) { pointer in
      AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, pointer)
    }
    return result(status, value: uid as String)
  }

  func tapFormat(for tapID: UInt32) -> CoreAudioResult<TapFormat> {
    var address = propertyAddress(kAudioTapPropertyFormat)
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.stride)
    var format = AudioStreamBasicDescription()
    let status = AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, &format)
    return result(
      status,
      value: TapFormat(
        isLinearPCM: format.mFormatID == kAudioFormatLinearPCM,
        isFloat: format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
        bitsPerChannel: format.mBitsPerChannel,
        channelsPerFrame: format.mChannelsPerFrame,
        sampleRate: format.mSampleRate
      )
    )
  }

  func processIDs() -> CoreAudioResult<[UInt32]> {
    var address = propertyAddress(kAudioHardwarePropertyProcessObjectList)
    return readObjectIDs(AudioObjectID(kAudioObjectSystemObject), &address)
  }

  func processPID(processID: UInt32) -> CoreAudioResult<Int32> {
    var address = propertyAddress(kAudioProcessPropertyPID)
    var pid: pid_t = 0
    var size = UInt32(MemoryLayout<pid_t>.stride)
    let status = AudioObjectGetPropertyData(processID, &address, 0, nil, &size, &pid)
    return result(status, value: pid)
  }

  func processBundleID(processID: UInt32) -> CoreAudioResult<String> {
    var address = propertyAddress(kAudioProcessPropertyBundleID)
    var size = UInt32(MemoryLayout<CFString>.stride)
    var bundleIdentifier: CFString = "" as CFString
    let status = withUnsafeMutablePointer(to: &bundleIdentifier) { pointer in
      AudioObjectGetPropertyData(processID, &address, 0, nil, &size, pointer)
    }
    return result(status, value: bundleIdentifier as String)
  }

  func isRunningOutput(processID: UInt32) -> CoreAudioResult<UInt32> {
    var address = propertyAddress(kAudioProcessPropertyIsRunningOutput)
    var running: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.stride)
    let status = AudioObjectGetPropertyData(
      processID,
      &address,
      0,
      nil,
      &size,
      &running
    )
    return result(status, value: running)
  }

  func outputDeviceIDs(processID: UInt32) -> CoreAudioResult<[UInt32]> {
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioProcessPropertyDevices,
      mScope: kAudioObjectPropertyScopeOutput,
      mElement: kAudioObjectPropertyElementMain
    )
    return readObjectIDs(processID, &address)
  }

  func defaultOutputDeviceID() -> CoreAudioResult<UInt32> {
    var address = propertyAddress(kAudioHardwarePropertyDefaultOutputDevice)
    var deviceID = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.stride)
    let status = AudioObjectGetPropertyData(
      AudioObjectID(kAudioObjectSystemObject),
      &address,
      0,
      nil,
      &size,
      &deviceID
    )
    return result(status, value: deviceID)
  }

  func deviceUID(deviceID: UInt32) -> CoreAudioResult<String> {
    var address = propertyAddress(kAudioDevicePropertyDeviceUID)
    var size = UInt32(MemoryLayout<CFString>.stride)
    var uid: CFString = "" as CFString
    let status = withUnsafeMutablePointer(to: &uid) { pointer in
      AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, pointer)
    }
    return result(status, value: uid as String)
  }

  func createAggregate(plan: AggregateDevicePlan) -> CoreAudioResult<UInt32> {
    let subdevices: [[String: Any]] = plan.subdevices.map {
      [
        kAudioSubDeviceUIDKey: $0.uid,
        kAudioSubDeviceDriftCompensationKey: $0.driftCompensation ? 1 : 0,
      ]
    }
    let description: [String: Any] = [
      kAudioAggregateDeviceNameKey: plan.name,
      kAudioAggregateDeviceUIDKey: plan.uid,
      kAudioAggregateDeviceIsPrivateKey: plan.isPrivate,
      kAudioAggregateDeviceSubDeviceListKey: subdevices,
      kAudioAggregateDeviceMainSubDeviceKey: plan.mainSubdeviceUID,
      kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: plan.tapUID]],
    ]
    var aggregateID = AudioObjectID(kAudioObjectUnknown)
    let status = AudioHardwareCreateAggregateDevice(
      description as CFDictionary,
      &aggregateID
    )
    return result(status, value: aggregateID)
  }

  func createIO(
    aggregateID: UInt32,
    onBuffers: @escaping ([Data?]?) -> Void
  ) -> CoreAudioResult<Void> {
    self.onBuffers = onBuffers
    let callback: AudioDeviceIOProc = {
      _, _, inputData, _, _, _, clientData in
      guard let clientData else {
        return noErr
      }
      let calls = Unmanaged<LiveCoreAudioCalls>.fromOpaque(clientData)
        .takeUnretainedValue()
      calls.onBuffers?(calls.copyBuffers(inputData))
      return noErr
    }
    let status = AudioDeviceCreateIOProcID(
      aggregateID,
      callback,
      Unmanaged.passUnretained(self).toOpaque(),
      &ioProcID
    )
    guard status == noErr else {
      ioProcID = nil
      self.onBuffers = nil
      return .failure(status)
    }
    return .success(())
  }

  func startIO(aggregateID: UInt32) -> CoreAudioResult<Void> {
    let status = AudioDeviceStart(aggregateID, ioProcID)
    return status == noErr ? .success(()) : .failure(status)
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
    onBuffers = nil
  }

  func destroyAggregate(_ aggregateID: UInt32) {
    AudioHardwareDestroyAggregateDevice(aggregateID)
  }

  func destroyTap(_ tapID: UInt32) {
    AudioHardwareDestroyProcessTap(tapID)
  }

  private func result<Value>(_ status: OSStatus, value: Value) -> CoreAudioResult<Value> {
    status == noErr ? .success(value) : .failure(status)
  }

  private func propertyAddress(
    _ selector: AudioObjectPropertySelector
  ) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
      mSelector: selector,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
  }

  private func readObjectIDs(
    _ objectID: AudioObjectID,
    _ address: inout AudioObjectPropertyAddress
  ) -> CoreAudioResult<[AudioObjectID]> {
    var size: UInt32 = 0
    let sizeStatus = AudioObjectGetPropertyDataSize(objectID, &address, 0, nil, &size)
    guard sizeStatus == noErr else {
      return .failure(sizeStatus)
    }
    var values = [AudioObjectID](
      repeating: kAudioObjectUnknown,
      count: Int(size) / MemoryLayout<AudioObjectID>.stride
    )
    let dataStatus = AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, &values)
    return result(dataStatus, value: values)
  }

  private func copyBuffers(_ inputData: UnsafePointer<AudioBufferList>?) -> [Data?]? {
    guard let inputData else {
      return nil
    }
    let buffers = UnsafeMutableAudioBufferListPointer(
      UnsafeMutablePointer(mutating: inputData)
    )
    return buffers.map { buffer in
      guard let data = buffer.mData else {
        return nil
      }
      return Data(bytes: data, count: Int(buffer.mDataByteSize))
    }
  }
}
