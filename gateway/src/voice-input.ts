import type { AgentTurn, VoiceSink } from "./agent-turn.js";
import type { TranscriptEvent } from "./voice-providers.js";
import { StopLatch } from "./stop-word.js";

/** The STT router only needs turn control, not the full AgentTurn surface. */
export type TurnHandle = Pick<AgentTurn, "enqueue" | "abort" | "bargeIn" | "speaking">;

/**
 * Maps Deepgram events onto enqueue / abort / barge-in.
 *
 * Stop-word contract: the first matching interim or final in an utterance
 * aborts once; later interims/finals of that same utterance are ignored and
 * never enqueued. `stopped` is emitted by AgentTurn, not here.
 */
export class VoiceInput {
  /** Stable Deepgram segments for the current conversational utterance. */
  private finalParts: string[] = [];
  /** Display/recovery fallback when a stream ends before any segment finalizes. */
  private lastInterim = "";
  private pttOpen = false;
  private pttAwaitingSttEnd = false;
  private pttCommitted = false;
  private readonly stop = new StopLatch();

  constructor(
    private readonly turn: TurnHandle,
    private readonly mode: "ptt" | "handsfree",
    private readonly stopWord: string,
    private readonly sink: VoiceSink,
  ) {}

  onStt(ev: TranscriptEvent): void {
    if (ev.speechStarted) this.turn.bargeIn();

    if (ev.text) {
      this.sink.sendJson({
        type: "transcript",
        text: ev.text,
        isFinal: ev.isFinal,
      });
      const hit = this.stop.observe(ev.text, ev.isFinal, this.stopWord);
      if (hit === "abort") {
        this.turn.abort("stop_word");
        this.discardUtterance();
        return;
      }
      if (hit === "ignore") {
        this.discardUtterance();
        return;
      }
      if (!ev.isFinal) this.turn.bargeIn();
    } else if (ev.isFinal || ev.utteranceEnd) {
      this.stop.endUtterance();
    }

    if (ev.text) {
      if (ev.isFinal) {
        // `isFinal` stabilizes one segment, not the whole utterance. Deepgram
        // may emit several final segments during one PTT press or spoken turn.
        this.finalParts.push(ev.text.trim());
        this.lastInterim = "";
      } else {
        this.lastInterim = ev.text.trim();
      }
    }

    if (ev.utteranceEnd && this.mode === "handsfree" && this.hasUtterance()) {
      this.commit();
    }
  }

  pttStart(): void {
    this.pttOpen = true;
    this.pttAwaitingSttEnd = false;
    this.pttCommitted = false;
    this.clearUtterance();
  }

  pttEnd(): void {
    this.pttOpen = false;
    this.pttAwaitingSttEnd = true;
  }

  /** Called after the STT stream flushes all late final segments and closes. */
  sttEnd(): void {
    if (!this.pttAwaitingSttEnd || this.pttCommitted) return;
    this.pttAwaitingSttEnd = false;
    if (this.hasUtterance()) this.commit();
  }

  userAbort(): void {
    this.turn.abort("user");
    this.discardUtterance();
  }

  private discardUtterance(): void {
    this.clearUtterance();
    this.pttAwaitingSttEnd = false;
    this.pttCommitted = true;
  }

  private commit(): void {
    const text = (
      this.finalParts.join(" ").trim() || this.lastInterim
    ).trim();
    this.clearUtterance();
    this.pttAwaitingSttEnd = false;
    this.pttCommitted = true;
    if (!text) return;
    this.turn.enqueue(text);
  }

  private hasUtterance(): boolean {
    return this.finalParts.length > 0 || this.lastInterim.length > 0;
  }

  private clearUtterance(): void {
    this.finalParts = [];
    this.lastInterim = "";
  }
}
