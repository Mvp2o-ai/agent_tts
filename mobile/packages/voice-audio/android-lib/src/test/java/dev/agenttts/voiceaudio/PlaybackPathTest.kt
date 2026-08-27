package dev.agenttts.voiceaudio

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class PlaybackPathTest {
  @Test
  fun burst445824BytesAreQueuedAndWrittenInOrder() {
    val burst = sequentialPcm(445_824)
    val queue = PlaybackQueue(PlaybackLimits.MAX_BYTES)
    val chunkSize = 4096
    var offset = 0
    while (offset < burst.size) {
      val end = minOf(burst.size, offset + chunkSize)
      val slice = burst.copyOfRange(offset, end)
      assertEquals(EnqueueResult.ACCEPTED, queue.put(slice, 0) { true })
      offset = end
    }
    assertEquals(445_824, queue.queuedBytes())
    assertTrue(445_824 < PlaybackLimits.MAX_BYTES)

    val written = ArrayList<Byte>(burst.size)
    while (true) {
      when (val taken = queue.take(0)) {
        TakeResult.Closed, TakeResult.Idle -> break
        is TakeResult.Chunk -> {
          val result = PcmWriter.writeAll(
            { src, off, len ->
              val step = minOf(1024, len)
              for (i in 0 until step) written.add(src[off + i])
              step
            },
            taken.bytes,
            sleepMs = {},
          )
          assertEquals(taken.bytes.size, result.written)
          assertEquals(false, result.cancelled)
        }
      }
    }
    assertEquals(burst.size, written.size)
    assertArrayEquals(burst, written.toByteArray())
    assertTrue(queue.isIdle())
  }

  @Test
  fun flushWakesBlockedProducerAndInvalidatesThatChunk() {
    val queue = PlaybackQueue(4)
    assertEquals(EnqueueResult.ACCEPTED, queue.put(byteArrayOf(1, 2, 3, 4), 0) { true })
    val started = CountDownLatch(1)
    val done = CountDownLatch(1)
    var result: EnqueueResult? = null
    Executors.newSingleThreadExecutor().execute {
      started.countDown()
      result = queue.put(byteArrayOf(5, 6), 0) { true }
      done.countDown()
    }
    assertTrue(started.await(1, TimeUnit.SECONDS))
    Thread.sleep(30)
    queue.flush()
    assertTrue(done.await(1, TimeUnit.SECONDS))
    assertEquals(EnqueueResult.INVALIDATED, result)
    assertEquals(0, queue.queuedBytes())
  }

  @Test
  fun writeAllLoopsPartialPositiveCounts() {
    val chunk = sequentialPcm(100)
    val got = ArrayList<Byte>()
    val result = PcmWriter.writeAll(
      { src, off, len ->
        val step = minOf(7, len)
        for (i in 0 until step) got.add(src[off + i])
        step
      },
      chunk,
      sleepMs = {},
    )
    assertEquals(100, result.written)
    assertEquals(false, result.cancelled)
    assertArrayEquals(chunk, got.toByteArray())
  }

  @Test(expected = IllegalStateException::class)
  fun writeAllDoesNotTreatZeroAsSuccess() {
    PcmWriter.writeAll({ _, _, _ -> 0 }, byteArrayOf(1, 2), maxZeros = 3, sleepMs = {})
  }

  @Test(expected = IllegalStateException::class)
  fun writeAllFailsOnNegativeWithoutSkippingRemainder() {
    PcmWriter.writeAll(
      { _, offset, _ -> if (offset == 0) 2 else -6 },
      byteArrayOf(9, 8, 7, 6),
      sleepMs = {},
    )
  }

  @Test
  fun writeAllStopsCleanlyWhenEpochChangesAfterFirstPartial() {
    val chunk = byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8)
    val got = ArrayList<Byte>()
    val writes = AtomicInteger(0)
    val result = PcmWriter.writeAll(
      { src, off, len ->
        writes.incrementAndGet()
        val step = minOf(2, len)
        for (i in 0 until step) got.add(src[off + i])
        step
      },
      chunk,
      sleepMs = {},
      stillCurrent = { writes.get() < 1 },
    )
    assertEquals(true, result.cancelled)
    assertEquals(2, result.written)
    assertEquals(1, writes.get())
    assertEquals(listOf(1.toByte(), 2.toByte()), got)
  }

  @Test
  fun reconnectStartsFreshWorkerAndWritesSecondSessionOnce() {
    val written = CopyOnWriteArrayList<Byte>()
    val first = sequentialPcm(64)
    val second = sequentialPcm(96).map { (it.toInt() + 40).toByte() }.toByteArray()
    val coordinator = PlaybackCoordinator {
      PlaybackCoordinator.Hardware(
        sink = { src, off, len ->
          for (i in 0 until len) written.add(src[off + i])
          len
        },
      )
    }

    coordinator.prepare()
    val run1 = coordinator.currentRunId()
    assertEquals(EnqueueResult.ACCEPTED, coordinator.enqueue(first))
    assertTrue(waitUntil(1_000) { written.size >= first.size })
    assertEquals(1, coordinator.activeWorkers)
    coordinator.release()
    assertTrue(waitUntil(1_000) { coordinator.activeWorkers == 0 })
    assertEquals(EnqueueResult.INVALIDATED, coordinator.lastReleased!!.enqueue(byteArrayOf(9, 8)))
    assertTrue(coordinator.lastReleased!!.queue.isClosed())
    assertEquals(EnqueueResult.INVALIDATED, coordinator.enqueue(byteArrayOf(1, 2)))

    val afterFirst = written.toList()
    coordinator.prepare()
    val run2 = coordinator.currentRunId()
    assertNotEquals(run1, run2)
    assertEquals(1, coordinator.activeWorkers)
    assertEquals(2, coordinator.workersStarted.get())
    assertEquals(EnqueueResult.ACCEPTED, coordinator.enqueue(second))
    assertTrue(waitUntil(1_000) { written.size >= afterFirst.size + second.size })
    Thread.sleep(40)
    assertEquals(afterFirst.size + second.size, written.size)
    assertArrayEquals(second, written.subList(afterFirst.size, written.size).toByteArray())
    assertEquals(0, coordinator.writeErrors())
    coordinator.release()
    assertTrue(waitUntil(1_000) { coordinator.activeWorkers == 0 })
    assertEquals(2, coordinator.workersExited.get())
  }

  @Test
  fun flushDuringPartialWriteDropsRemainderWithoutFailure() {
    val inFirst = CountDownLatch(1)
    val flushed = CountDownLatch(1)
    val extraWrites = AtomicInteger(0)
    val writeErrors = AtomicInteger(0)
    val coordinator = PlaybackCoordinator {
      PlaybackCoordinator.Hardware(
        sink = { _, off, len ->
          if (off == 0) {
            inFirst.countDown()
            assertTrue(flushed.await(2, TimeUnit.SECONDS))
            2
          } else {
            extraWrites.incrementAndGet()
            len
          }
        },
      )
    }
    coordinator.onWriteError = { writeErrors.incrementAndGet() }
    coordinator.prepare()
    assertEquals(EnqueueResult.ACCEPTED, coordinator.enqueue(ByteArray(8) { it.toByte() }))
    assertTrue(inFirst.await(1, TimeUnit.SECONDS))
    coordinator.flush()
    flushed.countDown()
    assertTrue(waitUntil(1_000) { coordinator.cancelledWrites() >= 1 || coordinator.isIdle() })
    Thread.sleep(40)
    assertEquals(0, extraWrites.get())
    assertEquals(0, writeErrors.get())
    assertEquals(0, coordinator.writeErrors())
    coordinator.release()
  }

  private fun sequentialPcm(byteLength: Int): ByteArray {
    val out = ByteArray(byteLength)
    for (i in 0 until byteLength) out[i] = (i and 0xff).toByte()
    return out
  }

  private fun waitUntil(timeoutMs: Long, pred: () -> Boolean): Boolean {
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
    while (System.nanoTime() < deadline) {
      if (pred()) return true
      Thread.sleep(5)
    }
    return pred()
  }
}
