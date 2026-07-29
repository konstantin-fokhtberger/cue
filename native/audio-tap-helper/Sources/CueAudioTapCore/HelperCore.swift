import Foundation

public enum HelperError: Error, CustomStringConvertible, Equatable {
  case operation(name: String, status: Int32)
  case missingTapUID
  case missingOutputDevice
  case missingAudioProcess
  case unsupportedFormat
  case invalidState
  case controlClosed
  case controlMessageTooLarge
  case invalidControlMessage
  case unexpectedControlData
  case applicationScopeInvalidated

  public var description: String {
    switch self {
    case .operation(let name, let status):
      return "\(name) failed with OSStatus \(status)"
    case .missingTapUID:
      return "The process tap did not expose a UID."
    case .missingOutputDevice:
      return "No output device is available for the process tap."
    case .missingAudioProcess:
      return "No audio process is available for the application tap."
    case .unsupportedFormat:
      return "The tap did not provide mono Float32 linear PCM."
    case .invalidState:
      return "The audio tap session is already active."
    case .controlClosed:
      return "The helper control channel closed before configuration."
    case .controlMessageTooLarge:
      return "The helper control message exceeded its byte limit."
    case .invalidControlMessage:
      return "The helper control message is invalid or unsupported."
    case .unexpectedControlData:
      return "The helper control channel received unexpected data."
    case .applicationScopeInvalidated:
      return "The selected application audio scope is no longer valid."
    }
  }
}

public struct TapFormat: Equatable {
  public let isLinearPCM: Bool
  public let isFloat: Bool
  public let bitsPerChannel: UInt32
  public let channelsPerFrame: UInt32
  public let sampleRate: Double

  public init(
    isLinearPCM: Bool,
    isFloat: Bool,
    bitsPerChannel: UInt32,
    channelsPerFrame: UInt32,
    sampleRate: Double
  ) {
    self.isLinearPCM = isLinearPCM
    self.isFloat = isFloat
    self.bitsPerChannel = bitsPerChannel
    self.channelsPerFrame = channelsPerFrame
    self.sampleRate = sampleRate
  }

  public func validatedSampleRate() throws -> Double {
    guard isLinearPCM, isFloat, bitsPerChannel == 32, channelsPerFrame == 1,
      sampleRate.isFinite, sampleRate > 0
    else {
      throw HelperError.unsupportedFormat
    }
    return sampleRate
  }
}

public struct SignalSnapshot: Equatable {
  public let callbacks: UInt64
  public let samples: UInt64
  public let nonzero: UInt64
  public let peak: Float

  public init(callbacks: UInt64, samples: UInt64, nonzero: UInt64, peak: Float) {
    self.callbacks = callbacks
    self.samples = samples
    self.nonzero = nonzero
    self.peak = peak
  }

  public static let zero = SignalSnapshot(callbacks: 0, samples: 0, nonzero: 0, peak: 0)
}

public struct AudioPayload {
  public let data: Data
  public let sampleCount: UInt64
  public let nonzeroCount: UInt64
  public let peak: Float

  public init(data: Data, sampleCount: UInt64, nonzeroCount: UInt64, peak: Float) {
    self.data = data
    self.sampleCount = sampleCount
    self.nonzeroCount = nonzeroCount
    self.peak = peak
  }

  public init?(float32LE data: Data) {
    guard data.count.isMultiple(of: MemoryLayout<Float>.stride) else {
      return nil
    }
    var nonzeroCount: UInt64 = 0
    var peak: Float = 0
    data.withUnsafeBytes { bytes in
      for sample in bytes.bindMemory(to: Float.self) {
        let absolute = abs(sample)
        if absolute > 0 {
          nonzeroCount += 1
        }
        if absolute > peak {
          peak = absolute
        }
      }
    }
    self.init(
      data: data,
      sampleCount: UInt64(data.count / MemoryLayout<Float>.stride),
      nonzeroCount: nonzeroCount,
      peak: peak
    )
  }
}

