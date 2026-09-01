import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CredentialEntry } from "../credential-vault";
import type { AttachedRepository } from "../settings";
import { Button, Card, Field } from "./components";
import { CheckIcon } from "./icons";
import { color, font, radius, space } from "./theme";

export function GithubRepositoryPicker({
  credentials,
  selectedCredentialId,
  repositories,
  selectedRepositories,
  busy,
  search,
  onSearchChange,
  onConnectGithub,
  onRefresh,
  onToggleRepository,
}: {
  credentials: CredentialEntry[];
  selectedCredentialId?: string;
  repositories: AttachedRepository[];
  selectedRepositories: AttachedRepository[];
  busy?: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  /** Inline device-flow connect from this agent's setup. */
  onConnectGithub?: () => void;
  onRefresh: () => void;
  onToggleRepository: (repository: AttachedRepository) => void;
}) {
  const selectedCredential = credentials.find(
    (entry) => entry.id === selectedCredentialId,
  );
  const accountLabel = selectedCredential
    ? githubAccountLabel(selectedCredential)
    : undefined;
  const selectedIds = new Set(
    selectedRepositories.map((repository) => repository.id),
  );
  const availableRepositories =
    repositories.length > 0 ? repositories : selectedRepositories;
  const visibleRepositories = availableRepositories.filter((repository) =>
    repository.fullName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Card style={styles.card}>
      {!selectedCredential ? (
        <>
          <View style={styles.statusRow}>
            <View style={styles.statusDotIdle} />
            <Text style={styles.statusText}>GitHub is not connected</Text>
          </View>
          <Text style={styles.note}>
            Connect this agent to GitHub, then choose the repositories its next
            container session should clone.
          </Text>
          {onConnectGithub ? (
            <Button
              tone="primary"
              busy={busy}
              label={busy ? "Waiting for GitHub…" : "Connect GitHub"}
              onPress={onConnectGithub}
            />
          ) : null}
        </>
      ) : (
        <>
          <View style={styles.statusRow}>
            <View style={styles.statusDotLive} />
            <Text style={styles.statusText}>
              {selectedCredential.kind === "git-pat"
                ? `Connected with Git token · ${accountLabel}`
                : `Connected as ${accountLabel}`}
            </Text>
          </View>
          <View style={styles.repositoryHeader}>
            <Text style={styles.selectionCount}>
              {selectedRepositories.length} selected for next session
            </Text>
            <Button
              tone="ghost"
              busy={busy}
              label="Refresh"
              onPress={onRefresh}
            />
          </View>
        </>
      )}

      {selectedCredential ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>Startup repositories</Text>
          <Text style={styles.note}>
            Checked repositories are cloned under /workspace when the next
            container session starts. GitHub access itself is available to the
            current session immediately.
          </Text>
          {availableRepositories.length > 0 ? (
            <Field
              label="Filter repositories"
              value={search}
              onChange={onSearchChange}
              autoCapitalize="none"
              placeholder="owner or repository"
            />
          ) : null}
          {availableRepositories.length === 0 ? (
            <Text style={styles.note}>
              {busy
                ? "Loading repositories…"
                : "No repositories returned. Grant repository access, then refresh."}
            </Text>
          ) : visibleRepositories.length === 0 ? (
            <Text style={styles.note}>
              No repositories match this filter.
            </Text>
          ) : (
            <View style={styles.repositoryList}>
              {visibleRepositories.map((repository) => {
                const selected = selectedIds.has(repository.id);
                return (
                  <Pressable
                    key={repository.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${repository.fullName}, ${
                      selected ? "selected" : "not selected"
                    } for next session`}
                    onPress={() => onToggleRepository(repository)}
                    style={[
                      styles.repositoryRow,
                      selected && styles.repositoryRowSelected,
                    ]}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        selected && styles.checkboxSelected,
                      ]}
                    >
                      {selected ? (
                        <CheckIcon size={13} color={color.bg} />
                      ) : null}
                    </View>
                    <View style={styles.repositoryText}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.repositoryName,
                          selected && styles.repositoryNameSelected,
                        ]}
                      >
                        {repository.fullName}
                      </Text>
                      <Text style={styles.repositoryVisibility}>
                        {repository.private ? "Private" : "Public"}
                        {selected ? " · next session" : ""}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      ) : null}
    </Card>
  );
}

export function githubAccountLabel(entry: CredentialEntry): string {
  const trimmed = entry.label.trim();
  if (entry.kind === "git-pat") {
    return trimmed || "Personal access token";
  }
  const prefix = "GitHub — ";
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  return trimmed || "GitHub account";
}

const styles = StyleSheet.create({
  card: {
    gap: space.md,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  statusDotLive: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: color.live,
  },
  statusDotIdle: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: color.textDim,
  },
  statusText: {
    flex: 1,
    color: color.text,
    fontSize: font.caption,
    fontWeight: "700",
  },
  divider: {
    height: 1,
    backgroundColor: color.border,
    marginVertical: space.xs,
  },
  sectionTitle: {
    color: color.text,
    fontSize: font.caption,
    fontWeight: "800",
  },
  selectionCount: {
    flex: 1,
    color: color.textDim,
    fontSize: font.micro,
    fontWeight: "600",
  },
  repositoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  repositoryList: {
    gap: space.sm,
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
  checkbox: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.bgElevated,
  },
  checkboxSelected: {
    borderColor: color.accent,
    backgroundColor: color.accent,
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
  note: {
    color: color.textDim,
    fontSize: font.caption,
    lineHeight: 17,
  },
});
