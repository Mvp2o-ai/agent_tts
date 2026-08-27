import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ConfigStore } from "./config-store.js";
import type { UserConfig } from "./config-schema.js";
import { HARNESS_ORDER } from "./config-schema.js";
import { spawnCommandBox, type BoxConnection } from "./box-client.js";
import { harnessEnv } from "./harness-env.js";
import { AgentTurn, type VoiceSink } from "./agent-turn.js";
import { openDeepgram, type SttStream } from "./deepgram.js";
import { VOICE_AUDIO_FORMAT } from "./elevenlabs.js";
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
}

export function createGateway(opts: GatewayOptions) {
  const sessions = new Map<
    WebSocket,
    { turn: AgentTurn; stt?: SttStream; userId: string }
  >();

  const server = createServer((req, res) => {
    void handleHttp(req, res, opts, sessions);
  });

  const wss = new WebSocketServer({ server, path: "/v1/voice" });
  wss.on("connection", (ws, req) => {
    void handleVoice(ws, req, opts, sessions);
  });

  return { server, wss, sessions };
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  opts: GatewayOptions,
  sessions: Map<WebSocket, { turn: AgentTurn; stt?: SttStream; userId: string }>,
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
    for (const [ws, session] of sessions) {
      session.stt?.close();
      await session.turn.close();
      sessions.delete(ws);
      try {
        ws.close(4000, "reset");
      } catch {
        /* already closed */
      }
    }
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
  sessions: Map<WebSocket, { turn: AgentTurn; stt?: SttStream; userId: string }>,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!authorize(req, opts.token, url)) {
    ws.close(4401, "unauthorized");
    return;
  }

  const userId = url.searchParams.get("userId") || "default";
  const mode = url.searchParams.get("mode") === "handsfree" ? "handsfree" : "ptt";
  const config = await opts.store.get(userId);
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

  let box: BoxConnection;
  try {
    box = openBox(opts, config);
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

  const sink: VoiceSink = {
    sendJson(event) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    },
    sendAudio(pcm) {
      if (ws.readyState === ws.OPEN) ws.send(pcm);
    },
  };

  const turn = new AgentTurn(box, sink, config, opts.elevenKey);
  const input = new VoiceInput(
    turn,
    mode,
    config.voice.stopWord || "hard stop",
    sink,
  );
  let stt: SttStream | undefined;

  const attachStt = () => {
    stt?.close();
    stt = openDeepgram({
      apiKey: opts.deepgramKey!,
      onError: (err) => sink.sendJson({ type: "error", message: err.message }),
      onEvent: (ev) => input.onStt(ev),
    });
  };

  if (mode === "handsfree") attachStt();

  sessions.set(ws, { turn, stt, userId });
  ws.send(
    JSON.stringify({
      type: "ready",
      mode,
      harness: config.harness,
      audioFormat: VOICE_AUDIO_FORMAT,
    }),
  );

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw as ArrayBuffer);
      if (buf.length && stt) stt.sendPcm(buf);
      return;
    }
    let msg: { type?: string };
    try {
      msg = JSON.parse(bufferText(raw)) as { type?: string };
    } catch {
      return;
    }
    if (msg.type === "ptt_start") {
      input.pttStart();
      attachStt();
    }
    if (msg.type === "ptt_end") {
      input.pttEnd();
      // CloseStream so Deepgram flushes a late final; VoiceInput commits once.
      stt?.finish();
    }
    if (msg.type === "abort") input.userAbort();
  });

  ws.on("close", () => {
    stt?.close();
    void turn.close();
    sessions.delete(ws);
  });
}

async function teardownUserSessions(
  sessions: Map<WebSocket, { turn: AgentTurn; stt?: SttStream; userId: string }>,
  userId: string,
): Promise<number> {
  const live: WebSocket[] = [];
  for (const [ws, session] of sessions) {
    if (session.userId === userId) live.push(ws);
  }
  for (const ws of live) {
    const session = sessions.get(ws);
    session?.stt?.close();
    await session?.turn.close();
    sessions.delete(ws);
    try {
      ws.close(4000, "killed");
    } catch {
      /* already closed */
    }
  }
  return live.length;
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
