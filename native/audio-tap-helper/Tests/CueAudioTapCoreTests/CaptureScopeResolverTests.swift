import CueAudioTapCore
import XCTest

final class CaptureScopeResolverTests: XCTestCase {
  private let resolver = CaptureScopeResolver(maximumAncestryDepth: 8)

  func testInventoryAttributesHelpersToRegularResponsibleApplicationsAndKeepsInstancesDistinct()
    throws
  {
    let inventory = resolver.inventory(
      generation: 41,
      audioProcesses: [
        AudioProcessObservation(objectID: 101, pid: 1_001, deviceUIDs: ["sony"]),
        AudioProcessObservation(objectID: 102, pid: 1_002, deviceUIDs: ["sony", "sony"]),
        AudioProcessObservation(objectID: 201, pid: 2_001, deviceUIDs: ["display"]),
      ],
      processes: [
        ProcessNode(pid: 1_001, parentPID: 1_000, bundleIdentifier: "com.google.Chrome.helper"),
        ProcessNode(pid: 1_002, parentPID: 1_000, bundleIdentifier: "com.google.Chrome.helper"),
        ProcessNode(
          pid: 1_000,
          parentPID: 1,
          bundleIdentifier: "com.google.Chrome",
          displayName: "Google Chrome",
          isRegularApplication: true
        ),
        ProcessNode(pid: 2_001, parentPID: 2_000, bundleIdentifier: "com.google.Chrome.helper"),
        ProcessNode(
          pid: 2_000,
          parentPID: 1,
          bundleIdentifier: "com.google.Chrome",
          displayName: "Google Chrome",
          isRegularApplication: true
        ),
      ]
    )

    XCTAssertEqual(inventory.generation, 41)
    XCTAssertEqual(
      inventory.sources,
      [
        ApplicationCaptureSource(
          identity: ResponsibleApplicationIdentity(
            pid: 1_000,
            bundleIdentifier: "com.google.Chrome",
            displayName: "Google Chrome"
          ),
          status: .available,
          audioProcessObjectIDs: [101, 102],
          outputDeviceUIDs: ["sony"],
          requiresBrowserWideAcknowledgement: true
        ),
        ApplicationCaptureSource(
          identity: ResponsibleApplicationIdentity(
            pid: 2_000,
            bundleIdentifier: "com.google.Chrome",
            displayName: "Google Chrome"
          ),
          status: .available,
          audioProcessObjectIDs: [201],
          outputDeviceUIDs: ["display"],
          requiresBrowserWideAcknowledgement: true
        ),
      ]
    )
  }

  func testInventoryExcludesCueAncestryAndReportsUnresolvedGraphFailures() {
    let inventory = resolver.inventory(
      generation: 7,
      audioProcesses: [
        AudioProcessObservation(objectID: 10, pid: 10, deviceUIDs: []),
        AudioProcessObservation(objectID: 20, pid: 20, deviceUIDs: []),
        AudioProcessObservation(objectID: 30, pid: 30, deviceUIDs: []),
        AudioProcessObservation(objectID: 40, pid: 40, deviceUIDs: []),
        AudioProcessObservation(objectID: 50, pid: 50, deviceUIDs: []),
      ],
      processes: [
        ProcessNode(pid: 10, parentPID: 11, isCueOwned: true),
        ProcessNode(pid: 20, parentPID: 21),
        ProcessNode(pid: 21, parentPID: 20),
        ProcessNode(pid: 30, parentPID: 31),
        ProcessNode(pid: 40, parentPID: 41),
        ProcessNode(pid: 41, parentPID: 42),
        ProcessNode(pid: 42, parentPID: 43),
        ProcessNode(pid: 43, parentPID: 44),
        ProcessNode(pid: 44, parentPID: 45),
        ProcessNode(pid: 45, parentPID: 46),
        ProcessNode(pid: 46, parentPID: 47),
        ProcessNode(pid: 47, parentPID: 48),
        ProcessNode(pid: 50, parentPID: nil),
      ]
    )

    XCTAssertEqual(
      inventory.sources.map(\.audioProcessObjectIDs),
      [[10], [20], [30], [40], [50]]
    )
    XCTAssertEqual(
      inventory.sources.map(\.status),
      [
        .unresolved(.cueOwnedAncestry),
        .unresolved(.ancestryCycle),
        .unresolved(.missingProcessMetadata),
        .unresolved(.ancestryLimitExceeded),
        .unresolved(.missingResponsibleIdentity),
      ]
    )
    XCTAssertTrue(inventory.sources.allSatisfy { $0.identity == nil })
  }

