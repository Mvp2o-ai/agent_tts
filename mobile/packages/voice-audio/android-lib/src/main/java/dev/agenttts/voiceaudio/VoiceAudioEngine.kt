package dev.agenttts.voiceaudio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max

/**
 * Process-local PCM engine. A foreground service keeps this alive; the Expo
 * module is only the JS bridge. Playback is a per-session run object: prepare
 * after release always starts a new queue and worker.
 */
class VoiceAudioEngine(
  private val emit: (name: String, payload: Map<String, Any?>) -> Unit,
) {
  companion object {
    const val CAPTURE_RATE = 16_000
    const val PLAYBACK_RATE = PlaybackLimits.SAMPLE_RATE
  }

  @Volatile var generation: Int = 0
    private set
  @Volatile private var mode: String = "ptt"
  @Volatile private var userReleased: Boolean = true
  @Volatile private var capturing: Boolean = false

  private var record: AudioRecord? = null
  private var aec: AcousticEchoCanceler? = null
  private var captureThread: Thread? = null
  private val captureEpoch = AtomicInteger(0)

  private val mainHandler = Handler(Looper.getMainLooper())
  private val playback = PlaybackCoordinator { bindTrack() }

  init {
    playback.onIdle = {
      emitOnMain("onPlaybackIdle", mapOf("generation" to generation))
    }
    playback.onWriteError = { message ->
      emitOnMain("onError", mapOf("generation" to generation, "message" to message))
    }
  }

  @Synchronized
  fun prepare(generation: Int, mode: String): Map<String, Any> {
    stopCaptureLocked(join = true)
    userReleased = false
    this.generation = generation
    this.mode = mode
    playback.prepare()
    val aecOn = AcousticEchoCanceler.isAvailable()
    return mapOf(
      "voiceProcessing" to aecOn,
      "aec" to aecOn,
      "captureSampleRate" to CAPTURE_RATE,
      "playbackSampleRate" to PLAYBACK_RATE,
    )
  }

  @Synchronized
  fun startCapture(generation: Int) {
    if (userReleased) {
      throw VoiceAudioException("voice session was released")
    }
    if (generation != this.generation) {
      throw VoiceAudioException("stale capture generation")
    }
    if (capturing) return
    val rec = buildRecorder()
    record = rec
    try {
      rec.startRecording()
    } catch (err: Exception) {
      rec.release()
      record = null
      throw err
    }
    capturing = true
    val epoch = captureEpoch.incrementAndGet()
    val expectedGeneration = this.generation
    captureThread = Thread(
      { captureLoop(rec, expectedGeneration, epoch) },
      "voice-audio-capture",
    ).also {
      it.isDaemon = true
      it.start()
    }
  }

  @Synchronized
  fun stopCapture() {
    stopCaptureLocked(join = true)
  }

  /**
   * Blocks the caller (must be Expo IO / modules-off-main) until the byte
   * budget has room or the chunk is invalidated.
   */
  fun enqueuePlayback(pcm: ByteArray, generation: Int) {
    if (userReleased || generation != this.generation) return
    val even = if (pcm.size % 2 == 0) pcm else pcm.copyOf(pcm.size - (pcm.size % 2))
    if (even.isEmpty()) return
    when (playback.enqueue(even)) {
      EnqueueResult.ACCEPTED -> Unit
      EnqueueResult.INVALIDATED -> return
      EnqueueResult.TIMEOUT -> throw VoiceAudioException(
        "playback queue backpressure timed out after ${PlaybackLimits.BACKPRESSURE_TIMEOUT_MS}ms " +
          "(${even.size} bytes)",
      )
    }
  }

  fun flushPlayback() {
    playback.flush()
    emitOnMain("onPlaybackIdle", mapOf("generation" to generation))
  }

  @Synchronized
  fun releaseResources() {
    userReleased = true
    stopCaptureLocked(join = true)
    playback.release()
  }

  private fun stopCaptureLocked(join: Boolean) {
    captureEpoch.incrementAndGet()
    capturing = false
    val thread = captureThread
    captureThread = null
    try {
      record?.stop()
    } catch (_: Exception) {
    }
    try {
      record?.release()
    } catch (_: Exception) {
    }
    record = null
    releaseAec()
    if (join) thread?.join(500)
  }

  private fun bindTrack(): PlaybackCoordinator.Hardware {
    val track = buildTrack()
    try {
      track.play()
    } catch (_: Exception) {
    }
    val sink = PcmSink { source, offset, length ->
      try {
        if (track.playState != AudioTrack.PLAYSTATE_PLAYING) {
          track.play()
        }
        track.write(source, offset, length)
      } catch (_: Exception) {
        -1
      }
    }
    return PlaybackCoordinator.Hardware(
      sink = sink,
      onFlush = {
        try {
          track.pause()
          track.flush()
          track.play()
        } catch (_: Exception) {
        }
      },
      onRelease = {
        try {
          track.pause()
          track.flush()
          track.stop()
          track.release()
        } catch (_: Exception) {
        }
      },
    )
  }

  private fun buildRecorder(): AudioRecord {
    val min = AudioRecord.getMinBufferSize(
      CAPTURE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    if (min <= 0) {
      throw IllegalStateException("AudioRecord buffer size is unavailable")
    }
    val buf = max(min, CAPTURE_RATE * 2 / 5)
    val rec = AudioRecord(
      MediaRecorder.AudioSource.VOICE_COMMUNICATION,
      CAPTURE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      buf,
    )
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      throw IllegalStateException("AudioRecord failed to initialize")
    }
    enableAec(rec)
    return rec
  }

  private fun enableAec(rec: AudioRecord) {
    releaseAec()
    if (!AcousticEchoCanceler.isAvailable()) {
      emitOnMain(
        "onWarning",
        mapOf(
          "generation" to generation,
          "message" to "AcousticEchoCanceler is not available on this device",
        ),
      )
      return
    }
    try {
      val created = AcousticEchoCanceler.create(rec.audioSessionId)
      if (created == null) {
        emitOnMain(
          "onWarning",
          mapOf(
            "generation" to generation,
            "message" to "AcousticEchoCanceler.create returned null",
          ),
        )
        return
      }
      created.enabled = true
      aec = created
    } catch (err: Exception) {
      emitOnMain(
        "onWarning",
        mapOf(
          "generation" to generation,
          "message" to "AcousticEchoCanceler failed: ${err.message}",
        ),
      )
    }
  }

  private fun releaseAec() {
    try {
      aec?.enabled = false
      aec?.release()
    } catch (_: Exception) {
    }
    aec = null
  }

  private fun buildTrack(): AudioTrack {
    val min = AudioTrack.getMinBufferSize(
      PLAYBACK_RATE,
      AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    val buf = max(min, PLAYBACK_RATE * 2 / 5)
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setSampleRate(PLAYBACK_RATE)
      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
      .build()
    val builder = AudioTrack.Builder()
      .setAudioAttributes(attrs)
      .setAudioFormat(format)
      .setBufferSizeInBytes(buf)
      .setTransferMode(AudioTrack.MODE_STREAM)
    if (Build.VERSION.SDK_INT >= 26) {
      builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
    }
    val created = builder.build()
    if (created.state != AudioTrack.STATE_INITIALIZED) {
      created.release()
      throw IllegalStateException("AudioTrack failed to initialize")
    }
    return created
  }

  private fun captureLoop(rec: AudioRecord, expectedGeneration: Int, epoch: Int) {
    val buf = ByteArray(max(640, rec.bufferSizeInFrames.coerceAtLeast(320) * 2))
    val end = CaptureLoop.run(
      shouldContinue = {
        capturing && !userReleased && generation == expectedGeneration &&
          captureEpoch.get() == epoch
      },
      read = {
        rec.read(buf, 0, buf.size)
      },
      onFrame = { n ->
        val even = n - (n % 2)
        val slice = buf.copyOf(even)
        val b64 = Base64.encodeToString(slice, Base64.NO_WRAP)
        emitOnMain(
          "onCapture",
          mapOf(
            "generation" to expectedGeneration,
            "pcmBase64" to b64,
            "byteLength" to even,
          ),
        )
      },
    )
    if (end == CaptureEnd.UNEXPECTED) {
      capturing = false
      emitOnMain(
        "onError",
        mapOf(
          "generation" to expectedGeneration,
          "message" to "microphone capture ended unexpectedly",
        ),
      )
    }
  }

  private fun emitOnMain(name: String, payload: Map<String, Any?>) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      emit(name, payload)
    } else {
      mainHandler.post { emit(name, payload) }
    }
  }
}
