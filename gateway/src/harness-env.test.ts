import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gitHostFromRepoUrl, harnessEnv } from "./harness-env.js";
import { defaultConfig } from "./config-schema.js";

describe("harnessEnv", () => {
  it("passes harness, git host, and model keys without a clone URL", () => {
    const cfg = defaultConfig("u1");
    cfg.harness = "cursor-cli";
    cfg.repo.url = "https://github.com/acme/repo.git";
    cfg.repo.credential = "pat";
    cfg.repo.repositories = [
      {
        id: 1,
        fullName: "acme/repo",
        cloneUrl: "https://github.com/acme/repo.git",
      },
    ];
    cfg.modelKeys = { CURSOR_API_KEY: "ck" };
    const env = harnessEnv(cfg);
    assert.equal(env.AGENT_TTS_HARNESS, "cursor-cli");
    assert.equal(env.AGENT_TTS_GIT_CREDENTIAL, undefined);
    assert.equal(env.AGENT_TTS_GIT_HOST, "github.com");
    assert.equal(env.AGENT_TTS_REPO_URL, undefined);
    assert.deepEqual(JSON.parse(env.AGENT_TTS_REPOSITORIES ?? "[]"), [
      {
        id: 1,
        fullName: "acme/repo",
        cloneUrl: "https://github.com/acme/repo.git",
      },
    ]);
    assert.equal(env.CURSOR_API_KEY, "ck");
  });

  it("honors a custom workspace directory", () => {
    const env = harnessEnv(defaultConfig("u1"), "/tmp/ws");
    assert.equal(env.AGENT_TTS_WORKSPACE, "/tmp/ws");
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
