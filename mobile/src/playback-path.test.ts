import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIVE_GATEWAY_BURST_BYTES,
  PLAYBACK_MAX_BYTES,
  PlaybackByteQueue,
  SerialPlaybackEnqueue,
  writeAllPcm,
} from "./playback-path";

function sequentialPcm(byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) out[i] = i & 0xff;
  return out;
}

describe("playback queue / writer", () => {
  it("accepts a 445,824-byte burst and drains every byte in order", () => {
    const burst = sequentialPcm(LIVE_GATEWAY_BURST_BYTES);
    const queue = new PlaybackByteQueue(PLAYBACK_MAX_BYTES);
    const chunkSize = 4096;
    let epoch = 0;
    for (let i = 0; i < burst.byteLength; i += chunkSize) {
      const slice = burst.subarray(i, Math.min(burst.byteLength, i + chunkSize));
      assert.equal(queue.enqueue(slice, epoch), "accepted");
    }
    assert.equal(queue.queuedBytes, LIVE_GATEWAY_BURST_BYTES);
    assert.ok(LIVE_GATEWAY_BURST_BYTES < PLAYBACK_MAX_BYTES);

    const written: number[] = [];
    const sinkWrites: number[] = [];
    let take: Uint8Array | undefined;
    while ((take = queue.take())) {
      const n = writeAllPcm((src, offset, length) => {
        const step = Math.min(1024, length);
        for (let i = 0; i < step; i++) written.push(src[offset + i]!);
        sinkWrites.push(step);
        return step;
      }, take);
      assert.equal(n, take.byteLength);
    }

    assert.equal(written.length, LIVE_GATEWAY_BURST_BYTES);
    assert.deepEqual(Uint8Array.from(written), burst);
    assert.ok(sinkWrites.every((n) => n > 0 && n <= 1024));
    assert.ok(sinkWrites.length > LIVE_GATEWAY_BURST_BYTES / 1024);
    assert.equal(queue.queuedBytes, 0);
  });

  it("discards only after flush/generation change, not on a normal burst", () => {
    const queue = new PlaybackByteQueue(64);
    assert.equal(queue.enqueue(Uint8Array.from([1, 2]), 0), "accepted");
    const nextEpoch = queue.flush();
    assert.equal(queue.queuedBytes, 0);
    assert.equal(queue.enqueue(Uint8Array.from([3, 4]), 0), "invalidated");
    assert.equal(queue.enqueue(Uint8Array.from([5, 6]), nextEpoch), "accepted");
    assert.deepEqual([...queue.drain()], [5, 6]);
  });

  it("turns overflow into an explicit failure instead of dropping bytes", () => {
    const queue = new PlaybackByteQueue(4);
    assert.equal(queue.enqueue(Uint8Array.from([1, 2, 3, 4]), 0), "accepted");
    assert.equal(queue.enqueue(Uint8Array.from([5, 6]), 0), "timeout");
    assert.deepEqual([...queue.drain()], [1, 2, 3, 4]);
  });

  it("loops a partial writer until every byte is consumed", () => {
    const chunk = sequentialPcm(100);
    const got: number[] = [];
    const written = writeAllPcm((src, offset, length) => {
      const n = Math.min(7, length);
      for (let i = 0; i < n; i++) got.push(src[offset + i]!);
      return n;
    }, chunk);
    assert.equal(written, 100);
    assert.deepEqual(got, [...chunk]);
  });

  it("does not treat a zero write as success and does not spin forever", () => {
    let zeros = 0;
    assert.throws(
      () =>
        writeAllPcm(() => {
          zeros += 1;
          return 0;
        }, Uint8Array.from([1, 2]), { maxZeros: 3 }),
      /returned 0/,
    );
    assert.equal(zeros, 4);
  });

  it("stops after the first partial write when the stream epoch changes", () => {
    const got: number[] = [];
    let writes = 0;
    const written = writeAllPcm(
      (src, offset, length) => {
        writes += 1;
        const n = Math.min(2, length);
        for (let i = 0; i < n; i++) got.push(src[offset + i]!);
        return n;
      },
      Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
      { stillCurrent: () => writes < 1 },
    );
    assert.equal(written, 2);
    assert.equal(writes, 1);
    assert.deepEqual(got, [1, 2]);
  });

  it("serializes enqueue so only one bridge call holds PCM", async () => {
    const serial = new SerialPlaybackEnqueue();
    let started = 0;
    let finished = 0;
    let maxInFlight = 0;
    const held: number[] = [];
    const order: number[] = [];

    const send = (id: number) =>
      serial.enqueue(
        1,
        () => {
          held.push(id);
          return Uint8Array.from([id]);
        },
        async () => {
          started += 1;
          maxInFlight = Math.max(maxInFlight, serial.pendingBridgeCalls);
          await new Promise((resolve) => setTimeout(resolve, 15));
          order.push(id);
          finished += 1;
        },
      );

    const first = send(1);
    const second = send(2);
    const third = send(3);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(held.length, 1);
    assert.equal(started, 1);
    await Promise.all([first, second, third]);
    assert.deepEqual(order, [1, 2, 3]);
    assert.equal(finished, 3);
    assert.equal(maxInFlight, 1);
    assert.deepEqual(held, [1, 2, 3]);
  });

  it("keeps enqueue order after a failed bridge call", async () => {
    const serial = new SerialPlaybackEnqueue();
    const order: number[] = [];
    await assert.rejects(
      serial.enqueue(
        1,
        () => Uint8Array.from([1]),
        async () => {
          order.push(1);
          throw new Error("timeout");
        },
      ),
      /timeout/,
    );
    await serial.enqueue(
      1,
      () => Uint8Array.from([2]),
      async () => {
        order.push(2);
      },
    );
    assert.deepEqual(order, [1, 2]);
  });

  it("invalidates queued bridge frames so flush cannot resume stale speech", async () => {
    const serial = new SerialPlaybackEnqueue();
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sent: number[] = [];

    const first = serial.enqueue(
      1,
      () => Uint8Array.from([1]),
      async () => {
        sent.push(1);
        await firstBlocked;
      },
    );
    const stale = serial.enqueue(
      1,
      () => Uint8Array.from([2]),
      async () => {
        sent.push(2);
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    serial.invalidate();
    releaseFirst();
    await Promise.all([first, stale]);

    assert.deepEqual(sent, [1]);
    assert.equal(serial.queuedBridgeBytes, 0);
  });

  it("rejects unbounded bridge backlog visibly", async () => {
    const serial = new SerialPlaybackEnqueue();
    await assert.rejects(
      serial.enqueue(
        24_000 * 2 * 20 + 1,
        () => new Uint8Array(0),
        async () => {},
      ),
      /queue exceeded/,
    );
    assert.equal(serial.queuedBridgeBytes, 0);
  });

  it("fails on a negative write instead of skipping the remainder", () => {
    const got: number[] = [];
    assert.throws(
      () =>
        writeAllPcm((src, offset, length) => {
          if (offset === 0) {
            got.push(src[0]!, src[1]!);
            return 2;
          }
          return -6;
        }, Uint8Array.from([9, 8, 7, 6])),
      /code -6/,
    );
    assert.deepEqual(got, [9, 8]);
  });
});
