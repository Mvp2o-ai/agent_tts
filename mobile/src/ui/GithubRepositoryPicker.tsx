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
  onManageAccounts,
  onSelectCredential,
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
  onManageAccounts: () => void;
  onSelectCredential: (entry: CredentialEntry) => void;
  onRefresh: () => void;
  onToggleRepository: (repository: AttachedRepository) => void;
}) {
  const visibleRepositories = repositories.filter((repository) =>
    repository.fullName.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const selectedIds = new Set(selectedRepositories.map((repository) => repository.id));

  return (
    <Card style={styles.card}>
      {credentials.length > 0 ? (
        <>
          <View style={styles.credentialList}>
            {credentials.map((entry) => {
              const selected = entry.id === selectedCredentialId;
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={entry.label}
                  onPress={() => onSelectCredential(entry)}
                  style={[styles.credentialSelect, selected && styles.credentialActive]}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.credentialName, selected && styles.credentialNameActive]}
                  >
                    {entry.label}
                  </Text>
                  {selected ? <CheckIcon size={14} color={color.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
          <Button
            tone="ghost"
            label="Manage GitHub accounts"
            onPress={onManageAccounts}
          />
        </>
      ) : (
        <>
          <Text style={styles.note}>
            Connect GitHub to choose repositories to have ready when this
            agent starts.
          </Text>
          <Button
            tone="neutral"
            label="Open App Settings"
            onPress={onManageAccounts}
          />
        </>
      )}

      {credentials.length > 0 && selectedCredentialId ? (
        <>
          <View style={styles.repositoryHeader}>
            <Text style={styles.repositoryCount}>
              {selectedRepositories.length} selected
            </Text>
            <Button
              tone="ghost"
              busy={busy}
              label="Refresh"
              onPress={onRefresh}
            />
          </View>
          {repositories.length > 0 ? (
            <Field
              label="Filter repositories"
              value={search}
              onChange={onSearchChange}
              autoCapitalize="none"
              placeholder="owner or repository"
            />
          ) : null}
          {repositories.length > 0 ? (
            <View style={styles.repositoryList}>
              {visibleRepositories.map((repository) => {
                const selected = selectedIds.has(repository.id);
                return (
                  <Pressable
                    key={repository.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={repository.fullName}
                    onPress={() => onToggleRepository(repository)}
                    style={[styles.repositoryRow, selected && styles.repositoryRowSelected]}
                  >
                    <View style={styles.repositoryText}>
                      <Text
                        numberOfLines={1}
                        style={[styles.repositoryName, selected && styles.repositoryNameSelected]}
                      >
                        {repository.fullName}
                      </Text>
                      <Text style={styles.repositoryVisibility}>
                        {repository.private ? "Private" : "Public"}
                      </Text>
                    </View>
                    {selected ? <CheckIcon size={15} color={color.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={styles.note}>
              No repositories returned. Grant repository access, then refresh.
            </Text>
          )}
        </>
      ) : credentials.length > 0 ? (
        <Text style={styles.note}>
          Choose a GitHub account, then select any repositories you want ready
          when this agent starts.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.md,
  },
  credentialList: {
    gap: space.sm,
  },
  credentialSelect: {
    flex: 1,
    minWidth: 0,
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
  credentialActive: {
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
  },
  repositoryCount: {
    color: color.textMuted,
    fontSize: font.caption,
    fontWeight: "700",
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
