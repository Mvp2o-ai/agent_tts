export type CredentialKind = "git-pat" | "model-key";

export interface CredentialEntry {
  id: string;
  kind: CredentialKind;
  label: string;
  keyEnv?: string;
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
      secret: string;
    }): Promise<CredentialEntry> {
      const id = input.id ?? newCredentialId();
      const entry: CredentialEntry = {
        id,
        kind: input.kind,
        label: input.label.trim() || defaultLabel(input.kind, input.keyEnv),
        ...(input.keyEnv ? { keyEnv: input.keyEnv } : {}),
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

function defaultLabel(kind: CredentialKind, keyEnv?: string): string {
  return kind === "git-pat" ? "Git credential" : keyEnv || "Model key";
}

function parseEntry(value: unknown): CredentialEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id !== "string" ||
    typeof entry.label !== "string" ||
    (entry.kind !== "git-pat" && entry.kind !== "model-key")
  ) {
    return null;
  }
  return {
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    ...(typeof entry.keyEnv === "string" ? { keyEnv: entry.keyEnv } : {}),
  };
}
