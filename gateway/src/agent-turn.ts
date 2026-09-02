import type { BoxConnection } from "./box-client.js";
import { isTerminal, type BoxInbound, type BoxOutbound } from "./box-protocol.js";
import type { UserConfig } from "./config-schema.js";
import { PromptQueue } from "./prompt-queue.js";
import { SpeechBuffer } from "./speech-buffer.js";
import { verbalizeNumbersForTts } from "./speech-numbers.js";
import type { TtsAdapter, TtsStream } from "./voice-providers.js";

export type ClientEvent =
  | {
      type: "provisioning";
      stage: "preparing" | "cloning" | "starting_harness";
      repository?: string;
      index?: number;
      total: number;
    }
  | {
      type: "git_auth";
      state: "ready" | "cleared" | "required";
      message?: string;
      login?: string;
    }
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
  | { type: "error"; message: string; code?: "git_auth_required" };

export interface VoiceSink {
  sendJson(event: ClientEvent): void;
  sendAudio(pcm: Buffer): void;
}

export type OpenTts = (opts: {
  voiceId: string;
  onAudio: (pcm: Buffer) => void;
  onError: (err: Error) => void;
  onEnd?: () => void;
}) => TtsStream;

function promptInbound(
  id: string,
  text: string,
  config: UserConfig,
): Extract<BoxInbound, { type: "prompt" }> {
  const msg: Extract<BoxInbound, { type: "prompt" }> = { type: "prompt", id, text };
  if (config.model) msg.model = config.model;
  if (config.effort) msg.effort = config.effort;
  return msg;
}

export interface AgentTurnOptions {
  openTts?: OpenTts;
  onIdle?: () => void;
  /**
   * Re-read on every prompt dispatch so model/effort changes apply on the
   * next turn without a session reset. Harness stays snapshotted.
   */
  getConfig?: () => Promise<UserConfig>;
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
  readonly ready: Promise<void>;
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
  private initializationStarted = false;
  private initialized = false;
  private readySettled = false;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readonly openTts?: OpenTts;
  private readonly onIdle?: () => void;
  private readonly getConfig?: () => Promise<UserConfig>;
  private promptDispatched = false;
  private readonly ttsAdapter?: TtsAdapter;

  get activity(): "idle" | "working" | "speaking" {
    if (this.speaking) return "speaking";
    return this.phase === "idle" ? "idle" : "working";
  }

  get isReady(): boolean {
    return this.initialized;
  }

  get isInitializationStarted(): boolean {
    return this.initializationStarted;
  }

  constructor(
    private readonly box: BoxConnection,
    private readonly sink: VoiceSink,
    private readonly config: UserConfig,
    ttsAdapter?: TtsAdapter,
    options: AgentTurnOptions = {},
  ) {
    this.ttsAdapter = ttsAdapter;
    this.openTts = options.openTts;
    this.onIdle = options.onIdle;
    this.getConfig = options.getConfig;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    box.onMessage((msg) => this.onBox(msg));
  }

  initialize(credential?: string): void {
    if (this.closed || this.initializationStarted) return;
    this.initializationStarted = true;
    this.box.send({
      type: "initialize",
      ...(credential ? { credential } : {}),
    });
  }

  /** Replace or clear session git/gh auth after the box is already running. */
  setGitAuth(credential: string): void {
    if (this.closed || !this.initializationStarted) return;
    this.box.send({ type: "git_auth", credential });
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
      if (this.promptDispatched) {
        this.box.send({ type: "abort", reason });
        this.sink.sendJson({ type: "stopped", reason });
        return;
      }
      this.sink.sendJson({ type: "stopped", reason });
      this.currentPromptId = undefined;
      this.muted = false;
      this.becomeIdleAndPump();
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
    if (this.closed) return;
    this.closed = true;
    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(new Error("agent session closed before it became ready"));
    }
    this.phase = "idle";
    this.currentPromptId = undefined;
    this.stopTts();
    this.queue.clear();
    await this.box.close();
  }

  private pump(): void {
    if (this.closed || !this.initialized) return;
    const next = this.queue.takeIfIdle();
    if (!next) return;
    this.phase = "running";
    this.currentPromptId = next.id;
    this.promptDispatched = false;
    this.speech = new SpeechBuffer();
    this.muted = false;
    this.ttsSuppressed = false;
    this.sink.sendJson({
      type: "prompt_start",
      promptId: next.id,
      text: next.text,
    });
    if (this.getConfig) {
      void this.dispatchPrompt(next);
      return;
    }
    this.sendPrompt(next, this.config);
  }

  private async dispatchPrompt(next: { id: string; text: string }): Promise<void> {
    let latest: UserConfig;
    try {
      latest = await this.getConfig!();
    } catch {
      latest = this.config;
    }
    if (this.closed || this.currentPromptId !== next.id) return;
    if (this.phase !== "running") return;
    this.sendPrompt(next, latest);
  }

  private sendPrompt(next: { id: string; text: string }, config: UserConfig): void {
    this.promptDispatched = true;
    this.box.send(promptInbound(next.id, next.text, config));
  }

  private onBox(msg: BoxOutbound): void {
    if (this.closed) return;
    if (msg.type === "provisioning") {
      this.sink.sendJson(msg);
      return;
    }
    if (msg.type === "git_auth") {
      this.sink.sendJson({
        type: "git_auth",
        state: msg.state,
        ...(msg.message ? { message: msg.message } : {}),
        ...(msg.login ? { login: msg.login } : {}),
      });
      return;
    }
    if (msg.type === "ready") {
      if (!this.initialized) {
        this.initialized = true;
        this.readySettled = true;
        this.resolveReady();
        this.pump();
      }
      return;
    }
    if (msg.type === "error" && !msg.promptId) {
      const error = new Error(msg.message);
      this.sink.sendJson({
        type: "error",
        message: error.message,
        ...(msg.code ? { code: msg.code } : {}),
      });
      if (msg.code === "git_auth_required") {
        this.sink.sendJson({
          type: "git_auth",
          state: "required",
          message: msg.message,
        });
      }
      if (!this.readySettled) {
        this.readySettled = true;
        this.rejectReady(error);
      }
      return;
    }
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
      // Tool calls are a narration boundary, not a barge-in. Release held
      // phrases and tell ElevenLabs to generate the already-pushed tail so
      // the speaker is not starved mid-utterance. Do not finish()/close()
      // the stream and do not dump client playback.
      this.speakPhrases(this.speech.end());
      this.tts?.flush();
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
      this.sink.sendJson({
        type: "error",
        message: msg.message,
        ...(msg.code ? { code: msg.code } : {}),
      });
      if (msg.code === "git_auth_required") {
        this.sink.sendJson({
          type: "git_auth",
          state: "required",
          message: msg.message,
        });
      }
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
    if ((!this.ttsAdapter && !this.openTts) || phrases.length === 0) return;
    const voiceId = this.config.voice.ttsVoiceId || "21m00Tcm4TlvDq8ikWAM";
    if (!this.tts) {
      const gen = ++this.ttsGen;
      this.speaking = true;
      this.sink.sendJson({ type: "tts_start" });
      const openTts = this.ttsAdapter
        ? (opts: Parameters<TtsAdapter["open"]>[0]) => this.ttsAdapter!.open(opts)
        : this.openTts!;
      this.tts = openTts({
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
    for (const p of phrases) this.tts.pushText(verbalizeNumbersForTts(p));
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
