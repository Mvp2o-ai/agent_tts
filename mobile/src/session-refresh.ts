import type { AgentDesiredState } from "./settings";

export const NEW_SESSION_WARNING =
  "This recreates the current container. Uncommitted and unpushed work will be lost.";

/** A running host must stop before the platform can boot a fresh instance. */
export function shouldStopHostBeforeNewSession(
  desiredState?: AgentDesiredState,
): boolean {
  return (desiredState ?? "running") !== "stopped";
}
