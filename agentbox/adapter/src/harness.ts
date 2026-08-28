export interface HarnessEvents {
  onChunk(text: string): void;
  onToolEvent(summary: string): void;
}

export interface HarnessRunOpts {
  model?: string;
  effort?: string;
}

export interface Harness {
  run(
    prompt: string,
    events: HarnessEvents,
    signal: AbortSignal,
    opts?: HarnessRunOpts,
  ): Promise<"done" | "aborted">;
}
