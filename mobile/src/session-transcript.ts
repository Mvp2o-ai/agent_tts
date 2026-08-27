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

export interface SessionTranscript {
  generationId: string;
  lastEventId: number;
  events: SessionEvent[];
}

export interface TranscriptKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const MAX_TRANSCRIPT_EVENTS = 200;
const STORAGE_PREFIX = "agent_tts.transcript.v1.";
const EVENT_KINDS = new Set<EventKind>([
  "transcript",
  "agent",
  "tool",
  "error",
  "ready",
  "queued",
  "prompt",
  "stopped",
  "done",
  "barge_in",
  "partial",
]);

export function transcriptStorageKey(profileId: string): string {
  return `${STORAGE_PREFIX}${profileId}`;
}

export function parseSessionTranscript(raw: string): SessionTranscript {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const events = Array.isArray(value.events)
      ? value.events
          .map(parseEvent)
          .filter((event): event is SessionEvent => event !== null)
          .slice(-MAX_TRANSCRIPT_EVENTS)
      : [];
    return {
      generationId:
        typeof value.generationId === "string" ? value.generationId : "",
      lastEventId:
        typeof value.lastEventId === "number" &&
        Number.isSafeInteger(value.lastEventId) &&
        value.lastEventId >= 0
          ? value.lastEventId
          : 0,
      events,
    };
  } catch {
    return { generationId: "", lastEventId: 0, events: [] };
  }
}

export function createSessionTranscriptStore(kv: TranscriptKeyValueStore) {
  return {
    async load(profileId: string): Promise<SessionTranscript> {
      const raw = await kv.getItem(transcriptStorageKey(profileId));
      return raw
        ? parseSessionTranscript(raw)
        : { generationId: "", lastEventId: 0, events: [] };
    },
    async save(profileId: string, transcript: SessionTranscript): Promise<void> {
      await kv.setItem(
        transcriptStorageKey(profileId),
        JSON.stringify({
          ...transcript,
          events: transcript.events.slice(-MAX_TRANSCRIPT_EVENTS),
        }),
      );
    },
    async clear(profileId: string): Promise<void> {
      await kv.removeItem(transcriptStorageKey(profileId));
    },
  };
}

function parseEvent(value: unknown): SessionEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.id !== "number" ||
    !Number.isSafeInteger(event.id) ||
    typeof event.kind !== "string" ||
    !EVENT_KINDS.has(event.kind as EventKind) ||
    typeof event.text !== "string"
  ) {
    return null;
  }
  return {
    id: event.id,
    kind: event.kind as EventKind,
    text: event.text,
  };
}
