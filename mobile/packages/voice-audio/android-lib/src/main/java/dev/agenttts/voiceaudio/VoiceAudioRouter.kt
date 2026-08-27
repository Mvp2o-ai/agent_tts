package dev.agenttts.voiceaudio

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * VoIP output routing: wired/USB/BT headphones take the stream; otherwise
 * the loudspeaker (never the earpiece). Bluetooth SCO is used only when an
 * SCO-capable headset is present so the headset mic works.
 */
class VoiceAudioRouter(
  private val emit: (name: String, payload: Map<String, Any?>) -> Unit,
) {
  @Volatile private var generation: Int = 0
  private var manager: AudioManager? = null
  private var callback: AudioDeviceCallback? = null
  private var scoStarted = false
  private val mainHandler = Handler(Looper.getMainLooper())

  @Synchronized
  fun attach(context: Context, generation: Int) {
    this.generation = generation
    val am = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    manager = am
    am.mode = AudioManager.MODE_IN_COMMUNICATION
    applyRoute()
    if (callback == null) {
      val cb = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) {
          applyRoute()
        }
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) {
          applyRoute()
        }
      }
      callback = cb
      am.registerAudioDeviceCallback(cb, mainHandler)
    }
  }

  @Synchronized
  fun release() {
    val am = manager ?: return
    callback?.let { am.unregisterAudioDeviceCallback(it) }
    callback = null
    stopSco(am)
    try {
      am.isSpeakerphoneOn = false
      am.mode = AudioManager.MODE_NORMAL
    } catch (_: Exception) {
    }
    manager = null
  }

  @Synchronized
  fun applyRoute() {
    val am = manager ?: return
    val outputs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val wired = outputs.any { it.type in WIRED_TYPES }
    val sco = outputs.any { it.type in SCO_TYPES }
    val a2dp = outputs.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP }

    am.mode = AudioManager.MODE_IN_COMMUNICATION
    when {
      wired -> {
        stopSco(am)
        am.isSpeakerphoneOn = false
      }
      sco -> {
        am.isSpeakerphoneOn = false
        startSco(am)
      }
      a2dp -> {
        stopSco(am)
        am.isSpeakerphoneOn = false
      }
      else -> {
        stopSco(am)
        am.isSpeakerphoneOn = true
      }
    }
  }

  private fun startSco(am: AudioManager) {
    if (scoStarted) return
    try {
      am.startBluetoothSco()
      am.isBluetoothScoOn = true
      scoStarted = true
    } catch (err: Exception) {
      emit(
        "onWarning",
        mapOf(
          "generation" to generation,
          "message" to "Bluetooth SCO failed: ${err.message}",
        ),
      )
    }
  }

  private fun stopSco(am: AudioManager) {
    if (!scoStarted && !am.isBluetoothScoOn) return
    try {
      am.isBluetoothScoOn = false
      am.stopBluetoothSco()
    } catch (_: Exception) {
    }
    scoStarted = false
  }

  companion object {
    private val WIRED_TYPES = setOf(
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_USB_HEADSET,
      AudioDeviceInfo.TYPE_USB_DEVICE,
    )
    private val SCO_TYPES: Set<Int> = buildSet {
      add(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
      if (Build.VERSION.SDK_INT >= 31) {
        add(AudioDeviceInfo.TYPE_BLE_HEADSET)
      }
    }
  }
}
