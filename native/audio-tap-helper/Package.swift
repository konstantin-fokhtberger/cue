// swift-tools-version: 6.0

import Foundation
import PackageDescription

let packageDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path

let package = Package(
  name: "CueAudioTapHelper",
  platforms: [.macOS(.v15)],
  products: [
    .library(name: "CueAudioTapCore", targets: ["CueAudioTapCore"]),
    .library(name: "CueAudioTapPlatform", targets: ["CueAudioTapPlatform"]),
    .executable(name: "cue-audio-tap-helper", targets: ["CueAudioTapHelper"]),
  ],
  targets: [
    .target(name: "CueAudioTapCore"),
    .target(
      name: "CueAudioTapPlatform",
      dependencies: ["CueAudioTapCore"],
      linkerSettings: [.linkedFramework("CoreAudio")]
    ),
    .executableTarget(
      name: "CueAudioTapHelper",
      dependencies: ["CueAudioTapCore", "CueAudioTapPlatform"],
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
    .testTarget(
      name: "CueAudioTapPlatformTests",
      dependencies: ["CueAudioTapCore", "CueAudioTapPlatform"]
    ),
  ],
  swiftLanguageModes: [.v5]
)
