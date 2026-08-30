import AVFoundation
import ExpoModulesCore

public class NeoPcmRecorderModule: Module {
  private let engine = AVAudioEngine()
  private var running = false

  public func definition() -> ModuleDefinition {
    Name("NeoPcmRecorder")
    Events("audio")

    AsyncFunction("start") {
      try self.startRecorder()
    }

    AsyncFunction("stop") {
      self.stopRecorder()
    }
  }

  private func startRecorder() throws {
    if running { return }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetooth])
    try session.setActive(true)
    let input = engine.inputNode
    let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)
      ?? input.outputFormat(forBus: 0)
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 640, format: format) { buffer, _ in
      guard let channel = buffer.int16ChannelData?.pointee else { return }
      let count = Int(buffer.frameLength) * 2
      let data = Data(bytes: channel, count: count)
      self.sendEvent("audio", ["pcm": data.base64EncodedString()])
    }
    try engine.start()
    running = true
  }

  private func stopRecorder() {
    running = false
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
  }
}
