package dev.agenttts.voiceaudio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Owns the process keep-alive for AudioRecord / AudioTrack. Starting the
 * session must happen while the activity is still in the foreground
 * (Android 12+ / API 31). Android 14 requires the FGS types used below.
 * Force-quit / swipe-away cannot auto-restart this service.
 *
 * Engine lifetime is owned by VoiceAudioModule. onDestroy only marks the
 * service stopped so a reconnect prepare cannot be torn down by a stale stop.
 */
class VoiceAudioService : Service() {
  private var instanceGeneration = 0

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instanceGeneration = gate.attachInstance()
    startInForeground()
    gate.onStarted()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopForegroundCompat()
      stopSelf()
      return START_NOT_STICKY
    }
    startInForeground()
    gate.onStarted()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    gate.onInstanceDestroyed(instanceGeneration)
    super.onDestroy()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    VoiceAudioRuntime.engine.releaseResources()
    stopForegroundCompat()
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  private fun startInForeground() {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= 30) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
      )
    } else if (Build.VERSION.SDK_INT >= 29) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= 24) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Voice session",
        NotificationManager.IMPORTANCE_LOW,
      )
      channel.description = "Keeps microphone capture and PCM playback alive"
      channel.setSound(null, null)
      manager.createNotificationChannel(channel)
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("agent_tts")
      .setContentText("Voice session active")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  companion object {
    const val ACTION_START = "dev.agenttts.voiceaudio.START"
    const val ACTION_STOP = "dev.agenttts.voiceaudio.STOP"
    private const val CHANNEL_ID = "agent_tts_voice"
    private const val NOTIFICATION_ID = 4101

    internal val gate = ServiceGate()

    fun isRunning(): Boolean = gate.state() == ServiceGate.State.RUNNING

    fun startAndAwait(context: Context) {
      gate.startAndAwait {
        val intent = Intent(context, VoiceAudioService::class.java).setAction(ACTION_START)
        if (Build.VERSION.SDK_INT >= 26) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      }
    }

    fun stopAndAwait(context: Context) {
      gate.stopAndAwait { sendStop(context) }
    }

    /** Last-resort stop for module destroy. Session release uses [stopAndAwait]. */
    fun stop(context: Context) {
      sendStop(context)
    }

    private fun sendStop(context: Context) {
      val intent = Intent(context, VoiceAudioService::class.java).setAction(ACTION_STOP)
      try {
        context.startService(intent)
      } catch (_: Exception) {
        context.stopService(Intent(context, VoiceAudioService::class.java))
      }
    }
  }
}
