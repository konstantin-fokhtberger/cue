import CueAudioTapCore
import Foundation
import XCTest

@testable import CueAudioTapPlatform

private final class FakeCoreAudioCalls: CoreAudioCalls {
  var createTapResult: CoreAudioResult<UInt32> = .success(11)
  var tapUIDResult: CoreAudioResult<String> = .success("tap-uid")
  var tapFormatResult: CoreAudioResult<TapFormat> = .success(
    TapFormat(
      isLinearPCM: true,
      isFloat: true,
      bitsPerChannel: 32,
      channelsPerFrame: 1,
      sampleRate: 48_000
    )
  )
  var processIDsResult: CoreAudioResult<[UInt32]> = .success([])
  var processPIDResults = [UInt32: CoreAudioResult<Int32>]()
  var processBundleIDResults = [UInt32: CoreAudioResult<String>]()
  var runningResults = [UInt32: CoreAudioResult<UInt32>]()
  var deviceResults = [UInt32: CoreAudioResult<[UInt32]>]()
  var defaultDeviceResult: CoreAudioResult<UInt32> = .success(99)
  var deviceUIDResults = [UInt32: CoreAudioResult<String>]()
  var aggregateResult: CoreAudioResult<UInt32> = .success(22)
  var createIOResult: CoreAudioResult<Void> = .success(())
  var startIOResult: CoreAudioResult<Void> = .success(())
  var operations = [String]()
  var aggregatePlan: AggregateDevicePlan?
  var bufferHandler: (([Data?]?) -> Void)?

  func createTap() -> CoreAudioResult<UInt32> {
    operations.append("createTap")
    return createTapResult
  }

  func createApplicationTap(processObjectIDs: [UInt32]) -> CoreAudioResult<UInt32> {
    operations.append(
      "createApplicationTap:\(processObjectIDs.map(String.init).joined(separator: ","))"
    )
    return createTapResult
  }

  func tapUID(for tapID: UInt32) -> CoreAudioResult<String> {
    operations.append("tapUID:\(tapID)")
    return tapUIDResult
  }

  func tapFormat(for tapID: UInt32) -> CoreAudioResult<TapFormat> {
    operations.append("tapFormat:\(tapID)")
    return tapFormatResult
  }

  func processIDs() -> CoreAudioResult<[UInt32]> {
    operations.append("processIDs")
    return processIDsResult
  }

  func processPID(processID: UInt32) -> CoreAudioResult<Int32> {
    operations.append("processPID:\(processID)")
    return processPIDResults[processID] ?? .failure(-1)
  }

  func processBundleID(processID: UInt32) -> CoreAudioResult<String> {
    operations.append("processBundleID:\(processID)")
    return processBundleIDResults[processID] ?? .success("")
  }

  func isRunningOutput(processID: UInt32) -> CoreAudioResult<UInt32> {
    operations.append("isRunning:\(processID)")
    return runningResults[processID] ?? .success(0)
  }

  func outputDeviceIDs(processID: UInt32) -> CoreAudioResult<[UInt32]> {
    operations.append("devices:\(processID)")
    return deviceResults[processID] ?? .success([])
  }

  func defaultOutputDeviceID() -> CoreAudioResult<UInt32> {
    operations.append("defaultDevice")
    return defaultDeviceResult
  }

  func deviceUID(deviceID: UInt32) -> CoreAudioResult<String> {
    operations.append("deviceUID:\(deviceID)")
    return deviceUIDResults[deviceID] ?? .success("")
  }

  func createAggregate(plan: AggregateDevicePlan) -> CoreAudioResult<UInt32> {
    operations.append("createAggregate")
    aggregatePlan = plan
    return aggregateResult
  }

  func createIO(
    aggregateID: UInt32,
    onBuffers: @escaping ([Data?]?) -> Void
  ) -> CoreAudioResult<Void> {
    operations.append("createIO:\(aggregateID)")
    bufferHandler = onBuffers
    return createIOResult
  }

  func startIO(aggregateID: UInt32) -> CoreAudioResult<Void> {
    operations.append("startIO:\(aggregateID)")
    return startIOResult
  }

  func stopIO(aggregateID: UInt32) {
    operations.append("stopIO:\(aggregateID)")
  }

