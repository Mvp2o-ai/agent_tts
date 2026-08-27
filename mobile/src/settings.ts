export type HarnessId = "claude-code" | "cursor-cli" | "gemini-cli" | "codex";

export const HARNESSES: { id: HarnessId; label: string; keyEnv: string }[] = [
  { id: "claude-code", label: "Claude Code", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "cursor-cli", label: "Cursor CLI", keyEnv: "CURSOR_API_KEY" },
  { id: "gemini-cli", label: "Gemini CLI", keyEnv: "GEMINI_API_KEY" },
  { id: "codex", label: "Codex CLI", keyEnv: "OPENAI_API_KEY" },
];

export const HARNESS_IDS: readonly HarnessId[] = HARNESSES.map((h) => h.id);

export interface DeviceSettings {
  gatewayUrl: string;
  token: string;
  userId: string;
  repoUrl: string;
  gitPat: string;
  defaultBranch: string;
  harness: HarnessId;
  modelKeys: Record<string, string>;
  stopWord: string;
  voiceId: string;
}

export const SETTINGS_STORAGE_KEY = "agent_tts.deviceSettings.v1";

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  gatewayUrl: "http://",
  token: "",
  userId: "default",
  repoUrl: "",
  gitPat: "",
  defaultBranch: "",
  harness: "claude-code",
  modelKeys: {},
  stopWord: "hard stop",
  voiceId: "",
};

export function isHarnessId(value: string): value is HarnessId {
  return (HARNESS_IDS as readonly string[]).includes(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asModelKeys(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function parseDeviceSettings(raw: string): DeviceSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ...DEFAULT_DEVICE_SETTINGS };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_DEVICE_SETTINGS };
  }
  const o = parsed as Record<string, unknown>;
  const harness = asString(o.harness, DEFAULT_DEVICE_SETTINGS.harness);
  return {
    gatewayUrl: asString(o.gatewayUrl, DEFAULT_DEVICE_SETTINGS.gatewayUrl),
    token: asString(o.token, ""),
    userId: asString(o.userId, DEFAULT_DEVICE_SETTINGS.userId) || "default",
    repoUrl: asString(o.repoUrl, ""),
    gitPat: asString(o.gitPat, ""),
    defaultBranch: asString(o.defaultBranch, ""),
    harness: isHarnessId(harness) ? harness : DEFAULT_DEVICE_SETTINGS.harness,
    modelKeys: asModelKeys(o.modelKeys),
    stopWord: asString(o.stopWord, DEFAULT_DEVICE_SETTINGS.stopWord),
    voiceId: asString(o.voiceId, ""),
  };
}

export function serializeDeviceSettings(settings: DeviceSettings): string {
  return JSON.stringify({
    gatewayUrl: settings.gatewayUrl,
    token: settings.token,
    userId: settings.userId,
    repoUrl: settings.repoUrl,
    gitPat: settings.gitPat,
    defaultBranch: settings.defaultBranch,
    harness: settings.harness,
    modelKeys: settings.modelKeys,
    stopWord: settings.stopWord,
    voiceId: settings.voiceId,
  });
}

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function createSettingsStore(kv: KeyValueStore) {
  return {
    async load(): Promise<DeviceSettings | null> {
      const raw = await kv.getItem(SETTINGS_STORAGE_KEY);
      if (raw == null || raw === "") return null;
      return parseDeviceSettings(raw);
    },
    async save(settings: DeviceSettings): Promise<void> {
      await kv.setItem(SETTINGS_STORAGE_KEY, serializeDeviceSettings(settings));
    },
  };
}

export function memoryKeyValueStore(
  seed?: Record<string, string>,
): KeyValueStore & { data: Record<string, string> } {
  const data: Record<string, string> = { ...(seed ?? {}) };
  return {
    data,
    async getItem(key) {
      return key in data ? data[key]! : null;
    },
    async setItem(key, value) {
      data[key] = value;
    },
  };
}
