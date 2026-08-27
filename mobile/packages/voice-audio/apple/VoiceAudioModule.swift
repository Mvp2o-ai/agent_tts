import AVFoundation
import ExpoModulesCore

public class VoiceAudioModule: Module {
  private var engine: VoiceAudioEngine?

  public func definition() -> ModuleDefinition {
    Name("VoiceAudio")

    Events("onCapture", "onPlaybackIdle", "onWarning", "onError")

    OnCreate {
      self.engine = VoiceAudioEngine { [weak self] name, payload in
        self?.sendEvent(name, payload)
      }
    }

    OnDestroy {
      self.engine?.releaseResources()
      self.engine = nil
    }

    AsyncFunction("requestPermissionsAsync") { (promise: Promise) in
      let session = AVAudioSession.sharedInstance()
      switch session.recordPermission {
      case .granted:
        promise.resolve(Self.permissionPayload(granted: true, status: "granted"))
        return
      case .denied:
        promise.resolve(Self.permissionPayload(granted: false, status: "denied", canAskAgain: false))
        return
      case .undetermined:
        break
      @unknown default:
        break
      }
      session.requestRecordPermission { granted in
        promise.resolve(
          Self.permissionPayload(
            granted: granted,
            status: granted ? "granted" : "denied",
            canAskAgain: granted
          )
        )
      }
    }

    AsyncFunction("prepare") { (generation: Int, mode: String) -> [String: Any] in
      guard let engine = self.engine else {
        throw VoiceAudioException("voice engine is not available")
      }
      return try engine.prepare(generation: generation, mode: mode)
    }

    AsyncFunction("startCapture") { (generation: Int) in
      try self.engine?.startCapture(generation: generation)
    }

    AsyncFunction("stopCapture") {
      self.engine?.stopCapture()
    }

    // Expo Modules API 57 ConcurrentFunction: async/await off the JS actor
    // so NSCondition backpressure does not block UI or the module queue.
    AsyncFunction("enqueuePlayback") { (pcm: Data, generation: Int) async throws in
      guard let engine = self.engine else {
        throw VoiceAudioException("voice engine is not available")
      }
      try await engine.enqueuePlayback(pcm, generation: generation)
    }

    AsyncFunction("flushPlayback") {
      self.engine?.flushPlayback()
    }

    AsyncFunction("release") {
      self.engine?.releaseResources()
    }
  }

  private static func permissionPayload(
    granted: Bool,
    status: String,
    canAskAgain: Bool = true
  ) -> [String: Any] {
    [
      "granted": granted,
      "status": status,
      "canAskAgain": canAskAgain,
    ]
  }
}
