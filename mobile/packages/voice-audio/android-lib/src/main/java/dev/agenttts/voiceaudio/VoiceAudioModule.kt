package dev.agenttts.voiceaudio

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

internal class VoiceAudioException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

class VoiceAudioModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VoiceAudio")

    Events("onCapture", "onPlaybackIdle", "onWarning", "onError")

    OnCreate {
      VoiceAudioRuntime.module = this@VoiceAudioModule
    }

    OnDestroy {
      VoiceAudioRuntime.module = null
      VoiceAudioRuntime.engine.releaseResources()
      VoiceAudioRuntime.router.release()
      appContext.reactContext?.let { VoiceAudioService.stop(it) }
    }

    AsyncFunction("requestPermissionsAsync") { promise: Promise ->
      val context = appContext.reactContext
        ?: throw VoiceAudioException("React context is lost")
      val mic = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
      val granted = mic == PackageManager.PERMISSION_GRANTED
      promise.resolve(
        mapOf(
          "granted" to granted,
          "status" to if (granted) "granted" else "denied",
          "canAskAgain" to !granted,
        ),
      )
    }

    AsyncFunction("prepare") { generation: Int, mode: String ->
      val context = appContext.reactContext
        ?: throw VoiceAudioException("React context is lost")
      val mic = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
      if (mic != PackageManager.PERMISSION_GRANTED) {
        throw VoiceAudioException("RECORD_AUDIO is not granted")
      }
      val activity = appContext.currentActivity
      requireForegroundActivity(activity)
      try {
        VoiceAudioService.startAndAwait(context)
      } catch (err: Exception) {
        try {
          VoiceAudioService.stopAndAwait(context)
        } catch (_: Exception) {
        }
        val blocked = Build.VERSION.SDK_INT >= 31 &&
          err.javaClass.name == "android.app.ForegroundServiceStartNotAllowedException"
        val detail = if (blocked) {
          "foreground service could not start from background (API ${Build.VERSION.SDK_INT}). " +
            "Start the voice session while the app is in the foreground."
        } else {
          err.message ?: "foreground service failed to start"
        }
        throw VoiceAudioException(detail, err)
      }
      if (!VoiceAudioService.isRunning()) {
        throw VoiceAudioException(
          "voice foreground service is not running; background capture is not protected",
        )
      }
      VoiceAudioRuntime.router.attach(context, generation)
      VoiceAudioRuntime.engine.prepare(generation, mode)
    }

    AsyncFunction("startCapture") { generation: Int ->
      VoiceAudioRuntime.engine.startCapture(generation)
    }

    AsyncFunction("stopCapture") {
      VoiceAudioRuntime.engine.stopCapture()
    }

    // Expo Modules API 57: ByteArray ↔ Uint8Array. runOnQueue(IO) so
    // PlaybackQueue.put can block without stalling modulesQueue / UI.
    AsyncFunction("enqueuePlayback") { pcm: ByteArray, generation: Int ->
      VoiceAudioRuntime.engine.enqueuePlayback(pcm, generation)
    }.runOnQueue(VoiceAudioRuntime.ioScope)

    AsyncFunction("flushPlayback") {
      VoiceAudioRuntime.engine.flushPlayback()
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("release") {
      VoiceAudioRuntime.engine.releaseResources()
      VoiceAudioRuntime.router.release()
      appContext.reactContext?.let { VoiceAudioService.stopAndAwait(it) }
    }.runOnQueue(VoiceAudioRuntime.ioScope)
  }

  fun emitBridge(name: String, payload: Map<String, Any?>) {
    sendEvent(name, payload)
  }

  private fun requireForegroundActivity(activity: Activity?) {
    if (activity == null) {
      throw VoiceAudioException(
        "Cannot start the voice foreground service without a foreground activity " +
          "(Android 12+ / API 31 restriction).",
      )
    }
    if (activity.isFinishing || activity.isDestroyed) {
      throw VoiceAudioException(
        "Cannot start the voice foreground service while the activity is finishing.",
      )
    }
  }
}
