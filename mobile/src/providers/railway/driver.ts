import type { AgentDeploymentSpec } from "../types";
import {
  connectRailwayServiceImage,
  configureRailwayService,
  createRailwayDomain,
  createRailwayProject,
  createRailwayService,
  createRailwayVolume,
  deleteRailwayProject,
  deployFreshRailwayService,
  deployRailwayService,
  getLatestRailwayDeployment,
  getRailwayDeployment,
  getRailwayServiceImage,
  stopRailwayDeployment,
  TERMINAL_DEPLOYMENT_FAILURES,
  upsertRailwayVariables,
} from "./operations";
import type { RailwayGraphqlRequest } from "./graphql";

export type RailwayProvisioningPhase =
  | "draft"
  | "creating_project"
  | "creating_service"
  | "creating_volume"
  | "configuring_service"
  | "setting_variables"
  | "creating_domain"
  | "connecting_image"
  | "deploying"
  | "waiting_for_health"
  | "ready"
  | "failed";

export interface RailwayProvisioningState {
  providerId: "railway";
  provisioningId: string;
  phase: RailwayProvisioningPhase;
  deploymentState?: "running" | "stopped";
  workspaceId: string;
  projectName: string;
  projectId?: string;
  environmentId?: string;
  serviceId?: string;
  volumeId?: string;
  domainId?: string;
  domain?: string;
  deploymentId?: string;
  pendingMutation?: "project" | "service" | "volume" | "domain" | "deployment";
  lastError?: string;
  updatedAt: number;
}

export interface RailwayLaunchSpec extends AgentDeploymentSpec {
  provisioningId: string;
  workspaceId: string;
  workspacePlan: string;
}

export interface RailwayDriverOptions {
  graphqlRequest?: RailwayGraphqlRequest;
  healthRequest?: typeof fetch;
  checkpoint: (state: RailwayProvisioningState) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  maxPolls?: number;
}

export function newRailwayProvisioningState(
  spec: Pick<RailwayLaunchSpec, "provisioningId" | "workspaceId">,
  now: () => number = Date.now,
): RailwayProvisioningState {
  return {
    providerId: "railway",
    provisioningId: spec.provisioningId,
    phase: "draft",
    workspaceId: spec.workspaceId,
    projectName: railwayProjectName(spec.provisioningId),
    updatedAt: now(),
  };
}

export function railwayPlanSupportsAgent(plan: string): boolean {
  return plan === "HOBBY" || plan === "PRO";
}

