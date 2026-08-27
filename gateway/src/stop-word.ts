/** Transcript-based stop-word match (Deepgram interim/final). */
export function containsStopWord(transcript: string, stopWord: string): boolean {
  const needle = words(stopWord);
  if (needle.length === 0) return false;
  const hay = words(transcript);
  for (let i = 0; i <= hay.length - needle.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

export type StopObservation = "abort" | "ignore" | "pass";

/**
 * One abort per spoken stop utterance. After a hit, every later transcript
 * of that utterance — including a corrected final that no longer contains
 * the stop word — is ignored. The next utterance can fire again.
 */
export class StopLatch {
  private latched = false;

  observe(text: string, isFinal: boolean, stopWord: string): StopObservation {
    if (this.latched) {
      if (isFinal) this.latched = false;
      return "ignore";
    }
    if (containsStopWord(text, stopWord)) {
      this.latched = !isFinal;
      return "abort";
    }
    return "pass";
  }

  /** Empty finals / utterance-end still close a latched stop utterance. */
  endUtterance(): void {
    this.latched = false;
  }
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}
