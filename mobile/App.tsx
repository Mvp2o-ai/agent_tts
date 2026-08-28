import { StatusBar } from "expo-status-bar";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  fetchConfig,
  fetchModelCatalog,
  killSession,
  resetSession,
  saveConfig,
  type ModelCatalog,
} from "./src/api";
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
import {
  credentialVault,
  githubAccessToken,
} from "./src/secure-credential-vault";
import {
  activeAgent,
  HARNESSES,
  withHarness,
  type AgentProfile,
  type AttachedRepository,
  type DeviceSettings,
} from "./src/settings";
import { useDeviceSettings } from "./src/useDeviceSettings";
import { useVoiceSession, type VoiceMode } from "./src/useVoiceSession";
import {
  Button,
  Card,
  Field,
  SectionLabel,
  Segmented,
  StatusPill,
  Toast,
} from "./src/ui/components";
import {
  CheckIcon,
  DownloadIcon,
  GearIcon,
  LinkIcon,
  MicIcon,
  PowerIcon,
  StopIcon,
  TrashIcon,
  UploadIcon,
  WaveIcon,
} from "./src/ui/icons";
import { TalkButton, type TalkState } from "./src/ui/TalkButton";
import { Transcript } from "./src/ui/Transcript";
import { color, font, inset, radius, space } from "./src/ui/theme";

type Tab = "talk" | "settings";
type ManagedSession = ReturnType<typeof useVoiceSession>;

const EMPTY_SESSION: ManagedSession = {
  status: "disconnected",
  events: [],
  speaking: false,
  working: false,
  harness: "",
  generationId: "",
  provisioning: null,
  connect: () => undefined,
  disconnect: () => undefined,
  pttStart: () => undefined,
  pttEnd: () => undefined,
  abort: () => undefined,
};

