import { requireNativeModule } from "expo";
import type { VoiceAudioNative } from "./VoiceAudio.types";

export type {
  CaptureEvent,
  PlaybackIdleEvent,
  VoiceAudioEvents,
  VoiceAudioNative,
  VoiceErrorEvent,
  VoiceMode,
  VoicePermissionResponse,
  VoicePrepareResult,
  VoiceWarningEvent,
} from "./VoiceAudio.types";

/**
 * Local Expo module. Metro resolves this via the `file:./packages/voice-audio`
 * dependency. Expo Go cannot load it.
 */
const VoiceAudio = requireNativeModule<VoiceAudioNative>("VoiceAudio");

export default VoiceAudio;
