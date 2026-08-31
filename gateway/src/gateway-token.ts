const INSECURE_GATEWAY_TOKENS = new Set([
  "change-me",
  "changeme",
  "replace-me",
  "your-token-here",
]);

export function requireGatewayToken(value: string | undefined): string {
  const token = value?.trim();
  if (!token || INSECURE_GATEWAY_TOKENS.has(token.toLowerCase())) {
    throw new Error("GATEWAY_TOKEN must be a non-placeholder secret");
  }
  return token;
}
