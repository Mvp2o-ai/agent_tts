import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  fetchModelCatalog,
  resetSession,
  saveConfig,
  type ModelCatalog,
  type UserConfig,
} from "./src/api";
import {
  agentConfigurationIssue,
  deriveAgentLifecycle,
  providerAllowsSessionConnection,
} from "./src/agent-lifecycle";
import {
  bindAgentGithubIdentity,
  connectAgentGithub,
  disconnectAgentGithub,
  toggleAgentRepository,
} from "./src/agent-github";
import type { CredentialEntry } from "./src/credential-vault";
import {
  fetchGithubIdentity,
  GITHUB_CLIENT_ID,
  listGithubRepositories,
  pollGithubDeviceToken,
  requestGithubDeviceCode,
  serializeGithubCredential,
  type GithubDeviceAuthorization,
} from "./src/github";
import { connectionError, normalizeGatewayUrl } from "./src/protocol";
import { shouldStopHostBeforeNewSession } from "./src/session-refresh";
import { parseAgentPairingUrl } from "./src/pairing";
import { useProviderRegistry } from "./src/providers/registry";
import { railwayProvisioningStore } from "./src/providers/railway/provisioning-store";
import {
  credentialVault,
  githubAccessToken,
} from "./src/secure-credential-vault";
import {
  activeAgent,
  DEFAULT_DEVICE_SETTINGS,
  HARNESSES,
  resolveAgentRuntimeSettings,
  updateAgentHarness,
  type AgentProfile,
  type AgentRuntimeSettings,
  type AttachedRepository,
  type DeviceSettings,
} from "./src/settings";
import { useDeviceSettings } from "./src/useDeviceSettings";
import { useVoiceSession, type VoiceMode } from "./src/useVoiceSession";
import { hydrateVoiceProviderId } from "./src/voice-providers";
import {
  AddAgentScreen,
  ManualAgentScreen,
} from "./src/ui/AgentSetup";
import { AgentDetailScreen } from "./src/ui/AgentDetail";
import {
  AgentGithubSummary,
  GithubRepositoryManagerScreen,
} from "./src/ui/AgentGithub";
import { AppSettingsScreen } from "./src/ui/AppSettings";
import { AgentTray, type AgentTrayItem } from "./src/ui/AgentTray";
import { GithubDeviceAuthModal } from "./src/ui/GithubDeviceAuthModal";
import { PairingScannerScreen } from "./src/ui/PairingScanner";
import {
  Button,
  Card,
  Field,
  SectionLabel,
  Segmented,
  Toast,
} from "./src/ui/components";
import {
  CheckIcon,
  BrandIcon,
  GearIcon,
  LinkIcon,
  MicIcon,
  StopIcon,
  WaveIcon,
} from "./src/ui/icons";
import { TalkButton } from "./src/ui/TalkButton";
import { Transcript } from "./src/ui/Transcript";
import { color, font, inset, radius, space } from "./src/ui/theme";
import { resolveTalkState } from "./src/talk-state";

type AgentSetupScreen =
  | "choose"
  | "manual"
  | "scan"
  | `provider:${string}`;
type ManagedSession = ReturnType<typeof useVoiceSession>;

const EMPTY_SESSION: ManagedSession = {
  status: "disconnected",
  availability: "unknown",
  events: [],
  speaking: false,
  ttsOpen: false,
  working: false,
  busyKind: "thinking",
  harness: "",
  generationId: "",
  provisioning: null,
  lastError: "",
  gitAuthState: "unknown",
  gitAuthMessage: "",
  connect: () => undefined,
  disconnect: () => undefined,
  sendGitAuth: () => undefined,
  markGitAuthRequired: () => undefined,
  pttStart: () => undefined,
  pttEnd: () => undefined,
  abort: () => undefined,
};

function logGithubConnect(
  event: string,
  details?: Record<string, string | number | boolean | undefined>,
): void {
  const extras = details
    ? Object.entries(details)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
    : "";
  console.log(
    extras ? `[github-connect] ${event} ${extras}` : `[github-connect] ${event}`,
  );
}

async function syncRailwayRepositoryTemplate(
  profile: AgentProfile,
): Promise<void> {
  if (
    profile.origin?.kind !== "provider" ||
    profile.origin.providerId !== "railway"
  ) {
    return;
  }
  await railwayProvisioningStore.updateGithub(
    profile.id,
    profile.gitCredentialId,
    profile.repositories ?? [],
  );
}

