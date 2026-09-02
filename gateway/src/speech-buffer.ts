/**
 * Flush agent tokens into speakable phrases so ElevenLabs hears clauses,
 * not one-character ticks. Incomplete numeric tails stay buffered so an
 * 80-character flush cannot split a phone or amount.
 */
import { incompleteNumericHoldStart } from "./speech-numbers.js";

export class SpeechBuffer {
  private buf = "";

  push(text: string): string[] {
    this.buf += text;
    return this.flush(false);
  }

  end(): string[] {
    return this.flush(true);
  }

  private flush(force: boolean): string[] {
    const out: string[] = [];
    const re = /[.!?]\s+/;
    while (true) {
      const m = re.exec(this.buf);
      if (m && m.index >= 0) {
        const end = m.index + m[0].length;
        const phrase = this.buf.slice(0, end).trim();
        this.buf = this.buf.slice(end);
        if (phrase) out.push(phrase);
        continue;
      }
      break;
    }
    if (force) {
      const rest = this.buf.trim();
      this.buf = "";
      if (rest) out.push(rest);
    } else if (this.buf.length >= 80) {
      const holdStart = incompleteNumericHoldStart(this.buf);
      const cut = holdStart === null ? this.buf.length : holdStart;
      const phrase = this.buf.slice(0, cut).trim();
      this.buf = this.buf.slice(cut);
      if (phrase) out.push(phrase);
    }
    return out;
  }
}
