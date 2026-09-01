/**
 * Host-scoped git/gh auth for provisioning and the harness.
 *
 * Extraheader is env-only so a yolo agent cannot read the token from
 * `.git/config`. `GH_TOKEN` is set because `gh` (PR checkout/create/review)
 * cannot use git extraheader.
 */

/** Keep only the newest live credential while adapter initialization runs. */
export class DeferredGitCredential {
  private pending: string | undefined;

  replace(credential: string): void {
    this.pending = credential;
  }

  async drain(apply: (credential: string) => Promise<void>): Promise<void> {
    while (this.pending !== undefined) {
      const credential = this.pending;
      this.pending = undefined;
      await apply(credential);
    }
  }
}

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
  clearHarnessGitAuth(env);
  const auth = gitAuthEnv(urlOrHost, credential);
  Object.assign(env, auth);
  if (credential) {
    env.GH_TOKEN = credential;
    env.GITHUB_TOKEN = credential;
  }
  return auth;
}

/** Remove session git/gh auth so later harness spawns are logged out. */
export function clearHarnessGitAuth(
  env: NodeJS.ProcessEnv = process.env,
): void {
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_COUNT = "1";
  env.GIT_CONFIG_KEY_0 = "safe.directory";
  env.GIT_CONFIG_VALUE_0 = "*";
  delete env.GIT_CONFIG_KEY_1;
  delete env.GIT_CONFIG_VALUE_1;
}

/** Probe api.github.com so expired/revoked tokens fail closed before the harness. */
export async function probeGithubCredential(
  credential: string,
  request: typeof fetch = fetch,
): Promise<{ ok: true; login?: string } | { ok: false; message: string }> {
  if (!credential.trim()) {
    return { ok: false, message: "GitHub authorization is missing" };
  }
  try {
    const response = await request("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        authorization: `Bearer ${credential.trim()}`,
      },
    });
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        message: "GitHub authorization expired; connect GitHub again",
      };
    }
    if (!response.ok) {
      // Ambiguous upstream failure — keep the credential installed.
      return { ok: true };
    }
    const data = (await response.json()) as { login?: unknown };
    return {
      ok: true,
      ...(typeof data.login === "string" && data.login
        ? { login: data.login }
        : {}),
    };
  } catch {
    // Transient probe failure — install anyway; git/gh still fail closed later.
    return { ok: true };
  }
}

/** Never echo PATs from git's "URL https://x-access-token:…@" errors. */
export function redact(text: string): string {
  return text.replace(/\/\/[^@\s]+@/g, "//***@");
}
