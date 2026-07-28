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
      HelperConfiguration(
        protocolVersion: 1,
        command: .capture,
        scope: .diagnosticGlobal
      )
    )
  }

  func testDecoderRejectsMalformedUnsupportedAndExtendedMessages() {
    let invalid = [
      Data(),
      Data("not-json".utf8),
      Data(#"{"command":"capture","protocolVersion":2,"scope":{"kind":"diagnostic-global"}}"#.utf8),
      Data(
        #"{"command":"inventory","protocolVersion":1,"scope":{"kind":"diagnostic-global"}}"#.utf8),
      Data(#"{"command":"capture","protocolVersion":1,"scope":{"kind":"application"}}"#.utf8),
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
      HelperConfiguration(
        protocolVersion: 1,
        command: .capture,
        scope: .diagnosticGlobal
      )
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
