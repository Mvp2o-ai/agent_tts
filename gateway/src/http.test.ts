import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { createGateway } from "./http.js";
import { MemoryConfigStore } from "./config-store.js";
import { VOICE_AUDIO_FORMAT } from "./elevenlabs.js";
import type { AddressInfo } from "node:net";

const fakeBox = fileURLToPath(new URL("./testing/fake-box.ts", import.meta.url));
const failingProvisionBox = fileURLToPath(
  new URL("./testing/failing-provision-box.ts", import.meta.url),
);
const delayedReadyBox = fileURLToPath(
  new URL("./testing/delayed-ready-box.ts", import.meta.url),
);

describe("gateway http", () => {
  it("serves health and round-trips a debug prompt through the fake box", async () => {
    const store = new MemoryConfigStore();
    await store.save("default", {
      repo: { url: "", credential: "", repositories: [] },
      harness: "claude-code",
    });
    const { server } = createGateway({
      token: "test-token",
      store,
      deepgramKey: "test-stt-key",
      boxCommand: ["node", "--import", "tsx", fakeBox],
      generationId: "test-generation",
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(health.status, 200);

      const denied = await fetch(`http://127.0.0.1:${port}/v1/config?userId=default`);
      assert.equal(denied.status, 401);

      const capabilitiesDenied = await fetch(
        `http://127.0.0.1:${port}/v1/capabilities`,
      );
      assert.equal(capabilitiesDenied.status, 401);

      const capabilities = await fetch(
        `http://127.0.0.1:${port}/v1/capabilities`,
        { headers: { authorization: "Bearer test-token" } },
      );
      assert.equal(capabilities.status, 200);
      const capabilityBody = (await capabilities.json()) as {
        stt: { providerId: string; providers: { id: string }[] };
        tts: { providerId: string; providers: { id: string }[] };
        audioFormat: typeof VOICE_AUDIO_FORMAT;
      };
      assert.equal(capabilityBody.stt.providerId, "deepgram");
      assert.equal(capabilityBody.tts.providerId, "elevenlabs");
      assert.ok(capabilityBody.stt.providers.some((p) => p.id === "deepgram"));
      assert.ok(capabilityBody.tts.providers.some((p) => p.id === "elevenlabs"));
      assert.deepEqual(capabilityBody.audioFormat, VOICE_AUDIO_FORMAT);

      const cfg = await fetch(
        `http://127.0.0.1:${port}/v1/config?userId=default`,
        { headers: { authorization: "Bearer test-token" } },
      );
      assert.equal(cfg.status, 200);
      const body = (await cfg.json()) as { harness: string };
      assert.equal(body.harness, "claude-code");

      const prompt = await fetch(`http://127.0.0.1:${port}/v1/debug/prompt`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "hello from test" }),
      });
      assert.equal(prompt.status, 200);
      const ndjson = await prompt.text();
      assert.match(ndjson, /prompt_start/);
      assert.match(ndjson, /agent_text/);
      assert.match(ndjson, /"type":"done"/);

      const frames: Record<string, unknown>[] = [];
      const ready = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const ws = openAuthenticatedSocket(voiceSocketUrl(port));
        const timer = setTimeout(() => reject(new Error("ready timeout")), 5000);
        ws.on("message", (data) => {
          const msg = JSON.parse(String(data)) as Record<string, unknown>;
          frames.push(msg);
          if (msg.type === "ready") {
            clearTimeout(timer);
            ws.close();
            resolve(msg);
          }
        });
        ws.on("error", reject);
      });
      assert.equal(ready.mode, "ptt");
      assert.deepEqual(
        frames.map((frame) => frame.type),
        ["provisioning", "ready"],
      );
      assert.equal(ready.harness, "claude-code");
      assert.equal(ready.generationId, "test-generation");
      assert.equal(ready.lastEventId, 1);
      assert.deepEqual(ready.audioFormat, VOICE_AUDIO_FORMAT);

      const killed = await fetch(
        `http://127.0.0.1:${port}/v1/session/kill?userId=default`,
        {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
        },
      );
      assert.deepEqual(await killed.json(), { ok: true, killed: 1 });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await store.close();
    }
  });

  it("writes authenticated client logs to stdout", async () => {
    const store = new MemoryConfigStore();
    const { server } = createGateway({
      token: "test-token",
      store,
      deepgramKey: "test-stt-key",
      boxCommand: ["node", "--import", "tsx", fakeBox],
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/v1/diagnostics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel: "railway", event: "error" }),
      });
      assert.equal(denied.status, 401);
      assert.ok(
        lines.some((line) => {
          try {
            const parsed = JSON.parse(line) as { event?: string; path?: string };
            return parsed.event === "unauthorized" && parsed.path === "/v1/diagnostics";
          } catch {
            return false;
          }
        }),
      );

      const accepted = await fetch(`http://127.0.0.1:${port}/v1/diagnostics`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "railway",
          event: "error",
          ts: "2026-09-04T14:00:00.000Z",
          details: {
            op: "AgentTtsProjectDelete",
            token: "must-not-log",
          },
        }),
      });
      assert.equal(accepted.status, 204);
      const clientLine = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((entry) => entry.src === "client");
      assert.deepEqual(clientLine, {
        src: "client",
        channel: "railway",
        event: "error",
        ts: "2026-09-04T14:00:00.000Z",
        details: { op: "AgentTtsProjectDelete" },
      });
    } finally {
      console.log = originalLog;
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await store.close();
    }
  });

  it("rejects query-string tokens on HTTP and the voice socket", async () => {
    const store = new MemoryConfigStore();
    const { server } = createGateway({
      token: "test-token",
      store,
      deepgramKey: "test-stt-key",
      boxCommand: ["node", "--import", "tsx", fakeBox],
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const httpQuery = await fetch(
        `http://127.0.0.1:${port}/v1/config?userId=default&token=test-token`,
      );
      assert.equal(httpQuery.status, 401);

      const headerWins = await fetch(
        `http://127.0.0.1:${port}/v1/config?userId=default&token=wrong`,
        { headers: { authorization: "Bearer test-token" } },
      );
      assert.equal(headerWins.status, 200);

      const closeCode = await new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/v1/voice?token=test-token&userId=default&mode=ptt`,
        );
        const timer = setTimeout(() => reject(new Error("close timeout")), 5000);
        ws.on("close", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
        ws.on("error", reject);
      });
      assert.equal(closeCode, 4401);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await store.close();
    }
  });

  it("does not expose adapter startup errors", async () => {
    const store = new MemoryConfigStore();
    const { server } = createGateway({
      token: "test-token",
      store,
      boxCommand: [],
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/v1/debug/prompt`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer test-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: "hello" }),
        },
      );
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "agent unavailable" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await store.close();
    }
  });

  it("keeps a turn alive across disconnect and replays missed text on reconnect", async () => {
    const store = new MemoryConfigStore();
    await store.save("default", {
      repo: { url: "", credential: "", repositories: [] },
      harness: "claude-code",
    });
    const { server, sessions } = createGateway({
      token: "test-token",
      store,
      deepgramKey: "test-stt-key",
      boxCommand: ["node", "--import", "tsx", fakeBox],
      generationId: "generation-a",
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const first = openAuthenticatedSocket(voiceSocketUrl(port));

    try {
      const firstReady = await waitForJson(first, (msg) => msg.type === "ready");
      assert.equal(firstReady.generationId, "generation-a");
      const session = sessions.get("default");
      assert.ok(session);

      const startedPromise = waitForJson(
        first,
        (msg) => msg.type === "prompt_start",
      );
      session.turn.enqueue("delay:75:survived reconnect");
      const started = await startedPromise;
      const cursor = Number(started.eventId);
      assert.ok(Number.isSafeInteger(cursor));

      first.close();
      await new Promise<void>((resolve) => first.once("close", () => resolve()));
      await waitFor(() => session.sink.lastEventId >= cursor + 3);
      assert.equal(sessions.get("default"), session);

      const second = openAuthenticatedSocket(
        voiceSocketUrl(port, {
          focused: false,
          afterEventId: cursor,
        }),
      );
      const replayed = await collectJsonUntil(
        second,
        (msg) => msg.type === "done",
      );
      const ready = replayed.find((msg) => msg.type === "ready");
      assert.equal(ready?.generationId, "generation-a");
      assert.equal(ready?.focused, false);
      assert.equal(sessions.get("default"), session);
      assert.deepEqual(
        replayed
          .filter((msg) => msg.type === "agent_text")
          .map((msg) => msg.text),
        ["echo:", "survived reconnect"],
      );
      assert.ok(
        replayed
          .filter((msg) => "eventId" in msg)
          .every((msg) => Number(msg.eventId) > cursor),
      );
      second.close();

      const killed = await fetch(
        `http://127.0.0.1:${port}/v1/session/kill?userId=default`,
        {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
        },
      );
      assert.deepEqual(await killed.json(), { ok: true, killed: 1 });
    } finally {
      first.close();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await store.close();
    }
  });

  it("forwards replacement GitHub auth from a reconnect during provisioning", async () => {
    const store = new MemoryConfigStore();
    const { server, sessions } = createGateway({
      token: "test-token",
      store,
      deepgramKey: "test-stt-key",
      boxCommand: ["node", "--import", "tsx", delayedReadyBox],
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const url = voiceSocketUrl(port);
    const first = openAuthenticatedSocket(url);

    try {
      await waitForJson(first, (msg) => msg.type === "provisioning");
      first.close();
      await new Promise<void>((resolve) => first.once("close", () => resolve()));

      const second = openAuthenticatedSocket(url, "replacement-token");
      const messages = await collectJsonUntil(
        second,
        (msg) => msg.type === "ready",
      );
      assert.ok(
        messages.some(
          (msg) =>
            msg.type === "git_auth" &&
            msg.state === "ready" &&
            msg.login === "replacement-user",
        ),
      );
      second.close();
    } finally {
      first.close();
      await sessions.get("default")?.turn.close();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await store.close();
    }
  });

  it("surfaces a clone failure and never unlocks voice", async () => {
    const store = new MemoryConfigStore();
    const { server, sessions } = createGateway({
      token: "test-token",
      store,
      deepgramKey: "test-stt-key",
      boxCommand: ["node", "--import", "tsx", failingProvisionBox],
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const ws = openAuthenticatedSocket(voiceSocketUrl(port));
    const messages: Record<string, unknown>[] = [];
    try {
      const closeCode = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("provision failure timeout")),
          5_000,
        );
        ws.on("message", (data) => {
          messages.push(JSON.parse(String(data)) as Record<string, unknown>);
        });
        ws.on("close", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
        ws.on("error", reject);
      });
      assert.equal(closeCode, 4503);
      assert.equal(sessions.has("default"), false);
      assert.equal(messages.some((message) => message.type === "ready"), false);
      assert.equal(
        messages.some(
          (message) =>
            message.type === "provisioning" &&
            message.repository === "acme/missing",
        ),
        true,
      );
      assert.equal(
        messages.some(
          (message) =>
            message.type === "error" && message.message === "clone denied",
        ),
        true,
      );
    } finally {
      ws.close();
      await fetch(
        `http://127.0.0.1:${port}/v1/session/kill?userId=default`,
        {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
        },
      );
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await store.close();
    }
  });

  it("resets by closing sessions and invoking onReset", async () => {
    const store = new MemoryConfigStore();
    let resetCalled = false;
    const { server, sessions } = createGateway({
      token: "test-token",
      store,
      deepgramKey: "test-stt-key",
      boxCommand: ["node", "--import", "tsx", fakeBox],
      onReset: () => {
        resetCalled = true;
      },
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const denied = await fetch(
        `http://127.0.0.1:${port}/v1/session/reset`,
        { method: "POST" },
      );
      assert.equal(denied.status, 401);
      assert.equal(resetCalled, false);

      const res = await fetch(`http://127.0.0.1:${port}/v1/session/reset`, {
        method: "POST",
        headers: { authorization: "Bearer test-token" },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, restarting: true });
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(resetCalled, true);
      assert.equal(sessions.size, 0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await store.close();
    }
  });

  it("serves an authorized model catalog and rejects unknown harnesses", async () => {
    const store = new MemoryConfigStore();
    await store.save("default", {
      repo: { url: "", credential: "", repositories: [] },
      harness: "codex",
    });
    const { server } = createGateway({
      token: "test-token",
      store,
      boxCommand: ["node", "--import", "tsx", fakeBox],
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const denied = await fetch(
        `http://127.0.0.1:${port}/v1/model-catalog?harness=claude-code`,
      );
      assert.equal(denied.status, 401);

      const unknown = await fetch(
        `http://127.0.0.1:${port}/v1/model-catalog?harness=nope`,
        { headers: { authorization: "Bearer test-token" } },
      );
      assert.equal(unknown.status, 400);
      assert.deepEqual(await unknown.json(), { error: "unknown harness" });

      const listed = await fetch(
        `http://127.0.0.1:${port}/v1/model-catalog?harness=claude-code`,
        { headers: { authorization: "Bearer test-token" } },
      );
      assert.equal(listed.status, 200);
      const claude = (await listed.json()) as {
        harness: string;
        models: {
          id: string;
          label: string;
          efforts: string[];
          default?: boolean;
        }[];
      };
      assert.equal(claude.harness, "claude-code");
      assert.equal(claude.models[0]?.id, "claude-sonnet-5");
      assert.equal(claude.models[0]?.label, "Sonnet 5");
      assert.equal(claude.models[0]?.default, true);
      assert.deepEqual(claude.models[0]?.efforts, [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);

      const fromConfig = await fetch(
        `http://127.0.0.1:${port}/v1/model-catalog`,
        { headers: { authorization: "Bearer test-token" } },
      );
      assert.equal(fromConfig.status, 200);
      const body = (await fromConfig.json()) as { harness: string };
      assert.equal(body.harness, "codex");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await store.close();
    }
  });
});

function voiceSocketUrl(
  port: number,
  extra: { focused?: boolean; afterEventId?: number } = {},
): string {
  const url = new URL(`ws://127.0.0.1:${port}/v1/voice`);
  url.searchParams.set("userId", "default");
  url.searchParams.set("mode", "ptt");
  if (extra.focused !== undefined) {
    url.searchParams.set("focused", String(extra.focused));
  }
  if (extra.afterEventId !== undefined) {
    url.searchParams.set("afterEventId", String(extra.afterEventId));
  }
  return url.toString();
}

function openAuthenticatedSocket(
  url: string,
  credential = "",
  token = "test-token",
): WebSocket {
  const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "git_auth", credential }));
  });
  return ws;
}

function waitForJson(
  ws: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message timeout")), 5000);
    ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as Record<string, unknown>;
      if (!predicate(message)) return;
      clearTimeout(timer);
      resolve(message);
    });
    ws.on("error", reject);
  });
}

function collectJsonUntil(
  ws: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = [];
    const timer = setTimeout(() => reject(new Error("message timeout")), 5000);
    ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as Record<string, unknown>;
      messages.push(message);
      if (!predicate(message)) return;
      clearTimeout(timer);
      resolve(messages);
    });
    ws.on("error", reject);
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
