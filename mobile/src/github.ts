import type { AttachedRepository } from "./settings";
import { UPSTREAM_GITHUB_OAUTH_CLIENT_ID } from "./product-config";

declare const process: {
  env: {
    EXPO_PUBLIC_GITHUB_CLIENT_ID?: string;
  };
};

const GITHUB_API = "https://api.github.com";
const GITHUB_LOGIN = "https://github.com/login";
const GITHUB_OAUTH_SCOPES = "repo offline_access";
export const GITHUB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID?.trim() ||
  UPSTREAM_GITHUB_OAUTH_CLIENT_ID;

export interface GithubIdentity {
  login: string;
  name?: string;
}

export interface GithubDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export interface GithubCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
}

export type GithubRequest = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

function githubHeaders(token?: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export async function requestGithubDeviceCode(
  clientId: string,
  request: GithubRequest = fetch,
): Promise<GithubDeviceAuthorization> {
  if (!clientId.trim()) {
    throw new Error("GitHub OAuth client ID is not configured");
  }
  const body = new URLSearchParams({
    client_id: clientId.trim(),
    scope: GITHUB_OAUTH_SCOPES,
  });
  const response = await request(`${GITHUB_LOGIN}/device/code`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof data.device_code !== "string") {
    throw new Error(githubError(data, "GitHub device authorization failed"));
  }
  return {
    deviceCode: data.device_code,
    userCode: String(data.user_code ?? ""),
    verificationUri: String(
      data.verification_uri ?? "https://github.com/login/device",
    ),
    ...(typeof data.verification_uri_complete === "string"
      ? { verificationUriComplete: data.verification_uri_complete }
      : {}),
    expiresIn: Number(data.expires_in ?? 900),
    interval: Math.max(1, Number(data.interval ?? 5)),
  };
}

export async function pollGithubDeviceToken(
  clientId: string,
  authorization: GithubDeviceAuthorization,
  options: {
    request?: GithubRequest;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
    signal?: AbortSignal;
  } = {},
): Promise<GithubCredential> {
  const request = options.request ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const deadline = now() + authorization.expiresIn * 1_000;
  let interval = authorization.interval * 1_000;

  while (now() < deadline) {
    if (options.signal?.aborted) throw new Error("GitHub connection cancelled");
    await sleep(interval);
    if (options.signal?.aborted) throw new Error("GitHub connection cancelled");
    let response: Response;
    try {
      response = await request(`${GITHUB_LOGIN}/oauth/access_token`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId.trim(),
          device_code: authorization.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }).toString(),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw new Error("GitHub connection cancelled");
      throw error;
    }
    const data = (await response.json()) as Record<string, unknown>;
    if (response.ok && typeof data.access_token === "string") {
      return credentialFromTokenResponse(data, now());
    }
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") {
      interval += 5_000;
      continue;
    }
    throw new Error(githubError(data, "GitHub authentication failed"));
  }
  throw new Error("GitHub device authorization expired");
}

export function parseGithubCredential(secret: string): GithubCredential {
  try {
    const value = JSON.parse(secret) as Record<string, unknown>;
    if (typeof value.accessToken === "string" && value.accessToken) {
      return {
        accessToken: value.accessToken,
        ...(typeof value.refreshToken === "string"
          ? { refreshToken: value.refreshToken }
          : {}),
        ...(typeof value.expiresAt === "number"
          ? { expiresAt: value.expiresAt }
          : {}),
        ...(typeof value.refreshTokenExpiresAt === "number"
          ? { refreshTokenExpiresAt: value.refreshTokenExpiresAt }
          : {}),
      };
    }
  } catch {
    // Legacy GitHub tokens were stored as raw strings.
  }
  if (!secret.trim()) throw new Error("GitHub credential is empty");
  return { accessToken: secret.trim() };
}

export function serializeGithubCredential(
  credential: GithubCredential,
): string {
  return JSON.stringify(credential);
}

