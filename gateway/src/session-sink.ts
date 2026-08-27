import WebSocket from "ws";
import type { ClientEvent, VoiceSink } from "./agent-turn.js";

export type SequencedClientEvent = ClientEvent & { eventId: number };

/**
 * A session-owned sink that can outlive WebSocket attachments. JSON events
 * are retained for reconnect catch-up; PCM is live-only and focus-gated.
 */
export class SessionSink implements VoiceSink {
  private socket: WebSocket | undefined;
  private focused = false;
  private nextEventId = 0;
  private readonly events: SequencedClientEvent[] = [];

  constructor(private readonly maxEvents = 500) {}

  get lastEventId(): number {
    return this.nextEventId;
  }

  get oldestEventId(): number {
    return this.events[0]?.eventId ?? 0;
  }

  attach(socket: WebSocket, focused: boolean): void {
    this.socket = socket;
    this.focused = focused;
  }

  detach(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.focused = false;
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
  }

  replayAfter(eventId: number): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    for (const event of this.events) {
      if (event.eventId > eventId) socket.send(JSON.stringify(event));
    }
  }

  sendJson(event: ClientEvent): void {
    const sequenced = { ...event, eventId: ++this.nextEventId };
    this.events.push(sequenced);
    if (this.events.length > this.maxEvents) this.events.shift();

    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(sequenced));
    }
  }

  sendAudio(pcm: Buffer): void {
    const socket = this.socket;
    if (this.focused && socket?.readyState === WebSocket.OPEN) {
      socket.send(pcm);
    }
  }
}
