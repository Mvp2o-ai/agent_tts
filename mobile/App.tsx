import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { fetchConfig, killSession, saveConfig, type HarnessId } from "./src/api";
import { normalizeGatewayUrl } from "./src/protocol";
import { HARNESSES, type DeviceSettings } from "./src/settings";
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

  const conn = useMemo(
    () => ({
      gatewayUrl: normalizeGatewayUrl(settings.gatewayUrl),
      token: settings.token,
      userId: settings.userId,
    }),
    [settings.gatewayUrl, settings.token, settings.userId],
  );

  const session = useVoiceSession(conn);
  const connected = session.status !== "disconnected";

  const selectedHarness =
    HARNESSES.find((h) => h.id === settings.harness) ?? HARNESSES[0]!;

  const patch = (partial: Partial<DeviceSettings>) =>
    setSettings((prev) => ({ ...prev, ...partial }));

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
      "This aborts the harness and force-removes its Docker container. Uncommitted work in that box is lost.",
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
                    ? `Killed ${result.killed} container${result.killed === 1 ? "" : "s"}.`
                    : "Session torn down. No leftover containers.",
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

  const talkState = resolveTalkState(session.status, session.speaking, pttHeld);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.wordmark}>agent_tts</Text>
          <Text style={styles.tagline}>{describeTarget(settings)}</Text>
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
              tone="danger"
              label="Kill session"
              accessibilityHint="Force-removes the agent's Docker container."
              icon={<TrashIcon size={16} color={color.danger} />}
              onPress={onKillSession}
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
              Gateway
            </SectionLabel>
            <Card>
              <Field
                label="Gateway URL"
                value={settings.gatewayUrl}
                onChange={(v) => patch({ gatewayUrl: v })}
                autoCapitalize="none"
                mono
                placeholder="https://your-host.example.com"
              />
              <Field
                label="Gateway token"
                value={settings.token}
                onChange={(v) => patch({ token: v })}
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

function describeTarget(settings: DeviceSettings): string {
  const harness =
    HARNESSES.find((h) => h.id === settings.harness)?.label ?? "no harness";
  const host = settings.gatewayUrl
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/+$/, "");
  return host ? `${harness} · ${host}` : harness;
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
