import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawnCommandBox } from "./box-client.js";

const fakeBox = fileURLToPath(new URL("./testing/fake-box.ts", import.meta.url));

describe("box protocol via fake adapter", () => {
  it("round-trips a prompt to done", async () => {
    const box = spawnCommandBox(
      ["node", "--import", "tsx", fakeBox],
      { AGENT_TTS_REPO_URL: "https://example.com/repo.git" },
    );
    const events: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 5000);
      box.onMessage((msg) => {
        events.push(msg.type);
        if (msg.type === "done") {
          clearTimeout(t);
          resolve();
        }
        if (msg.type === "error") {
          clearTimeout(t);
          reject(new Error(msg.message));
        }
      });
      box.send({ type: "prompt", id: "p1", text: "hello" });
    });
    await box.close();
    assert.deepEqual(events, ["chunk", "chunk", "done"]);
  });
});
