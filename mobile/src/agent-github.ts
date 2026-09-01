import type {
  AgentProfile,
  AttachedRepository,
} from "./settings";
import { preserveAccessibleRepositories } from "./repository-selection";

/** Bind one identity without making repository API availability a prerequisite. */
export function bindAgentGithubIdentity(
  profile: AgentProfile,
  credentialId: string,
): AgentProfile {
  return {
    ...profile,
    gitCredentialId: credentialId,
    gitCredentialState: "connected",
    repositories:
      profile.gitCredentialId && profile.gitCredentialId !== credentialId
        ? []
        : profile.repositories,
    runtime: {
      ...(profile.runtime ?? {}),
      repoUrl: "github.com",
    },
  };
}

/**
 * Bind exactly one GitHub identity to an agent and keep only startup
 * repositories that the replacement identity can still access.
 */
export function connectAgentGithub(
  profile: AgentProfile,
  credentialId: string,
  accessibleRepositories: readonly AttachedRepository[],
): AgentProfile {
  const bound = bindAgentGithubIdentity(profile, credentialId);
  return {
    ...bound,
    repositories: preserveAccessibleRepositories(
      profile.repositories ?? [],
      accessibleRepositories,
    ),
  };
}

/** Disconnect only this agent and remove its now-unprovisionable clone set. */
export function disconnectAgentGithub(profile: AgentProfile): AgentProfile {
  const { gitCredentialId: _credentialId, ...withoutCredential } = profile;
  return {
    ...withoutCredential,
    gitCredentialState: "disconnected",
    repositories: [],
  };
}

export function toggleAgentRepository(
  profile: AgentProfile,
  repository: AttachedRepository,
): AgentProfile {
  const selected = profile.repositories ?? [];
  return {
    ...profile,
    repositories: selected.some((item) => item.id === repository.id)
      ? selected.filter((item) => item.id !== repository.id)
      : [...selected, repository],
  };
}
