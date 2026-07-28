// swift-tools-version: 6.0

import Foundation
import PackageDescription

let packageDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path

let package = Package(
  name: "CueAudioTapHelper",
  platforms: [.macOS(.v15)],
  products: [
    .library(name: "CueAudioTapCore", targets: ["CueAudioTapCore"]),
    .executable(name: "cue-audio-tap-helper", targets: ["CueAudioTapHelper"]),
  ],
  targets: [
    .target(name: "CueAudioTapCore"),
    .executableTarget(
      name: "CueAudioTapHelper",
      dependencies: ["CueAudioTapCore"],
      linkerSettings: [
        .linkedFramework("CoreAudio"),
        .unsafeFlags([
          "-Xlinker", "-sectcreate",
          "-Xlinker", "__TEXT",
          "-Xlinker", "__info_plist",
          "-Xlinker", "\(packageDirectory)/Info.plist",
        ]),
      ]
    ),
    .testTarget(name: "CueAudioTapCoreTests", dependencies: ["CueAudioTapCore"]),
  ],
  swiftLanguageModes: [.v5]
)