  func destroyIO(aggregateID: UInt32) {
    operations.append("destroyIO:\(aggregateID)")
    bufferHandler = nil
  }

  func destroyAggregate(_ aggregateID: UInt32) {
    operations.append("destroyAggregate:\(aggregateID)")
  }

  func destroyTap(_ tapID: UInt32) {
    operations.append("destroyTap:\(tapID)")
  }
}

private final class FakeProcessMetadataCalls: ProcessMetadataCalls {
  var nodes = [Int32: ProcessNode]()
  var requestedPIDs = [Int32]()

  func processNode(pid: Int32) -> ProcessNode? {
    requestedPIDs.append(pid)
    return nodes[pid]
  }
}

final class CoreAudioTapPlatformTests: XCTestCase {
  func testDefaultInitializerCreatesLiveBoundaryWithoutCallingCoreAudio() {
    _ = CoreAudioTapPlatform()
  }

  func testDirectOperationsReturnValuesAndMapFailures() throws {
    let calls = FakeCoreAudioCalls()
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")

    XCTAssertEqual(try platform.createTap(), 11)
    XCTAssertEqual(try platform.tapUID(for: 11), "tap-uid")
    XCTAssertEqual(try platform.tapFormat(for: 11).sampleRate, 48_000)

    calls.createTapResult = .failure(-50)
    XCTAssertThrowsError(try platform.createTap()) {
      XCTAssertEqual(
        $0 as? HelperError,
        .operation(name: "AudioHardwareCreateProcessTap", status: -50)
      )
    }
    calls.tapUIDResult = .failure(-51)
    XCTAssertThrowsError(try platform.tapUID(for: 11)) {
      XCTAssertEqual(
        $0 as? HelperError,
        .operation(name: "AudioObjectGetPropertyData(tap UID)", status: -51)
      )
    }
    calls.tapFormatResult = .failure(-52)
    XCTAssertThrowsError(try platform.tapFormat(for: 11)) {
      XCTAssertEqual(
        $0 as? HelperError,
        .operation(name: "AudioObjectGetPropertyData(tap format)", status: -52)
      )
    }
  }

  func testApplicationTapRequiresAnExactNonemptyInclusionSetAndMapsFailures() throws {
    let calls = FakeCoreAudioCalls()
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")

    XCTAssertEqual(try platform.createApplicationTap(processObjectIDs: [101, 102]), 11)
    XCTAssertEqual(calls.operations, ["createApplicationTap:101,102"])

    XCTAssertThrowsError(try platform.createApplicationTap(processObjectIDs: [])) {
      XCTAssertEqual($0 as? HelperError, .missingAudioProcess)
    }
    XCTAssertEqual(calls.operations, ["createApplicationTap:101,102"])

    calls.createTapResult = .failure(-53)
    XCTAssertThrowsError(try platform.createApplicationTap(processObjectIDs: [101])) {
      XCTAssertEqual(
        $0 as? HelperError,
        .operation(name: "AudioHardwareCreateProcessTap(application)", status: -53)
      )
    }
  }

  func testApplicationVerificationUsesAFreshInventoryForTheRequestedGeneration() throws {
    let calls = FakeCoreAudioCalls()
    calls.processIDsResult = .success([101])
    calls.runningResults = [101: .success(1)]
    calls.processPIDResults = [101: .success(2_001)]
    calls.processBundleIDResults = [101: .success("us.zoom.xos.helper")]
    calls.deviceResults = [101: .success([31])]
    calls.deviceUIDResults = [31: .success("sony")]
    let metadata = FakeProcessMetadataCalls()
    metadata.nodes = [
      2_001: ProcessNode(pid: 2_001, parentPID: 2_000),
      2_000: ProcessNode(
        pid: 2_000,
        parentPID: 1,
        bundleIdentifier: "us.zoom.xos",
        displayName: "zoom.us",
        isRegularApplication: true
      ),
    ]
    let platform = CoreAudioTapPlatform(
      calls: calls,
      processMetadata: metadata,
      resolver: CaptureScopeResolver(),
      identifier: "fixed-id"
    )

    XCTAssertEqual(
      try platform.verifyApplicationScope(
        ApplicationScopeSelection(
          inventoryGeneration: 42,
          responsiblePID: 2_000,
          bundleIdentifier: "us.zoom.xos",
          browserWideAcknowledged: false
        )
      ),
      VerifiedApplicationScope(
        inventoryGeneration: 42,
        identity: ResponsibleApplicationIdentity(
          pid: 2_000,
          bundleIdentifier: "us.zoom.xos",
          displayName: "zoom.us"
        ),
        audioProcessObjectIDs: [101],
        outputDeviceUIDs: ["sony"]
      )
    )
    XCTAssertEqual(calls.operations.first, "processIDs")
  }

