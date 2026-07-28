import CueAudioTapCore
import Foundation
import XCTest

private enum FixtureError: Error, CustomStringConvertible {
  case failed(String)

  var description: String {
    switch self {
    case .failed(let value): value
    }
  }
}

private final class FakePlatform: AudioTapPlatform {
  enum Operation: String {
    case createTap
    case tapUID
    case tapFormat
    case outputDevices
    case createAggregate
    case createIO
    case startIO
  }

  var failingOperation: Operation?
  var uid = "tap-uid"
  var format = TapFormat(
    isLinearPCM: true,
    isFloat: true,
    bitsPerChannel: 32,
    channelsPerFrame: 1,
    sampleRate: 48_000
  )
  var outputDeviceUIDs = ["output-a", "output-b"]
  var operations = [String]()
  var payloadHandler: ((AudioPayload) -> Void)?

  func createTap() throws -> UInt32 {
    operations.append(Operation.createTap.rawValue)
    try failIfRequested(.createTap)
    return 11
  }

  func tapUID(for tapID: UInt32) throws -> String {
    operations.append("\(Operation.tapUID.rawValue):\(tapID)")
    try failIfRequested(.tapUID)
    return uid
  }

  func tapFormat(for tapID: UInt32) throws -> TapFormat {
    operations.append("\(Operation.tapFormat.rawValue):\(tapID)")
    try failIfRequested(.tapFormat)
    return format
  }

  func runningOutputDeviceUIDs() throws -> [String] {
    operations.append(Operation.outputDevices.rawValue)
    try failIfRequested(.outputDevices)
    return outputDeviceUIDs
  }

  func createAggregate(tapUID: String, outputDeviceUIDs: [String]) throws -> UInt32 {
    operations.append(
      "\(Operation.createAggregate.rawValue):\(tapUID):\(outputDeviceUIDs.joined(separator: ","))"
    )
    try failIfRequested(.createAggregate)
    return 22
  }

  func createIO(
    aggregateID: UInt32,
    onPayload: @escaping (AudioPayload) -> Void
  ) throws {
    operations.append("\(Operation.createIO.rawValue):\(aggregateID)")
    try failIfRequested(.createIO)
    payloadHandler = onPayload
  }

  func startIO(aggregateID: UInt32) throws {
    operations.append("\(Operation.startIO.rawValue):\(aggregateID)")
    try failIfRequested(.startIO)
  }

  func stopIO(aggregateID: UInt32) {
    operations.append("stopIO:\(aggregateID)")
  }

  func destroyIO(aggregateID: UInt32) {
    operations.append("destroyIO:\(aggregateID)")
    payloadHandler = nil
  }

  func destroyAggregate(_ aggregateID: UInt32) {
    operations.append("destroyAggregate:\(aggregateID)")
  }

  func destroyTap(_ tapID: UInt32) {
    operations.append("destroyTap:\(tapID)")
  }

  private func failIfRequested(_ operation: Operation) throws {
    if failingOperation == operation {
      throw FixtureError.failed(operation.rawValue)
    }
  }
}

private final class FakeSession: AudioSession {
  var sampleRate = 48_000.0
  var startError: Error?
  var snapshotValue = SignalSnapshot(callbacks: 1, samples: 2, nonzero: 1, peak: 0.5)
  var operations = [String]()

  func start() throws -> Double {
    operations.append("start")
    if let startError {
      throw startError
    }
    return sampleRate
  }

  func stop() {
    operations.append("stop")
  }

  func drain() {
    operations.append("drain")
  }

  func snapshot() -> SignalSnapshot {
    operations.append("snapshot")
    return snapshotValue
  }
}

private final class FakeTermination: TerminationWaiting {
  var waitCount = 0

  func wait() {
    waitCount += 1
  }
}

final class HelperErrorTests: XCTestCase {
  func testDescriptionsAreStableAndSanitized() {
    XCTAssertEqual(
      HelperError.operation(name: "create", status: -50).description,
      "create failed with OSStatus -50"
    )
    XCTAssertEqual(
      HelperError.missingTapUID.description,
      "The process tap did not expose a UID."
    )
    XCTAssertEqual(
      HelperError.missingOutputDevice.description,
      "No output device is available for the process tap."
    )
    XCTAssertEqual(
      HelperError.unsupportedFormat.description,
      "The tap did not provide mono Float32 linear PCM."
    )
    XCTAssertEqual(
      HelperError.invalidState.description,
      "The audio tap session is already active."
    )
  }
}

