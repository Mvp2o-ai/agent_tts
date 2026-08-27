import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { Connection } from "./api";
import {
  classifyIncomingFrame,
  connectionError,
  nextReconnectDelay,
  validateReadyAudioFormat,
  voiceUrl,
  wsCloseMessage,
  type VoiceMode,
} from "./protocol";
import {
  applySpeakingEvent,
  beginConnect,
  beginDisconnect,
  shouldAcceptNativeEvent,
  type SessionGeneration,
  type SessionStatus,
  type SpeakingState,
} from "./session-lifecycle";
import {
  enqueueNativePlayback,
  flushNativePlayback,
  prepareVoiceNative,
  releaseVoiceNative,
  requestVoicePermissions,
  startNativeCapture,
  stopNativeCapture,
  subscribeVoiceNative,
} from "./voice-native";

export type { VoiceMode, SessionStatus };
export type EventKind =
  | "transcript"
  | "agent"
  | "tool"
  | "error"
  | "ready"
  | "queued"
  | "prompt"
  | "stopped"
  | "done"
  | "barge_in"
  | "partial";

export interface SessionEvent {
  id: number;
  kind: EventKind;
  text: string;
}

const CONNECT_TIMEOUT_MS = 20_000;
const MAX_EVENTS = 200;

type ServerEvent = {
  type?: string;
  mode?: string;
  harness?: string;
  text?: string;
  isFinal?: boolean;
  summary?: string;
  message?: string;
  promptId?: string;
  position?: number;
  reason?: string;
  audioFormat?: unknown;
};

function isBlob(data: unknown): data is Blob {
  return typeof Blob !== "undefined" && data instanceof Blob;
}

