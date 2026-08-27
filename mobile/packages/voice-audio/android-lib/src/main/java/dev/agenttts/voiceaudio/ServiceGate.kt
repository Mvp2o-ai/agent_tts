package dev.agenttts.voiceaudio

import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Serialized FGS start/stop handshake. Prepare must not observe a stale
 * `running=true` from a session that is still stopping, and onDestroy of an
 * old service must not tear down a newly prepared engine.
 */
class ServiceGate(
  private val startTimeoutMs: Long = 2_000,
  private val stopTimeoutMs: Long = 2_000,
) {
  enum class State { STOPPED, STARTING, RUNNING, STOPPING }

  private val lock = ReentrantLock()
  private val started = lock.newCondition()
  private val stopped = lock.newCondition()
  private var state = State.STOPPED
  private var startGeneration = 0
  private var runningGeneration = 0

  var startInvocations = 0
    private set
  var stopInvocations = 0
    private set

  fun state(): State = lock.withLock { state }

  fun runningGeneration(): Int = lock.withLock { runningGeneration }

  fun attachInstance(): Int = lock.withLock { startGeneration }

  fun startAndAwait(doStart: () -> Unit) {
    val myGen: Int
    lock.withLock {
      awaitNotStoppingLocked()
      if (state == State.RUNNING) return
      if (state == State.STARTING) {
        awaitRunningLocked(startTimeoutMs)
        if (state == State.RUNNING) return
        awaitNotStoppingLocked()
        if (state == State.RUNNING) return
      }
      state = State.STARTING
      startGeneration += 1
      myGen = startGeneration
      startInvocations += 1
    }
    try {
      doStart()
    } catch (err: Exception) {
      lock.withLock {
        if (state == State.STARTING && startGeneration == myGen) {
          state = State.STOPPED
          stopped.signalAll()
        }
      }
      throw err
    }
    lock.withLock {
      awaitRunningGenerationLocked(myGen, startTimeoutMs)
    }
  }

  fun stopAndAwait(doStop: () -> Unit) {
    lock.withLock {
      if (state == State.STOPPED) return
      awaitNotStartingLocked()
      if (state == State.STOPPED) return
      if (state != State.STOPPING) {
        state = State.STOPPING
        stopInvocations += 1
      }
    }
    doStop()
    lock.withLock {
      val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(stopTimeoutMs)
      while (state != State.STOPPED) {
        val remaining = deadline - System.nanoTime()
        if (remaining <= 0) {
          throw IllegalStateException(
            "voice foreground service did not stop within ${stopTimeoutMs}ms",
          )
        }
        stopped.awaitNanos(remaining)
      }
    }
  }

  fun onStarted() {
    lock.withLock {
      if (state != State.STARTING) return
      runningGeneration = startGeneration
      state = State.RUNNING
      started.signalAll()
    }
  }

  fun onStopped() {
    lock.withLock {
      if (state != State.STOPPING) return
      state = State.STOPPED
      stopped.signalAll()
      started.signalAll()
    }
  }

  /** onDestroy of a specific service instance. Stale generations are ignored. */
  fun onInstanceDestroyed(generation: Int) {
    lock.withLock {
      val matchesCurrent =
        (state == State.STARTING && generation == startGeneration) ||
          (state == State.RUNNING && generation == runningGeneration) ||
          (state == State.STOPPING && (generation == runningGeneration || generation == startGeneration))
      if (!matchesCurrent) return
      state = State.STOPPED
      stopped.signalAll()
      started.signalAll()
    }
  }

  private fun awaitNotStoppingLocked() {
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(stopTimeoutMs)
    while (state == State.STOPPING) {
      val remaining = deadline - System.nanoTime()
      if (remaining <= 0) {
        throw IllegalStateException("timed out waiting for the previous voice service to stop")
      }
      stopped.awaitNanos(remaining)
    }
  }

  private fun awaitRunningLocked(timeoutMs: Long) {
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
    while (state == State.STARTING) {
      val remaining = deadline - System.nanoTime()
      if (remaining <= 0) {
        throw IllegalStateException(
          "voice foreground service did not reach startForeground within ${timeoutMs}ms",
        )
      }
      started.awaitNanos(remaining)
    }
  }

  private fun awaitRunningGenerationLocked(myGen: Int, timeoutMs: Long) {
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
    while (state != State.RUNNING || runningGeneration != myGen) {
      if (state == State.STOPPED) {
        throw IllegalStateException("voice foreground service stopped before startForeground completed")
      }
      val remaining = deadline - System.nanoTime()
      if (remaining <= 0) {
        throw IllegalStateException(
          "voice foreground service did not reach startForeground within ${timeoutMs}ms",
        )
      }
      started.awaitNanos(remaining)
    }
  }

  private fun awaitNotStartingLocked() {
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(startTimeoutMs)
    while (state == State.STARTING) {
      val remaining = deadline - System.nanoTime()
      if (remaining <= 0) {
        throw IllegalStateException("timed out waiting for the voice service to finish starting")
      }
      started.awaitNanos(remaining)
    }
  }
}
