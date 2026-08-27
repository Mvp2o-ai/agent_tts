import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CodexStreamMapper,
  codexArgv,
  codexHarnessEnv,
  createCodexHarness,
} from "./codex.js";

function collect() {
  const chunks: string[] = [];
  const tools: string[] = [];
  return {
    chunks,
    tools,
    events: {
      onChunk: (t: string) => chunks.push(t),
      onToolEvent: (s: string) => tools.push(s),
    },
  };
}

describe("codexArgv", () => {
  it("uses exec OPTIONS then prompt", () => {
    assert.deepEqual(codexArgv("/workspace", "hi"), [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--dangerously-bypass-hook-trust",
      "-c",
      `projects."/workspace".trust_level="trusted"`,
      "hi",
    ]);
  });

  it("uses exec resume OPTIONS SESSION PROMPT", () => {
    assert.deepEqual(codexArgv("/workspace", "hi", "thr_1"), [
      "exec",
      "resume",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--dangerously-bypass-hook-trust",
      "-c",
      `projects."/workspace".trust_level="trusted"`,
      "thr_1",
      "hi",
    ]);
  });
});

describe("codexHarnessEnv", () => {
  it("maps OPENAI_API_KEY onto CODEX_API_KEY when unset", () => {
    const prevCodex = process.env.CODEX_API_KEY;
    const prevOpen = process.env.OPENAI_API_KEY;
    delete process.env.CODEX_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    try {
      const env = codexHarnessEnv();
      assert.equal(env.CODEX_API_KEY, "sk-test-not-a-real-key");
    } finally {
      if (prevCodex === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = prevCodex;
      if (prevOpen === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevOpen;
    }
  });
});

describe("createCodexHarness", () => {
  it("writes file-store yolo config and auth.json under CODEX_HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "agentbox-codex-"));
    const prevHome = process.env.CODEX_HOME;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevCodex = process.env.CODEX_API_KEY;
    process.env.CODEX_HOME = home;
    delete process.env.CODEX_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    try {
      createCodexHarness("/workspace");
      const config = await readFile(join(home, "config.toml"), "utf8");
      assert.match(config, /approval_policy = "never"/);
      assert.match(config, /sandbox_mode = "danger-full-access"/);
      assert.match(config, /cli_auth_credentials_store = "file"/);
      assert.match(config, /trust_level = "trusted"/);
      const auth = await readFile(join(home, "auth.json"), "utf8");
      assert.match(auth, /OPENAI_API_KEY/);
      assert.doesNotMatch(config, /sk-test-not-a-real-key/);
    } finally {
      if (prevHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prevHome;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevCodex === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = prevCodex;
    }
  });
});

describe("CodexStreamMapper", () => {
  it("captures thread id and agent_message text", () => {
    const mapper = new CodexStreamMapper();
    const c = collect();
    mapper.feed({ type: "thread.started", thread_id: "thr_1" }, c.events);
    assert.equal(mapper.sessionId, "thr_1");
    mapper.feed(
      {
        type: "item.completed",
        item: { type: "agent_message", text: "Repo looks fine." },
      },
      c.events,
    );
    assert.deepEqual(c.chunks, ["Repo looks fine."]);
    assert.equal(mapper.feed({ type: "turn.completed" }, c.events), "done");
  });

  it("emits command_execution tool events", () => {
    const mapper = new CodexStreamMapper();
    const c = collect();
    mapper.feed(
      {
        type: "item.started",
        item: { type: "command_execution", command: "ls" },
      },
      c.events,
    );
    assert.match(c.tools[0]!, /command_execution/);
  });

  it("ignores transient reconnect errors", () => {
    const mapper = new CodexStreamMapper();
    const c = collect();
    assert.equal(
      mapper.feed({ type: "error", message: "Reconnecting... 1/5" }, c.events),
      "continue",
    );
  });
});
