export type { HarnessId } from "./box-protocol.js";

export interface AttachedRepository {
  id: number;
  fullName: string;
  cloneUrl: string;
  defaultBranch?: string;
  private?: boolean;
}

export interface UserConfig {
  userId: string;
  repo: {
    url: string;
    credential: string;
    defaultBranch?: string;
    repositories: AttachedRepository[];
  };
  harness: "claude-code" | "cursor-cli" | "gemini-cli" | "codex";
  model?: string;
  effort?: string;
  modelKeys: Record<string, string>;
  voice: {
    stopWord: string;
    ttsVoiceId?: string;
  };
}

export const HARNESS_ORDER = [
  "claude-code",
  "cursor-cli",
  "gemini-cli",
  "codex",
] as const;

export function defaultConfig(userId: string): UserConfig {
  return {
    userId,
    repo: { url: "github.com", credential: "", repositories: [] },
    harness: "claude-code",
    modelKeys: {},
    voice: { stopWord: "hard stop" },
  };
}

export function mergeConfig(base: UserConfig, patch: Partial<UserConfig>): UserConfig {
  return {
    ...base,
    ...patch,
    userId: base.userId,
    repo: {
      ...base.repo,
      ...(patch.repo ?? {}),
      repositories: patch.repo?.repositories ?? base.repo.repositories ?? [],
    },
    modelKeys: { ...base.modelKeys, ...(patch.modelKeys ?? {}) },
    voice: { ...base.voice, ...(patch.voice ?? {}) },
    harness: patch.harness ?? base.harness,
    model: mergeOptionalString(base.model, patch, "model"),
    effort: mergeOptionalString(base.effort, patch, "effort"),
  };
}

/** Explicit empty string clears back to undefined (harness default). Absent key keeps base. */
function mergeOptionalString(
  base: string | undefined,
  patch: Partial<UserConfig>,
  key: "model" | "effort",
): string | undefined {
  if (!(key in patch)) return base;
  const value = patch[key];
  if (value === "" || value === undefined) return undefined;
  return value;
}
