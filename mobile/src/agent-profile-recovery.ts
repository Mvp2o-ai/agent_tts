import type { AgentProfile } from "./settings";

export function mergeRecoveredAgentProfile(
  current: AgentProfile,
  recovered: AgentProfile,
): AgentProfile {
  const gitCredentialState =
    current.gitCredentialState ?? recovered.gitCredentialState;
  const gitCredentialId =
    gitCredentialState === "disconnected"
      ? undefined
      : current.gitCredentialId ?? recovered.gitCredentialId;
  const merged: AgentProfile = {
    ...current,
    gatewayUrl: recovered.gatewayUrl,
    token: recovered.token,
    gatewayCredentialId: recovered.gatewayCredentialId,
    providerCredentialId: recovered.providerCredentialId,
    hostCredentialIds: recovered.hostCredentialIds,
    origin: recovered.origin,
  };
  if (gitCredentialId) merged.gitCredentialId = gitCredentialId;
  else delete merged.gitCredentialId;
  if (gitCredentialState) merged.gitCredentialState = gitCredentialState;
  return merged;
}
