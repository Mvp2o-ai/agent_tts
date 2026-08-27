package dev.agenttts.voiceaudio

enum class CaptureEnd {
  INTENTIONAL,
  UNEXPECTED,
}

/**
 * Shared capture-loop exit rules. Unexpected end (read error/exception while
 * the session still wants capture) must be visible. Intentional stop/release/
 * generation change must not emit.
 */
object CaptureLoop {
  fun run(
    shouldContinue: () -> Boolean,
    read: () -> Int,
    onFrame: (Int) -> Unit,
  ): CaptureEnd {
    try {
      while (shouldContinue()) {
        val n = read()
        if (n < 0) break
        if (n <= 1) continue
        onFrame(n)
      }
    } catch (_: Exception) {
      return if (shouldContinue()) CaptureEnd.UNEXPECTED else CaptureEnd.INTENTIONAL
    }
    return if (shouldContinue()) CaptureEnd.UNEXPECTED else CaptureEnd.INTENTIONAL
  }
}

/** Prevents removeTap without a matching install (AVAudioEngine assertion). */
class TapInstallState {
  var installed: Boolean = false
    private set

  fun install(removeIfPresent: () -> Unit, install: () -> Unit) {
    if (installed) removeIfPresent()
    install()
    installed = true
  }

  fun remove(removeIfPresent: () -> Unit) {
    if (!installed) return
    removeIfPresent()
    installed = false
  }
}
