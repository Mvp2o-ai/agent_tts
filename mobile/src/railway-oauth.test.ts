import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  exchangeRailwayAuthorizationCode,
  parseRailwayCredential,
  railwayAuthorizationUrl,
  refreshRailwayCredential,
  serializeRailwayCredential,
} from "./providers/railway/oauth";

describe("Railway native OAuth", () => {
  it("builds a PKCE authorization request without a client secret", () => {
    const url = new URL(
      railwayAuthorizationUrl({
        clientId: "public-client",
        redirectUri: "agenttts://oauth/railway",
        state: "state-1",
        codeChallenge: "challenge-1",
      }),
    );

    assert.equal(url.pathname, "/oauth/auth");
    assert.equal(url.searchParams.get("client_id"), "public-client");
    assert.equal(url.searchParams.get("redirect_uri"), "agenttts://oauth/railway");
    assert.equal(url.searchParams.get("code_challenge"), "challenge-1");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.match(url.searchParams.get("scope") ?? "", /workspace:member/);
    assert.equal(url.searchParams.has("client_secret"), false);
  });

  it("exchanges an authorization code using the PKCE verifier", async () => {
    const credential = await exchangeRailwayAuthorizationCode(
      {
        clientId: "public-client",
        redirectUri: "agenttts://oauth/railway",
        code: "one-time-code",
        codeVerifier: "verifier",
      },
      async (_url, init) => {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("client_id"), "public-client");
        assert.equal(body.get("code_verifier"), "verifier");
        assert.equal(body.has("client_secret"), false);
        return Response.json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          scope: "openid offline_access workspace:member",
          token_type: "Bearer",
        });
      },
      () => 1_000,
    );

    assert.equal(credential.accessToken, "access-1");
    assert.equal(credential.refreshToken, "refresh-1");
    assert.equal(credential.expiresAt, 3_601_000);
  });

  it("rotates refresh tokens and preserves one when omitted", async () => {
    const current = {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: 1,
      scope: "openid offline_access workspace:member",
      tokenType: "Bearer",
    };
    const refreshed = await refreshRailwayCredential("public-client", current, {
      now: () => 10_000,
      request: async (_url, init) => {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("grant_type"), "refresh_token");
        assert.equal(body.get("refresh_token"), "old-refresh");
        return Response.json({
          access_token: "new-access",
          expires_in: 3600,
          scope: current.scope,
          token_type: "Bearer",
        });
      },
    });

    assert.equal(refreshed.accessToken, "new-access");
    assert.equal(refreshed.refreshToken, "old-refresh");
  });

  it("round-trips credentials and rejects malformed secure-store data", () => {
    const credential = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 1234,
      scope: "workspace:member",
      tokenType: "Bearer",
    };
    assert.deepEqual(
      parseRailwayCredential(serializeRailwayCredential(credential)),
      credential,
    );
    assert.throws(() => parseRailwayCredential('{"accessToken":"x"}'));
  });
});
