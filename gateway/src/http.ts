import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";
import type { RawData } from "ws";
import type { ConfigStore } from "./config-store.js";
import type { UserConfig } from "./config-schema.js";
import { HARNESS_ORDER } from "./config-schema.js";
import { spawnCommandBox, type BoxConnection } from "./box-client.js";
import { harnessEnv } from "./harness-env.js";
import { AgentTurn, type VoiceSink } from "./agent-turn.js";
import {
  createSttAdapter,
  createTtsAdapter,
  listSttProviders,
  listTtsProviders,
  resolveVoiceProviderId,
  STT_SAMPLE_RATE,
  VOICE_AUDIO_FORMAT,
  type SttAdapter,
  type SttStream,
  type TtsAdapter,
} from "./voice-providers.js";
import { SessionSink } from "./session-sink.js";
import { VoiceInput } from "./voice-input.js";
import { modelCatalogFor } from "./model-catalog.js";

/** Headless API. The only client is the mobile app. */
export interface GatewayOptions {
  token: string;
  store: ConfigStore;
  sttProviderId?: string;
  ttsProviderId?: string;
  voiceSecrets?: Record<string, string>;
  /** @deprecated mapped into voiceSecrets for existing tests */
  deepgramKey?: string;
  /** @deprecated mapped into voiceSecrets for existing tests */
  elevenKey?: string;
  /** Adapter argv, spawned as a child process per session. */
  boxCommand: string[];
  /** Ephemeral workspace provisioned before the harness starts. */
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

interface GatewayRuntime {
  opts: GatewayOptions;
  sttProviderId: string;
  ttsProviderId: string;
  voiceSecrets: Record<string, string>;
  sttAdapter?: SttAdapter;
  ttsAdapter?: TtsAdapter;
  ttsResolutionAttempted: boolean;
}

export interface VoiceSession {
  userId: string;
  config: UserConfig;
  turn: AgentTurn;
  sink: SessionSink;
  attachment?: VoiceAttachment;
}

export function createGateway(opts: GatewayOptions) {
  const runtime = resolveRuntime(opts);
  const generationId = opts.generationId ?? randomUUID();
  const sessions = new Map<string, VoiceSession>();
  const pendingSessions = new Map<string, Promise<VoiceSession>>();

  const server = createServer((req, res) => {
    void handleHttp(req, res, runtime, sessions);
  });

  const wss = new WebSocketServer({ server, path: "/v1/voice" });
  wss.on("connection", (ws, req) => {
    void handleVoice(
      ws,
      req,
      runtime,
      sessions,
      pendingSessions,
      generationId,
    );
  });

  return { server, wss, sessions, generationId };
}

function resolveRuntime(opts: GatewayOptions): GatewayRuntime {
  const voiceSecrets = {
    ...(opts.deepgramKey !== undefined
      ? { DEEPGRAM_API_KEY: opts.deepgramKey }
      : {}),
    ...(opts.elevenKey !== undefined
      ? { ELEVENLABS_API_KEY: opts.elevenKey }
      : {}),
    ...(opts.voiceSecrets ?? {}),
  };
  return {
    opts,
    sttProviderId: resolveVoiceProviderId("stt", opts.sttProviderId),
    ttsProviderId: resolveVoiceProviderId("tts", opts.ttsProviderId),
    voiceSecrets,
    ttsResolutionAttempted: false,
  };
}

function getSttAdapter(runtime: GatewayRuntime): SttAdapter {
  runtime.sttAdapter ??= createSttAdapter(
    runtime.sttProviderId,
    runtime.voiceSecrets,
  );
  return runtime.sttAdapter;
}

function getTtsAdapter(runtime: GatewayRuntime): TtsAdapter | undefined {
  if (runtime.ttsResolutionAttempted) return runtime.ttsAdapter;
  runtime.ttsResolutionAttempted = true;
  try {
    runtime.ttsAdapter = createTtsAdapter(
      runtime.ttsProviderId,
      runtime.voiceSecrets,
    );
  } catch {
    // TTS is optional; text-only turns preserve the existing behavior.
  }
  return runtime.ttsAdapter;
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: GatewayRuntime,
  sessions: Map<string, VoiceSession>,
): Promise<void> {
  const { opts } = runtime;
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/capabilities") {
    if (!authorize(req, opts.token, url)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    json(res, 200, {
      stt: {
        providerId: runtime.sttProviderId,
        providers: listSttProviders(),
      },
      tts: {
        providerId: runtime.ttsProviderId,
        providers: listTtsProviders(),
      },
      audioFormat: VOICE_AUDIO_FORMAT,
      capture: {
        encoding: "pcm_s16le",
        sampleRate: STT_SAMPLE_RATE,
        channels: 1,
      },
    });
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

  if (req.method === "GET" && url.pathname === "/v1/model-catalog") {
    if (!authorize(req, opts.token, url)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    const userId = url.searchParams.get("userId") || "default";
    const requested = url.searchParams.get("harness")?.trim() || undefined;
    const harness = requested ?? (await opts.store.get(userId)).harness;
    const catalog = modelCatalogFor(harness);
    if (!catalog) {
      json(res, 400, { error: "unknown harness" });
      return;
    }
    json(res, 200, catalog);
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
    await debugPrompt(req, res, runtime);
    return;
  }

  json(res, 404, { error: "not found" });
}

async function debugPrompt(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: GatewayRuntime,
): Promise<void> {
  const { opts } = runtime;
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
  } catch {
    json(res, 503, { error: "agent unavailable" });
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

  const turn = new AgentTurn(box, sink, config, getTtsAdapter(runtime), {
    onIdle: endOnce,
    getConfig: () => opts.store.get(userId),
  });
  const timer = setTimeout(() => {
    void turn.close();
    if (!res.writableEnded) res.end();
  }, 10 * 60 * 1000);

  function endOnce() {
    clearTimeout(timer);
    void turn.close().then(() => {
      if (!res.writableEnded) res.end();
    });
  }
  turn.initialize(config.repo.credential);
  turn.enqueue(text);
}

async function handleVoice(
  ws: WebSocket,
  req: IncomingMessage,
  runtime: GatewayRuntime,
  sessions: Map<string, VoiceSession>,
  pendingSessions: Map<string, Promise<VoiceSession>>,
  generationId: string,
): Promise<void> {
  const { opts } = runtime;
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!authorize(req, opts.token, url)) {
    ws.close(4401, "unauthorized");
    return;
  }

  const userId = url.searchParams.get("userId") || "default";
  const mode = url.searchParams.get("mode") === "handsfree" ? "handsfree" : "ptt";
  const focused = url.searchParams.get("focused") !== "false";
  const afterEventId = parseEventCursor(url.searchParams.get("afterEventId"));
  let sttAdapter: SttAdapter;
  try {
    sttAdapter = getSttAdapter(runtime);
  } catch (err) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    ws.close(4500, "no stt");
    return;
  }
  const gitAuth = captureGitCredential(ws);

  let session: VoiceSession;
  try {
    session = await getOrCreateVoiceSession(
      userId,
      runtime,
      sessions,
      pendingSessions,
    );
  } catch (err) {
    gitAuth.cancel();
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
  const cleanupAttachment = () => {
    attachment.stt?.close();
    attachment.stt = undefined;
    if (session.attachment !== attachment) return;
    session.attachment = undefined;
    session.turn.setSpeechEnabled(false);
    session.sink.detach(ws);
  };
  ws.once("close", cleanupAttachment);

  let forwardedGitAuthDuringProvisioning = false;
  const forwardGitAuthDuringProvisioning = (
    raw: RawData,
    isBinary: boolean,
  ) => {
    if (isBinary || session.attachment !== attachment) return;
    try {
      const msg = JSON.parse(bufferText(raw)) as {
        type?: unknown;
        credential?: unknown;
      };
      if (
        msg.type === "git_auth" &&
        typeof msg.credential === "string" &&
        msg.credential.length <= 65_536
      ) {
        forwardedGitAuthDuringProvisioning = true;
        session.turn.setGitAuth(msg.credential);
      }
    } catch {
      // Ignore malformed pre-ready messages.
    }
  };
  ws.on("message", forwardGitAuthDuringProvisioning);
  ws.once("close", () => {
    ws.off("message", forwardGitAuthDuringProvisioning);
  });

  const credential = await gitAuth.promise;
  if (
    credential === null ||
    session.attachment !== attachment ||
    ws.readyState !== WebSocket.OPEN
  ) {
    ws.off("message", forwardGitAuthDuringProvisioning);
    return;
  }
  if (!session.turn.isInitializationStarted) {
    session.turn.initialize(credential);
  } else if (!forwardedGitAuthDuringProvisioning) {
    session.turn.setGitAuth(credential);
  }
  const provisioningAtAttach = !session.turn.isReady;
  if (provisioningAtAttach) {
    session.sink.replayAfter(afterEventId ?? 0);
  }

  try {
    await session.turn.ready;
  } catch (err) {
    ws.off("message", forwardGitAuthDuringProvisioning);
    if (sessions.get(userId) === session) sessions.delete(userId);
    await session.turn.close().catch(() => undefined);
    if (session.attachment === attachment && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      ws.close(4503, "provisioning failed");
    }
    return;
  }
  if (session.attachment !== attachment || ws.readyState !== WebSocket.OPEN) {
    ws.off("message", forwardGitAuthDuringProvisioning);
    return;
  }
  ws.off("message", forwardGitAuthDuringProvisioning);

  const attachStt = () => {
    attachment.stt?.close();
    attachment.stt = sttAdapter.open({
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
  if (!provisioningAtAttach && afterEventId !== undefined) {
    session.sink.replayAfter(afterEventId);
  }

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
      // CloseStream so STT flushes a late final; VoiceInput commits once.
      attachment.stt?.finish();
    }
    if (msg.type === "abort") input.userAbort();
    if (msg.type === "git_auth") {
      const credential = (msg as { credential?: unknown }).credential;
      if (typeof credential === "string" && credential.length <= 65_536) {
        session.turn.setGitAuth(credential);
      }
    }
  });

}

function captureGitCredential(ws: WebSocket): {
  promise: Promise<string | null>;
  cancel(): void;
} {
  let settle: ((credential: string | null) => void) | undefined;
  const promise = new Promise<string | null>((resolve) => {
    const finish = (credential: string | null) => {
      ws.off("message", onMessage);
      ws.off("close", onClose);
      resolve(credential);
    };
    const onClose = () => finish(null);
    const onMessage = (raw: RawData, isBinary: boolean) => {
      if (isBinary) return;
      try {
        const msg = JSON.parse(bufferText(raw)) as {
          type?: unknown;
          credential?: unknown;
        };
        if (
          msg.type === "git_auth" &&
          typeof msg.credential === "string" &&
          msg.credential.length <= 65_536
        ) {
          finish(msg.credential);
        }
      } catch {
        // Ignore malformed pre-ready messages.
      }
    };
    settle = finish;
    ws.on("message", onMessage);
    ws.once("close", onClose);
  });
  return {
    promise,
    cancel: () => settle?.(null),
  };
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
  runtime: GatewayRuntime,
  sessions: Map<string, VoiceSession>,
  pendingSessions: Map<string, Promise<VoiceSession>>,
): Promise<VoiceSession> {
  const current = sessions.get(userId);
  if (current) return current;

  const pending = pendingSessions.get(userId);
  if (pending) return pending;

  const creating = (async () => {
    const { opts } = runtime;
    const config = await opts.store.get(userId);
    const sink = new SessionSink();
    const turn = new AgentTurn(
      openBox(opts, config),
      sink,
      config,
      getTtsAdapter(runtime),
      {
      getConfig: () => opts.store.get(userId),
      },
    );
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
