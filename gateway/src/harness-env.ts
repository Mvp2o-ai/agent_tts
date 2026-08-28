import type { UserConfig } from "./config-schema.js";

/** Host for git extraheader / gh. Empty or SSH remotes → github.com. */
export function gitHostFromRepoUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return "github.com";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.host || "github.com";
    }
  } catch {
    /* host or scp-style */
  }
  if (/^[A-Za-z0-9.-]+$/.test(raw)) return raw;
  return "github.com";
}

/** Env for the adapter child process. Credentials never touch disk. */
export function harnessEnv(
  config: UserConfig,
  workspace = "/workspace",
): Record<string, string> {
  const env: Record<string, string> = {
    AGENT_TTS_HARNESS: config.harness,
    AGENT_TTS_GIT_HOST: gitHostFromRepoUrl(config.repo.url),
    AGENT_TTS_REPOSITORIES: JSON.stringify(config.repo.repositories ?? []),
    AGENT_TTS_WORKSPACE: workspace,
  };
  for (const [k, v] of Object.entries(config.modelKeys)) {
    if (k && v) env[k] = v;
  }
  return env;
}
