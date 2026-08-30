import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
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
} from "./src/api";
import {
  agentConfigurationIssue,
  deriveAgentLifecycle,
} from "./src/agent-lifecycle";
import type { CredentialEntry } from "./src/credential-vault";
import {
  fetchGithubIdentity,
  GITHUB_APP_SLUG,
  GITHUB_CLIENT_ID,
  listGithubRepositories,
  pollGithubDeviceToken,
  requestGithubDeviceCode,
  serializeGithubCredential,
} from "./src/github";
import { connectionError, normalizeGatewayUrl } from "./src/protocol";
import { parseAgentPairingUrl } from "./src/pairing";
import { useProviderRegistry } from "./src/providers/registry";
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
import { saveVoiceSecrets as persistVoiceSecrets } from "./src/voice-credentials";
import { hydrateVoiceProviderId } from "./src/voice-providers";
import {
  AddAgentScreen,
  ManualAgentScreen,
} from "./src/ui/AgentSetup";
import { AgentDetailScreen } from "./src/ui/AgentDetail";
import { AppSettingsScreen } from "./src/ui/AppSettings";
import { AgentTray, type AgentTrayItem } from "./src/ui/AgentTray";
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
  TrashIcon,
  WaveIcon,
} from "./src/ui/icons";
import { TalkButton, type TalkState } from "./src/ui/TalkButton";
import { Transcript } from "./src/ui/Transcript";
import { color, font, inset, radius, space } from "./src/ui/theme";

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
  working: false,
  harness: "",
  generationId: "",
  provisioning: null,
  lastError: "",
  connect: () => undefined,
  disconnect: () => undefined,
  pttStart: () => undefined,
  pttEnd: () => undefined,
  abort: () => undefined,
};

