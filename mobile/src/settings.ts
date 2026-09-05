import {
  DEFAULT_STT_PROVIDER_ID,
  DEFAULT_TTS_PROVIDER_ID,
  hydrateVoiceProviderId,
} from "./voice-providers";

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

export interface AgentRuntimeSettings {
  harness?: HarnessId;
  model?: string;
  effort?: string;
  repoUrl?: string;
  defaultBranch?: string;
  stopWord?: string;
  voiceId?: string;
}

export type AgentOriginKind = "manual" | "provider";

/**
 * Provider-neutral lifecycle metadata. Values in this envelope must never
 * contain provider credentials or gateway secrets.
 */
export interface AgentOriginMetadata {
  kind?: AgentOriginKind;
  providerId?: string;
  provisioningId?: string;
  provisioningPhase?: string;
  resourceIds?: Record<string, string>;
  provisioningDetails?: Record<string, string>;
  endpointHostname?: string;
  lastError?: string;
}

export type AgentProviderState = AgentOriginMetadata;

export interface AgentProfile {
  id: string;
  name: string;
  gatewayUrl: string;
  token: string;
  /**
   * Desired host lifecycle. Optional only so existing in-memory callers can
   * continue constructing profiles; hydration always supplies the default.
   */
  desiredState?: AgentDesiredState;
  gitCredentialId?: string;
  /** Distinguishes an explicit disconnect from a legacy missing assignment. */
  gitCredentialState?: "connected" | "disconnected";
  gatewayCredentialId?: string;
  providerCredentialId?: string;
  hostCredentialIds?: Record<string, string>;
  repositories?: AttachedRepository[];
  modelCredentialIds?: Record<string, string>;
  runtime?: AgentRuntimeSettings;
  origin?: AgentOriginMetadata;
}

export type AgentDesiredState = "running" | "stopped";

export const DEFAULT_AGENT_DESIRED_STATE: AgentDesiredState = "running";

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
  sttProviderId: string;
  ttsProviderId: string;
}

export const SETTINGS_STORAGE_KEY = "agent_tts.deviceSettings.v1";

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  agents: [
    {
      id: "agent-1",
      name: "Agent 1",
      gatewayUrl: "http://",
      token: "",
      desiredState: DEFAULT_AGENT_DESIRED_STATE,
    },
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
  sttProviderId: DEFAULT_STT_PROVIDER_ID,
  ttsProviderId: DEFAULT_TTS_PROVIDER_ID,
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

function parseRuntime(value: unknown): AgentRuntimeSettings | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const o = value as Record<string, unknown>;
  const runtime: AgentRuntimeSettings = {};
  if (typeof o.harness === "string" && isHarnessId(o.harness)) {
    runtime.harness = o.harness;
  }
  for (const key of [
    "model",
    "effort",
    "repoUrl",
    "defaultBranch",
    "stopWord",
    "voiceId",
  ] as const) {
    if (typeof o[key] === "string") runtime[key] = o[key];
  }
  return Object.keys(runtime).length > 0 ? runtime : undefined;
}

function parseOrigin(value: unknown): AgentOriginMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const o = value as Record<string, unknown>;
  const origin: AgentOriginMetadata = {};
  if (o.kind === "manual" || o.kind === "provider") origin.kind = o.kind;
  for (const key of [
    "providerId",
    "provisioningId",
    "provisioningPhase",
    "endpointHostname",
    "lastError",
  ] as const) {
    if (typeof o[key] === "string") origin[key] = o[key];
  }
  if (o.resourceIds && typeof o.resourceIds === "object" && !Array.isArray(o.resourceIds)) {
    const resourceIds = asModelKeys(o.resourceIds);
    if (Object.keys(resourceIds).length > 0) origin.resourceIds = resourceIds;
  }
  if (
    o.provisioningDetails &&
    typeof o.provisioningDetails === "object" &&
    !Array.isArray(o.provisioningDetails)
  ) {
    const provisioningDetails = asModelKeys(o.provisioningDetails);
    if (Object.keys(provisioningDetails).length > 0) {
      origin.provisioningDetails = provisioningDetails;
    }
  }
  return Object.keys(origin).length > 0 ? origin : undefined;
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
  const runtime = parseRuntime(o.runtime);
  const origin = parseOrigin(o.origin);
  return {
    id: o.id,
    name: o.name,
    gatewayUrl: o.gatewayUrl,
    token: o.token,
    desiredState:
      o.desiredState === "stopped" || o.desiredState === "running"
        ? o.desiredState
        : DEFAULT_AGENT_DESIRED_STATE,
    ...(typeof o.gitCredentialId === "string"
      ? { gitCredentialId: o.gitCredentialId }
      : {}),
    ...(o.gitCredentialState === "connected" ||
    o.gitCredentialState === "disconnected"
      ? { gitCredentialState: o.gitCredentialState }
      : {}),
    ...(typeof o.gatewayCredentialId === "string"
      ? { gatewayCredentialId: o.gatewayCredentialId }
      : {}),
    ...(typeof o.providerCredentialId === "string"
      ? { providerCredentialId: o.providerCredentialId }
      : {}),
    ...(o.hostCredentialIds && typeof o.hostCredentialIds === "object"
      ? { hostCredentialIds: asModelKeys(o.hostCredentialIds) }
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
    ...(runtime ? { runtime } : {}),
    ...(origin ? { origin } : {}),
  };
}