export function useVoiceSession(conn: Connection): {
  status: SessionStatus;
  events: SessionEvent[];
  speaking: boolean;
  connect: (mode: VoiceMode) => void;
  disconnect: () => void;
  pttStart: () => void;
  pttEnd: () => void;
  abort: () => void;
} {
  const [status, setStatus] = useState<SessionStatus>("disconnected");
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [speaking, setSpeaking] = useState(false);

  const connRef = useRef(conn);
  connRef.current = conn;

  const wsRef = useRef<WebSocket | null>(null);
  const modeRef = useRef<VoiceMode>("ptt");
  const statusRef = useRef<SessionStatus>("disconnected");
  const micOpenRef = useRef(false);
  const pttHeldRef = useRef(false);
  const playbackAllowedRef = useRef(false);
  const sessionGenRef = useRef<SessionGeneration>({
    generation: 0,
    userClosed: true,
  });
  const speakingRef = useRef<SpeakingState>({ ttsOpen: false, playing: false });
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const eventIdRef = useRef(0);

  const setStatusSafe = useCallback((next: SessionStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const applySpeaking = useCallback(
    (event: Parameters<typeof applySpeakingEvent>[1]) => {
      const next = applySpeakingEvent(speakingRef.current, event);
      speakingRef.current = { ttsOpen: next.ttsOpen, playing: next.playing };
      if (mountedRef.current) setSpeaking(next.speaking);
    },
    [],
  );

  const pushEvent = useCallback((kind: EventKind, text: string) => {
    if (!mountedRef.current) return;
    const id = ++eventIdRef.current;
    setEvents((prev) => {
      const next = [...prev, { id, kind, text }];
      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
    });
  }, []);

  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    if (!mountedRef.current) return;
    const id = ++eventIdRef.current;
    setEvents((prev) => {
      const withoutPartial = prev.filter((e) => e.kind !== "partial");
      const row: SessionEvent = {
        id,
        kind: isFinal ? "transcript" : "partial",
        text,
      };
      const next = [...withoutPartial, row];
      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
    });
  }, []);

  const stopMic = useCallback(() => {
    if (!micOpenRef.current) return;
    micOpenRef.current = false;
    void stopNativeCapture();
  }, []);

  const flushPlayback = useCallback(async () => {
    applySpeaking("flush");
    try {
      await flushNativePlayback();
    } catch {
      // already released
    }
  }, [applySpeaking]);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      try {
        ws.close(1000, "client close");
      } catch {
        // already closed
      }
    }
  }, []);

  const failClosedRef = useRef<(message: string) => void>(() => undefined);
  const startMicRef = useRef<(generation: number) => void>(() => undefined);

  const failClosed = useCallback(
    (message: string) => {
      sessionGenRef.current = beginDisconnect(sessionGenRef.current);
      pttHeldRef.current = false;
      playbackAllowedRef.current = false;
      clearTimers();
      stopMic();
      closeSocket();
      void flushPlayback();
      void releaseVoiceNative();
      pushEvent("error", message);
      setStatusSafe("disconnected");
    },
    [clearTimers, closeSocket, flushPlayback, pushEvent, setStatusSafe, stopMic],
  );
  failClosedRef.current = failClosed;

  startMicRef.current = (generation: number) => {
    if (micOpenRef.current) return;
    if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
    micOpenRef.current = true;
    void startNativeCapture(generation).catch((err) => {
      micOpenRef.current = false;
      const message =
        err instanceof Error ? err.message : "microphone failed to start";
      if (modeRef.current === "handsfree") {
        failClosedRef.current(message);
        return;
      }
      pushEvent("error", message);
    });
  };

  const handleJson = useCallback(
    (raw: string) => {
      let msg: ServerEvent;
      try {
        msg = JSON.parse(raw) as ServerEvent;
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready": {
          playbackAllowedRef.current = false;
          const formatErr = validateReadyAudioFormat(msg.audioFormat);
          if (formatErr) {
            failClosed(formatErr);
            return;
          }
          reconnectAttemptRef.current = 0;
          if (connectTimerRef.current) {
            clearTimeout(connectTimerRef.current);
            connectTimerRef.current = null;
          }
          setStatusSafe("ready");
          pushEvent(
            "ready",
            `connected (${msg.mode ?? modeRef.current}${msg.harness ? `, ${msg.harness}` : ""})`,
          );
          if (modeRef.current === "handsfree") {
            startMicRef.current(sessionGenRef.current.generation);
          }
          break;
        }
        case "transcript":
          handleTranscript(msg.text ?? "", Boolean(msg.isFinal));
          break;
        case "agent_text":
          if (msg.text) pushEvent("agent", msg.text);
          break;
        case "tool_event":
          pushEvent("tool", msg.summary ?? "");
          break;
        case "queued":
          pushEvent(
            "queued",
            `queued #${msg.position ?? "?"} (${msg.promptId ?? ""})`,
          );
          break;
        case "prompt_start":
          pushEvent("prompt", msg.text ?? msg.promptId ?? "");
          break;
        case "tts_start":
          playbackAllowedRef.current = true;
          applySpeaking("tts_start");
          break;
        case "tts_end":
          playbackAllowedRef.current = false;
          applySpeaking("tts_end");
          break;
        case "barge_in":
          playbackAllowedRef.current = false;
          pushEvent("barge_in", "barge-in");
          void flushPlayback();
          break;
        case "stopped":
          playbackAllowedRef.current = false;
          pushEvent("stopped", msg.reason ?? "stopped");
          void flushPlayback();
          break;
        case "done":
          pushEvent("done", msg.promptId ?? "done");
          break;
        case "error":
          pushEvent("error", msg.message ?? "error");
          break;
        default:
          break;
      }
    },
    [
      applySpeaking,
      failClosed,
      flushPlayback,
      handleTranscript,
      pushEvent,
      setStatusSafe,
    ],
  );

  const handleFrame = useCallback(
    (frame: ReturnType<typeof classifyIncomingFrame>, generation: number) => {
      if (frame.kind === "json") {
        handleJson(frame.text);
        return;
      }
      if (frame.kind !== "audio") return;
      if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
      if (!playbackAllowedRef.current) return;
      applySpeaking("playback_busy");
      void enqueueNativePlayback(frame.buffer, generation).catch((err) => {
        if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
        pushEvent(
          "error",
          err instanceof Error ? err.message : "playback failed",
        );
        void flushPlayback();
      });
    },
    [applySpeaking, flushPlayback, handleJson, pushEvent],
  );

  const openSocket = useCallback(
    (generation: number, mode: VoiceMode) => {
      const current = connRef.current;
      const err = connectionError(current);
      if (err) {
        failClosed(err);
        return;
      }

      let ws: WebSocket;
      try {
        ws = new WebSocket(voiceUrl(current, mode));
      } catch (cause) {
        failClosed(
          cause instanceof Error ? cause.message : "failed to open websocket",
        );
        return;
      }
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      connectTimerRef.current = setTimeout(() => {
        if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
        if (statusRef.current !== "connecting") return;
        failClosed("connection timed out");
      }, CONNECT_TIMEOUT_MS);

      ws.onmessage = (event: MessageEvent) => {
        if (wsRef.current !== ws) return;
        if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
        const data: unknown = event.data;
        if (isBlob(data)) {
          void data.arrayBuffer().then((buf) => {
            if (wsRef.current !== ws) return;
            if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) {
              return;
            }
            handleFrame(classifyIncomingFrame(buf), generation);
          });
          return;
        }
        handleFrame(classifyIncomingFrame(data), generation);
      };
      ws.onerror = () => {
        if (wsRef.current !== ws) return;
        if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
        pushEvent("error", "websocket error");
      };
      ws.onclose = (event) => {
        if (sessionGenRef.current.generation !== generation) return;
        wsRef.current = null;
        pttHeldRef.current = false;
        playbackAllowedRef.current = false;
        stopMic();
        void flushPlayback();
        if (connectTimerRef.current) {
          clearTimeout(connectTimerRef.current);
          connectTimerRef.current = null;
        }

        const message = wsCloseMessage(event.code, event.reason ?? "");
        if (sessionGenRef.current.userClosed) {
          void releaseVoiceNative();
          setStatusSafe("disconnected");
          return;
        }

        const delay = nextReconnectDelay({
          userClosed: sessionGenRef.current.userClosed,
          attempt: reconnectAttemptRef.current,
          closeCode: event.code,
        });
        if (delay == null) {
          sessionGenRef.current = beginDisconnect(sessionGenRef.current);
          void releaseVoiceNative();
          pushEvent("error", message);
          setStatusSafe("disconnected");
          return;
        }

        reconnectAttemptRef.current += 1;
        pushEvent(
          "error",
          `${message} — reconnecting in ${Math.round(delay / 1000)}s (${reconnectAttemptRef.current}/3)`,
        );
        setStatusSafe("connecting");
        reconnectTimerRef.current = setTimeout(() => {
          if (sessionGenRef.current.userClosed) return;
          if (sessionGenRef.current.generation !== generation) return;
          sessionGenRef.current = beginConnect(sessionGenRef.current);
          const nextGen = sessionGenRef.current.generation;
          void releaseVoiceNative()
            .catch(() => undefined)
            .then(() => prepareVoiceNative(nextGen, modeRef.current))
            .then(() => {
              if (!shouldAcceptNativeEvent(sessionGenRef.current, nextGen)) {
                return;
              }
              openSocket(nextGen, modeRef.current);
            })
            .catch((cause) => {
              failClosed(
                cause instanceof Error
                  ? cause.message
                  : "native audio failed to prepare",
              );
            });
        }, delay);
      };
    },
    [
      failClosed,
      flushPlayback,
      handleFrame,
      pushEvent,
      setStatusSafe,
      stopMic,
    ],
  );

  const disconnect = useCallback(() => {
    sessionGenRef.current = beginDisconnect(sessionGenRef.current);
    reconnectAttemptRef.current = 0;
    pttHeldRef.current = false;
    playbackAllowedRef.current = false;
    clearTimers();
    stopMic();
    closeSocket();
    void flushPlayback();
    void releaseVoiceNative();
    setStatusSafe("disconnected");
  }, [clearTimers, closeSocket, flushPlayback, setStatusSafe, stopMic]);

  const connect = useCallback(
    (mode: VoiceMode) => {
      sessionGenRef.current = beginConnect(sessionGenRef.current);
      const generation = sessionGenRef.current.generation;
      reconnectAttemptRef.current = 0;
      modeRef.current = mode;
      pttHeldRef.current = false;
      playbackAllowedRef.current = false;
      clearTimers();
      stopMic();
      closeSocket();
      void flushPlayback();
      setEvents([]);
      setStatusSafe("connecting");

      const run = async () => {
        try {
          const perm = await requestVoicePermissions();
          if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) {
            return;
          }
          if (!perm.granted) {
            failClosed("microphone permission denied");
            return;
          }
        } catch (err) {
          if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) {
            return;
          }
          failClosed(
            err instanceof Error
              ? err.message
              : "microphone permission request failed",
          );
          return;
        }

        try {
          const prepared = await prepareVoiceNative(generation, mode);
          if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) {
            return;
          }
          if (!prepared.aec) {
            pushEvent(
              "error",
              "echo cancellation unavailable — capture continues",
            );
          }
        } catch (err) {
          if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) {
            return;
          }
          failClosed(
            err instanceof Error
              ? err.message
              : "native audio failed to prepare",
          );
          return;
        }

        if (!mountedRef.current) return;
        openSocket(generation, mode);
      };

      void run();
    },
    [
      clearTimers,
      closeSocket,
      failClosed,
      flushPlayback,
      openSocket,
      pushEvent,
      setStatusSafe,
      stopMic,
    ],
  );

  const pttStart = useCallback(() => {
    if (modeRef.current !== "ptt") return;
    if (statusRef.current !== "ready") return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (pttHeldRef.current) return;
    pttHeldRef.current = true;
    playbackAllowedRef.current = false;
    void flushPlayback();
    ws.send(JSON.stringify({ type: "ptt_start" }));
    startMicRef.current(sessionGenRef.current.generation);
  }, [flushPlayback]);

  const pttEnd = useCallback(() => {
    if (modeRef.current !== "ptt") return;
    if (!pttHeldRef.current) return;
    pttHeldRef.current = false;
    stopMic();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ptt_end" }));
    }
  }, [stopMic]);

  const abort = useCallback(() => {
    playbackAllowedRef.current = false;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "abort" }));
    }
    void flushPlayback();
  }, [flushPlayback]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = subscribeVoiceNative({
      onCapture: (generation, pcm) => {
        if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
        if (!micOpenRef.current) return;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try {
          if (pcm.byteLength > 0) ws.send(pcm);
        } catch {
          // drop a failed uplink frame rather than killing capture
        }
      },
      onPlaybackIdle: (generation) => {
        if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
        applySpeaking("playback_idle");
      },
      onWarning: (generation, message) => {
        if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
        pushEvent("error", message);
      },
      onError: (generation, message) => {
        if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
        pushEvent("error", message);
        void flushPlayback();
      },
    });
    const onAppState = (state: AppStateStatus) => {
      if (state !== "active" && pttHeldRef.current) pttEnd();
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => {
      mountedRef.current = false;
      unsubscribe();
      sub.remove();
      sessionGenRef.current = beginDisconnect(sessionGenRef.current);
      pttHeldRef.current = false;
      playbackAllowedRef.current = false;
      clearTimers();
      stopMic();
      closeSocket();
      void flushPlayback();
      void releaseVoiceNative();
    };
  }, [
    applySpeaking,
    clearTimers,
    closeSocket,
    flushPlayback,
    pttEnd,
    pushEvent,
    stopMic,
  ]);

  return {
    status,
    events,
    speaking,
    connect,
    disconnect,
    pttStart,
    pttEnd,
    abort,
  };
}
