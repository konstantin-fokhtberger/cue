import CueAudioTapCore
import Foundation

enum CoreAudioResult<Value> {
  case success(Value)
  case failure(Int32)
}

struct AggregateSubdevicePlan: Equatable {
  let uid: String
  let driftCompensation: Bool
}

struct AggregateDevicePlan: Equatable {
  let name: String
  let uid: String
  let isPrivate: Bool
  let subdevices: [AggregateSubdevicePlan]
  let mainSubdeviceUID: String
  let tapUID: String
}

protocol CoreAudioCalls: AnyObject {
  func createTap() -> CoreAudioResult<UInt32>
  func tapUID(for tapID: UInt32) -> CoreAudioResult<String>
  func tapFormat(for tapID: UInt32) -> CoreAudioResult<TapFormat>
  func processIDs() -> CoreAudioResult<[UInt32]>
  func processPID(processID: UInt32) -> CoreAudioResult<Int32>
  func processBundleID(processID: UInt32) -> CoreAudioResult<String>
  func isRunningOutput(processID: UInt32) -> CoreAudioResult<UInt32>
  func outputDeviceIDs(processID: UInt32) -> CoreAudioResult<[UInt32]>
  func defaultOutputDeviceID() -> CoreAudioResult<UInt32>
  func deviceUID(deviceID: UInt32) -> CoreAudioResult<String>
  func createAggregate(plan: AggregateDevicePlan) -> CoreAudioResult<UInt32>
  func createIO(
    aggregateID: UInt32,
    onBuffers: @escaping ([Data?]?) -> Void
  ) -> CoreAudioResult<Void>
  func startIO(aggregateID: UInt32) -> CoreAudioResult<Void>
  func stopIO(aggregateID: UInt32)
  func destroyIO(aggregateID: UInt32)
  func destroyAggregate(_ aggregateID: UInt32)
  func destroyTap(_ tapID: UInt32)
}

protocol ProcessMetadataCalls: AnyObject {
  func processNode(pid: Int32) -> ProcessNode?
}

public final class CoreAudioTapPlatform: AudioTapPlatform {
  private let calls: CoreAudioCalls
  private let processMetadata: ProcessMetadataCalls
  private let resolver: CaptureScopeResolver
  private let maximumProcessAncestryDepth: Int
  private let identifier: String
  private let callbackLock = NSLock()
  private var ioCallbackActive = false

  public convenience init() {
    let maximumProcessAncestryDepth = 16
    self.init(
      calls: LiveCoreAudioCalls(),
      processMetadata: LiveProcessMetadataCalls(),
      resolver: CaptureScopeResolver(maximumAncestryDepth: maximumProcessAncestryDepth),
      maximumProcessAncestryDepth: maximumProcessAncestryDepth,
      identifier: UUID().uuidString
    )
  }

  convenience init(calls: CoreAudioCalls, identifier: String) {
    self.init(
      calls: calls,
      processMetadata: LiveProcessMetadataCalls(),
      resolver: CaptureScopeResolver(),
      identifier: identifier
    )
  }

  init(
    calls: CoreAudioCalls,
    processMetadata: ProcessMetadataCalls,
    resolver: CaptureScopeResolver,
    maximumProcessAncestryDepth: Int = 16,
    identifier: String
  ) {
    precondition(maximumProcessAncestryDepth > 0)
    self.calls = calls
    self.processMetadata = processMetadata
    self.resolver = resolver
    self.maximumProcessAncestryDepth = maximumProcessAncestryDepth
    self.identifier = identifier
  }

  public func createTap() throws -> UInt32 {
    try require(calls.createTap(), operation: "AudioHardwareCreateProcessTap")
  }

  public func tapUID(for tapID: UInt32) throws -> String {
    try require(
      calls.tapUID(for: tapID),
      operation: "AudioObjectGetPropertyData(tap UID)"
    )
  }

