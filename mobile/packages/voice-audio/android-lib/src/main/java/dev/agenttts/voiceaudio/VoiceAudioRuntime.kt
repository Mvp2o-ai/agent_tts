package dev.agenttts.voiceaudio

import kotlinx.coroutines.CoroutineName
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

internal object VoiceAudioRuntime {
  @Volatile var module: VoiceAudioModule? = null

  val engine: VoiceAudioEngine = VoiceAudioEngine { name, payload ->
    module?.emitBridge(name, payload)
  }

  val router: VoiceAudioRouter = VoiceAudioRouter { name, payload ->
    module?.emitBridge(name, payload)
  }

  /**
   * Expo 57 `AsyncFunction` defaults to the single-thread `modulesQueue`.
   * Playback backpressure waits here on `Dispatchers.IO` instead.
   */
  val ioScope: CoroutineScope = CoroutineScope(
    Dispatchers.IO + SupervisorJob() + CoroutineName("voice-audio-io"),
  )
}