final class TapFormatTests: XCTestCase {
  private let valid = TapFormat(
    isLinearPCM: true,
    isFloat: true,
    bitsPerChannel: 32,
    channelsPerFrame: 1,
    sampleRate: 48_000
  )

  func testValidFormatReturnsItsSampleRate() throws {
    XCTAssertEqual(try valid.validatedSampleRate(), 48_000)
    XCTAssertEqual(valid, valid)
  }

  func testEveryUnsupportedFormatDimensionIsRejected() {
    let invalid = [
      TapFormat(
        isLinearPCM: false,
        isFloat: true,
        bitsPerChannel: 32,
        channelsPerFrame: 1,
        sampleRate: 48_000
      ),
      TapFormat(
        isLinearPCM: true,
        isFloat: false,
        bitsPerChannel: 32,
        channelsPerFrame: 1,
        sampleRate: 48_000
      ),
      TapFormat(
        isLinearPCM: true,
        isFloat: true,
        bitsPerChannel: 16,
        channelsPerFrame: 1,
        sampleRate: 48_000
      ),
      TapFormat(
        isLinearPCM: true,
        isFloat: true,
        bitsPerChannel: 32,
        channelsPerFrame: 2,
        sampleRate: 48_000
      ),
      TapFormat(
        isLinearPCM: true,
        isFloat: true,
        bitsPerChannel: 32,
        channelsPerFrame: 1,
        sampleRate: .infinity
      ),
      TapFormat(
        isLinearPCM: true,
        isFloat: true,
        bitsPerChannel: 32,
        channelsPerFrame: 1,
        sampleRate: 0
      ),
    ]

    for format in invalid {
      XCTAssertThrowsError(try format.validatedSampleRate()) {
        XCTAssertEqual($0 as? HelperError, .unsupportedFormat)
      }
    }
  }
}

final class BoundedSignalWriterTests: XCTestCase {
  func testFloat32PayloadAnalysisIsExact() throws {
    let samples: [Float] = [0, -0.25, 0.75, -.infinity]
    let data = samples.withUnsafeBytes { Data($0) }
    let payload = try XCTUnwrap(AudioPayload(float32LE: data))

    XCTAssertEqual(payload.data, data)
    XCTAssertEqual(payload.sampleCount, 4)
    XCTAssertEqual(payload.nonzeroCount, 3)
    XCTAssertEqual(payload.peak, .infinity)
  }

  func testMalformedFloat32PayloadIsRejected() {
    XCTAssertNil(AudioPayload(float32LE: Data([1, 2, 3])))
  }

  func testAcceptTracksMetricsPendingBytesAndDeferredWrite() {
    var scheduled = [() -> Void]()
    var writes = [Data]()
    let writer = BoundedSignalWriter(
      maximumPendingBytes: 4,
      scheduleWrite: { scheduled.append($0) },
      write: { writes.append($0) }
    )
    let payload = AudioPayload(
      data: Data([1, 2, 3, 4]),
      sampleCount: 1,
      nonzeroCount: 1,
      peak: 0.75
    )

    XCTAssertTrue(writer.accept(payload))
    XCTAssertEqual(writer.currentPendingBytes(), 4)
    XCTAssertEqual(
      writer.snapshot(),
      SignalSnapshot(callbacks: 1, samples: 1, nonzero: 1, peak: 0.75)
    )
    XCTAssertTrue(writes.isEmpty)

    scheduled.removeFirst()()
    XCTAssertEqual(writes, [Data([1, 2, 3, 4])])
    XCTAssertEqual(writer.currentPendingBytes(), 0)
  }

  func testOverflowIsRejectedWithoutCorruptingAccounting() {
    var scheduled = [() -> Void]()
    let writer = BoundedSignalWriter(
      maximumPendingBytes: 3,
      scheduleWrite: { scheduled.append($0) },
      write: { _ in }
    )
    let first = AudioPayload(
      data: Data([1, 2]),
      sampleCount: 2,
      nonzeroCount: 1,
      peak: 0.25
    )
    let rejected = AudioPayload(
      data: Data([3, 4]),
      sampleCount: 2,
      nonzeroCount: 2,
      peak: 0.5
    )

    XCTAssertTrue(writer.accept(first))
    XCTAssertFalse(writer.accept(rejected))
    XCTAssertEqual(writer.currentPendingBytes(), 2)
    XCTAssertEqual(
      writer.snapshot(),
      SignalSnapshot(callbacks: 2, samples: 4, nonzero: 3, peak: 0.5)
    )

    scheduled.removeFirst()()
    XCTAssertEqual(writer.currentPendingBytes(), 0)
  }

