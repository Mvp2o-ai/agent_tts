import AVFoundation
import ExpoModulesCore

/// Full-duplex voice: capture 16 kHz s16le mono, play 24 kHz s16le mono.
/// One AVAudioEngine + AVAudioPlayerNode — never one AVPlayer per chunk.
final class VoiceAudioEngine {
  static let captureRate: Double = 16_000
  static let playbackRate: Double = 24_000
  /// Matches `src/playback-path.ts` / Android `PlaybackLimits`.
  static let maxQueuedBytes = 24_000 * 2 * 180
  static let maxScheduledBuffers = 48
  static let backpressureTimeout: TimeInterval = 15

  private let emit: (String, [String: Any]) -> Void
  private let lock = NSLock()
  private let playGate = NSCondition()
  private let scheduler = DispatchQueue(label: "dev.agenttts.voiceaudio.play")

  private var engine: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var captureConverter: AVAudioConverter?
  private var captureFormat: AVAudioFormat?

  private var generation = 0
  private var mode = "ptt"
  private var userReleased = true
  private var capturing = false
  private var tapInstalled = false
  private var wasCapturingBeforeInterruption = false
  private var voiceProcessingEnabled = false
  private var playEpoch = 0
  private var pendingBuffers = 0
  private var queuedBytes = 0
  private var observers: [NSObjectProtocol] = []

  init(emit: @escaping (String, [String: Any]) -> Void) {
    self.emit = emit
  }

