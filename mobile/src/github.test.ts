import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listGithubRepositories,
  pollGithubDeviceToken,
  refreshGithubCredential,
  requestGithubDeviceCode,
} from "./github";

describe("GitHub device flow", () => {
  it("requests a device code without a client secret", async () => {
    let requestBody = "";
    const authorization = await requestGithubDeviceCode(
      "Ov23.public-client",
      async (_url, init) => {
        requestBody = String(init?.body ?? "");
        return Response.json({
          device_code: "device",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          verification_uri_complete:
            "https://github.com/login/device?user_code=ABCD-EFGH",
          expires_in: 900,
          interval: 5,
        });
      },
    );
    assert.match(requestBody, /client_id=Ov23.public-client/);
    assert.match(requestBody, /scope=repo\+offline_access/);
    assert.doesNotMatch(requestBody, /secret/i);
    assert.equal(authorization.userCode, "ABCD-EFGH");
    assert.match(authorization.verificationUriComplete ?? "", /ABCD-EFGH/);
  });

  it("rejects a device authorization response without a user code", async () => {
    await assert.rejects(
      requestGithubDeviceCode("Ov23.public-client", async () =>
        Response.json({
          device_code: "device",
          user_code: "   ",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        }),
      ),
      /device authorization failed/,
    );
  });

  it("polls through authorization_pending and returns the access token", async () => {
    let requests = 0;
    let now = 0;
    const token = await pollGithubDeviceToken(
      "Ov23.public-client",
      {
        deviceCode: "device",
        userCode: "CODE",
        verificationUri: "https://github.com/login/device",
        expiresIn: 60,
        interval: 1,
      },
      {
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
        request: async () => {
          requests += 1;
          return Response.json(
            requests === 1
              ? { error: "authorization_pending" }
              : { access_token: "github-token" },
          );
        },
      },
    );
    assert.deepEqual(token, { accessToken: "github-token" });
    assert.equal(requests, 2);
  });

  it("preserves refresh metadata for expiring OAuth tokens", async () => {
    let now = 0;
    const credential = await pollGithubDeviceToken(
      "Ov23.public-client",
      {
        deviceCode: "device",
        userCode: "CODE",
        verificationUri: "https://github.com/login/device",
        expiresIn: 60,
        interval: 1,
      },
      {
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
        request: async () =>
          Response.json({
            access_token: "temporary-token",
            expires_in: 28_800,
            refresh_token: "refresh",
            refresh_token_expires_in: 15_552_000,
          }),
      },
    );
    assert.deepEqual(credential, {
      accessToken: "temporary-token",
      expiresAt: 28_800_000,
      refreshToken: "refresh",
      refreshTokenExpiresAt: 15_552_000_000,
    });
  });

  it("refreshes an expiring token without a client secret", async () => {
    let requestBody = "";
    const credential = await refreshGithubCredential(
      "Ov23.public-client",
      {
        accessToken: "old",
        refreshToken: "refresh-old",
        expiresAt: 10,
      },
      {
        now: () => 20,
        request: async (_url, init) => {
          requestBody = String(init?.body ?? "");
          return Response.json({
            access_token: "new",
            expires_in: 28_800,
            refresh_token: "refresh-new",
          });
        },
      },
    );
    assert.equal(credential.accessToken, "new");
    assert.equal(credential.refreshToken, "refresh-new");
    assert.match(requestBody, /grant_type=refresh_token/);
    assert.match(requestBody, /refresh_token=refresh-old/);
    assert.doesNotMatch(requestBody, /secret/i);
  });

  it("cancels device polling without making another token request", async () => {
    const abort = new AbortController();
    abort.abort();
    let requested = false;
    await assert.rejects(
      pollGithubDeviceToken(
        "Ov23.public-client",
        {
          deviceCode: "device",
          userCode: "CODE",
          verificationUri: "https://github.com/login/device",
          expiresIn: 60,
          interval: 1,
        },
        {
          signal: abort.signal,
          request: async () => {
            requested = true;
            return Response.json({});
          },
        },
      ),
      /cancelled/,
    );
    assert.equal(requested, false);
  });

  it("polls immediately, then wakes early when the app becomes active", async () => {
    let requests = 0;
    let now = 0;
    let wake: (() => void) | undefined;
    let sleeping: Promise<void> | undefined;
    let resolveSleep: (() => void) | undefined;

    const tokenPromise = pollGithubDeviceToken(
      "Ov23.public-client",
      {
        deviceCode: "device",
        userCode: "CODE",
        verificationUri: "https://github.com/login/device",
        expiresIn: 60,
        interval: 30,
      },
      {
        now: () => now,
        sleep: async () => {
          sleeping = new Promise<void>((resolve) => {
            resolveSleep = resolve;
          });
          await sleeping;
        },
        onWake: (nextWake) => {
          wake = nextWake;
          return () => {
            if (wake === nextWake) wake = undefined;
          };
        },
        request: async () => {
          requests += 1;
          return Response.json(
            requests === 1
              ? { error: "authorization_pending" }
              : { access_token: "github-token" },
          );
        },
      },
    );

    for (let i = 0; i < 50 && (requests < 1 || !wake); i += 1) {
      await Promise.resolve();
    }
    assert.equal(requests, 1);
    assert.equal(typeof wake, "function");

    wake?.();
    const token = await tokenPromise;
    assert.deepEqual(token, { accessToken: "github-token" });
    assert.equal(requests, 2);
    // The long interval sleep must not be required for completion.
    resolveSleep?.();
  });
});

describe("GitHub repositories", () => {
  it("maps API repositories to credential-free clone metadata", async () => {
    const urls: string[] = [];
    const repositories = await listGithubRepositories("token", async (url) => {
      urls.push(url);
      return Response.json([
        {
          id: 7,
          full_name: "acme/api",
          clone_url: "https://github.com/acme/api.git",
          default_branch: "trunk",
          private: true,
        },
      ]);
    });
    assert.deepEqual(repositories, [
      {
        id: 7,
        fullName: "acme/api",
        cloneUrl: "https://github.com/acme/api.git",
        defaultBranch: "trunk",
        private: true,
      },
    ]);
    assert.equal(urls.some((url) => url.includes("/user/repos")), true);
    assert.equal(urls.some((url) => url.includes("/user/installations")), false);
  });
});