  func testZeroCapacityAcceptsOnlyEmptyPayload() {
    var scheduled = [() -> Void]()
    let writer = BoundedSignalWriter(
      maximumPendingBytes: 0,
      scheduleWrite: { scheduled.append($0) },
      write: { _ in }
    )

    XCTAssertTrue(
      writer.accept(
        AudioPayload(data: Data(), sampleCount: 0, nonzeroCount: 0, peak: 0)
      )
    )
    XCTAssertFalse(
      writer.accept(
        AudioPayload(data: Data([1]), sampleCount: 0, nonzeroCount: 0, peak: 0)
      )
    )
    scheduled.removeFirst()()
    XCTAssertEqual(writer.currentPendingBytes(), 0)
  }

  func testManyAcceptedAndRejectedPayloadsRemainBounded() {
    var scheduled = [() -> Void]()
    let writer = BoundedSignalWriter(
      maximumPendingBytes: 7,
      scheduleWrite: { scheduled.append($0) },
      write: { _ in }
    )

    for length in 0...12 {
      let accepted = writer.accept(
        AudioPayload(
          data: Data(repeating: UInt8(length), count: length),
          sampleCount: UInt64(length),
          nonzeroCount: UInt64(length),
          peak: Float(length)
        )
      )
      XCTAssertEqual(accepted, length <= 7)
      while !scheduled.isEmpty {
        scheduled.removeFirst()()
      }
      XCTAssertEqual(writer.currentPendingBytes(), 0)
    }
  }
}

final class AudioTapSessionTests: XCTestCase {
  private func makeHarness(
    platform: FakePlatform = FakePlatform()
  ) -> (AudioTapSession, FakePlatform, BoundedSignalWriter, () -> Int) {
    var drainCount = 0
    let writer = BoundedSignalWriter(
      scheduleWrite: { $0() },
      write: { _ in }
    )
    let session = AudioTapSession(
      platform: platform,
      writer: writer,
      drainWrites: { drainCount += 1 }
    )
    return (session, platform, writer, { drainCount })
  }

  func testSuccessfulLifecycleForwardsPayloadAndCleansUpExactlyOnce() throws {
    let (session, platform, writer, drainCount) = makeHarness()

    XCTAssertEqual(try session.start(), 48_000)
    XCTAssertThrowsError(try session.start()) {
      XCTAssertEqual($0 as? HelperError, .invalidState)
    }
    platform.payloadHandler?(
      AudioPayload(data: Data([1]), sampleCount: 1, nonzeroCount: 1, peak: 0.5)
    )
    XCTAssertEqual(writer.snapshot().callbacks, 1)
    XCTAssertEqual(session.snapshot(), writer.snapshot())

    session.drain()
    XCTAssertEqual(drainCount(), 1)
    session.stop()
    session.stop()

    XCTAssertEqual(
      platform.operations,
      [
        "createTap",
        "tapUID:11",
        "tapFormat:11",
        "outputDevices",
        "createAggregate:tap-uid:output-a,output-b",
        "createIO:22",
        "startIO:22",
        "stopIO:22",
        "destroyIO:22",
        "destroyAggregate:22",
        "destroyTap:11",
      ]
    )
  }