export async function refreshGithubCredential(
  clientId: string,
  credential: GithubCredential,
  options: {
    request?: GithubRequest;
    now?: () => number;
    refreshBeforeMs?: number;
  } = {},
): Promise<GithubCredential> {
  const now = options.now ?? Date.now;
  const refreshBeforeMs = options.refreshBeforeMs ?? 10 * 60 * 1_000;
  if (
    credential.expiresAt === undefined ||
    credential.expiresAt - now() > refreshBeforeMs
  ) {
    return credential;
  }
  if (!credential.refreshToken) {
    throw new Error("GitHub authorization expired; connect GitHub again");
  }
  if (
    credential.refreshTokenExpiresAt !== undefined &&
    credential.refreshTokenExpiresAt <= now()
  ) {
    throw new Error("GitHub authorization expired; connect GitHub again");
  }
  if (!clientId.trim()) {
    throw new Error("GitHub OAuth client ID is not configured");
  }

  const request = options.request ?? fetch;
  const response = await request(`${GITHUB_LOGIN}/oauth/access_token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId.trim(),
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken,
    }).toString(),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== "string") {
    throw new Error(githubError(data, "Could not refresh GitHub authorization"));
  }
  return credentialFromTokenResponse(data, now());
}

export async function fetchGithubIdentity(
  token: string,
  request: GithubRequest = fetch,
): Promise<GithubIdentity> {
  const response = await request(`${GITHUB_API}/user`, {
    headers: githubHeaders(token),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof data.login !== "string") {
    throw new Error(githubError(data, "Could not load GitHub account"));
  }
  return {
    login: data.login,
    ...(typeof data.name === "string" && data.name ? { name: data.name } : {}),
  };
}

export async function listGithubRepositories(
  token: string,
  request: GithubRequest = fetch,
): Promise<AttachedRepository[]> {
  const repositories: AttachedRepository[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const url = `${GITHUB_API}/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&page=${page}&sort=full_name`;
    const response = await request(url, { headers: githubHeaders(token) });
    const data = (await response.json()) as unknown;
    if (!response.ok || !Array.isArray(data)) {
      throw new Error(
        githubError(
          data as Record<string, unknown>,
          "Could not list GitHub repositories",
        ),
      );
    }
    for (const item of data) {
      const repository = mapGithubRepository(item);
      if (repository) repositories.push(repository);
    }
    if (data.length < 100) break;
  }
  return repositories;
}

function mapGithubRepository(item: unknown): AttachedRepository | null {
  if (!item || typeof item !== "object") return null;
  const repo = item as Record<string, unknown>;
  if (
    !Number.isSafeInteger(repo.id) ||
    typeof repo.full_name !== "string" ||
    typeof repo.clone_url !== "string"
  ) {
    return null;
  }
  return {
    id: Number(repo.id),
    fullName: repo.full_name,
    cloneUrl: repo.clone_url,
    ...(typeof repo.default_branch === "string"
      ? { defaultBranch: repo.default_branch }
      : {}),
    ...(typeof repo.private === "boolean" ? { private: repo.private } : {}),
  };
}

function credentialFromTokenResponse(
  data: Record<string, unknown>,
  now: number,
): GithubCredential {
  const expiresIn = Number(data.expires_in);
  const refreshExpiresIn = Number(data.refresh_token_expires_in);
  return {
    accessToken: String(data.access_token),
    ...(typeof data.refresh_token === "string"
      ? { refreshToken: data.refresh_token }
      : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0
      ? { expiresAt: now + expiresIn * 1_000 }
      : {}),
    ...(Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
      ? { refreshTokenExpiresAt: now + refreshExpiresIn * 1_000 }
      : {}),
  };
}

function githubError(data: Record<string, unknown>, fallback: string): string {
  const description =
    typeof data.error_description === "string"
      ? data.error_description
      : typeof data.message === "string"
        ? data.message
        : typeof data.error === "string"
          ? data.error
          : "";
  return description ? `${fallback}: ${description}` : fallback;
}
