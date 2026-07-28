import Foundation

public struct AudioProcessObservation: Equatable {
  public let objectID: UInt32
  public let pid: Int32
  public let deviceUIDs: [String]

  public init(objectID: UInt32, pid: Int32, deviceUIDs: [String]) {
    self.objectID = objectID
    self.pid = pid
    self.deviceUIDs = deviceUIDs
  }
}

public struct ProcessNode: Equatable {
  public let pid: Int32
  public let parentPID: Int32?
  public let bundleIdentifier: String?
  public let displayName: String?
  public let isRegularApplication: Bool
  public let isCueOwned: Bool

  public init(
    pid: Int32,
    parentPID: Int32?,
    bundleIdentifier: String? = nil,
    displayName: String? = nil,
    isRegularApplication: Bool = false,
    isCueOwned: Bool = false
  ) {
    self.pid = pid
    self.parentPID = parentPID
    self.bundleIdentifier = bundleIdentifier
    self.displayName = displayName
    self.isRegularApplication = isRegularApplication
    self.isCueOwned = isCueOwned
  }
}

public struct ResponsibleApplicationIdentity: Equatable, Hashable {
  public let pid: Int32
  public let bundleIdentifier: String
  public let displayName: String

  public init(pid: Int32, bundleIdentifier: String, displayName: String) {
    self.pid = pid
    self.bundleIdentifier = bundleIdentifier
    self.displayName = displayName
  }
}

public enum ApplicationSourceFailure: Error, Equatable {
  case cueOwnedAncestry
  case ancestryCycle
  case missingProcessMetadata
  case ancestryLimitExceeded
  case missingResponsibleIdentity
}

public enum ApplicationSourceStatus: Equatable {
  case available
  case unresolved(ApplicationSourceFailure)
}

public struct ApplicationCaptureSource: Equatable {
  public let identity: ResponsibleApplicationIdentity?
  public let status: ApplicationSourceStatus
  public let audioProcessObjectIDs: [UInt32]
  public let outputDeviceUIDs: [String]
  public let requiresBrowserWideAcknowledgement: Bool

  public init(
    identity: ResponsibleApplicationIdentity?,
    status: ApplicationSourceStatus,
    audioProcessObjectIDs: [UInt32],
    outputDeviceUIDs: [String],
    requiresBrowserWideAcknowledgement: Bool
  ) {
    self.identity = identity
    self.status = status
    self.audioProcessObjectIDs = audioProcessObjectIDs
    self.outputDeviceUIDs = outputDeviceUIDs
    self.requiresBrowserWideAcknowledgement = requiresBrowserWideAcknowledgement
  }
}

public struct ApplicationCaptureInventory: Equatable {
  public let generation: UInt64
  public let sources: [ApplicationCaptureSource]

  public init(generation: UInt64, sources: [ApplicationCaptureSource]) {
    self.generation = generation
    self.sources = sources
  }
}

public struct ApplicationScopeSelection: Equatable {
  public let inventoryGeneration: UInt64
  public let responsiblePID: Int32
  public let bundleIdentifier: String
  public let browserWideAcknowledged: Bool

  public init(
    inventoryGeneration: UInt64,
    responsiblePID: Int32,
    bundleIdentifier: String,
    browserWideAcknowledged: Bool
  ) {
    self.inventoryGeneration = inventoryGeneration
    self.responsiblePID = responsiblePID
    self.bundleIdentifier = bundleIdentifier
    self.browserWideAcknowledged = browserWideAcknowledged
  }
}

public struct VerifiedApplicationScope: Equatable {
  public let inventoryGeneration: UInt64
  public let identity: ResponsibleApplicationIdentity
  public let audioProcessObjectIDs: [UInt32]
  public let outputDeviceUIDs: [String]

  public init(
    inventoryGeneration: UInt64,
    identity: ResponsibleApplicationIdentity,
    audioProcessObjectIDs: [UInt32],
    outputDeviceUIDs: [String]
  ) {
    self.inventoryGeneration = inventoryGeneration
    self.identity = identity
    self.audioProcessObjectIDs = audioProcessObjectIDs
    self.outputDeviceUIDs = outputDeviceUIDs
  }
}

public enum CaptureScopeResolutionError: Error, Equatable {
  case staleInventory
  case sourceDisappeared
  case browserAcknowledgementRequired
  case missingOutputDevice
}

public struct CaptureScopeResolver {
  private struct Accumulator {
    let identity: ResponsibleApplicationIdentity
    var objectIDs = Set<UInt32>()
    var deviceUIDs = Set<String>()
  }

  private let maximumAncestryDepth: Int

  public init(maximumAncestryDepth: Int = 16) {
    precondition(maximumAncestryDepth > 0)
    self.maximumAncestryDepth = maximumAncestryDepth
  }

