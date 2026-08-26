/**
 * agentbox adapter — entry point.
 *
 * Startup:
 *  1. Read env: WALKIE_HARNESS, WALKIE_REPO_URL, WALKIE_GIT_CREDENTIAL,
 *     harness/model keys (BYO, passed through by the gateway from user config).
 *  2. Clone the repo into /workspace.
 *  3. Select the harness adapter and bridge it to the JSON-lines box protocol
 *     on stdin/stdout: prompt -> chunks / tool_events -> done | aborted.
 *
 * Abort semantics: an { type: "abort" } message kills the in-flight harness
 * turn immediately — this backs the mobile stop word.
 */

const harness = process.env.WALKIE_HARNESS ?? "claude-code";

console.log(
  JSON.stringify({
    type: "error",
    message: `agentbox scaffold: harness "${harness}" adapter not implemented (M1)`,
  }),
);
