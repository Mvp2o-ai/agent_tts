import {
  AuthRequest,
  CodeChallengeMethod,
  makeRedirectUri,
  Prompt,
  ResponseType,
  type AuthDiscoveryDocument,
} from "expo-auth-session";
import {
  exchangeRailwayAuthorizationCode,
  RAILWAY_OAUTH_CLIENT_ID,
  RAILWAY_OAUTH_ENDPOINTS,
  RAILWAY_OAUTH_SCOPES,
  type RailwayOAuthCredential,
} from "./oauth";

const RAILWAY_DISCOVERY: AuthDiscoveryDocument = {
  authorizationEndpoint: RAILWAY_OAUTH_ENDPOINTS.authorization,
};

export function railwayRedirectUri(): string {
  return makeRedirectUri({
    scheme: "agenttts",
    path: "oauth/railway",
  });
}

export async function authorizeRailwayWithBrowser(
  clientId = RAILWAY_OAUTH_CLIENT_ID,
): Promise<RailwayOAuthCredential | null> {
  if (!clientId.trim()) {
    throw new Error("Railway OAuth client ID is not configured");
  }

  const redirectUri = railwayRedirectUri();
  const request = new AuthRequest({
    responseType: ResponseType.Code,
    clientId: clientId.trim(),
    redirectUri,
    scopes: [...RAILWAY_OAUTH_SCOPES],
    prompt: Prompt.Consent,
    usePKCE: true,
    codeChallengeMethod: CodeChallengeMethod.S256,
  });
  const result = await request.promptAsync(RAILWAY_DISCOVERY);
  if (
    result.type === "cancel" ||
    result.type === "dismiss" ||
    result.type === "locked"
  ) {
    return null;
  }
  if (result.type !== "success") {
    throw new Error("Railway authorization failed");
  }

  const code = result.params.code;
  if (!code || !request.codeVerifier) {
    throw new Error("Railway authorization response is incomplete");
  }
  return exchangeRailwayAuthorizationCode({
    clientId,
    redirectUri,
    code,
    codeVerifier: request.codeVerifier,
  });
}
