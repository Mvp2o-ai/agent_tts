import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dockerRunArgs, harnessEnv } from "./docker-box.js";
import { defaultConfig } from "./config-schema.js";

describe("dockerRunArgs", () => {
  it("runs an interactive ephemeral container with an env file", () => {
    assert.deepEqual(
      dockerRunArgs({
        image: "agent_tts-agentbox:local",
        name: "agent-tts-abc",
        envFile: "/tmp/env",
      }),
      [
        "run",
        "--rm",
        "-i",
        "--name",
        "agent-tts-abc",
        "--env-file",
        "/tmp/env",
        "agent_tts-agentbox:local",
      ],
    );
  });
});

describe("harnessEnv", () => {
  it("passes harness, repo, and model keys", () => {
    const cfg = defaultConfig("u1");
    cfg.harness = "cursor-cli";
    cfg.repo.url = "https://github.com/acme/repo.git";
    cfg.repo.credential = "pat";
    cfg.modelKeys = { CURSOR_API_KEY: "ck" };
    const env = harnessEnv(cfg);
    assert.equal(env.AGENT_TTS_HARNESS, "cursor-cli");
    assert.equal(env.AGENT_TTS_GIT_CREDENTIAL, "pat");
    assert.equal(env.CURSOR_API_KEY, "ck");
  });
});
