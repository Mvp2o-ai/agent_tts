export type { HarnessId } from "./box-protocol.js";

export interface UserConfig {
  userId: string;
  repo: {
    url: string;
    credential: string;
    defaultBranch?: string;
  };
  harness: "claude-code" | "cursor-cli" | "gemini-cli" | "codex";
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
    repo: { url: "", credential: "" },
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
    repo: { ...base.repo, ...(patch.repo ?? {}) },
    modelKeys: { ...base.modelKeys, ...(patch.modelKeys ?? {}) },
    voice: { ...base.voice, ...(patch.voice ?? {}) },
    harness: patch.harness ?? base.harness,
  };
}