export default function App() {
  const [mode, setMode] = useState<VoiceMode>("ptt");
  const [pttHeld, setPttHeld] = useState(false);
  const { settings, setSettings, getSettings, hydrated } =
    useDeviceSettings();
  const [configMsg, setConfigMsg] = useState("");
  const [configOk, setConfigOk] = useState(false);
  const [sessions, setSessions] = useState<Record<string, ManagedSession>>({});
  const sessionCommandsRef = useRef<Record<string, ManagedSession>>({});
  const [credentials, setCredentials] = useState<CredentialEntry[]>([]);
  const [githubRepositories, setGithubRepositories] = useState<
    AttachedRepository[]
  >([]);
  const [githubRepositoryCredentialId, setGithubRepositoryCredentialId] =
    useState<string | undefined>();
  const [githubSearch, setGithubSearch] = useState("");
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubDeviceAuth, setGithubDeviceAuth] =
    useState<GithubDeviceAuthorization | null>(null);
  const [githubConnectError, setGithubConnectError] = useState("");
  const githubDeviceAuthAbortRef = useRef<AbortController | null>(null);
  const githubConnectGenerationRef = useRef(0);
  const githubRepositoryRequestRef = useRef(0);
  const [gitAuthEpoch, setGitAuthEpoch] = useState(0);
  const [legacySecretsMigrated, setLegacySecretsMigrated] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog | null>(null);
  const [agentSetupScreen, setAgentSetupScreen] =
    useState<AgentSetupScreen | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [githubManagerAgentId, setGithubManagerAgentId] = useState<
    string | null
  >(null);
  const [lifecycleBusyAgentId, setLifecycleBusyAgentId] = useState<string | null>(
    null,
  );
  const [removingAgentId, setRemovingAgentId] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualGatewayUrl, setManualGatewayUrl] = useState("");
  const [manualGatewayToken, setManualGatewayToken] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);
  const migrationStartedRef = useRef(false);

  const agent = activeAgent(settings);
  const runtime = resolveAgentRuntimeSettings(agent, settings);
  const sttProviderId = hydrateVoiceProviderId("stt", settings.sttProviderId);
  const ttsProviderId = hydrateVoiceProviderId("tts", settings.ttsProviderId);
  const conn = useMemo(
    () => ({
      gatewayUrl: normalizeGatewayUrl(agent.gatewayUrl),
      token: agent.token,
      userId: settings.userId,
    }),
    [agent.gatewayUrl, agent.token, settings.userId],
  );

  const reportSession = useCallback(
    (id: string, session: ManagedSession) => {
      sessionCommandsRef.current[id] = session;
      setSessions((current) =>
        current[id] === session ? current : { ...current, [id]: session },
      );
      return () => {
        if (sessionCommandsRef.current[id] === session) {
          delete sessionCommandsRef.current[id];
        }
      };
    },
    [],
  );
  const session = sessions[agent.id] ?? EMPTY_SESSION;
  const activeAgentConfigured = isAgentEndpointConfigured(agent);

  const selectedHarness =
    HARNESSES.find((h) => h.id === runtime.harness) ?? HARNESSES[0]!;
  const githubCredentials = credentials.filter(
    (entry) => entry.kind === "github-token" || entry.kind === "git-pat",
  );
  const githubManagerAgent = settings.agents.find(
    (profile) => profile.id === githubManagerAgentId,
  );
  const githubManagerCredential = githubCredentials.find(
    (entry) => entry.id === githubManagerAgent?.gitCredentialId,
  );
  const gatewayCredentialSignature = settings.agents
    .map((profile) => `${profile.id}:${profile.gatewayCredentialId ?? ""}`)
    .join("|");
  const disconnectedGithubCheckpointSignature = settings.agents
    .filter(
      (profile) =>
        profile.gitCredentialState === "disconnected" &&
        profile.origin?.kind === "provider",
    )
    .map((profile) => profile.id)
    .join("|");

  useEffect(() => {
    for (const profile of settings.agents) {
      if (
        profile.gitCredentialState !== "disconnected" ||
        profile.origin?.kind !== "provider"
      ) {
        continue;
      }
      void syncRailwayRepositoryTemplate(profile).catch(() => undefined);
    }
  }, [disconnectedGithubCheckpointSignature]);

  const patch = (partial: Partial<DeviceSettings>) =>
    setSettings((prev) => ({ ...prev, ...partial }));

  const patchActiveAgent = (partial: Partial<AgentProfile>) =>
    setSettings((prev) => {
      const current = activeAgent(prev);
      return {
        ...prev,
        agents: prev.agents.map((a) =>
          a.id === current.id ? { ...a, ...partial } : a,
        ),
      };
    });

  const patchAgent = (id: string, partial: Partial<AgentProfile>) =>
    setSettings((prev) => ({
      ...prev,
      agents: prev.agents.map((profile) =>
        profile.id === id ? { ...profile, ...partial } : profile,
      ),
    }));

  const patchActiveAgentRuntime = (partial: Partial<AgentRuntimeSettings>) =>
    setSettings((prev) => withActiveAgentRuntime(prev, partial));

  const selectAgent = (id: string) => {
    setPttHeld(false);
    githubRepositoryRequestRef.current += 1;
    setSettings((prev) => ({
      ...prev,
      activeAgentId: id,
      gitPat: "",
      modelKeys: {},
    }));
    setGithubRepositories([]);
    setGithubRepositoryCredentialId(undefined);
    setGithubSearch("");
    setGithubManagerAgentId(null);
  };

  const addAgent = () => {
    setManualName("");
    setAgentSetupScreen("choose");
  };

  const editAgent = (id: string) => {
    selectAgent(id);
    setEditingAgentId(id);
  };

  const openGithubManager = (id: string) => {
    const profile = settings.agents.find((candidate) => candidate.id === id);
    if (!profile) return;
    selectAgent(id);
    setEditingAgentId(null);
    setGithubManagerAgentId(id);
    if (profile.gitCredentialId) {
      void loadGithubRepositoriesForCredential(profile.gitCredentialId).catch(
        () => undefined,
      );
    }
  };

  const openAgentMenu = (id: string) => {
    const profile = settings.agents.find((candidate) => candidate.id === id);
    if (!profile) return;
    const settingsAction = {
      text: "Agent settings",
      onPress: () => editAgent(id),
    };
    if (!isAgentEndpointConfigured(profile)) {
      Alert.alert(profile.name, "This agent needs setup.", [
        settingsAction,
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    Alert.alert(profile.name, undefined, [
      settingsAction,
      {
        text: profile.gitCredentialId
          ? "Startup repositories"
          : "Connect GitHub",
        onPress: () => openGithubManager(id),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const saveManualAgent = async () => {
    setManualBusy(true);
    try {
      const gatewayUrl = normalizeGatewayUrl(manualGatewayUrl);
      const token = manualGatewayToken.trim();
      const issue = connectionError({
        gatewayUrl,
        token,
        userId: settings.userId,
      });
      if (issue) throw new Error(issue);
      const gatewayCredential = await credentialVault.save({
        kind: "gateway-token",
        label: `${manualName.trim()} gateway`,
        secret: token,
      });
      const profile: AgentProfile = {
        id: Crypto.randomUUID(),
        name: manualName.trim(),
        gatewayUrl,
        token,
        gatewayCredentialId: gatewayCredential.id,
        origin: { kind: "manual" },
      };
      setSettings((previous) => {
        const agents = isBlankDefaultProfile(previous.agents)
          ? [profile]
          : [...previous.agents, profile];
        return { ...previous, agents, activeAgentId: profile.id };
      });
      refreshCredentials();
      setManualGatewayToken("");
      setAgentSetupScreen(null);
      setEditingAgentId(profile.id);
      setConfigOk(true);
      setConfigMsg("Agent added. Configure its repositories and runtime.");
    } catch (cause) {
      setConfigOk(false);
      setConfigMsg(
        cause instanceof Error ? cause.message : "Could not add this agent.",
      );
    } finally {
      setManualBusy(false);
    }
  };

  const removeAgentFromPhone = (id: string) => {
    setSettings((prev) => {
      const agents = prev.agents.filter((a) => a.id !== id);
      if (agents.length === 0) {
        const fallback = {
          ...DEFAULT_DEVICE_SETTINGS.agents[0]!,
          id: Crypto.randomUUID(),
        };
        return { ...prev, agents: [fallback], activeAgentId: fallback.id };
      }
      const activeAgentId =
        prev.activeAgentId === id ||
        !agents.some((a) => a.id === prev.activeAgentId)
          ? agents[0]!.id
          : prev.activeAgentId;
      return { ...prev, agents, activeAgentId };
    });
    setEditingAgentId(null);
  };

  const refreshCredentials = useCallback(() => {
    return credentialVault.list().then(setCredentials);
  }, []);

  const onProviderReady = useCallback((_providerId: string, agentId: string) => {
    setSettings((previous) => ({ ...previous, activeAgentId: agentId }));
    setAgentSetupScreen(null);
    setEditingAgentId(agentId);
    setConfigOk(true);
    setConfigMsg(
      "Hosted agent is online. Confirm startup repositories, then its runtime.",
    );
  }, [setSettings]);

  const providerRegistry = useProviderRegistry({
    credentials,
    setSettings,
    onReady: onProviderReady,
    onCredentialsChanged: refreshCredentials,
    sttProviderId,
    ttsProviderId,
    openAppSettings: () => setShowAppSettings(true),
    repositorySetup: {
      credentials: credentials.filter(
        (entry) =>
          entry.kind === "github-token" || entry.kind === "git-pat",
      ),
      repositories: githubRepositories,
      repositoryCredentialId: githubRepositoryCredentialId,
      busy: githubBusy,
      search: githubSearch,
      connectError: githubConnectError,
      onSearchChange: setGithubSearch,
      onRefresh: async () => {
        if (!githubRepositoryCredentialId) return [];
        return loadGithubRepositoriesForCredential(githubRepositoryCredentialId);
      },
      onConnectGithub: () => connectGithub(),
    },
  });

  const removeAgent = async (profile: AgentProfile) => {
    setRemovingAgentId(profile.id);
    try {
      const provider = providerRegistry.forProfile(profile);
      if (profile.origin?.kind === "provider" && !provider) {
        throw new Error(
          `Provider ${profile.origin.providerId ?? "unknown"} is not installed.`,
        );
      }
      if (provider) {
        await provider.deleteAgent(profile);
      }
      removeAgentFromPhone(profile.id);
      setConfigOk(true);
      setConfigMsg(
        provider
          ? `Agent and its ${provider.definition.label} resources were deleted.`
          : "Saved agent connection was removed from this phone.",
      );
    } catch (cause) {
      setConfigOk(false);
      setConfigMsg(
        cause instanceof Error ? cause.message : "Could not delete this agent.",
      );
    } finally {
      setRemovingAgentId(null);
    }
  };

  const openPairingUrl = useCallback((url: string | null) => {
    if (!url) return;
    const payload = parseAgentPairingUrl(url);
    if (!payload) return;
    setManualName(payload.name ?? "Paired agent");
    setManualGatewayUrl(payload.gatewayUrl);
    setManualGatewayToken(payload.gatewayToken);
    setAgentSetupScreen("manual");
  }, []);

  const handleScannedPairing = useCallback((value: string) => {
    const payload = parseAgentPairingUrl(value);
    if (!payload) {
      setConfigOk(false);
      setConfigMsg("That QR code is not an agent_tts setup code.");
      setAgentSetupScreen("manual");
      return;
    }
    setManualName(payload.name ?? "Paired agent");
    setManualGatewayUrl(payload.gatewayUrl);
    setManualGatewayToken(payload.gatewayToken);
    setAgentSetupScreen("manual");
  }, []);

  useEffect(() => {
    refreshCredentials();
  }, [refreshCredentials]);

  useEffect(() => {
    void Linking.getInitialURL().then(openPairingUrl);
    const subscription = Linking.addEventListener("url", (event) => {
      openPairingUrl(event.url);
    });
    return () => subscription.remove();
  }, [openPairingUrl]);

  useEffect(() => {
    if (!hydrated || migrationStartedRef.current) return;
    migrationStartedRef.current = true;
    void (async () => {
      const current = activeAgent(settings);
      const profilePatch: Partial<AgentProfile> = {};
      const gatewayCredentialIds = new Map<string, string>();
      const imported: CredentialEntry[] = [];

      for (const profile of settings.agents) {
        if (!profile.token.trim() || profile.gatewayCredentialId) continue;
        const entry = await credentialVault.save({
          kind: "gateway-token",
          label: `${profile.name.trim() || "Agent"} gateway`,
          secret: profile.token,
        });
        gatewayCredentialIds.set(profile.id, entry.id);
        imported.push(entry);
      }

      if (settings.gitPat && !current.gitCredentialId) {
        const entry = await credentialVault.save({
          kind: "git-pat",
          label: "Imported Git PAT",
          secret: settings.gitPat,
        });
        profilePatch.gitCredentialId = entry.id;
        imported.push(entry);
      }

      const modelCredentialIds = { ...(current.modelCredentialIds ?? {}) };
      for (const [keyEnv, secret] of Object.entries(settings.modelKeys)) {
        if (!secret || modelCredentialIds[keyEnv]) continue;
        const entry = await credentialVault.save({
          kind: "model-key",
          keyEnv,
          label: `Imported ${keyEnv}`,
          secret,
        });
        modelCredentialIds[keyEnv] = entry.id;
        imported.push(entry);
      }
      if (Object.keys(modelCredentialIds).length > 0) {
        profilePatch.modelCredentialIds = modelCredentialIds;
      }

      if (
        Object.keys(profilePatch).length > 0 ||
        gatewayCredentialIds.size > 0
      ) {
        setSettings((prev) => ({
          ...prev,
          gitPat: "",
          agents: prev.agents.map((profile) => ({
            ...profile,
            ...(profile.id === current.id ? profilePatch : {}),
            ...(gatewayCredentialIds.has(profile.id)
              ? { gatewayCredentialId: gatewayCredentialIds.get(profile.id) }
              : {}),
          })),
        }));
      }
      if (imported.length > 0) refreshCredentials();
      setLegacySecretsMigrated(true);
    })();
  }, [hydrated, refreshCredentials, setSettings, settings]);

  useEffect(() => {
    if (!legacySecretsMigrated) return;
    let current = true;
    void (async () => {
      const profile = activeAgent(settings);
      const gatewayTokens = new Map<string, string>();
      await Promise.all(
        settings.agents.map(async (candidate) => {
          if (!candidate.gatewayCredentialId) return;
          const secret = await credentialVault.getSecret(
            candidate.gatewayCredentialId,
          );
          if (secret) gatewayTokens.set(candidate.id, secret);
        }),
      );
      const modelKeys: Record<string, string> = {};
      for (const [keyEnv, id] of Object.entries(
        profile.modelCredentialIds ?? {},
      )) {
        const secret = await credentialVault.getSecret(id);
        if (secret) modelKeys[keyEnv] = secret;
      }
      if (!current) return;
      setSettings((prev) => ({
        ...prev,
        ...(prev.activeAgentId === profile.id ? { modelKeys } : {}),
        agents: prev.agents.map((candidate) => {
          const token = gatewayTokens.get(candidate.id);
          return token && token !== candidate.token
            ? { ...candidate, token }
            : candidate;
        }),
      }));
    })();
    return () => {
      current = false;
    };
  }, [
    agent.gitCredentialId,
    agent.id,
    agent.modelCredentialIds,
    gatewayCredentialSignature,
    legacySecretsMigrated,
    setSettings,
  ]);

  async function loadGithubRepositoriesForCredential(
    credentialId: string,
  ): Promise<AttachedRepository[]> {
    const request = ++githubRepositoryRequestRef.current;
    setGithubBusy(true);
    try {
      const token = await githubAccessToken(credentialId);
      const repositories = await listGithubRepositories(token);
      if (request !== githubRepositoryRequestRef.current) return repositories;
      setGithubRepositories(repositories);
      setGithubRepositoryCredentialId(credentialId);
      setConfigOk(true);
      setConfigMsg(`Loaded ${repositories.length} GitHub repositories.`);
      return repositories;
    } catch (err) {
      if (request !== githubRepositoryRequestRef.current) throw err;
      setConfigOk(false);
      setConfigMsg(
        err instanceof Error ? err.message : "Could not load repositories.",
      );
      throw err;
    } finally {
      if (request === githubRepositoryRequestRef.current) {
        setGithubBusy(false);
      }
    }
  }

  function authorizeLiveSessions(
    credentialId: string,
    token: string,
    targetAgentId?: string,
  ) {
    for (const profile of getSettings().agents) {
      const assigned =
        profile.gitCredentialId === credentialId ||
        profile.id === targetAgentId;
      if (!assigned) continue;
      const live = sessionCommandsRef.current[profile.id];
      if (!live) continue;
      logGithubConnect("send-live-token", {
        agentId: profile.id,
        sessionStatus: live.status,
      });
      live.sendGitAuth(token);
    }
  }

  function cancelGithubDeviceAuth() {
    githubConnectGenerationRef.current += 1;
    githubDeviceAuthAbortRef.current?.abort();
    githubDeviceAuthAbortRef.current = null;
    setGithubDeviceAuth(null);
    setGithubBusy(false);
    setGithubConnectError("");
    logGithubConnect("cancelled");
  }

  async function connectGithub(targetAgentId?: string): Promise<{
    credential: CredentialEntry;
    repositories: AttachedRepository[];
  } | null> {
    if (!GITHUB_CLIENT_ID) {
      setConfigOk(false);
      setConfigMsg("Build the app with EXPO_PUBLIC_GITHUB_CLIENT_ID.");
      setGithubConnectError("Build the app with EXPO_PUBLIC_GITHUB_CLIENT_ID.");
      return null;
    }
    if (githubDeviceAuthAbortRef.current) {
      githubDeviceAuthAbortRef.current.abort();
    }
    const generation = ++githubConnectGenerationRef.current;
    const ensureCurrent = () => {
      if (generation !== githubConnectGenerationRef.current) {
        throw new Error("GitHub connection cancelled");
      }
    };
    setGithubBusy(true);
    setGithubConnectError("");
    const authorizationAbort = new AbortController();
    githubDeviceAuthAbortRef.current = authorizationAbort;
    logGithubConnect("start", { agentId: targetAgentId ?? "draft" });
    try {
      const authorization = await requestGithubDeviceCode(GITHUB_CLIENT_ID);
      ensureCurrent();
      if (authorizationAbort.signal.aborted) {
        throw new Error("GitHub connection cancelled");
      }
      if (!authorization.userCode.trim()) {
        throw new Error("GitHub did not return a device code");
      }
      setGithubDeviceAuth(authorization);
      logGithubConnect("device-code", {
        agentId: targetAgentId ?? "draft",
        expiresIn: authorization.expiresIn,
        interval: authorization.interval,
      });
      const githubCredential = await pollGithubDeviceToken(
        GITHUB_CLIENT_ID,
        authorization,
        {
          signal: authorizationAbort.signal,
          // Safari/device approval usually happens while the app is
          // backgrounded; wake the wait as soon as we are active again.
          onWake: (wake) => {
            const subscription = AppState.addEventListener(
              "change",
              (state) => {
                if (state === "active") {
                  logGithubConnect("app-active");
                  wake();
                }
              },
            );
            return () => subscription.remove();
          },
          onStatus: (status) => {
            logGithubConnect("poll", { status });
          },
        },
      );
      ensureCurrent();
      setGithubDeviceAuth(null);
      const token = githubCredential.accessToken;
      const identity = await fetchGithubIdentity(token);
      ensureCurrent();
      logGithubConnect("authorized", {
        agentId: targetAgentId ?? "draft",
        login: identity.login,
      });
      const label = `GitHub — ${identity.login}`;
      const existing = (await credentialVault.list()).find(
        (candidate) =>
          candidate.kind === "github-token" && candidate.label === label,
      );
      const entry = await credentialVault.save({
        id: existing?.id,
        kind: "github-token",
        label,
        secret: serializeGithubCredential(githubCredential),
      });
      ensureCurrent();
      setCredentials((previous) => [
        ...previous.filter((candidate) => candidate.id !== entry.id),
        entry,
      ]);
      setGithubRepositories([]);
      setGithubRepositoryCredentialId(entry.id);
      if (targetAgentId) {
        const currentProfile =
          getSettings().agents.find(
            (profile) => profile.id === targetAgentId,
          );
        if (!currentProfile) {
          throw new Error("The agent being connected is no longer available");
        }
        const connectedProfile = bindAgentGithubIdentity(
          currentProfile,
          entry.id,
        );
        setSettings((previous) => ({
          ...previous,
          agents: previous.agents.map((profile) =>
            profile.id === targetAgentId
              ? bindAgentGithubIdentity(profile, entry.id)
              : profile,
          ),
        }));
        await syncRailwayRepositoryTemplate(connectedProfile);
      }
      await refreshCredentials();
      ensureCurrent();
      // Same-login reconnect reuses the credential id — bump epoch so live
      // sessions re-send the fresh token immediately.
      setGitAuthEpoch((value) => value + 1);
      authorizeLiveSessions(entry.id, token, targetAgentId);
      if (targetAgentId) {
        setGithubManagerAgentId(targetAgentId);
      }
      setConfigOk(true);
      setConfigMsg(
        `Connected GitHub as ${identity.login}. Loading repositories…`,
      );

      const repositoryRequest = ++githubRepositoryRequestRef.current;
      let repositories: AttachedRepository[];
      try {
        repositories = await listGithubRepositories(token);
        ensureCurrent();
        if (repositoryRequest !== githubRepositoryRequestRef.current) {
          return { credential: entry, repositories };
        }
      } catch {
        ensureCurrent();
        setConfigOk(false);
        setConfigMsg(
          `Connected GitHub as ${identity.login}, but repositories could not be loaded. Tap Refresh to retry.`,
        );
        return { credential: entry, repositories: [] };
      }

      setGithubRepositories(repositories);
      setGithubRepositoryCredentialId(entry.id);
      if (targetAgentId) {
        const currentProfile =
          getSettings().agents.find(
            (profile) => profile.id === targetAgentId,
          );
        if (currentProfile) {
          const connectedProfile = connectAgentGithub(
            currentProfile,
            entry.id,
            repositories,
          );
          setSettings((previous) => ({
            ...previous,
            agents: previous.agents.map((profile) =>
              profile.id === targetAgentId
                ? connectAgentGithub(profile, entry.id, repositories)
                : profile,
            ),
          }));
          await syncRailwayRepositoryTemplate(connectedProfile);
        }
      }
      setGithubConnectError("");
      setConfigOk(true);
      setConfigMsg(
        `Connected GitHub as ${identity.login}. Choose startup repositories for this agent.`,
      );
      logGithubConnect("complete", {
        agentId: targetAgentId ?? "draft",
        login: identity.login,
        repositories: repositories.length,
      });
      return { credential: entry, repositories };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === "GitHub connection cancelled"
      ) {
        logGithubConnect("cancelled", { agentId: targetAgentId ?? "draft" });
        setConfigOk(false);
        setConfigMsg("GitHub connection cancelled.");
        return null;
      }
      const message =
        err instanceof Error ? err.message : "GitHub connection failed.";
      logGithubConnect("failed", {
        agentId: targetAgentId ?? "draft",
        error: message,
      });
      setGithubConnectError(message);
      setConfigOk(false);
      setConfigMsg(message);
      return null;
    } finally {
      if (githubDeviceAuthAbortRef.current === authorizationAbort) {
        githubDeviceAuthAbortRef.current = null;
      }
      if (generation === githubConnectGenerationRef.current) {
        setGithubBusy(false);
      }
    }
  }

  function toggleRepository(
    repository: AttachedRepository,
    agentId = githubManagerAgentId ?? agent.id,
  ) {
    const updatedProfile = new Promise<AgentProfile | undefined>((resolve) => {
      setSettings((previous) => {
        let nextProfile: AgentProfile | undefined;
        const agents = previous.agents.map((candidate) => {
          if (candidate.id !== agentId) return candidate;
          nextProfile = toggleAgentRepository(candidate, repository);
          return nextProfile;
        });
        resolve(nextProfile);
        return nextProfile ? { ...previous, agents } : previous;
      });
    });
    void updatedProfile
      .then((profile) =>
        profile ? syncRailwayRepositoryTemplate(profile) : undefined,
      )
      .catch((error) => {
        setConfigOk(false);
        setConfigMsg(
          error instanceof Error
            ? error.message
            : "Could not save startup repositories.",
        );
      });
  }

  function disconnectGithubFromAgent(profile: AgentProfile) {
    if (!profile.gitCredentialId) return;
    Alert.alert(
      "Disconnect GitHub?",
      "This signs git and gh out of this agent and clears its startup repository selections. Other agents are not affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const disconnectedProfile = disconnectAgentGithub(profile);
              const live = sessionCommandsRef.current[profile.id];
              live?.sendGitAuth("");
              setSettings((previous) => ({
                ...previous,
                agents: previous.agents.map((candidate) =>
                  candidate.id === profile.id
                    ? disconnectAgentGithub(candidate)
                    : candidate,
                ),
              }));
              let checkpointError: unknown;
              try {
                await syncRailwayRepositoryTemplate(disconnectedProfile);
              } catch (error) {
                checkpointError = error;
              }
              setGithubRepositories([]);
              githubRepositoryRequestRef.current += 1;
              setGithubRepositoryCredentialId(undefined);
              setGithubSearch("");
              setGitAuthEpoch((value) => value + 1);
              if (checkpointError) {
                setConfigOk(false);
                setConfigMsg(
                  `GitHub disconnected from ${
                    profile.name.trim() || "this agent"
                  }. Its provider checkpoint will retry automatically.`,
                );
              } else {
                setConfigOk(true);
                setConfigMsg(
                  `GitHub disconnected from ${
                    profile.name.trim() || "this agent"
                  }.`,
                );
              }
            })().catch((error) => {
              setConfigOk(false);
              setConfigMsg(
                error instanceof Error
                  ? error.message
                  : "Could not disconnect GitHub.",
              );
            });
          },
        },
      ],
    );
  }

  async function selectModelCredential(entry: CredentialEntry) {
    const secret = await credentialVault.getSecret(entry.id);
    if (secret == null) return;
    setSettings((prev) => {
      const current = activeAgent(prev);
      return {
        ...prev,
        modelKeys: {
          ...prev.modelKeys,
          [selectedHarness.keyEnv]: secret,
        },
        agents: prev.agents.map((profile) =>
          profile.id === current.id
            ? {
                ...profile,
                modelCredentialIds: {
                  ...(profile.modelCredentialIds ?? {}),
                  [selectedHarness.keyEnv]: entry.id,
                },
              }
            : profile,
        ),
      };
    });
  }

  useEffect(() => {
    if (agent.modelCredentialIds?.[selectedHarness.keyEnv]) return;
    const latest = [...credentials]
      .reverse()
      .find(
        (entry) =>
          entry.kind === "model-key" &&
          entry.keyEnv === selectedHarness.keyEnv,
      );
    if (!latest) return;
    void selectModelCredential(latest);
  }, [
    agent.modelCredentialIds,
    credentials,
    selectedHarness.keyEnv,
  ]);

  useEffect(() => {
    if (!configMsg) return;
    const timer = setTimeout(() => {
      setConfigMsg("");
    }, 4_000);
    return () => clearTimeout(timer);
  }, [configMsg]);

  useEffect(() => {
    if (!editingAgentId || !legacySecretsMigrated) return;
    if (agent.id !== editingAgentId) return;
    if (agent.gitCredentialId) {
      if (githubRepositoryCredentialId === agent.gitCredentialId) return;
      void loadGithubRepositoriesForCredential(agent.gitCredentialId).catch(
        () => undefined,
      );
      return;
    }
  }, [
    agent.gitCredentialId,
    agent.id,
    editingAgentId,
    githubRepositoryCredentialId,
    legacySecretsMigrated,
  ]);

  function gatewayConfigPatch(next: DeviceSettings = settings) {
    const profile = activeAgent(next);
    return gatewayConfigPatchForProfile(profile, next, next.modelKeys);
  }

  async function persistActiveGatewayToken() {
    if (!agent.token.trim()) return;
    const entry = await credentialVault.save({
      id: agent.gatewayCredentialId,
      kind: "gateway-token",
      label: `${agent.name.trim() || "Agent"} gateway`,
      secret: agent.token,
    });
    if (entry.id !== agent.gatewayCredentialId) {
      patchActiveAgent({ gatewayCredentialId: entry.id });
    }
    refreshCredentials();
  }

  useEffect(() => {
    if (
      !hydrated ||
      !legacySecretsMigrated ||
      !activeAgentConfigured ||
      session.status !== "ready" ||
      (agent.desiredState ?? "running") === "stopped"
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await persistActiveGatewayToken();
          await saveConfig(conn, gatewayConfigPatch());
        } catch (err) {
          setConfigOk(false);
          setConfigMsg(
            err instanceof Error
              ? err.message
              : "Could not save agent configuration.",
          );
        }
      })();
    }, 750);
    return () => clearTimeout(timer);
  }, [
    activeAgentConfigured,
    agent.desiredState,
    conn,
    hydrated,
    legacySecretsMigrated,
    session.status,
    settings,
  ]);

  useEffect(() => {
    if (connectionError(conn) || session.status !== "ready") {
      setModelCatalog(null);
      return;
    }
    let cancelled = false;
    setModelCatalog(null);
    void fetchModelCatalog(conn.gatewayUrl, conn.token, runtime.harness)
      .then((catalog) => {
        if (cancelled) return;
        if (catalog.harness !== runtime.harness) return;
        setModelCatalog(catalog);
      })
      .catch(() => {
        if (!cancelled) setModelCatalog(null);
      });
    return () => {
      cancelled = true;
    };
  }, [conn, runtime.harness, session.status]);

  function selectModelOverride(id: string) {
    const efforts = catalogModelEfforts(modelCatalog, id);
    const effort = efforts.includes(runtime.effort) ? runtime.effort : "";
    if (runtime.model === id && runtime.effort === effort) return;
    const next = withActiveAgentRuntime(settings, { model: id, effort });
    setSettings(next);
  }

  function selectEffortOverride(id: string) {
    if (runtime.effort === id) return;
    const next = withActiveAgentRuntime(settings, { effort: id });
    setSettings(next);
  }

  async function stopAgent(profile: AgentProfile): Promise<boolean> {
    const managed = sessions[profile.id] ?? EMPTY_SESSION;
    setLifecycleBusyAgentId(profile.id);
    patchAgent(profile.id, { desiredState: "stopped" });
    managed.abort();
    managed.disconnect();
    try {
      const provider = providerRegistry.forProfile(profile);
      if (profile.origin?.kind === "provider" && !provider) {
        throw new Error(
          `Provider ${profile.origin.providerId ?? "unknown"} is not installed.`,
        );
      }
      if (provider) {
        await provider.stopAgent(profile);
      } else {
        const result = await resetSession(
          connectionFor(profile, settings.userId),
        );
        if (!result.restarting) {
          throw new Error(
            "This host cannot recreate the session. Configure its container supervisor, then try again.",
          );
        }
      }
      return true;
    } catch (err) {
      patchAgent(profile.id, { desiredState: "running" });
      setConfigOk(false);
      setConfigMsg(
        err instanceof Error ? err.message : "Could not start a new session.",
      );
      return false;
    } finally {
      setLifecycleBusyAgentId(null);
    }
  }

  async function startAgent(profile: AgentProfile): Promise<boolean> {
    setLifecycleBusyAgentId(profile.id);
    try {
      const provider = providerRegistry.forProfile(profile);
      if (profile.origin?.kind === "provider" && !provider) {
        throw new Error(
          `Provider ${profile.origin.providerId ?? "unknown"} is not installed.`,
        );
      }
      if (provider) {
        patchAgent(profile.id, { desiredState: "running" });
        try {
          await provider.startAgent(profile);
        } catch (err) {
          patchAgent(profile.id, { desiredState: "stopped" });
          throw err;
        }
      }
      const modelKeys = await resolveProfileModelKeys(
        profile,
        settings,
        credentials,
      );
      await saveConfig(
        connectionFor(profile, settings.userId),
        gatewayConfigPatchForProfile(profile, settings, modelKeys),
      );
      if (!provider) {
        patchAgent(profile.id, { desiredState: "running" });
      }
      return true;
    } catch (err) {
      setConfigOk(false);
      setConfigMsg(
        err instanceof Error ? err.message : "Could not start a new session.",
      );
      return false;
    } finally {
      setLifecycleBusyAgentId(null);
    }
  }

  async function refreshAgentSession(profile: AgentProfile) {
    if (shouldStopHostBeforeNewSession(profile.desiredState)) {
      const stopped = await stopAgent(profile);
      if (!stopped) return;
    }
    const started = await startAgent(profile);
    if (!started) return;
    setConfigOk(true);
    setConfigMsg("New session starting.");
  }

  async function replaceAgent(profile: AgentProfile) {
    setLifecycleBusyAgentId(profile.id);
    try {
      const provider = providerRegistry.forProfile(profile);
      if (!provider?.replaceAgent) {
        throw new Error("This provider cannot replace a removed deployment.");
      }
      const replacement = await provider.replaceAgent(profile);
      const modelKeys = await resolveProfileModelKeys(
        profile,
        settings,
        credentials,
      );
      await saveConfig(
        {
          ...connectionFor(profile, settings.userId),
          gatewayUrl: replacement.gatewayUrl,
        },
        gatewayConfigPatchForProfile(profile, settings, modelKeys),
      );
      setConfigOk(true);
      setConfigMsg("Replacement deployment is online.");
    } catch (err) {
      setConfigOk(false);
      setConfigMsg(
        err instanceof Error
          ? err.message
          : "Could not launch a replacement deployment.",
      );
    } finally {
      setLifecycleBusyAgentId(null);
    }
  }

  const activeDisplayState = agentDisplayState(agent, session);
  const firstLaunch = isBlankDefaultProfile(settings.agents);
  const talkState = resolveTalkState(
    activeDisplayState,
    session.speaking,
    session.working,
    session.ttsOpen,
    pttHeld,
    session.busyKind,
  );
  const editingAgent =
    settings.agents.find((profile) => profile.id === editingAgentId) ?? null;
  const editingSession = editingAgent
    ? sessions[editingAgent.id] ?? EMPTY_SESSION
    : EMPTY_SESSION;
  const editingProvider = editingAgent
    ? providerRegistry.forProfile(editingAgent)
    : undefined;
  const editingAccountConnection =
    editingAgent && editingProvider
      ? editingProvider.accountConnection(editingAgent)
      : undefined;
  const editingTrayItem = editingAgent
    ? agentTrayItem(
        editingAgent,
        editingSession,
        settings,
        editingProvider?.hostLabel(editingAgent),
      )
    : null;
  const setupProvider =
    agentSetupScreen?.startsWith("provider:")
      ? providerRegistry.get(agentSetupScreen.slice("provider:".length))
      : undefined;
  const editingDeleteConfirmation =
    editingAgent && editingProvider
      ? editingProvider.deleteConfirmation(editingAgent)
      : {
          title: "Remove this agent?",
          message:
            "This removes the saved connection from this phone. It does not stop or delete the existing host.",
          actionLabel: "Remove from phone",
        };

  useEffect(() => {
    if (!editingAgent?.token.trim()) return;
    const timer = setTimeout(() => {
      void credentialVault
        .save({
          id: editingAgent.gatewayCredentialId,
          kind: "gateway-token",
          label: `${editingAgent.name.trim() || "Agent"} gateway`,
          secret: editingAgent.token,
        })
        .then((entry) => {
          if (entry.id !== editingAgent.gatewayCredentialId) {
            setSettings((previous) => ({
              ...previous,
              agents: previous.agents.map((profile) =>
                profile.id === editingAgent.id
                  ? { ...profile, gatewayCredentialId: entry.id }
                  : profile,
              ),
            }));
          }
          refreshCredentials();
        })
        .catch((err) => {
          setConfigOk(false);
          setConfigMsg(
            err instanceof Error ? err.message : "Could not save gateway token.",
          );
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [
    editingAgent?.gatewayCredentialId,
    editingAgent?.id,
    editingAgent?.name,
    editingAgent?.token,
    refreshCredentials,
  ]);

  const agentConfiguration = (
    <>
      <SectionLabel icon={<LinkIcon size={13} color={color.textMuted} />}>
        GitHub
      </SectionLabel>
      <AgentGithubSummary
        assigned={Boolean(editingAgent?.gitCredentialId ?? agent.gitCredentialId)}
        credential={
          githubCredentials.find(
            (entry) =>
              entry.id ===
              (editingAgent?.gitCredentialId ?? agent.gitCredentialId),
          )
        }
        repositories={
          (editingAgent ?? agent).repositories ?? []
        }
        authState={
          (editingAgent
            ? sessions[editingAgent.id] ?? EMPTY_SESSION
            : session
          ).gitAuthState
        }
        authMessage={
          (editingAgent
            ? sessions[editingAgent.id] ?? EMPTY_SESSION
            : session
          ).gitAuthMessage
        }
        connectError={githubConnectError}
        busy={githubBusy}
        onConnect={() => {
          void connectGithub((editingAgent ?? agent).id);
        }}
        onManage={() => openGithubManager((editingAgent ?? agent).id)}
      />
      {!GITHUB_CLIENT_ID ? (
        <Text style={styles.githubConfigWarning}>
          This app build is missing its GitHub OAuth client ID.
        </Text>
      ) : null}

      <SectionLabel icon={<MicIcon size={13} color={color.textMuted} />}>
        Agent runtime
      </SectionLabel>
      <View style={styles.harnessGrid}>
        {HARNESSES.map((h) => {
          const active = runtime.harness === h.id;
          return (
            <Pressable
              key={h.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={h.label}
              onPress={() =>
                setSettings((prev) =>
                  updateAgentHarness(prev, activeAgent(prev).id, h.id),
                )
              }
              style={[
                styles.harnessCard,
                active && styles.harnessCardActive,
              ]}
            >
              <View style={styles.harnessTop}>
                <Text
                  style={[
                    styles.harnessLabel,
                    active && styles.harnessLabelActive,
                  ]}
                >
                  {h.label}
                </Text>
                {active ? <CheckIcon size={14} color={color.accent} /> : null}
              </View>
              <Text style={styles.harnessEnv}>{h.keyEnv}</Text>
            </Pressable>
          );
        })}
      </View>
      {modelCatalog && modelCatalog.models.length > 0 ? (
        <ModelEffortPills
          catalog={modelCatalog}
          model={runtime.model}
          effort={runtime.effort}
          onSelectModel={selectModelOverride}
          onSelectEffort={selectEffortOverride}
        />
      ) : null}
      {credentials.every(
        (entry) =>
          entry.kind !== "model-key" ||
          entry.keyEnv !== selectedHarness.keyEnv,
      ) ? (
        <Card>
          <Text style={styles.note}>
            {`${selectedHarness.label} needs an API key from App Settings.`}
          </Text>
          <Button
            tone="neutral"
            label="Open App Settings"
            onPress={() => setShowAppSettings(true)}
          />
        </Card>
      ) : null}

      <SectionLabel icon={<WaveIcon size={13} color={color.textMuted} />}>
        Voice
      </SectionLabel>
      <Card>
        <Field
          label="Stop word"
          value={runtime.stopWord}
          onChange={(v) => patchActiveAgentRuntime({ stopWord: v })}
          placeholder="hard stop"
          hint="Say this at any time to stop the current response."
        />
        <Field
          label="ElevenLabs voice ID"
          value={runtime.voiceId}
          onChange={(v) => patchActiveAgentRuntime({ voiceId: v })}
          autoCapitalize="none"
          mono
          placeholder="Gateway default"
        />
      </Card>

      <SectionLabel>Advanced</SectionLabel>
      <Card>
        <Field
          label="Device user ID"
          value={settings.userId}
          onChange={(value) => patch({ userId: value })}
          autoCapitalize="none"
          mono
          placeholder="default"
          hint="Used for sessions from this device across all agents."
        />
      </Card>
    </>
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <GithubDeviceAuthModal
        authorization={githubDeviceAuth}
        error={githubConnectError}
        onCancel={cancelGithubDeviceAuth}
      />
      {settings.agents.map((profile) => (
        <VoiceSessionController
          key={profile.id}
          profile={profile}
          settings={settings}
          credentials={credentials}
          userId={settings.userId}
          focused={profile.id === settings.activeAgentId}
          mode={mode}
          lifecycleBusy={lifecycleBusyAgentId === profile.id}
          gitAuthEpoch={gitAuthEpoch}
          onChange={reportSession}
        />
      ))}

      {showAppSettings ? (
        <AppSettingsScreen
          sttProviderId={sttProviderId}
          ttsProviderId={ttsProviderId}
          onBack={() => setShowAppSettings(false)}
          onSaved={async (patch) => {
            setSettings((previous) => ({
              ...previous,
              sttProviderId: patch.sttProviderId,
              ttsProviderId: patch.ttsProviderId,
            }));
            await refreshCredentials();
            setConfigOk(true);
            setConfigMsg("App credentials saved on this phone.");
          }}
        />
      ) : githubManagerAgent ? (
        <GithubRepositoryManagerScreen
          credential={githubManagerCredential}
          credentials={githubCredentials}
          repositories={githubRepositories}
          selectedRepositories={githubManagerAgent.repositories ?? []}
          busy={githubBusy}
          search={githubSearch}
          connectError={githubConnectError}
          onSearchChange={setGithubSearch}
          onConnect={() => {
            void connectGithub(githubManagerAgent.id);
          }}
          onRefresh={() => {
            if (!githubManagerAgent.gitCredentialId) return;
            void loadGithubRepositoriesForCredential(
              githubManagerAgent.gitCredentialId,
            ).catch(() => undefined);
          }}
          onToggleRepository={(repository) =>
            toggleRepository(repository, githubManagerAgent.id)
          }
          onSwitchAccount={() => {
            void connectGithub(githubManagerAgent.id);
          }}
          onDisconnect={() =>
            disconnectGithubFromAgent(githubManagerAgent)
          }
          onBack={() => {
            setGithubManagerAgentId(null);
            setEditingAgentId(githubManagerAgent.id);
          }}
        />
      ) : editingAgent && editingTrayItem ? (
        <AgentDetailScreen
          name={editingAgent.name}
          gatewayUrl={editingAgent.gatewayUrl}
          token={editingAgent.token}
          hostLabel={
            editingProvider?.hostLabel(editingAgent) ?? "Existing host"
          }
          statusLabel={trayStatusLabel(editingTrayItem.status)}
          statusTone={trayStatusTone(editingTrayItem.status)}
          gone={editingTrayItem.status === "gone"}
          lifecycleBusy={lifecycleBusyAgentId === editingAgent.id}
          removing={removingAgentId === editingAgent.id}
          accountConnection={editingAccountConnection}
          configuration={agentConfiguration}
          onNameChange={(name) => patchAgent(editingAgent.id, { name })}
          onGatewayUrlChange={(gatewayUrl) =>
            patchAgent(editingAgent.id, { gatewayUrl })
          }
          onTokenChange={(token) => patchAgent(editingAgent.id, { token })}
          onNewSession={() => void refreshAgentSession(editingAgent)}
          onReplace={() => void replaceAgent(editingAgent)}
          onRemove={() =>
            Alert.alert(
              editingDeleteConfirmation.title,
              editingDeleteConfirmation.message,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: editingDeleteConfirmation.actionLabel,
                  style: "destructive",
                  onPress: () => void removeAgent(editingAgent),
                },
              ],
            )
          }
          onBack={() => setEditingAgentId(null)}
        />
      ) : agentSetupScreen ? (
        agentSetupScreen === "choose" ? (
          <AddAgentScreen
            onBack={() => setAgentSetupScreen(null)}
            providers={providerRegistry.providers.map(
              (provider) => provider.definition,
            )}
            onProvider={(providerId) => {
              const provider = providerRegistry.get(providerId);
              if (!provider) return;
              provider.prepareSetup();
              setAgentSetupScreen(`provider:${providerId}`);
            }}
            onManual={() => {
              setManualName("");
              setManualGatewayUrl("");
              setManualGatewayToken("");
              setAgentSetupScreen("manual");
            }}
          />
        ) : agentSetupScreen === "manual" ? (
          <ManualAgentScreen
            name={manualName}
            gatewayUrl={manualGatewayUrl}
            token={manualGatewayToken}
            busy={manualBusy}
            onNameChange={setManualName}
            onGatewayUrlChange={setManualGatewayUrl}
            onTokenChange={setManualGatewayToken}
            onScan={() => setAgentSetupScreen("scan")}
            onSave={() => void saveManualAgent()}
            onBack={() => setAgentSetupScreen("choose")}
          />
        ) : agentSetupScreen === "scan" ? (
          <PairingScannerScreen
            onScanned={handleScannedPairing}
            onBack={() => setAgentSetupScreen("manual")}
          />
        ) : setupProvider ? (
          setupProvider.renderSetup(() => setAgentSetupScreen("choose"))
        ) : null
      ) : (
        <>
      <View style={styles.header}>
        <View style={styles.headerSide} />
        <BrandIcon size={36} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="App settings"
          hitSlop={10}
          onPress={() => setShowAppSettings(true)}
          style={styles.headerSide}
        >
          <GearIcon size={22} color={color.textMuted} />
        </Pressable>
      </View>

      <View style={styles.screen}>
          <AgentTray
            agents={settings.agents
              .filter((profile) => !firstLaunch || profile.id !== agent.id)
              .map((profile) =>
                agentTrayItem(
                  profile,
                  sessions[profile.id] ?? EMPTY_SESSION,
                  settings,
                  providerRegistry.forProfile(profile)?.hostLabel(profile),
                ),
              )}
            activeAgentId={settings.activeAgentId}
            onSelect={editAgent}
            onOpenMenu={openAgentMenu}
            onAdd={addAgent}
          />

          {!firstLaunch ? (
            <>
          <Segmented<VoiceMode>
            value={mode}
            onChange={setMode}
            options={[
              {
                value: "ptt",
                label: "Walkie-talkie",
                icon: (
                  <MicIcon
                    size={16}
                    color={mode === "ptt" ? color.text : color.textMuted}
                  />
                ),
              },
              {
                value: "handsfree",
                label: "Hands-free",
                icon: (
                  <WaveIcon
                    size={16}
                    color={mode === "handsfree" ? color.text : color.textMuted}
                  />
                ),
              },
            ]}
          />

          <TalkButton
            mode={mode}
            state={talkState}
            detail={
              session.provisioning
                ? provisioningLabel(session.provisioning)
                : undefined
            }
            onPressIn={() => {
              setPttHeld(true);
              session.pttStart();
            }}
            onPressOut={() => {
              setPttHeld(false);
              session.pttEnd();
            }}
          />

          {session.working || session.speaking || session.ttsOpen ? (
            <Button
              tone="ghost"
              label="Stop current response"
              accessibilityHint="Aborts the current response without ending the session."
              icon={<StopIcon size={15} color={color.textMuted} />}
              onPress={() => session.abort()}
            />
          ) : null}

          <View style={styles.feed}>
            <Text style={styles.transcriptAgent}>
              {sessionDisplayName(
                agent,
                session.harness || resolveAgentRuntimeSettings(agent, settings).harness,
              )}
            </Text>
            <Transcript events={session.events} />
          </View>
            </>
          ) : (
            <View style={styles.firstLaunch}>
              <Text style={styles.firstLaunchTitle}>Add your first agent</Text>
              <Text style={styles.firstLaunchDetail}>
                Save the required voice provider keys in Settings, then launch
                an agent in your provider account or connect a host you already
                run.
              </Text>
            </View>
          )}
      </View>
        </>
      )}
      {configMsg ? (
        <View pointerEvents="none" style={styles.toastOverlay}>
          <Toast message={configMsg} ok={configOk} />
        </View>
      ) : null}
    </View>
  );
}

function VoiceSessionController({
  profile,
  settings,
  credentials,
  userId,
  focused,
  mode,
  lifecycleBusy,
  gitAuthEpoch,
  onChange,
}: {
  profile: AgentProfile;
  settings: DeviceSettings;
  credentials: CredentialEntry[];
  userId: string;
  focused: boolean;
  mode: VoiceMode;
  lifecycleBusy: boolean;
  gitAuthEpoch: number;
  onChange: (id: string, session: ManagedSession) => () => void;
}) {
  const conn = useMemo(
    () => ({
      gatewayUrl: normalizeGatewayUrl(profile.gatewayUrl),
      token: profile.token,
      userId,
    }),
    [profile.gatewayUrl, profile.token, userId],
  );
  const getGitCredential = useCallback(
    () =>
      profile.gitCredentialId
        ? githubAccessToken(profile.gitCredentialId)
        : Promise.resolve(""),
    [profile.gitCredentialId],
  );
  const saveConfigBeforeConnect = useCallback(async () => {
    const modelKeys = await resolveProfileModelKeys(
      profile,
      settings,
      credentials,
    );
    await saveConfig(
      conn,
      gatewayConfigPatchForProfile(profile, settings, modelKeys),
    );
  }, [conn, credentials, profile, settings]);
  const session = useVoiceSession(conn, {
    profileId: profile.id,
    focused,
    managedHost: profile.origin?.kind === "provider",
    saveConfigBeforeConnect,
    getGitCredential,
  });
  const managed = useMemo<ManagedSession>(
    () => ({ ...session }),
    [
      session.abort,
      session.availability,
      session.connect,
      session.disconnect,
      session.events,
      session.generationId,
      session.gitAuthMessage,
      session.gitAuthState,
      session.harness,
      session.lastError,
      session.markGitAuthRequired,
      session.pttEnd,
      session.pttStart,
      session.provisioning,
      session.sendGitAuth,
      session.speaking,
      session.ttsOpen,
      session.status,
      session.working,
      session.busyKind,
    ],
  );

  useLayoutEffect(() => {
    return onChange(profile.id, managed);
  }, [managed, onChange, profile.id]);

  useEffect(() => {
    const shouldRun =
      (profile.desiredState ?? "running") === "running" &&
      providerAllowsSessionConnection(profile) &&
      !lifecycleBusy &&
      session.availability !== "gone" &&
      !connectionError(conn);
    if (!shouldRun) {
      if (session.status !== "disconnected") session.disconnect();
      return;
    }
    if (session.status !== "disconnected") return;
    const timer = setTimeout(
      () => session.connect(mode),
      session.lastError ? 15_000 : 0,
    );
    return () => clearTimeout(timer);
  }, [
    conn,
    lifecycleBusy,
    mode,
    profile.desiredState,
    profile.origin?.kind,
    profile.origin?.provisioningPhase,
    session.availability,
    session.connect,
    session.disconnect,
    session.lastError,
    session.status,
  ]);

  // Keep the live box logged into GitHub (or signed out) as phone credentials change.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (!profile.gitCredentialId) {
        if (session.status !== "disconnected") {
          session.sendGitAuth("");
        }
        return;
      }
      try {
        const token = await githubAccessToken(profile.gitCredentialId);
        if (cancelled) return;
        session.sendGitAuth(token);
      } catch (error) {
        if (cancelled) return;
        session.sendGitAuth("");
        session.markGitAuthRequired(
          error instanceof Error
            ? error.message
            : "GitHub authorization expired; connect GitHub again",
        );
      }
    };
    void sync();
    if (session.status === "disconnected") {
      return () => {
        cancelled = true;
      };
    }
    const timer = setInterval(() => {
      void sync();
    }, 5 * 60 * 1_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    gitAuthEpoch,
    profile.gitCredentialId,
    session.markGitAuthRequired,
    session.sendGitAuth,
    session.status,
  ]);

  const previousModeRef = useRef(mode);
  useEffect(() => {
    if (!focused || previousModeRef.current === mode) return;
    previousModeRef.current = mode;
    if (session.status === "ready") session.connect(mode);
  }, [focused, mode, session.connect, session.status]);

  return null;
}

