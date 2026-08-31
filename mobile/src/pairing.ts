export const AGENT_PAIRING_SCHEME = "agenttts:";
export const AGENT_PAIRING_HOST = "pair";

export interface AgentPairingPayload {
  gatewayUrl: string;
  gatewayToken: string;
  name?: string;
}

export function buildAgentPairingUrl(payload: AgentPairingPayload): string {
  const validated = validatePayload(payload);
  const url = new URL(`${AGENT_PAIRING_SCHEME}//${AGENT_PAIRING_HOST}`);
  url.searchParams.set("v", "1");
  url.searchParams.set("url", validated.gatewayUrl);
  url.searchParams.set("token", validated.gatewayToken);
  if (validated.name) url.searchParams.set("name", validated.name);
  return url.toString();
}

export function parseAgentPairingUrl(value: string): AgentPairingPayload | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== AGENT_PAIRING_SCHEME ||
    url.hostname !== AGENT_PAIRING_HOST ||
    url.searchParams.get("v") !== "1"
  ) {
    return null;
  }
  try {
    return validatePayload({
      gatewayUrl: url.searchParams.get("url") ?? "",
      gatewayToken: url.searchParams.get("token") ?? "",
      ...(url.searchParams.get("name")
        ? { name: url.searchParams.get("name") ?? undefined }
        : {}),
    });
  } catch {
    return null;
  }
}

function validatePayload(payload: AgentPairingPayload): AgentPairingPayload {
  const gatewayUrl = payload.gatewayUrl.trim();
  const gatewayToken = payload.gatewayToken.trim();
  const name = payload.name?.trim();
  if (!gatewayUrl || gatewayUrl.length > 2_048) {
    throw new Error("Gateway URL is invalid");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(gatewayUrl);
  } catch {
    throw new Error("Gateway URL is invalid");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("Gateway URL must use HTTP or HTTPS");
  }
  if (!gatewayToken || gatewayToken.length > 4_096) {
    throw new Error("Gateway token is invalid");
  }
  if (name && name.length > 120) {
    throw new Error("Agent name is too long");
  }
  return {
    gatewayUrl: endpoint.toString().replace(/\/$/u, ""),
    gatewayToken,
    ...(name ? { name } : {}),
  };
}