public final class BoundedSignalWriter {
  public typealias Scheduler = (@escaping () -> Void) -> Void

  private let lock = NSLock()
  private let maximumPendingBytes: Int
  private let scheduleWrite: Scheduler
  private let write: (Data) -> Void
  private var pendingBytes = 0
  private var snapshotValue = SignalSnapshot.zero

  public init(
    maximumPendingBytes: Int = 1_048_576,
    scheduleWrite: @escaping Scheduler,
    write: @escaping (Data) -> Void
  ) {
    precondition(maximumPendingBytes >= 0)
    self.maximumPendingBytes = maximumPendingBytes
    self.scheduleWrite = scheduleWrite
    self.write = write
  }

  @discardableResult
  public func accept(_ payload: AudioPayload) -> Bool {
    lock.lock()
    snapshotValue = SignalSnapshot(
      callbacks: snapshotValue.callbacks + 1,
      samples: snapshotValue.samples + payload.sampleCount,
      nonzero: snapshotValue.nonzero + payload.nonzeroCount,
      peak: max(snapshotValue.peak, payload.peak)
    )
    guard pendingBytes <= maximumPendingBytes - payload.data.count else {
      lock.unlock()
      return false
    }
    pendingBytes += payload.data.count
    lock.unlock()

    scheduleWrite { [self] in
      write(payload.data)
      lock.lock()
      pendingBytes -= payload.data.count
      lock.unlock()
    }
    return true
  }

  public func snapshot() -> SignalSnapshot {
    lock.withLock { snapshotValue }
  }

  public func currentPendingBytes() -> Int {
    lock.withLock { pendingBytes }
  }
}

public protocol AudioTapPlatform: AnyObject {
  func createTap() throws -> UInt32
  func createApplicationTap(processObjectIDs: [UInt32]) throws -> UInt32
  func verifyApplicationScope(
    _ selection: ApplicationScopeSelection
  ) throws -> VerifiedApplicationScope
  func tapUID(for tapID: UInt32) throws -> String
  func tapFormat(for tapID: UInt32) throws -> TapFormat
  func runningOutputDeviceUIDs() throws -> [String]
  func createAggregate(tapUID: String, outputDeviceUIDs: [String]) throws -> UInt32
  func createIO(
    aggregateID: UInt32,
    onPayload: @escaping (AudioPayload) -> Void
  ) throws
  func startIO(aggregateID: UInt32) throws
  func stopIO(aggregateID: UInt32)
  func destroyIO(aggregateID: UInt32)
  func destroyAggregate(_ aggregateID: UInt32)
  func destroyTap(_ tapID: UInt32)
}

public protocol AudioSession: AnyObject {
  func start() throws -> Double
  func start(scope: CaptureScope) throws -> CaptureStart
  func scopeIsValid() -> Bool
  func stop()
  func drain()
  func snapshot() -> SignalSnapshot
}

public enum EffectiveCaptureScope: Equatable {
  case diagnosticGlobal
  case application(VerifiedApplicationScope)
}

public struct CaptureStart: Equatable {
  public let sampleRate: Double
  public let scope: EffectiveCaptureScope

  public init(sampleRate: Double, scope: EffectiveCaptureScope) {
    self.sampleRate = sampleRate
    self.scope = scope
  }
}

public final class AudioTapSession: AudioSession {
  private let platform: AudioTapPlatform
  private let writer: BoundedSignalWriter
  private let drainWrites: () -> Void
  private var tapID: UInt32?
  private var aggregateID: UInt32?
  private var ioCreated = false
  private var ioStarted = false
  private var applicationSelection: ApplicationScopeSelection?
  private var verifiedApplicationScope: VerifiedApplicationScope?

  public init(
    platform: AudioTapPlatform,
    writer: BoundedSignalWriter,
    drainWrites: @escaping () -> Void
  ) {
    self.platform = platform
    self.writer = writer
    self.drainWrites = drainWrites
  }

