import { PermissionsAndroid, Platform } from "react-native";
import VoiceAudio, {
  type CaptureEvent,
  type PlaybackIdleEvent,
  type VoiceErrorEvent,
  type VoiceMode,
  type VoicePrepareResult,
  type VoiceWarningEvent,
} from "voice-audio";
import { SerialPlaybackEnqueue } from "./playback-path";
import { pcm16ExactBytes } from "./pcm";
import { decodeCapturePcm } from "./voice-codec";

export { decodeCapturePcm } from "./voice-codec";

export type VoiceNativeListeners = {
  onCapture: (generation: number, pcm: ArrayBuffer) => void;
  onPlaybackIdle: (generation: number) => void;
  onWarning: (generation: number, message: string) => void;
  onError: (generation: number, message: string) => void;
};

const playbackSerial = new SerialPlaybackEnqueue();
let nativeLifecycle: Promise<void> = Promise.resolve();

function runNativeLifecycle<T>(fn: () => Promise<T>): Promise<T> {
  const run = nativeLifecycle.catch(() => undefined).then(fn);
  nativeLifecycle = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function requestVoicePermissions(): Promise<{
  granted: boolean;
  status: string;
}> {
  if (Platform.OS === "ios") {
    return VoiceAudio.requestPermissionsAsync();
  }

  const needed = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  const postNotifications = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (Number(Platform.Version) >= 33 && postNotifications) {
    needed.push(postNotifications);
  }
  const bluetoothConnect = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  if (Number(Platform.Version) >= 31 && bluetoothConnect) {
    needed.push(bluetoothConnect);
  }
  const result = await PermissionsAndroid.requestMultiple(needed);
  const mic = result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  const granted = mic === PermissionsAndroid.RESULTS.GRANTED;
  return { granted, status: granted ? "granted" : "denied" };
}

export function subscribeVoiceNative(listeners: VoiceNativeListeners): () => void {
  const capture = VoiceAudio.addListener("onCapture", (event: CaptureEvent) => {
    try {
      listeners.onCapture(event.generation, decodeCapturePcm(event));
    } catch {
      // drop a malformed native frame
    }
  });
  const idle = VoiceAudio.addListener(
    "onPlaybackIdle",
    (event: PlaybackIdleEvent) => {
      listeners.onPlaybackIdle(event.generation);
    },
  );
  const warning = VoiceAudio.addListener(
    "onWarning",
    (event: VoiceWarningEvent) => {
      listeners.onWarning(event.generation, event.message);
    },
  );
  const error = VoiceAudio.addListener("onError", (event: VoiceErrorEvent) => {
    listeners.onError(event.generation, event.message);
  });
  return () => {
    capture.remove();
    idle.remove();
    warning.remove();
    error.remove();
  };
}

export async function prepareVoiceNative(
  generation: number,
  mode: VoiceMode,
): Promise<VoicePrepareResult> {
  return runNativeLifecycle(() => VoiceAudio.prepare(generation, mode));
}

export async function startNativeCapture(generation: number): Promise<void> {
  await VoiceAudio.startCapture(generation);
}

export async function stopNativeCapture(): Promise<void> {
  await VoiceAudio.stopCapture();
}

export async function enqueueNativePlayback(
  pcm: ArrayBuffer,
  generation: number,
): Promise<void> {
  await playbackSerial.enqueue(
    pcm.byteLength,
    () => new Uint8Array(pcm16ExactBytes(pcm)),
    (exact) => VoiceAudio.enqueuePlayback(exact, generation),
  );
}

export async function flushNativePlayback(): Promise<void> {
  playbackSerial.invalidate();
  await VoiceAudio.flushPlayback();
}

export async function releaseVoiceNative(): Promise<void> {
  await runNativeLifecycle(async () => {
    playbackSerial.invalidate();
    await VoiceAudio.release();
    await playbackSerial.drain();
  });
}
