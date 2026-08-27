import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import {
  credentialedUrl,
  ensureRepo,
  gitAuthEnv,
  installHarnessGitAuth,
  redact,
} from "./git.js";

const execFileP = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", ["-c", "init.defaultBranch=main", ...args], {
    cwd,
  });
  return stdout;
}

describe("credentialedUrl", () => {
  it("injects a PAT as x-access-token on https remotes", () => {
    const out = credentialedUrl("https://github.com/acme/repo.git", "ghp_secret");
    assert.equal(out, "https://x-access-token:ghp_secret@github.com/acme/repo.git");
  });

  it("leaves ssh remotes unchanged", () => {
    const ssh = "git@github.com:acme/repo.git";
    assert.equal(credentialedUrl(ssh, "ghp_secret"), ssh);
  });

  it("returns the url when credential is empty", () => {
    const url = "https://github.com/acme/repo.git";
    assert.equal(credentialedUrl(url, ""), url);
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

  it("skips extraheader for ssh remotes", () => {
    const env = gitAuthEnv("git@github.com:acme/repo.git", "ghp_secret");
    assert.equal(env.GIT_CONFIG_COUNT, "1");
    assert.equal(env.GIT_CONFIG_KEY_1, undefined);
  });
});

describe("installHarnessGitAuth", () => {
  it("copies extraheader onto the harness env without exposing the raw PAT", () => {
    const env: NodeJS.ProcessEnv = {};
    installHarnessGitAuth("https://github.com/acme/repo.git", "ghp_secret", env);
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.GIT_CONFIG_KEY_1, "http.https://github.com/.extraheader");
    assert.doesNotMatch(JSON.stringify(env), /ghp_secret/);
  });
});

describe("ensureRepo", () => {
  it("clones without writing the PAT or extraheader into .git/config", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentbox-git-"));
    const origin = join(root, "origin");
    const workspace = join(root, "workspace");
    await mkdir(origin, { recursive: true });
    await git(origin, ["init", "--bare"]);

    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await git(src, ["init"]);
    await git(src, ["config", "user.email", "agent@example.com"]);
    await git(src, ["config", "user.name", "agent"]);
    await writeFile(join(src, "README.md"), "hello\n");
    await git(src, ["add", "README.md"]);
    await git(src, ["commit", "-m", "init"]);
    await git(src, ["remote", "add", "origin", origin]);
    await git(src, ["push", "-u", "origin", "HEAD:main"]);

    const secret = "ghp_secret_must_not_land_in_config";
    await ensureRepo({
      workspace,
      url: origin,
      credential: secret,
      branch: "main",
    });

    const config = await readFile(join(workspace, ".git", "config"), "utf8");
    assert.doesNotMatch(config, new RegExp(secret));
    assert.doesNotMatch(config, /x-access-token/);
    assert.doesNotMatch(config, /extraheader/i);
    assert.match(config, /origin/);
    const remote = await git(workspace, ["remote", "get-url", "origin"]);
    assert.equal(remote.trim(), origin);

    await ensureRepo({
      workspace,
      url: origin,
      credential: secret,
      branch: "main",
    });
    const configAfterPull = await readFile(join(workspace, ".git", "config"), "utf8");
    assert.doesNotMatch(configAfterPull, new RegExp(secret));
    assert.doesNotMatch(configAfterPull, /extraheader/i);
  });

  it("propagates fetch failure on an existing checkout and never clones", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentbox-git-fetchfail-"));
    const origin = join(root, "origin");
    const workspace = join(root, "workspace");
    await mkdir(origin, { recursive: true });
    await git(origin, ["init", "--bare"]);

    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await git(src, ["init"]);
    await git(src, ["config", "user.email", "agent@example.com"]);
    await git(src, ["config", "user.name", "agent"]);
    await writeFile(join(src, "README.md"), "hello\n");
    await git(src, ["add", "README.md"]);
    await git(src, ["commit", "-m", "init"]);
    await git(src, ["remote", "add", "origin", origin]);
    await git(src, ["push", "-u", "origin", "HEAD:main"]);

    const secret = "ghp_secret_must_not_land_in_config";
    await ensureRepo({
      workspace,
      url: origin,
      credential: secret,
      branch: "main",
    });
    await writeFile(join(workspace, "KEEP.txt"), "do-not-clobber\n");

    // Leave opts.url valid so a mistaken clone would hit "not an empty directory"
    // instead of the real fetch error. Point the existing checkout at a dead remote.
    const dead = join(root, "missing.git");
    await git(workspace, ["remote", "set-url", "origin", dead]);

    await assert.rejects(
      () =>
        ensureRepo({
          workspace,
          url: origin,
          credential: secret,
          branch: "main",
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /fetch|remote|repository|Could not read|does not appear|unable to/i);
        assert.doesNotMatch(msg, /not an empty directory|already exists/i);
        assert.doesNotMatch(msg, /clone/i);
        assert.doesNotMatch(msg, new RegExp(secret));
        return true;
      },
    );

    const kept = await readFile(join(workspace, "KEEP.txt"), "utf8");
    assert.equal(kept, "do-not-clobber\n");
    const remote = await git(workspace, ["remote", "get-url", "origin"]);
    assert.equal(remote.trim(), dead);
    const config = await readFile(join(workspace, ".git", "config"), "utf8");
    assert.doesNotMatch(config, new RegExp(secret));
    assert.doesNotMatch(config, /extraheader/i);
  });
});