  deinit {
    stop()
  }

  public func start() throws -> Double {
    try requireIdle()
    return try startDiagnostic()
  }

  public func start(scope: CaptureScope) throws -> CaptureStart {
    try requireIdle()
    switch scope {
    case .diagnosticGlobal:
      return CaptureStart(sampleRate: try startDiagnostic(), scope: .diagnosticGlobal)
    case .application(let selection):
      let verifiedScope = try platform.verifyApplicationScope(selection)
      let createdTapID = try platform.createApplicationTap(
        processObjectIDs: verifiedScope.audioProcessObjectIDs
      )
      let sampleRate = try start(
        createdTapID: createdTapID,
        outputDeviceUIDs: verifiedScope.outputDeviceUIDs
      )
      applicationSelection = selection
      verifiedApplicationScope = verifiedScope
      return CaptureStart(
        sampleRate: sampleRate,
        scope: .application(verifiedScope)
      )
    }
  }

  private func startDiagnostic() throws -> Double {
    do {
      let createdTapID = try platform.createTap()
      return try start(createdTapID: createdTapID, outputDeviceUIDs: nil)
    } catch {
      stop()
      throw error
    }
  }

  private func requireIdle() throws {
    guard tapID == nil, aggregateID == nil, !ioCreated, !ioStarted else {
      throw HelperError.invalidState
    }
  }

  private func start(createdTapID: UInt32, outputDeviceUIDs: [String]?) throws -> Double {
    do {
      tapID = createdTapID
      let tapUID = try platform.tapUID(for: createdTapID)
      guard !tapUID.isEmpty else {
        throw HelperError.missingTapUID
      }
      let sampleRate = try platform.tapFormat(for: createdTapID).validatedSampleRate()
      let outputDeviceUIDs = try outputDeviceUIDs ?? platform.runningOutputDeviceUIDs()
      guard !outputDeviceUIDs.isEmpty else {
        throw HelperError.missingOutputDevice
      }
      let createdAggregateID = try platform.createAggregate(
        tapUID: tapUID,
        outputDeviceUIDs: outputDeviceUIDs
      )
      aggregateID = createdAggregateID
      try platform.createIO(aggregateID: createdAggregateID) { [writer] payload in
        writer.accept(payload)
      }
      ioCreated = true
      try platform.startIO(aggregateID: createdAggregateID)
      ioStarted = true
      return sampleRate
    } catch {
      stop()
      throw error
    }
  }

  public func stop() {
    applicationSelection = nil
    verifiedApplicationScope = nil
    if ioStarted, let aggregateID {
      platform.stopIO(aggregateID: aggregateID)
      ioStarted = false
    }
    if ioCreated, let aggregateID {
      platform.destroyIO(aggregateID: aggregateID)
      ioCreated = false
    }
    if let aggregateID {
      platform.destroyAggregate(aggregateID)
      self.aggregateID = nil
    }
    if let tapID {
      platform.destroyTap(tapID)
      self.tapID = nil
    }
  }

  public func drain() {
    drainWrites()
  }

  public func snapshot() -> SignalSnapshot {
    writer.snapshot()
  }

  public func scopeIsValid() -> Bool {
    guard let applicationSelection, let verifiedApplicationScope else {
      return true
    }
    return (try? platform.verifyApplicationScope(applicationSelection)) == verifiedApplicationScope
  }
}

public enum HelperEvent: Equatable {
  case started(sampleRate: Double, scope: EffectiveCaptureScope)
  case stopped(metrics: SignalSnapshot)
  case inventory(ApplicationCaptureInventory)
  case error(message: String)
}

public struct HelperEventEncoder {
  public init() {}