  func testPartialStartFailuresCleanUpAcquiredResourcesInReverseOrder() {
    let expectations: [(FakePlatform.Operation, [String])] = [
      (.createTap, ["createTap"]),
      (.tapUID, ["createTap", "tapUID:11", "destroyTap:11"]),
      (.tapFormat, ["createTap", "tapUID:11", "tapFormat:11", "destroyTap:11"]),
      (
        .outputDevices,
        ["createTap", "tapUID:11", "tapFormat:11", "outputDevices", "destroyTap:11"]
      ),
      (
        .createAggregate,
        [
          "createTap",
          "tapUID:11",
          "tapFormat:11",
          "outputDevices",
          "createAggregate:tap-uid:output-a,output-b",
          "destroyTap:11",
        ]
      ),
      (
        .createIO,
        [
          "createTap",
          "tapUID:11",
          "tapFormat:11",
          "outputDevices",
          "createAggregate:tap-uid:output-a,output-b",
          "createIO:22",
          "destroyAggregate:22",
          "destroyTap:11",
        ]
      ),
      (
        .startIO,
        [
          "createTap",
          "tapUID:11",
          "tapFormat:11",
          "outputDevices",
          "createAggregate:tap-uid:output-a,output-b",
          "createIO:22",
          "startIO:22",
          "destroyIO:22",
          "destroyAggregate:22",
          "destroyTap:11",
        ]
      ),
    ]

    for (operation, expectedOperations) in expectations {
      let platform = FakePlatform()
      platform.failingOperation = operation
      let (session, _, _, _) = makeHarness(platform: platform)

      XCTAssertThrowsError(try session.start())
      XCTAssertEqual(platform.operations, expectedOperations, operation.rawValue)
      session.stop()
      XCTAssertEqual(platform.operations, expectedOperations, operation.rawValue)
    }
  }

  func testEmptyUIDMissingDeviceAndUnsupportedFormatUseTypedFailures() {
    let emptyUID = FakePlatform()
    emptyUID.uid = ""
    let (uidSession, _, _, _) = makeHarness(platform: emptyUID)
    XCTAssertThrowsError(try uidSession.start()) {
      XCTAssertEqual($0 as? HelperError, .missingTapUID)
    }

    let missingDevice = FakePlatform()
    missingDevice.outputDeviceUIDs = []
    let (deviceSession, _, _, _) = makeHarness(platform: missingDevice)
    XCTAssertThrowsError(try deviceSession.start()) {
      XCTAssertEqual($0 as? HelperError, .missingOutputDevice)
    }

    let invalidFormat = FakePlatform()
    invalidFormat.format = TapFormat(
      isLinearPCM: true,
      isFloat: true,
      bitsPerChannel: 16,
      channelsPerFrame: 1,
      sampleRate: 48_000
    )
    let (formatSession, _, _, _) = makeHarness(platform: invalidFormat)
    XCTAssertThrowsError(try formatSession.start()) {
      XCTAssertEqual($0 as? HelperError, .unsupportedFormat)
    }
  }

  func testDeinitializationCleansAnActiveSession() throws {
    let platform = FakePlatform()
    var session: AudioTapSession? = makeHarness(platform: platform).0
    _ = try session?.start()
    session = nil

    XCTAssertEqual(
      Array(platform.operations.suffix(4)),
      [
        "stopIO:22",
        "destroyIO:22",
        "destroyAggregate:22",
        "destroyTap:11",
      ])
  }
}

final class HelperEventEncoderTests: XCTestCase {
  private let encoder = HelperEventEncoder()

  func testStartedEventIsSortedAndNewlineDelimited() throws {
    XCTAssertEqual(
      String(decoding: try encoder.encodeLine(.started(sampleRate: 48_000)), as: UTF8.self),
      "{\"channels\":1,\"event\":\"started\",\"format\":\"float32le\",\"sampleRate\":48000}\n"
    )
  }

  func testStoppedEventContainsOnlyAggregateMetrics() throws {
    let line = try encoder.encodeLine(
      .stopped(
        metrics: SignalSnapshot(callbacks: 2, samples: 4, nonzero: 3, peak: 0.5)
      )
    )
    XCTAssertEqual(
      String(decoding: line, as: UTF8.self),
      "{\"event\":\"stopped\",\"metrics\":{\"callbacks\":2,\"nonzero\":3,\"peak\":0.5,\"samples\":4}}\n"
    )
  }

  func testErrorEventIsEscapedAndNewlineDelimited() throws {
    XCTAssertEqual(
      String(
        decoding: try encoder.encodeLine(.error(message: "bad \"value\"")),
        as: UTF8.self
      ),
      "{\"event\":\"error\",\"message\":\"bad \\\"value\\\"\"}\n"
    )
  }
}