export async function launchRailwayAgent(
  accessToken: string,
  spec: RailwayLaunchSpec,
  initialState: RailwayProvisioningState,
  options: RailwayDriverOptions,
): Promise<RailwayProvisioningState> {
  validateLaunch(spec, initialState);
  assertKnownMutationOutcomes(initialState);

  const request = options.graphqlRequest;
  const now = options.now ?? Date.now;
  let state = { ...initialState };

  const checkpoint = async (
    patch: Partial<RailwayProvisioningState>,
  ): Promise<void> => {
    state = {
      ...state,
      ...patch,
      updatedAt: now(),
    };
    await options.checkpoint(state);
  };

  try {
    throwIfCancelled(options.signal);
    if (!state.projectId) {
      await checkpoint({
        phase: "creating_project",
        pendingMutation: "project",
        lastError: undefined,
      });
      const project = await createRailwayProject(
        accessToken,
        {
          workspaceId: spec.workspaceId,
          name: state.projectName,
        },
        request,
      );
      await checkpoint({
        projectId: project.id,
        environmentId: project.primaryEnvironmentId,
        pendingMutation: undefined,
      });
    }

    throwIfCancelled(options.signal);
    if (!state.serviceId) {
      await checkpoint({
        phase: "creating_service",
        pendingMutation: "service",
      });
      const service = await createRailwayService(
        accessToken,
        {
          projectId: required(state.projectId, "Railway project"),
          environmentId: required(
            state.environmentId,
            "Railway environment",
          ),
          name: "agent-runtime",
        },
        request,
      );
      await checkpoint({ serviceId: service.id, pendingMutation: undefined });
    }

    throwIfCancelled(options.signal);
    if (!state.volumeId) {
      await checkpoint({
        phase: "creating_volume",
        pendingMutation: "volume",
      });
      const volume = await createRailwayVolume(
        accessToken,
        {
          projectId: required(state.projectId, "Railway project"),
          environmentId: required(
            state.environmentId,
            "Railway environment",
          ),
          serviceId: required(state.serviceId, "Railway service"),
          mountPath: spec.host.configMountPath,
        },
        request,
      );
      await checkpoint({ volumeId: volume.id, pendingMutation: undefined });
    }

    throwIfCancelled(options.signal);
    await checkpoint({ phase: "configuring_service" });
    await configureRailwayService(
      accessToken,
      {
        serviceId: required(state.serviceId, "Railway service"),
        environmentId: required(state.environmentId, "Railway environment"),
        healthcheckPath: spec.host.healthPath,
        replicas: spec.host.replicas,
        restartOnCleanExit: spec.host.restartOnCleanExit,
        sleepWhenIdle: spec.host.sleepWhenIdle,
      },
      request,
    );

    throwIfCancelled(options.signal);
    await checkpoint({ phase: "setting_variables" });
    await upsertRailwayVariables(
      accessToken,
      {
        projectId: required(state.projectId, "Railway project"),
        environmentId: required(state.environmentId, "Railway environment"),
        serviceId: required(state.serviceId, "Railway service"),
        variables: {
          CONFIG_DB: "/data/agent_tts.db",
          GATEWAY_TOKEN: spec.gatewayToken,
          STT_PROVIDER: spec.voice.sttProviderId,
          TTS_PROVIDER: spec.voice.ttsProviderId,
          ...spec.voice.secrets,
        },
      },
      request,
    );

    throwIfCancelled(options.signal);
    if (!state.domain) {
      await checkpoint({
        phase: "creating_domain",
        pendingMutation: "domain",
      });
      const domain = await createRailwayDomain(
        accessToken,
        {
          serviceId: required(state.serviceId, "Railway service"),
          environmentId: required(
            state.environmentId,
            "Railway environment",
          ),
        },
        request,
      );
      await checkpoint({
        domainId: domain.id,
        domain: domain.domain,
        pendingMutation: undefined,
      });
    }

    throwIfCancelled(options.signal);
    if (state.deploymentId) {
      const observedDeployment = await getRailwayDeployment(
        accessToken,
        state.deploymentId,
        request,
      );
      if (TERMINAL_DEPLOYMENT_FAILURES.has(observedDeployment.status)) {
        await checkpoint({
          deploymentId: undefined,
          pendingMutation: undefined,
        });
      }
    }

    throwIfCancelled(options.signal);
    if (!state.deploymentId) {
      await checkpoint({ phase: "connecting_image" });
      const serviceId = required(state.serviceId, "Railway service");
      const environmentId = required(
        state.environmentId,
        "Railway environment",
      );
      const currentImage = await getRailwayServiceImage(
        accessToken,
        { serviceId, environmentId },
        request,
      );
      if (currentImage !== spec.runtimeImage) {
        await connectRailwayServiceImage(
          accessToken,
          { serviceId, image: spec.runtimeImage },
          request,
        );
      }

      await checkpoint({
        phase: "deploying",
        pendingMutation: "deployment",
      });
      const existingDeployment = await getLatestRailwayDeployment(
        accessToken,
        {
          projectId: required(state.projectId, "Railway project"),
          serviceId,
          environmentId,
        },
        request,
      );
      const deploymentId =
        existingDeployment &&
        !TERMINAL_DEPLOYMENT_FAILURES.has(existingDeployment.status)
          ? existingDeployment.id
          : await deployRailwayService(
              accessToken,
              { serviceId, environmentId },
              request,
            );
      await checkpoint({ deploymentId, pendingMutation: undefined });
    }

    await checkpoint({ phase: "waiting_for_health" });
    await waitForRailwayAgent(accessToken, state, options);
    await checkpoint({
      phase: "ready",
      deploymentState: "running",
      pendingMutation: undefined,
      lastError: undefined,
    });
    return state;
  } catch (error) {
    const message = redactLaunchError(error, spec);
    await checkpoint({ phase: "failed", lastError: message });
    throw error;
  }
}

export async function stopRailwayAgent(
  accessToken: string,
  initialState: RailwayProvisioningState,
  options: RailwayDriverOptions,
): Promise<RailwayProvisioningState> {
  if (initialState.deploymentState === "stopped") return initialState;
  const deploymentId = required(
    initialState.deploymentId,
    "Railway deployment",
  );
  throwIfCancelled(options.signal);
  await stopRailwayDeployment(
    accessToken,
    deploymentId,
    options.graphqlRequest,
  );

  const now = options.now ?? Date.now;
  const stopped = {
    ...initialState,
    deploymentState: "stopped" as const,
    pendingMutation: undefined,
    lastError: undefined,
    updatedAt: now(),
  };
  await options.checkpoint(stopped);
  return stopped;
}

export async function deleteRailwayAgent(
  accessToken: string,
  state: RailwayProvisioningState,
  options: Pick<RailwayDriverOptions, "graphqlRequest" | "signal"> = {},
): Promise<void> {
  throwIfCancelled(options.signal);
  await deleteRailwayProject(
    accessToken,
    required(state.projectId, "Railway project"),
    options.graphqlRequest,
  );
}

