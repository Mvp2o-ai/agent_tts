import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from "react-native";
import { fetchConfig, saveConfig, type HarnessId } from "./src/api";
import { normalizeGatewayUrl } from "./src/protocol";
import { HARNESSES, type DeviceSettings } from "./src/settings";
import { useDeviceSettings } from "./src/useDeviceSettings";
import {
  useVoiceSession,
  type SessionEvent,
  type VoiceMode,
} from "./src/useVoiceSession";

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
  const listRef = useRef<FlatList<SessionEvent>>(null);

  const selectedHarness =
    HARNESSES.find((h) => h.id === settings.harness) ?? HARNESSES[0]!;

  const patch = (partial: Partial<DeviceSettings>) =>
    setSettings((prev) => ({ ...prev, ...partial }));

  const renderEvent: ListRenderItem<SessionEvent> = ({ item }) => (
    <View style={styles.eventRow}>
      <Text style={[styles.eventKind, kindStyle(item.kind)]}>{item.kind}</Text>
      <Text style={styles.eventText}>{item.text}</Text>
    </View>
  );

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

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>agent_tts</Text>
        <Text style={styles.status}>
          {session.status}
          {session.speaking ? " · speaking" : ""}
        </Text>
      </View>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, tab === "talk" && styles.tabActive]}
          onPress={() => setTab("talk")}
        >
          <Text style={[styles.tabLabel, tab === "talk" && styles.tabLabelActive]}>
            Talk
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === "settings" && styles.tabActive]}
          onPress={() => setTab("settings")}
        >
          <Text
            style={[
              styles.tabLabel,
              tab === "settings" && styles.tabLabelActive,
            ]}
          >
            Settings
          </Text>
        </Pressable>
      </View>

      {configMsg ? (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[
            styles.toast,
            configOk ? styles.toastOk : styles.toastErr,
          ]}
        >
          <Text style={styles.toastText}>
            {configOk ? "✓" : "!"} {configMsg}
          </Text>
        </View>
      ) : null}

      {tab === "talk" ? (
        <View style={styles.talk}>
          <View style={styles.modeRow}>
            <Pressable
              disabled={connected}
              style={[
                styles.modeBtn,
                mode === "ptt" && styles.modeBtnActive,
                connected && styles.disabled,
              ]}
              onPress={() => setMode("ptt")}
            >
              <Text style={styles.modeLabel}>Walkie-talkie</Text>
            </Pressable>
            <Pressable
              disabled={connected}
              style={[
                styles.modeBtn,
                mode === "handsfree" && styles.modeBtnActive,
                connected && styles.disabled,
              ]}
              onPress={() => setMode("handsfree")}
            >
              <Text style={styles.modeLabel}>Hands-free</Text>
            </Pressable>
          </View>

          <Pressable
            style={[
              styles.connectBtn,
              connected ? styles.connectBtnOn : styles.connectBtnOff,
            ]}
            onPress={() => {
              if (connected) session.disconnect();
              else session.connect(mode);
            }}
          >
            <Text style={styles.connectLabel}>
              {session.status === "disconnected"
                ? "Connect"
                : session.status === "connecting"
                  ? "Cancel"
                  : "Disconnect"}
            </Text>
          </Pressable>

          {mode === "ptt" ? (
            <Pressable
              disabled={session.status !== "ready"}
              onPressIn={() => {
                setPttHeld(true);
                session.pttStart();
              }}
              onPressOut={() => {
                setPttHeld(false);
                session.pttEnd();
              }}
              style={[
                styles.ptt,
                pttHeld && styles.pttHeld,
                session.status !== "ready" && styles.disabled,
              ]}
            >
              <Text style={styles.pttLabel}>
                {pttHeld ? "Release to send" : "Hold to talk"}
              </Text>
            </Pressable>
          ) : (
            <View
              style={[
                styles.openMic,
                session.status === "ready" && styles.openMicLive,
              ]}
            >
              <View
                style={[
                  styles.micDot,
                  session.status === "ready" && styles.micDotLive,
                ]}
              />
              <Text style={styles.openMicLabel}>
                {session.status === "ready" ? "Open mic" : "Mic closed"}
              </Text>
            </View>
          )}

          <Pressable style={styles.stopBtn} onPress={() => session.abort()}>
            <Text style={styles.stopLabel}>Stop</Text>
          </Pressable>

          <FlatList
            ref={listRef}
            style={styles.feed}
            data={session.events}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderEvent}
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: true })
            }
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <Text style={styles.empty}>Transcripts and events appear here.</Text>
            }
          />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.settingsWrap}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            style={styles.settings}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.settingsContent}
          >
            <Text style={styles.hint}>
              {hydrated
                ? "Saved on this device only. Uninstall clears it. Save still writes repo/harness/voice to the gateway."
                : "Loading device settings…"}
            </Text>
            <Text style={styles.section}>Gateway</Text>
            <Field
              label="Gateway URL"
              value={settings.gatewayUrl}
              onChange={(v) => patch({ gatewayUrl: v })}
              autoCapitalize="none"
              placeholder="http://10.0.0.12:4100"
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
              placeholder="default"
            />

            <Pressable
              style={[styles.actionBtn, configBusy && styles.disabled]}
              disabled={configBusy}
              onPress={() => void onLoadConfig()}
            >
              <Text style={styles.actionLabel}>
                {configBusy && configAction === "load"
                  ? "Loading…"
                  : configOk && configAction === "load" && configMsg
                    ? "Loaded ✓"
                    : "Load config"}
              </Text>
            </Pressable>

            <Text style={styles.section}>Repo</Text>
            <Field
              label="Repo URL"
              value={settings.repoUrl}
              onChange={(v) => patch({ repoUrl: v })}
              autoCapitalize="none"
              placeholder="https://github.com/org/repo.git"
            />
            <Field
              label="Git PAT"
              value={settings.gitPat}
              onChange={(v) => patch({ gitPat: v })}
              secure
              autoCapitalize="none"
            />
            <Field
              label="Default branch"
              value={settings.defaultBranch}
              onChange={(v) => patch({ defaultBranch: v })}
              autoCapitalize="none"
              placeholder="main"
            />

            <Text style={styles.section}>Harness</Text>
            <View style={styles.harnessGrid}>
              {HARNESSES.map((h) => (
                <Pressable
                  key={h.id}
                  style={[
                    styles.harnessBtn,
                    settings.harness === h.id && styles.harnessBtnActive,
                  ]}
                  onPress={() => patch({ harness: h.id as HarnessId })}
                >
                  <Text style={styles.harnessLabel}>{h.label}</Text>
                </Pressable>
              ))}
            </View>
            <Field
              label={`${selectedHarness.label} API key (${selectedHarness.keyEnv})`}
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
            />

            <Text style={styles.section}>Voice</Text>
            <Field
              label="Stop word"
              value={settings.stopWord}
              onChange={(v) => patch({ stopWord: v })}
              placeholder="hard stop"
            />
            <Field
              label="ElevenLabs voice id"
              value={settings.voiceId}
              onChange={(v) => patch({ voiceId: v })}
              autoCapitalize="none"
            />

            <Pressable
              style={[styles.actionBtn, configBusy && styles.disabled]}
              disabled={configBusy}
              onPress={() => void onSaveConfig()}
            >
              <Text style={styles.actionLabel}>
                {configBusy && configAction === "save"
                  ? "Saving…"
                  : configOk && configAction === "save" && configMsg
                    ? "Saved ✓"
                    : "Save"}
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  secure,
  autoCapitalize,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  autoCapitalize?: "none" | "sentences";
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize ?? "sentences"}
        autoCorrect={false}
        placeholder={placeholder}
        placeholderTextColor="#6b7385"
      />
    </View>
  );
}