function provisioningLabel(
  state: NonNullable<ManagedSession["provisioning"]>,
): string {
  if (state.stage === "cloning") {
    const count =
      state.index !== undefined && state.total > 0
        ? ` (${state.index} of ${state.total})`
        : "";
    return `Cloning startup repository ${state.repository ?? "repository"}${count}`;
  }
  if (state.stage === "starting_harness") return "Starting agent runtime";
  return state.total > 0
    ? `Preparing ${state.total} startup repositories`
    : "Preparing workspace";
}

function withActiveAgentRuntime(
  settings: DeviceSettings,
  partial: Partial<AgentRuntimeSettings>,
): DeviceSettings {
  const current = activeAgent(settings);
  return {
    ...settings,
    agents: settings.agents.map((profile) =>
      profile.id === current.id
        ? {
            ...profile,
            runtime: {
              ...(profile.runtime ?? {}),
              ...partial,
            },
          }
        : profile,
    ),
  };
}

function harnessPrefix(harness: string): string {
  switch (harness) {
    case "claude-code":
      return "Claude";
    case "cursor-cli":
      return "Cursor";
    case "gemini-cli":
      return "Gemini";
    case "codex":
      return "Codex";
    default:
      return "Agent";
  }
}

function sessionDisplayName(profile: AgentProfile, harness: string): string {
  return `${profile.name.trim() || "Untitled agent"} · ${harnessPrefix(harness)}`;
}

