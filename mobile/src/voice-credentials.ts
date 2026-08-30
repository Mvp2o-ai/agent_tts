import type { CredentialEntry } from "./credential-vault";
import {
  DEFAULT_STT_PROVIDER_ID,
  DEFAULT_TTS_PROVIDER_ID,
  getVoiceProvider,
  VOICE_PROVIDERS,
  type VoiceCredentialField,
} from "./voice-providers";

export interface VoiceCredentialVault {
  list(): Promise<CredentialEntry[]>;
  getSecret(id: string): Promise<string | null>;
  save(input: {
    id?: string;
    kind: "voice-key";
    label: string;
    keyEnv: string;
    providerId: string;
    secret: string;
  }): Promise<CredentialEntry>;
}

export function findVoiceCredential(
  entries: CredentialEntry[],
  providerId: string,
): CredentialEntry | undefined {
  const matches = entries.filter(
    (entry) => entry.kind === "voice-key" && entry.providerId === providerId,
  );
  return matches.at(-1);
}

export function hasRequiredVoiceKeys(
  entries: CredentialEntry[],
  sttProviderId = DEFAULT_STT_PROVIDER_ID,
  ttsProviderId = DEFAULT_TTS_PROVIDER_ID,
): boolean {
  return requiredCredentialFields(sttProviderId, ttsProviderId).every(
    ({ providerId, field }) =>
      Boolean(findVoiceCredentialForField(entries, providerId, field)),
  );
}

export async function requireVoiceCredential(
  vault: VoiceCredentialVault,
  providerId: string,
): Promise<{ entryId: string; secret: string }> {
  const provider = findVoiceProvider(providerId);
  const field = provider.credentialFields.find((item) => item.secret);
  if (!field) {
    throw new Error(`Voice provider ${provider.label} has no secret fields.`);
  }
  const entry = findVoiceCredentialForField(
    await vault.list(),
    providerId,
    field,
  );
  if (!entry) {
    throw new Error(`Add the ${field.label} in Settings first.`);
  }
  return resolveVoiceCredential(vault, {
    credentialId: entry.id,
    providerId,
    keyEnv: field.env,
    label: field.label,
  });
}

export async function saveVoiceSecrets(
  vault: VoiceCredentialVault,
  input: readonly { providerId: string; secret: string }[],
): Promise<void> {
  const provided = input
    .map((item) => ({
      ...item,
      secret: item.secret.trim(),
    }))
    .filter((item) => item.secret);
  if (provided.length === 0) {
    throw new Error("Enter at least one voice service key.");
  }
  await Promise.all(
    provided.map((item) => {
      const provider = findVoiceProvider(item.providerId);
      const field = provider.credentialFields.find((candidate) => candidate.secret);
      if (!field) {
        throw new Error(`Voice provider ${provider.label} has no secret fields.`);
      }
      return resolveVoiceCredential(vault, {
        providerId: item.providerId,
        keyEnv: field.env,
        label: field.label,
        secret: item.secret,
      });
    }),
  );
}

/** @deprecated Use saveVoiceSecrets with provider IDs. */
export async function saveVoiceKeys(
  vault: VoiceCredentialVault,
  input: { deepgram?: string; elevenLabs?: string },
): Promise<void> {
  return saveVoiceSecrets(vault, [
    { providerId: "deepgram", secret: input.deepgram ?? "" },
    { providerId: "elevenlabs", secret: input.elevenLabs ?? "" },
  ]);
}

export async function requireVoiceSecrets(
  vault: VoiceCredentialVault,
  sttProviderId: string,
  ttsProviderId: string,
): Promise<{
  secrets: Record<string, string>;
  credentialIds: Record<string, string>;
}> {
  const fields = requiredCredentialFields(sttProviderId, ttsProviderId);
  const entries = await vault.list();
  const secrets: Record<string, string> = {};
  const credentialIds: Record<string, string> = {};
  for (const { providerId, field } of fields) {
    if (field.env in secrets) continue;
    const entry = findVoiceCredentialForField(entries, providerId, field);
    if (!entry) {
      throw new Error(`Add the ${field.label} in Settings first.`);
    }
    const secret = await vault.getSecret(entry.id);
    if (!secret) {
      throw new Error(`${field.label} is unavailable`);
    }
    secrets[field.env] = secret;
    credentialIds[field.env] = entry.id;
  }
  return { secrets, credentialIds };
}

export async function resolveVoiceCredential(
  vault: VoiceCredentialVault,
  input: {
    credentialId?: string;
    secret?: string;
    providerId: string;
    keyEnv: string;
    label: string;
  },
): Promise<{ entryId: string; secret: string }> {
  if (input.credentialId) {
    const [entries, secret] = await Promise.all([
      vault.list(),
      vault.getSecret(input.credentialId),
    ]);
    const entry = entries.find(
      (candidate) => candidate.id === input.credentialId,
    );
    if (
      !entry ||
      entry.kind !== "voice-key" ||
      entry.providerId !== input.providerId ||
      (entry.keyEnv !== undefined && entry.keyEnv !== input.keyEnv) ||
      !secret
    ) {
      throw new Error(`${input.label} is unavailable`);
    }
    return { entryId: entry.id, secret };
  }

  const secret = input.secret?.trim();
  if (!secret) throw new Error(`${input.label} is required`);
  const existing = findVoiceCredentialForField(
    await vault.list(),
    input.providerId,
    { env: input.keyEnv },
  );
  const entry = await vault.save({
    id: existing?.id,
    kind: "voice-key",
    providerId: input.providerId,
    keyEnv: input.keyEnv,
    label: input.label,
    secret,
  });
  return { entryId: entry.id, secret };
}

function findVoiceProvider(providerId: string) {
  const provider = VOICE_PROVIDERS.find((item) => item.id === providerId);
  if (!provider) {
    throw new Error(`Unknown voice provider: ${providerId}`);
  }
  return provider;
}

function findVoiceCredentialForField(
  entries: CredentialEntry[],
  providerId: string,
  field: Pick<VoiceCredentialField, "env">,
): CredentialEntry | undefined {
  return entries
    .filter(
      (entry) =>
        entry.kind === "voice-key" &&
        entry.providerId === providerId &&
        (entry.keyEnv === undefined || entry.keyEnv === field.env),
    )
    .at(-1);
}

function requiredCredentialFields(
  sttProviderId: string,
  ttsProviderId: string,
): { providerId: string; field: VoiceCredentialField }[] {
  const selections = [
    getVoiceProvider("stt", sttProviderId),
    getVoiceProvider("tts", ttsProviderId),
  ];
  const fields: { providerId: string; field: VoiceCredentialField }[] = [];
  const seenEnvs = new Set<string>();
  for (const provider of selections) {
    for (const field of provider.credentialFields) {
      if (!field.secret || seenEnvs.has(field.env)) continue;
      seenEnvs.add(field.env);
      fields.push({ providerId: provider.id, field });
    }
  }
  return fields;
}
