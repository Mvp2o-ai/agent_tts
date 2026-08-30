declare const process: {
  env: {
    EXPO_PUBLIC_RAILWAY_CLIENT_ID?: string;
  };
};

export const DEFAULT_RAILWAY_OAUTH_CLIENT_ID =
  "rlwy_oaci_Gal6G63ulyy2oUiICqMqRBi3";

export const RAILWAY_OAUTH_CLIENT_ID =
  process.env.EXPO_PUBLIC_RAILWAY_CLIENT_ID?.trim() ||
  DEFAULT_RAILWAY_OAUTH_CLIENT_ID;

export const RAILWAY_OAUTH_ENDPOINTS = {
  authorization: "https://backboard.railway.com/oauth/auth",
  token: "https://backboard.railway.com/oauth/token",
} as const;

export const RAILWAY_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "workspace:member",
] as const;

export interface RailwayOAuthCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
}

export type RailwayOAuthRequest = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export function railwayAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}): string {
  requireValue(input.clientId, "Railway OAuth client ID");
  requireValue(input.redirectUri, "Railway OAuth redirect URI");
  requireValue(input.state, "Railway OAuth state");
  requireValue(input.codeChallenge, "Railway OAuth PKCE challenge");

  const query = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId.trim(),
    redirect_uri: input.redirectUri,
    scope: (input.scopes ?? RAILWAY_OAUTH_SCOPES).join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    prompt: "consent",
  });
  return `${RAILWAY_OAUTH_ENDPOINTS.authorization}?${query.toString()}`;
}

export async function exchangeRailwayAuthorizationCode(
  input: {
    clientId: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
  },
  request: RailwayOAuthRequest = fetch,
  now: () => number = Date.now,
): Promise<RailwayOAuthCredential> {
  requireValue(input.clientId, "Railway OAuth client ID");
  requireValue(input.redirectUri, "Railway OAuth redirect URI");
  requireValue(input.code, "Railway authorization code");
  requireValue(input.codeVerifier, "Railway OAuth PKCE verifier");

  return requestRailwayToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.clientId.trim(),
      redirect_uri: input.redirectUri,
      code: input.code,
      code_verifier: input.codeVerifier,
    }),
    request,
    now,
  );
}

export async function refreshRailwayCredential(
  clientId: string,
  credential: RailwayOAuthCredential,
  options: {
    request?: RailwayOAuthRequest;
    now?: () => number;
    refreshBeforeMs?: number;
  } = {},
): Promise<RailwayOAuthCredential> {
  const now = options.now ?? Date.now;
  const refreshBeforeMs = options.refreshBeforeMs ?? 10 * 60 * 1_000;
  if (credential.expiresAt - now() > refreshBeforeMs) return credential;
  if (!credential.refreshToken) {
    throw new Error("Railway authorization expired; connect Railway again");
  }
  requireValue(clientId, "Railway OAuth client ID");

  const refreshed = await requestRailwayToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId.trim(),
      refresh_token: credential.refreshToken,
    }),
    options.request ?? fetch,
    now,
  );
  return {
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? credential.refreshToken,
  };
}

export function parseRailwayCredential(secret: string): RailwayOAuthCredential {
  try {
    const value = JSON.parse(secret) as Record<string, unknown>;
    if (
      typeof value.accessToken === "string" &&
      value.accessToken &&
      typeof value.expiresAt === "number" &&
      Number.isFinite(value.expiresAt) &&
      typeof value.scope === "string" &&
      typeof value.tokenType === "string"
    ) {
      return {
        accessToken: value.accessToken,
        expiresAt: value.expiresAt,
        scope: value.scope,
        tokenType: value.tokenType,
        ...(typeof value.refreshToken === "string" && value.refreshToken
          ? { refreshToken: value.refreshToken }
          : {}),
      };
    }
  } catch {
    // Fall through to the credential error.
  }
  throw new Error("Railway credential is invalid");
}

export function serializeRailwayCredential(
  credential: RailwayOAuthCredential,
): string {
  return JSON.stringify(credential);
}

async function requestRailwayToken(
  body: URLSearchParams,
  request: RailwayOAuthRequest,
  now: () => number,
): Promise<RailwayOAuthCredential> {
  const response = await request(RAILWAY_OAUTH_ENDPOINTS.token, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== "string") {
    throw new Error(railwayOAuthError(data));
  }
  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: data.access_token,
    expiresAt: now() + Math.max(0, expiresIn) * 1_000,
    scope: typeof data.scope === "string" ? data.scope : "",
    tokenType: typeof data.token_type === "string" ? data.token_type : "Bearer",
    ...(typeof data.refresh_token === "string" && data.refresh_token
      ? { refreshToken: data.refresh_token }
      : {}),
  };
}

function railwayOAuthError(data: Record<string, unknown>): string {
  const description =
    typeof data.error_description === "string"
      ? data.error_description
      : typeof data.error === "string"
        ? data.error
        : "";
  return description
    ? `Railway authorization failed: ${description}`
    : "Railway authorization failed";
}

function requireValue(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is not configured`);
}
