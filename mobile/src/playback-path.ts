/**
 * Shared playback-queue contract. Native iOS/Android use the same numbers.
 *
 * 24 kHz s16le mono × 180 s = 8_640_000 bytes (~8.2 MB). That is enough for
 * a normal ElevenLabs burst (live evidence: 445_824 bytes / 9.288 s) and
 * multi-minute replies, while staying in single-digit megabytes.
 */
export const PLAYBACK_SAMPLE_RATE = 24_000;
export const PLAYBACK_MAX_SECONDS = 180;
export const PLAYBACK_MAX_BYTES =
  PLAYBACK_SAMPLE_RATE * 2 * PLAYBACK_MAX_SECONDS;
export const PLAYBACK_MAX_SCHEDULED_BUFFERS = 48;
export const PLAYBACK_BACKPRESSURE_TIMEOUT_MS = 15_000;
export const PLAYBACK_WRITE_ZERO_SLEEP_MS = 2;
export const PLAYBACK_WRITE_MAX_ZEROS = 50;
export const PLAYBACK_MAX_PENDING_BRIDGE_BYTES = PLAYBACK_SAMPLE_RATE * 2 * 20;

export const LIVE_GATEWAY_BURST_BYTES = 445_824;

export type EnqueueResult = "accepted" | "invalidated" | "timeout";

export class PlaybackByteQueue {
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private epoch = 0;
  private closed = false;

  constructor(readonly maxBytes: number = PLAYBACK_MAX_BYTES) {}

  get queuedBytes(): number {
    return this.bytes;
  }

  get currentEpoch(): number {
    return this.epoch;
  }

  enqueue(chunk: Uint8Array, epoch: number): EnqueueResult {
    if (this.closed || epoch !== this.epoch) return "invalidated";
    if (chunk.byteLength === 0) return "accepted";
    if (this.bytes + chunk.byteLength > this.maxBytes) return "timeout";
    this.chunks.push(chunk);
    this.bytes += chunk.byteLength;
    return "accepted";
  }

  take(): Uint8Array | undefined {
    const next = this.chunks.shift();
    if (next) this.bytes -= next.byteLength;
    return next;
  }

  drain(): Uint8Array {
    const out = new Uint8Array(this.bytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.chunks = [];
    this.bytes = 0;
    return out;
  }

  flush(): number {
    this.epoch += 1;
    this.chunks = [];
    this.bytes = 0;
    return this.epoch;
  }

  close(): void {
    this.closed = true;
    this.flush();
  }
}

export type PcmWriteFn = (
  source: Uint8Array,
  offset: number,
  length: number,
) => number;

/**
 * Loop until every byte is written. Zero sleeps (no spin). Negative is fatal.
 * Idle/completion is the caller's job after this returns.
 */
export function writeAllPcm(
  write: PcmWriteFn,
  chunk: Uint8Array,
  opts: { maxZeros?: number; stillCurrent?: () => boolean } = {},
): number {
  const maxZeros = opts.maxZeros ?? PLAYBACK_WRITE_MAX_ZEROS;
  const stillCurrent = opts.stillCurrent ?? (() => true);
  let offset = 0;
  let zeros = 0;
  while (offset < chunk.byteLength) {
    if (!stillCurrent()) return offset;
    const n = write(chunk, offset, chunk.byteLength - offset);
    if (!stillCurrent()) {
      return offset + (n > 0 ? n : 0);
    }
    if (n > 0) {
      offset += n;
      zeros = 0;
      continue;
    }
    if (n === 0) {
      zeros += 1;
      if (zeros > maxZeros) {
        throw new Error("pcm write returned 0 repeatedly");
      }
      continue;
    }
    throw new Error(`pcm write failed with code ${n}`);
  }
  return offset;
}

/**
 * At most one native enqueue is in flight. The next PCM buffer is not
 * acquired until the previous bridge call finishes, so waiters do not
 * retain unaccounted chunks outside the native byte budget.
 */
export class SerialPlaybackEnqueue {
  private tail: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private pendingBytes = 0;
  private epoch = 0;

  get pendingBridgeCalls(): number {
    return this.inFlight;
  }

  get queuedBridgeBytes(): number {
    return this.pendingBytes;
  }

  enqueue(
    byteLength: number,
    acquire: () => Uint8Array,
    send: (pcm: Uint8Array) => Promise<void>,
  ): Promise<void> {
    if (
      byteLength < 0 ||
      this.pendingBytes + byteLength > PLAYBACK_MAX_PENDING_BRIDGE_BYTES
    ) {
      return Promise.reject(
        new Error(
          `playback bridge queue exceeded ${PLAYBACK_MAX_PENDING_BRIDGE_BYTES} bytes`,
        ),
      );
    }
    const enqueueEpoch = this.epoch;
    this.pendingBytes += byteLength;
    const run = this.tail.catch(() => undefined).then(async () => {
      if (enqueueEpoch !== this.epoch) return;
      this.inFlight += 1;
      try {
        const pcm = acquire();
        if (pcm.byteLength === 0) return;
        await send(pcm);
      } finally {
        this.inFlight -= 1;
      }
    }).finally(() => {
      this.pendingBytes = Math.max(0, this.pendingBytes - byteLength);
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  invalidate(): void {
    this.epoch += 1;
  }

  async drain(): Promise<void> {
    await this.tail.catch(() => undefined);
    this.tail = Promise.resolve();
    this.inFlight = 0;
    this.pendingBytes = 0;
  }
}
