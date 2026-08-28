export type HarnessId = "claude-code" | "cursor-cli" | "gemini-cli" | "codex";

export const HARNESSES: { id: HarnessId; label: string; keyEnv: string }[] = [
  { id: "claude-code", label: "Claude Code", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "cursor-cli", label: "Cursor CLI", keyEnv: "CURSOR_API_KEY" },
  { id: "gemini-cli", label: "Gemini CLI", keyEnv: "GEMINI_API_KEY" },
  { id: "codex", label: "Codex CLI", keyEnv: "OPENAI_API_KEY" },
];

export const HARNESS_IDS: readonly HarnessId[] = HARNESSES.map((h) => h.id);

export interface AttachedRepository {
  id: number;
  fullName: string;
  cloneUrl: string;
  defaultBranch?: string;
  private?: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  gatewayUrl: string;
  token: string;
  gitCredentialId?: string;
  repositories?: AttachedRepository[];
  modelCredentialIds?: Record<string, string>;
}

export interface DeviceSettings {
  agents: AgentProfile[];
  activeAgentId: string;
  userId: string;
  repoUrl: string;
  gitPat: string;
  defaultBranch: string;
  harness: HarnessId;
  model: string;
  effort: string;
  modelKeys: Record<string, string>;
  stopWord: string;
  voiceId: string;
}

export const SETTINGS_STORAGE_KEY = "agent_tts.deviceSettings.v1";

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  agents: [
    { id: "agent-1", name: "Project 1", gatewayUrl: "http://", token: "" },
  ],
  activeAgentId: "agent-1",
  userId: "default",
  repoUrl: "",
  gitPat: "",
  defaultBranch: "",
  harness: "claude-code",
  model: "",
  effort: "",
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

function cloneDefaultAgents(): AgentProfile[] {
  return DEFAULT_DEVICE_SETTINGS.agents.map((a) => ({ ...a }));
}

function parseAgentProfile(value: unknown): AgentProfile | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.name !== "string" ||
    typeof o.gatewayUrl !== "string" ||
    typeof o.token !== "string"
  ) {
    return null;
  }
  return {
    id: o.id,
    name: o.name,
    gatewayUrl: o.gatewayUrl,
    token: o.token,
    ...(typeof o.gitCredentialId === "string"
      ? { gitCredentialId: o.gitCredentialId }
      : {}),
    ...(Array.isArray(o.repositories)
      ? {
          repositories: o.repositories
            .map(parseRepository)
            .filter((repo): repo is AttachedRepository => repo !== null),
        }
      : {}),
    ...(o.modelCredentialIds && typeof o.modelCredentialIds === "object"
      ? { modelCredentialIds: asModelKeys(o.modelCredentialIds) }
      : {}),
  };
}

function parseRepository(value: unknown): AttachedRepository | null {
  if (!value || typeof value !== "object") return null;
  const repo = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(repo.id) ||
    Number(repo.id) <= 0 ||
    typeof repo.fullName !== "string" ||
    typeof repo.cloneUrl !== "string"
  ) {
    return null;
  }
  return {
    id: Number(repo.id),
    fullName: repo.fullName,
    cloneUrl: repo.cloneUrl,
    ...(typeof repo.defaultBranch === "string"
      ? { defaultBranch: repo.defaultBranch }
      : {}),
    ...(typeof repo.private === "boolean" ? { private: repo.private } : {}),
  };
}

function resolveAgents(o: Record<string, unknown>): AgentProfile[] {
  if (Array.isArray(o.agents)) {
    const agents = o.agents
      .map(parseAgentProfile)
      .filter((a): a is AgentProfile => a !== null);
    return agents.length > 0 ? agents : cloneDefaultAgents();
  }
  if (typeof o.gatewayUrl === "string" && typeof o.token === "string") {
    return [
      {
        id: "agent-1",
        name: "Project 1",
        gatewayUrl: o.gatewayUrl,
        token: o.token,
      },
    ];
  }
  return cloneDefaultAgents();
}

function resolveActiveAgentId(
  agents: AgentProfile[],
  value: unknown,
): string {
  if (typeof value === "string" && agents.some((a) => a.id === value)) {
    return value;
  }
  return agents[0]!.id;
}

export function activeAgent(s: DeviceSettings): AgentProfile {
  return s.agents.find((a) => a.id === s.activeAgentId) ?? s.agents[0]!;
}

/** Switching harness invalidates model/effort IDs from the previous catalog. */
export function withHarness(
  settings: DeviceSettings,
  harness: HarnessId,
): DeviceSettings {
  if (settings.harness === harness) return settings;
  return { ...settings, harness, model: "", effort: "" };
}

export function parseDeviceSettings(raw: string): DeviceSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ...DEFAULT_DEVICE_SETTINGS, agents: cloneDefaultAgents() };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_DEVICE_SETTINGS, agents: cloneDefaultAgents() };
  }
  const o = parsed as Record<string, unknown>;
  const harness = asString(o.harness, DEFAULT_DEVICE_SETTINGS.harness);
  const agents = resolveAgents(o);
  return {
    agents,
    activeAgentId: resolveActiveAgentId(agents, o.activeAgentId),
    userId: asString(o.userId, DEFAULT_DEVICE_SETTINGS.userId) || "default",
    repoUrl: asString(o.repoUrl, ""),
    gitPat: asString(o.gitPat, ""),
    defaultBranch: asString(o.defaultBranch, ""),
    harness: isHarnessId(harness) ? harness : DEFAULT_DEVICE_SETTINGS.harness,
    model: asString(o.model, ""),
    effort: asString(o.effort, ""),
    modelKeys: asModelKeys(o.modelKeys),
    stopWord: asString(o.stopWord, DEFAULT_DEVICE_SETTINGS.stopWord),
    voiceId: asString(o.voiceId, ""),
  };
}

export function serializeDeviceSettings(settings: DeviceSettings): string {
  return JSON.stringify({
    agents: settings.agents,
    activeAgentId: settings.activeAgentId,
    userId: settings.userId,
    repoUrl: settings.repoUrl,
    defaultBranch: settings.defaultBranch,
    harness: settings.harness,
    model: settings.model,
    effort: settings.effort,
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
