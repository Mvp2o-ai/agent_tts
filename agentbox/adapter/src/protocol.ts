/**
 * JSON-lines box protocol. Keep in sync with gateway/src/box-protocol.ts.
 */

export type BoxInbound =
  | { type: "prompt"; id: string; text: string }
  | { type: "abort"; reason: "stop_word" | "user" };

export type BoxOutbound =
  | { type: "chunk"; promptId: string; text: string }
  | { type: "tool_event"; promptId: string; summary: string }
  | { type: "done"; promptId: string }
  | { type: "aborted"; promptId: string }
  | { type: "error"; promptId?: string; message: string };

export type HarnessId = "claude-code" | "gemini-cli" | "codex" | "cursor-cli";

export function parseInbound(line: string): BoxInbound {
  const msg = JSON.parse(line) as BoxInbound;
  if (msg.type === "prompt") {
    if (!msg.id || typeof msg.text !== "string") {
      throw new Error("prompt requires id and text");
    }
    return msg;
  }
  if (msg.type === "abort") {
    if (msg.reason !== "stop_word" && msg.reason !== "user") {
      throw new Error("abort requires reason stop_word|user");
    }
    return msg;
  }
  throw new Error(`unknown inbound type: ${(msg as { type: string }).type}`);
}

export function encodeOutbound(msg: BoxOutbound): string {
  return `${JSON.stringify(msg)}\n`;
}
