import { Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { Button, Card, Field } from "../../ui/components";
import { SetupShell } from "../../ui/AgentSetup";
import { color, font, radius, space } from "../../ui/theme";

export interface RailwayWorkspaceOption {
  id: string;
  name: string;
  plan: string;
}

export function RailwayAgentScreen({
  oauthConnected,
  oauthBusy,
  clientConfigured,
  workspaces,
  selectedWorkspaceId,
  name,
  missingVoiceFields,
  voiceConfigured,
  launchPhase,
  error,
  onConnect,
  onSelectWorkspace,
  onNameChange,
  onSaveVoiceSecrets,
  onLaunch,
  onBack,
}: {
  oauthConnected: boolean;
  oauthBusy: boolean;
  clientConfigured: boolean;
  workspaces: RailwayWorkspaceOption[];
  selectedWorkspaceId: string;
  name: string;
  missingVoiceFields: {
    providerId: string;
    env: string;
    label: string;
    hint?: string;
  }[];
  voiceConfigured: boolean;
  launchPhase?: string;
  error?: string;
  onConnect: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onNameChange: (value: string) => void;
  onSaveVoiceSecrets: (
    input: readonly { providerId: string; secret: string }[],
  ) => Promise<void>;
  onLaunch: () => void;
  onBack: () => void;
}) {
  const launching = Boolean(launchPhase);
  const [voiceSecrets, setVoiceSecrets] = useState<Record<string, string>>({});
  const [voiceKeysBusy, setVoiceKeysBusy] = useState(false);
  const [voiceKeysError, setVoiceKeysError] = useState("");

  const saveRequiredVoiceKeys = async () => {
    setVoiceKeysBusy(true);
    setVoiceKeysError("");
    try {
      await onSaveVoiceSecrets(
        missingVoiceFields.map((field) => ({
          providerId: field.providerId,
          secret: voiceSecrets[voiceFieldKey(field)] ?? "",
        })),
      );
      setVoiceSecrets({});
    } catch (cause) {
      setVoiceKeysError(
        cause instanceof Error
          ? cause.message
          : "Could not save app credentials.",
      );
    } finally {
      setVoiceKeysBusy(false);
    }
  };

  return (
    <SetupShell
      eyebrow="RAILWAY"
      title="Launch a new agent"
      subtitle="The app creates a project, service, persistent config volume, domain, and runtime deployment in your Railway account."
      onBack={onBack}
    >
      <Card style={styles.formCard}>
        <View style={styles.connectionRow}>
          <View style={styles.connectionCopy}>
            <Text style={styles.connectionTitle}>Railway account</Text>
            <Text style={styles.connectionDetail}>
              {oauthConnected
                ? "Connected. Choose a workspace below."
                : "Uses OAuth with PKCE. No client secret is stored in the app."}
            </Text>
          </View>
          <View
            style={[
              styles.connectionDot,
              oauthConnected && styles.connectionDotLive,
            ]}
          />
        </View>
        <Button
          label={oauthConnected ? "Reconnect Railway" : "Connect Railway"}
          onPress={onConnect}
          busy={oauthBusy}
          disabled={!clientConfigured}
        />
        {!clientConfigured ? (
          <Text style={styles.warning}>
            This build does not include the public Railway OAuth client ID.
          </Text>
        ) : null}
      </Card>

      {oauthConnected ? (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>WORKSPACE</Text>
            {workspaces.map((workspace) => {
              const selected = workspace.id === selectedWorkspaceId;
              return (
                <Pressable
                  key={workspace.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => onSelectWorkspace(workspace.id)}
                  style={[
                    styles.workspace,
                    selected && styles.workspaceSelected,
                  ]}
                >
                  <View style={styles.radio}>
                    {selected ? <View style={styles.radioFill} /> : null}
                  </View>
                  <View style={styles.workspaceCopy}>
                    <Text style={styles.workspaceName}>{workspace.name}</Text>
                    <Text style={styles.workspacePlan}>{workspace.plan}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Card style={styles.formCard}>
            <Field
              label="Agent name"
              value={name}
              onChange={onNameChange}
              placeholder="Backend agent"
              hint="Names this isolated deployment on your phone."
            />
          </Card>
          {!voiceConfigured ? (
            <Card style={styles.formCard}>
              <Text style={styles.warningTitle}>Finish app setup</Text>
              <Text style={styles.connectionDetail}>
                Required voice provider credentials are saved securely on this
                device and reused for future launches.
              </Text>
              {missingVoiceFields.map((field) => (
                <Field
                  key={voiceFieldKey(field)}
                  label={field.label}
                  value={voiceSecrets[voiceFieldKey(field)] ?? ""}
                  onChange={(value) =>
                    setVoiceSecrets((current) => ({
                      ...current,
                      [voiceFieldKey(field)]: value,
                    }))
                  }
                  autoCapitalize="none"
                  secure
                  mono
                  hint={field.hint}
                />
              ))}
              {voiceKeysError ? (
                <Text style={styles.error}>{voiceKeysError}</Text>
              ) : null}
              <Button
                label="Save and continue"
                busy={voiceKeysBusy}
                disabled={
                  missingVoiceFields.some(
                    (field) => !(voiceSecrets[voiceFieldKey(field)] ?? "").trim(),
                  )
                }
                onPress={() => void saveRequiredVoiceKeys()}
              />
            </Card>
          ) : (
            <View style={styles.readyRow}>
              <View style={styles.readyDot} />
              <Text style={styles.readyText}>
                App credentials ready for launch
              </Text>
            </View>
          )}
          {launchPhase ? (
            <View style={styles.progress}>
              <View style={styles.progressDot} />
              <Text style={styles.progressText}>{launchPhase}</Text>
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label={launching ? "Launching agent…" : "Launch agent"}
            tone="primary"
            busy={launching}
            disabled={
              !selectedWorkspaceId ||
              !name.trim() ||
              !voiceConfigured
            }
            onPress={onLaunch}
          />
        </>
      ) : null}
    </SetupShell>
  );
}

function voiceFieldKey(field: { providerId: string; env: string }): string {
  return `${field.providerId}:${field.env}`;
}

const styles = StyleSheet.create({
  formCard: {
    gap: space.lg,
  },
  connectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  connectionCopy: {
    flex: 1,
  },
  connectionTitle: {
    color: color.text,
    fontSize: font.label,
    fontWeight: "700",
  },
  connectionDetail: {
    color: color.textDim,
    fontSize: font.caption,
    lineHeight: 17,
    marginTop: space.xs,
  },
  connectionDot: {
    width: 9,
    height: 9,
    borderRadius: radius.pill,
    backgroundColor: color.textDim,
  },
  connectionDotLive: {
    backgroundColor: color.live,
  },
  warning: {
    color: color.warn,
    fontSize: font.caption,
    lineHeight: 17,
  },
  warningTitle: {
    color: color.text,
    fontSize: font.label,
    fontWeight: "700",
  },
  readyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
  },
  readyDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: color.live,
  },
  readyText: {
    color: color.textMuted,
    fontSize: font.caption,
    fontWeight: "700",
  },
  section: {
    gap: space.sm,
  },
  sectionLabel: {
    color: color.textDim,
    fontSize: font.micro,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  workspace: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
  },
  workspaceSelected: {
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  radio: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: radius.pill,
  },
  radioFill: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: color.accent,
  },
  workspaceCopy: {
    flex: 1,
  },
  workspaceName: {
    color: color.text,
    fontSize: font.label,
    fontWeight: "700",
  },
  workspacePlan: {
    color: color.textDim,
    fontSize: font.caption,
    marginTop: 2,
  },
  progress: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.accentTint,
  },
  progressDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: color.accent,
  },
  progressText: {
    flex: 1,
    color: color.textMuted,
    fontSize: font.caption,
  },
  error: {
    color: color.danger,
    fontSize: font.caption,
    lineHeight: 18,
  },
});
