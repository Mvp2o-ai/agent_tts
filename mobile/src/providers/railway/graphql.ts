import { emitDiagnostic } from "../../diagnostics";

export const RAILWAY_GRAPHQL_ENDPOINT =
  "https://backboard.railway.com/graphql/v2";

export type RailwayGraphqlRequest = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

interface GraphqlErrorBody {
  message?: unknown;
  extensions?: {
    code?: unknown;
    traceId?: unknown;
  };
}

export class RailwayApiError extends Error {
  readonly code?: string;
  readonly traceId?: string;
  readonly retryAfterSeconds?: number;
  readonly status?: number;
  readonly operation?: string;
  readonly resources?: Record<string, string>;

  constructor(
    message: string,
    details: {
      code?: string;
      traceId?: string;
      retryAfterSeconds?: number;
      status?: number;
      operation?: string;
      resources?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = "RailwayApiError";
    this.code = details.code;
    this.traceId = details.traceId;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.status = details.status;
    this.operation = details.operation;
    this.resources = details.resources;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : "";
}

/** The OAuth session itself is missing, expired, or rejected. Relogin can fix this. */
export function isRailwaySessionExpired(error: unknown): boolean {
  if (
    error instanceof RailwayApiError &&
    (error.status === 401 ||
      error.code === "UNAUTHENTICATED" ||
      error.code === "TOKEN_EXPIRED")
  ) {
    return true;
  }
  const message = errorText(error);
  return (
    message.includes("authorization expired") ||
    message.includes("authorization failed") ||
    message.includes("authorization is missing") ||
    message.includes("railway credential is unavailable")
  );
}

/**
 * Railway accepted the token but refused the resource. Relogin does not fix
 * this unless the consent grant omitted the workspace or project.
 */
export function isRailwayResourceDenied(error: unknown): boolean {
  if (!(error instanceof RailwayApiError)) {
    return errorText(error).includes("not authorized");
  }
  if (isRailwaySessionExpired(error)) return false;
  return (
    error.message.toLowerCase().includes("not authorized") ||
    error.code === "UNAUTHORIZED" ||
    error.code === "FORBIDDEN"
  );
}

export function isRailwayAuthorizationFailure(error: unknown): boolean {
  return isRailwaySessionExpired(error) || isRailwayResourceDenied(error);
}

export const RAILWAY_ADMIN_GRANT_MESSAGE =
  "Railway blocked this action for a member OAuth grant. Connect Railway again, grant workspace admin on the consent screen, then retry.";

export function railwayErrorDiagnostic(
  action: string,
  error: unknown,
  extra: Record<string, string | undefined> = {},
): string {
  const parts = [`action=${action}`];
  if (error instanceof RailwayApiError) {
    if (error.operation) parts.push(`op=${error.operation}`);
    if (error.status !== undefined) parts.push(`status=${error.status}`);
    if (error.code) parts.push(`code=${error.code}`);
    if (error.traceId) parts.push(`trace=${error.traceId}`);
    parts.push(`message=${error.message}`);
    if (error.resources) {
      for (const [key, value] of Object.entries(error.resources)) {
        parts.push(`${key}=${value}`);
      }
    }
  } else {
    parts.push(
      `message=${error instanceof Error ? error.message : "Railway request failed"}`,
    );
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value) parts.push(`${key}=${value}`);
  }
  return parts.join(" ");
}

export function logRailway(
  event: string,
  details?: Record<string, string | number | boolean | undefined>,
): void {
  const extras = details
    ? Object.entries(details)
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
    : "";
  console.log(extras ? `[railway] ${event} ${extras}` : `[railway] ${event}`);
  if (
    event === "error" ||
    event === "invalid-response" ||
    event === "action-failed"
  ) {
    emitDiagnostic("railway", event, details);
  }
}

export async function railwayGraphql<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  request: RailwayGraphqlRequest = fetch,
): Promise<T> {
  const operation = graphqlOperationName(query);
  const resources = publicGraphqlResources(variables);
  if (!accessToken.trim()) {
    throw new RailwayApiError("Railway authorization is missing", {
      operation,
      resources,
    });
  }

  logRailway("request", { op: operation, ...resources });
  const response = await request(RAILWAY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken.trim()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const retryAfter = parseRetryAfter(response.headers.get("retry-after"));

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    logRailway("invalid-response", { op: operation, status: response.status });
    throw new RailwayApiError(
      response.ok
        ? "Railway returned an invalid response"
        : `Railway request failed: ${response.status}`,
      {
        retryAfterSeconds: retryAfter,
        status: response.status,
        operation,
        resources,
      },
    );
  }

  const envelope =
    body && typeof body === "object"
      ? (body as {
          data?: T;
          errors?: GraphqlErrorBody[];
        })
      : {};
  const firstError = Array.isArray(envelope.errors)
    ? envelope.errors[0]
    : undefined;
  if (!response.ok || firstError || envelope.data === undefined) {
    const message =
      typeof firstError?.message === "string"
        ? firstError.message
        : `Railway request failed: ${response.status}`;
    const code =
      typeof firstError?.extensions?.code === "string"
        ? firstError.extensions.code
        : undefined;
    const traceId =
      typeof firstError?.extensions?.traceId === "string"
        ? firstError.extensions.traceId
        : undefined;
    logRailway("error", {
      op: operation,
      status: response.status,
      code,
      trace: traceId,
      message,
      ...resources,
    });
    throw new RailwayApiError(message, {
      ...(code ? { code } : {}),
      ...(traceId ? { traceId } : {}),
      ...(retryAfter !== undefined
        ? { retryAfterSeconds: retryAfter }
        : {}),
      status: response.status,
      operation,
      resources,
    });
  }

  logRailway("ok", { op: operation, status: response.status });
  return envelope.data;
}

function graphqlOperationName(query: string): string {
  const match = query.match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/);
  return match?.[1] ?? "unknown";
}

function publicGraphqlResources(
  variables: Record<string, unknown>,
): Record<string, string> {
  const resources: Record<string, string> = {};
  const visit = (value: unknown, key?: string) => {
    if (typeof value === "string" && key && /id$/i.test(key) && value) {
      resources[key] = value;
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [childKey, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      visit(child, childKey);
    }
  };
  visit(variables);
  return resources;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
