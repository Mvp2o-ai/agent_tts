import type { AgentDesiredState, AgentProfile } from "./settings";
import type { SessionStatus } from "./session-lifecycle";

export type AgentLifecycleState =
  | "needs-setup"
  | "stopped"
  | "starting"
  | "running"
  | "unreachable"
  | "gone"
  | "error";

export type AgentReachability =
  | "unknown"
  | "reachable"
  | "unreachable"
  | "gone";

export type AgentConfigurationIssue =
  | "missing-endpoint"
  | "invalid-endpoint"
  | "missing-credentials";

export interface AgentLifecycleInput {
  profile: AgentProfile;
  /**
   * Voice connectivity is intentionally separate from host reachability:
   * a running host can have no active voice socket.
   */
  sessionStatus?: SessionStatus;
  /**
   * Callers should set this from an actual health/reachability check. An
   * unknown value must not be treated as a failed check.
   */
  reachability?: AgentReachability;
}

const DEFAULT_DESIRED_STATE: AgentDesiredState = "running";

/**
 * Returns a configuration issue that is actionable before attempting a
 * session. Missing values are setup work; malformed endpoint values are
 * errors.
 */
export function agentConfigurationIssue(
  profile: AgentProfile,
): AgentConfigurationIssue | null {
  const endpoint = profile.gatewayUrl.trim();
  if (!endpoint || endpoint === "http://" || endpoint === "https://") {
    return "missing-endpoint";
  }
  if (!isGatewayEndpoint(endpoint)) return "invalid-endpoint";
  if (!profile.token.trim() && !profile.gatewayCredentialId?.trim()) {
    return "missing-credentials";
  }
  return null;
}

export function hasProviderProvisioningFailure(profile: AgentProfile): boolean {
  const origin = profile.origin;
  return (
    origin?.kind === "provider" &&
    (origin.provisioningPhase === "failed" ||
      (Boolean(origin.lastError) && origin.provisioningPhase !== "ready"))
  );
}

function providerIsProvisioning(profile: AgentProfile): boolean {
  const phase = profile.origin?.provisioningPhase;
  return (
    profile.origin?.kind === "provider" &&
    Boolean(phase) &&
    phase !== "ready" &&
    phase !== "failed"
  );
}

function desiredState(profile: AgentProfile): AgentDesiredState {
  return profile.desiredState === "stopped"
    ? "stopped"
    : DEFAULT_DESIRED_STATE;
}

/**
 * Derives the stable UI lifecycle state without performing network or
 * provider work. Configuration and provider failures take precedence over a
 * desired stop; an explicit unreachable signal takes precedence over a stale
 * voice-session state.
 */
export function deriveAgentLifecycle({
  profile,
  sessionStatus = "disconnected",
  reachability = "unknown",
}: AgentLifecycleInput): AgentLifecycleState {
  const configuration = agentConfigurationIssue(profile);
  if (configuration === "invalid-endpoint") return "error";
  if (reachability === "gone") return "gone";
  if (hasProviderProvisioningFailure(profile)) return "error";
  if (providerIsProvisioning(profile)) {
    return desiredState(profile) === "stopped" ? "stopped" : "starting";
  }
  if (
    configuration === "missing-endpoint" ||
    configuration === "missing-credentials"
  ) {
    return "needs-setup";
  }
  if (desiredState(profile) === "stopped") return "stopped";
  if (reachability === "unreachable") return "unreachable";
  if (sessionStatus === "connecting" || sessionStatus === "provisioning") {
    return "starting";
  }
  if (sessionStatus === "ready" || reachability === "reachable") {
    return "running";
  }
  return "running";
}

function isGatewayEndpoint(value: string): boolean {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return false;
  }
  try {
    return Boolean(new URL(value).hostname);
  } catch {
    return false;
  }
}
