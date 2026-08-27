import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteConfigStore } from "./config-store.js";

describe("SqliteConfigStore", () => {
  it("persists config across store instances", async () => {
    const path = join(tmpdir(), `agent-tts-test-${Date.now()}.db`);
    const a = new SqliteConfigStore(path);
    await a.save("u1", {
      harness: "codex",
      repo: { url: "https://example.com/r.git", credential: "pat" },
    });
    await a.close();

    const b = new SqliteConfigStore(path);
    const cfg = await b.get("u1");
    assert.equal(cfg.harness, "codex");
    assert.equal(cfg.repo.url, "https://example.com/r.git");
    await b.close();
  });

  it("returns defaults for unknown users", async () => {
    const store = new SqliteConfigStore(":memory:");
    const cfg = await store.get("nobody");
    assert.equal(cfg.harness, "claude-code");
    assert.equal(cfg.voice.stopWord, "hard stop");
    await store.close();
  });
});
