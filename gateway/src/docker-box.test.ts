import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dockerKillFilter,
  dockerPsArgs,
  dockerRmArgs,
  dockerRunArgs,
  gitHostFromRepoUrl,
  harnessEnv,
} from "./docker-box.js";
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

describe("killSessionBoxes argv", () => {
  it("scopes docker ps/rm to this user's agent-tts prefix", () => {
    assert.equal(dockerKillFilter("default"), "agent-tts-default-");
    assert.equal(dockerKillFilter("Ken Wiltshire"), "agent-tts-Ken-Wiltshire-");
    assert.deepEqual(dockerPsArgs("default"), [
      "ps",
      "-aq",
      "--filter",
      "name=agent-tts-default-",
    ]);
    assert.deepEqual(dockerRmArgs(["abc", "def"]), ["rm", "-f", "abc", "def"]);
  });
});

describe("harnessEnv", () => {
  it("passes harness, git host, and model keys without a clone URL", () => {
    const cfg = defaultConfig("u1");
    cfg.harness = "cursor-cli";
    cfg.repo.url = "https://github.com/acme/repo.git";
    cfg.repo.credential = "pat";
    cfg.modelKeys = { CURSOR_API_KEY: "ck" };
    const env = harnessEnv(cfg);
    assert.equal(env.AGENT_TTS_HARNESS, "cursor-cli");
    assert.equal(env.AGENT_TTS_GIT_CREDENTIAL, "pat");
    assert.equal(env.AGENT_TTS_GIT_HOST, "github.com");
    assert.equal(env.AGENT_TTS_REPO_URL, undefined);
    assert.equal(env.CURSOR_API_KEY, "ck");
  });

  it("defaults git host to github.com when no remote is saved", () => {
    assert.equal(gitHostFromRepoUrl(""), "github.com");
    assert.equal(gitHostFromRepoUrl("git@github.com:acme/one.git"), "github.com");
    assert.equal(
      gitHostFromRepoUrl("https://github.example.com/acme/one.git"),
      "github.example.com",
    );
  });
});
