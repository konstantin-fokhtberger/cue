import CueAudioTapCore
import CueAudioTapPlatform
import Darwin
import Foundation

private let ownerPID = getppid()
private var activeScopeIsValid: () -> Bool = { true }

private func readControlChunk() throws -> Data {
  while ownerPID > 1 && getppid() == ownerPID {
    var descriptor = pollfd(
      fd: STDIN_FILENO,
      events: Int16(POLLIN | POLLHUP),
      revents: 0
    )
    let result = Darwin.poll(&descriptor, 1, 100)
    if result > 0 {
      return FileHandle.standardInput.availableData
    }
    if result == 0 && !activeScopeIsValid() {
      throw HelperError.applicationScopeInvalidated
    }
    if result < 0 && errno != EINTR {
      return Data()
    }
  }
  return Data()
}

private let control = StreamHelperControl(
  readChunk: readControlChunk
)
private let writerQueue = DispatchQueue(label: "com.cue.audio-tap-helper.stdout")
private let writer = BoundedSignalWriter(
  scheduleWrite: { operation in writerQueue.async(execute: operation) },
  write: { FileHandle.standardOutput.write($0) }
)
private let platform = CoreAudioTapPlatform()
private let session = AudioTapSession(
  platform: platform,
  writer: writer,
  drainWrites: { writerQueue.sync {} }
)
private var nextScopeValidationUptime: UInt64 = 0
activeScopeIsValid = {
  let now = DispatchTime.now().uptimeNanoseconds
  guard now >= nextScopeValidationUptime else {
    return true
  }
  nextScopeValidationUptime = now &+ 1_000_000_000
  return session.scopeIsValid()
}
private let runner = HelperRunner(
  session: session,
  termination: control,
  inventory: { try platform.applicationCaptureInventory(generation: $0) },
  writeEvent: { FileHandle.standardError.write($0) }
)

exit(runner.run())
