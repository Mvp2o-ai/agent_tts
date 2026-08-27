import WebSocket from "ws";

export interface TtsStream {
  pushText(text: string): void;
  finish(): void;
  close(): void;
}

/** Minimal transport so tests can drive the CONNECTING/open/finish sequence. */
export interface TtsTransport {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "open", cb: () => void): this;
  on(event: "message", cb: (raw: { toString(): string }) => void): this;
  on(event: "error", cb: (err: Error) => void): this;
  once(event: "open", cb: () => void): this;
  removeAllListeners(event?: string): this;
}

/** First-party stream-input format: PCM S16LE at the given sample rate. */
export const TTS_OUTPUT_FORMAT = "pcm_24000";
export const VOICE_AUDIO_FORMAT = {
  encoding: "pcm_s16le",
  sampleRate: 24000,
  channels: 1,
} as const;

export function elevenLabsStreamUrl(voiceId: string): string {
  const voice = encodeURIComponent(voiceId);
  return (
    `wss://api.elevenlabs.io/v1/text-to-speech/${voice}/stream-input` +
    `?model_id=eleven_flash_v2_5&output_format=${TTS_OUTPUT_FORMAT}`
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
  },
): TtsStream {
  const pending: string[] = [];
  let finishRequested = false;
  let opened = false;
  let closed = false;

  const sendText = (text: string) => {
    ws.send(JSON.stringify({ text: `${text} `, try_trigger_generation: true }));
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
    if (finishRequested) ws.send(JSON.stringify({ text: "" }));
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
      opts.onError(new Error(msg.error));
      return;
    }
    if (msg.audio) {
      opts.onAudio(Buffer.from(msg.audio, "base64"));
    }
    if (msg.isFinal) opts.onEnd?.();
  });
  ws.on("error", (err) => {
    if (!closed) opts.onError(err);
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
    finish() {
      if (closed) return;
      if (opened && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text: "" }));
      } else {
        finishRequested = true;
      }
    },
    close() {
      closed = true;
      pending.length = 0;
      finishRequested = false;
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
