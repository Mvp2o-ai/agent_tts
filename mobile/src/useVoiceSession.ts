import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { Connection } from "./api";
import {
  classifyIncomingFrame,
  connectionError,
  nextReconnectDelay,
  probeGatewayHealth,
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
  MAX_TRANSCRIPT_EVENTS,
  type EventKind,
  type SessionEvent,
} from "./session-transcript";
import { transcriptStore } from "./transcript-store";
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
export type { EventKind, SessionEvent };
export type GatewayAvailability =
  | "unknown"
  | "reachable"
  | "unreachable"
  | "gone";

const CONNECT_TIMEOUT_MS = 20_000;
let nextConnectionGeneration = 0;
let audioOwnerProfileId: string | null = null;

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
  eventId?: number;
  generationId?: string;
  oldestEventId?: number;
  lastEventId?: number;
  sessionState?: "idle" | "working" | "speaking";
  stage?: "preparing" | "cloning" | "starting_harness";
  repository?: string;
  index?: number;
  total?: number;
};

export interface ProvisioningState {
  stage: "preparing" | "cloning" | "starting_harness";
  repository?: string;
  index?: number;
  total: number;
}

function isBlob(data: unknown): data is Blob {
  return typeof Blob !== "undefined" && data instanceof Blob;
}

function beginUniqueConnect(state: SessionGeneration): SessionGeneration {
  const next = beginConnect(state);
  return { ...next, generation: ++nextConnectionGeneration };
}

