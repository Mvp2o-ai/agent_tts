import { base64ToArrayBuffer } from "./base64";

export type VoiceMode = "ptt" | "handsfree";

export const GATEWAY_PLAYBACK_FORMAT = {
  encoding: "pcm_s16le",
  sampleRate: 24_000,
  channels: 1,
} as const;

export type GatewayAudioFormat = {
  encoding: string;
  sampleRate: number;
  channels: number;
};

export interface Connection {
  gatewayUrl: string;
  token: string;
  userId: string;
}

export type IncomingFrame =
  | { kind: "json"; text: string }
  | { kind: "audio"; buffer: ArrayBuffer }
  | { kind: "unknown" };

const FATAL_CLOSE_CODES = new Set([4400, 4401, 4403, 4500, 4503]);
const DEFAULT_MAX_RECONNECTS = 3;

export function normalizeGatewayUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function httpToWs(url: string): string | null {
  const normalized = normalizeGatewayUrl(url);
  if (normalized.startsWith("https://")) return `wss://${normalized.slice("https://".length)}`;
  if (normalized.startsWith("http://")) return `ws://${normalized.slice("http://".length)}`;
  if (normalized.startsWith("wss://") || normalized.startsWith("ws://")) return normalized;
  return null;
}

export function connectionError(conn: Connection): string | null {
  const url = normalizeGatewayUrl(conn.gatewayUrl);
  if (!url || url === "http:" || url === "https:" || url === "http://" || url === "https://") {
    return "Set a gateway URL (http://host:port or https://host).";
  }
  if (!httpToWs(url)) {
    return "Gateway URL must start with http:// or https://.";
  }
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return "Gateway URL is missing a host.";
  } catch {
    return "Gateway URL is not a valid URL.";
  }
  if (!conn.token.trim()) return "Set a gateway token.";
  if (!conn.userId.trim()) return "Set a user id.";
  return null;
}

export function voiceUrl(
  conn: Connection,
  mode: VoiceMode,
  options: { focused?: boolean; afterEventId?: number } = {},
): string {
  const ws = httpToWs(conn.gatewayUrl);
  if (!ws) throw new Error("invalid gateway URL");
  const q = new URLSearchParams({
    token: conn.token,
    userId: conn.userId,
    mode,
    focused: String(options.focused ?? true),
  });
  if (options.afterEventId !== undefined) {
    q.set("afterEventId", String(options.afterEventId));
  }
  return `${ws}/v1/voice?${q.toString()}`;
}

export function configUrl(conn: Connection): string {
  const base = normalizeGatewayUrl(conn.gatewayUrl);
  return `${base}/v1/config?userId=${encodeURIComponent(conn.userId)}`;
}

export function killSessionUrl(conn: Connection): string {
  const base = normalizeGatewayUrl(conn.gatewayUrl);
  return `${base}/v1/session/kill?userId=${encodeURIComponent(conn.userId)}`;
}

/** New session = new container: the gateway exits and the platform recreates it. */
export function resetSessionUrl(conn: Connection): string {
  const base = normalizeGatewayUrl(conn.gatewayUrl);
  return `${base}/v1/session/reset`;
}

function looksLikeJsonObject(text: string): boolean {
  const t = text.trim();
  return t.startsWith("{") && t.endsWith("}");
}

function classifyBuffer(buf: ArrayBuffer): IncomingFrame {
  if (buf.byteLength === 0) return { kind: "unknown" };
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x7b) {
    try {
      const text = new TextDecoder().decode(u8);
      if (looksLikeJsonObject(text)) return { kind: "json", text };
    } catch {
      // fall through and treat as audio
    }
  }
  return { kind: "audio", buffer: buf };
}

export function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

/**
 * Fail closed when `ready.audioFormat` is missing or is not PCM s16le 24 kHz mono.
 */
export function validateReadyAudioFormat(format: unknown): string | null {
  if (format == null || typeof format !== "object") {
    return "gateway ready is missing audioFormat { encoding: pcm_s16le, sampleRate: 24000, channels: 1 }";
  }
  const value = format as Partial<GatewayAudioFormat>;
  if (value.encoding !== GATEWAY_PLAYBACK_FORMAT.encoding) {
    return `incompatible audio encoding ${String(value.encoding)} (need pcm_s16le)`;
  }
  if (value.sampleRate !== GATEWAY_PLAYBACK_FORMAT.sampleRate) {
    return `incompatible sampleRate ${String(value.sampleRate)} (need 24000)`;
  }
  if (value.channels !== GATEWAY_PLAYBACK_FORMAT.channels) {
    return `incompatible channels ${String(value.channels)} (need 1)`;
  }
  return null;
}

/**
 * RN WebSocket may deliver JSON as a string and PCM as ArrayBuffer, a typed
 * array, or (on some builds) a base64 string. JSON-looking binary frames are
 * treated as events, never as audio.
 */
export function classifyIncomingFrame(data: unknown): IncomingFrame {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return { kind: "unknown" };
    if (trimmed.startsWith("{")) return { kind: "json", text: trimmed };
    return { kind: "audio", buffer: base64ToArrayBuffer(trimmed) };
  }
  if (data instanceof ArrayBuffer) return classifyBuffer(data);
  if (ArrayBuffer.isView(data)) return classifyBuffer(toArrayBuffer(data));
  return { kind: "unknown" };
}

export function wsCloseMessage(code: number, reason: string): string {
  const extra = reason.trim();
  switch (code) {
    case 1000:
      return extra || "disconnected";
    case 1006:
      return extra || "connection lost";
    case 4400:
      return extra || "bad request";
    case 4401:
      return extra || "unauthorized — check gateway token";
    case 4403:
      return extra || "forbidden";
    case 4500:
      return extra || "gateway is missing STT configuration";
    case 4503:
      return extra || "agent box failed to start";
    default:
      return extra ? `${extra} (${code})` : `disconnected (${code})`;
  }
}

export function nextReconnectDelay(opts: {
  userClosed: boolean;
  attempt: number;
  closeCode?: number;
  maxAttempts?: number;
}): number | null {
  if (opts.userClosed) return null;
  if (opts.closeCode !== undefined && FATAL_CLOSE_CODES.has(opts.closeCode)) {
    return null;
  }
  const max = opts.maxAttempts ?? DEFAULT_MAX_RECONNECTS;
  if (opts.attempt >= max) return null;
  return Math.min(1000 * 2 ** opts.attempt, 8000);
}
