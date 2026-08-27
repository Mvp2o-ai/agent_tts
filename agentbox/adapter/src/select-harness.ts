import type { Harness } from "./harness.js";
import type { HarnessId } from "./protocol.js";
import { createClaudeCodeHarness } from "./harnesses/claude-code.js";
import { createCursorCliHarness } from "./harnesses/cursor-cli.js";
import { createGeminiCliHarness } from "./harnesses/gemini-cli.js";
import { createCodexHarness } from "./harnesses/codex.js";

const HARNESSES: HarnessId[] = [
  "claude-code",
  "cursor-cli",
  "gemini-cli",
  "codex",
];

export function selectHarness(id: string, workspace: string): Harness {
  if (!HARNESSES.includes(id as HarnessId)) {
    throw new Error(
      `unknown harness "${id}". Use one of: ${HARNESSES.join(", ")}`,
    );
  }
  switch (id as HarnessId) {
    case "claude-code":
      return createClaudeCodeHarness(workspace);
    case "cursor-cli":
      return createCursorCliHarness(workspace);
    case "gemini-cli":
      return createGeminiCliHarness(workspace);
    case "codex":
      return createCodexHarness(workspace);
    default:
      throw new Error(`unknown harness "${id}"`);
  }
}
