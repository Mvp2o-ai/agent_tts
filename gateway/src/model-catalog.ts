import type { HarnessId } from "./box-protocol.js";

export interface CatalogModel {
  id: string;
  label: string;
  efforts: string[];
  default?: boolean;
}

export interface ModelCatalog {
  harness: string;
  models: CatalogModel[];
}

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CLAUDE_SONNET_46_EFFORTS = ["low", "medium", "high", "max"];
const CODEX_EFFORTS = ["low", "medium", "high", "xhigh"];

function entry(
  id: string,
  label: string,
  efforts: string[],
  isDefault = false,
): CatalogModel {
  const model: CatalogModel = { id, label, efforts };
  if (isDefault) model.default = true;
  return model;
}

/**
 * Static catalogs verified against official docs 2026-08.
 * Unknown IDs are still passed through on the prompt wire; this list is advisory.
 */
const CATALOGS: Record<HarnessId, CatalogModel[]> = {
  "claude-code": [
    entry("claude-sonnet-5", "Sonnet 5", CLAUDE_EFFORTS, true),
    entry("claude-opus-5", "Opus 5", CLAUDE_EFFORTS),
    entry("claude-fable-5", "Fable 5", CLAUDE_EFFORTS),
    entry("claude-opus-4-8", "Opus 4.8", CLAUDE_EFFORTS),
    entry("claude-sonnet-4-6", "Sonnet 4.6", CLAUDE_SONNET_46_EFFORTS),
    entry("claude-haiku-4-5-20251001", "Haiku 4.5", []),
  ],
  // Catalog is a static fallback; Cursor availability is account-dependent
  // and a future enhancement should list via `agent --list-models`.
  "cursor-cli": [
    entry("auto", "Auto", [], true),
    entry("composer-2.5", "Composer 2.5", []),
    entry("gpt-5.6-sol-fast", "GPT-5.6 Sol Fast", []),
    entry("gpt-5.3-codex-high", "GPT-5.3 Codex High", []),
    entry("claude-opus-5-fast", "Opus 5 Fast", []),
    entry("sonnet-4-thinking", "Sonnet 4 Thinking", []),
  ],
  // Gemini CLI v0.57 has no thinking/effort flag; effort is unused.
  "gemini-cli": [
    entry("auto", "Auto", [], true),
    entry("gemini-3.5-flash", "Gemini 3.5 Flash", []),
    entry("gemini-3.1-pro-preview", "Gemini 3.1 Pro", []),
    entry("gemini-2.5-pro", "Gemini 2.5 Pro", []),
    entry("gemini-2.5-flash", "Gemini 2.5 Flash", []),
  ],
  codex: [
    entry("gpt-5.6-terra", "GPT-5.6 Terra", CODEX_EFFORTS, true),
    entry("gpt-5.6-sol", "GPT-5.6 Sol", CODEX_EFFORTS),
    entry("gpt-5.6-luna", "GPT-5.6 Luna", CODEX_EFFORTS),
    entry("gpt-5.4", "GPT-5.4", CODEX_EFFORTS),
    entry("gpt-5.4-mini", "GPT-5.4 Mini", CODEX_EFFORTS),
  ],
};

export function isHarnessId(value: string): value is HarnessId {
  return Object.hasOwn(CATALOGS, value);
}

export function modelCatalogFor(harness: string): ModelCatalog | undefined {
  if (!isHarnessId(harness)) return undefined;
  return { harness, models: CATALOGS[harness] };
}
