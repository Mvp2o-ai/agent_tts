import { openDeepgram } from "./deepgram.js";
import { openElevenLabs } from "./elevenlabs.js";

export type VoiceRole = "stt" | "tts";

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  speechStarted?: boolean;
  utteranceEnd?: boolean;
}

export interface SttStream {
  sendPcm(chunk: Buffer): void;
  finish(): void;
  close(): void;
}

export interface TtsStream {
  pushText(text: string): void;
  /** Force-generate buffered text without closing the socket (not EOS). */
  flush(): void;
  finish(): void;
  close(): void;
}

export const STT_SAMPLE_RATE = 16000;
export const STT_BYTES_PER_SAMPLE = 2;
export const STT_PREOPEN_MS = 3000;
export const STT_PREOPEN_BYTES =
  (STT_SAMPLE_RATE * STT_BYTES_PER_SAMPLE * STT_PREOPEN_MS) / 1000;

export const VOICE_AUDIO_FORMAT = {
  encoding: "pcm_s16le",
  sampleRate: 24000,
  channels: 1,
} as const;

export const DEFAULT_STT_PROVIDER_ID = "deepgram";
export const DEFAULT_TTS_PROVIDER_ID = "elevenlabs";

export interface SttAdapter {
  readonly id: string;
  open(opts: {
    onEvent: (ev: TranscriptEvent) => void;
    onError: (err: Error) => void;
    /** Fires after all transcript events have drained from a finished stream. */
    onEnd: () => void;
  }): SttStream;
}

export interface TtsAdapter {
  readonly id: string;
  open(opts: {
    voiceId: string;
    onAudio: (pcm: Buffer) => void;
    onError: (err: Error) => void;
    onEnd?: () => void;
  }): TtsStream;
}

export interface VoiceProviderInfo {
  id: string;
  label: string;
}

type SttFactory = (secrets: Record<string, string>) => SttAdapter;
type TtsFactory = (secrets: Record<string, string>) => TtsAdapter;

const sttProviders = new Map<string, {
  info: VoiceProviderInfo;
  create: SttFactory;
}>();
const ttsProviders = new Map<string, {
  info: VoiceProviderInfo;
  create: TtsFactory;
}>();

function requiredSecret(
  secrets: Record<string, string>,
  envName: string,
  providerLabel: string,
): string {
  const value = secrets[envName];
  if (!value) {
    throw new Error(`${envName} is required for ${providerLabel}`);
  }
  return value;
}

function registerBuiltinProviders(): void {
  sttProviders.set(DEFAULT_STT_PROVIDER_ID, {
    info: { id: DEFAULT_STT_PROVIDER_ID, label: "Deepgram" },
    create: (secrets) => {
      const apiKey = requiredSecret(secrets, "DEEPGRAM_API_KEY", "Deepgram");
      return {
        id: DEFAULT_STT_PROVIDER_ID,
        open: (opts) => openDeepgram({ apiKey, ...opts }),
      };
    },
  });
  ttsProviders.set(DEFAULT_TTS_PROVIDER_ID, {
    info: { id: DEFAULT_TTS_PROVIDER_ID, label: "ElevenLabs" },
    create: (secrets) => {
      const apiKey = requiredSecret(
        secrets,
        "ELEVENLABS_API_KEY",
        "ElevenLabs",
      );
      return {
        id: DEFAULT_TTS_PROVIDER_ID,
        open: (opts) => openElevenLabs({ apiKey, ...opts }),
      };
    },
  });
}

registerBuiltinProviders();

export function listSttProviders(): VoiceProviderInfo[] {
  return [...sttProviders.values()].map(({ info }) => ({ ...info }));
}

export function listTtsProviders(): VoiceProviderInfo[] {
  return [...ttsProviders.values()].map(({ info }) => ({ ...info }));
}

export function resolveVoiceProviderId(role: VoiceRole, id?: string): string {
  const resolved = id?.trim() || (
    role === "stt" ? DEFAULT_STT_PROVIDER_ID : DEFAULT_TTS_PROVIDER_ID
  );
  const providers = role === "stt" ? sttProviders : ttsProviders;
  if (!providers.has(resolved)) {
    throw new Error(`Unknown ${role} voice provider: ${resolved}`);
  }
  return resolved;
}

export function createSttAdapter(
  id: string,
  secrets: Record<string, string>,
): SttAdapter {
  const provider = sttProviders.get(id);
  if (!provider) throw new Error(`Unknown stt voice provider: ${id}`);
  return provider.create(secrets);
}

export function createTtsAdapter(
  id: string,
  secrets: Record<string, string>,
): TtsAdapter {
  const provider = ttsProviders.get(id);
  if (!provider) throw new Error(`Unknown tts voice provider: ${id}`);
  return provider.create(secrets);
}

/**
 * Registers an adapter factory for process-local tests or extensions.
 * The returned function restores the previous provider, if any.
 */
export function registerSttAdapter(
  id: string,
  label: string,
  create: SttFactory,
): () => void {
  const previous = sttProviders.get(id);
  sttProviders.set(id, { info: { id, label }, create });
  return () => {
    if (previous) sttProviders.set(id, previous);
    else sttProviders.delete(id);
  };
}

export function registerTtsAdapter(
  id: string,
  label: string,
  create: TtsFactory,
): () => void {
  const previous = ttsProviders.get(id);
  ttsProviders.set(id, { info: { id, label }, create });
  return () => {
    if (previous) ttsProviders.set(id, previous);
    else ttsProviders.delete(id);
  };
}