export default function App() {
  const [mode, setMode] = useState<VoiceMode>("ptt");
  const [pttHeld, setPttHeld] = useState(false);
  const { settings, setSettings, hydrated } = useDeviceSettings();
  const [configMsg, setConfigMsg] = useState("");
  const [configOk, setConfigOk] = useState(false);
  const [sessions, setSessions] = useState<Record<string, ManagedSession>>({});
  const [credentials, setCredentials] = useState<CredentialEntry[]>([]);
  const [githubRepositories, setGithubRepositories] = useState<
    AttachedRepository[]
  >([]);
  const [githubSearch, setGithubSearch] = useState("");
  const [githubBusy, setGithubBusy] = useState(false);
  const [modelCredentialLabel, setModelCredentialLabel] = useState("");
  const [legacySecretsMigrated, setLegacySecretsMigrated] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog | null>(null);
  const [agentSetupScreen, setAgentSetupScreen] =
    useState<AgentSetupScreen | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
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
    (id: string, session: ManagedSession) =>
      setSessions((current) =>
        current[id] === session ? current : { ...current, [id]: session },
      ),
    [],
  );
  const session = sessions[agent.id] ?? EMPTY_SESSION;
  const activeAgentConfigured = isAgentEndpointConfigured(agent);

  const selectedHarness =
    HARNESSES.find((h) => h.id === runtime.harness) ?? HARNESSES[0]!;
  const selectedGitCredential = credentials.find(
    (entry) => entry.id === agent.gitCredentialId,
  );
  const visibleGithubRepositories = githubRepositories.filter((repository) =>
    repository.fullName.toLowerCase().includes(githubSearch.trim().toLowerCase()),
  );
  const gatewayCredentialSignature = settings.agents
    .map((profile) => `${profile.id}:${profile.gatewayCredentialId ?? ""}`)
    .join("|");

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
    setSettings((prev) => ({
      ...prev,
      activeAgentId: id,
      gitPat: "",
      modelKeys: {},
    }));
    setGithubRepositories([]);
    setGithubSearch("");
  };

  const addAgent = () => {
    setManualName("");
    setAgentSetupScreen("choose");
  };

  const editAgent = (id: string) => {
    selectAgent(id);
    setEditingAgentId(id);
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
    const stopped = (profile.desiredState ?? "running") === "stopped";
    Alert.alert(profile.name, undefined, [
      settingsAction,
      {
        text: stopped ? "Start new session" : "End session",
        style: stopped ? "default" : "destructive",
        onPress: () => toggleAgentLifecycle(profile),
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
    setConfigMsg("Hosted agent is online. Configure its runtime.");
  }, [setSettings]);

  const providerRegistry = useProviderRegistry({
    credentials,
    setSettings,
    onReady: onProviderReady,
    onCredentialsChanged: refreshCredentials,
    sttProviderId,
    ttsProviderId,
    saveVoiceSecrets: async (input) => {
      await persistVoiceSecrets(credentialVault, input);
      await refreshCredentials();
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
      const gitPat = profile.gitCredentialId
        ? await githubAccessToken(profile.gitCredentialId).catch(() => "")
        : "";
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
        ...(prev.activeAgentId === profile.id
          ? { gitPat: gitPat ?? "", modelKeys }
          : {}),
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

  async function selectGitCredential(entry: CredentialEntry) {
    const token = await githubAccessToken(entry.id);
    patch({ gitPat: token });
    patchActiveAgent({ gitCredentialId: entry.id });
    await loadGithubRepositories(
      token,
      entry.kind === "github-token" ? "github-app" : "pat",
    );
  }

  async function loadGithubRepositories(
    token = settings.gitPat,
    source: "github-app" | "pat" = credentials.find(
      (entry) => entry.id === agent.gitCredentialId,
    )?.kind === "git-pat"
      ? "pat"
      : "github-app",
  ) {
    if (!token.trim()) {
      setConfigOk(false);
      setConfigMsg("Connect a GitHub account first.");
      return;
    }
    setGithubBusy(true);
    try {
      const repositories = await listGithubRepositories(token, fetch, source);
      setGithubRepositories(repositories);
      setConfigOk(true);
      setConfigMsg(`Loaded ${repositories.length} GitHub repositories.`);
    } catch (err) {
      setConfigOk(false);
      setConfigMsg(
        err instanceof Error ? err.message : "Could not load repositories.",
      );
    } finally {
      setGithubBusy(false);
    }
  }

  async function connectGithub() {
    if (!GITHUB_CLIENT_ID) {
      setConfigOk(false);
      setConfigMsg("Build the app with EXPO_PUBLIC_GITHUB_CLIENT_ID.");
      return;
    }
    setGithubBusy(true);
    const authorizationAbort = new AbortController();
    try {
      const authorization = await requestGithubDeviceCode(GITHUB_CLIENT_ID);
      Alert.alert(
        "Connect GitHub",
        `Enter code ${authorization.userCode} on GitHub.`,
        [
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => authorizationAbort.abort(),
          },
          {
            text: "Open GitHub",
            onPress: () =>
              void Linking.openURL(
                authorization.verificationUriComplete ??
                  authorization.verificationUri,
              ),
          },
        ],
        { cancelable: false },
      );
      const githubCredential = await pollGithubDeviceToken(
        GITHUB_CLIENT_ID,
        authorization,
        { signal: authorizationAbort.signal },
      );
      const token = githubCredential.accessToken;
      const [identity, repositories] = await Promise.all([
        fetchGithubIdentity(token),
        listGithubRepositories(token),
      ]);
      const entry = await credentialVault.save({
        kind: "github-token",
        label: `GitHub — ${identity.login}`,
        secret: serializeGithubCredential(githubCredential),
      });
      const accessibleIds = new Set(repositories.map((repo) => repo.id));
      setSettings((prev) => {
        const current = activeAgent(prev);
        return {
          ...prev,
          gitPat: token,
          agents: prev.agents.map((profile) =>
            profile.id === current.id
              ? {
                  ...profile,
                  gitCredentialId: entry.id,
                  repositories: (profile.repositories ?? []).filter((repo) =>
                    accessibleIds.has(repo.id),
                  ),
                  runtime: {
                    ...(profile.runtime ?? {}),
                    repoUrl: "github.com",
                  },
                }
              : profile,
          ),
        };
      });
      setGithubRepositories(repositories);
      refreshCredentials();
      setConfigOk(true);
      setConfigMsg(`Connected GitHub as ${identity.login}.`);
    } catch (err) {
      setConfigOk(false);
      setConfigMsg(
        err instanceof Error ? err.message : "GitHub connection failed.",
      );
    } finally {
      setGithubBusy(false);
    }
  }

  function toggleRepository(repository: AttachedRepository) {
    const selected = agent.repositories ?? [];
    patchActiveAgent({
      repositories: selected.some((item) => item.id === repository.id)
        ? selected.filter((item) => item.id !== repository.id)
        : [...selected, repository],
    });
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

  async function saveModelCredential() {
    const secret = settings.modelKeys[selectedHarness.keyEnv] ?? "";
    if (!secret.trim()) {
      setConfigOk(false);
      setConfigMsg("Enter a model key before saving it to the library.");
      return;
    }
    const entry = await credentialVault.save({
      kind: "model-key",
      keyEnv: selectedHarness.keyEnv,
      label: modelCredentialLabel,
      secret,
    });
    await selectModelCredential(entry);
    setModelCredentialLabel("");
    refreshCredentials();
  }

  async function removeCredential(entry: CredentialEntry) {
    await credentialVault.remove(entry.id);
    if (activeAgent(settings).gitCredentialId === entry.id) {
      setGithubRepositories([]);
    }
    setSettings((prev) => ({
      ...prev,
      gitPat:
        activeAgent(prev).gitCredentialId === entry.id ? "" : prev.gitPat,
      modelKeys: Object.fromEntries(
        Object.entries(prev.modelKeys).filter(
          ([keyEnv]) =>
            activeAgent(prev).modelCredentialIds?.[keyEnv] !== entry.id,
        ),
      ),
      agents: prev.agents.map((profile) => ({
        ...profile,
        ...(profile.gitCredentialId === entry.id
          ? { gitCredentialId: undefined }
          : {}),
        modelCredentialIds: Object.fromEntries(
          Object.entries(profile.modelCredentialIds ?? {}).filter(
            ([, id]) => id !== entry.id,
          ),
        ),
      })),
    }));
    refreshCredentials();
  }

  useEffect(() => {
    if (!configMsg) return;
    const timer = setTimeout(() => {
      setConfigMsg("");
    }, 4_000);
    return () => clearTimeout(timer);
  }, [configMsg]);

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

  function gatewayConfigPatch(next: DeviceSettings = settings) {
    const profile = activeAgent(next);
    const nextRuntime = resolveAgentRuntimeSettings(profile, next);
    return {
      repo: {
        url: nextRuntime.repoUrl || "github.com",
        credential: "",
        repositories: profile.repositories ?? [],
        ...(nextRuntime.defaultBranch.trim()
          ? { defaultBranch: nextRuntime.defaultBranch.trim() }
          : {}),
      },
      harness: nextRuntime.harness,
      model: nextRuntime.model,
      effort: nextRuntime.effort,
      modelKeys: next.modelKeys,
      voice: {
        stopWord: nextRuntime.stopWord,
        ...(nextRuntime.voiceId.trim()
          ? { ttsVoiceId: nextRuntime.voiceId.trim() }
          : {}),
      },
    };
  }

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

  async function stopAgent(profile: AgentProfile) {
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
    } catch (err) {
      patchAgent(profile.id, { desiredState: "running" });
      setConfigOk(false);
      setConfigMsg(err instanceof Error ? err.message : "Could not end session.");
    } finally {
      setLifecycleBusyAgentId(null);
    }
  }

  async function startAgent(profile: AgentProfile) {
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
      await saveConfig(
        connectionFor(profile, settings.userId),
        gatewayConfigPatch(),
      );
      if (!provider) {
        patchAgent(profile.id, { desiredState: "running" });
      }
    } catch (err) {
      setConfigOk(false);
      setConfigMsg(
        err instanceof Error ? err.message : "Could not start a new session.",
      );
    } finally {
      setLifecycleBusyAgentId(null);
    }
  }

  async function replaceAgent(profile: AgentProfile) {
    setLifecycleBusyAgentId(profile.id);
    try {
      const provider = providerRegistry.forProfile(profile);
      if (!provider?.replaceAgent) {
        throw new Error("This provider cannot replace a removed deployment.");
      }
      const replacement = await provider.replaceAgent(profile);
      await saveConfig(
        {
          ...connectionFor(profile, settings.userId),
          gatewayUrl: replacement.gatewayUrl,
        },
        gatewayConfigPatch(),
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

  function toggleAgentLifecycle(profile: AgentProfile) {
    const desiredState = profile.desiredState ?? "running";
    if (desiredState === "stopped") {
      void startAgent(profile);
      return;
    }
    const managed = sessions[profile.id] ?? EMPTY_SESSION;
    const run = () => void stopAgent(profile);
    if (!managed.working && !managed.speaking) {
      run();
      return;
    }
    Alert.alert(
      "End this session?",
      "The current instance will be destroyed. Uncommitted and unpushed work will be lost.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "End session", style: "destructive", onPress: run },
      ],
    );
  }

  const activeDisplayState = agentDisplayState(agent, session);
  const firstLaunch = isBlankDefaultProfile(settings.agents);
  const talkState = resolveTalkState(
    activeDisplayState,
    session.speaking,
    session.working,
    pttHeld,
  );
  const editingAgent =
    settings.agents.find((profile) => profile.id === editingAgentId) ?? null;
  const editingSession = editingAgent
    ? sessions[editingAgent.id] ?? EMPTY_SESSION
    : EMPTY_SESSION;
  const editingProvider = editingAgent
    ? providerRegistry.forProfile(editingAgent)
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
      <Card>
        <Field
          label={`${selectedHarness.label} API key`}
          value={settings.modelKeys[selectedHarness.keyEnv] ?? ""}
          onChange={(v) =>
            setSettings((prev) => ({
              ...prev,
              modelKeys: {
                ...prev.modelKeys,
                [selectedHarness.keyEnv]: v,
              },
            }))
          }
          secure
          autoCapitalize="none"
          hint={`Used by ${selectedHarness.label} in this agent's session.`}
        />
        <Field
          label="Saved key name"
          value={modelCredentialLabel}
          onChange={setModelCredentialLabel}
          placeholder={`${selectedHarness.label} — personal`}
        />
        <Button
          tone="neutral"
          label="Save key on this device"
          onPress={() => void saveModelCredential()}
        />
        <CredentialPicker
          entries={credentials.filter(
            (entry) =>
              entry.kind === "model-key" &&
              entry.keyEnv === selectedHarness.keyEnv,
          )}
          selectedId={agent.modelCredentialIds?.[selectedHarness.keyEnv]}
          onSelect={(entry) => void selectModelCredential(entry)}
          onRemove={(entry) => void removeCredential(entry)}
          emptyLabel={`No saved ${selectedHarness.label} keys yet.`}
        />
      </Card>

      <SectionLabel icon={<LinkIcon size={13} color={color.textMuted} />}>
        Code and repositories
      </SectionLabel>
      <Card>
        <Button
          tone={selectedGitCredential ? "neutral" : "primary"}
          busy={githubBusy}
          label={
            githubBusy
              ? "Waiting for GitHub…"
              : selectedGitCredential?.kind === "github-token"
                ? selectedGitCredential.label
                : "Connect GitHub"
          }
          onPress={() => void connectGithub()}
        />
        <CredentialPicker
          entries={credentials.filter(
            (entry) =>
              entry.kind === "github-token" || entry.kind === "git-pat",
          )}
          selectedId={agent.gitCredentialId}
          onSelect={(entry) => void selectGitCredential(entry)}
          onRemove={(entry) => void removeCredential(entry)}
          emptyLabel="No GitHub accounts connected."
        />
        <View style={styles.repositoryHeader}>
          <Text style={styles.repositoryCount}>
            {(agent.repositories ?? []).length} selected
          </Text>
          <Button
            tone="ghost"
            busy={githubBusy}
            disabled={!settings.gitPat}
            label="Refresh"
            onPress={() => void loadGithubRepositories()}
          />
        </View>
        {GITHUB_APP_SLUG ? (
          <Button
            tone="ghost"
            label="Manage GitHub repository access"
            onPress={() =>
              void Linking.openURL(
                `https://github.com/apps/${encodeURIComponent(
                  GITHUB_APP_SLUG,
                )}/installations/new`,
              )
            }
          />
        ) : null}
        {githubRepositories.length > 0 ? (
          <Field
            label="Filter repositories"
            value={githubSearch}
            onChange={setGithubSearch}
            autoCapitalize="none"
            placeholder="owner or repository"
          />
        ) : null}
        {githubRepositories.length > 0 ? (
          <View style={styles.repositoryList}>
            {visibleGithubRepositories.map((repository) => {
              const selected = (agent.repositories ?? []).some(
                (item) => item.id === repository.id,
              );
              return (
                <Pressable
                  key={repository.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  onPress={() => toggleRepository(repository)}
                  style={[
                    styles.repositoryRow,
                    selected && styles.repositoryRowSelected,
                  ]}
                >
                  <View style={styles.repositoryText}>
                    <Text
                      style={[
                        styles.repositoryName,
                        selected && styles.repositoryNameSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {repository.fullName}
                    </Text>
                    <Text style={styles.repositoryVisibility}>
                      {repository.private ? "Private" : "Public"}
                    </Text>
                  </View>
                  {selected ? (
                    <CheckIcon size={15} color={color.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={styles.note}>
            {selectedGitCredential
              ? "No repositories returned. Grant repository access, then refresh."
              : "Connect GitHub to choose the repositories prepared for this agent."}
          </Text>
        )}
        <Text style={styles.note}>
          Repository changes apply the next time you start a session.
        </Text>
        {!GITHUB_CLIENT_ID ? (
          <Text style={styles.githubConfigWarning}>
            This app build is missing its GitHub OAuth client ID.
          </Text>
        ) : null}
      </Card>

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
      {settings.agents.map((profile) => (
        <VoiceSessionController
          key={profile.id}
          profile={profile}
          userId={settings.userId}
          focused={profile.id === settings.activeAgentId}
          mode={mode}
          lifecycleBusy={lifecycleBusyAgentId === profile.id}
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
          running={(editingAgent.desiredState ?? "running") === "running"}
          gone={editingTrayItem.status === "gone"}
          lifecycleBusy={lifecycleBusyAgentId === editingAgent.id}
          removing={removingAgentId === editingAgent.id}
          configuration={agentConfiguration}
          onNameChange={(name) => patchAgent(editingAgent.id, { name })}
          onGatewayUrlChange={(gatewayUrl) =>
            patchAgent(editingAgent.id, { gatewayUrl })
          }
          onTokenChange={(token) => patchAgent(editingAgent.id, { token })}
          onLifecycle={() => toggleAgentLifecycle(editingAgent)}
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

      {configMsg ? <Toast message={configMsg} ok={configOk} /> : null}

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

          {session.working || session.speaking ? (
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
    </View>
  );
}

function CredentialPicker({
  entries,
  selectedId,
  onSelect,
  onRemove,
  emptyLabel,
}: {
  entries: CredentialEntry[];
  selectedId?: string;
  onSelect: (entry: CredentialEntry) => void;
  onRemove: (entry: CredentialEntry) => void;
  emptyLabel: string;
}) {
  if (entries.length === 0) {
    return <Text style={styles.note}>{emptyLabel}</Text>;
  }
  return (
    <View style={styles.credentialList}>
      {entries.map((entry) => {
        const selected = entry.id === selectedId;
        return (
          <Pressable
            key={entry.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={entry.label}
            onPress={() => onSelect(entry)}
            style={[
              styles.credentialRow,
              selected && styles.credentialRowActive,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.credentialName,
                selected && styles.credentialNameActive,
              ]}
            >
              {entry.label}
            </Text>
            {selected ? <CheckIcon size={14} color={color.accent} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete ${entry.label}`}
              hitSlop={8}
              onPress={() => onRemove(entry)}
              style={styles.agentDelete}
            >
              <TrashIcon size={15} color={color.danger} />
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}

function VoiceSessionController({
  profile,
  userId,
  focused,
  mode,
  lifecycleBusy,
  onChange,
}: {
  profile: AgentProfile;
  userId: string;
  focused: boolean;
  mode: VoiceMode;
  lifecycleBusy: boolean;
  onChange: (id: string, session: ManagedSession) => void;
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
  const session = useVoiceSession(conn, {
    profileId: profile.id,
    focused,
    managedHost: profile.origin?.kind === "provider",
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
      session.harness,
      session.lastError,
      session.pttEnd,
      session.pttStart,
      session.provisioning,
      session.speaking,
      session.status,
      session.working,
    ],
  );

  useEffect(() => {
    onChange(profile.id, managed);
  }, [managed, onChange, profile.id]);

  useEffect(() => {
    const shouldRun =
      (profile.desiredState ?? "running") === "running" &&
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
    session.availability,
    session.connect,
    session.disconnect,
    session.lastError,
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

function resolveTalkState(
  displayState: AgentTrayItem["status"],
  speaking: boolean,
  working: boolean,
  held: boolean,
): TalkState {
  if (held) return "capturing";
  if (speaking) return "speaking";
  if (displayState === "needs-setup") return "needs-setup";
  if (displayState === "stopped") return "stopped";
  if (displayState === "starting") return "starting";
  if (displayState === "gone") return "gone";
  if (displayState === "unreachable" || displayState === "error") {
    return "unreachable";
  }
  if (working) return "working";
  return "idle";
}

function provisioningLabel(
  state: NonNullable<ManagedSession["provisioning"]>,
): string {
  if (state.stage === "cloning") {
    const count =
      state.index !== undefined && state.total > 0
        ? ` (${state.index} of ${state.total})`
        : "";
    return `Cloning ${state.repository ?? "repository"}${count}`;
  }
  if (state.stage === "starting_harness") return "Starting agent runtime";
  return state.total > 0
    ? `Preparing ${state.total} repositories`
    : "Preparing empty workspace";
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
  const repositoryCount = profile.repositories?.length ?? 0;
  const repositories =
    repositoryCount > 0
      ? ` · ${repositoryCount} repo${repositoryCount === 1 ? "" : "s"}`
      : "";
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
  agentDelete: {
    padding: space.xs,
  },
  credentialList: {
    gap: space.sm,
    marginTop: space.md,
  },
  credentialRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  credentialRowActive: {
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  credentialName: {
    flex: 1,
    color: color.textMuted,
    fontSize: font.caption,
    fontWeight: "700",
  },
  credentialNameActive: {
    color: color.text,
  },
  repositoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.md,
  },
  repositoryCount: {
    color: color.textMuted,
    fontSize: font.caption,
    fontWeight: "700",
  },
  repositoryList: {
    gap: space.sm,
    marginTop: space.sm,
  },
  repositoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surfaceRaised,
  },
  repositoryRowSelected: {
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  repositoryText: {
    flex: 1,
  },
  repositoryName: {
    color: color.textMuted,
    fontSize: font.caption,
    fontWeight: "700",
  },
  repositoryNameSelected: {
    color: color.text,
  },
  repositoryVisibility: {
    color: color.textDim,
    fontSize: font.micro,
    marginTop: 2,
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