export default function App() {
  const [tab, setTab] = useState<Tab>("talk");
  const [mode, setMode] = useState<VoiceMode>("ptt");
  const [pttHeld, setPttHeld] = useState(false);
  const { settings, setSettings, hydrated } = useDeviceSettings();
  const [configMsg, setConfigMsg] = useState("");
  const [configOk, setConfigOk] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [configAction, setConfigAction] = useState<"load" | "save" | null>(
    null,
  );
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
  const migrationStartedRef = useRef(false);

  const agent = activeAgent(settings);
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
  const connected = session.status !== "disconnected";

  const selectedHarness =
    HARNESSES.find((h) => h.id === settings.harness) ?? HARNESSES[0]!;
  const activeModelLabel = resolveModelLabel(modelCatalog, settings.model);
  const selectedGitCredential = credentials.find(
    (entry) => entry.id === agent.gitCredentialId,
  );
  const visibleGithubRepositories = githubRepositories.filter((repository) =>
    repository.fullName.toLowerCase().includes(githubSearch.trim().toLowerCase()),
  );

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
    const id = `agent-${Date.now()}`;
    const projectNumber =
      settings.agents.reduce((max, profile) => {
        const match = /^Project (\d+)$/i.exec(profile.name.trim());
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1;
    const profile: AgentProfile = {
      id,
      name: `Project ${projectNumber}`,
      gatewayUrl: "http://",
      token: "",
    };
    setSettings((prev) => ({
      ...prev,
      agents: [...prev.agents, profile],
      activeAgentId: id,
    }));
  };

  const removeAgent = (id: string) =>
    setSettings((prev) => {
      if (prev.agents.length <= 1) return prev;
      const agents = prev.agents.filter((a) => a.id !== id);
      const activeAgentId =
        prev.activeAgentId === id ||
        !agents.some((a) => a.id === prev.activeAgentId)
          ? agents[0]!.id
          : prev.activeAgentId;
      return { ...prev, agents, activeAgentId };
    });

  const refreshCredentials = useCallback(() => {
    void credentialVault.list().then(setCredentials);
  }, []);

  useEffect(() => {
    refreshCredentials();
  }, [refreshCredentials]);

  useEffect(() => {
    if (!hydrated || migrationStartedRef.current) return;
    migrationStartedRef.current = true;
    void (async () => {
      const current = activeAgent(settings);
      const profilePatch: Partial<AgentProfile> = {};
      const imported: CredentialEntry[] = [];

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

      if (Object.keys(profilePatch).length > 0) {
        setSettings((prev) => ({
          ...prev,
          agents: prev.agents.map((profile) =>
            profile.id === current.id ? { ...profile, ...profilePatch } : profile,
          ),
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
      setSettings((prev) =>
        prev.activeAgentId === profile.id
          ? { ...prev, gitPat: gitPat ?? "", modelKeys }
          : prev,
      );
    })();
    return () => {
      current = false;
    };
  }, [
    agent.gitCredentialId,
    agent.id,
    agent.modelCredentialIds,
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
      patch({ gitPat: token, repoUrl: "github.com" });
      const accessibleIds = new Set(repositories.map((repo) => repo.id));
      patchActiveAgent({
        gitCredentialId: entry.id,
        repositories: (agent.repositories ?? []).filter((repo) =>
          accessibleIds.has(repo.id),
        ),
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
      setConfigAction(null);
    }, 4_000);
    return () => clearTimeout(timer);
  }, [configMsg]);

  useEffect(() => {
    if (connectionError(conn)) {
      setModelCatalog(null);
      return;
    }
    let cancelled = false;
    setModelCatalog(null);
    void fetchModelCatalog(conn.gatewayUrl, conn.token, settings.harness)
      .then((catalog) => {
        if (cancelled) return;
        if (catalog.harness !== settings.harness) return;
        setModelCatalog(catalog);
      })
      .catch(() => {
        if (!cancelled) setModelCatalog(null);
      });
    return () => {
      cancelled = true;
    };
  }, [conn, settings.harness]);

  async function onLoadConfig() {
    setConfigAction("load");
    setConfigBusy(true);
    setConfigMsg("");
    try {
      const cfg = await fetchConfig(conn);
      const repositories = cfg.repo.repositories ?? [];
      setSettings((prev) => ({
        ...prev,
        repoUrl: cfg.repo.url,
        defaultBranch: cfg.repo.defaultBranch ?? "",
        harness: cfg.harness,
        model: cfg.model ?? "",
        effort: cfg.effort ?? "",
        modelKeys: cfg.modelKeys,
        stopWord: cfg.voice.stopWord,
        voiceId: cfg.voice.ttsVoiceId ?? "",
      }));
      patchActiveAgent({ repositories });
      setGithubRepositories((current) => {
        const byId = new Map(current.map((repo) => [repo.id, repo]));
        for (const repo of repositories) byId.set(repo.id, repo);
        return [...byId.values()];
      });
      setConfigOk(true);
      setConfigMsg("Loaded from gateway.");
    } catch (err) {
      setConfigOk(false);
      setConfigMsg(err instanceof Error ? err.message : "Load failed.");
    } finally {
      setConfigBusy(false);
    }
  }

  async function onSaveConfig() {
    setConfigAction("save");
    setConfigBusy(true);
    setConfigMsg("");
    try {
      await saveConfig(conn, gatewayConfigPatch());
      setConfigOk(true);
      setConfigMsg("Saved to gateway. Connection fields stay on this device.");
    } catch (err) {
      setConfigOk(false);
      setConfigMsg(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setConfigBusy(false);
    }
  }

  function gatewayConfigPatch(next: DeviceSettings = settings) {
    const profile = activeAgent(next);
    return {
      repo: {
        url: next.repoUrl || "github.com",
        credential: "",
        repositories: profile.repositories ?? [],
        ...(next.defaultBranch.trim()
          ? { defaultBranch: next.defaultBranch.trim() }
          : {}),
      },
      harness: next.harness,
      model: next.model,
      effort: next.effort,
      modelKeys: next.modelKeys,
      voice: {
        stopWord: next.stopWord,
        ...(next.voiceId.trim()
          ? { ttsVoiceId: next.voiceId.trim() }
          : {}),
      },
    };
  }

  function selectModelOverride(id: string) {
    const efforts = catalogModelEfforts(modelCatalog, id);
    const effort = efforts.includes(settings.effort) ? settings.effort : "";
    if (settings.model === id && settings.effort === effort) return;
    const next = { ...settings, model: id, effort };
    setSettings(next);
    void persistModelSelection(next);
  }

  function selectEffortOverride(id: string) {
    if (settings.effort === id) return;
    const next = { ...settings, effort: id };
    setSettings(next);
    void persistModelSelection(next);
  }

  async function persistModelSelection(next: DeviceSettings) {
    try {
      await saveConfig(conn, gatewayConfigPatch(next));
    } catch (err) {
      setConfigOk(false);
      setConfigMsg(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function connectActiveSession() {
    try {
      await saveConfig(conn, gatewayConfigPatch());
      session.connect(mode);
    } catch (err) {
      setConfigOk(false);
      setConfigMsg(
        err instanceof Error ? err.message : "Could not prepare the agent.",
      );
      setTab("settings");
    }
  }

  function onKillSession() {
    Alert.alert(
      "Kill agent session?",
      "This aborts the harness and stops its process. Uncommitted work in this session is lost.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Kill",
          style: "destructive",
          onPress: () => {
            void (async () => {
              session.abort();
              session.disconnect();
              try {
                const result = await killSession(conn);
                setConfigOk(true);
                setConfigMsg(
                  result.killed > 0
                    ? `Killed ${result.killed} session${result.killed === 1 ? "" : "s"}.`
                    : "Session torn down.",
                );
              } catch (err) {
                setConfigOk(false);
                setConfigMsg(
                  err instanceof Error ? err.message : "Kill failed.",
                );
              }
            })();
          },
        },
      ],
    );
  }

  function onNewSession() {
    Alert.alert(
      "New session?",
      "The agent container exits and is recreated fresh from its image: clean disk, clean memory, new git clone. Anything not pushed is lost. Reconnect in ~10–30s.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "New session",
          style: "destructive",
          onPress: () => {
            void (async () => {
              session.abort();
              try {
                await saveConfig(conn, gatewayConfigPatch());
                const result = await resetSession(conn);
                setConfigOk(true);
                setConfigMsg(
                  result.restarting
                    ? "Agent is restarting fresh. Reconnecting automatically."
                    : "Sessions closed; gateway did not restart (no onReset).",
                );
              } catch (err) {
                setConfigOk(false);
                setConfigMsg(
                  err instanceof Error ? err.message : "Reset failed.",
                );
              }
            })();
          },
        },
      ],
    );
  }

  const talkState = resolveTalkState(session.status, session.speaking, pttHeld);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {settings.agents.map((profile) => (
        <VoiceSessionController
          key={profile.id}
          profile={profile}
          userId={settings.userId}
          focused={profile.id === settings.activeAgentId}
          onChange={reportSession}
        />
      ))}

      <View style={styles.header}>
        <View>
          <Text style={styles.wordmark}>agent_tts</Text>
          <Text style={styles.tagline}>
            {describeTarget(settings, session.harness, activeModelLabel)}
          </Text>
        </View>
        <StatusPill
          label={statusLabel(session.status, session.speaking)}
          tone={statusTone(session.status, session.speaking)}
          pulsing={
            session.status === "connecting" ||
            session.status === "provisioning" ||
            session.speaking
          }
        />
      </View>

      {configMsg ? <Toast message={configMsg} ok={configOk} /> : null}

      {tab === "talk" ? (
        <View style={styles.screen}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sessionSwitcher}
            style={styles.sessionSwitcherScroll}
          >
            {settings.agents.map((profile) => {
              const profileSession = sessions[profile.id] ?? EMPTY_SESSION;
              const selected = profile.id === settings.activeAgentId;
              return (
                <Pressable
                  key={profile.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Switch to ${sessionDisplayName(
                    profile,
                    profileSession.harness || settings.harness,
                  )}`}
                  onPress={() => selectAgent(profile.id)}
                  style={[
                    styles.sessionChip,
                    selected && styles.sessionChipActive,
                  ]}
                >
                  <View
                    style={[
                      styles.sessionDot,
                      {
                        backgroundColor: sessionStatusColor(profileSession),
                      },
                    ]}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.sessionChipText,
                      selected && styles.sessionChipTextActive,
                    ]}
                  >
                    {sessionDisplayName(
                      profile,
                      profileSession.harness || settings.harness,
                    )}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Segmented<VoiceMode>
            value={mode}
            onChange={setMode}
            disabled={connected}
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

          {session.provisioning ? (
            <Card style={styles.provisioningCard}>
              <Text style={styles.provisioningTitle}>Preparing workspace</Text>
              <Text style={styles.provisioningDetail}>
                {provisioningLabel(session.provisioning)}
              </Text>
            </Card>
          ) : null}

          <TalkButton
            mode={mode}
            state={talkState}
            onPressIn={() => {
              setPttHeld(true);
              session.pttStart();
            }}
            onPressOut={() => {
              setPttHeld(false);
              session.pttEnd();
            }}
          />

          <Button
            tone={connected ? "neutral" : "primary"}
            label={connectLabel(session.status)}
            icon={
              <PowerIcon
                size={18}
                color={connected ? color.text : color.bg}
              />
            }
            onPress={() => {
              if (connected) session.disconnect();
              else void connectActiveSession();
            }}
          />

          <View style={styles.actionRow}>
            <Button
              style={styles.actionItem}
              tone="ghost"
              label="Stop"
              accessibilityHint="Aborts the current turn without closing the session."
              disabled={session.status !== "ready"}
              icon={<StopIcon size={15} color={color.textMuted} />}
              onPress={() => session.abort()}
            />
            <Button
              style={styles.actionItem}
              tone="ghost"
              label="Kill session"
              accessibilityHint="Aborts the harness and stops its process."
              icon={<StopIcon size={15} color={color.textMuted} />}
              onPress={onKillSession}
            />
            <Button
              style={styles.actionItem}
              tone="danger"
              label="New session"
              accessibilityHint="Restarts the agent container from a clean image."
              icon={<TrashIcon size={16} color={color.danger} />}
              onPress={onNewSession}
            />
          </View>

          {modelCatalog && modelCatalog.models.length > 0 ? (
            <ModelEffortPills
              catalog={modelCatalog}
              model={settings.model}
              effort={settings.effort}
              onSelectModel={selectModelOverride}
              onSelectEffort={selectEffortOverride}
            />
          ) : null}

          <View style={styles.feed}>
            <Transcript events={session.events} />
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.screen}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={inset.top}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.settingsContent}
          >
            <SectionLabel icon={<LinkIcon size={13} color={color.textMuted} />}>
              Agents
            </SectionLabel>
            <Card>
              <View style={styles.agentList}>
                {settings.agents.map((profile) => {
                  const selected = profile.id === settings.activeAgentId;
                  const canDelete = settings.agents.length > 1;
                  return (
                    <Pressable
                      key={profile.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={sessionDisplayName(
                        profile,
                        sessions[profile.id]?.harness || settings.harness,
                      )}
                      onPress={() => selectAgent(profile.id)}
                      style={[
                        styles.agentRow,
                        selected && styles.agentRowActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.agentRowName,
                          selected && styles.agentRowNameActive,
                        ]}
                        numberOfLines={1}
                      >
                        {sessionDisplayName(
                          profile,
                          sessions[profile.id]?.harness || settings.harness,
                        )}
                      </Text>
                      {selected ? (
                        <CheckIcon size={14} color={color.accent} />
                      ) : null}
                      {canDelete ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Delete ${profile.name}`}
                          hitSlop={8}
                          onPress={() => removeAgent(profile.id)}
                          style={styles.agentDelete}
                        >
                          <TrashIcon size={15} color={color.danger} />
                        </Pressable>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
              <Button
                tone="neutral"
                label="Add agent"
                onPress={addAgent}
                style={styles.agentAdd}
              />
              <Field
                label="Project name"
                value={agent.name}
                onChange={(v) => patchActiveAgent({ name: v })}
                placeholder="Project 1"
              />
              <Field
                label="Gateway URL"
                value={agent.gatewayUrl}
                onChange={(v) => patchActiveAgent({ gatewayUrl: v })}
                autoCapitalize="none"
                mono
                placeholder="https://your-host.example.com"
              />
              <Field
                label="Gateway token"
                value={agent.token}
                onChange={(v) => patchActiveAgent({ token: v })}
                secure
                autoCapitalize="none"
              />
              <Field
                label="User id"
                value={settings.userId}
                onChange={(v) => patch({ userId: v })}
                autoCapitalize="none"
                mono
                placeholder="default"
              />
              <Button
                tone="neutral"
                busy={configBusy && configAction === "load"}
                label={
                  configBusy && configAction === "load"
                    ? "Loading…"
                    : "Load config"
                }
                icon={<DownloadIcon size={17} color={color.text} />}
                onPress={() => void onLoadConfig()}
              />
              <Text style={styles.note}>
                {hydrated
                  ? "Connection fields stay on this device. Everything below is stored by the gateway."
                  : "Loading device settings…"}
              </Text>
            </Card>

            <SectionLabel icon={<LinkIcon size={13} color={color.textMuted} />}>
              GitHub repositories
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
                    ? "No repositories returned. Grant this GitHub App repository access, then refresh."
                    : "Connect GitHub to choose the repositories cloned into this container before voice becomes available."}
                </Text>
              )}
              <Text style={styles.note}>
                Selection applies to this agent. Save it, then start a new
                session to provision a fresh workspace.
              </Text>
              {!GITHUB_CLIENT_ID ? (
                <Text style={styles.githubConfigWarning}>
                  EXPO_PUBLIC_GITHUB_CLIENT_ID is missing from this app build.
                </Text>
              ) : null}
            </Card>

            <SectionLabel icon={<MicIcon size={13} color={color.textMuted} />}>
              Harness
            </SectionLabel>
            <View style={styles.harnessGrid}>
              {HARNESSES.map((h) => {
                const active = settings.harness === h.id;
                return (
                  <Pressable
                    key={h.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={h.label}
                    onPress={() =>
                      setSettings((prev) => withHarness(prev, h.id))
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
                      {active ? (
                        <CheckIcon size={14} color={color.accent} />
                      ) : null}
                    </View>
                    <Text style={styles.harnessEnv}>{h.keyEnv}</Text>
                  </Pressable>
                );
              })}
            </View>
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
                hint={`Sent to the box as ${selectedHarness.keyEnv}.`}
              />
              <Field
                label="Key label"
                value={modelCredentialLabel}
                onChange={setModelCredentialLabel}
                placeholder={`${selectedHarness.label} — personal`}
              />
              <Button
                tone="neutral"
                label="Save key to device library"
                onPress={() => void saveModelCredential()}
              />
              <CredentialPicker
                entries={credentials.filter(
                  (entry) =>
                    entry.kind === "model-key" &&
                    entry.keyEnv === selectedHarness.keyEnv,
                )}
                selectedId={
                  agent.modelCredentialIds?.[selectedHarness.keyEnv]
                }
                onSelect={(entry) => void selectModelCredential(entry)}
                onRemove={(entry) => void removeCredential(entry)}
                emptyLabel={`No saved ${selectedHarness.label} keys yet.`}
              />
            </Card>

            <SectionLabel icon={<WaveIcon size={13} color={color.textMuted} />}>
              Voice
            </SectionLabel>
            <Card>
              <Field
                label="Stop word"
                value={settings.stopWord}
                onChange={(v) => patch({ stopWord: v })}
                placeholder="hard stop"
                hint="Say this at any time to abort the current turn."
              />
              <Field
                label="ElevenLabs voice id"
                value={settings.voiceId}
                onChange={(v) => patch({ voiceId: v })}
                autoCapitalize="none"
                mono
                placeholder="Gateway default"
              />
            </Card>
          </ScrollView>

          <View style={styles.saveBar}>
            <Button
              tone="primary"
              busy={configBusy && configAction === "save"}
              label={
                configBusy && configAction === "save"
                  ? "Saving…"
                  : "Save to gateway"
              }
              icon={<UploadIcon size={18} color={color.bg} />}
              onPress={() => void onSaveConfig()}
            />
          </View>
        </KeyboardAvoidingView>
      )}

      <View style={styles.tabBar}>
        <TabItem
          label="Talk"
          active={tab === "talk"}
          onPress={() => setTab("talk")}
          icon={
            <MicIcon
              size={22}
              color={tab === "talk" ? color.accent : color.textDim}
            />
          }
        />
        <TabItem
          label="Settings"
          active={tab === "settings"}
          onPress={() => setTab("settings")}
          icon={
            <GearIcon
              size={22}
              color={tab === "settings" ? color.accent : color.textDim}
            />
          }
        />
      </View>
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
  onChange,
}: {
  profile: AgentProfile;
  userId: string;
  focused: boolean;
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
    getGitCredential,
  });
  const managed = useMemo<ManagedSession>(
    () => ({ ...session }),
    [
      session.abort,
      session.connect,
      session.disconnect,
      session.events,
      session.generationId,
      session.harness,
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

  return null;
}

function TabItem({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.tabItem}
    >
      {icon}
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function resolveTalkState(
  status: string,
  speaking: boolean,
  held: boolean,
): TalkState {
  if (status !== "ready") return "offline";
  if (held) return "capturing";
  if (speaking) return "speaking";
  return "idle";
}

function connectLabel(status: string): string {
  if (status === "disconnected") return "Connect";
  if (status === "connecting") return "Cancel";
  return "Disconnect";
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
  if (state.stage === "starting_harness") return "Starting coding agent";
  return state.total > 0
    ? `Preparing ${state.total} repositories`
    : "Preparing empty workspace";
}

function statusLabel(status: string, speaking: boolean): string {
  if (speaking) return "Speaking";
  if (status === "ready") return "Live";
  if (status === "connecting") return "Connecting";
  if (status === "provisioning") return "Provisioning";
  return "Offline";
}

function statusTone(
  status: string,
  speaking: boolean,
): "idle" | "busy" | "live" | "error" {
  if (speaking || status === "ready") return "live";
  if (status === "connecting") return "busy";
  if (status === "provisioning") return "busy";
  return "idle";
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
  return `${harnessPrefix(harness)} · ${profile.name.trim() || "Project"}`;
}

function sessionStatusColor(session: ManagedSession): string {
  if (session.speaking) return color.accent;
  if (session.working) return color.warn;
  if (session.status === "ready") return color.live;
  if (session.status === "connecting") return color.textMuted;
  if (session.status === "provisioning") return color.warn;
  return color.textDim;
}

function describeTarget(
  settings: DeviceSettings,
  connectedHarness: string,
  modelLabel = "",
): string {
  const agent = activeAgent(settings);
  const name = sessionDisplayName(
    agent,
    connectedHarness || settings.harness,
  );
  const named = modelLabel ? `${name} — ${modelLabel}` : name;
  const host = agent.gatewayUrl
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/+$/, "");
  return host ? `${named} · ${host}` : named;
}

function resolveModelLabel(
  catalog: ModelCatalog | null,
  modelId: string,
): string {
  if (!catalog) return "";
  if (modelId) {
    return catalog.models.find((model) => model.id === modelId)?.label ?? "";
  }
  return catalog.models.find((model) => model.default)?.label ?? "";
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
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  wordmark: {
    color: color.text,
    fontSize: font.display - 6,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  tagline: {
    color: color.textDim,
    fontSize: font.caption,
    marginTop: 2,
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
  actionRow: {
    flexDirection: "row",
    gap: space.md,
  },
  actionItem: {
    flex: 1,
  },
  provisioningCard: {
    borderColor: color.warn,
  },
  provisioningTitle: {
    color: color.text,
    fontSize: font.label,
    fontWeight: "700",
  },
  provisioningDetail: {
    color: color.textMuted,
    fontSize: font.caption,
    marginTop: space.xs,
  },
  feed: {
    flex: 1,
    marginTop: space.xs,
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
  settingsContent: {
    paddingBottom: space.xl,
  },
  agentList: {
    gap: space.sm,
    marginBottom: space.md,
  },
  agentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  agentRowActive: {
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  agentRowName: {
    flex: 1,
    color: color.textMuted,
    fontSize: font.label,
    fontWeight: "700",
  },
  agentRowNameActive: {
    color: color.text,
  },
  agentDelete: {
    padding: space.xs,
  },
  agentAdd: {
    marginBottom: space.md,
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
  saveBar: {
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bgElevated,
    paddingTop: space.md,
    paddingBottom: inset.bottom,
    paddingHorizontal: space.lg,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    gap: 5,
  },
  tabLabel: {
    color: color.textDim,
    fontSize: font.micro,
    fontWeight: "600",
  },
  tabLabelActive: {
    color: color.accent,
  },
});
