/**
 * Host-scoped git/gh auth for provisioning and the harness.
 *
 * Extraheader is env-only so a yolo agent cannot read the token from
 * `.git/config`. `GH_TOKEN` is set because `gh` (PR checkout/create/review)
 * cannot use git extraheader.
 */

export function gitAuthHost(remoteOrHost?: string): string {
  const raw = (remoteOrHost ?? "").trim();
  if (!raw) return "github.com";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.host || "github.com";
    }
  } catch {
    /* scp-style or bare host */
  }
  if (/^[A-Za-z0-9.-]+$/.test(raw)) return raw;
  return "github.com";
}

/**
 * GitHub Actions-style http extraheader + no TTY credential prompt.
 * Scoped to the remote host so a yolo shell cannot reuse it against
 * arbitrary URLs.
 *
 * Remaining push limitation: HTTPS push to that host works only if the
 * token has write permission. SSH remotes have no extraheader of their own
 * (no ssh-agent in the box); agents should clone HTTPS on this host.
 */
export function gitAuthEnv(
  urlOrHost: string,
  credential: string,
): Record<string, string> {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "*",
  };
  if (!credential) return env;
  const host = gitAuthHost(urlOrHost);
  const basic = Buffer.from(`x-access-token:${credential}`).toString("base64");
  env.GIT_CONFIG_COUNT = "2";
  env.GIT_CONFIG_KEY_1 = `http.https://${host}/.extraheader`;
  env.GIT_CONFIG_VALUE_1 = `AUTHORIZATION: basic ${basic}`;
  return env;
}

/** Copy host-scoped git auth onto an env object (default: process.env). */
export function installHarnessGitAuth(
  urlOrHost: string,
  credential: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const auth = gitAuthEnv(urlOrHost, credential);
  Object.assign(env, auth);
  if (credential) {
    env.GH_TOKEN = credential;
    env.GITHUB_TOKEN = credential;
  }
  return auth;
}

/** Never echo PATs from git's "URL https://x-access-token:…@" errors. */
export function redact(text: string): string {
  return text.replace(/\/\/[^@\s]+@/g, "//***@");
}
