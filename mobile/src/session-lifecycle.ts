import type { VoiceMode } from "./protocol";

export type SessionStatus = "disconnected" | "connecting" | "ready";

export type SessionGeneration = {
  generation: number;
  userClosed: boolean;
};

export type SpeakingState = {
  ttsOpen: boolean;
  playing: boolean;
};

export type SpeakingEvent =
  | "tts_start"
  | "tts_end"
  | "playback_busy"
  | "playback_idle"
  | "flush";

/** Bump generation and mark an explicit user disconnect. Never auto-resumes. */
export function beginDisconnect(state: SessionGeneration): SessionGeneration {
  return { generation: state.generation + 1, userClosed: true };
}

/** Bump generation for a fresh connect or reconnect. */
export function beginConnect(state: SessionGeneration): SessionGeneration {
  return { generation: state.generation + 1, userClosed: false };
}

export function shouldAcceptNativeEvent(
  current: SessionGeneration,
  eventGeneration: number,
): boolean {
  return (
    !current.userClosed &&
    current.generation > 0 &&
    eventGeneration === current.generation
  );
}

export function shouldResumeAfterInterruption(opts: {
  userClosed: boolean;
  mode: VoiceMode;
  wasCapturing: boolean;
}): boolean {
  return !opts.userClosed && opts.mode === "handsfree" && opts.wasCapturing;
}

export function applySpeakingEvent(
  state: SpeakingState,
  event: SpeakingEvent,
): SpeakingState & { speaking: boolean } {
  let { ttsOpen, playing } = state;
  switch (event) {
    case "tts_start":
      ttsOpen = true;
      break;
    case "tts_end":
      ttsOpen = false;
      break;
    case "playback_busy":
      playing = true;
      break;
    case "playback_idle":
      playing = false;
      break;
    case "flush":
      ttsOpen = false;
      playing = false;
      break;
  }
  return { ttsOpen, playing, speaking: ttsOpen || playing };
}

/** Playback failed; keep the socket/mic unless the caller fail-closes. */
export function failPlaybackStream(state: SpeakingState): SpeakingState & {
  speaking: boolean;
} {
  return applySpeakingEvent(state, "flush");
}

export function nextStatusAfterClose(opts: {
  userClosed: boolean;
  willReconnect: boolean;
}): SessionStatus {
  if (opts.userClosed || !opts.willReconnect) return "disconnected";
  return "connecting";
}
