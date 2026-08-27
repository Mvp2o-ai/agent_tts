import type { BoxConnection } from "./box-client.js";
import { isTerminal, type BoxOutbound } from "./box-protocol.js";
import type { UserConfig } from "./config-schema.js";
import { PromptQueue } from "./prompt-queue.js";
import { SpeechBuffer } from "./speech-buffer.js";
import { openElevenLabs, type TtsStream } from "./elevenlabs.js";

export type ClientEvent =
  | { type: "queued"; promptId: string; position: number }
  | { type: "prompt_start"; promptId: string; text: string }
  | { type: "transcript"; text: string; isFinal: boolean }
  | { type: "agent_text"; text: string }
  | { type: "tool_event"; summary: string }
  | { type: "tts_start" }
  | { type: "tts_end" }
  | { type: "barge_in" }
  | { type: "stopped"; reason: "stop_word" | "user" }
  | { type: "done"; promptId: string }
  | { type: "error"; message: string };

export interface VoiceSink {
  sendJson(event: ClientEvent): void;
  sendAudio(pcm: Buffer): void;
}

export type OpenTts = (opts: {
  apiKey: string;
  voiceId: string;
  onAudio: (pcm: Buffer) => void;
  onError: (err: Error) => void;
  onEnd?: () => void;
}) => TtsStream;

export interface AgentTurnOptions {
  openTts?: OpenTts;
  onIdle?: () => void;
}

/**
 * Session turn lifecycle (one AgentTurn per voice/debug session):
 *
 *   idle ──enqueue──► running ──box done/error──► draining ──tts end──► idle
 *             │            │                         │
 *             │            └──abort──► stopping ──► idle   (`stopped`; no `done`)
 *             │                                      │
 *             │                         abort/barge/error also leave draining
 *
 * `stopped` replaces `done` for an aborted harness turn. The queue stays
 * busy until the current turn's TTS stream ends so a finished stream is
 * never reused and PCM frames from two streams cannot interleave.
 * Barge-in only stops TTS; the harness stays `running`.
 */
export class AgentTurn {
  readonly queue = new PromptQueue();
  speaking = false;
  private speechEnabled = true;
  private tts: TtsStream | null = null;
  private ttsGen = 0;
  private speech = new SpeechBuffer();
  private currentPromptId: string | undefined;
  private phase: "idle" | "running" | "stopping" | "draining" = "idle";
  private muted = false;
  private ttsSuppressed = false;
  private closed = false;
  private readonly openTts: OpenTts;
  private readonly onIdle?: () => void;

  get activity(): "idle" | "working" | "speaking" {
    if (this.speaking) return "speaking";
    return this.phase === "idle" ? "idle" : "working";
  }

  constructor(
    private readonly box: BoxConnection,
    private readonly sink: VoiceSink,
    private readonly config: UserConfig,
    private readonly elevenKey: string | undefined,
    options: AgentTurnOptions = {},
  ) {
    this.openTts = options.openTts ?? openElevenLabs;
    this.onIdle = options.onIdle;
    box.onMessage((msg) => this.onBox(msg));
  }

  enqueue(text: string): void {
    if (this.closed) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const item = this.queue.enqueue(trimmed);
    if (this.queue.busy) {
      this.sink.sendJson({
        type: "queued",
        promptId: item.id,
        position: this.queue.length,
      });
    }
    this.pump();
  }

  abort(reason: "stop_word" | "user"): void {
    if (this.closed) return;
    if (this.phase === "stopping") return;

    const canStopTurn = this.phase === "running";
    const canStopDrain = this.phase === "draining";
    const canStopTts = this.speaking || this.tts !== null;
    if (!canStopTurn && !canStopDrain && !canStopTts) return;

    this.muted = true;
    this.stopTts();

    if (canStopTurn) {
      this.phase = "stopping";
      this.box.send({ type: "abort", reason });
      this.sink.sendJson({ type: "stopped", reason });
      return;
    }

    this.sink.sendJson({ type: "stopped", reason });
    this.muted = false;
    if (canStopDrain) this.releaseDrain();
  }

  bargeIn(): void {
    if (this.closed) return;
    if (!this.speaking && !this.tts) return;
    const draining = this.phase === "draining";
    this.stopTts();
    this.ttsSuppressed = true;
    this.sink.sendJson({ type: "barge_in" });
    if (draining) this.releaseDrain();
  }

  /**
   * Enables speech only while a client is focused and able to play it.
   * Disabling closes an active vendor stream immediately, so background or
   * disconnected sessions continue as text-only without consuming TTS.
   */
  setSpeechEnabled(enabled: boolean): void {
    if (this.closed || this.speechEnabled === enabled) return;
    this.speechEnabled = enabled;
    if (enabled) return;

    const hadTts = this.speaking || this.tts !== null;
    const draining = this.phase === "draining";
    this.stopTts();
    if (hadTts) this.sink.sendJson({ type: "tts_end" });
    if (draining) this.releaseDrain();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.phase = "idle";
    this.currentPromptId = undefined;
    this.stopTts();
    this.queue.clear();
    await this.box.close();
  }