  public func tapFormat(for tapID: UInt32) throws -> TapFormat {
    try require(
      calls.tapFormat(for: tapID),
      operation: "AudioObjectGetPropertyData(tap format)"
    )
  }

  public func runningOutputDeviceUIDs() throws -> [String] {
    let processIDs = try require(
      calls.processIDs(),
      operation: "AudioObjectGetPropertyData(process IDs)"
    )
    var deviceIDs = [UInt32]()

    for processID in processIDs where processID != 0 {
      guard case .success(let running) = calls.isRunningOutput(processID: processID),
        running != 0
      else {
        continue
      }
      let discovered = try require(
        calls.outputDeviceIDs(processID: processID),
        operation: "AudioObjectGetPropertyData(output device IDs)"
      )
      deviceIDs.append(contentsOf: discovered.filter { $0 != 0 })
    }

    if deviceIDs.isEmpty {
      let defaultID = try require(
        calls.defaultOutputDeviceID(),
        operation: "AudioObjectGetPropertyData(default output)"
      )
      if defaultID != 0 {
        deviceIDs.append(defaultID)
      }
    }

    var seenDeviceIDs = Set<UInt32>()
    var seenUIDs = Set<String>()
    var deviceUIDs = [String]()
    for deviceID in deviceIDs where seenDeviceIDs.insert(deviceID).inserted {
      let uid = try require(
        calls.deviceUID(deviceID: deviceID),
        operation: "AudioObjectGetPropertyData(output UID)"
      )
      if !uid.isEmpty, seenUIDs.insert(uid).inserted {
        deviceUIDs.append(uid)
      }
    }
    return deviceUIDs
  }

  public func applicationCaptureInventory(
    generation: UInt64
  ) throws -> ApplicationCaptureInventory {
    let processIDs = try require(
      calls.processIDs(),
      operation: "AudioObjectGetPropertyData(process IDs)"
    )
    var observations = [AudioProcessObservation]()
    var coreAudioBundleIDByPID = [Int32: String]()
    var deviceUIDByID = [UInt32: String]()

    for processID in processIDs where processID != 0 {
      guard case .success(let running) = calls.isRunningOutput(processID: processID),
        running != 0,
        case .success(let pid) = calls.processPID(processID: processID),
        pid > 0
      else {
        continue
      }
      let deviceIDs = try require(
        calls.outputDeviceIDs(processID: processID),
        operation: "AudioObjectGetPropertyData(output device IDs)"
      )
      var deviceUIDs = [String]()
      for deviceID in deviceIDs where deviceID != 0 {
        let uid: String
        if let cached = deviceUIDByID[deviceID] {
          uid = cached
        } else {
          uid = try require(
            calls.deviceUID(deviceID: deviceID),
            operation: "AudioObjectGetPropertyData(output UID)"
          )
          deviceUIDByID[deviceID] = uid
        }
        deviceUIDs.append(uid)
      }
      if case .success(let bundleIdentifier) = calls.processBundleID(processID: processID) {
        coreAudioBundleIDByPID[pid] = bundleIdentifier
      }
      observations.append(
        AudioProcessObservation(
          objectID: processID,
          pid: pid,
          deviceUIDs: deviceUIDs
        )
      )
    }

    return resolver.inventory(
      generation: generation,
      audioProcesses: observations,
      processes: processNodes(
        for: observations,
        coreAudioBundleIDByPID: coreAudioBundleIDByPID
      )
    )
  }

  public func createAggregate(tapUID: String, outputDeviceUIDs: [String]) throws -> UInt32 {
    guard let mainSubdeviceUID = outputDeviceUIDs.first else {
      throw HelperError.missingOutputDevice
    }
    let plan = AggregateDevicePlan(
      name: "cue audio tap probe",
      uid: "com.cue.overlay.audio-tap-helper.\(identifier)",
      isPrivate: true,
      subdevices: outputDeviceUIDs.enumerated().map { index, uid in
        AggregateSubdevicePlan(uid: uid, driftCompensation: index != 0)
      },
      mainSubdeviceUID: mainSubdeviceUID,
      tapUID: tapUID
    )
    return try require(
      calls.createAggregate(plan: plan),
      operation: "AudioHardwareCreateAggregateDevice"
    )
  }

