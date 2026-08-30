export type CredentialKind =
  | "github-token"
  | "git-pat"
  | "model-key"
  | "gateway-token"
  | "provider-oauth"
  | "voice-key";

export interface CredentialEntry {
  id: string;
  kind: CredentialKind;
  label: string;
  keyEnv?: string;
  providerId?: string;
}

export interface SecureCredentialStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const INDEX_KEY = "agent_tts_credential_index_v1";
const SECRET_PREFIX = "agent_tts_credential_";

export function createCredentialVault(store: SecureCredentialStore) {
  const readIndex = async (): Promise<CredentialEntry[]> => {
    const raw = await store.getItemAsync(INDEX_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(parseEntry)
        .filter((entry): entry is CredentialEntry => entry !== null);
    } catch {
      return [];
    }
  };

  const writeIndex = (entries: CredentialEntry[]) =>
    store.setItemAsync(INDEX_KEY, JSON.stringify(entries));

  return {
    list: readIndex,
    async getSecret(id: string): Promise<string | null> {
      return store.getItemAsync(secretKey(id));
    },
    async save(input: {
      id?: string;
      kind: CredentialKind;
      label: string;
      keyEnv?: string;
      providerId?: string;
      secret: string;
    }): Promise<CredentialEntry> {
      const id = input.id ?? newCredentialId();
      const keyEnv = optionalMetadata(input.keyEnv);
      const providerId = optionalMetadata(input.providerId);
      const entry: CredentialEntry = {
        id,
        kind: input.kind,
        label: input.label.trim() || defaultLabel(input.kind, providerId, keyEnv),
        ...(keyEnv ? { keyEnv } : {}),
        ...(providerId ? { providerId } : {}),
      };
      await store.setItemAsync(secretKey(id), input.secret);
      const entries = await readIndex();
      const next = [...entries.filter((item) => item.id !== id), entry];
      await writeIndex(next);
      return entry;
    },
    async remove(id: string): Promise<void> {
      await store.deleteItemAsync(secretKey(id));
      const entries = await readIndex();
      await writeIndex(entries.filter((entry) => entry.id !== id));
    },
  };
}

function secretKey(id: string): string {
  return `${SECRET_PREFIX}${id.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
}

function newCredentialId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultLabel(
  kind: CredentialKind,
  providerId?: string,
  keyEnv?: string,
): string {
  if (kind === "github-token") return "GitHub account";
  if (kind === "git-pat") return "Git credential";
  if (kind === "gateway-token") return "Gateway token";
  if (kind === "provider-oauth") {
    return providerId ? `${providerId} OAuth` : "Provider OAuth";
  }
  if (kind === "voice-key") {
    return providerId ? `${providerId} voice key` : keyEnv || "Voice key";
  }
  return keyEnv || "Model key";
}

function parseEntry(value: unknown): CredentialEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id !== "string" ||
    entry.id.trim().length === 0 ||
    typeof entry.label !== "string" ||
    entry.label.trim().length === 0 ||
    !isCredentialKind(entry.kind) ||
    (hasOwn(entry, "keyEnv") &&
      (typeof entry.keyEnv !== "string" || entry.keyEnv.trim().length === 0)) ||
    (hasOwn(entry, "providerId") &&
      (typeof entry.providerId !== "string" ||
        entry.providerId.trim().length === 0))
  ) {
    return null;
  }
  return {
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    ...(typeof entry.keyEnv === "string" ? { keyEnv: entry.keyEnv } : {}),
    ...(typeof entry.providerId === "string"
      ? { providerId: entry.providerId }
      : {}),
  };
}

function isCredentialKind(value: unknown): value is CredentialKind {
  return (
    value === "github-token" ||
    value === "git-pat" ||
    value === "model-key" ||
    value === "gateway-token" ||
    value === "provider-oauth" ||
    value === "voice-key"
  );
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function optionalMetadata(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
