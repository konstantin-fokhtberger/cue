import Foundation

public enum HelperCommand: String, Equatable {
  case capture
}

public enum CaptureScope: Equatable {
  case diagnosticGlobal

  public var kind: String {
    switch self {
    case .diagnosticGlobal:
      return "diagnostic-global"
    }
  }
}

public struct HelperConfiguration: Equatable {
  public let protocolVersion: Int
  public let command: HelperCommand
  public let scope: CaptureScope

  public init(
    protocolVersion: Int,
    command: HelperCommand,
    scope: CaptureScope
  ) {
    self.protocolVersion = protocolVersion
    self.command = command
    self.scope = scope
  }
}

public struct HelperControlDecoder {
  public init() {}

  public func decode(_ data: Data) throws -> HelperConfiguration {
    guard
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      Set(object.keys) == ["command", "protocolVersion", "scope"],
      let version = object["protocolVersion"] as? Int,
      version == 1,
      let commandValue = object["command"] as? String,
      let command = HelperCommand(rawValue: commandValue),
      let scope = object["scope"] as? [String: Any],
      Set(scope.keys) == ["kind"],
      let scopeKind = scope["kind"] as? String,
      scopeKind == "diagnostic-global"
    else {
      throw HelperError.invalidControlMessage
    }

    return HelperConfiguration(
      protocolVersion: version,
      command: command,
      scope: .diagnosticGlobal
    )
  }
}

public final class HelperControlFramer {
  private let maximumMessageBytes: Int
  private var buffer = Data()
  private var completedLine: Data?

  public init(maximumMessageBytes: Int = 4_096) {
    precondition(maximumMessageBytes > 0)
    self.maximumMessageBytes = maximumMessageBytes
  }

  public func accept<Chunk: DataProtocol>(_ chunk: Chunk) throws -> Data? {
    guard !chunk.isEmpty else {
      return nil
    }
    guard completedLine == nil else {
      throw HelperError.unexpectedControlData
    }

    buffer.append(contentsOf: chunk)
    if let newline = buffer.firstIndex(of: 0x0A) {
      let line = Data(buffer[..<newline])
      guard line.count <= maximumMessageBytes else {
        throw HelperError.controlMessageTooLarge
      }
      guard buffer.index(after: newline) == buffer.endIndex else {
        throw HelperError.unexpectedControlData
      }
      completedLine = line
      buffer.removeAll(keepingCapacity: false)
      return line
    }
    guard buffer.count <= maximumMessageBytes else {
      throw HelperError.controlMessageTooLarge
    }
    return nil
  }

  public func finish() throws -> Data {
    guard let completedLine else {
      throw HelperError.controlClosed
    }
    return completedLine
  }
}

public protocol HelperControlling {
  func readConfiguration() throws -> HelperConfiguration
  func wait() throws
}

public final class StreamHelperControl: HelperControlling {
  private let decoder: HelperControlDecoder
  private let framer: HelperControlFramer
  private let readChunk: () -> Data

  public init(
    maximumMessageBytes: Int = 4_096,
    decoder: HelperControlDecoder = HelperControlDecoder(),
    readChunk: @escaping () -> Data
  ) {
    self.decoder = decoder
    framer = HelperControlFramer(maximumMessageBytes: maximumMessageBytes)
    self.readChunk = readChunk
  }

  public func readConfiguration() throws -> HelperConfiguration {
    var line: Data?
    repeat {
      let chunk = readChunk()
      guard !chunk.isEmpty else {
        throw HelperError.controlClosed
      }
      line = try framer.accept(chunk)
    } while line == nil
    return try decoder.decode(line!)
  }

  public func wait() throws {
    let chunk = readChunk()
    guard chunk.isEmpty else {
      throw HelperError.unexpectedControlData
    }
  }
}