  private pump(): void {
    if (this.closed) return;
    const next = this.queue.takeIfIdle();
    if (!next) return;
    this.phase = "running";
    this.currentPromptId = next.id;
    this.speech = new SpeechBuffer();
    this.muted = false;
    this.ttsSuppressed = false;
    this.sink.sendJson({
      type: "prompt_start",
      promptId: next.id,
      text: next.text,
    });
    this.box.send({ type: "prompt", id: next.id, text: next.text });
  }

  private onBox(msg: BoxOutbound): void {
    if (this.closed) return;
    if (this.phase === "idle" || this.phase === "draining") return;

    const promptId = "promptId" in msg ? msg.promptId : undefined;
    if (promptId && this.currentPromptId && promptId !== this.currentPromptId) {
      return;
    }

    if (msg.type === "chunk") {
      if (this.phase !== "running" || this.muted) return;
      this.sink.sendJson({ type: "agent_text", text: msg.text });
      this.speakPhrases(this.speech.push(msg.text));
      return;
    }

    if (msg.type === "tool_event") {
      if (this.phase !== "running" || this.muted) return;
      this.sink.sendJson({ type: "tool_event", summary: msg.summary });
      return;
    }

    if (isTerminal(msg)) this.settle(msg);
  }

  private settle(msg: Extract<BoxOutbound, { type: "done" | "aborted" | "error" }>): void {
    const wasStopping = this.phase === "stopping";
    const wasRunning = this.phase === "running";
    if (!wasStopping && !wasRunning) return;

    if (wasRunning && !this.muted) {
      this.speakPhrases(this.speech.end());
    } else {
      this.speech = new SpeechBuffer();
    }

    const finishedId = msg.promptId ?? this.currentPromptId ?? "";
    this.currentPromptId = undefined;

    if (wasStopping) {
      this.becomeIdleAndPump();
      return;
    }

    if (msg.type === "error") {
      this.sink.sendJson({ type: "error", message: msg.message });
    } else if (msg.type === "done") {
      this.sink.sendJson({ type: "done", promptId: finishedId });
    } else {
      this.sink.sendJson({ type: "stopped", reason: "user" });
    }

    if (this.tts) {
      this.phase = "draining";
      this.tts.finish();
      return;
    }

    this.becomeIdleAndPump();
  }

  private speakPhrases(phrases: string[]): void {
    if (
      this.closed ||
      !this.speechEnabled ||
      this.muted ||
      this.ttsSuppressed
    ) {
      return;
    }
    if (this.phase !== "running") return;
    if (!this.elevenKey || phrases.length === 0) return;
    const voiceId = this.config.voice.ttsVoiceId || "21m00Tcm4TlvDq8ikWAM";
    if (!this.tts) {
      const gen = ++this.ttsGen;
      this.speaking = true;
      this.sink.sendJson({ type: "tts_start" });
      this.tts = this.openTts({
        apiKey: this.elevenKey,
        voiceId,
        onAudio: (pcm) => {
          if (this.ttsGen !== gen || this.muted) return;
          this.sink.sendAudio(pcm);
        },
        onError: (err) => {
          if (this.ttsGen !== gen || this.closed || this.muted) return;
          this.sink.sendJson({ type: "error", message: err.message });
          this.failTts();
        },
        onEnd: () => {
          if (this.ttsGen !== gen) return;
          this.onTtsEnded();
        },
      });
    }
    for (const p of phrases) this.tts.pushText(p);
  }

  private stopTts(): void {
    this.ttsGen += 1;
    this.speaking = false;
    this.tts?.close();
    this.tts = null;
  }

  private failTts(): void {
    this.ttsGen += 1;
    this.speaking = false;
    this.tts?.close();
    this.tts = null;
    if (this.phase === "draining") this.releaseDrain();
  }

  private onTtsEnded(): void {
    this.speaking = false;
    this.tts = null;
    this.sink.sendJson({ type: "tts_end" });
    if (this.phase === "draining") this.releaseDrain();
  }

  private releaseDrain(): void {
    if (this.closed || this.phase !== "draining") return;
    this.becomeIdleAndPump();
  }

  private becomeIdleAndPump(): void {
    this.phase = "idle";
    this.muted = false;
    this.ttsSuppressed = false;
    this.queue.markIdle();
    this.pump();
    if (this.phase === "idle" && this.queue.length === 0) {
      this.onIdle?.();
    }
  }
}
