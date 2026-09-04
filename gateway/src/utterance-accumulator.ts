/**
 * Deepgram live contract: one spoken turn may emit several `is_final`
 * segments (slices) and also rolling interims that already contain the
 * full utterance. The phone displays those interims, so they look fine
 * while a last-slice-only commit sends the harness a prefix-clipped prompt.
 *
 * Absorb every distinct final. If a later final is cumulative (contains
 * the text assembled so far), replace rather than concatenate. Prefer a
 * longer covering interim when it already includes the joined finals —
 * that is the text the UI showed.
 */
export class UtteranceAccumulator {
  private finalParts: string[] = [];
  private bestInterim = "";

  onTranscript(text: string, isFinal: boolean): void {
    const normalized = text.trim();
    if (!normalized) return;
    this.noteInterim(normalized);
    if (isFinal) this.absorbFinal(normalized);
  }

  hasContent(): boolean {
    return this.finalParts.length > 0 || this.bestInterim.length > 0;
  }

  take(): string {
    const text = preferCovering(
      this.finalParts.join(" ").trim(),
      this.bestInterim,
    );
    this.reset();
    return text;
  }

  reset(): void {
    this.finalParts = [];
    this.bestInterim = "";
  }

  private noteInterim(text: string): void {
    if (!this.bestInterim) {
      this.bestInterim = text;
      return;
    }
    if (text.includes(this.bestInterim)) this.bestInterim = text;
  }

  private absorbFinal(next: string): void {
    const last = this.finalParts[this.finalParts.length - 1];
    if (last === next) return;
    const assembled = this.finalParts.join(" ").trim();
    if (!assembled) {
      this.finalParts = [next];
      return;
    }
    if (next.length >= assembled.length && next.includes(assembled)) {
      this.finalParts = [next];
      return;
    }
    if (assembled.includes(next)) return;
    this.finalParts.push(next);
  }
}

export function preferCovering(joined: string, bestInterim: string): string {
  const a = joined.trim();
  const b = bestInterim.trim();
  if (!a) return b;
  if (!b) return a;
  if (b.length >= a.length && b.includes(a)) return b;
  if (a.includes(b)) return a;
  return a.length >= b.length ? a : b;
}