function parseRepository(value: unknown): AttachedRepository | null {
  if (!value || typeof value !== "object") return null;
  const repo = value as Record<string, unknown>;
  const id = Number(repo.id);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof repo.fullName !== "string" ||
    typeof repo.cloneUrl !== "string"
  ) {
    return null;
  }
  return {
    id,
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
        name: "Agent 1",
        gatewayUrl: o.gatewayUrl,
        token: o.token,
        desiredState: DEFAULT_AGENT_DESIRED_STATE,
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

export interface EffectiveAgentRuntimeSettings {
  harness: HarnessId;
  model: string;
  effort: string;
  repoUrl: string;
  defaultBranch: string;
  stopWord: string;
  voiceId: string;
}

function isDeviceSettings(
  value: DeviceSettings | AgentProfile,
): value is DeviceSettings {
  return "agents" in value;
}

/**
 * Resolve profile overrides while retaining v1 top-level settings as
 * migration fallbacks. Both argument orders are accepted for callers that
 * naturally start from either the profile or the settings object.
 */
export function resolveAgentRuntimeSettings(
  profile: AgentProfile,
  settings: DeviceSettings,
): EffectiveAgentRuntimeSettings;
export function resolveAgentRuntimeSettings(
  settings: DeviceSettings,
  profile?: AgentProfile,
): EffectiveAgentRuntimeSettings;
export function resolveAgentRuntimeSettings(
  first: DeviceSettings | AgentProfile,
  second?: DeviceSettings | AgentProfile,
): EffectiveAgentRuntimeSettings {
  const settings = isDeviceSettings(first)
    ? first
    : (second as DeviceSettings);
  const profile = isDeviceSettings(first)
    ? (second as AgentProfile | undefined) ?? activeAgent(settings)
    : first;
  const runtime = profile.runtime;
  const harness =
    runtime?.harness && isHarnessId(runtime.harness)
      ? runtime.harness
      : settings.harness;
  return {
    harness,
    model: runtime?.model ?? settings.model,
    effort: runtime?.effort ?? settings.effort,
    repoUrl: runtime?.repoUrl ?? settings.repoUrl,
    defaultBranch: runtime?.defaultBranch ?? settings.defaultBranch,
    stopWord: runtime?.stopWord ?? settings.stopWord,
    voiceId: runtime?.voiceId ?? settings.voiceId,
  };
}

export function updateAgentHarness(
  settings: DeviceSettings,
  agentId: string,
  harness: HarnessId,
): DeviceSettings {
  const current = settings.agents.find((agent) => agent.id === agentId);
  if (!current) return settings;
  if (resolveAgentRuntimeSettings(current, settings).harness === harness) {
    return settings;
  }
  return {
    ...settings,
    agents: settings.agents.map((agent) =>
      agent.id === agentId
        ? {
            ...agent,
            runtime: {
              ...(agent.runtime ?? {}),
              harness,
              model: "",
              effort: "",
            },
          }
        : agent,
    ),
  };
}

export const withAgentHarness = updateAgentHarness;

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
    sttProviderId: hydrateVoiceProviderId(
      "stt",
      typeof o.sttProviderId === "string" ? o.sttProviderId : undefined,
    ),
    ttsProviderId: hydrateVoiceProviderId(
      "tts",
      typeof o.ttsProviderId === "string" ? o.ttsProviderId : undefined,
    ),
  };
}

export function serializeDeviceSettings(settings: DeviceSettings): string {
  return JSON.stringify({
    agents: settings.agents.map((agent) => ({
      ...agent,
      desiredState:
        agent.desiredState === "stopped" ? "stopped" : DEFAULT_AGENT_DESIRED_STATE,
      token: agent.gatewayCredentialId ? "" : agent.token,
    })),
    activeAgentId: settings.activeAgentId,
    userId: settings.userId,
    repoUrl: settings.repoUrl,
    defaultBranch: settings.defaultBranch,
    harness: settings.harness,
    model: settings.model,
    effort: settings.effort,
    stopWord: settings.stopWord,
    voiceId: settings.voiceId,
    sttProviderId: settings.sttProviderId,
    ttsProviderId: settings.ttsProviderId,
  });
}

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function readStoredDeviceSettings(raw: string): DeviceSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("device settings are not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("device settings are not an object");
  }
  return parseDeviceSettings(raw);
}

export function createSettingsStore(kv: KeyValueStore) {
  return {
    async load(): Promise<DeviceSettings | null> {
      const raw = await kv.getItem(SETTINGS_STORAGE_KEY);
      if (raw == null || raw === "") return null;
      return readStoredDeviceSettings(raw);
    },
    async save(settings: DeviceSettings): Promise<void> {
      await kv.setItem(SETTINGS_STORAGE_KEY, serializeDeviceSettings(settings));
    },
  };
}

/** A failed read must not authorize writing in-memory defaults back to disk. */
export async function readDeviceSettingsForHydration(
  store: ReturnType<typeof createSettingsStore>,
): Promise<{ loaded: DeviceSettings | null; persist: boolean }> {
  try {
    return { loaded: await store.load(), persist: true };
  } catch {
    return { loaded: null, persist: false };
  }
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
