import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteConfigStore } from "./config-store.js";

describe("SqliteConfigStore", () => {
  it("persists config across store instances", async () => {
    const path = join(tmpdir(), `agent-tts-test-${Date.now()}.db`);
    const a = new SqliteConfigStore(path);
    await a.save("u1", {
      harness: "codex",
      repo: {
        url: "https://example.com/r.git",
        credential: "pat",
        repositories: [],
      },
    });
    await a.close();
    const rawDb = new DatabaseSync(path);
    const row = rawDb
      .prepare("SELECT config FROM user_config WHERE user_id = ?")
      .get("u1") as { config: string };
    assert.equal(row.config.includes("pat"), false);
    const legacy = JSON.parse(row.config) as {
      repo: { credential: string };
    };
    legacy.repo.credential = "legacy-pat";
    rawDb
      .prepare("UPDATE user_config SET config = ? WHERE user_id = ?")
      .run(JSON.stringify(legacy), "u1");
    rawDb.close();

    const b = new SqliteConfigStore(path);
    const cfg = await b.get("u1");
    assert.equal(cfg.harness, "codex");
    assert.equal(cfg.repo.url, "https://example.com/r.git");
    assert.equal(cfg.repo.credential, "");
    await b.close();

    const scrubbedDb = new DatabaseSync(path, { readOnly: true });
    const scrubbed = scrubbedDb
      .prepare("SELECT config FROM user_config WHERE user_id = ?")
      .get("u1") as { config: string };
    assert.equal(scrubbed.config.includes("legacy-pat"), false);
    scrubbedDb.close();
  });

  it("returns defaults for unknown users", async () => {
    const store = new SqliteConfigStore(":memory:");
    const cfg = await store.get("nobody");
    assert.equal(cfg.harness, "claude-code");
    assert.equal(cfg.voice.stopWord, "hard stop");
    assert.equal(cfg.model, undefined);
    assert.equal(cfg.effort, undefined);
    await store.close();
  });

  it("persists model and effort and clears them on empty-string patch", async () => {
    const store = new SqliteConfigStore(":memory:");
    await store.save("u1", { model: "claude-sonnet-5", effort: "high" });
    const saved = await store.get("u1");
    assert.equal(saved.model, "claude-sonnet-5");
    assert.equal(saved.effort, "high");

    const cleared = await store.save("u1", { model: "", effort: "" });
    assert.equal(cleared.model, undefined);
    assert.equal(cleared.effort, undefined);
    const reloaded = await store.get("u1");
    assert.equal(reloaded.model, undefined);
    assert.equal(reloaded.effort, undefined);
    await store.close();
  });
});
