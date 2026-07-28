import CueAudioTapCore
import Darwin
import Foundation

private final class SignalTerminationWaiter: TerminationWaiting {
  private let stopped = DispatchSemaphore(value: 0)
  private let terminateSource: DispatchSourceSignal
  private let interruptSource: DispatchSourceSignal

  init() {
    signal(SIGTERM, SIG_IGN)
    signal(SIGINT, SIG_IGN)
    terminateSource = DispatchSource.makeSignalSource(signal: SIGTERM)
    interruptSource = DispatchSource.makeSignalSource(signal: SIGINT)
    terminateSource.setEventHandler { [stopped] in stopped.signal() }
    interruptSource.setEventHandler { [stopped] in stopped.signal() }
    terminateSource.resume()
    interruptSource.resume()
  }

  func wait() {
    stopped.wait()
  }
}

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
  termination: SignalTerminationWaiter(),
  writeEvent: { FileHandle.standardError.write($0) }
)

exit(runner.run())
