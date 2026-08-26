/**
 * Box protocol — JSON-lines messages exchanged between the gateway and an
 * agentbox adapter over the container's stdin/stdout.
 *
 * The adapter normalizes whichever harness is selected (claude-code,
 * gemini-cli, codex, cursor-cli) to this contract, so the gateway and mobile
 * app never know which harness is inside.
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
