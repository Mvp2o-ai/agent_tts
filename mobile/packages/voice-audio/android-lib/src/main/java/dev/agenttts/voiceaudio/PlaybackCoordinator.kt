package dev.agenttts.voiceaudio

import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * One prepare→release playback session. Close is terminal: the worker must
 * exit and the next prepare allocates a new run (fresh queue + worker).
 */
class PlaybackRun(
  val runId: Int,
  val queue: PlaybackQueue = PlaybackQueue(),
  val sink: PcmSink,
  val onHardwareFlush: () -> Unit = {},
  val onHardwareRelease: () -> Unit = {},
) {
  private val closedFlag = AtomicBoolean(false)
  val idleEmitted = AtomicBoolean(true)
  val writeErrors = AtomicInteger(0)
  val cancelledWrites = AtomicInteger(0)

  val closed: Boolean
    get() = closedFlag.get()

  fun enqueue(pcm: ByteArray): EnqueueResult {
    if (closedFlag.get()) return EnqueueResult.INVALIDATED
    val epoch = queue.currentEpoch()
    return queue.put(pcm, epoch) { !closedFlag.get() }
  }

  fun flush() {
    if (closedFlag.get()) return
    queue.flush()
    onHardwareFlush()
    idleEmitted.set(true)
  }

  fun close() {
    closedFlag.set(true)
    queue.close()
    onHardwareRelease()
  }
}

/** Owns the current run and its worker. Prepare after release always starts fresh. */
class PlaybackCoordinator(
  private val bindHardware: () -> Hardware,
) {
  data class Hardware(
    val sink: PcmSink,
    val onFlush: () -> Unit = {},
    val onRelease: () -> Unit = {},
  )

  var onIdle: (() -> Unit)? = null
  var onWriteError: ((String) -> Unit)? = null

  private val lock = Any()
  private var run: PlaybackRun? = null
  private var worker: Thread? = null
  private var nextRunId = 1
  @Volatile var lastReleased: PlaybackRun? = null
    private set

  val workersStarted = AtomicInteger(0)
  val workersExited = AtomicInteger(0)
  val activeWorkers: Int
    get() = workersStarted.get() - workersExited.get()

  fun currentRunId(): Int? = synchronized(lock) { run?.runId }

  fun prepare() {
    synchronized(lock) {
      releaseLocked()
      val hw = bindHardware()
      val created = PlaybackRun(
        runId = nextRunId++,
        sink = hw.sink,
        onHardwareFlush = hw.onFlush,
        onHardwareRelease = hw.onRelease,
      )
      run = created
      workersStarted.incrementAndGet()
      worker = Thread(
        {
          try {
            playLoop(created)
          } finally {
            workersExited.incrementAndGet()
          }
        },
        "voice-audio-play-${created.runId}",
      ).also {
        it.isDaemon = true
        it.start()
      }
    }
  }

  fun enqueue(pcm: ByteArray): EnqueueResult {
    val current = synchronized(lock) { run } ?: return EnqueueResult.INVALIDATED
    val result = current.enqueue(pcm)
    if (result == EnqueueResult.ACCEPTED) current.idleEmitted.set(false)
    return result
  }

  fun flush() {
    synchronized(lock) { run }?.flush()
  }

  fun release() {
    synchronized(lock) { releaseLocked() }
  }

  fun isIdle(): Boolean {
    val current = synchronized(lock) { run } ?: return true
    return current.queue.isIdle()
  }

  fun cancelledWrites(): Int = synchronized(lock) { run?.cancelledWrites?.get() ?: 0 }

  fun writeErrors(): Int = synchronized(lock) { run?.writeErrors?.get() ?: 0 }

  private fun releaseLocked() {
    val current = run
    val thread = worker
    run = null
    worker = null
    lastReleased = current
    current?.close()
    thread?.join(1_000)
  }

  private fun playLoop(session: PlaybackRun) {
    while (!session.closed) {
      when (val taken = session.queue.take(40)) {
        TakeResult.Closed -> break
        TakeResult.Idle -> continue
        is TakeResult.Chunk -> {
          val epoch = taken.epoch
          val outcome = try {
            PcmWriter.writeAll(
              session.sink,
              taken.bytes,
              stillCurrent = {
                !session.closed && session.queue.currentEpoch() == epoch
              },
            )
          } catch (err: Exception) {
            if (!session.closed && session.queue.currentEpoch() == epoch) {
              session.writeErrors.incrementAndGet()
              onWriteError?.invoke(err.message ?: "pcm write failed")
            }
            continue
          }
          if (outcome.cancelled) {
            session.cancelledWrites.incrementAndGet()
          } else if (session.queue.isIdle()) {
            if (session.idleEmitted.compareAndSet(false, true)) {
              onIdle?.invoke()
            }
          }
        }
      }
    }
  }
}
