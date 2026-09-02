export type TalkState =
  | "needs-setup"
  | "stopped"
  | "starting"
  | "unreachable"
  | "gone"
  | "idle"
  | "capturing"
  | "thinking"
  | "working"
  | "speaking";

export type TalkDisplayState =
  | "needs-setup"
  | "stopped"
  | "starting"
  | "running"
  | "unreachable"
  | "gone"
  | "error";

/**
 * Busy caption while a turn is in progress but PCM is not playing.
 *
 * Thinking vs working is derived from events every harness already emits:
 * prompt/text → thinking, tool_event → working. Planning is not a state:
 * Cursor print-mode suppresses thinking events, Claude thinking blocks are
 * often redacted, Codex reasoning is optional, and Gemini thought events
 * are not guaranteed on the pinned CLI.
 */
export type TalkBusyKind = "thinking" | "working";

export function talkBusyKindAfter(
  event: "prompt_start" | "tool_event" | "agent_text" | "reset",
): TalkBusyKind {
  return event === "tool_event" ? "working" : "thinking";
}

export function resolveTalkState(
  displayState: TalkDisplayState,
  speaking: boolean,
  working: boolean,
  ttsOpen: boolean,
  held: boolean,
  busyKind: TalkBusyKind,
): TalkState {
  if (held) return "capturing";
  if (speaking) return "speaking";
  if (displayState === "needs-setup") return "needs-setup";
  if (displayState === "stopped") return "stopped";
  if (displayState === "starting") return "starting";
  if (displayState === "gone") return "gone";
  if (displayState === "unreachable" || displayState === "error") {
    return "unreachable";
  }
  const busy = working || ttsOpen;
  if (busy && busyKind === "working") return "working";
  if (busy) return "thinking";
  return "idle";
}
