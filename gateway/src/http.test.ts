import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { createGateway } from "./http.js";
import { MemoryConfigStore } from "./config-store.js";
import { VOICE_AUDIO_FORMAT } from "./elevenlabs.js";
import type { AddressInfo } from "node:net";

const fakeBox = fileURLToPath(new URL("./testing/fake-box.ts", import.meta.url));

describe("gateway http", () => {
  it("serves health and round-trips a debug prompt through the fake box", async () => {
    const store = new MemoryConfigStore();
    await store.save("default", {
      repo: { url: "https://example.com/repo.git", credential: "" },
      harness: "claude-code",
    });
    const { server } = createGateway({
      token: "test-token",
      store,
      deepgramKey: "test-stt-key",
      dockerBin: "docker",
      agentboxImage: "unused",
      boxCommand: ["node", "--import", "tsx", fakeBox],
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(health.status, 200);

      const denied = await fetch(`http://127.0.0.1:${port}/v1/config?userId=default`);
      assert.equal(denied.status, 401);

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

      const ready = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/v1/voice?token=test-token&userId=default&mode=ptt`,
        );
        const timer = setTimeout(() => reject(new Error("ready timeout")), 5000);
        ws.on("message", (data) => {
          const msg = JSON.parse(String(data)) as Record<string, unknown>;
          if (msg.type === "ready") {
            clearTimeout(timer);
            ws.close();
            resolve(msg);
          }
        });
        ws.on("error", reject);
      });
      assert.equal(ready.mode, "ptt");
      assert.equal(ready.harness, "claude-code");
      assert.deepEqual(ready.audioFormat, VOICE_AUDIO_FORMAT);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await store.close();
    }
  });
});
