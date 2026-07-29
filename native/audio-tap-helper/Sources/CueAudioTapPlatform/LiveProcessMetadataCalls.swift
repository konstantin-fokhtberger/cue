import AppKit
import CueAudioTapCore
import Darwin

final class LiveProcessMetadataCalls: ProcessMetadataCalls {
  func processNode(pid: Int32) -> ProcessNode? {
    var information = proc_bsdinfo()
    let expectedSize = MemoryLayout<proc_bsdinfo>.stride
    let actualSize = withUnsafeMutablePointer(to: &information) { pointer in
      proc_pidinfo(
        pid,
        PROC_PIDTBSDINFO,
        0,
        pointer,
        Int32(expectedSize)
      )
    }
    guard actualSize == expectedSize else {
      return nil
    }

    let application = NSRunningApplication(processIdentifier: pid)
    let bundleIdentifier = application?.bundleIdentifier
    return ProcessNode(
      pid: pid,
      parentPID: information.pbi_ppid > 0 ? Int32(information.pbi_ppid) : nil,
      bundleIdentifier: bundleIdentifier,
      displayName: application?.localizedName,
      isRegularApplication: application?.activationPolicy == .regular,
      isCueOwned: false
    )
  }
}
