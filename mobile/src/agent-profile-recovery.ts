import type { AgentProfile } from "./settings";

export function mergeRecoveredAgentProfile(
  current: AgentProfile,
  recovered: AgentProfile,
): AgentProfile {
  return {
    ...current,
    gatewayUrl: recovered.gatewayUrl,
    token: recovered.token,
    gatewayCredentialId: recovered.gatewayCredentialId,
    providerCredentialId: recovered.providerCredentialId,
    hostCredentialIds: recovered.hostCredentialIds,
    origin: recovered.origin,
  };
}
