/** PCM s16le mono at 24 kHz — 48,000 bytes of audio per second of playback. */
export const PCM_BYTES_PER_SECOND = 48_000;
/** Network + client jitter allowance past the computed playout end. */
export const PLAYOUT_DRAIN_MARGIN_MS = 400;

/**
 * Estimates when the client finishes playing PCM already sent. TTS generates
 * faster than realtime, so the vendor stream ending means "all bytes shipped",
 * not "speaker quiet".
 */
export class PlayoutClock {
  private endAtMs = 0;

  constructor(
    private readonly marginMs = PLAYOUT_DRAIN_MARGIN_MS,
    /** Skip tracking in unit tests that assert immediate turn transitions. */
    private readonly disabled = false,
  ) {}

  noteBytes(bytes: number): void {
    if (this.disabled || bytes <= 0) return;
    this.endAtMs =
      Math.max(this.endAtMs, Date.now()) + (bytes / PCM_BYTES_PER_SECOND) * 1000;
  }

  reset(): void {
    this.endAtMs = 0;
  }

  isActive(): boolean {
    if (this.disabled) return false;
    return Date.now() < this.endAtMs + this.marginMs;
  }

  async drain(shouldAbort?: () => boolean): Promise<void> {
    if (this.disabled) return;
    while (!shouldAbort?.() && this.isActive()) {
      const remaining = this.endAtMs + this.marginMs - Date.now();
      if (remaining <= 0) break;
      const sleepMs = Math.min(Math.max(remaining, 1), 250);
      await new Promise<void>((resolve) => setTimeout(resolve, sleepMs));
    }
  }
}
