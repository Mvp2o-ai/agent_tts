const DEFAULT_BIND = "0.0.0.0";
const ALLOWED_BIND_HOSTS = new Set(["0.0.0.0", "127.0.0.1", "::", "::1"]);

/**
 * Address the HTTP/WebSocket server binds inside this process.
 *
 * Container hosts must keep `0.0.0.0` so the platform proxy and Docker
 * port-publish can reach `PORT`. Loopback is for a gateway running on the
 * host itself (`npm run dev:gateway`). Publishing the container on the
 * host's LAN is a Compose/port-map choice, not this bind.
 */
export function gatewayBindHost(value: string | undefined): string {
  const host = value?.trim() || DEFAULT_BIND;
  if (!ALLOWED_BIND_HOSTS.has(host)) {
    throw new Error("GATEWAY_BIND must be 0.0.0.0, 127.0.0.1, ::, or ::1");
  }
  return host;
}