function agentTrayItem(
  profile: AgentProfile,
  session: ManagedSession,
  settings: DeviceSettings,
  providerLabel?: string,
): AgentTrayItem {
  const status = agentDisplayState(profile, session);
  const runtime = resolveAgentRuntimeSettings(profile, settings);
  const host = providerLabel ?? "Existing host";
  const startupRepos = profile.repositories ?? [];
  const repositories =
    startupRepos.length === 0
      ? ""
      : startupRepos.length === 1
        ? ` · ${startupRepos[0]!.fullName}`
        : ` · ${startupRepos[0]!.fullName} +${startupRepos.length - 1}`;
  return {
    id: profile.id,
    name: profile.name.trim() || "Untitled agent",
    detail: `${host} · ${harnessPrefix(runtime.harness)}${repositories}`,
    status,
  };
}

function agentDisplayState(
  profile: AgentProfile,
  session: ManagedSession,
): AgentTrayItem["status"] {
  if (session.gitAuthState === "required") return "error";
  const state = deriveAgentLifecycle({
    profile,
    sessionStatus: session.status,
    reachability: session.availability,
  });
  return state === "running" && session.status === "disconnected"
    ? "starting"
    : state;
}

function trayStatusLabel(status: AgentTrayItem["status"]): string {
  if (status === "needs-setup") return "Needs setup";
  if (status === "stopped") return "Session ended";
  if (status === "starting") return "Starting session";
  if (status === "running") return "Session running";
  if (status === "unreachable") return "Session unreachable";
  if (status === "gone") return "Deployment removed";
  return "Attention needed";
}

