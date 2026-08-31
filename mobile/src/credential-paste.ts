import { HARNESSES } from "./settings";
import {
  listVoiceProviders,
  VOICE_PROVIDERS,
} from "./voice-providers";

/**
 * Routes KEY=value input to App credential fields.
 * A bare value is not a smart paste.
 */

export type CredentialPasteAssignment =
  | {
      kind: "model";
      keyEnv: string;
      label: string;
      secret: string;
    }
  | {
      kind: "voice";
      providerId: string;
      keyEnv: string;
      fieldKey: string;
      label: string;
      secret: string;
    };

export interface CredentialPasteResult {
  detected: boolean;
  assignments: CredentialPasteAssignment[];
  sttProviderId?: string;
  ttsProviderId?: string;
}

const LINE_RE =
  /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.*?)\s*$/;

// A single-line TextInput joins a multiline paste into one line, so a
// pasted .env arrives as "A=1 B=2 C=3". Split again before each NAME= token.
const JOINED_PAIR_BOUNDARY = /\s+(?=(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=)/;

export function parseKeyValuePairs(
  text: string,
): { name: string; value: string }[] {
  const pairs: { name: string; value: string }[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    for (const segment of line.split(JOINED_PAIR_BOUNDARY)) {
      const hit = LINE_RE.exec(segment);
      if (!hit) continue;
      const name = hit[1] ?? "";
      if (!name) continue;
      pairs.push({
        name,
        value: stripQuotes(hit[2] ?? "").trim(),
      });
    }
  }
  return pairs;
}

export function applyCredentialPaste(
  text: string,
  options: {
    sttProviderId: string;
    ttsProviderId: string;
  },
): CredentialPasteResult {
  const pairs = parseKeyValuePairs(text);
  if (pairs.length === 0) {
    return { detected: false, assignments: [] };
  }

  const assignments = new Map<string, CredentialPasteAssignment>();
  let sttProviderId: string | undefined;
  let ttsProviderId: string | undefined;

  for (const { name, value } of pairs) {
    if (name.toUpperCase() === "STT_PROVIDER") {
      sttProviderId = providerIdForValue("stt", value) ?? sttProviderId;
      continue;
    }
    if (name.toUpperCase() === "TTS_PROVIDER") {
      ttsProviderId = providerIdForValue("tts", value) ?? ttsProviderId;
      continue;
    }
    if (!value) continue;

    const harness = HARNESSES.find((candidate) =>
      nameMatchesTarget(name, [
        candidate.keyEnv,
        candidate.id,
        candidate.label,
      ]),
    );
    if (harness) {
      assignments.set(`model:${harness.keyEnv}`, {
        kind: "model",
        keyEnv: harness.keyEnv,
        label: harness.label,
        secret: value,
      });
      continue;
    }

    const voiceMatch = VOICE_PROVIDERS.flatMap((provider) =>
      provider.credentialFields.map((field) => ({ provider, field })),
    ).find(({ provider, field }) =>
      nameMatchesTarget(name, [field.env, provider.id, provider.label]),
    );
    if (!voiceMatch) continue;

    const { provider, field } = voiceMatch;
    assignments.set(`voice:${provider.id}:${field.env}`, {
      kind: "voice",
      providerId: provider.id,
      keyEnv: field.env,
      fieldKey: `${provider.id}:${field.env}`,
      label: provider.label,
      secret: value,
    });
    if (provider.role === "stt") {
      sttProviderId ??= provider.id;
    } else {
      ttsProviderId ??= provider.id;
    }
  }

  return {
    detected: true,
    assignments: [...assignments.values()],
    sttProviderId,
    ttsProviderId,
  };
}

function providerIdForValue(
  role: "stt" | "tts",
  value: string,
): string | undefined {
  const normalized = normalize(value);
  return listVoiceProviders(role).find(
    (provider) =>
      normalize(provider.id) === normalized ||
      normalize(provider.label) === normalized,
  )?.id;
}

function nameMatchesTarget(name: string, targetNames: readonly string[]): boolean {
  const normalizedName = normalize(name);
  return targetNames.some((target) => {
    if (normalize(target) === normalizedName) return true;
    const alias = semanticName(target);
    return alias.length >= 4 && normalizedName.includes(alias);
  });
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function semanticName(value: string): string {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (part) =>
        part &&
        part !== "api" &&
        part !== "key" &&
        part !== "token" &&
        part !== "secret" &&
        part !== "cli" &&
        part !== "code",
    )
    .join("");
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
