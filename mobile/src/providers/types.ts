import type { ReactNode } from "react";
import type { CredentialEntry } from "../credential-vault";
import type {
  AgentProfile,
  AttachedRepository,
  DeviceSettings,
} from "../settings";

export const AGENT_HOST_CONTRACT = {
  configMountPath: "/data",
  workspacePersistence: "ephemeral",
  healthPath: "/health",
  replicas: 1,
  restartOnCleanExit: true,
  sleepWhenIdle: false,
  portSource: "provider",
} as const;

export interface AgentDeploymentSpec {
  agentName: string;
  runtimeImage: string;
  gatewayToken: string;
  voice: AgentVoiceConfig;
  host: typeof AGENT_HOST_CONTRACT;
}

export interface AgentVoiceConfig {
  sttProviderId: string;
  ttsProviderId: string;
  /** env name -> secret value. Never log. */
  secrets: Record<string, string>;
}

export interface ProviderDefinition {
  id: string;
  label: string;
  badge?: string;
  description: string;
  actionLabel: string;
}

export interface ProviderSetupContext {
  credentials: CredentialEntry[];
  setSettings: (
    next: DeviceSettings | ((previous: DeviceSettings) => DeviceSettings),
  ) => void;
  onCredentialsChanged: () => void;
  sttProviderId: string;
  ttsProviderId: string;
  /**
   * Voice providers and credentials are app-level Settings. Host setup
   * screens send the user there instead of collecting keys inline.
   */
  openAppSettings: () => void;
  /**
   * Provider setup may offer an optional startup repository set without owning
   * OAuth or credential storage. The selected credential and repository list
   * are copied into the new agent profile by the provider launcher.
   */
  repositorySetup: {
    credentials: CredentialEntry[];
    repositories: AttachedRepository[];
    repositoryCredentialId?: string;
    busy: boolean;
    search: string;
    onSearchChange: (value: string) => void;
    onSelectCredential: (
      entry: CredentialEntry,
    ) => Promise<AttachedRepository[]>;
    onRefresh: () => Promise<AttachedRepository[]>;
  };
  onReady: (providerId: string, agentId: string) => void;
}

export interface ProviderPlugin {
  definition: ProviderDefinition;
  prepareSetup(): void;
  renderSetup(onBack: () => void): ReactNode;
  hostLabel(profile: AgentProfile): string;
  startAgent(profile: AgentProfile): Promise<void>;
  stopAgent(profile: AgentProfile): Promise<void>;
  replaceAgent?(profile: AgentProfile): Promise<{ gatewayUrl: string }>;
  deleteAgent(profile: AgentProfile): Promise<void>;
  deleteConfirmation(profile: AgentProfile): {
    title: string;
    message: string;
    actionLabel: string;
  };
}

export interface ProviderRegistry {
  readonly providers: readonly ProviderPlugin[];
  get(providerId: string): ProviderPlugin | undefined;
  forProfile(profile: AgentProfile): ProviderPlugin | undefined;
}

export function createProviderRegistry(
  providers: readonly ProviderPlugin[],
): ProviderRegistry {
  const byId = new Map<string, ProviderPlugin>();
  for (const provider of providers) {
    const id = provider.definition.id.trim();
    if (!id) throw new Error("Provider ID is required");
    if (byId.has(id)) throw new Error(`Duplicate provider ID: ${id}`);
    byId.set(id, provider);
  }
  const installed = Object.freeze([...providers]);
  return {
    providers: installed,
    get: (providerId) => byId.get(providerId),
    forProfile: (profile) => {
      if (profile.origin?.kind !== "provider") return undefined;
      return profile.origin.providerId
        ? byId.get(profile.origin.providerId)
        : undefined;
    },
  };
}

export function createAgentDeploymentSpec(input: {
  agentName: string;
  runtimeImage: string;
  gatewayToken: string;
  voice: AgentVoiceConfig;
}): AgentDeploymentSpec {
  if (
    !input.voice ||
    typeof input.voice !== "object" ||
    !input.voice.secrets ||
    typeof input.voice.secrets !== "object" ||
    Array.isArray(input.voice.secrets)
  ) {
    throw new Error("Voice secrets are missing");
  }
  const secrets: Record<string, string> = {};
  for (const [env, value] of Object.entries(input.voice.secrets)) {
    secrets[env] = required(value, `Voice secret ${env}`);
  }
  return {
    agentName: required(input.agentName, "Agent name"),
    runtimeImage: required(input.runtimeImage, "Runtime image"),
    gatewayToken: required(input.gatewayToken, "Gateway token"),
    voice: {
      sttProviderId: required(input.voice.sttProviderId, "STT provider"),
      ttsProviderId: required(input.voice.ttsProviderId, "TTS provider"),
      secrets,
    },
    host: AGENT_HOST_CONTRACT,
  };
}

function required(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is missing`);
  return normalized;
}
