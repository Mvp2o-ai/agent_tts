import type { AgentTurn, VoiceSink } from "./agent-turn.js";
import { UtteranceAccumulator } from "./utterance-accumulator.js";
import type { TranscriptEvent } from "./voice-providers.js";
import { StopLatch } from "./stop-word.js";

/** The STT router only needs turn control, not the full AgentTurn surface. */
export type TurnHandle = Pick<AgentTurn, "enqueue" | "abort" | "bargeIn" | "speaking">;

/**
 * Speech resuming this soon after a hands-free commit is the rest of the
 * sentence a thinking pause cut in half, not a new prompt. Raising
 * utterance_end_ms alone only moves the cliff; this recovers from it.
 */
export const DEFAULT_CONTINUATION_MS = 2000;

export interface VoiceInputOptions {
  continuationMs?: number;
  /** Injectable clock so tests can drive the continuation window. */
  now?: () => number;
}

/**
 * Maps Deepgram events onto enqueue / abort / barge-in.
 *
 * Stop-word contract: the first matching interim or final in an utterance
 * aborts once; later interims/finals of that same utterance are ignored and
 * never enqueued. `stopped` is emitted by AgentTurn, not here.
 *
 * `speech_final` / `is_final` are segment boundaries, not turn boundaries.
 * Hands-free commits on UtteranceEnd; PTT commits after CloseStream drains.
 *
 * UtteranceEnd is weak evidence that a turn ended — it only proves silence.
 * A hands-free commit is therefore provisional: if the speaker picks the
 * sentence back up inside the continuation window, the in-flight answer is
 * aborted and the merged sentence is re-sent as one prompt.
 */
export class VoiceInput {
  private readonly utterance = new UtteranceAccumulator();
  private pttAwaitingSttEnd = false;
  private pttCommitted = false;
  private handsfreeCommitted = false;
  private readonly stop = new StopLatch();
  private lastCommit: { text: string; at: number } | null = null;
  private pendingPrefix = "";
  private readonly continuationMs: number;
  private readonly now: () => number;

  constructor(
    private readonly turn: TurnHandle,
    private readonly mode: "ptt" | "handsfree",
    private readonly stopWord: string,
    private readonly sink: VoiceSink,
    options: VoiceInputOptions = {},
  ) {
    this.continuationMs = options.continuationMs ?? DEFAULT_CONTINUATION_MS;
    this.now = options.now ?? (() => Date.now());
  }

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
      this.openNextUtterance();
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
    this.lastCommit = null;
    this.pendingPrefix = "";
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

  /**
   * First transcript after a hands-free commit. Deepgram does not reliably
   * emit SpeechStarted, so this — not the VAD event — is what opens the next
   * utterance; keying off SpeechStarted alone silently swallowed the turn.
   */
  private openNextUtterance(): void {
    if (this.mode !== "handsfree") return;
    const committed = this.lastCommit;
    if (!committed) return;
    this.lastCommit = null;
    this.utterance.reset();
    this.handsfreeCommitted = false;
    if (this.now() - committed.at > this.continuationMs) return;
    this.turn.abort("user");
    this.pendingPrefix = committed.text;
  }

  private discardUtterance(): void {
    this.utterance.reset();
    this.pttAwaitingSttEnd = false;
    this.pttCommitted = true;
    this.handsfreeCommitted = false;
    this.lastCommit = null;
    this.pendingPrefix = "";
  }

  private commit(): void {
    const text = joinContinuation(this.pendingPrefix, this.utterance.take());
    this.pendingPrefix = "";
    this.pttAwaitingSttEnd = false;
    this.pttCommitted = true;
    this.handsfreeCommitted = true;
    if (!text) return;
    if (this.mode === "handsfree") this.lastCommit = { text, at: this.now() };
    this.turn.enqueue(text);
  }
}

/** A re-sent continuation must not duplicate the fragment it resumes. */
export function joinContinuation(prefix: string, next: string): string {
  const a = prefix.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  if (b.includes(a)) return b;
  return `${a} ${b}`;
}
