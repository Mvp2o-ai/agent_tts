export type VoiceMode = "ptt" | "handsfree";

export type CaptureEvent = {
  generation: number;
  pcmBase64: string;
  byteLength: number;
};

export type PlaybackIdleEvent = {
  generation: number;
};

export type VoiceWarningEvent = {
  generation: number;
  message: string;
};

export type VoiceErrorEvent = {
  generation: number;
  message: string;
};

export type VoiceAudioEvents = {
  onCapture: (event: CaptureEvent) => void;
  onPlaybackIdle: (event: PlaybackIdleEvent) => void;
  onWarning: (event: VoiceWarningEvent) => void;
  onError: (event: VoiceErrorEvent) => void;
};

export type VoicePermissionResponse = {
  granted: boolean;
  status: "granted" | "denied" | "undetermined";
  canAskAgain?: boolean;
};

export type VoicePrepareResult = {
  voiceProcessing: boolean;
  aec: boolean;
  captureSampleRate: number;
  playbackSampleRate: number;
};

/**
 * Expo Modules API 57 `NativeModule` + `Events` surface.
 * Capture events use base64 because `Module.sendEvent` payloads are
 * dictionary-typed; downlink uses `Data` / `ByteArray` → `Uint8Array`.
 */
export interface VoiceAudioNative {
  requestPermissionsAsync(): Promise<VoicePermissionResponse>;
  prepare(generation: number, mode: VoiceMode): Promise<VoicePrepareResult>;
  startCapture(generation: number): Promise<void>;
  stopCapture(): Promise<void>;
  enqueuePlayback(pcm: Uint8Array, generation: number): Promise<void>;
  flushPlayback(): Promise<void>;
  release(): Promise<void>;
  addListener<K extends keyof VoiceAudioEvents>(
    eventName: K,
    listener: VoiceAudioEvents[K],
  ): { remove(): void };
}
