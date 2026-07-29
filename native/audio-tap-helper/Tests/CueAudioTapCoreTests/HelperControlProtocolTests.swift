import CueAudioTapCore
import Foundation
import XCTest

final class HelperControlProtocolTests: XCTestCase {
  private let validLine = Data(
    #"{"command":"capture","protocolVersion":1,"scope":{"kind":"diagnostic-global"}}"#.utf8
  )

  func testDecoderAcceptsOnlyTheVersionOneDiagnosticGlobalEnvelope() throws {
    XCTAssertEqual(
      try HelperControlDecoder().decode(validLine),
      .capture(protocolVersion: 1, scope: .diagnosticGlobal)
    )
    XCTAssertEqual(
      try HelperControlDecoder().decode(
        Data(
          #"{"command":"capture","protocolVersion":1,"scope":{"kind":"application","inventoryGeneration":42,"responsiblePid":2000,"bundleIdentifier":"com.google.Chrome","browserWideAcknowledged":true}}"#
            .utf8
        )
      ),
      .capture(
        protocolVersion: 1,
        scope: .application(
          ApplicationScopeSelection(
            inventoryGeneration: 42,
            responsiblePID: 2_000,
            bundleIdentifier: "com.google.Chrome",
            browserWideAcknowledged: true
          )
        )
      )
    )
    XCTAssertEqual(
      try HelperControlDecoder().decode(
        Data(#"{"command":"inventory","generation":42,"protocolVersion":1}"#.utf8)
      ),
      .inventory(protocolVersion: 1, generation: 42)
    )
    XCTAssertEqual(
      try HelperControlDecoder().decode(
        Data(
          #"{"command":"inventory","generation":9007199254740991,"protocolVersion":1}"#.utf8
        )
      ),
      .inventory(protocolVersion: 1, generation: 9_007_199_254_740_991)
    )
  }

  func testDecoderRejectsMalformedUnsupportedAndExtendedMessages() {
    let invalid = [
      Data(),
      Data("not-json".utf8),
      Data(#"{"command":"capture","protocolVersion":2,"scope":{"kind":"diagnostic-global"}}"#.utf8),
      Data(#"{"command":"inventory","protocolVersion":1}"#.utf8),
      Data(#"{"command":"inventory","generation":0,"protocolVersion":1}"#.utf8),
      Data(#"{"command":"inventory","generation":-1,"protocolVersion":1}"#.utf8),
      Data(#"{"command":"inventory","generation":1.5,"protocolVersion":1}"#.utf8),
      Data(
        #"{"command":"inventory","generation":9007199254740992,"protocolVersion":1}"#.utf8
      ),
      Data(#"{"command":"inventory","extra":true,"generation":1,"protocolVersion":1}"#.utf8),
      Data(
        #"{"command":"inventory","generation":1,"protocolVersion":1,"scope":{"kind":"diagnostic-global"}}"#
          .utf8),
      Data(#"{"command":"capture","protocolVersion":1,"scope":{"kind":"application"}}"#.utf8),
      Data(
        #"{"command":"capture","protocolVersion":1,"scope":{"kind":"other","inventoryGeneration":1,"responsiblePid":2000,"bundleIdentifier":"com.google.Chrome","browserWideAcknowledged":true}}"#
          .utf8),
      Data(
        #"{"command":"capture","protocolVersion":1,"scope":{"kind":"application","inventoryGeneration":1,"responsiblePid":2000,"bundleIdentifier":"com.google.Chrome","browserWideAcknowledged":true,"extra":true}}"#
          .utf8),
      Data(
        #"{"command":"capture","protocolVersion":1,"scope":{"kind":"application","inventoryGeneration":0,"responsiblePid":2000,"bundleIdentifier":"com.google.Chrome","browserWideAcknowledged":true}}"#
          .utf8),
      Data(
        #"{"command":"capture","protocolVersion":1,"scope":{"kind":"application","inventoryGeneration":1,"responsiblePid":0,"bundleIdentifier":"com.google.Chrome","browserWideAcknowledged":true}}"#
          .utf8),
      Data(
        #"{"command":"capture","protocolVersion":1,"scope":{"kind":"application","inventoryGeneration":1,"responsiblePid":2000,"bundleIdentifier":"","browserWideAcknowledged":true}}"#
          .utf8),
      Data(
        #"{"command":"capture","extra":true,"protocolVersion":1,"scope":{"kind":"diagnostic-global"}}"#
          .utf8
      ),
      Data(
        #"{"command":"capture","protocolVersion":1,"scope":{"extra":true,"kind":"diagnostic-global"}}"#
          .utf8
      ),
    ]

    for line in invalid {
      XCTAssertThrowsError(
        try HelperControlDecoder().decode(line), String(decoding: line, as: UTF8.self))
    }
  }

  func testFramerAcceptsEveryChunkBoundaryAndReturnsOneLine() throws {
    let framed = validLine + Data([0x0A])
    for split in 0..<framed.count {
      let framer = HelperControlFramer(maximumMessageBytes: validLine.count)
      XCTAssertNil(try framer.accept(framed.prefix(split)))
      XCTAssertEqual(try framer.accept(framed.suffix(from: split)), validLine)
      XCTAssertEqual(try framer.finish(), validLine)
    }
  }

  func testFramerRejectsClosedPartialOversizedAndAdditionalData() throws {
    let partial = HelperControlFramer(maximumMessageBytes: 8)
    XCTAssertNil(try partial.accept(Data("partial".utf8)))
    XCTAssertThrowsError(try partial.finish()) {
      XCTAssertEqual($0 as? HelperError, .controlClosed)
    }

    let oversized = HelperControlFramer(maximumMessageBytes: 3)
    XCTAssertThrowsError(try oversized.accept(Data("four".utf8))) {
      XCTAssertEqual($0 as? HelperError, .controlMessageTooLarge)
    }

    let oversizedLine = HelperControlFramer(maximumMessageBytes: 3)
    XCTAssertThrowsError(try oversizedLine.accept(Data("four\n".utf8))) {
      XCTAssertEqual($0 as? HelperError, .controlMessageTooLarge)
    }

    let exactUnframed = HelperControlFramer(maximumMessageBytes: 3)
    XCTAssertNil(try exactUnframed.accept(Data("abc".utf8)))

    let trailing = HelperControlFramer(maximumMessageBytes: 8)
    XCTAssertThrowsError(try trailing.accept(Data("ok\nextra".utf8))) {
      XCTAssertEqual($0 as? HelperError, .unexpectedControlData)
    }

    let complete = HelperControlFramer(maximumMessageBytes: 8)
    XCTAssertEqual(try complete.accept(Data("ok\n".utf8)), Data("ok".utf8))
    XCTAssertThrowsError(try complete.accept(Data([0x00]))) {
      XCTAssertEqual($0 as? HelperError, .unexpectedControlData)
    }
  }

  func testFramerAllowsAnEmptyReadOnlyAfterACompleteMessage() throws {
    let framer = HelperControlFramer(maximumMessageBytes: 8)
    XCTAssertNil(try framer.accept(Data()))
    XCTAssertEqual(try framer.accept(Data("ok\n".utf8)), Data("ok".utf8))
    XCTAssertNil(try framer.accept(Data()))
  }

  func testStreamControlReadsChunkedConfigurationThenTreatsEofAsTermination() throws {
    var chunks = [
      Data(validLine.prefix(7)),
      Data(validLine.suffix(from: 7)) + Data([0x0A]),
      Data(),
    ]
    let control = StreamHelperControl(readChunk: { chunks.removeFirst() })

    XCTAssertEqual(
      try control.readConfiguration(),
      .capture(protocolVersion: 1, scope: .diagnosticGlobal)
    )
    XCTAssertNoThrow(try control.wait())
    XCTAssertTrue(chunks.isEmpty)
  }

  func testStreamControlRejectsEofBeforeConfigurationAndDataAfterConfiguration() throws {
    let closed = StreamHelperControl(readChunk: { Data() })
    XCTAssertThrowsError(try closed.readConfiguration()) {
      XCTAssertEqual($0 as? HelperError, .controlClosed)
    }

    var chunks = [validLine + Data([0x0A]), Data([0x00])]
    let extended = StreamHelperControl(readChunk: { chunks.removeFirst() })
    XCTAssertNoThrow(try extended.readConfiguration())
    XCTAssertThrowsError(try extended.wait()) {
      XCTAssertEqual($0 as? HelperError, .unexpectedControlData)
    }
  }

  func testStreamControlPropagatesApplicationScopeInvalidation() {
    let control = StreamHelperControl(
      readChunk: { throw HelperError.applicationScopeInvalidated }
    )

    XCTAssertThrowsError(try control.wait()) {
      XCTAssertEqual($0 as? HelperError, .applicationScopeInvalidated)
    }
  }

  func testStreamControlPropagatesFramingAndDecodingFailures() {
    let oversized = StreamHelperControl(
      maximumMessageBytes: 3,
      readChunk: { Data("four".utf8) }
    )
    XCTAssertThrowsError(try oversized.readConfiguration()) {
      XCTAssertEqual($0 as? HelperError, .controlMessageTooLarge)
    }

    var invalidChunks = [Data("invalid\n".utf8)]
    let invalid = StreamHelperControl(readChunk: { invalidChunks.removeFirst() })
    XCTAssertThrowsError(try invalid.readConfiguration()) {
      XCTAssertEqual($0 as? HelperError, .invalidControlMessage)
    }
  }
}