final class HelperRunnerTests: XCTestCase {
  func testDefaultEncoderProducesTheProductionProtocol() {
    let session = FakeSession()
    let termination = FakeTermination()
    var lines = [String]()
    let runner = HelperRunner(
      session: session,
      termination: termination,
      writeEvent: { lines.append(String(decoding: $0, as: UTF8.self)) }
    )

    XCTAssertEqual(runner.run(), 0)
    XCTAssertEqual(lines.count, 2)
    XCTAssertTrue(lines[0].contains("\"event\":\"started\""))
    XCTAssertTrue(lines[1].contains("\"event\":\"stopped\""))
  }

  func testSuccessWritesStartedThenStoppedAroundTerminationAndCleanup() {
    let session = FakeSession()
    let termination = FakeTermination()
    var events = [HelperEvent]()
    let runner = HelperRunner(
      session: session,
      termination: termination,
      encode: {
        events.append($0)
        return Data([UInt8(events.count)])
      },
      writeEvent: { _ in }
    )

    XCTAssertEqual(runner.run(), 0)
    XCTAssertEqual(termination.waitCount, 1)
    XCTAssertEqual(session.operations, ["start", "stop", "drain", "snapshot"])
    XCTAssertEqual(
      events,
      [
        .started(sampleRate: 48_000),
        .stopped(metrics: session.snapshotValue),
      ])
  }

  func testStartFailureStopsAndWritesTypedError() {
    let session = FakeSession()
    session.startError = FixtureError.failed("start failed")
    let termination = FakeTermination()
    var events = [HelperEvent]()
    var writes = [Data]()
    let runner = HelperRunner(
      session: session,
      termination: termination,
      encode: {
        events.append($0)
        return Data([7])
      },
      writeEvent: { writes.append($0) }
    )

    XCTAssertEqual(runner.run(), 1)
    XCTAssertEqual(session.operations, ["start", "stop"])
    XCTAssertEqual(termination.waitCount, 0)
    XCTAssertEqual(events, [.error(message: "start failed")])
    XCTAssertEqual(writes, [Data([7])])
  }

  func testStartedWriteFailureCleansUpAndBestEffortWritesError() {
    let session = FakeSession()
    let termination = FakeTermination()
    var writeCount = 0
    var events = [HelperEvent]()
    let runner = HelperRunner(
      session: session,
      termination: termination,
      encode: {
        events.append($0)
        return Data([1])
      },
      writeEvent: { _ in
        writeCount += 1
        if writeCount == 1 {
          throw FixtureError.failed("write failed")
        }
      }
    )

    XCTAssertEqual(runner.run(), 1)
    XCTAssertEqual(session.operations, ["start", "stop"])
    XCTAssertEqual(
      events,
      [
        .started(sampleRate: 48_000),
        .error(message: "write failed"),
      ])
    XCTAssertEqual(writeCount, 2)
  }

  func testStoppedEncodingFailureUsesErrorPathAfterNormalCleanup() {
    let session = FakeSession()
    let termination = FakeTermination()
    var encodeCount = 0
    var events = [HelperEvent]()
    let runner = HelperRunner(
      session: session,
      termination: termination,
      encode: {
        encodeCount += 1
        events.append($0)
        if encodeCount == 2 {
          throw FixtureError.failed("encode failed")
        }
        return Data([1])
      },
      writeEvent: { _ in }
    )

    XCTAssertEqual(runner.run(), 1)
    XCTAssertEqual(session.operations, ["start", "stop", "drain", "snapshot", "stop"])
    XCTAssertEqual(
      events,
      [
        .started(sampleRate: 48_000),
        .stopped(metrics: session.snapshotValue),
        .error(message: "encode failed"),
      ])
  }

  func testErrorEncodingAndWritingAreBothBestEffort() {
    let session = FakeSession()
    session.startError = FixtureError.failed("start failed")
    let termination = FakeTermination()
    let encodingFailure = HelperRunner(
      session: session,
      termination: termination,
      encode: { _ in throw FixtureError.failed("encode failed") },
      writeEvent: { _ in XCTFail("No event should be written") }
    )
    XCTAssertEqual(encodingFailure.run(), 1)

    let secondSession = FakeSession()
    secondSession.startError = FixtureError.failed("start failed")
    let writingFailure = HelperRunner(
      session: secondSession,
      termination: termination,
      encode: { _ in Data([1]) },
      writeEvent: { _ in throw FixtureError.failed("write failed") }
    )
    XCTAssertEqual(writingFailure.run(), 1)
    XCTAssertEqual(secondSession.operations, ["start", "stop"])
  }
}
