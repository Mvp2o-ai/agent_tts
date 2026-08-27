import { randomUUID } from "node:crypto";

export interface QueuedPrompt {
  id: string;
  text: string;
}

/** Utterances that arrive mid-turn wait here until the harness is free. */
export class PromptQueue {
  private items: QueuedPrompt[] = [];
  busy = false;

  enqueue(text: string): QueuedPrompt {
    const item = { id: randomUUID(), text: text.trim() };
    this.items.push(item);
    return item;
  }

  /** Take the next prompt if the harness is idle. */
  takeIfIdle(): QueuedPrompt | undefined {
    if (this.busy) return undefined;
    const next = this.items.shift();
    if (next) this.busy = true;
    return next;
  }

  markIdle(): void {
    this.busy = false;
  }

  get length(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
    this.busy = false;
  }
}
