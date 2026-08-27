package dev.agenttts.voiceaudio

import java.util.ArrayDeque
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** Matches `src/playback-path.ts`. 24 kHz s16le mono × 180 s ≈ 8.2 MB. */
object PlaybackLimits {
  const val SAMPLE_RATE = 24_000
  const val MAX_SECONDS = 180
  const val MAX_BYTES = SAMPLE_RATE * 2 * MAX_SECONDS
  const val BACKPRESSURE_TIMEOUT_MS = 15_000L
}

enum class EnqueueResult {
  ACCEPTED,
  INVALIDATED,
  TIMEOUT,
}

sealed class TakeResult {
  data class Chunk(val bytes: ByteArray, val epoch: Int) : TakeResult()
  object Idle : TakeResult()
  object Closed : TakeResult()
}

/**
 * Byte-bounded FIFO. Producers wait until capacity exists. Flush/close bump
 * epoch, wake waiters, and discard only intentionally invalidated audio.
 * Close is terminal for this instance; callers must allocate a new queue
 * for the next session.
 */
class PlaybackQueue(
  private val maxBytes: Int = PlaybackLimits.MAX_BYTES,
) {
  private val lock = ReentrantLock()
  private val notFull = lock.newCondition()
  private val notEmpty = lock.newCondition()
  private val chunks = ArrayDeque<ByteArray>()
  private var bytes = 0
  private var epoch = 0
  private var closed = false

  fun queuedBytes(): Int = lock.withLock { bytes }

  fun currentEpoch(): Int = lock.withLock { epoch }

  fun isClosed(): Boolean = lock.withLock { closed }

  fun put(chunk: ByteArray, expectedEpoch: Int, generationStillValid: () -> Boolean): EnqueueResult {
    if (chunk.isEmpty()) return EnqueueResult.ACCEPTED
    val deadline = System.nanoTime() +
      TimeUnit.MILLISECONDS.toNanos(PlaybackLimits.BACKPRESSURE_TIMEOUT_MS)
    lock.withLock {
      while (true) {
        if (closed || expectedEpoch != epoch || !generationStillValid()) {
          return EnqueueResult.INVALIDATED
        }
        if (bytes + chunk.size <= maxBytes) {
          chunks.addLast(chunk)
          bytes += chunk.size
          notEmpty.signal()
          return EnqueueResult.ACCEPTED
        }
        val remaining = deadline - System.nanoTime()
        if (remaining <= 0) return EnqueueResult.TIMEOUT
        notFull.awaitNanos(remaining)
      }
    }
  }

  fun take(timeoutMs: Long): TakeResult {
    lock.withLock {
      val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
      while (chunks.isEmpty()) {
        if (closed) return TakeResult.Closed
        val remaining = deadline - System.nanoTime()
        if (remaining <= 0) return TakeResult.Idle
        notEmpty.awaitNanos(remaining)
      }
      if (closed) return TakeResult.Closed
      val next = chunks.pollFirst() ?: return if (closed) TakeResult.Closed else TakeResult.Idle
      bytes -= next.size
      val takenEpoch = epoch
      notFull.signalAll()
      return TakeResult.Chunk(next, takenEpoch)
    }
  }

  fun flush(): Int = lock.withLock {
    epoch += 1
    chunks.clear()
    bytes = 0
    notFull.signalAll()
    notEmpty.signalAll()
    epoch
  }

  fun close() {
    lock.withLock {
      closed = true
      epoch += 1
      chunks.clear()
      bytes = 0
      notFull.signalAll()
      notEmpty.signalAll()
    }
  }

  fun isIdle(): Boolean = lock.withLock { chunks.isEmpty() && bytes <= 0 }
}
