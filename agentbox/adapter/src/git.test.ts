import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearHarnessGitAuth,
  DeferredGitCredential,
  gitAuthEnv,
  gitAuthHost,
  installHarnessGitAuth,
  probeGithubCredential,
  redact,
} from "./git.js";

describe("DeferredGitCredential", () => {
  it("keeps only the newest credential before initialization drains", async () => {
    const deferred = new DeferredGitCredential();
    const applied: string[] = [];
    deferred.replace("old-token");
    deferred.replace("new-token");

    await deferred.drain(async (credential) => {
      applied.push(credential);
    });

    assert.deepEqual(applied, ["new-token"]);
  });

  it("does not lose a replacement received while a probe is in flight", async () => {
    const deferred = new DeferredGitCredential();
    const applied: string[] = [];
    deferred.replace("first-token");

    await deferred.drain(async (credential) => {
      applied.push(credential);
      if (credential === "first-token") {
        deferred.replace("");
      }
    });

    assert.deepEqual(applied, ["first-token", ""]);
  });
});

describe("gitAuthHost", () => {
  it("defaults to github.com so the agent can clone any repo on that host", () => {
    assert.equal(gitAuthHost(""), "github.com");
    assert.equal(gitAuthHost(undefined), "github.com");
  });

  it("reads the host from an https remote without requiring a single repo", () => {
    assert.equal(
      gitAuthHost("https://github.com/acme/one.git"),
      "github.com",
    );
    assert.equal(
      gitAuthHost("https://github.example.com/acme/one.git"),
      "github.example.com",
    );
  });

  it("accepts a bare host and maps scp remotes back to github.com", () => {
    assert.equal(gitAuthHost("github.com"), "github.com");
    assert.equal(gitAuthHost("git@github.com:acme/one.git"), "github.com");
  });
});

describe("redact", () => {
  it("strips userinfo from git https errors", () => {
    assert.equal(
      redact("fatal: https://x-access-token:ghp_secret@github.com/acme/repo.git"),
      "fatal: https://***@github.com/acme/repo.git",
    );
  });
});

describe("gitAuthEnv", () => {
  it("never puts the PAT in a clone URL; uses a host-scoped extraheader", () => {
    const env = gitAuthEnv("https://github.com/acme/repo.git", "ghp_secret");
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.GIT_CONFIG_KEY_0, "safe.directory");
    assert.equal(env.GIT_CONFIG_KEY_1, "http.https://github.com/.extraheader");
    assert.match(env.GIT_CONFIG_VALUE_1 ?? "", /^AUTHORIZATION: basic /);
    assert.doesNotMatch(env.GIT_CONFIG_VALUE_1 ?? "", /ghp_secret/);
    const decoded = Buffer.from(
      (env.GIT_CONFIG_VALUE_1 ?? "").split(" ")[2] ?? "",
      "base64",
    ).toString();
    assert.equal(decoded, "x-access-token:ghp_secret");
  });

  it("still authorizes github.com when no remote is configured", () => {
    const env = gitAuthEnv("", "ghp_secret");
    assert.equal(env.GIT_CONFIG_KEY_1, "http.https://github.com/.extraheader");
  });
});

describe("installHarnessGitAuth", () => {
  it("copies extraheader onto the harness env and sets GH_TOKEN for gh", () => {
    const env: NodeJS.ProcessEnv = {};
    installHarnessGitAuth("https://github.com/acme/repo.git", "ghp_secret", env);
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.GIT_CONFIG_KEY_1, "http.https://github.com/.extraheader");
    assert.doesNotMatch(env.GIT_CONFIG_VALUE_1 ?? "", /ghp_secret/);
    assert.equal(env.GH_TOKEN, "ghp_secret");
    assert.equal(env.GITHUB_TOKEN, "ghp_secret");
  });

  it("does not invent a token when the PAT is empty", () => {
    const env: NodeJS.ProcessEnv = {};
    installHarnessGitAuth("", "", env);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.GIT_CONFIG_KEY_1, undefined);
  });

  it("replaces a previous credential instead of stacking auth env", () => {
    const env: NodeJS.ProcessEnv = {};
    installHarnessGitAuth("github.com", "old-token", env);
    installHarnessGitAuth("github.com", "new-token", env);
    assert.equal(env.GH_TOKEN, "new-token");
    const decoded = Buffer.from(
      (env.GIT_CONFIG_VALUE_1 ?? "").split(" ")[2] ?? "",
      "base64",
    ).toString();
    assert.equal(decoded, "x-access-token:new-token");
  });
});

describe("clearHarnessGitAuth", () => {
  it("removes gh tokens and host extraheader", () => {
    const env: NodeJS.ProcessEnv = {};
    installHarnessGitAuth("github.com", "ghp_secret", env);
    clearHarnessGitAuth(env);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.GIT_CONFIG_KEY_1, undefined);
    assert.equal(env.GIT_CONFIG_VALUE_1, undefined);
    assert.equal(env.GIT_CONFIG_COUNT, "1");
  });
});

describe("probeGithubCredential", () => {
  it("rejects unauthorized tokens", async () => {
    const result = await probeGithubCredential("dead", async () =>
      new Response("{}", { status: 401 }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /expired|connect GitHub again/i);
    }
  });

  it("accepts a valid identity probe", async () => {
    const result = await probeGithubCredential("good", async () =>
      Response.json({ login: "wiltshirek" }),
    );
    assert.deepEqual(result, { ok: true, login: "wiltshirek" });
  });

  it("keeps the credential on transient probe failures", async () => {
    const result = await probeGithubCredential("maybe", async () => {
      throw new Error("network down");
    });
    assert.deepEqual(result, { ok: true });
  });
});
