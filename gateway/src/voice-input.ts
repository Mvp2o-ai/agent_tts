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
  private utterance = "";
  private pttOpen = false;
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

    if (ev.isFinal && ev.text) {
      this.utterance = ev.text;
      if (this.mode === "handsfree" || (!this.pttOpen && !this.pttCommitted)) {
        this.commit();
      }
    }

    if (ev.utteranceEnd && this.mode === "handsfree" && this.utterance) {
      this.commit();
    }
  }

  pttStart(): void {
    this.pttOpen = true;
    this.pttCommitted = false;
    this.utterance = "";
  }

  pttEnd(): void {
    this.pttOpen = false;
    if (this.utterance && !this.pttCommitted) this.commit();
  }

  userAbort(): void {
    this.turn.abort("user");
    this.discardUtterance();
  }

  private discardUtterance(): void {
    this.utterance = "";
    this.pttCommitted = true;
  }

  private commit(): void {
    const text = this.utterance.trim();
    this.utterance = "";
    this.pttCommitted = true;
    if (!text) return;
    this.turn.enqueue(text);
  }
}
