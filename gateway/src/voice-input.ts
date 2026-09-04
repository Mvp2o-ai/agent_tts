import type { AgentTurn, VoiceSink } from "./agent-turn.js";
import { UtteranceAccumulator } from "./utterance-accumulator.js";
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
 *
 * `speech_final` / `is_final` are segment boundaries, not turn boundaries.
 * Hands-free commits on UtteranceEnd; PTT commits after CloseStream drains.
 */
export class VoiceInput {
  private readonly utterance = new UtteranceAccumulator();
  private pttAwaitingSttEnd = false;
  private pttCommitted = false;
  private handsfreeCommitted = false;
  private readonly stop = new StopLatch();

  constructor(
    private readonly turn: TurnHandle,
    private readonly mode: "ptt" | "handsfree",
    private readonly stopWord: string,
    private readonly sink: VoiceSink,
  ) {}

  onStt(ev: TranscriptEvent): void {
    if (ev.speechStarted) {
      this.turn.bargeIn();
      if (this.mode === "handsfree" && this.handsfreeCommitted) {
        this.utterance.reset();
        this.handsfreeCommitted = false;
      }
    }

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
      this.utterance.onTranscript(ev.text, ev.isFinal);
    } else if (ev.isFinal || ev.utteranceEnd) {
      this.stop.endUtterance();
    }

    if (
      ev.utteranceEnd
      && this.mode === "handsfree"
      && !this.handsfreeCommitted
      && this.utterance.hasContent()
    ) {
      this.commit();
    }
  }

  pttStart(): void {
    this.pttAwaitingSttEnd = false;
    this.pttCommitted = false;
    this.utterance.reset();
  }

  pttEnd(): void {
    this.pttAwaitingSttEnd = true;
  }

  /** Called after the STT stream flushes all late final segments and closes. */
  sttEnd(): void {
    if (!this.pttAwaitingSttEnd || this.pttCommitted) return;
    this.pttAwaitingSttEnd = false;
    if (this.utterance.hasContent()) this.commit();
  }

  userAbort(): void {
    this.turn.abort("user");
    this.discardUtterance();
  }

  private discardUtterance(): void {
    this.utterance.reset();
    this.pttAwaitingSttEnd = false;
    this.pttCommitted = true;
    this.handsfreeCommitted = false;
  }

  private commit(): void {
    const text = this.utterance.take();
    this.pttAwaitingSttEnd = false;
    this.pttCommitted = true;
    this.handsfreeCommitted = true;
    if (!text) return;
    this.turn.enqueue(text);
  }
}
