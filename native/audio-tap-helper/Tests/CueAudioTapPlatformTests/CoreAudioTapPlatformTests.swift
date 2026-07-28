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