export async function startRailwayAgent(
  accessToken: string,
  initialState: RailwayProvisioningState,
  options: RailwayDriverOptions,
): Promise<RailwayProvisioningState> {
  if (initialState.deploymentState !== "stopped") {
    throw new Error("Railway agent must be stopped before starting a fresh deployment");
  }
  required(initialState.serviceId, "Railway service");
  required(initialState.environmentId, "Railway environment");
  required(initialState.domain, "Railway domain");

  const request = options.graphqlRequest;
  const now = options.now ?? Date.now;
  let state = { ...initialState };
  const checkpoint = async (
    patch: Partial<RailwayProvisioningState>,
  ): Promise<void> => {
    state = {
      ...state,
      ...patch,
      updatedAt: now(),
    };
    await options.checkpoint(state);
  };

  try {
    throwIfCancelled(options.signal);
    await checkpoint({
      phase: "deploying",
      deploymentState: undefined,
      deploymentId: undefined,
      pendingMutation: "deployment",
      lastError: undefined,
    });
    const deploymentId = await deployFreshRailwayService(
      accessToken,
      {
        serviceId: required(state.serviceId, "Railway service"),
        environmentId: required(state.environmentId, "Railway environment"),
      },
      request,
    );
    await checkpoint({
      deploymentId,
      pendingMutation: undefined,
    });

    throwIfCancelled(options.signal);
    await checkpoint({ phase: "waiting_for_health" });
    await waitForRailwayAgent(accessToken, state, options);
    await checkpoint({
      phase: "ready",
      deploymentState: "running",
      pendingMutation: undefined,
      lastError: undefined,
    });
    return state;
  } catch (error) {
    await checkpoint({
      phase: "failed",
      deploymentState: "stopped",
      lastError: error instanceof Error ? error.message : "Railway start failed",
    });
    throw error;
  }
}

async function waitForRailwayAgent(
  accessToken: string,
  state: RailwayProvisioningState,
  options: RailwayDriverOptions,
): Promise<void> {
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const interval = options.pollIntervalMs ?? 5_000;
  const maxPolls = options.maxPolls ?? 120;
  const deploymentId = required(state.deploymentId, "Railway deployment");

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    throwIfCancelled(options.signal);
    const deployment = await getRailwayDeployment(
      accessToken,
      deploymentId,
      options.graphqlRequest,
    );
    if (deployment.status === "SUCCESS") {
      try {
        await verifyAgentHealth(
          required(state.domain, "Railway domain"),
          options.healthRequest ?? fetch,
          options.signal,
        );
        return;
      } catch (error) {
        if (attempt === maxPolls - 1) throw error;
      }
    }
    if (TERMINAL_DEPLOYMENT_FAILURES.has(deployment.status)) {
      throw new Error(`Railway deployment ${deployment.status.toLowerCase()}`);
    }
    if (attempt < maxPolls - 1) await sleep(interval);
  }
  throw new Error("Railway deployment timed out");
}

async function verifyAgentHealth(
  domain: string,
  request: typeof fetch,
  signal?: AbortSignal,
): Promise<void> {
  const response = await request(`https://${domain}/health`, { signal });
  if (!response.ok) {
    throw new Error(`Agent health check failed: ${response.status}`);
  }
  const body = (await response.json()) as { ok?: unknown };
  if (body.ok !== true) throw new Error("Agent health check returned invalid data");
}

function validateLaunch(
  spec: RailwayLaunchSpec,
  state: RailwayProvisioningState,
): void {
  if (!railwayPlanSupportsAgent(spec.workspacePlan)) {
    throw new Error("Railway Hobby or Pro is required for Always restart");
  }
  if (
    state.providerId !== "railway" ||
    state.provisioningId !== spec.provisioningId ||
    state.workspaceId !== spec.workspaceId
  ) {
    throw new Error("Railway provisioning state does not match this launch");
  }
  required(spec.gatewayToken, "Gateway token");
  required(spec.voice.sttProviderId, "STT provider");
  required(spec.voice.ttsProviderId, "TTS provider");
  for (const [env, secret] of Object.entries(spec.voice.secrets)) {
    required(secret, `Voice secret ${env}`);
  }
}

function assertKnownMutationOutcomes(state: RailwayProvisioningState): void {
  const unknown =
    (state.pendingMutation === "project" && !state.projectId) ||
    (state.pendingMutation === "service" && !state.serviceId) ||
    (state.pendingMutation === "volume" && !state.volumeId) ||
    (state.pendingMutation === "domain" && !state.domain) ||
    (state.pendingMutation === "deployment" && !state.deploymentId);
  if (unknown) {
    throw new Error(
      "Railway launch stopped after a create request with an unknown outcome; reconcile it in Railway before retrying",
    );
  }
}

function railwayProjectName(provisioningId: string): string {
  const suffix = provisioningId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 16);
  if (!suffix) throw new Error("Provisioning ID is invalid");
  return `agent-tts-${suffix}`;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Railway launch cancelled");
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is missing`);
  return value;
}

function redactLaunchError(
  error: unknown,
  spec: RailwayLaunchSpec,
): string {
  const raw = error instanceof Error ? error.message : "Railway launch failed";
  return [
    spec.gatewayToken,
    ...Object.values(spec.voice.secrets),
  ].reduce(
    (message, secret) => (secret ? message.split(secret).join("[redacted]") : message),
    raw,
  );
}