  func testRunningDevicesFilterProcessesUnknownIDsEmptyUIDsAndDuplicates() throws {
    let calls = FakeCoreAudioCalls()
    calls.processIDsResult = .success([0, 1, 2, 3, 4])
    calls.runningResults = [
      1: .failure(-1),
      2: .success(0),
      3: .success(1),
      4: .success(2),
    ]
    calls.deviceResults = [
      3: .success([0, 30, 31]),
      4: .success([31, 32]),
    ]
    calls.deviceUIDResults = [
      30: .success("sony"),
      31: .success(""),
      32: .success("sony"),
    ]
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")

    XCTAssertEqual(try platform.runningOutputDeviceUIDs(), ["sony"])
    XCTAssertFalse(calls.operations.contains("isRunning:0"))
    XCTAssertFalse(calls.operations.contains("deviceUID:0"))
    XCTAssertFalse(calls.operations.contains("defaultDevice"))
    XCTAssertEqual(calls.operations.filter { $0 == "deviceUID:31" }.count, 1)
  }

  func testNoRunningDeviceFallsBackToDefaultOutput() throws {
    let calls = FakeCoreAudioCalls()
    calls.processIDsResult = .success([1])
    calls.runningResults = [1: .success(0)]
    calls.defaultDeviceResult = .success(40)
    calls.deviceUIDResults = [40: .success("default-output")]
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")

    XCTAssertEqual(try platform.runningOutputDeviceUIDs(), ["default-output"])
  }

  func testUnknownDefaultDeviceProducesNoUIDLookup() throws {
    let calls = FakeCoreAudioCalls()
    calls.defaultDeviceResult = .success(0)
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")

    XCTAssertEqual(try platform.runningOutputDeviceUIDs(), [])
    XCTAssertFalse(calls.operations.contains("deviceUID:0"))
  }

  func testRequiredDiscoveryFailuresAreMapped() {
    let cases: [(FakeCoreAudioCalls, String, () throws -> Void)] = [
      {
        let calls = FakeCoreAudioCalls()
        calls.processIDsResult = .failure(-10)
        let platform = CoreAudioTapPlatform(calls: calls, identifier: "id")
        return (
          calls, "AudioObjectGetPropertyData(process IDs)",
          {
            _ = try platform.runningOutputDeviceUIDs()
          }
        )
      }(),
      {
        let calls = FakeCoreAudioCalls()
        calls.processIDsResult = .success([1])
        calls.runningResults = [1: .success(1)]
        calls.deviceResults = [1: .failure(-11)]
        let platform = CoreAudioTapPlatform(calls: calls, identifier: "id")
        return (
          calls, "AudioObjectGetPropertyData(output device IDs)",
          {
            _ = try platform.runningOutputDeviceUIDs()
          }
        )
      }(),
      {
        let calls = FakeCoreAudioCalls()
        calls.defaultDeviceResult = .failure(-12)
        let platform = CoreAudioTapPlatform(calls: calls, identifier: "id")
        return (
          calls, "AudioObjectGetPropertyData(default output)",
          {
            _ = try platform.runningOutputDeviceUIDs()
          }
        )
      }(),
      {
        let calls = FakeCoreAudioCalls()
        calls.defaultDeviceResult = .success(1)
        calls.deviceUIDResults = [1: .failure(-13)]
        let platform = CoreAudioTapPlatform(calls: calls, identifier: "id")
        return (
          calls, "AudioObjectGetPropertyData(output UID)",
          {
            _ = try platform.runningOutputDeviceUIDs()
          }
        )
      }(),
    ]

    for (_, operation, execute) in cases {
      XCTAssertThrowsError(try execute()) {
        guard case .operation(let name, _) = $0 as? HelperError else {
          return XCTFail("Expected HelperError.operation, received \($0)")
        }
        XCTAssertEqual(name, operation)
      }
    }
  }

