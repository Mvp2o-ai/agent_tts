import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AttachedRepository } from "../../settings";
import type { RailwayProvisioningState } from "./driver";

const KEY_PREFIX = "agent_tts.railwayProvisioning.v1.";

export interface RailwayProvisioningRecord {
  agentId: string;
  agentName: string;
  state: RailwayProvisioningState;
  providerCredentialId: string;
  gatewayCredentialId: string;
  sttProviderId: string;
  ttsProviderId: string;
  gitCredentialId?: string;
  gitCredentialState?: "connected" | "disconnected";
  repositories?: AttachedRepository[];
  /** env -> vault credential id. Never store secrets here. */
  voiceCredentialIds: Record<string, string>;
}

export interface ProvisioningKeyValueStore {
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<readonly [string, string | null][]>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createRailwayProvisioningStore(
  storage: ProvisioningKeyValueStore,
) {
  const pendingWrites = new Map<string, Promise<void>>();
  const keyFor = (agentId: string) =>
    `${KEY_PREFIX}${encodeURIComponent(agentId)}`;
  const withWriteLock = async <T>(
    agentId: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const previous = pendingWrites.get(agentId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(operation);
    const settled = task.then(
      () => undefined,
      () => undefined,
    );
    pendingWrites.set(agentId, settled);
    try {
      return await task;
    } finally {
      if (pendingWrites.get(agentId) === settled) {
        pendingWrites.delete(agentId);
      }
    }
  };
  const read = async (
    agentId: string,
  ): Promise<RailwayProvisioningRecord | undefined> => {
    const rows = await storage.multiGet([keyFor(agentId)]);
    const raw = rows[0]?.[1];
    if (!raw) return undefined;
    const record = migrateRecord(JSON.parse(raw) as UnknownRecord);
    validateRecord(record);
    return record;
  };
  const write = async (record: RailwayProvisioningRecord): Promise<void> => {
    validateRecord(record);
    await storage.setItem(
      keyFor(record.agentId),
      JSON.stringify(serializableRecord(record)),
    );
  };

  return {
    async save(record: RailwayProvisioningRecord): Promise<void> {
      await withWriteLock(record.agentId, () => write(record));
    },

    async saveLifecycle(record: RailwayProvisioningRecord): Promise<RailwayProvisioningRecord> {
      return withWriteLock(record.agentId, async () => {
        const current = await read(record.agentId);
        if (!current) {
          await write(record);
          return record;
        }
        const merged: RailwayProvisioningRecord = {
          ...record,
          repositories: current.repositories ?? [],
        };
        delete merged.gitCredentialId;
        delete merged.gitCredentialState;
        if (current.gitCredentialId) {
          merged.gitCredentialId = current.gitCredentialId;
        }
        if (current.gitCredentialState) {
          merged.gitCredentialState = current.gitCredentialState;
        }
        await write(merged);
        return merged;
      });
    },

    async updateGithub(
      agentId: string,
      gitCredentialId: string | undefined,
      repositories: AttachedRepository[],
    ): Promise<RailwayProvisioningRecord | undefined> {
      return withWriteLock(agentId, async () => {
        const current = await read(agentId);
        if (!current) return undefined;
        const next: RailwayProvisioningRecord = {
          ...current,
          repositories,
          gitCredentialState: gitCredentialId
            ? "connected"
            : "disconnected",
        };
        if (gitCredentialId) next.gitCredentialId = gitCredentialId;
        else delete next.gitCredentialId;
        await write(next);
        return next;
      });
    },

    async updateProviderCredential(
      agentId: string,
      providerCredentialId: string,
    ): Promise<RailwayProvisioningRecord | undefined> {
      return withWriteLock(agentId, async () => {
        const current = await read(agentId);
        if (!current) return undefined;
        const next = { ...current, providerCredentialId };
        await write(next);
        return next;
      });
    },

    async list(): Promise<RailwayProvisioningRecord[]> {
      await Promise.all([...pendingWrites.values()]);
      const keys = (await storage.getAllKeys()).filter((key) =>
        key.startsWith(KEY_PREFIX),
      );
      if (keys.length === 0) return [];
      const rows = await storage.multiGet(keys);
      return rows.flatMap(([, raw]) => {
        if (!raw) return [];
        try {
          const record = migrateRecord(JSON.parse(raw) as UnknownRecord);
          validateRecord(record);
          return [record];
        } catch {
          return [];
        }
      });
    },

    async remove(agentId: string): Promise<void> {
      await withWriteLock(agentId, () => storage.removeItem(keyFor(agentId)));
    },
  };
}

export const railwayProvisioningStore =
  createRailwayProvisioningStore(AsyncStorage);

function validateRecord(
  record: RailwayProvisioningRecord,
): asserts record is RailwayProvisioningRecord {
  if (
    !record ||
    typeof record !== "object" ||
    typeof record.agentId !== "string" ||
    !record.agentId ||
    typeof record.agentName !== "string" ||
    typeof record.providerCredentialId !== "string" ||
    !record.providerCredentialId ||
    typeof record.gatewayCredentialId !== "string" ||
    !record.gatewayCredentialId ||
    typeof record.sttProviderId !== "string" ||
    !record.sttProviderId ||
    typeof record.ttsProviderId !== "string" ||
    !record.ttsProviderId ||
    (record.gitCredentialId !== undefined &&
      (typeof record.gitCredentialId !== "string" || !record.gitCredentialId)) ||
    (record.gitCredentialState !== undefined &&
      record.gitCredentialState !== "connected" &&
      record.gitCredentialState !== "disconnected") ||
    (record.gitCredentialState === "connected" && !record.gitCredentialId) ||
    (record.gitCredentialState === "disconnected" &&
      record.gitCredentialId !== undefined) ||
    (record.repositories !== undefined &&
      (!Array.isArray(record.repositories) ||
        record.repositories.some(
          (repository) =>
            !repository ||
            typeof repository !== "object" ||
            !Number.isSafeInteger(repository.id) ||
            typeof repository.fullName !== "string" ||
            typeof repository.cloneUrl !== "string",
        ))) ||
    !isCredentialIdMap(record.voiceCredentialIds) ||
    !record.state ||
    record.state.providerId !== "railway" ||
    typeof record.state.provisioningId !== "string" ||
    !record.state.provisioningId ||
    typeof record.state.workspaceId !== "string" ||
    !record.state.workspaceId ||
    typeof record.state.projectName !== "string" ||
    !record.state.projectName ||
    typeof record.state.phase !== "string" ||
    (record.state.deploymentState !== undefined &&
      record.state.deploymentState !== "running" &&
      record.state.deploymentState !== "stopped") ||
    typeof record.state.updatedAt !== "number" ||
    !Number.isFinite(record.state.updatedAt)
  ) {
    throw new Error("Railway provisioning checkpoint is invalid");
  }
}

type UnknownRecord = Record<string, unknown>;

function migrateRecord(raw: UnknownRecord): RailwayProvisioningRecord {
  const oldVoiceCredentialIds =
    typeof raw.deepgramCredentialId === "string" &&
    raw.deepgramCredentialId &&
    typeof raw.elevenLabsCredentialId === "string" &&
    raw.elevenLabsCredentialId
      ? {
          DEEPGRAM_API_KEY: raw.deepgramCredentialId,
          ELEVENLABS_API_KEY: raw.elevenLabsCredentialId,
        }
      : undefined;
  const voiceCredentialIds = isCredentialIdMap(raw.voiceCredentialIds)
    ? raw.voiceCredentialIds
    : oldVoiceCredentialIds;
  if (!voiceCredentialIds) {
    throw new Error("Railway provisioning checkpoint has no credential references");
  }
  return {
    agentId: raw.agentId as string,
    agentName: raw.agentName as string,
    state: raw.state as RailwayProvisioningState,
    providerCredentialId: raw.providerCredentialId as string,
    gatewayCredentialId: raw.gatewayCredentialId as string,
    sttProviderId:
      typeof raw.sttProviderId === "string" && raw.sttProviderId
        ? raw.sttProviderId
        : "deepgram",
    ttsProviderId:
      typeof raw.ttsProviderId === "string" && raw.ttsProviderId
        ? raw.ttsProviderId
        : "elevenlabs",
    ...(typeof raw.gitCredentialId === "string" && raw.gitCredentialId
      ? { gitCredentialId: raw.gitCredentialId }
      : {}),
    ...(raw.gitCredentialState === "connected" ||
    raw.gitCredentialState === "disconnected"
      ? { gitCredentialState: raw.gitCredentialState }
      : {}),
    ...(Array.isArray(raw.repositories)
      ? { repositories: raw.repositories as AttachedRepository[] }
      : {}),
    voiceCredentialIds,
  };
}

function isCredentialIdMap(
  value: unknown,
): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([env, credentialId]) =>
        Boolean(env.trim()) &&
        typeof credentialId === "string" &&
        Boolean(credentialId.trim()),
    )
  );
}

function serializableRecord(
  record: RailwayProvisioningRecord,
): RailwayProvisioningRecord {
  return {
    agentId: record.agentId,
    agentName: record.agentName,
    state: record.state,
    providerCredentialId: record.providerCredentialId,
    gatewayCredentialId: record.gatewayCredentialId,
    sttProviderId: record.sttProviderId,
    ttsProviderId: record.ttsProviderId,
    ...(record.gitCredentialId
      ? { gitCredentialId: record.gitCredentialId }
      : {}),
    ...(record.gitCredentialState
      ? { gitCredentialState: record.gitCredentialState }
      : {}),
    ...(record.repositories ? { repositories: record.repositories } : {}),
    voiceCredentialIds: { ...record.voiceCredentialIds },
  };
}