  func currentGeneration() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return generation
  }

  func prepare(generation: Int, mode: String) throws -> [String: Any] {
    lock.lock()
    userReleased = false
    self.generation = generation
    self.mode = mode
    lock.unlock()

    try configureSession()
    try startEngineIfNeeded()
    installNotifications()

    lock.lock()
    let vp = voiceProcessingEnabled
    lock.unlock()

    return [
      "voiceProcessing": vp,
      "aec": vp,
      "captureSampleRate": Int(Self.captureRate),
      "playbackSampleRate": Int(Self.playbackRate),
    ]
  }

  func startCapture(generation: Int) throws {
    lock.lock()
    let released = userReleased
    let current = self.generation
    let already = capturing
    lock.unlock()

    if released {
      throw VoiceAudioException("voice session was released")
    }
    if generation != current {
      throw VoiceAudioException("stale capture generation")
    }
    if already { return }

    try installTap()
    lock.lock()
    capturing = true
    lock.unlock()
  }

  func stopCapture() {
    removeTap()
    lock.lock()
    capturing = false
    lock.unlock()
  }

  func enqueuePlayback(_ data: Data, generation: Int) async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      scheduler.async {
        do {
          try self.waitAndSchedule(data, generation: generation)
          cont.resume()
        } catch {
          cont.resume(throwing: error)
        }
      }
    }
  }

  func flushPlayback() {
    playGate.lock()
    playEpoch += 1
    pendingBuffers = 0
    queuedBytes = 0
    playGate.broadcast()
    playGate.unlock()

    lock.lock()
    let node = player
    let gen = generation
    lock.unlock()

    node?.stop()
    node?.play()
    emitOnMain("onPlaybackIdle", ["generation": gen])
  }

  func releaseResources() {
    lock.lock()
    userReleased = true
    capturing = false
    wasCapturingBeforeInterruption = false
    lock.unlock()

    playGate.lock()
    playEpoch += 1
    pendingBuffers = 0
    queuedBytes = 0
    playGate.broadcast()
    playGate.unlock()

    removeTap()
    player?.stop()
    engine?.stop()
    engine = nil
    player = nil
    captureConverter = nil
    captureFormat = nil
    removeNotifications()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  // MARK: - Session / engine

  private func configureSession() throws {
    let session = AVAudioSession.sharedInstance()
    // HFP = BT headset mic+ear. A2DP = stereo headphones (no mic).
    // defaultToSpeaker is only the no-headset fallback (not the receiver).
    var options: AVAudioSession.CategoryOptions = [
      .defaultToSpeaker,
      .allowBluetoothHFP,
      .allowBluetoothA2DP,
    ]
    if #available(iOS 14.5, *) {
      options.insert(.overrideMutedMicrophoneInterruption)
    }
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: options)
    try session.setPreferredSampleRate(Self.captureRate)
    try session.setPreferredIOBufferDuration(0.02)
    try session.setActive(true)
    applyPreferredRoute()
  }

  /// Headphones / BT / car / USB win. Speaker override is sticky on iOS, so
  /// it must be cleared (`.none`) whenever an external route is present —
  /// otherwise TTS stays on the speaker after you plug in headphones.
  private func applyPreferredRoute() {
    let session = AVAudioSession.sharedInstance()
    let external: Set<AVAudioSession.Port> = [
      .headphones, .headsetMic, .bluetoothA2DP, .bluetoothHFP, .bluetoothLE,
      .carAudio, .usbAudio,
    ]
    let usingExternal =
      session.currentRoute.outputs.contains { external.contains($0.portType) }
      || session.currentRoute.inputs.contains { external.contains($0.portType) }
    do {
      try session.overrideOutputAudioPort(usingExternal ? .none : .speaker)
    } catch {
      emitOnMain("onWarning", [
        "generation": currentGeneration(),
        "message": "audio route override failed: \(error.localizedDescription)",
      ])
    }
  }

  private func startEngineIfNeeded() throws {
    if engine?.isRunning == true { return }

    let newEngine = AVAudioEngine()
    let newPlayer = AVAudioPlayerNode()
    newEngine.attach(newPlayer)

    var vp = false
    do {
      try newEngine.inputNode.setVoiceProcessingEnabled(true)
      vp = true
    } catch {
      vp = false
      emitOnMain("onWarning", [
        "generation": currentGeneration(),
        "message": "voice processing/AEC unavailable: \(error.localizedDescription)",
      ])
    }

    guard let playFormat = AVAudioFormat(
      standardFormatWithSampleRate: Self.playbackRate,
      channels: 1
    ) else {
      throw VoiceAudioException("24 kHz mono playback format is not supported")
    }
    newEngine.connect(newPlayer, to: newEngine.mainMixerNode, format: playFormat)

    try newEngine.start()
    newPlayer.play()

    lock.lock()
    engine = newEngine
    player = newPlayer
    voiceProcessingEnabled = vp
    lock.unlock()
  }

  private func installTap() throws {
    guard let engine else {
      throw VoiceAudioException("audio engine is not prepared")
    }
    let input = engine.inputNode
    let hwFormat = input.outputFormat(forBus: 0)
    guard hwFormat.sampleRate > 0, hwFormat.channelCount > 0 else {
      throw VoiceAudioException("input hardware format is not ready")
    }
    guard let target = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: Self.captureRate,
      channels: 1,
      interleaved: true
    ) else {
      throw VoiceAudioException("16 kHz mono int16 capture format is not supported")
    }
    guard let converter = AVAudioConverter(from: hwFormat, to: target) else {
      throw VoiceAudioException("native capture converter could not be created")
    }

    if tapInstalled {
      input.removeTap(onBus: 0)
      tapInstalled = false
    }
    let bufferSize = AVAudioFrameCount(max(512, hwFormat.sampleRate * 0.1))
    input.installTap(onBus: 0, bufferSize: bufferSize, format: hwFormat) { [weak self] buffer, _ in
      self?.convertAndEmit(buffer: buffer, converter: converter, target: target)
    }
    tapInstalled = true

    lock.lock()
    captureConverter = converter
    captureFormat = target
    lock.unlock()

    if !engine.isRunning {
      try engine.start()
    }
  }

  private func removeTap() {
    guard tapInstalled else { return }
    tapInstalled = false
    engine?.inputNode.removeTap(onBus: 0)
    lock.lock()
    captureConverter = nil
    lock.unlock()
  }

  private func convertAndEmit(
    buffer: AVAudioPCMBuffer,
    converter: AVAudioConverter,
    target: AVAudioFormat
  ) {
    lock.lock()
    let shouldEmit = capturing && !userReleased
    let gen = generation
    lock.unlock()
    guard shouldEmit, buffer.frameLength > 0 else { return }

    let ratio = target.sampleRate / buffer.format.sampleRate
    let frames = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
    guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: frames) else { return }

    var error: NSError?
    var consumed = false
    converter.convert(to: out, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return buffer
    }

    if let error {
      emitOnMain("onWarning", [
        "generation": gen,
        "message": "capture convert failed: \(error.localizedDescription)",
      ])
      return
    }
    guard out.frameLength > 0, let channel = out.int16ChannelData else { return }

    let byteCount = Int(out.frameLength) * MemoryLayout<Int16>.size
    let data = Data(bytes: channel[0], count: byteCount)
    emitOnMain("onCapture", [
      "generation": gen,
      "pcmBase64": data.base64EncodedString(),
      "byteLength": byteCount,
    ])
  }

  private func int16le24kToFloatBuffer(_ data: Data) -> AVAudioPCMBuffer? {
    let frames = data.count / MemoryLayout<Int16>.size
    guard frames > 0 else { return nil }
    guard let format = AVAudioFormat(
      standardFormatWithSampleRate: Self.playbackRate,
      channels: 1
    ) else { return nil }
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames))
    else { return nil }
    buffer.frameLength = AVAudioFrameCount(frames)
    guard let dst = buffer.floatChannelData?[0] else { return nil }

    data.withUnsafeBytes { raw in
      let src = raw.bindMemory(to: Int16.self)
      for i in 0..<frames {
        dst[i] = Float(src[i]) / 32768.0
      }
    }
    return buffer
  }

  private func waitAndSchedule(_ data: Data, generation: Int) throws {
    let evenCount = data.count - (data.count % 2)
    guard evenCount >= 2 else { return }
    let pcm = Data(evenCount == data.count ? data : data.prefix(evenCount))

    playGate.lock()
    let started = Date()
    while true {
      lock.lock()
      let released = userReleased
      let current = self.generation
      lock.unlock()
      if released || generation != current {
        playGate.unlock()
        return
      }
      if queuedBytes + pcm.count <= Self.maxQueuedBytes &&
        pendingBuffers < Self.maxScheduledBuffers
      {
        break
      }
      if Date().timeIntervalSince(started) >= Self.backpressureTimeout {
        playGate.unlock()
        throw VoiceAudioException(
          "playback queue backpressure timed out after \(Int(Self.backpressureTimeout))s"
        )
      }
      playGate.wait(until: Date().addingTimeInterval(0.05))
    }
    let epoch = playEpoch
    queuedBytes += pcm.count
    pendingBuffers += 1
    playGate.unlock()

    lock.lock()
    let node = player
    lock.unlock()
    guard let node, let buffer = int16le24kToFloatBuffer(pcm) else {
      playGate.lock()
      queuedBytes = max(0, queuedBytes - pcm.count)
      pendingBuffers = max(0, pendingBuffers - 1)
      playGate.broadcast()
      playGate.unlock()
      return
    }
    if !node.isPlaying {
      node.play()
    }
    node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.bufferFinished(epoch: epoch, byteCount: pcm.count)
    }
  }

  private func bufferFinished(epoch: Int, byteCount: Int) {
    playGate.lock()
    guard epoch == playEpoch else {
      playGate.unlock()
      return
    }
    pendingBuffers = max(0, pendingBuffers - 1)
    queuedBytes = max(0, queuedBytes - byteCount)
    let idle = pendingBuffers == 0 && queuedBytes == 0
    playGate.broadcast()
    playGate.unlock()

    lock.lock()
    let gen = generation
    lock.unlock()
    if idle {
      emitOnMain("onPlaybackIdle", ["generation": gen])
    }
  }

  // MARK: - Interruptions / routes

  private func installNotifications() {
    removeNotifications()
    let center = NotificationCenter.default
    observers.append(
      center.addObserver(
        forName: AVAudioSession.interruptionNotification,
        object: AVAudioSession.sharedInstance(),
        queue: .main
      ) { [weak self] note in
        self?.handleInterruption(note)
      }
    )
    observers.append(
      center.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: AVAudioSession.sharedInstance(),
        queue: .main
      ) { [weak self] note in
        self?.handleRouteChange(note)
      }
    )
    observers.append(
      center.addObserver(
        forName: AVAudioSession.mediaServicesWereResetNotification,
        object: AVAudioSession.sharedInstance(),
        queue: .main
      ) { [weak self] _ in
        self?.handleMediaReset()
      }
    )
  }

  private func removeNotifications() {
    let center = NotificationCenter.default
    for token in observers {
      center.removeObserver(token)
    }
    observers.removeAll()
  }

  private func handleInterruption(_ note: Notification) {
    guard let info = note.userInfo,
          let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw)
    else { return }

    switch type {
    case .began:
      lock.lock()
      wasCapturingBeforeInterruption = capturing
      capturing = false
      lock.unlock()
      player?.pause()
      removeTap()
    case .ended:
      lock.lock()
      let released = userReleased
      let handsfree = mode == "handsfree"
      let resumeCapture = wasCapturingBeforeInterruption && handsfree
      lock.unlock()
      guard !released else { return }

      let options = (info[AVAudioSessionInterruptionOptionKey] as? UInt)
        .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
      guard options.contains(.shouldResume) else {
        emitOnMain("onError", [
          "generation": currentGeneration(),
          "message": "microphone capture ended after audio interruption (no resume permission)",
        ])
        return
      }

      do {
        try AVAudioSession.sharedInstance().setActive(true)
        applyPreferredRoute()
        if engine?.isRunning != true {
          try engine?.start()
        }
        player?.play()
        if resumeCapture {
          try installTap()
          lock.lock()
          capturing = true
          lock.unlock()
        }
      } catch {
        emitOnMain("onWarning", [
          "generation": currentGeneration(),
          "message": "failed to resume after interruption: \(error.localizedDescription)",
        ])
      }
    @unknown default:
      break
    }
  }

  private func handleRouteChange(_ note: Notification) {
    lock.lock()
    let released = userReleased
    let recapture = capturing
    lock.unlock()
    guard !released else { return }
    applyPreferredRoute()
    // HFP vs built-in changes the hardware format; the tap must be rebuilt
    // or capture goes silent after plugging headphones in or out.
    if recapture {
      removeTap()
      do {
        try installTap()
      } catch {
        emitOnMain("onWarning", [
          "generation": currentGeneration(),
          "message": "failed to rebuild capture after route change: \(error.localizedDescription)",
        ])
      }
    }
  }

  private func handleMediaReset() {
    lock.lock()
    let released = userReleased
    let gen = generation
    let currentMode = mode
    let resumeCapture = capturing && currentMode == "handsfree"
    lock.unlock()
    guard !released else { return }

    do {
      try configureSession()
      removeTap()
      engine?.stop()
      engine = nil
      player = nil
      try startEngineIfNeeded()
      if resumeCapture {
        try installTap()
        lock.lock()
        capturing = true
        lock.unlock()
      }
    } catch {
      emitOnMain("onError", [
        "generation": gen,
        "message": "audio session reset failed: \(error.localizedDescription)",
      ])
    }
  }

  private func emitOnMain(_ name: String, _ payload: [String: Any]) {
    if Thread.isMainThread {
      emit(name, payload)
    } else {
      DispatchQueue.main.async { [weak self] in
        self?.emit(name, payload)
      }
    }
  }
}

internal final class VoiceAudioException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    param
  }
}
