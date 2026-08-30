import type { AgentOriginMetadata } from "../../settings";
import type {
  RailwayProvisioningPhase,
  RailwayProvisioningState,
} from "./driver";

const PHASES: readonly RailwayProvisioningPhase[] = [
  "draft",
  "creating_project",
  "creating_service",
  "creating_volume",
  "configuring_service",
  "setting_variables",
  "creating_domain",
  "connecting_image",
  "deploying",
  "waiting_for_health",
  "ready",
  "failed",
];

const MUTATIONS = ["project", "service", "volume", "domain", "deployment"] as const;

export function railwayOriginFromState(
  state: RailwayProvisioningState,
): AgentOriginMetadata {
  return {
    kind: "provider",
    providerId: "railway",
    provisioningId: state.provisioningId,
    provisioningPhase: state.phase,
    endpointHostname: state.domain,
    lastError: state.lastError,
    resourceIds: compact({
      projectId: state.projectId,
      environmentId: state.environmentId,
      serviceId: state.serviceId,
      volumeId: state.volumeId,
      domainId: state.domainId,
      deploymentId: state.deploymentId,
    }),
    provisioningDetails: compact({
      workspaceId: state.workspaceId,
      projectName: state.projectName,
      domain: state.domain,
      deploymentState: state.deploymentState,
      pendingMutation: state.pendingMutation,
      updatedAt: String(state.updatedAt),
    }),
  };
}

export function railwayStateFromOrigin(
  origin: AgentOriginMetadata,
): RailwayProvisioningState | null {
  if (
    origin.kind !== "provider" ||
    origin.providerId !== "railway" ||
    !origin.provisioningId ||
    !isPhase(origin.provisioningPhase)
  ) {
    return null;
  }
  const details = origin.provisioningDetails ?? {};
  const workspaceId = details.workspaceId;
  const projectName = details.projectName;
  if (!workspaceId || !projectName) return null;

  const resources = origin.resourceIds ?? {};
  const deploymentState =
    details.deploymentState === "running" ||
    details.deploymentState === "stopped"
      ? details.deploymentState
      : undefined;
  const pendingMutation = MUTATIONS.find(
    (value) => value === details.pendingMutation,
  );
  const updatedAt = Number(details.updatedAt);
  return {
    providerId: "railway",
    provisioningId: origin.provisioningId,
    phase: origin.provisioningPhase,
    ...(deploymentState ? { deploymentState } : {}),
    workspaceId,
    projectName,
    ...(resources.projectId ? { projectId: resources.projectId } : {}),
    ...(resources.environmentId
      ? { environmentId: resources.environmentId }
      : {}),
    ...(resources.serviceId ? { serviceId: resources.serviceId } : {}),
    ...(resources.volumeId ? { volumeId: resources.volumeId } : {}),
    ...(resources.domainId ? { domainId: resources.domainId } : {}),
    ...(details.domain ? { domain: details.domain } : {}),
    ...(resources.deploymentId
      ? { deploymentId: resources.deploymentId }
      : {}),
    ...(pendingMutation ? { pendingMutation } : {}),
    ...(origin.lastError ? { lastError: origin.lastError } : {}),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function compact(
  values: Record<string, string | undefined>,
): Record<string, string> | undefined {
  const entries = Object.entries(values).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isPhase(value: string | undefined): value is RailwayProvisioningPhase {
  return PHASES.includes(value as RailwayProvisioningPhase);
}
