import CueAudioTapCore
import CueAudioTapPlatform
import Darwin
import Foundation

private final class SignalControlBridge {
  private let terminateSource: DispatchSourceSignal
  private let interruptSource: DispatchSourceSignal

  init() {
    signal(SIGTERM, SIG_IGN)
    signal(SIGINT, SIG_IGN)
    terminateSource = DispatchSource.makeSignalSource(signal: SIGTERM)
    interruptSource = DispatchSource.makeSignalSource(signal: SIGINT)
    terminateSource.setEventHandler { Darwin.close(STDIN_FILENO) }
    interruptSource.setEventHandler { Darwin.close(STDIN_FILENO) }
    terminateSource.resume()
    interruptSource.resume()
  }
}

private let signalBridge = SignalControlBridge()
private let control = StreamHelperControl(
  readChunk: { FileHandle.standardInput.availableData }
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
private let runner = HelperRunner(
  session: session,
  termination: control,
  writeEvent: { FileHandle.standardError.write($0) }
)

withExtendedLifetime(signalBridge) {
  exit(runner.run())
}