export function useVoiceSession(
  conn: Connection,
  options: {
    profileId: string;
    focused: boolean;
    managedHost?: boolean;
    getGitCredential?: () => Promise<string>;
  },
): {
  status: SessionStatus;
  availability: GatewayAvailability;
  events: SessionEvent[];
  speaking: boolean;
  working: boolean;
  harness: string;
  generationId: string;
  provisioning: ProvisioningState | null;
  lastError: string;
  connect: (mode: VoiceMode) => void;
  disconnect: () => void;
  pttStart: () => void;
  pttEnd: () => void;
  abort: () => void;
} {
  const [status, setStatus] = useState<SessionStatus>("disconnected");
  const [availability, setAvailability] =
    useState<GatewayAvailability>("unknown");
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [working, setWorking] = useState(false);
  const [harness, setHarness] = useState("");
  const [generationId, setGenerationId] = useState("");
  const [lastError, setLastError] = useState("");
  const [provisioning, setProvisioning] =
    useState<ProvisioningState | null>(null);
  const [lastEventId, setLastEventId] = useState(0);
  const [transcriptHydrated, setTranscriptHydrated] = useState(false);

  const connRef = useRef(conn);
  connRef.current = conn;
  const focusedRef = useRef(options.focused);
  focusedRef.current = options.focused;
  const getGitCredentialRef = useRef(options.getGitCredential);
  getGitCredentialRef.current = options.getGitCredential;
  const profileIdRef = useRef(options.profileId);
  profileIdRef.current = options.profileId;
  const managedHostRef = useRef(Boolean(options.managedHost));
  managedHostRef.current = Boolean(options.managedHost);

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
  const generationIdRef = useRef("");
  const lastEventIdRef = useRef(0);

  useEffect(() => {
    let current = true;
    setTranscriptHydrated(false);
    void transcriptStore.load(options.profileId).then((saved) => {
      if (!current) return;
      generationIdRef.current = saved.generationId;
      lastEventIdRef.current = saved.lastEventId;
      eventIdRef.current = saved.events.reduce(
        (max, event) => Math.max(max, event.id),
        0,
      );
      setGenerationId(saved.generationId);
      setLastEventId(saved.lastEventId);
      setEvents(saved.events);
      setTranscriptHydrated(true);
    });
    return () => {
      current = false;
    };
  }, [options.profileId]);

  useEffect(() => {
    if (!transcriptHydrated) return;
    void transcriptStore.save(options.profileId, {
      generationId,
      lastEventId,
      events,
    });
  }, [
    events,
    generationId,
    lastEventId,
    options.profileId,
    transcriptHydrated,
  ]);

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
      return next.length > MAX_TRANSCRIPT_EVENTS
        ? next.slice(-MAX_TRANSCRIPT_EVENTS)
        : next;
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
      return next.length > MAX_TRANSCRIPT_EVENTS
        ? next.slice(-MAX_TRANSCRIPT_EVENTS)
        : next;
    });
  }, []);

  const stopMic = useCallback(() => {
    if (!micOpenRef.current) return;
    micOpenRef.current = false;
    void stopNativeCapture();
  }, []);

  const flushPlayback = useCallback(async () => {
    if (audioOwnerProfileId !== profileIdRef.current) return;
    applySpeaking("flush");
    try {
      await flushNativePlayback();
    } catch {
      // already released
    }
  }, [applySpeaking]);

  const releaseOwnedVoice = useCallback(async () => {
    if (audioOwnerProfileId !== profileIdRef.current) return;
    audioOwnerProfileId = null;
    try {
      await releaseVoiceNative();
    } catch {
      // already released
    }
  }, []);

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

  const failClosedRef = useRef<
    (message: string, availability?: GatewayAvailability) => void
  >(() => undefined);
  const startMicRef = useRef<(generation: number) => void>(() => undefined);

  const failClosed = useCallback(
    (
      message: string,
      nextAvailability: GatewayAvailability = "unreachable",
    ) => {
      sessionGenRef.current = beginDisconnect(sessionGenRef.current);
      pttHeldRef.current = false;
      playbackAllowedRef.current = false;
      clearTimers();
      stopMic();
      closeSocket();
      void flushPlayback();
      void releaseOwnedVoice();
      setLastError(message);
      setAvailability(nextAvailability);
      setProvisioning(null);
      setStatusSafe("disconnected");
    },
    [clearTimers, closeSocket, flushPlayback, setStatusSafe, stopMic],
  );
  failClosedRef.current = failClosed;

  startMicRef.current = (generation: number) => {
    if (micOpenRef.current) return;
    if (!focusedRef.current) return;
    if (audioOwnerProfileId !== profileIdRef.current) return;
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
      if (
        typeof msg.eventId === "number" &&
        Number.isSafeInteger(msg.eventId) &&
        msg.eventId > lastEventIdRef.current
      ) {
        lastEventIdRef.current = msg.eventId;
        setLastEventId(msg.eventId);
      }
      switch (msg.type) {
        case "provisioning": {
          if (!msg.stage) break;
          if (connectTimerRef.current) {
            clearTimeout(connectTimerRef.current);
            connectTimerRef.current = null;
          }
          setProvisioning({
            stage: msg.stage,
            total: msg.total ?? 0,
            ...(msg.repository ? { repository: msg.repository } : {}),
            ...(msg.index !== undefined ? { index: msg.index } : {}),
          });
          setStatusSafe("provisioning");
          break;
        }
        case "ready": {
          setLastError("");
          playbackAllowedRef.current = false;
          const formatErr = validateReadyAudioFormat(msg.audioFormat);
          if (formatErr) {
            failClosed(formatErr);
            return;
          }
          if (msg.generationId) {
            const changed =
              generationIdRef.current !== "" &&
              generationIdRef.current !== msg.generationId;
            generationIdRef.current = msg.generationId;
            setGenerationId(msg.generationId);
            if (changed) {
              eventIdRef.current = 0;
              lastEventIdRef.current = 0;
              setLastEventId(0);
              setEvents([]);
              setWorking(false);
            }
          }
          if (msg.harness) setHarness(msg.harness);
          setWorking(
            msg.sessionState === "working" || msg.sessionState === "speaking",
          );
          reconnectAttemptRef.current = 0;
          setProvisioning(null);
          if (connectTimerRef.current) {
            clearTimeout(connectTimerRef.current);
            connectTimerRef.current = null;
          }
          setStatusSafe("ready");
          pushEvent(
            "ready",
            `connected (${msg.mode ?? modeRef.current}${msg.harness ? `, ${msg.harness}` : ""})`,
          );
          if (modeRef.current === "handsfree" && focusedRef.current) {
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
          setWorking(true);
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
          setWorking(false);
          pushEvent("stopped", msg.reason ?? "stopped");
          void flushPlayback();
          break;
        case "done":
          setWorking(false);
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
      if (!focusedRef.current) return;
      if (audioOwnerProfileId !== profileIdRef.current) return;
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
    (generation: number, mode: VoiceMode, gitCredential: string) => {
      const current = connRef.current;
      const err = connectionError(current);
      if (err) {
        failClosed(err);
        return;
      }

      void probeGatewayHealth(current.gatewayUrl).then((health) => {
        if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
        if (health.status !== "reachable") {
          const gone = health.status === "missing" && managedHostRef.current;
          failClosed(
            gone
              ? "This deployment was removed from its provider."
              : health.message,
            gone ? "gone" : "unreachable",
          );
          return;
        }
        setAvailability("reachable");

        let ws: WebSocket;
        try {
          ws = new WebSocket(
            voiceUrl(current, mode, {
              focused: focusedRef.current,
              afterEventId: lastEventIdRef.current,
            }),
          );
        } catch (cause) {
          failClosed(
            cause instanceof Error ? cause.message : "failed to open websocket",
          );
          return;
        }
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;
        ws.onopen = () => {
          if (wsRef.current !== ws) return;
          if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
          ws.send(
            JSON.stringify({
              type: "git_auth",
              credential: gitCredential,
            }),
          );
        };

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
            void releaseOwnedVoice();
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
            void releaseOwnedVoice();
            setLastError(message);
            setAvailability("unreachable");
            setStatusSafe("disconnected");
            return;
          }

          reconnectAttemptRef.current += 1;
          setStatusSafe("connecting");
          reconnectTimerRef.current = setTimeout(() => {
            if (sessionGenRef.current.userClosed) return;
            if (sessionGenRef.current.generation !== generation) return;
            sessionGenRef.current = beginUniqueConnect(sessionGenRef.current);
            const nextGen = sessionGenRef.current.generation;
            void releaseOwnedVoice()
              .catch(() => undefined)
              .then(() => {
                if (!focusedRef.current) return null;
                audioOwnerProfileId = profileIdRef.current;
                return prepareVoiceNative(nextGen, modeRef.current);
              })
              .then(async () => {
                if (!shouldAcceptNativeEvent(sessionGenRef.current, nextGen)) {
                  return;
                }
                const credential =
                  (await getGitCredentialRef.current?.()) ?? "";
                if (!shouldAcceptNativeEvent(sessionGenRef.current, nextGen)) {
                  return;
                }
                openSocket(nextGen, modeRef.current, credential);
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
      });
    },
    [
      failClosed,
      flushPlayback,
      handleFrame,
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
    void releaseOwnedVoice();
    setProvisioning(null);
    setStatusSafe("disconnected");
  }, [clearTimers, closeSocket, flushPlayback, setStatusSafe, stopMic]);

  const connect = useCallback(
    (mode: VoiceMode) => {
      sessionGenRef.current = beginUniqueConnect(sessionGenRef.current);
      const generation = sessionGenRef.current.generation;
      reconnectAttemptRef.current = 0;
      modeRef.current = mode;
      pttHeldRef.current = false;
      playbackAllowedRef.current = false;
      clearTimers();
      stopMic();
      closeSocket();
      void flushPlayback();
      setProvisioning(null);
      setLastError("");
      setAvailability("unknown");
      setStatusSafe("connecting");

      const run = async () => {
        let credential: string;
        try {
          credential = (await getGitCredentialRef.current?.()) ?? "";
        } catch (err) {
          if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
          failClosed(
            err instanceof Error
              ? err.message
              : "GitHub credential is unavailable",
          );
          return;
        }
        if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
        if (!focusedRef.current) {
          openSocket(generation, mode, credential);
          return;
        }
        audioOwnerProfileId = profileIdRef.current;
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
        openSocket(generation, mode, credential);
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
    if (!focusedRef.current) return;
    if (audioOwnerProfileId !== profileIdRef.current) return;
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
    const ws = wsRef.current;
    if (!options.focused) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "focus", focused: false }));
      }
      pttHeldRef.current = false;
      playbackAllowedRef.current = false;
      stopMic();
      void flushPlayback();
      void releaseOwnedVoice();
      applySpeaking("flush");
      return;
    }

    if (statusRef.current !== "ready") return;
    const timer = setTimeout(() => {
      if (!focusedRef.current || statusRef.current !== "ready") return;
      const generation = sessionGenRef.current.generation;
      audioOwnerProfileId = profileIdRef.current;
      void prepareVoiceNative(generation, modeRef.current)
        .then(() => {
          if (!focusedRef.current) return;
          const currentWs = wsRef.current;
          if (currentWs?.readyState === WebSocket.OPEN) {
            currentWs.send(JSON.stringify({ type: "focus", focused: true }));
          }
          if (modeRef.current === "handsfree") {
            startMicRef.current(generation);
          }
        })
        .catch((err) => {
          pushEvent(
            "error",
            err instanceof Error
              ? err.message
              : "native audio failed to prepare",
          );
        });
    }, 0);
    return () => clearTimeout(timer);
  }, [
    applySpeaking,
    flushPlayback,
    options.focused,
    pushEvent,
    releaseOwnedVoice,
    stopMic,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = subscribeVoiceNative({
      onCapture: (generation, pcm) => {
        if (!focusedRef.current) return;
        if (audioOwnerProfileId !== profileIdRef.current) return;
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
        if (audioOwnerProfileId !== profileIdRef.current) return;
        if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
        applySpeaking("playback_idle");
      },
      onWarning: (generation, message) => {
        if (audioOwnerProfileId !== profileIdRef.current) return;
        if (!shouldAcceptNativeEvent(sessionGenRef.current, generation)) return;
        pushEvent("error", message);
      },
      onError: (generation, message) => {
        if (audioOwnerProfileId !== profileIdRef.current) return;
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
      void releaseOwnedVoice();
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
    availability,
    events,
    speaking,
    working,
    harness,
    generationId,
    provisioning,
    lastError,
    connect,
    disconnect,
    pttStart,
    pttEnd,
    abort,
  };
}
