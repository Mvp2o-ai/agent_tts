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
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  fetchConfig,
  killSession,
  resetSession,
  saveConfig,
  type HarnessId,
} from "./src/api";
import type { CredentialEntry } from "./src/credential-vault";
import { normalizeGatewayUrl } from "./src/protocol";
import { credentialVault } from "./src/secure-credential-vault";
import {
  activeAgent,
  HARNESSES,
  type AgentProfile,
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
  const [gitCredentialLabel, setGitCredentialLabel] = useState("");
  const [modelCredentialLabel, setModelCredentialLabel] = useState("");
  const [legacySecretsMigrated, setLegacySecretsMigrated] = useState(false);
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
    setSettings((prev) => ({ ...prev, activeAgentId: id }));
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
        ? await credentialVault.getSecret(profile.gitCredentialId)
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
    const secret = await credentialVault.getSecret(entry.id);
    if (secret == null) return;
    patch({ gitPat: secret });
    patchActiveAgent({ gitCredentialId: entry.id });
  }

  async function saveGitCredential() {
    if (!settings.gitPat.trim()) {
      setConfigOk(false);
      setConfigMsg("Enter a Git PAT before saving it to the library.");
      return;
    }
    const entry = await credentialVault.save({
      kind: "git-pat",
      label: gitCredentialLabel,
      secret: settings.gitPat,
    });
    patchActiveAgent({ gitCredentialId: entry.id });
    setGitCredentialLabel("");
    refreshCredentials();
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

  async function onLoadConfig() {
    setConfigAction("load");
    setConfigBusy(true);
    setConfigMsg("");
    try {
      const cfg = await fetchConfig(conn);
      setSettings((prev) => ({
        ...prev,
        repoUrl: cfg.repo.url,
        gitPat: cfg.repo.credential,
        defaultBranch: cfg.repo.defaultBranch ?? "",
        harness: cfg.harness,
        modelKeys: cfg.modelKeys,
        stopWord: cfg.voice.stopWord,
        voiceId: cfg.voice.ttsVoiceId ?? "",
      }));
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
      await saveConfig(conn, {
        repo: {
          url: settings.repoUrl,
          credential: settings.gitPat,
          ...(settings.defaultBranch.trim()
            ? { defaultBranch: settings.defaultBranch.trim() }
            : {}),
        },
        harness: settings.harness,
        modelKeys: settings.modelKeys,
        voice: {
          stopWord: settings.stopWord,
          ...(settings.voiceId.trim()
            ? { ttsVoiceId: settings.voiceId.trim() }
            : {}),
        },
      });
      setConfigOk(true);
      setConfigMsg("Saved to gateway. Connection fields stay on this device.");
    } catch (err) {
      setConfigOk(false);
      setConfigMsg(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setConfigBusy(false);
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
              session.disconnect();
              try {
                const result = await resetSession(conn);
                setConfigOk(true);
                setConfigMsg(
                  result.restarting
                    ? "Agent is restarting fresh. Reconnect shortly."
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
            {describeTarget(settings, session.harness)}
          </Text>
        </View>
        <StatusPill
          label={statusLabel(session.status, session.speaking)}
          tone={statusTone(session.status, session.speaking)}
          pulsing={session.status === "connecting" || session.speaking}
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
              else session.connect(mode);
            }}
          />

          <View style={styles.actionRow}>
            <Button
              style={styles.actionItem}
              tone="ghost"
              label="Stop"
              accessibilityHint="Aborts the current turn without closing the session."
              disabled={!connected}
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
              Git access
            </SectionLabel>
            <Card>
              <Field
                label="Git PAT"
                value={settings.gitPat}
                onChange={(v) => patch({ gitPat: v })}
                secure
                autoCapitalize="none"
                hint="Fine-grained token for the repos you will name by voice. Contents + Pull requests (read/write), short expiry. The workspace starts empty — tell the agent which remotes to clone."
              />
              <Field
                label="Credential label"
                value={gitCredentialLabel}
                onChange={setGitCredentialLabel}
                placeholder="github.com — ken"
              />
              <Button
                tone="neutral"
                label="Save PAT to device library"
                onPress={() => void saveGitCredential()}
              />
              <CredentialPicker
                entries={credentials.filter((entry) => entry.kind === "git-pat")}
                selectedId={agent.gitCredentialId}
                onSelect={(entry) => void selectGitCredential(entry)}
                onRemove={(entry) => void removeCredential(entry)}
                emptyLabel="No saved PATs yet."
              />
              <Field
                label="Git host"
                value={settings.repoUrl}
                onChange={(v) => patch({ repoUrl: v })}
                autoCapitalize="none"
                mono
                placeholder="github.com"
                hint="Scopes git and gh auth to this host. The gateway never clones."
              />
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
                    onPress={() => patch({ harness: h.id as HarnessId })}
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
  const session = useVoiceSession(conn, { profileId: profile.id, focused });
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

function statusLabel(status: string, speaking: boolean): string {
  if (speaking) return "Speaking";
  if (status === "ready") return "Live";
  if (status === "connecting") return "Connecting";
  return "Offline";
}

function statusTone(
  status: string,
  speaking: boolean,
): "idle" | "busy" | "live" | "error" {
  if (speaking || status === "ready") return "live";
  if (status === "connecting") return "busy";
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
  return color.textDim;
}

function describeTarget(settings: DeviceSettings, connectedHarness: string): string {
  const agent = activeAgent(settings);
  const name = sessionDisplayName(
    agent,
    connectedHarness || settings.harness,
  );
  const host = agent.gatewayUrl
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/+$/, "");
  return host ? `${name} · ${host}` : name;
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
  feed: {
    flex: 1,
    marginTop: space.xs,
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