function trayStatusTone(
  status: AgentTrayItem["status"],
): "idle" | "busy" | "live" | "error" {
  if (status === "running") return "live";
  if (status === "starting") return "busy";
  if (status === "unreachable" || status === "error") return "error";
  return "idle";
}

function gatewayConfigPatchForProfile(
  profile: AgentProfile,
  settings: DeviceSettings,
  modelKeys: Record<string, string>,
): Partial<UserConfig> {
  const runtime = resolveAgentRuntimeSettings(profile, settings);
  return {
    repo: {
      url: runtime.repoUrl || "github.com",
      credential: "",
      repositories: profile.repositories ?? [],
      ...(runtime.defaultBranch.trim()
        ? { defaultBranch: runtime.defaultBranch.trim() }
        : {}),
    },
    harness: runtime.harness,
    model: runtime.model,
    effort: runtime.effort,
    modelKeys,
    voice: {
      stopWord: runtime.stopWord,
      ...(runtime.voiceId.trim() ? { ttsVoiceId: runtime.voiceId.trim() } : {}),
    },
  };
}

async function resolveProfileModelKeys(
  profile: AgentProfile,
  settings: DeviceSettings,
  credentials: CredentialEntry[],
): Promise<Record<string, string>> {
  const credentialIds = { ...(profile.modelCredentialIds ?? {}) };
  const runtime = resolveAgentRuntimeSettings(profile, settings);
  const harness = HARNESSES.find((candidate) => candidate.id === runtime.harness);
  if (harness && !credentialIds[harness.keyEnv]) {
    const latest = [...credentials]
      .reverse()
      .find(
        (entry) =>
          entry.kind === "model-key" && entry.keyEnv === harness.keyEnv,
      );
    if (latest) credentialIds[harness.keyEnv] = latest.id;
  }

  const resolved = await Promise.all(
    Object.entries(credentialIds).map(async ([keyEnv, credentialId]) => [
      keyEnv,
      await credentialVault.getSecret(credentialId),
    ] as const),
  );
  return Object.fromEntries(
    resolved.filter(
      (entry): entry is readonly [string, string] => Boolean(entry[1]?.trim()),
    ),
  );
}

