export interface HarnessEvents {
  onChunk(text: string): void;
  onToolEvent(summary: string): void;
}

export interface Harness {
  run(
    prompt: string,
    events: HarnessEvents,
    signal: AbortSignal,
  ): Promise<"done" | "aborted">;
}