  public func createIO(
    aggregateID: UInt32,
    onPayload: @escaping (AudioPayload) -> Void
  ) throws {
    setCallbackActive(false)
    let result = calls.createIO(aggregateID: aggregateID) { [weak self] buffers in
      self?.record(buffers, onPayload: onPayload)
    }
    do {
      try require(result, operation: "AudioDeviceCreateIOProcID")
      setCallbackActive(true)
    } catch {
      setCallbackActive(false)
      throw error
    }
  }

  public func startIO(aggregateID: UInt32) throws {
    try require(calls.startIO(aggregateID: aggregateID), operation: "AudioDeviceStart")
  }

  public func stopIO(aggregateID: UInt32) {
    calls.stopIO(aggregateID: aggregateID)
  }

  public func destroyIO(aggregateID: UInt32) {
    setCallbackActive(false)
    calls.destroyIO(aggregateID: aggregateID)
  }

  public func destroyAggregate(_ aggregateID: UInt32) {
    calls.destroyAggregate(aggregateID)
  }

  public func destroyTap(_ tapID: UInt32) {
    calls.destroyTap(tapID)
  }

  private func require<Value>(
    _ result: CoreAudioResult<Value>,
    operation: String
  ) throws -> Value {
    switch result {
    case .success(let value):
      return value
    case .failure(let status):
      throw HelperError.operation(name: operation, status: status)
    }
  }

  private func setCallbackActive(_ active: Bool) {
    callbackLock.withLock {
      ioCallbackActive = active
    }
  }

  private func processNodes(
    for observations: [AudioProcessObservation],
    coreAudioBundleIDByPID: [Int32: String]
  ) -> [ProcessNode] {
    var nodes = [Int32: ProcessNode]()
    for observation in observations {
      var currentPID = observation.pid
      for _ in 0..<maximumProcessAncestryDepth {
        if nodes[currentPID] != nil {
          break
        }
        guard let discovered = processMetadata.processNode(pid: currentPID) else {
          break
        }
        let node = merged(
          discovered,
          coreAudioBundleIdentifier: currentPID == observation.pid
            ? coreAudioBundleIDByPID[currentPID] : nil
        )
        nodes[currentPID] = node
        if node.isCueOwned || node.isRegularApplication {
          break
        }
        guard let parentPID = node.parentPID else {
          break
        }
        currentPID = parentPID
      }
    }
    return Array(nodes.values)
  }

  private func merged(
    _ node: ProcessNode,
    coreAudioBundleIdentifier: String?
  ) -> ProcessNode {
    let bundleIdentifier =
      normalized(node.bundleIdentifier)
      ?? normalized(coreAudioBundleIdentifier)
    return ProcessNode(
      pid: node.pid,
      parentPID: node.parentPID,
      bundleIdentifier: bundleIdentifier,
      displayName: node.displayName,
      isRegularApplication: node.isRegularApplication,
      isCueOwned: node.isCueOwned || isCueBundle(bundleIdentifier)
    )
  }

  private func normalized(_ value: String?) -> String? {
    guard let value else {
      return nil
    }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func isCueBundle(_ bundleIdentifier: String?) -> Bool {
    bundleIdentifier == "com.cue.overlay"
      || bundleIdentifier?.hasPrefix("com.cue.overlay.") == true
  }

  private func record(_ buffers: [Data?]?, onPayload: (AudioPayload) -> Void) {
    callbackLock.lock()
    defer { callbackLock.unlock() }
    guard ioCallbackActive, let buffers else {
      return
    }
    for data in buffers.compactMap({ $0 }) {
      if let payload = AudioPayload(float32LE: data) {
        onPayload(payload)
      }
    }
  }
}
