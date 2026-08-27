import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { ConfigStore } from "./config-store.js";
import type { UserConfig } from "./config-schema.js";
import { HARNESS_ORDER } from "./config-schema.js";
import { spawnCommandBox, type BoxConnection } from "./box-client.js";
import { harnessEnv } from "./harness-env.js";
import { AgentTurn, type VoiceSink } from "./agent-turn.js";
import { openDeepgram, type SttStream } from "./deepgram.js";
import { VOICE_AUDIO_FORMAT } from "./elevenlabs.js";
import { SessionSink } from "./session-sink.js";
import { VoiceInput } from "./voice-input.js";

/** Headless API. The only client is the mobile app. */
export interface GatewayOptions {
  token: string;
  store: ConfigStore;
  deepgramKey?: string;
  elevenKey?: string;
  /** Adapter argv, spawned as a child process per session. */
  boxCommand: string[];
  /** Harness working directory (empty at container start; agent clones). */
  workspaceDir?: string;
  /**
   * Invoked by POST /v1/session/reset after sessions close. Production exits
   * the process so the platform recreates the container from the image.
   */
  onReset?: () => void;
  /** Stable for this process lifetime; injectable for protocol tests. */
  generationId?: string;
}

interface VoiceAttachment {
  ws: WebSocket;
  input: VoiceInput;
  mode: "ptt" | "handsfree";
  focused: boolean;
  stt?: SttStream;
}

export interface VoiceSession {
  userId: string;
  config: UserConfig;
  turn: AgentTurn;
  sink: SessionSink;
  attachment?: VoiceAttachment;
}

