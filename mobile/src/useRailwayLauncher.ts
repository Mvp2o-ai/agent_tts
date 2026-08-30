import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useState } from "react";
import {
  deleteRailwayAgent as deleteRailwayAgentProject,
  launchRailwayAgent,
  newRailwayProvisioningState,
  railwayPlanSupportsAgent,
  startRailwayAgent,
  stopRailwayAgent,
  type RailwayProvisioningPhase,
  type RailwayProvisioningState,
} from "./providers/railway/driver";
import { authorizeRailwayWithBrowser } from "./providers/railway/auth-session";
import { RAILWAY_OAUTH_CLIENT_ID, serializeRailwayCredential } from "./providers/railway/oauth";
import { listRailwayWorkspaces, type RailwayWorkspace } from "./providers/railway/operations";
import {
  railwayOriginFromState,
  railwayStateFromOrigin,
} from "./providers/railway/persistence";
import {
  railwayProvisioningStore,
  type RailwayProvisioningRecord,
} from "./providers/railway/provisioning-store";
import { requireVoiceSecrets } from "./voice-credentials";
import { AGENT_RUNTIME_IMAGE } from "./providers/runtime-config";
import { createAgentDeploymentSpec } from "./providers/types";
import {
  credentialVault,
  railwayAccessToken,
} from "./secure-credential-vault";
import type { AgentProfile, DeviceSettings } from "./settings";

export interface RailwayLaunchDraft {
  name: string;
  workspaceId: string;
}

