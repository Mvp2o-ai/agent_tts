import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

/**
 * Inject a PAT into an HTTPS git remote. Prefer {@link gitAuthEnv} so the
 * token never lands in `.git/config` (a yolo agent can read that file).
 * Kept for tests and SSH-incompatible callers.
 */
export function credentialedUrl(url: string, credential: string): string {
  if (!credential) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return url;
  }
  parsed.username = "x-access-token";
  parsed.password = credential;
  return parsed.toString();
}

/**
 * GitHub Actions-style http extraheader + no TTY credential prompt.
 * Scoped to the remote host so a yolo shell cannot reuse it against
 * arbitrary URLs. SSH remotes get prompt-disable only.
 *
 * Install this onto the adapter process env ({@link installHarnessGitAuth})
 * so harness-spawned `git fetch/pull/push` inherit it. The extraheader is
 * env-only; it is never written to `.git/config`.
 *
 * Remaining push limitation: HTTPS push to that same host works only if the
 * PAT has write scope. SSH remotes get no extraheader (no ssh-agent in the
 * box). A harness that sanitizes env or retargets a different host cannot
 * authenticate.
 */
export function gitAuthEnv(
  url: string,
  credential: string,
): Record<string, string> {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "*",
  };
  if (!credential) return env;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return env;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return env;
  }
  const basic = Buffer.from(`x-access-token:${credential}`).toString("base64");
  env.GIT_CONFIG_COUNT = "2";
  env.GIT_CONFIG_KEY_1 = `http.https://${parsed.host}/.extraheader`;
  env.GIT_CONFIG_VALUE_1 = `AUTHORIZATION: basic ${basic}`;
  return env;
}

/** Copy host-scoped git auth onto an env object (default: process.env). */
export function installHarnessGitAuth(
  url: string,
  credential: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const auth = gitAuthEnv(url, credential);
  Object.assign(env, auth);
  return auth;
}

async function gitCheckoutExists(gitDir: string): Promise<boolean> {
  try {
    await access(gitDir);
    return true;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

export async function ensureRepo(opts: {
  workspace: string;
  url: string;
  credential: string;
  branch?: string;
}): Promise<Record<string, string>> {
  const env = gitAuthEnv(opts.url, opts.credential);
  const gitDir = path.join(opts.workspace, ".git");
  if (await gitCheckoutExists(gitDir)) {
    await runGit(opts.workspace, ["fetch", "origin"], env);
    if (opts.branch) {
      await runGit(opts.workspace, ["checkout", opts.branch], env);
      await runGit(opts.workspace, ["pull", "--ff-only", "origin", opts.branch], env);
    } else {
      await runGit(opts.workspace, ["pull", "--ff-only"], env);
    }
    return env;
  }

  const args = ["clone", "--depth", "1"];
  if (opts.branch) args.push("--branch", opts.branch);
  args.push(opts.url, opts.workspace);
  await runGit(process.cwd(), args, env);
  return env;
}

function runGit(
  cwd: string,
  args: string[],
  env: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(redact(stderr) || `git ${args[0]} exited ${code}`));
    });
  });
}

/** Never echo PATs from git's "URL https://x-access-token:…@" errors. */
export function redact(text: string): string {
  return text.replace(/\/\/[^@\s]+@/g, "//***@");
}