function connectionFor(profile: AgentProfile, userId: string) {
  return {
    gatewayUrl: normalizeGatewayUrl(profile.gatewayUrl),
    token: profile.token,
    userId,
  };
}

function isAgentEndpointConfigured(profile: AgentProfile): boolean {
  return agentConfigurationIssue(profile) === null;
}

function isBlankDefaultProfile(agents: AgentProfile[]): boolean {
  return (
    agents.length === 1 &&
    !agents[0]?.token.trim() &&
    !agents[0]?.gatewayCredentialId &&
    !agents[0]?.origin &&
    (!agents[0]?.gatewayUrl || agents[0].gatewayUrl === "http://")
  );
}

function catalogModelEfforts(
  catalog: ModelCatalog | null,
  modelId: string,
): string[] {
  if (!catalog) return [];
  const selected = modelId
    ? catalog.models.find((model) => model.id === modelId)
    : (catalog.models.find((model) => model.default) ?? catalog.models[0]);
  return selected?.efforts ?? [];
}

function formatEffortLabel(id: string): string {
  if (!id) return "Default";
  return id.charAt(0).toUpperCase() + id.slice(1).toLowerCase();
}

function ModelEffortPills({
  catalog,
  model,
  effort,
  onSelectModel,
  onSelectEffort,
}: {
  catalog: ModelCatalog;
  model: string;
  effort: string;
  onSelectModel: (id: string) => void;
  onSelectEffort: (id: string) => void;
}) {
  const efforts = catalogModelEfforts(catalog, model);
  return (
    <View style={styles.pillBlock}>
      <PillRow
        kind="model"
        value={model}
        options={[
          { id: "", label: "Default" },
          ...catalog.models.map((entry) => ({
            id: entry.id,
            label: entry.label,
          })),
        ]}
        onSelect={onSelectModel}
      />
      {efforts.length > 0 ? (
        <PillRow
          kind="effort"
          value={effort}
          options={[
            { id: "", label: "Default" },
            ...efforts.map((id) => ({ id, label: formatEffortLabel(id) })),
          ]}
          onSelect={onSelectEffort}
        />
      ) : null}
    </View>
  );
}

