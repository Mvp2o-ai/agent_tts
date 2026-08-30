export type VoiceRole = "stt" | "tts";

export interface VoiceCredentialField {
  id: string;
  label: string;
  hint?: string;
  secret: boolean;
  env: string;
}

export interface VoiceProviderManifest {
  id: string;
  role: VoiceRole;
  label: string;
  credentialFields: readonly VoiceCredentialField[];
}

export const DEFAULT_STT_PROVIDER_ID = "deepgram";
export const DEFAULT_TTS_PROVIDER_ID = "elevenlabs";

export const STT_PROVIDERS: readonly VoiceProviderManifest[] = [
  {
    id: "deepgram",
    role: "stt",
    label: "Deepgram",
    credentialFields: [
      {
        id: "apiKey",
        label: "API Key",
        hint: "Speech-to-text for every agent launched from this phone.",
        secret: true,
        env: "DEEPGRAM_API_KEY",
      },
    ],
  },
];

export const TTS_PROVIDERS: readonly VoiceProviderManifest[] = [
  {
    id: "elevenlabs",
    role: "tts",
    label: "ElevenLabs",
    credentialFields: [
      {
        id: "apiKey",
        label: "API Key",
        hint: "Text-to-speech for every agent launched from this phone.",
        secret: true,
        env: "ELEVENLABS_API_KEY",
      },
    ],
  },
];

export const VOICE_PROVIDERS: readonly VoiceProviderManifest[] = [
  ...STT_PROVIDERS,
  ...TTS_PROVIDERS,
];

export function listVoiceProviders(
  role: VoiceRole,
): readonly VoiceProviderManifest[] {
  return role === "stt" ? STT_PROVIDERS : TTS_PROVIDERS;
}

export function getVoiceProvider(
  role: VoiceRole,
  id: string,
): VoiceProviderManifest {
  const provider = listVoiceProviders(role).find((item) => item.id === id);
  if (!provider) {
    throw new Error(`Unknown ${role.toUpperCase()} voice provider: ${id}`);
  }
  return provider;
}

export function resolveVoiceProviderId(
  role: VoiceRole,
  id?: string | null,
): string {
  const trimmed = id?.trim();
  if (!trimmed) {
    return role === "stt"
      ? DEFAULT_STT_PROVIDER_ID
      : DEFAULT_TTS_PROVIDER_ID;
  }
  return getVoiceProvider(role, trimmed).id;
}

export function hydrateVoiceProviderId(role: VoiceRole, id?: string): string {
  const trimmed = id?.trim();
  if (!trimmed || !listVoiceProviders(role).some((item) => item.id === trimmed)) {
    return role === "stt"
      ? DEFAULT_STT_PROVIDER_ID
      : DEFAULT_TTS_PROVIDER_ID;
  }
  return trimmed;
}

export function requiredSecretFieldsFrom(
  manifests: readonly VoiceProviderManifest[],
): VoiceCredentialField[] {
  const fields: VoiceCredentialField[] = [];
  const seenEnvs = new Set<string>();
  for (const manifest of manifests) {
    for (const field of manifest.credentialFields) {
      if (!field.secret || seenEnvs.has(field.env)) continue;
      seenEnvs.add(field.env);
      fields.push(field);
    }
  }
  return fields;
}

export function requiredSecretFields(
  sttProviderId: string,
  ttsProviderId: string,
): VoiceCredentialField[] {
  return requiredSecretFieldsFrom([
    getVoiceProvider("stt", sttProviderId),
    getVoiceProvider("tts", ttsProviderId),
  ]);
}

export function voiceProviderEnvNames(
  sttProviderId: string,
  ttsProviderId: string,
): string[] {
  return requiredSecretFields(sttProviderId, ttsProviderId).map(
    (field) => field.env,
  );
}