  func testApplicationInventoryComposesRunningCoreAudioProcessesWithResponsibleApplications()
    throws
  {
    let calls = FakeCoreAudioCalls()
    calls.processIDsResult = .success([0, 101, 102, 201, 301, 401])
    calls.runningResults = [
      101: .success(1),
      102: .success(1),
      201: .success(2),
      301: .failure(-30),
      401: .success(0),
    ]
    calls.processPIDResults = [
      101: .success(1_001),
      102: .success(1_002),
      201: .success(2_001),
    ]
    calls.processBundleIDResults = [
      101: .success("com.google.Chrome.helper"),
      102: .success("com.google.Chrome.helper"),
      201: .success("com.google.Chrome.helper"),
    ]
    calls.deviceResults = [
      101: .success([0, 31]),
      102: .success([31, 32]),
      201: .success([33]),
    ]
    calls.deviceUIDResults = [
      31: .success("sony"),
      32: .success(""),
      33: .success("display"),
    ]
    let metadata = FakeProcessMetadataCalls()
    metadata.nodes = [
      1_001: ProcessNode(pid: 1_001, parentPID: 1_000),
      1_002: ProcessNode(pid: 1_002, parentPID: 1_000),
      1_000: ProcessNode(
        pid: 1_000,
        parentPID: 1,
        bundleIdentifier: "com.google.Chrome",
        displayName: "Google Chrome",
        isRegularApplication: true
      ),
      2_001: ProcessNode(pid: 2_001, parentPID: 2_000),
      2_000: ProcessNode(
        pid: 2_000,
        parentPID: 1,
        bundleIdentifier: "com.google.Chrome",
        displayName: "Google Chrome",
        isRegularApplication: true
      ),
    ]
    let platform = CoreAudioTapPlatform(
      calls: calls,
      processMetadata: metadata,
      resolver: CaptureScopeResolver(maximumAncestryDepth: 8),
      identifier: "fixed-id"
    )

    XCTAssertEqual(
      try platform.applicationCaptureInventory(generation: 42),
      ApplicationCaptureInventory(
        generation: 42,
        sources: [
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
    )
    XCTAssertFalse(calls.operations.contains("isRunning:0"))
    XCTAssertFalse(calls.operations.contains("processPID:301"))
    XCTAssertFalse(calls.operations.contains("processPID:401"))
    XCTAssertFalse(calls.operations.contains("deviceUID:0"))
    XCTAssertEqual(calls.operations.filter { $0 == "deviceUID:31" }.count, 1)
    XCTAssertEqual(metadata.requestedPIDs.sorted(), [1_000, 1_001, 1_002, 2_000, 2_001])
  }

  func testApplicationInventoryFailsClosedForMissingPIDAndUsesCoreAudioBundleFallback() throws {
    let calls = FakeCoreAudioCalls()
    calls.processIDsResult = .success([10, 20])
    calls.runningResults = [10: .success(1), 20: .success(1)]
    calls.processPIDResults = [10: .failure(-10), 20: .success(2_000)]
    calls.processBundleIDResults = [20: .success("us.zoom.xos")]
    calls.deviceResults = [20: .success([50])]
    calls.deviceUIDResults = [50: .success("sony")]
    let metadata = FakeProcessMetadataCalls()
    metadata.nodes = [
      2_000: ProcessNode(
        pid: 2_000,
        parentPID: 1,
        displayName: "zoom.us",
        isRegularApplication: true
      )
    ]
    let platform = CoreAudioTapPlatform(
      calls: calls,
      processMetadata: metadata,
      resolver: CaptureScopeResolver(),
      identifier: "fixed-id"
    )

    XCTAssertEqual(
      try platform.applicationCaptureInventory(generation: 7).sources,
      [
        ApplicationCaptureSource(
          identity: ResponsibleApplicationIdentity(
            pid: 2_000,
            bundleIdentifier: "us.zoom.xos",
            displayName: "zoom.us"
          ),
          status: .available,
          audioProcessObjectIDs: [20],
          outputDeviceUIDs: ["sony"],
          requiresBrowserWideAcknowledgement: false
        )
      ]
    )
    XCTAssertFalse(calls.operations.contains("devices:10"))
    XCTAssertFalse(calls.operations.contains("processBundleID:10"))
  }

  func testApplicationInventoryPreservesUnresolvedMetadataAndCueExclusion() throws {
    let calls = FakeCoreAudioCalls()
    calls.processIDsResult = .success([10, 20, 30])
    calls.runningResults = [10: .success(1), 20: .success(1), 30: .success(1)]
    calls.processPIDResults = [
      10: .success(1_000),
      20: .success(2_000),
      30: .success(3_000),
    ]
    calls.processBundleIDResults = [
      10: .success("unavailable.metadata"),
      20: .success(" "),
      30: .success("com.cue.overlay.audio"),
    ]
    calls.deviceResults = [
      10: .success([]),
      20: .success([]),
      30: .success([]),
    ]
    let metadata = FakeProcessMetadataCalls()
    metadata.nodes = [
      2_000: ProcessNode(pid: 2_000, parentPID: nil),
      3_000: ProcessNode(
        pid: 3_000,
        parentPID: 1,
        bundleIdentifier: "com.cue.overlay.audio",
        displayName: "cue"
      ),
    ]
    let platform = CoreAudioTapPlatform(
      calls: calls,
      processMetadata: metadata,
      resolver: CaptureScopeResolver(),
      identifier: "fixed-id"
    )

    XCTAssertEqual(
      try platform.applicationCaptureInventory(generation: 8).sources.map(\.status),
      [
        .unresolved(.missingProcessMetadata),
        .unresolved(.missingResponsibleIdentity),
        .unresolved(.cueOwnedAncestry),
      ]
    )
  }

  func testApplicationInventoryMapsRequiredCoreAudioFailuresWithoutPartialSelection() {
    let cases: [(FakeCoreAudioCalls, String)] = [
      {
        let calls = FakeCoreAudioCalls()
        calls.processIDsResult = .failure(-40)
        return (calls, "AudioObjectGetPropertyData(process IDs)")
      }(),
      {
        let calls = FakeCoreAudioCalls()
        calls.processIDsResult = .success([10])
        calls.runningResults = [10: .success(1)]
        calls.processPIDResults = [10: .success(1_000)]
        calls.processBundleIDResults = [10: .success("us.zoom.xos")]
        calls.deviceResults = [10: .failure(-41)]
        return (calls, "AudioObjectGetPropertyData(output device IDs)")
      }(),
      {
        let calls = FakeCoreAudioCalls()
        calls.processIDsResult = .success([10])
        calls.runningResults = [10: .success(1)]
        calls.processPIDResults = [10: .success(1_000)]
        calls.processBundleIDResults = [10: .success("us.zoom.xos")]
        calls.deviceResults = [10: .success([50])]
        calls.deviceUIDResults = [50: .failure(-42)]
        return (calls, "AudioObjectGetPropertyData(output UID)")
      }(),
    ]

    for (calls, expectedOperation) in cases {
      let platform = CoreAudioTapPlatform(
        calls: calls,
        processMetadata: FakeProcessMetadataCalls(),
        resolver: CaptureScopeResolver(),
        identifier: "fixed-id"
      )
      XCTAssertThrowsError(try platform.applicationCaptureInventory(generation: 1)) {
        guard case .operation(let operation, _) = $0 as? HelperError else {
          return XCTFail("Expected HelperError.operation, received \($0)")
        }
        XCTAssertEqual(operation, expectedOperation)
      }
    }
  }

  func testAggregatePlanHasStablePrivacyAndDriftPolicy() throws {
    let calls = FakeCoreAudioCalls()
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")

    XCTAssertEqual(
      try platform.createAggregate(
        tapUID: "tap",
        outputDeviceUIDs: ["sony", "hyperx", "display"]
      ),
      22
    )
    XCTAssertEqual(
      calls.aggregatePlan,
      AggregateDevicePlan(
        name: "cue audio tap probe",
        uid: "com.cue.overlay.audio-tap-helper.fixed-id",
        isPrivate: true,
        subdevices: [
          AggregateSubdevicePlan(uid: "sony", driftCompensation: false),
          AggregateSubdevicePlan(uid: "hyperx", driftCompensation: true),
          AggregateSubdevicePlan(uid: "display", driftCompensation: true),
        ],
        mainSubdeviceUID: "sony",
        tapUID: "tap"
      )
    )
  }

  func testAggregateRejectsEmptyOutputListWithoutCallingCoreAudio() {
    let calls = FakeCoreAudioCalls()
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")

    XCTAssertThrowsError(try platform.createAggregate(tapUID: "tap", outputDeviceUIDs: [])) {
      XCTAssertEqual($0 as? HelperError, .missingOutputDevice)
    }
    XCTAssertFalse(calls.operations.contains("createAggregate"))
  }

  func testAggregateFailureIsMapped() {
    let calls = FakeCoreAudioCalls()
    calls.aggregateResult = .failure(-14)
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")

    XCTAssertThrowsError(
      try platform.createAggregate(tapUID: "tap", outputDeviceUIDs: ["sony"])
    ) {
      XCTAssertEqual(
        $0 as? HelperError,
        .operation(name: "AudioHardwareCreateAggregateDevice", status: -14)
      )
    }
  }

  func testIOFiltersMissingNullAndMalformedBuffersThenForwardsPayload() throws {
    let calls = FakeCoreAudioCalls()
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")
    var payloads = [AudioPayload]()
    try platform.createIO(aggregateID: 22) { payloads.append($0) }
    let samples: [Float] = [0, -0.5, 0.25]

    calls.bufferHandler?(nil)
    calls.bufferHandler?([nil, Data([1, 2, 3]), samples.withUnsafeBytes { Data($0) }])

    XCTAssertEqual(payloads.count, 1)
    XCTAssertEqual(payloads[0].sampleCount, 3)
    XCTAssertEqual(payloads[0].nonzeroCount, 2)
    XCTAssertEqual(payloads[0].peak, 0.5)
  }

  func testFailedCreateIODisablesCallbackAndMapsStatus() {
    let calls = FakeCoreAudioCalls()
    calls.createIOResult = .failure(-20)
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")
    var payloadCount = 0

    XCTAssertThrowsError(
      try platform.createIO(aggregateID: 22) { _ in payloadCount += 1 }
    ) {
      XCTAssertEqual(
        $0 as? HelperError,
        .operation(name: "AudioDeviceCreateIOProcID", status: -20)
      )
    }
    let samples: [Float] = [1]
    calls.bufferHandler?([samples.withUnsafeBytes { Data($0) }])
    XCTAssertEqual(payloadCount, 0)
  }

  func testStartFailureIsMappedAndCleanupOperationsAreForwarded() throws {
    let calls = FakeCoreAudioCalls()
    calls.startIOResult = .failure(-30)
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")

    XCTAssertThrowsError(try platform.startIO(aggregateID: 22)) {
      XCTAssertEqual(
        $0 as? HelperError,
        .operation(name: "AudioDeviceStart", status: -30)
      )
    }
    platform.stopIO(aggregateID: 22)
    platform.destroyIO(aggregateID: 22)
    platform.destroyAggregate(22)
    platform.destroyTap(11)

    XCTAssertEqual(
      calls.operations.suffix(5),
      [
        "startIO:22",
        "stopIO:22",
        "destroyIO:22",
        "destroyAggregate:22",
        "destroyTap:11",
      ]
    )
  }

  func testStartSuccessIsForwarded() throws {
    let calls = FakeCoreAudioCalls()
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")

    try platform.startIO(aggregateID: 22)

    XCTAssertEqual(calls.operations, ["startIO:22"])
  }

  func testDestroyIODisablesPreviouslyRegisteredCallback() throws {
    let calls = FakeCoreAudioCalls()
    let platform = CoreAudioTapPlatform(calls: calls, identifier: "fixed-id")
    var payloadCount = 0
    try platform.createIO(aggregateID: 22) { _ in payloadCount += 1 }
    let handler = try XCTUnwrap(calls.bufferHandler)

    platform.destroyIO(aggregateID: 22)
    let samples: [Float] = [1]
    handler([samples.withUnsafeBytes { Data($0) }])

    XCTAssertEqual(payloadCount, 0)
  }
}
