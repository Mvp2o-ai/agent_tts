/**
 * Box protocol — JSON-lines messages exchanged between the gateway and an
 * agentbox adapter over the container's stdin/stdout.
 *
 * Canonical copy; adapter/src/protocol.ts must match the wire shapes.
 */

/** Gateway -> box */
export type BoxInbound =
  | { type: "prompt"; id: string; text: string }
  | { type: "abort"; reason: "stop_word" | "user" };

/** Box -> gateway */
export type BoxOutbound =
  | { type: "chunk"; promptId: string; text: string }
  | { type: "tool_event"; promptId: string; summary: string }
  | { type: "done"; promptId: string }
  | { type: "aborted"; promptId: string }
  | { type: "error"; promptId?: string; message: string };

export type HarnessId = "claude-code" | "gemini-cli" | "codex" | "cursor-cli";

export function encodeInbound(msg: BoxInbound): string {
  return `${JSON.stringify(msg)}\n`;
}

export function parseOutbound(line: string): BoxOutbound {
  const msg = JSON.parse(line) as BoxOutbound;
  if (
    msg.type === "chunk" ||
    msg.type === "tool_event" ||
    msg.type === "done" ||
    msg.type === "aborted" ||
    msg.type === "error"
  ) {
    return msg;
  }
  throw new Error(`unknown outbound type: ${(msg as { type: string }).type}`);
}

export function isTerminal(msg: BoxOutbound): boolean {
  return (
    msg.type === "done" ||
    msg.type === "aborted" ||
    msg.type === "error"
  );
}
