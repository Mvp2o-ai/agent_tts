import WebSocket from "ws";

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  speechStarted?: boolean;
  utteranceEnd?: boolean;
}

export interface SttStream {
  sendPcm(chunk: Buffer): void;
  /** Stop sending audio but keep receiving until Deepgram flushes finals. */
  finish(): void;
  close(): void;
}

/** 16 kHz mono int16 — 3s is enough for CONNECTING without unbounded growth. */
export const STT_SAMPLE_RATE = 16000;
export const STT_BYTES_PER_SAMPLE = 2;
export const STT_PREOPEN_MS = 3000;
export const STT_PREOPEN_BYTES =
  (STT_SAMPLE_RATE * STT_BYTES_PER_SAMPLE * STT_PREOPEN_MS) / 1000;

/** Minimal transport so tests can drive CONNECTING/open/finish. */
export interface SttTransport {
  readyState: number;
  send(data: Buffer | string): void;
  close(): void;
  on(event: "open", cb: () => void): this;
  on(event: "message", cb: (raw: { toString(): string }) => void): this;
  on(event: "error", cb: (err: Error) => void): this;
  once(event: "open", cb: () => void): this;
  removeAllListeners(event?: string): this;
}

export function openDeepgram(opts: {
  apiKey: string;
  onEvent: (ev: TranscriptEvent) => void;
  onError: (err: Error) => void;
}): SttStream {
  const params = new URLSearchParams({
    model: "nova-2",
    encoding: "linear16",
    sample_rate: String(STT_SAMPLE_RATE),
    channels: "1",
    interim_results: "true",
    punctuate: "true",
    endpointing: "300",
    utterance_end_ms: "1200",
    vad_events: "true",
    smart_format: "true",
  });
  const ws = new WebSocket(
    `wss://api.deepgram.com/v1/listen?${params.toString()}`,
    { headers: { Authorization: `Token ${opts.apiKey}` } },
  );
  return attachStreamingStt(ws as unknown as SttTransport, opts);
}

/**
 * PCM pushed before the socket opens is held in a ring of STT_PREOPEN_BYTES
 * and flushed in order on open — otherwise hands-free audio that starts at
 * `ready` is dropped while Deepgram is still CONNECTING.
 *
 * Capacity: drop oldest bytes first (keep the most recent 3s). `close()`
 * discards the buffer so a dead session cannot flush. `finish()` before
 * open keeps the buffer and sends CloseStream after the flush.
 */
export function attachStreamingStt(
  ws: SttTransport,
  opts: {
    onEvent: (ev: TranscriptEvent) => void;
    onError: (err: Error) => void;
  },
): SttStream {
  const pending: Buffer[] = [];
  let pendingBytes = 0;
  let opened = false;
  let closed = false;
  let finishRequested = false;

  const pushPending = (chunk: Buffer) => {
    if (chunk.length === 0) return;
    pending.push(chunk);
    pendingBytes += chunk.length;
    while (pendingBytes > STT_PREOPEN_BYTES && pending.length > 0) {
      const extra = pendingBytes - STT_PREOPEN_BYTES;
      const head = pending[0];
      if (head.length <= extra) {
        pending.shift();
        pendingBytes -= head.length;
      } else {
        pending[0] = head.subarray(extra);
        pendingBytes -= extra;
      }
    }
  };

  const discardPending = () => {
    pending.length = 0;
    pendingBytes = 0;
  };

  const sendCloseStream = () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "CloseStream" }));
      setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }, 3000).unref?.();
    }
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
    for (const chunk of pending) ws.send(chunk);
    discardPending();
    if (finishRequested) sendCloseStream();
  });

  ws.on("message", (raw) => {
    if (closed) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.type === "SpeechStarted") {
      opts.onEvent({ text: "", isFinal: false, speechStarted: true });
      return;
    }
    if (msg.type === "UtteranceEnd") {
      opts.onEvent({ text: "", isFinal: true, utteranceEnd: true });
      return;
    }
    const channel = msg.channel as
      | { alternatives?: { transcript?: string }[] }
      | undefined;
    const alt = channel?.alternatives?.[0];
    const text = alt?.transcript ?? "";
    if (!text && !msg.is_final) return;
    opts.onEvent({
      text,
      isFinal: Boolean(msg.is_final),
    });
  });
  ws.on("error", (err) => {
    if (!closed) opts.onError(err);
  });

  return {
    sendPcm(chunk) {
      if (closed || chunk.length === 0) return;
      if (opened && ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
        return;
      }
      if (!opened && !closed) pushPending(chunk);
    },
    finish() {
      if (closed) return;
      if (opened && ws.readyState === WebSocket.OPEN) {
        sendCloseStream();
      } else {
        finishRequested = true;
      }
    },
    close() {
      closed = true;
      finishRequested = false;
      discardPending();
      try {
        if (ws.readyState === WebSocket.CONNECTING) {
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
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "CloseStream" }));
          }
          ws.close();
        }
      } catch {
        /* already closed */
      }
    },
  };
}