export function createGateway(opts: GatewayOptions) {
  const generationId = opts.generationId ?? randomUUID();
  const sessions = new Map<string, VoiceSession>();
  const pendingSessions = new Map<string, Promise<VoiceSession>>();

  const server = createServer((req, res) => {
    void handleHttp(req, res, opts, sessions);
  });

  const wss = new WebSocketServer({ server, path: "/v1/voice" });
  wss.on("connection", (ws, req) => {
    void handleVoice(
      ws,
      req,
      opts,
      sessions,
      pendingSessions,
      generationId,
    );
  });

  return { server, wss, sessions, generationId };
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  opts: GatewayOptions,
  sessions: Map<string, VoiceSession>,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/harnesses") {
    if (!authorize(req, opts.token, url)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    json(res, 200, { harnesses: HARNESS_ORDER });
    return;
  }

  if (url.pathname === "/v1/config") {
    if (!authorize(req, opts.token, url)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    const userId = url.searchParams.get("userId") || "default";
    if (req.method === "GET") {
      json(res, 200, await opts.store.get(userId));
      return;
    }
    if (req.method === "PUT") {
      const body = (await readJson(req)) as Partial<UserConfig>;
      json(res, 200, await opts.store.save(userId, body));
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/v1/session/kill") {
    if (!authorize(req, opts.token, url)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    const userId = url.searchParams.get("userId") || "default";
    const killed = await teardownUserSessions(sessions, userId);
    json(res, 200, { ok: true, killed });
    return;
  }

  // New session = new container. Close everything, then let onReset exit the
  // process; the operator's platform recreates the container from the image.
  if (req.method === "POST" && url.pathname === "/v1/session/reset") {
    if (!authorize(req, opts.token, url)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    for (const session of sessions.values()) {
      await closeVoiceSession(session, 4000, "reset");
    }
    sessions.clear();
    json(res, 200, { ok: true, restarting: Boolean(opts.onReset) });
    res.once("close", () => opts.onReset?.());
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/debug/prompt") {
    if (!authorize(req, opts.token, url)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    await debugPrompt(req, res, opts);
    return;
  }

  json(res, 404, { error: "not found" });
}

async function debugPrompt(
  req: IncomingMessage,
  res: ServerResponse,
  opts: GatewayOptions,
): Promise<void> {
  const body = (await readJson(req)) as { userId?: string; text?: string };
  const userId = body.userId || "default";
  const text = body.text?.trim();
  if (!text) {
    json(res, 400, { error: "text required" });
    return;
  }
  const config = await opts.store.get(userId);

  let box: BoxConnection;
  try {
    box = openBox(opts, config);
  } catch (err) {
    json(res, 503, {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  res.writeHead(200, {
    "content-type": "application/x-ndjson",
    "cache-control": "no-cache",
  });

  const sink: VoiceSink = {
    sendJson(event) {
      res.write(`${JSON.stringify(event)}\n`);
    },
    sendAudio() {
      /* debug prompt is text; TTS still runs if keys exist via events */
    },
  };

  let turn!: AgentTurn;
  const timer = setTimeout(() => {
    void turn.close();
    if (!res.writableEnded) res.end();
  }, 10 * 60 * 1000);

  const endOnce = () => {
    clearTimeout(timer);
    void turn.close().then(() => {
      if (!res.writableEnded) res.end();
    });
  };

  turn = new AgentTurn(box, sink, config, opts.elevenKey, { onIdle: endOnce });
  turn.enqueue(text);
}

async function handleVoice(
  ws: WebSocket,
  req: IncomingMessage,
  opts: GatewayOptions,
  sessions: Map<string, VoiceSession>,
  pendingSessions: Map<string, Promise<VoiceSession>>,
  generationId: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!authorize(req, opts.token, url)) {
    ws.close(4401, "unauthorized");
    return;
  }

  const userId = url.searchParams.get("userId") || "default";
  const mode = url.searchParams.get("mode") === "handsfree" ? "handsfree" : "ptt";
  const focused = url.searchParams.get("focused") !== "false";
  const afterEventId = parseEventCursor(url.searchParams.get("afterEventId"));
  if (!opts.deepgramKey) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "DEEPGRAM_API_KEY is required for voice",
      }),
    );
    ws.close(4500, "no stt");
    return;
  }

  let session: VoiceSession;
  try {
    session = await getOrCreateVoiceSession(
      userId,
      opts,
      sessions,
      pendingSessions,
    );
  } catch (err) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    ws.close(4503, "no box");
    return;
  }

  const previous = session.attachment;
  if (previous) {
    previous.stt?.close();
    try {
      previous.ws.close(4001, "replaced by reconnect");
    } catch {
      /* already closed */
    }
  }

  const input = new VoiceInput(
    session.turn,
    mode,
    session.config.voice.stopWord || "hard stop",
    session.sink,
  );
  const attachment: VoiceAttachment = { ws, input, mode, focused };
  session.attachment = attachment;
  session.sink.attach(ws, focused);
  session.turn.setSpeechEnabled(focused);

  const attachStt = () => {
    attachment.stt?.close();
    attachment.stt = openDeepgram({
      apiKey: opts.deepgramKey!,
      onError: (err) =>
        session.sink.sendJson({ type: "error", message: err.message }),
      onEvent: (ev) => input.onStt(ev),
    });
  };

  if (mode === "handsfree" && focused) attachStt();

  ws.send(
    JSON.stringify({
      type: "ready",
      mode,
      harness: session.config.harness,
      generationId,
      focused,
      sessionState: session.turn.activity,
      oldestEventId: session.sink.oldestEventId,
      lastEventId: session.sink.lastEventId,
      audioFormat: VOICE_AUDIO_FORMAT,
    }),
  );
  if (afterEventId !== undefined) session.sink.replayAfter(afterEventId);

  ws.on("message", (raw, isBinary) => {
    if (session.attachment !== attachment) return;
    if (isBinary) {
      const buf = Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw as ArrayBuffer);
      if (buf.length && attachment.focused && attachment.stt) {
        attachment.stt.sendPcm(buf);
      }
      return;
    }
    let msg: { type?: string; focused?: unknown };
    try {
      msg = JSON.parse(bufferText(raw)) as {
        type?: string;
        focused?: unknown;
      };
    } catch {
      return;
    }
    if (msg.type === "focus" && typeof msg.focused === "boolean") {
      attachment.focused = msg.focused;
      session.sink.setFocused(msg.focused);
      session.turn.setSpeechEnabled(msg.focused);
      if (!msg.focused) {
        attachment.stt?.close();
        attachment.stt = undefined;
      } else if (mode === "handsfree") {
        attachStt();
      }
    }
    if (msg.type === "ptt_start" && attachment.focused) {
      input.pttStart();
      attachStt();
    }
    if (msg.type === "ptt_end") {
      input.pttEnd();
      // CloseStream so Deepgram flushes a late final; VoiceInput commits once.
      attachment.stt?.finish();
    }
    if (msg.type === "abort") input.userAbort();
  });

  ws.on("close", () => {
    attachment.stt?.close();
    attachment.stt = undefined;
    if (session.attachment !== attachment) return;
    session.attachment = undefined;
    session.turn.setSpeechEnabled(false);
    session.sink.detach(ws);
  });
}

async function teardownUserSessions(
  sessions: Map<string, VoiceSession>,
  userId: string,
): Promise<number> {
  const session = sessions.get(userId);
  if (!session) return 0;
  sessions.delete(userId);
  await closeVoiceSession(session, 4000, "killed");
  return 1;
}

async function getOrCreateVoiceSession(
  userId: string,
  opts: GatewayOptions,
  sessions: Map<string, VoiceSession>,
  pendingSessions: Map<string, Promise<VoiceSession>>,
): Promise<VoiceSession> {
  const current = sessions.get(userId);
  if (current) return current;

  const pending = pendingSessions.get(userId);
  if (pending) return pending;

  const creating = (async () => {
    const config = await opts.store.get(userId);
    const sink = new SessionSink();
    const turn = new AgentTurn(openBox(opts, config), sink, config, opts.elevenKey);
    const session = { userId, config, sink, turn };
    sessions.set(userId, session);
    return session;
  })();
  pendingSessions.set(userId, creating);
  try {
    return await creating;
  } finally {
    if (pendingSessions.get(userId) === creating) pendingSessions.delete(userId);
  }
}

async function closeVoiceSession(
  session: VoiceSession,
  code: number,
  reason: string,
): Promise<void> {
  const attachment = session.attachment;
  session.attachment = undefined;
  attachment?.stt?.close();
  await session.turn.close();
  if (!attachment) return;
  session.sink.detach(attachment.ws);
  try {
    attachment.ws.close(code, reason);
  } catch {
    /* already closed */
  }
}

function parseEventCursor(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

function openBox(opts: GatewayOptions, config: UserConfig): BoxConnection {
  if (!opts.boxCommand.length) throw new Error("boxCommand is empty");
  return spawnCommandBox(
    opts.boxCommand,
    harnessEnv(config, opts.workspaceDir),
  );
}

function authorize(req: IncomingMessage, token: string, url: URL): boolean {
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const query = url.searchParams.get("token") ?? "";
  return Boolean(token) && (bearer === token || query === token);
}

function bufferText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return String(raw);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}