function kindStyle(kind: SessionEvent["kind"]) {
  switch (kind) {
    case "error":
      return styles.kindError;
    case "agent":
      return styles.kindAgent;
    case "tool":
      return styles.kindTool;
    case "transcript":
    case "partial":
      return styles.kindUser;
    default:
      return styles.kindMeta;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0e1014",
    paddingTop: 56,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  title: {
    color: "#e8edf5",
    fontSize: 22,
    fontWeight: "700",
  },
  status: {
    color: "#9aa3b5",
    fontSize: 13,
  },
  tabs: {
    flexDirection: "row",
    marginHorizontal: 16,
    backgroundColor: "#181c24",
    borderRadius: 10,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: "#2a3140",
  },
  tabLabel: {
    color: "#9aa3b5",
    fontWeight: "600",
  },
  tabLabelActive: {
    color: "#e8edf5",
  },
  talk: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    backgroundColor: "#181c24",
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#181c24",
  },
  modeBtnActive: {
    borderColor: "#5b8cff",
  },
  modeLabel: {
    color: "#e8edf5",
    fontWeight: "600",
  },
  connectBtn: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  connectBtnOff: {
    backgroundColor: "#2d6a4f",
  },
  connectBtnOn: {
    backgroundColor: "#3d4a63",
  },
  connectLabel: {
    color: "#e8edf5",
    fontWeight: "700",
    fontSize: 16,
  },
  ptt: {
    marginTop: 16,
    minHeight: 160,
    borderRadius: 20,
    backgroundColor: "#1c2433",
    borderWidth: 2,
    borderColor: "#3d4a63",
    alignItems: "center",
    justifyContent: "center",
  },
  pttHeld: {
    backgroundColor: "#1e3a5f",
    borderColor: "#5b8cff",
  },
  pttLabel: {
    color: "#e8edf5",
    fontSize: 20,
    fontWeight: "700",
  },
  openMic: {
    marginTop: 16,
    minHeight: 120,
    borderRadius: 20,
    backgroundColor: "#181c24",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  openMicLive: {
    borderWidth: 1,
    borderColor: "#2d6a4f",
  },
  micDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#6b7385",
  },
  micDotLive: {
    backgroundColor: "#3dd68c",
  },
  openMicLabel: {
    color: "#e8edf5",
    fontSize: 18,
    fontWeight: "600",
  },
  stopBtn: {
    marginTop: 12,
    backgroundColor: "#9b2226",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  stopLabel: {
    color: "#e8edf5",
    fontWeight: "700",
    fontSize: 16,
  },
  feed: {
    flex: 1,
    marginTop: 16,
    marginBottom: 16,
    backgroundColor: "#181c24",
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  eventRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2a3140",
  },
  eventKind: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  eventText: {
    color: "#e8edf5",
    fontSize: 15,
    lineHeight: 20,
  },
  kindError: { color: "#ff6b6b" },
  kindAgent: { color: "#7eb6ff" },
  kindTool: { color: "#c9a227" },
  kindUser: { color: "#3dd68c" },
  kindMeta: { color: "#9aa3b5" },
  empty: {
    color: "#6b7385",
    paddingVertical: 20,
    textAlign: "center",
  },
  disabled: {
    opacity: 0.45,
  },
  settingsWrap: {
    flex: 1,
  },
  settings: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  settingsContent: {
    paddingBottom: 32,
  },
  hint: {
    color: "#6b7385",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  section: {
    color: "#9aa3b5",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 8,
  },
  field: {
    marginBottom: 10,
  },
  fieldLabel: {
    color: "#9aa3b5",
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#181c24",
    color: "#e8edf5",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  harnessGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  harnessBtn: {
    width: "48%",
    backgroundColor: "#181c24",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#181c24",
  },
  harnessBtnActive: {
    borderColor: "#5b8cff",
  },
  harnessLabel: {
    color: "#e8edf5",
    fontWeight: "600",
  },
  actionBtn: {
    backgroundColor: "#2a3140",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 8,
  },
  actionLabel: {
    color: "#e8edf5",
    fontWeight: "700",
  },
  toast: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toastOk: {
    backgroundColor: "#123326",
    borderColor: "#3dd68c",
  },
  toastErr: {
    backgroundColor: "#3a1b20",
    borderColor: "#ff6b6b",
  },
  toastText: {
    color: "#f4f7fb",
    fontSize: 14,
    fontWeight: "700",
  },
});