function PillRow({
  kind,
  value,
  options,
  onSelect,
}: {
  kind: "model" | "effort";
  value: string;
  options: { id: string; label: string }[];
  onSelect: (id: string) => void;
}) {
  return (
    <View>
      <Text style={styles.pillSectionLabel}>
        {kind === "model" ? "MODEL" : "EFFORT"}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
        style={styles.pillScroll}
      >
        {options.map((option) => {
          const active = value === option.id;
          return (
            <Pressable
              key={option.id || "default"}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Select ${kind} ${option.label}`}
              onPress={() => onSelect(option.id)}
              style={[styles.modelPill, active && styles.modelPillActive]}
            >
              <Text
                style={[
                  styles.modelPillText,
                  active && styles.modelPillTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.bg,
    paddingTop: inset.top,
    paddingBottom: inset.bottom,
  },
  toastOverlay: {
    position: "absolute",
    top: inset.top,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.xl,
    paddingBottom: space.sm,
  },
  headerSide: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  screen: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    gap: space.md,
  },
  sessionSwitcherScroll: {
    flexGrow: 0,
    marginHorizontal: -space.xl,
  },
  sessionSwitcher: {
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  sessionChip: {
    maxWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  sessionChipActive: {
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  sessionDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  sessionChipText: {
    flexShrink: 1,
    color: color.textMuted,
    fontSize: font.caption,
    fontWeight: "700",
  },
  sessionChipTextActive: {
    color: color.text,
  },
  feed: {
    flex: 1,
    marginTop: space.xs,
  },
  firstLaunch: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xl,
  },
  firstLaunchTitle: {
    color: color.text,
    fontSize: font.title,
    fontWeight: "700",
  },
  firstLaunchDetail: {
    color: color.textDim,
    fontSize: font.label,
    lineHeight: 20,
    textAlign: "center",
    marginTop: space.sm,
  },
  transcriptAgent: {
    color: color.textMuted,
    fontSize: font.micro,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: space.sm,
  },
  pillBlock: {
    gap: space.sm,
  },
  pillSectionLabel: {
    color: color.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  pillScroll: {
    flexGrow: 0,
  },
  pillRow: {
    flexDirection: "row",
    gap: space.sm,
  },
  modelPill: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    backgroundColor: "transparent",
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  modelPillActive: {
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  modelPillText: {
    color: color.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  modelPillTextActive: {
    color: color.accent,
  },
  githubConfigWarning: {
    color: color.warn,
    fontSize: font.caption,
    lineHeight: 17,
    marginTop: space.sm,
  },
  note: {
    color: color.textDim,
    fontSize: font.caption,
    lineHeight: 17,
    marginTop: space.md,
  },
  harnessGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.md,
  },
  harnessCard: {
    flexGrow: 1,
    flexBasis: "46%",
    backgroundColor: color.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  harnessCardActive: {
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  harnessTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  harnessLabel: {
    color: color.textMuted,
    fontSize: font.label,
    fontWeight: "700",
  },
  harnessLabelActive: {
    color: color.text,
  },
  harnessEnv: {
    color: color.textDim,
    fontSize: font.micro - 1,
    marginTop: 3,
    letterSpacing: 0.3,
  },
});
