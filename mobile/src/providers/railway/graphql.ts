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

  constructor(
    message: string,
    details: {
      code?: string;
      traceId?: string;
      retryAfterSeconds?: number;
      status?: number;
    } = {},
  ) {
    super(message);
    this.name = "RailwayApiError";
    this.code = details.code;
    this.traceId = details.traceId;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.status = details.status;
  }
}

export function isRailwayAuthorizationFailure(error: unknown): boolean {
  if (
    error instanceof RailwayApiError &&
    (error.status === 401 ||
      error.code === "UNAUTHENTICATED" ||
      error.code === "UNAUTHORIZED" ||
      error.code === "TOKEN_EXPIRED")
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("not authorized") ||
    message.includes("unauthorized") ||
    message.includes("authorization expired") ||
    message.includes("authorization failed") ||
    message.includes("authorization is missing") ||
    message.includes("railway credential is unavailable")
  );
}

export async function railwayGraphql<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  request: RailwayGraphqlRequest = fetch,
): Promise<T> {
  if (!accessToken.trim()) {
    throw new RailwayApiError("Railway authorization is missing");
  }

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
    throw new RailwayApiError(
      response.ok
        ? "Railway returned an invalid response"
        : `Railway request failed: ${response.status}`,
      { retryAfterSeconds: retryAfter, status: response.status },
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
    throw new RailwayApiError(message, {
      ...(code ? { code } : {}),
      ...(traceId ? { traceId } : {}),
      ...(retryAfter !== undefined
        ? { retryAfterSeconds: retryAfter }
        : {}),
      status: response.status,
    });
  }

  return envelope.data;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
