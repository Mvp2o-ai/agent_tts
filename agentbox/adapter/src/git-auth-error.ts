/** Stable code for mobile/gateway reconnect prompts. */
export const GIT_AUTH_REQUIRED_CODE = "git_auth_required" as const;

const AUTH_FAILURE_PATTERNS: RegExp[] = [
  /\bauthentication failed\b/i,
  /\bcould not read Username\b/i,
  /\binvalid credentials\b/i,
  /\bbad credentials\b/i,
  /\bHTTP\s+401\b/i,
  /\bHTTP\s+403\b/i,
  /\bstatus code 401\b/i,
  /\bstatus code 403\b/i,
  /\b403\s+Forbidden\b/i,
  /\b401\s+Unauthorized\b/i,
  /\bRepository not found\b/i,
  /\bremote:.*(Permission denied|denied to|Write access|access denied)/i,
  /\bPermission denied \(publickey\)\b/i,
  /\bfatal:.*Authentication\b/i,
  /\bgh:\s*To get started with GitHub/i,
  /\bHTTP 401 Unauthorized\b/i,
  /\bGitHub authorization expired\b/i,
  /\bGitHub authorization is missing\b/i,
  /\bconnect GitHub again\b/i,
];

export function isGitAuthFailureMessage(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

export function gitAuthRequiredMessage(detail?: string): string {
  const trimmed = detail?.trim();
  if (trimmed && /connect GitHub again/i.test(trimmed)) return trimmed;
  return "GitHub authorization expired; connect GitHub again";
}