  public func encodeLine(_ event: HelperEvent) throws -> Data {
    let object: [String: Any]
    switch event {
    case .started(let sampleRate, let scope):
      object = [
        "channels": 1,
        "event": "started",
        "format": "float32le",
        "sampleRate": sampleRate,
        "scope": encodeEffectiveScope(scope),
      ]
    case .stopped(let metrics):
      object = [
        "event": "stopped",
        "metrics": [
          "callbacks": metrics.callbacks,
          "samples": metrics.samples,
          "nonzero": metrics.nonzero,
          "peak": metrics.peak,
        ],
      ]
    case .inventory(let inventory):
      object = [
        "event": "inventory",
        "generation": inventory.generation,
        "sources": inventory.sources.map(encodeInventorySource),
      ]
    case .error(let message):
      object = ["event": "error", "message": message]
    }
    var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    data.append(0x0A)
    return data
  }

  private func encodeEffectiveScope(_ scope: EffectiveCaptureScope) -> [String: Any] {
    switch scope {
    case .diagnosticGlobal:
      return ["kind": "diagnostic-global", "verified": false]
    case .application(let value):
      return [
        "bundleIdentifier": value.identity.bundleIdentifier,
        "displayName": value.identity.displayName,
        "inventoryGeneration": value.inventoryGeneration,
        "kind": "application",
        "responsiblePid": value.identity.pid,
        "verified": true,
      ]
    }
  }

  private func encodeInventorySource(_ source: ApplicationCaptureSource) -> [String: Any] {
    let identity: Any
    if let value = source.identity {
      identity = [
        "bundleIdentifier": value.bundleIdentifier,
        "displayName": value.displayName,
        "pid": value.pid,
      ]
    } else {
      identity = NSNull()
    }
    let status: String
    let failure: Any
    switch source.status {
    case .available:
      status = "available"
      failure = NSNull()
    case .unresolved(let value):
      status = "unresolved"
      failure = encodeFailure(value)
    }
    return [
      "audioProcessObjectIds": source.audioProcessObjectIDs,
      "failure": failure,
      "identity": identity,
      "outputDeviceUids": source.outputDeviceUIDs,
      "requiresBrowserWideAcknowledgement": source.requiresBrowserWideAcknowledgement,
      "status": status,
    ]
  }

  private func encodeFailure(_ failure: ApplicationSourceFailure) -> String {
    switch failure {
    case .cueOwnedAncestry:
      "cue-owned-ancestry"
    case .ancestryCycle:
      "ancestry-cycle"
    case .missingProcessMetadata:
      "missing-process-metadata"
    case .ancestryLimitExceeded:
      "ancestry-limit-exceeded"
    case .missingResponsibleIdentity:
      "missing-responsible-identity"
    }
  }
}

public final class HelperRunner {
  private let session: AudioSession
  private let termination: HelperControlling
  private let inventory: (UInt64) throws -> ApplicationCaptureInventory
  private let encode: (HelperEvent) throws -> Data
  private let writeEvent: (Data) throws -> Void

  public init(
    session: AudioSession,
    termination: HelperControlling,
    inventory: @escaping (UInt64) throws -> ApplicationCaptureInventory = {
      _ in throw HelperError.invalidState
    },
    encode: @escaping (HelperEvent) throws -> Data = HelperEventEncoder().encodeLine,
    writeEvent: @escaping (Data) throws -> Void
  ) {
    self.session = session
    self.termination = termination
    self.inventory = inventory
    self.encode = encode
    self.writeEvent = writeEvent
  }

  public func run() -> Int32 {
    do {
      let configuration = try termination.readConfiguration()
      switch configuration {
      case .capture(_, let scope):
        let started = try session.start(scope: scope)
        try writeEvent(encode(.started(sampleRate: started.sampleRate, scope: started.scope)))
        try termination.wait()
        session.stop()
        session.drain()
        try writeEvent(encode(.stopped(metrics: session.snapshot())))
        return 0
      case .inventory(_, let generation):
        try writeEvent(encode(.inventory(try inventory(generation))))
        return 0
      }
    } catch {
      session.stop()
      if let payload = try? encode(.error(message: String(describing: error))) {
        try? writeEvent(payload)
      }
      return 1
    }
  }
}
