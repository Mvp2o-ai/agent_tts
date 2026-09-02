import WebSocket from "ws";
import type { TtsStream } from "./voice-providers.js";

export type { TtsStream } from "./voice-providers.js";

export const ELEVENLABS_TTS_INACTIVITY_TIMEOUT_SEC = 180;
export const ELEVENLABS_TTS_KEEPALIVE_MS = 10_000;

/** Minimal transport so tests can drive the CONNECTING/open/finish sequence. */
export interface TtsTransport {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "open", cb: () => void): this;
  on(event: "message", cb: (raw: { toString(): string }) => void): this;
  on(event: "error", cb: (err: Error) => void): this;
  on(event: "close", cb: () => void): this;
  once(event: "open", cb: () => void): this;
  removeAllListeners(event?: string): this;
}

/** First-party stream-input format: PCM S16LE at the given sample rate. */
export const TTS_OUTPUT_FORMAT = "pcm_24000";
export { VOICE_AUDIO_FORMAT } from "./voice-providers.js";

export function elevenLabsStreamUrl(voiceId: string): string {
  const voice = encodeURIComponent(voiceId);
  return (
    `wss://api.elevenlabs.io/v1/text-to-speech/${voice}/stream-input` +
    `?model_id=eleven_flash_v2_5&output_format=${TTS_OUTPUT_FORMAT}` +
    `&inactivity_timeout=${ELEVENLABS_TTS_INACTIVITY_TIMEOUT_SEC}`
  );
}

/**
 * ElevenLabs streaming-input websocket. Audio frames are raw PCM s16le
 * 24 kHz mono (`output_format=pcm_24000`), forwarded as binary WS frames.
 *
 * Text pushed before the socket opens is buffered and flushed on open —
 * otherwise short replies (flushed at end-of-turn) would be dropped while
 * the socket is still CONNECTING. `finish()` before open is held until after
 * that flush. `close()` discards the buffer so an abort during CONNECTING
 * cannot send dead-turn text.
 *
 * Tool-call gaps pause LLM text. Default inactivity is 20s (`input_timeout_exceeded`).
 * Keep the socket alive, and use `flush()` (not EOS) so already-pushed speech
 * is generated instead of starving playback mid-utterance.
 */
export function openElevenLabs(opts: {
  apiKey: string;
  voiceId: string;
  onAudio: (pcm: Buffer) => void;
  onError: (err: Error) => void;
  onEnd?: () => void;
}): TtsStream {
  const ws = new WebSocket(elevenLabsStreamUrl(opts.voiceId));
  return attachStreamingTts(ws as unknown as TtsTransport, opts);
}

export function attachStreamingTts(
  ws: TtsTransport,
  opts: {
    apiKey: string;
    onAudio: (pcm: Buffer) => void;
    onError: (err: Error) => void;
    onEnd?: () => void;
    keepaliveMs?: number;
  },
): TtsStream {
  const pending: string[] = [];
  let finishRequested = false;
  let flushRequested = false;
  let opened = false;
  let closed = false;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  const keepaliveMs = opts.keepaliveMs ?? ELEVENLABS_TTS_KEEPALIVE_MS;

  const stopKeepalive = () => {
    if (!keepalive) return;
    clearInterval(keepalive);
    keepalive = null;
  };

  const fail = (error: Error) => {
    if (closed) return;
    closed = true;
    stopKeepalive();
    pending.length = 0;
    opts.onError(error);
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  };

  const sendKeepalive = () => {
    if (closed || finishRequested || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ text: " " }));
  };

  const sendText = (text: string) => {
    ws.send(JSON.stringify({ text: `${text} `, try_trigger_generation: true }));
  };

  const sendFlush = () => {
    ws.send(JSON.stringify({ text: " ", flush: true }));
  };

  ws.on("open", () => {
    if (closed) {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      return;
    }
    opened = true;
    ws.send(
      JSON.stringify({
        text: " ",
        voice_settings: { stability: 0.4, similarity_boost: 0.8 },
        xi_api_key: opts.apiKey,
      }),
    );
    for (const text of pending) sendText(text);
    pending.length = 0;
    if (finishRequested) {
      stopKeepalive();
      ws.send(JSON.stringify({ text: "" }));
      return;
    }
    if (flushRequested) {
      flushRequested = false;
      sendFlush();
    }
    keepalive = setInterval(sendKeepalive, keepaliveMs);
  });

  ws.on("message", (raw) => {
    if (closed) return;
    let msg: { audio?: string; isFinal?: boolean; error?: string };
    try {
      msg = JSON.parse(raw.toString()) as {
        audio?: string;
        isFinal?: boolean;
        error?: string;
      };
    } catch {
      return;
    }
    if (msg.error) {
      fail(new Error(msg.error));
      return;
    }
    if (msg.audio) {
      opts.onAudio(Buffer.from(msg.audio, "base64"));
    }
    // Flush completes a generation cycle and can emit isFinal while the
    // socket stays open for later text (tool-call gaps). Only EOS (`finish`)
    // is the stream end; treating flush-isFinal as onEnd would null the
    // AgentTurn handle and starve keepalive.
    if (msg.isFinal && finishRequested) {
      stopKeepalive();
      opts.onEnd?.();
    }
  });
  ws.on("error", (err) => {
    fail(err);
  });
  ws.on("close", () => {
    if (closed || finishRequested) {
      stopKeepalive();
      return;
    }
    fail(new Error("tts_ws_closed"));
  });

  return {
    pushText(text) {
      if (closed) return;
      if (opened && ws.readyState === WebSocket.OPEN) {
        sendText(text);
      } else if (!opened) {
        pending.push(text);
      }
    },
    flush() {
      if (closed || finishRequested) return;
      if (opened && ws.readyState === WebSocket.OPEN) {
        sendFlush();
        return;
      }
      flushRequested = true;
    },
    finish() {
      if (closed) return;
      finishRequested = true;
      stopKeepalive();
      if (opened && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text: "" }));
      }
    },
    close() {
      closed = true;
      pending.length = 0;
      finishRequested = false;
      flushRequested = false;
      stopKeepalive();
      try {
        if (ws.readyState === WebSocket.CONNECTING) {
          // Closing a CONNECTING ws throws an async "closed before
          // established" error; wait for open, then close quietly.
          ws.once("open", () => {
            try {
              ws.close();
            } catch {
              /* already closed */
            }
          });
          ws.removeAllListeners("error");
          ws.on("error", () => undefined);
        } else {
          ws.close();
        }
      } catch {
        /* already closed */
      }
    },
  };
}
