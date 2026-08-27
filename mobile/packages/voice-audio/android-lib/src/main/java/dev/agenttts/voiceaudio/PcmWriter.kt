package dev.agenttts.voiceaudio

/**
 * Streaming PCM sink. `write` may return a partial positive count, 0 (try
 * again), or a negative error code. Matches `writeAllPcm` in playback-path.ts.
 */
fun interface PcmSink {
  fun write(source: ByteArray, offset: Int, length: Int): Int
}

data class WriteAllResult(
  val written: Int,
  val cancelled: Boolean,
)

object PcmWriter {
  const val MAX_ZERO_RETRIES = 50
  const val ZERO_SLEEP_MS = 2L

  fun writeAll(
    sink: PcmSink,
    chunk: ByteArray,
    maxZeros: Int = MAX_ZERO_RETRIES,
    sleepMs: (Long) -> Unit = { Thread.sleep(it) },
    stillCurrent: () -> Boolean = { true },
  ): WriteAllResult {
    var offset = 0
    var zeros = 0
    while (offset < chunk.size) {
      if (!stillCurrent()) return WriteAllResult(offset, cancelled = true)
      val n = sink.write(chunk, offset, chunk.size - offset)
      if (!stillCurrent()) {
        return WriteAllResult(offset + if (n > 0) n else 0, cancelled = true)
      }
      if (n > 0) {
        offset += n
        zeros = 0
        continue
      }
      if (n == 0) {
        zeros += 1
        if (zeros > maxZeros) {
          throw IllegalStateException("pcm write returned 0 repeatedly")
        }
        sleepMs(ZERO_SLEEP_MS)
        continue
      }
      throw IllegalStateException("pcm write failed with code $n")
    }
    return WriteAllResult(offset, cancelled = false)
  }
}
