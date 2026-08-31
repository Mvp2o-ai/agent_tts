import { useCallback, useEffect, useState } from "react";
import type { AgentProfile, AttachedRepository } from "../../settings";
import { preserveAccessibleRepositories } from "../../repository-selection";
import { findVoiceCredential } from "../../voice-credentials";
import { getVoiceProvider } from "../../voice-providers";
import { useRailwayLauncher } from "../../useRailwayLauncher";
import type { ProviderPlugin, ProviderSetupContext } from "../types";
import { RailwayAgentScreen } from "./SetupScreen";

export const RAILWAY_PROVIDER_ID = "railway";

export function useRailwayProvider(
  context: ProviderSetupContext,
): ProviderPlugin {
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [gitCredentialId, setGitCredentialId] = useState<string>();
  const [repositories, setRepositories] = useState<AttachedRepository[]>([]);

  const onReady = useCallback(
    (agentId: string) => {
      setName("");
      setGitCredentialId(undefined);
      setRepositories([]);
      context.onReady(RAILWAY_PROVIDER_ID, agentId);
    },
    [context.onReady],
  );

  const launcher = useRailwayLauncher({
    setSettings: context.setSettings,
    onReady,
    onCredentialsChanged: context.onCredentialsChanged,
    sttProviderId: context.sttProviderId,
    ttsProviderId: context.ttsProviderId,
  });

  useEffect(() => {
    if (
      workspaceId &&
      launcher.workspaces.some((workspace) => workspace.id === workspaceId)
    ) {
      return;
    }
    const preferred =
      launcher.workspaces.find(
        (workspace) => workspace.plan === "HOBBY" || workspace.plan === "PRO",
      ) ?? launcher.workspaces[0];
    setWorkspaceId(preferred?.id ?? "");
  }, [launcher.workspaces, workspaceId]);

  useEffect(() => {
    if (
      gitCredentialId &&
      !context.repositorySetup.credentials.some(
        (entry) => entry.id === gitCredentialId,
      )
    ) {
      setGitCredentialId(undefined);
      setRepositories([]);
    }
  }, [context.repositorySetup.credentials, gitCredentialId]);

  return {
    definition: {
      id: RAILWAY_PROVIDER_ID,
      label: "Railway",
      badge: "AVAILABLE",
      description:
        "Authorize Railway, choose a workspace, and create an isolated agent deployment from this phone.",
      actionLabel: "Continue with Railway",
    },
    prepareSetup() {
      setName("");
      setGitCredentialId(undefined);
      setRepositories([]);
    },
    renderSetup(onBack) {
      const missingVoiceCredentials = (
        [
          ["stt", context.sttProviderId],
          ["tts", context.ttsProviderId],
        ] as const
      ).flatMap(([role, providerId]) => {
        if (findVoiceCredential(context.credentials, providerId)) return [];
        const provider = getVoiceProvider(role, providerId);
        return provider.credentialFields.some((field) => field.secret)
          ? [provider.label]
          : [];
      });
      return (
        <RailwayAgentScreen
          oauthConnected={launcher.oauthConnected}
          oauthBusy={launcher.oauthBusy}
          clientConfigured={launcher.clientConfigured}
          workspaces={launcher.workspaces}
          selectedWorkspaceId={workspaceId}
          name={name}
          missingVoiceCredentials={missingVoiceCredentials}
          repositorySetup={{
            credentials: context.repositorySetup.credentials,
            repositories: context.repositorySetup.repositories,
            selectedCredentialId: gitCredentialId,
            selectedRepositories: repositories,
            busy: context.repositorySetup.busy,
            search: context.repositorySetup.search,
            onSearchChange: context.repositorySetup.onSearchChange,
            onSelectCredential: (entry) => {
              void context.repositorySetup
                .onSelectCredential(entry)
                .then(() => {
                  setGitCredentialId(entry.id);
                  setRepositories([]);
                })
                .catch(() => undefined);
            },
            onRefresh: () => {
              void context.repositorySetup
                .onRefresh()
                .then((next) =>
                  setRepositories((selected) =>
                    preserveAccessibleRepositories(selected, next),
                  ),
                )
                .catch(() => undefined);
            },
            onToggleRepository: (repository) => {
              setRepositories((current) =>
                current.some((item) => item.id === repository.id)
                  ? current.filter((item) => item.id !== repository.id)
                  : [...current, repository],
              );
            },
          }}
          launchPhase={launcher.phaseLabel}
          error={launcher.error}
          onConnect={() => void launcher.connect()}
          onSelectWorkspace={setWorkspaceId}
          onNameChange={setName}
          onOpenAppSettings={context.openAppSettings}
          onLaunch={() =>
            void launcher.launch({
              name,
              workspaceId,
              gitCredentialId,
              repositories,
            })
          }
          onBack={onBack}
        />
      );
    },
    hostLabel() {
      return "Railway";
    },
    async startAgent(profile) {
      await launcher.startAgent(profile);
    },
    async stopAgent(profile) {
      await launcher.stopAgent(profile);
    },
    async replaceAgent(profile) {
      return launcher.replaceAgent(profile);
    },
    async deleteAgent(profile) {
      await launcher.removeAgent(profile);
    },
    deleteConfirmation(profile: AgentProfile) {
      return {
        title: `Delete ${profile.name.trim() || "this"} agent?`,
        message:
          "This permanently deletes the provider deployment and its persistent configuration. Uncommitted work and saved gateway configuration will be lost.",
        actionLabel: "Delete agent",
      };
    },
  };
}
