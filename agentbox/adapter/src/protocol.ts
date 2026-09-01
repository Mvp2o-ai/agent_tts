/**
 * JSON-lines box protocol. Keep in sync with gateway/src/box-protocol.ts.
 */

export type BoxInbound =
  | { type: "initialize"; credential?: string }
  | { type: "git_auth"; credential: string }
  | { type: "prompt"; id: string; text: string; model?: string; effort?: string }
  | { type: "abort"; reason: "stop_word" | "user" };

export type BoxOutbound =
  | {
      type: "provisioning";
      stage: "preparing" | "cloning" | "starting_harness";
      repository?: string;
      index?: number;
      total: number;
    }
  | { type: "ready"; repositories: number }
  | {
      type: "git_auth";
      state: "ready" | "cleared" | "required";
      message?: string;
      login?: string;
    }
  | { type: "chunk"; promptId: string; text: string }
  | { type: "tool_event"; promptId: string; summary: string }
  | { type: "done"; promptId: string }
  | { type: "aborted"; promptId: string }
  | {
      type: "error";
      promptId?: string;
      message: string;
      code?: "git_auth_required";
    };

export type HarnessId = "claude-code" | "gemini-cli" | "codex" | "cursor-cli";

function optionalPromptString(value: unknown, field: "model" | "effort"): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`prompt ${field} must be a non-empty string`);
  }
  if (value === "") return undefined;
  return value;
}

export function parseInbound(line: string): BoxInbound {
  const msg = JSON.parse(line) as { type?: string } & Record<string, unknown>;
  if (msg.type === "initialize") {
    if (msg.credential !== undefined && typeof msg.credential !== "string") {
      throw new Error("initialize credential must be a string");
    }
    return {
      type: "initialize",
      ...(typeof msg.credential === "string"
        ? { credential: msg.credential }
        : {}),
    };
  }
  if (msg.type === "git_auth") {
    if (typeof msg.credential !== "string") {
      throw new Error("git_auth requires credential string");
    }
    if (msg.credential.length > 65_536) {
      throw new Error("git_auth credential is too large");
    }
    return { type: "git_auth", credential: msg.credential };
  }
  if (msg.type === "prompt") {
    if (!msg.id || typeof msg.text !== "string") {
      throw new Error("prompt requires id and text");
    }
    const model = optionalPromptString(msg.model, "model");
    const effort = optionalPromptString(msg.effort, "effort");
    return {
      type: "prompt",
      id: String(msg.id),
      text: msg.text,
      ...(model !== undefined ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
    };
  }
  if (msg.type === "abort") {
    const reason = msg.reason;
    if (reason !== "stop_word" && reason !== "user") {
      throw new Error("abort requires reason stop_word|user");
    }
    return { type: "abort", reason };
  }
  throw new Error(`unknown inbound type: ${msg.type}`);
}

export function encodeOutbound(msg: BoxOutbound): string {
  return `${JSON.stringify(msg)}\n`;
}
