import { StyleSheet, Text, View } from "react-native";
import type { CredentialEntry } from "../credential-vault";
import type { AttachedRepository } from "../settings";
import type { GitAuthState } from "../useVoiceSession";
import { SetupShell } from "./AgentSetup";
import {
  GithubRepositoryPicker,
  githubAccountLabel,
} from "./GithubRepositoryPicker";
import { Button, Card } from "./components";
import { color, font, radius, space } from "./theme";

export function AgentGithubSummary({
  assigned,
  credential,
  repositories,
  authState,
  authMessage,
  connectError,
  busy,
  onConnect,
  onManage,
}: {
  assigned: boolean;
  credential?: CredentialEntry;
  repositories: AttachedRepository[];
  authState: GitAuthState;
  authMessage: string;
  connectError?: string;
  busy?: boolean;
  onConnect: () => void;
  onManage: () => void;
}) {
  const connected = assigned && credential !== undefined;
  const needsReconnect = assigned && (!credential || authState === "required");

  return (
    <Card style={styles.summaryCard}>
      <View style={styles.statusRow}>
        <View
          style={[
            styles.statusDot,
            connected && !needsReconnect
              ? styles.statusDotLive
              : needsReconnect
                ? styles.statusDotWarn
                : styles.statusDotIdle,
          ]}
        />
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>
            {connected
              ? `Connected as ${githubAccountLabel(credential)}`
              : needsReconnect
                ? "Reconnect GitHub"
                : "GitHub is not connected"}
          </Text>
          <Text style={styles.statusDetail}>
            {connectError?.trim()
              ? connectError.trim()
              : needsReconnect
                ? authMessage.trim() || "The saved GitHub credential is unavailable."
                : connected
                  ? "Available to git and gh in this agent’s live session."
                  : "Connect one GitHub identity to this agent."}
          </Text>
        </View>
      </View>

      {connected ? (
        <View style={styles.repositorySummary}>
          <Text style={styles.repositoryCount}>
            {repositories.length === 0
              ? "No startup repositories"
              : `${repositories.length} startup ${
                  repositories.length === 1 ? "repository" : "repositories"
                }`}
          </Text>
          {repositories.slice(0, 3).map((repository) => (
            <Text
              key={repository.id}
              numberOfLines={1}
              style={styles.repositoryName}
            >
              {repository.fullName}
            </Text>
          ))}
          {repositories.length > 3 ? (
            <Text style={styles.moreRepositories}>
              +{repositories.length - 3} more
            </Text>
          ) : null}
        </View>
      ) : null}

      <Button
        tone={connected && !needsReconnect ? "neutral" : "primary"}
        busy={busy}
        label={
          busy
            ? connected && !needsReconnect
              ? "Refreshing GitHub…"
              : needsReconnect
                ? "Reconnecting GitHub…"
                : "Connecting GitHub…"
            : connected && !needsReconnect
              ? "Manage GitHub and startup repositories"
              : needsReconnect
                ? "Reconnect GitHub"
                : "Connect GitHub"
        }
        onPress={connected && !needsReconnect ? onManage : onConnect}
      />
    </Card>
  );
}

export function GithubRepositoryManagerScreen({
  credential,
  credentials,
  repositories,
  selectedRepositories,
  busy,
  search,
  connectError,
  onSearchChange,
  onConnect,
  onRefresh,
  onToggleRepository,
  onSwitchAccount,
  onDisconnect,
  onBack,
}: {
  credential?: CredentialEntry;
  credentials: CredentialEntry[];
  repositories: AttachedRepository[];
  selectedRepositories: AttachedRepository[];
  busy?: boolean;
  search: string;
  connectError?: string;
  onSearchChange: (value: string) => void;
  onConnect: () => void;
  onRefresh: () => void;
  onToggleRepository: (repository: AttachedRepository) => void;
  onSwitchAccount: () => void;
  onDisconnect: () => void;
  onBack: () => void;
}) {
  return (
    <SetupShell
      eyebrow="AGENT"
      title="Startup repositories"
      subtitle="This agent has one GitHub identity. Access updates the live session immediately; checked repositories are cloned when its next container session starts."
      onBack={onBack}
    >
      <GithubRepositoryPicker
        credentials={credentials}
        selectedCredentialId={credential?.id}
        repositories={repositories}
        selectedRepositories={selectedRepositories}
        busy={busy}
        search={search}
        connectError={connectError}
        onSearchChange={onSearchChange}
        onConnectGithub={onConnect}
        onRefresh={onRefresh}
        onToggleRepository={onToggleRepository}
      />
      {credential ? (
        <Card style={styles.actionsCard}>
          <Text style={styles.actionsTitle}>GitHub identity</Text>
          <Text style={styles.actionsDetail}>
            Switching replaces this agent’s active GitHub identity. It does not
            add a second token to the container.
          </Text>
          <Button
            tone="neutral"
            busy={busy}
            label="Switch GitHub account"
            onPress={onSwitchAccount}
          />
          <Button
            tone="danger"
            disabled={busy}
            label="Disconnect GitHub"
            onPress={onDisconnect}
          />
        </Card>
      ) : null}
    </SetupShell>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    gap: space.md,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.sm,
  },
  statusDot: {
    width: 9,
    height: 9,
    marginTop: 4,
    borderRadius: radius.pill,
  },
  statusDotLive: {
    backgroundColor: color.live,
  },
  statusDotWarn: {
    backgroundColor: color.warn,
  },
  statusDotIdle: {
    backgroundColor: color.textDim,
  },
  statusCopy: {
    flex: 1,
  },
  statusTitle: {
    color: color.text,
    fontSize: font.label,
    fontWeight: "700",
  },
  statusDetail: {
    color: color.textDim,
    fontSize: font.caption,
    lineHeight: 17,
    marginTop: 3,
  },
  repositorySummary: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.bgElevated,
  },
  repositoryCount: {
    color: color.textMuted,
    fontSize: font.caption,
    fontWeight: "700",
    marginBottom: 2,
  },
  repositoryName: {
    color: color.text,
    fontSize: font.caption,
  },
  moreRepositories: {
    color: color.textDim,
    fontSize: font.micro,
    fontWeight: "700",
  },
  actionsCard: {
    gap: space.md,
  },
  actionsTitle: {
    color: color.text,
    fontSize: font.label,
    fontWeight: "700",
  },
  actionsDetail: {
    color: color.textDim,
    fontSize: font.caption,
    lineHeight: 18,
  },
});