export function useRailwayLauncher({
  setSettings,
  onReady,
  onCredentialsChanged,
  sttProviderId,
  ttsProviderId,
}: {
  setSettings: (
    next: DeviceSettings | ((previous: DeviceSettings) => DeviceSettings),
  ) => void;
  onReady: (agentId: string) => void;
  onCredentialsChanged: () => void;
  sttProviderId: string;
  ttsProviderId: string;
}) {
  const [credentialId, setCredentialId] = useState("");
  const [workspaces, setWorkspaces] = useState<RailwayWorkspace[]>([]);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);
  const [phase, setPhase] = useState<RailwayProvisioningPhase | undefined>();
  const [error, setError] = useState("");

  const loadWorkspaces = useCallback(async (id: string) => {
    const accessToken = await railwayAccessToken(id);
    const next = await listRailwayWorkspaces(accessToken);
    setWorkspaces(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    void credentialVault.list().then(async (entries) => {
      const existing = entries.find(
        (entry) =>
          entry.kind === "provider-oauth" && entry.providerId === "railway",
      );
      if (!active || !existing) return;
      setCredentialId(existing.id);
      try {
        const next = await loadWorkspaces(existing.id);
        if (!active) return;
        setWorkspaces(next);
      } catch {
        // Expired or revoked authorization is handled by reconnecting.
      }
    });
    return () => {
      active = false;
    };
  }, [loadWorkspaces]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void railwayProvisioningStore.list().then(async (records) => {
      const recovered = await Promise.all(
        records.map(async (record) => ({
          record,
          token:
            (await credentialVault.getSecret(record.gatewayCredentialId)) ?? "",
        })),
      );
      if (!active || recovered.length === 0) return;
      setSettings((previous) => {
        let agents = previous.agents;
        for (const { record, token } of recovered) {
          const restored = profileFromRecord(record, token);
          const index = agents.findIndex((agent) => agent.id === record.agentId);
          agents =
            index >= 0
              ? agents.map((agent) =>
                  agent.id === record.agentId
                    ? { ...agent, ...restored }
                    : agent,
                )
              : isBlankDefaultProfile(agents)
                ? [restored]
                : [...agents, restored];
        }
        return agents === previous.agents ? previous : { ...previous, agents };
      });

      for (const { record, token } of recovered) {
        if (
          !active ||
          record.state.phase === "ready" ||
          record.state.deploymentState === "stopped"
        ) {
          continue;
        }
        try {
          const [accessToken, voiceSecrets] = await Promise.all([
            railwayAccessToken(record.providerCredentialId),
            loadVoiceSecrets(record.voiceCredentialIds),
          ]);
          if (!token || !voiceSecrets) continue;
          const workspace = (
            await listRailwayWorkspaces(accessToken)
          ).find((candidate) => candidate.id === record.state.workspaceId);
          const deployment = createAgentDeploymentSpec({
            agentName: record.agentName,
            runtimeImage: AGENT_RUNTIME_IMAGE,
            gatewayToken: token,
            voice: {
              sttProviderId: record.sttProviderId,
              ttsProviderId: record.ttsProviderId,
              secrets: voiceSecrets,
            },
          });
          let resumedRecord = record;
          await launchRailwayAgent(
            accessToken,
            {
              ...deployment,
              provisioningId: record.state.provisioningId,
              workspaceId: record.state.workspaceId,
              workspacePlan: workspace?.plan ?? "",
            },
            record.state,
            {
              signal: controller.signal,
              checkpoint: async (state) => {
                resumedRecord = { ...resumedRecord, state };
                await railwayProvisioningStore.save(resumedRecord);
                if (!active) return;
                setSettings((previous) => ({
                  ...previous,
                  agents: previous.agents.map((agent) =>
                    agent.id === record.agentId
                      ? {
                          ...agent,
                          ...profileFromRecord(resumedRecord, token),
                        }
                      : agent,
                  ),
                }));
              },
            },
          );
        } catch {
          // The driver checkpoints a redacted failure for the next retry.
        }
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [setSettings]);

  const connect = useCallback(async () => {
    setOauthBusy(true);
    setError("");
    try {
      const oauth = await authorizeRailwayWithBrowser(
        RAILWAY_OAUTH_CLIENT_ID,
      );
      if (!oauth) return;
      const entries = await credentialVault.list();
      const existing = entries.find(
        (entry) =>
          entry.kind === "provider-oauth" && entry.providerId === "railway",
      );
      const entry = await credentialVault.save({
        id: existing?.id,
        kind: "provider-oauth",
        providerId: "railway",
        label: "Railway account",
        secret: serializeRailwayCredential(oauth),
      });
      setCredentialId(entry.id);
      setWorkspaces(await listRailwayWorkspaces(oauth.accessToken));
      onCredentialsChanged();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setOauthBusy(false);
    }
  }, [onCredentialsChanged]);

  const launch = useCallback(
    async (draft: RailwayLaunchDraft) => {
      const workspace = workspaces.find(
        (candidate) => candidate.id === draft.workspaceId,
      );
      if (!credentialId || !workspace) {
        setError("Connect Railway and choose a workspace first.");
        return;
      }
      if (!railwayPlanSupportsAgent(workspace.plan)) {
        setError(
          `${workspace.name} uses Railway ${workspace.plan}; this runtime requires Hobby or Pro.`,
        );
        return;
      }

      setError("");
      setLaunchBusy(true);
      const agentId = Crypto.randomUUID();
      const provisioningId = Crypto.randomUUID();
      const gatewayToken = randomToken();
      let latestState: RailwayProvisioningState | undefined;
      try {
        const [gatewayEntry, voice] = await Promise.all([
          credentialVault.save({
            kind: "gateway-token",
            label: `${draft.name.trim()} gateway`,
            secret: gatewayToken,
          }),
          requireVoiceSecrets(
            credentialVault,
            sttProviderId,
            ttsProviderId,
          ),
        ]);
        onCredentialsChanged();

        const initialState = newRailwayProvisioningState({
          provisioningId,
          workspaceId: workspace.id,
        });
        latestState = initialState;
        let record: RailwayProvisioningRecord = {
          agentId,
          agentName: draft.name.trim(),
          state: initialState,
          providerCredentialId: credentialId,
          gatewayCredentialId: gatewayEntry.id,
          sttProviderId,
          ttsProviderId,
          voiceCredentialIds: voice.credentialIds,
        };
        await railwayProvisioningStore.save(record);
        const profile = profileFromRecord(record, gatewayToken);
        setSettings((previous) => ({
          ...previous,
          agents: isBlankDefaultProfile(previous.agents)
            ? [profile]
            : [...previous.agents, profile],
          activeAgentId: agentId,
        }));

        const accessToken = await railwayAccessToken(credentialId);
        const deployment = createAgentDeploymentSpec({
          agentName: draft.name,
          runtimeImage: AGENT_RUNTIME_IMAGE,
          gatewayToken,
          voice: {
            sttProviderId,
            ttsProviderId,
            secrets: voice.secrets,
          },
        });
        const ready = await launchRailwayAgent(
          accessToken,
          {
            ...deployment,
            provisioningId,
            workspaceId: workspace.id,
            workspacePlan: workspace.plan,
          },
          initialState,
          {
            checkpoint: async (state) => {
              latestState = state;
              record = { ...record, state };
              await railwayProvisioningStore.save(record);
              setPhase(state.phase);
              setSettings((previous) => ({
                ...previous,
                agents: previous.agents.map((agent) =>
                  agent.id === agentId
                    ? {
                        ...agent,
                        gatewayUrl: state.domain
                          ? `https://${state.domain}`
                          : agent.gatewayUrl,
                        origin: railwayOriginFromState(state),
                      }
                    : agent,
                ),
              }));
            },
          },
        );
        latestState = ready;
        onReady(agentId);
      } catch (cause) {
        setError(
          latestState?.lastError ??
            messageOf(cause) ??
            "Railway could not finish launching this agent.",
        );
      } finally {
        setPhase(undefined);
        setLaunchBusy(false);
      }
    },
    [
      credentialId,
      onCredentialsChanged,
      onReady,
      setSettings,
      sttProviderId,
      ttsProviderId,
      workspaces,
    ],
  );

  const runLifecycle = useCallback(
    async (profile: AgentProfile, action: "start" | "stop") => {
      const records = await railwayProvisioningStore.list();
      const record = records.find((candidate) => candidate.agentId === profile.id);
      const originState = profile.origin
        ? railwayStateFromOrigin(profile.origin)
        : null;
      const state = originState ?? record?.state;
      const providerCredentialId =
        profile.providerCredentialId ?? record?.providerCredentialId;
      if (!record || !state || !providerCredentialId) {
        throw new Error("Railway lifecycle metadata is incomplete.");
      }
      const accessToken = await railwayAccessToken(providerCredentialId);
      const checkpoint = async (next: RailwayProvisioningState) => {
        await railwayProvisioningStore.save({
          ...record,
          agentName: profile.name,
          state: next,
        });
        setPhase(next.phase);
        setSettings((previous) => ({
          ...previous,
          agents: previous.agents.map((candidate) =>
            candidate.id === profile.id
              ? { ...candidate, origin: railwayOriginFromState(next) }
              : candidate,
          ),
        }));
      };
      try {
        return action === "stop"
          ? await stopRailwayAgent(accessToken, state, { checkpoint })
          : await startRailwayAgent(accessToken, state, { checkpoint });
      } finally {
        setPhase(undefined);
      }
    },
    [setSettings],
  );

  const stopAgent = useCallback(
    (profile: AgentProfile) => runLifecycle(profile, "stop"),
    [runLifecycle],
  );

  const startAgent = useCallback(
    (profile: AgentProfile) => runLifecycle(profile, "start"),
    [runLifecycle],
  );

  const replaceAgent = useCallback(
    async (profile: AgentProfile) => {
      setError("");
      setLaunchBusy(true);
      try {
        const records = await railwayProvisioningStore.list();
        const previous = records.find(
          (candidate) => candidate.agentId === profile.id,
        );
        if (!previous) {
          throw new Error("Railway replacement metadata is incomplete.");
        }

        const [accessToken, gatewayToken, voiceSecrets] = await Promise.all([
          railwayAccessToken(previous.providerCredentialId),
          credentialVault.getSecret(previous.gatewayCredentialId),
          loadVoiceSecrets(previous.voiceCredentialIds),
        ]);
        if (!gatewayToken || !voiceSecrets) {
          throw new Error("Saved deployment credentials are incomplete.");
        }

        const availableWorkspaces =
          workspaces.length > 0
            ? workspaces
            : await loadWorkspaces(previous.providerCredentialId);
        const workspace = availableWorkspaces.find(
          (candidate) => candidate.id === previous.state.workspaceId,
        );
        if (!workspace) {
          throw new Error("The original Railway workspace is unavailable.");
        }
        if (!railwayPlanSupportsAgent(workspace.plan)) {
          throw new Error(
            `${workspace.name} uses Railway ${workspace.plan}; this runtime requires Hobby or Pro.`,
          );
        }

        const initialState = newRailwayProvisioningState({
          provisioningId: Crypto.randomUUID(),
          workspaceId: workspace.id,
        });
        let replacement: RailwayProvisioningRecord = {
          ...previous,
          agentName: profile.name.trim(),
          state: initialState,
        };
        await railwayProvisioningStore.save(replacement);
        setSettings((current) => ({
          ...current,
          agents: current.agents.map((agent) =>
            agent.id === profile.id
              ? {
                  ...agent,
                  desiredState: "running",
                  origin: railwayOriginFromState(initialState),
                }
              : agent,
          ),
        }));

        const deployment = createAgentDeploymentSpec({
          agentName: profile.name,
          runtimeImage: AGENT_RUNTIME_IMAGE,
          gatewayToken,
          voice: {
            sttProviderId: previous.sttProviderId,
            ttsProviderId: previous.ttsProviderId,
            secrets: voiceSecrets,
          },
        });
        const ready = await launchRailwayAgent(
          accessToken,
          {
            ...deployment,
            provisioningId: initialState.provisioningId,
            workspaceId: workspace.id,
            workspacePlan: workspace.plan,
          },
          initialState,
          {
            checkpoint: async (state) => {
              replacement = { ...replacement, state };
              await railwayProvisioningStore.save(replacement);
              setPhase(state.phase);
              setSettings((current) => ({
                ...current,
                agents: current.agents.map((agent) =>
                  agent.id === profile.id
                    ? {
                        ...agent,
                        gatewayUrl: state.domain
                          ? `https://${state.domain}`
                          : agent.gatewayUrl,
                        origin: railwayOriginFromState(state),
                      }
                    : agent,
                ),
              }));
            },
          },
        );
        if (!ready.domain) {
          throw new Error("Railway replacement has no domain.");
        }
        onReady(profile.id);
        return { gatewayUrl: `https://${ready.domain}` };
      } catch (cause) {
        const message = messageOf(cause);
        setError(message);
        throw cause;
      } finally {
        setPhase(undefined);
        setLaunchBusy(false);
      }
    },
    [loadWorkspaces, onReady, setSettings, workspaces],
  );

  const removeAgent = useCallback(
    async (profile: AgentProfile) => {
      const records = await railwayProvisioningStore.list();
      const record = records.find(
        (candidate) => candidate.agentId === profile.id,
      );
      const state = profile.origin
        ? railwayStateFromOrigin(profile.origin)
        : record?.state;
      const providerCredentialId =
        profile.providerCredentialId ?? record?.providerCredentialId;
      if (!state || !providerCredentialId) {
        throw new Error("Railway deletion metadata is incomplete.");
      }
      const accessToken = await railwayAccessToken(providerCredentialId);
      await deleteRailwayAgentProject(accessToken, state);
      await railwayProvisioningStore.remove(profile.id);
      const gatewayCredentialId =
        profile.gatewayCredentialId ?? record?.gatewayCredentialId;
      if (gatewayCredentialId) {
        await credentialVault.remove(gatewayCredentialId);
        onCredentialsChanged();
      }
    },
    [onCredentialsChanged],
  );

  return {
    clientConfigured: Boolean(RAILWAY_OAUTH_CLIENT_ID),
    oauthConnected: Boolean(credentialId),
    oauthBusy,
    workspaces,
    phase,
    phaseLabel: launchBusy
      ? labelForPhase(phase ?? "draft")
      : "",
    error,
    connect,
    launch,
    stopAgent,
    startAgent,
    replaceAgent,
    removeAgent,
  };
}

function randomToken(): string {
  return Array.from(Crypto.getRandomBytes(32), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function loadVoiceSecrets(
  credentialIds: Record<string, string>,
): Promise<Record<string, string> | null> {
  const entries = Object.entries(credentialIds);
  if (entries.length === 0) return null;
  const resolved = await Promise.all(
    entries.map(async ([env, credentialId]) => [
      env,
      await credentialVault.getSecret(credentialId),
    ] as const),
  );
  if (resolved.some(([, secret]) => !secret?.trim())) return null;
  return Object.fromEntries(
    resolved.map(([env, secret]) => [env, secret as string]),
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Railway connection failed";
}

function profileFromRecord(
  record: RailwayProvisioningRecord,
  gatewayToken: string,
): AgentProfile {
  return {
    id: record.agentId,
    name: record.agentName,
    gatewayUrl: record.state.domain ? `https://${record.state.domain}` : "",
    token: gatewayToken,
    gatewayCredentialId: record.gatewayCredentialId,
    providerCredentialId: record.providerCredentialId,
    hostCredentialIds: {
      ...record.voiceCredentialIds,
    },
    origin: railwayOriginFromState(record.state),
  };
}

function labelForPhase(phase: RailwayProvisioningPhase): string {
  const labels: Record<RailwayProvisioningPhase, string> = {
    draft: "Preparing launch",
    creating_project: "Creating Railway project",
    creating_service: "Creating runtime service",
    creating_volume: "Attaching persistent config volume",
    configuring_service: "Configuring runtime image",
    setting_variables: "Saving runtime secrets",
    creating_domain: "Creating HTTPS endpoint",
    connecting_image: "Connecting the runtime image",
    deploying: "Starting deployment",
    waiting_for_health: "Waiting for the agent deployment to become healthy",
    ready: "Agent deployment is ready",
    failed: "Launch failed",
  };
  return labels[phase];
}

function isBlankDefaultProfile(agents: AgentProfile[]): boolean {
  return (
    agents.length === 1 &&
    !agents[0]?.token.trim() &&
    !agents[0]?.gatewayCredentialId &&
    !agents[0]?.origin &&
    (!agents[0]?.gatewayUrl || agents[0].gatewayUrl === "http://")
  );
}