  public func inventory(
    generation: UInt64,
    audioProcesses: [AudioProcessObservation],
    processes: [ProcessNode]
  ) -> ApplicationCaptureInventory {
    var processByPID = [Int32: ProcessNode]()
    for process in processes {
      processByPID[process.pid] = process
    }

    var available = [ResponsibleApplicationIdentity: Accumulator]()
    var unresolved = [ApplicationCaptureSource]()
    for observation in audioProcesses {
      switch responsibleIdentity(for: observation.pid, processByPID: processByPID) {
      case .success(let identity):
        var accumulator = available[identity] ?? Accumulator(identity: identity)
        accumulator.objectIDs.insert(observation.objectID)
        accumulator.deviceUIDs.formUnion(normalizedDeviceUIDs(observation.deviceUIDs))
        available[identity] = accumulator
      case .failure(let failure):
        unresolved.append(
          ApplicationCaptureSource(
            identity: nil,
            status: .unresolved(failure),
            audioProcessObjectIDs: [observation.objectID],
            outputDeviceUIDs: normalizedDeviceUIDs(observation.deviceUIDs),
            requiresBrowserWideAcknowledgement: false
          )
        )
      }
    }

    let resolved = available.values.map { accumulator in
      ApplicationCaptureSource(
        identity: accumulator.identity,
        status: .available,
        audioProcessObjectIDs: accumulator.objectIDs.sorted(),
        outputDeviceUIDs: accumulator.deviceUIDs.sorted(),
        requiresBrowserWideAcknowledgement: isChrome(accumulator.identity.bundleIdentifier)
      )
    }
    let sources = (resolved + unresolved).sorted {
      $0.audioProcessObjectIDs[0] < $1.audioProcessObjectIDs[0]
    }
    return ApplicationCaptureInventory(generation: generation, sources: sources)
  }

  public func resolve(
    _ selection: ApplicationScopeSelection,
    in inventory: ApplicationCaptureInventory
  ) throws -> VerifiedApplicationScope {
    guard selection.inventoryGeneration == inventory.generation else {
      throw CaptureScopeResolutionError.staleInventory
    }
    guard
      let source = inventory.sources.first(where: { source in
        source.status == .available
          && source.identity?.pid == selection.responsiblePID
          && source.identity?.bundleIdentifier == selection.bundleIdentifier
      }),
      let identity = source.identity
    else {
      throw CaptureScopeResolutionError.sourceDisappeared
    }
    guard !source.requiresBrowserWideAcknowledgement || selection.browserWideAcknowledged else {
      throw CaptureScopeResolutionError.browserAcknowledgementRequired
    }
    guard !source.outputDeviceUIDs.isEmpty else {
      throw CaptureScopeResolutionError.missingOutputDevice
    }
    return VerifiedApplicationScope(
      inventoryGeneration: inventory.generation,
      identity: identity,
      audioProcessObjectIDs: source.audioProcessObjectIDs,
      outputDeviceUIDs: source.outputDeviceUIDs
    )
  }

  private func responsibleIdentity(
    for pid: Int32,
    processByPID: [Int32: ProcessNode]
  ) -> Result<ResponsibleApplicationIdentity, ApplicationSourceFailure> {
    var visited = Set<Int32>()
    var currentPID = pid
    for _ in 0..<maximumAncestryDepth {
      guard visited.insert(currentPID).inserted else {
        return .failure(.ancestryCycle)
      }
      guard let process = processByPID[currentPID] else {
        return .failure(.missingProcessMetadata)
      }
      guard !process.isCueOwned else {
        return .failure(.cueOwnedAncestry)
      }
      if process.isRegularApplication {
        guard
          let bundleIdentifier = normalized(process.bundleIdentifier),
          let displayName = normalized(process.displayName)
        else {
          return .failure(.missingResponsibleIdentity)
        }
        return .success(
          ResponsibleApplicationIdentity(
            pid: process.pid,
            bundleIdentifier: bundleIdentifier,
            displayName: displayName
          )
        )
      }
      guard let parentPID = process.parentPID else {
        return .failure(.missingResponsibleIdentity)
      }
      currentPID = parentPID
    }
    return .failure(.ancestryLimitExceeded)
  }

  private func normalized(_ value: String?) -> String? {
    guard let value else {
      return nil
    }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func normalizedDeviceUIDs(_ values: [String]) -> [String] {
    Set(values.compactMap(normalized)).sorted()
  }

  private func isChrome(_ bundleIdentifier: String) -> Bool {
    bundleIdentifier == "com.google.Chrome"
      || bundleIdentifier.hasPrefix("com.google.Chrome.")
  }
}
