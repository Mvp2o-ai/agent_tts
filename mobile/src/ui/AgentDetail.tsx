import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ReactNode } from "react";
import { useState } from "react";
import type { ProviderAccountConnection } from "../providers/types";
import { NEW_SESSION_WARNING } from "../session-refresh";
import {
  Button,
  Card,
  ConfirmToast,
  Field,
  KeyboardAwareScrollView,
} from "./components";
import { PencilIcon, PowerIcon, RefreshIcon, TrashIcon } from "./icons";
import { color, font, inset, radius, space } from "./theme";

export function AgentDetailScreen({
  name,
  gatewayUrl,
  token,
  hostLabel,
  statusLabel,
  statusTone,
  gone,
  lifecycleBusy,
  removing,
  accountConnection,
  configuration,
  onNameChange,
  onGatewayUrlChange,
  onTokenChange,
  onNewSession,
  onReplace,
  onRemove,
  onBack,
}: {
  name: string;
  gatewayUrl: string;
  token: string;
  hostLabel: string;
  statusLabel: string;
  statusTone: "idle" | "busy" | "live" | "error";
  gone?: boolean;
  lifecycleBusy?: boolean;
  removing?: boolean;
  accountConnection?: ProviderAccountConnection;
  configuration?: ReactNode;
  onNameChange: (value: string) => void;
  onGatewayUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onNewSession: () => void;
  onReplace: () => void;
  onRemove: () => void;
  onBack: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [confirmingSession, setConfirmingSession] = useState(false);
  const accountBlocked =
    accountConnection !== undefined &&
    accountConnection.status !== "connected";

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Agents"
          accessibilityHint="Return to the agents list."
          hitSlop={10}
          onPress={onBack}
          style={styles.back}
        >
          <Text style={styles.backChevron}>‹</Text>
          <Text style={styles.backLabel}>Agents</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>AGENT</Text>
          <View style={styles.nameRow}>
            {editingName ? (
              <TextInput
                accessibilityLabel="Agent name"
                autoCapitalize="sentences"
                autoCorrect={false}
                autoFocus
                blurOnSubmit
                onChangeText={onNameChange}
                onSubmitEditing={() => setEditingName(false)}
                placeholder="Fix offline status on agent cards"
                placeholderTextColor={color.textDim}
                returnKeyType="done"
                style={styles.nameInput}
                value={name}
              />
            ) : (
              <Text numberOfLines={1} style={styles.title}>
              {name.trim() || "Untitled agent"}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                editingName
                  ? "Finish editing agent name"
                  : "Edit agent name"
              }
              accessibilityState={{ expanded: editingName }}
              hitSlop={8}
              onPress={() => setEditingName((current) => !current)}
              style={styles.nameEdit}
            >
              <View style={styles.nameEditBox}>
                <PencilIcon size={16} color={color.textMuted} />
              </View>
            </Pressable>
          </View>
        </View>
      </View>

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        {accountConnection && accountConnection.status !== "connected" ? (
          <Card style={styles.lifecycleCard}>
            <Text style={styles.lifecycleTitle}>
              {accountConnection.status === "checking"
                ? `Checking ${hostLabel} authorization`
                : accountConnection.status === "reconnect-required"
                  ? `${hostLabel} disconnected`
                  : `${hostLabel} connection unavailable`}
            </Text>
            <Text style={styles.lifecycleDetail}>
              {accountConnection.message ||
                `Reconnect ${hostLabel} to manage this agent.`}
            </Text>
            {accountConnection.status !== "checking" ? (
              <Button
                label={`Reconnect ${hostLabel}`}
                tone="primary"
                busy={accountConnection.busy}
                onPress={accountConnection.reconnect}
              />
            ) : null}
          </Card>
        ) : null}
        {gone ? (
          <Card style={styles.lifecycleCard}>
            <Text style={styles.lifecycleTitle}>Deployment removed</Text>
            <Text style={styles.host}>{hostLabel}</Text>
            <Text style={styles.lifecycleDetail}>
              This deployment no longer exists at its provider. Its
              configuration is saved on this device — launch a replacement to
              reuse it, or delete the agent.
            </Text>
            <Button
              label="Launch replacement"
              tone="primary"
              busy={lifecycleBusy}
              disabled={accountBlocked}
              icon={<PowerIcon size={18} color={color.bg} />}
              onPress={onReplace}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete agent ${name}`}
              disabled={removing || accountBlocked}
              onPress={onRemove}
              style={[
                styles.remove,
                (removing || accountBlocked) && styles.removeDisabled,
              ]}
            >
              <TrashIcon size={16} color={color.danger} />
              <Text style={styles.removeText}>
                {removing ? "Deleting agent…" : "Delete agent"}
              </Text>
            </Pressable>
          </Card>
        ) : (
          <AgentDetailBody
            statusLabel={statusLabel}
            statusTone={statusTone}
            hostLabel={hostLabel}
            gatewayUrl={gatewayUrl}
            token={token}
            lifecycleBusy={lifecycleBusy}
            removing={removing}
            accountConnection={accountConnection}
            configuration={configuration}
            name={name}
            onGatewayUrlChange={onGatewayUrlChange}
            onTokenChange={onTokenChange}
            onNewSession={() => setConfirmingSession(true)}
            onRemove={onRemove}
          />
        )}
      </KeyboardAwareScrollView>
      {confirmingSession ? (
        <View style={styles.confirmOverlay}>
          <ConfirmToast
            message={NEW_SESSION_WARNING}
            confirmLabel="New session"
            onCancel={() => setConfirmingSession(false)}
            onConfirm={() => {
              setConfirmingSession(false);
              onNewSession();
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function AgentDetailBody({
  statusLabel,
  statusTone,
  hostLabel,
  gatewayUrl,
  token,
  lifecycleBusy,
  removing,
  accountConnection,
  configuration,
  name,
  onGatewayUrlChange,
  onTokenChange,
  onNewSession,
  onRemove,
}: {
  statusLabel: string;
  statusTone: "idle" | "busy" | "live" | "error";
  hostLabel: string;
  gatewayUrl: string;
  token: string;
  lifecycleBusy?: boolean;
  removing?: boolean;
  accountConnection?: ProviderAccountConnection;
  configuration?: ReactNode;
  name: string;
  onGatewayUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onNewSession: () => void;
  onRemove: () => void;
}) {
  const lifecycleBlocked =
    accountConnection !== undefined &&
    accountConnection.status !== "connected";
  const providerName = hostLabel;

  return (
    <>
        <Card style={styles.statusCard}>
          <View style={styles.statusCopy}>
            <Text style={styles.status}>{statusLabel}</Text>
            <Text style={styles.host}>{hostLabel}</Text>
          </View>
          <View
            style={[
              styles.statusDot,
              statusTone === "live"
                ? styles.statusDotRunning
                : statusTone === "busy"
                  ? styles.statusDotBusy
                  : statusTone === "error"
                    ? styles.statusDotError
                    : styles.statusDotStopped,
            ]}
          />
        </Card>

        <Text style={styles.sectionLabel}>CONNECTION</Text>
        <Card>
          <Field
            label="Gateway URL"
            value={gatewayUrl}
            onChange={onGatewayUrlChange}
            placeholder="https://agent.example.com"
            autoCapitalize="none"
            mono
          />
          <Field
            label="Gateway token"
            value={token}
            onChange={onTokenChange}
            placeholder="Gateway access token"
            autoCapitalize="none"
            secure
            mono
            hint="Stored in this device's credential vault."
          />
        </Card>

        {configuration}

        <Text style={styles.sectionLabel}>SESSION</Text>
        <Card style={styles.lifecycleCard}>
          <Text style={styles.lifecycleTitle}>Current container</Text>
          <Text style={styles.lifecycleDetail}>
            A new session recreates this container. Commit and push your work
            first; uncommitted or unpushed work is lost.
          </Text>
          {lifecycleBlocked ? (
            <Text style={styles.lifecycleBlocked}>
              Reconnect {providerName} before starting a new session.
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New session"
            accessibilityHint="Recreates this agent's container."
            accessibilityState={{ disabled: lifecycleBusy || lifecycleBlocked }}
            disabled={lifecycleBusy || lifecycleBlocked}
            onPress={onNewSession}
            style={[
              styles.newSession,
              (lifecycleBusy || lifecycleBlocked) && styles.newSessionBusy,
            ]}
          >
            <RefreshIcon
              size={18}
              color={lifecycleBlocked ? color.textDim : color.accent}
            />
            <Text
              style={[
                styles.newSessionLabel,
                lifecycleBlocked && styles.newSessionLabelBlocked,
              ]}
            >
              {lifecycleBusy ? "Starting new session…" : "New session"}
            </Text>
          </Pressable>
        </Card>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete agent ${name}`}
          disabled={removing || lifecycleBlocked}
          onPress={onRemove}
          style={[
            styles.remove,
            (removing || lifecycleBlocked) && styles.removeDisabled,
          ]}
        >
          <TrashIcon size={16} color={color.danger} />
          <Text style={styles.removeText}>
            {removing ? "Deleting agent…" : "Delete agent"}
          </Text>
        </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.bg,
  },
  scroll: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  back: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginLeft: -space.sm,
    marginRight: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  backChevron: {
    color: color.text,
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "300",
  },
  backLabel: {
    color: color.text,
    fontSize: font.label,
    fontWeight: "600",
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: color.textDim,
    fontSize: font.micro,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  title: {
    color: color.text,
    fontSize: font.title,
    fontWeight: "700",
    marginTop: 2,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    marginTop: 2,
  },
  nameInput: {
    flex: 1,
    minWidth: 0,
    color: color.text,
    backgroundColor: color.bgElevated,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.accent,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    fontSize: font.title,
    fontWeight: "700",
  },
  nameEdit: {
    marginLeft: space.sm,
  },
  nameEditBox: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surfaceRaised,
  },
  content: {
    padding: space.xl,
    paddingBottom: inset.bottom + space.xxxl + space.xl,
    gap: space.md,
  },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusCopy: {
    flex: 1,
  },
  status: {
    color: color.text,
    fontSize: font.body,
    fontWeight: "700",
  },
  host: {
    color: color.textDim,
    fontSize: font.caption,
    marginTop: 3,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
  },
  statusDotRunning: {
    backgroundColor: color.live,
  },
  statusDotStopped: {
    backgroundColor: color.textDim,
  },
  statusDotBusy: {
    backgroundColor: color.warn,
  },
  statusDotError: {
    backgroundColor: color.danger,
  },
  sectionLabel: {
    color: color.textMuted,
    fontSize: font.micro,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: space.md,
  },
  lifecycleCard: {
    gap: space.md,
  },
  lifecycleTitle: {
    color: color.text,
    fontSize: font.label,
    fontWeight: "700",
  },
  lifecycleDetail: {
    color: color.textDim,
    fontSize: font.caption,
    lineHeight: 18,
  },
  lifecycleBlocked: {
    color: color.warn,
    fontSize: font.caption,
    lineHeight: 18,
  },
  newSession: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    alignSelf: "flex-start",
    paddingVertical: space.xs,
  },
  newSessionBusy: {
    opacity: 0.55,
  },
  newSessionLabel: {
    color: color.accent,
    fontSize: font.label,
    fontWeight: "700",
  },
  newSessionLabelBlocked: {
    color: color.textDim,
  },
  confirmOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: inset.bottom + space.lg,
    zIndex: 20,
  },
  remove: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    marginTop: space.lg,
  },
  removeDisabled: {
    opacity: 0.55,
  },
  removeText: {
    color: color.danger,
    fontSize: font.label,
    fontWeight: "700",
  },
});
