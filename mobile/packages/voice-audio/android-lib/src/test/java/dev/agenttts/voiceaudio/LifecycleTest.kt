package dev.agenttts.voiceaudio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class ServiceGateTest {
  @Test
  fun startConfirmsRunningAndSecondStartDoesNotRelaunch() {
    val gate = ServiceGate()
    var starts = 0
    gate.startAndAwait {
      starts += 1
      gate.onStarted()
    }
    assertEquals(ServiceGate.State.RUNNING, gate.state())
    assertEquals(1, gate.runningGeneration())
    gate.startAndAwait { starts += 1 }
    assertEquals(1, starts)
    assertEquals(1, gate.startInvocations)
  }

  @Test
  fun stopThenStartIsANewGeneration() {
    val gate = ServiceGate()
    gate.startAndAwait { gate.onStarted() }
    val first = gate.runningGeneration()
    gate.stopAndAwait { gate.onStopped() }
    assertEquals(ServiceGate.State.STOPPED, gate.state())
    gate.startAndAwait { gate.onStarted() }
    assertEquals(2, gate.startInvocations)
    assertEquals(1, gate.stopInvocations)
    assertTrue(gate.runningGeneration() > first)
    assertEquals(ServiceGate.State.RUNNING, gate.state())
  }

  @Test
  fun startWaitsOutPendingStopThenConfirmsNewService() {
    val gate = ServiceGate()
    gate.startAndAwait { gate.onStarted() }
    val released = CountDownLatch(1)
    val started = CountDownLatch(1)
    val pool = Executors.newFixedThreadPool(2)
    pool.execute {
      gate.stopAndAwait {
        released.countDown()
        Thread.sleep(40)
        gate.onStopped()
      }
    }
    assertTrue(released.await(1, TimeUnit.SECONDS))
    var startedDuringStop = false
    pool.execute {
      gate.startAndAwait {
        startedDuringStop = gate.state() != ServiceGate.State.STOPPING
        started.countDown()
        gate.onStarted()
      }
    }
    assertTrue(started.await(1, TimeUnit.SECONDS))
    assertTrue(startedDuringStop)
    assertEquals(ServiceGate.State.RUNNING, gate.state())
    assertEquals(2, gate.startInvocations)
    pool.shutdownNow()
  }

  @Test
  fun staleOnStoppedDoesNotClearANewerRunningGeneration() {
    val gate = ServiceGate()
    gate.startAndAwait { gate.onStarted() }
    gate.stopAndAwait { gate.onStopped() }
    gate.startAndAwait { gate.onStarted() }
    assertEquals(2, gate.runningGeneration())
    gate.onStopped()
    gate.onInstanceDestroyed(1)
    assertEquals(ServiceGate.State.RUNNING, gate.state())
    assertEquals(2, gate.runningGeneration())
  }
}

class CaptureLoopTest {
  @Test
  fun unexpectedReadErrorEmitsOnlyWhileSessionStillWantsCapture() {
    val frames = AtomicInteger(0)
    val end = CaptureLoop.run(
      shouldContinue = { frames.get() < 2 },
      read = {
        if (frames.get() == 0) 4 else -3
      },
      onFrame = { frames.incrementAndGet() },
    )
    assertEquals(CaptureEnd.UNEXPECTED, end)
    assertEquals(1, frames.get())
  }

  @Test
  fun intentionalStopDoesNotCountAsUnexpected() {
    val running = AtomicInteger(1)
    val end = CaptureLoop.run(
      shouldContinue = { running.get() == 1 },
      read = {
        running.set(0)
        4
      },
      onFrame = {},
    )
    assertEquals(CaptureEnd.INTENTIONAL, end)
  }

  @Test
  fun exceptionWhileActiveIsUnexpected() {
    val end = CaptureLoop.run(
      shouldContinue = { true },
      read = { throw IllegalStateException("recorder died") },
      onFrame = {},
    )
    assertEquals(CaptureEnd.UNEXPECTED, end)
  }

  @Test
  fun tapInstallIsIdempotentAndRemoveWithoutInstallIsANoOp() {
    val removes = AtomicInteger(0)
    val installs = AtomicInteger(0)
    val tap = TapInstallState()
    tap.remove { removes.incrementAndGet() }
    assertFalse(tap.installed)
    assertEquals(0, removes.get())
    tap.install({ removes.incrementAndGet() }, { installs.incrementAndGet() })
    tap.install({ removes.incrementAndGet() }, { installs.incrementAndGet() })
    assertTrue(tap.installed)
    assertEquals(1, removes.get())
    assertEquals(2, installs.get())
    tap.remove { removes.incrementAndGet() }
    tap.remove { removes.incrementAndGet() }
    assertFalse(tap.installed)
    assertEquals(2, removes.get())
  }
}
