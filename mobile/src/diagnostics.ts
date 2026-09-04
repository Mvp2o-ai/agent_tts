import {
  diagnosticsUrl,
  gatewayAuthHeaders,
  normalizeGatewayUrl,
} from "./protocol";

export type DiagnosticDetails = Record<
  string,
  string | number | boolean | undefined
>;

type DiagnosticRequest = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

type DiagnosticPayload = {
  ts: string;
  source: "mobile";
  channel: string;
  event: string;
  details: Record<string, string | number | boolean>;
};

const MAX_QUEUE = 20;
const queue: DiagnosticPayload[] = [];
let sink: { gatewayUrl: string; token: string } | null = null;
let transport: DiagnosticRequest = fetch;
let sending = false;

/** Direct client logs at this agent's gateway. Does not wait for the POST. */
export function bindClientLogGateway(gatewayUrl: string, token: string): void {
  const url = normalizeGatewayUrl(gatewayUrl);
  const secret = token.trim();
  if (!url || !secret) return;
  sink = { gatewayUrl: url, token: secret };
  kick();
}

export function emitDiagnostic(
  channel: string,
  event: string,
  details?: DiagnosticDetails,
  request: DiagnosticRequest = fetch,
): void {
  transport = request;
  const payload: DiagnosticPayload = {
    ts: new Date().toISOString(),
    source: "mobile",
    channel,
    event,
    details: Object.fromEntries(
      Object.entries(details ?? {}).filter(
        (entry): entry is [string, string | number | boolean] =>
          entry[1] !== undefined && entry[1] !== "",
      ),
    ),
  };
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(payload);
  kick();
}

/** Test helper. Production callers must not await client logs. */
export async function flushDiagnostics(): Promise<void> {
  for (let i = 0; i < 20 && (queue.length > 0 || sending); i += 1) {
    kick();
    await Promise.resolve();
  }
}

function kick(): void {
  if (sending || !sink || queue.length === 0) return;
  const payload = queue.shift();
  if (!payload) return;
  sending = true;
  const { gatewayUrl, token } = sink;
  void transport(diagnosticsUrl(gatewayUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...gatewayAuthHeaders(token),
    },
    body: JSON.stringify(payload),
  }).then(
    () => {
      sending = false;
      kick();
    },
    () => {
      sending = false;
    },
  );
}