  func testInventoryRejectsRegularApplicationsWithoutStableIdentityAndNormalizesFields() {
    let inventory = resolver.inventory(
      generation: 1,
      audioProcesses: [
        AudioProcessObservation(
          objectID: 2,
          pid: 2,
          deviceUIDs: [" output-b ", "", "output-a", "output-b"]
        ),
        AudioProcessObservation(objectID: 1, pid: 1, deviceUIDs: []),
        AudioProcessObservation(objectID: 3, pid: 3, deviceUIDs: []),
      ],
      processes: [
        ProcessNode(
          pid: 1,
          parentPID: nil,
          bundleIdentifier: " ",
          displayName: "No identity",
          isRegularApplication: true
        ),
        ProcessNode(
          pid: 2,
          parentPID: nil,
          bundleIdentifier: " us.zoom.xos ",
          displayName: " zoom.us ",
          isRegularApplication: true
        ),
        ProcessNode(
          pid: 3,
          parentPID: nil,
          bundleIdentifier: nil,
          displayName: "Missing bundle",
          isRegularApplication: true
        ),
      ]
    )

    XCTAssertEqual(
      inventory.sources,
      [
        ApplicationCaptureSource(
          identity: nil,
          status: .unresolved(.missingResponsibleIdentity),
          audioProcessObjectIDs: [1],
          outputDeviceUIDs: [],
          requiresBrowserWideAcknowledgement: false
        ),
        ApplicationCaptureSource(
          identity: ResponsibleApplicationIdentity(
            pid: 2,
            bundleIdentifier: "us.zoom.xos",
            displayName: "zoom.us"
          ),
          status: .available,
          audioProcessObjectIDs: [2],
          outputDeviceUIDs: ["output-a", "output-b"],
          requiresBrowserWideAcknowledgement: false
        ),
        ApplicationCaptureSource(
          identity: nil,
          status: .unresolved(.missingResponsibleIdentity),
          audioProcessObjectIDs: [3],
          outputDeviceUIDs: [],
          requiresBrowserWideAcknowledgement: false
        ),
      ]
    )
  }

  func testSelectionRequiresCurrentGenerationExactInstanceAndBrowserAcknowledgement() throws {
    let inventory = resolver.inventory(
      generation: 9,
      audioProcesses: [
        AudioProcessObservation(objectID: 5, pid: 50, deviceUIDs: ["sony"])
      ],
      processes: [
        ProcessNode(
          pid: 50,
          parentPID: 1,
          bundleIdentifier: "com.google.Chrome",
          displayName: "Google Chrome",
          isRegularApplication: true
        )
      ]
    )
    let selection = ApplicationScopeSelection(
      inventoryGeneration: 9,
      responsiblePID: 50,
      bundleIdentifier: "com.google.Chrome",
      browserWideAcknowledged: true
    )

    XCTAssertEqual(
      try resolver.resolve(selection, in: inventory),
      VerifiedApplicationScope(
        inventoryGeneration: 9,
        identity: ResponsibleApplicationIdentity(
          pid: 50,
          bundleIdentifier: "com.google.Chrome",
          displayName: "Google Chrome"
        ),
        audioProcessObjectIDs: [5],
        outputDeviceUIDs: ["sony"]
      )
    )

    XCTAssertThrowsError(
      try resolver.resolve(
        ApplicationScopeSelection(
          inventoryGeneration: 8,
          responsiblePID: 50,
          bundleIdentifier: "com.google.Chrome",
          browserWideAcknowledged: true
        ),
        in: inventory
      )
    ) { XCTAssertEqual($0 as? CaptureScopeResolutionError, .staleInventory) }

    XCTAssertThrowsError(
      try resolver.resolve(
        ApplicationScopeSelection(
          inventoryGeneration: 9,
          responsiblePID: 51,
          bundleIdentifier: "com.google.Chrome",
          browserWideAcknowledged: true
        ),
        in: inventory
      )
    ) { XCTAssertEqual($0 as? CaptureScopeResolutionError, .sourceDisappeared) }

    XCTAssertThrowsError(
      try resolver.resolve(
        ApplicationScopeSelection(
          inventoryGeneration: 9,
          responsiblePID: 50,
          bundleIdentifier: "com.google.Chrome.beta",
          browserWideAcknowledged: true
        ),
        in: inventory
      )
    ) { XCTAssertEqual($0 as? CaptureScopeResolutionError, .sourceDisappeared) }

    XCTAssertThrowsError(
      try resolver.resolve(
        ApplicationScopeSelection(
          inventoryGeneration: 9,
          responsiblePID: 50,
          bundleIdentifier: "com.google.Chrome",
          browserWideAcknowledged: false
        ),
        in: inventory
      )
    ) { XCTAssertEqual($0 as? CaptureScopeResolutionError, .browserAcknowledgementRequired) }
  }

  func testSelectionRejectsAnApplicationWithoutAnAssociatedOutputDevice() {
    let inventory = resolver.inventory(
      generation: 2,
      audioProcesses: [AudioProcessObservation(objectID: 7, pid: 70, deviceUIDs: [])],
      processes: [
        ProcessNode(
          pid: 70,
          parentPID: nil,
          bundleIdentifier: "us.zoom.xos",
          displayName: "zoom.us",
          isRegularApplication: true
        )
      ]
    )

    XCTAssertThrowsError(
      try resolver.resolve(
        ApplicationScopeSelection(
          inventoryGeneration: 2,
          responsiblePID: 70,
          bundleIdentifier: "us.zoom.xos",
          browserWideAcknowledged: false
        ),
        in: inventory
      )
    ) { XCTAssertEqual($0 as? CaptureScopeResolutionError, .missingOutputDevice) }
  }

  func testChromeVariantRequiresBrowserWideAcknowledgement() {
    let inventory = resolver.inventory(
      generation: 3,
      audioProcesses: [AudioProcessObservation(objectID: 8, pid: 80, deviceUIDs: ["sony"])],
      processes: [
        ProcessNode(
          pid: 80,
          parentPID: nil,
          bundleIdentifier: "com.google.Chrome.beta",
          displayName: "Google Chrome Beta",
          isRegularApplication: true
        )
      ]
    )

    XCTAssertTrue(inventory.sources[0].requiresBrowserWideAcknowledgement)
  }
}
