import {
  configUrl,
  connectionError,
  killSessionUrl,
  modelCatalogUrl,
  resetSessionUrl,
  type Connection,
  voiceUrl,
} from "./protocol";
import type { AttachedRepository, HarnessId } from "./settings";
import { HARNESSES } from "./settings";

export type { Connection, HarnessId };
export { connectionError, HARNESSES, voiceUrl };

export interface UserConfig {
  userId: string;
  repo: {
    url: string;
    credential: string;
    defaultBranch?: string;
    repositories: AttachedRepository[];
  };
  harness: HarnessId;
  model?: string;
  effort?: string;
  modelKeys: Record<string, string>;
  voice: { stopWord: string; ttsVoiceId?: string };
}

export interface CatalogModel {
  id: string;
  label: string;
  efforts: string[];
  default?: boolean;
}

export interface ModelCatalog {
  harness: string;
  models: CatalogModel[];
}

function headers(conn: Connection): Record<string, string> {
  return {
    authorization: `Bearer ${conn.token}`,
    "content-type": "application/json",
  };
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
    ) {
      return `${fallback}: ${(body as { error: string }).error}`;
    }
  } catch {
    // ignore non-JSON error bodies
  }
  return `${fallback}: ${res.status}`;
}

async function gatewayFetch(
  conn: Connection,
  init: RequestInit,
): Promise<Response> {
  const err = connectionError(conn);
  if (err) throw new Error(err);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    return await fetch(configUrl(conn), {
      ...init,
      headers: { ...headers(conn), ...(init.headers ?? {}) },
      signal: ac.signal,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new Error("config request timed out");
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchConfig(conn: Connection): Promise<UserConfig> {
  const res = await gatewayFetch(conn, { method: "GET" });
  if (!res.ok) throw new Error(await readError(res, "config fetch failed"));
  return (await res.json()) as UserConfig;
}

export async function saveConfig(
  conn: Connection,
  patch: Partial<UserConfig>,
): Promise<UserConfig> {
  const res = await gatewayFetch(conn, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readError(res, "config save failed"));
  return (await res.json()) as UserConfig;
}

export async function fetchModelCatalog(
  baseUrl: string,
  token: string,
  harness: string,
): Promise<ModelCatalog> {
  if (!token.trim()) throw new Error("Set a gateway token.");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(modelCatalogUrl(baseUrl, harness), {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(await readError(res, "model catalog fetch failed"));
    const catalog = parseModelCatalog(await res.json());
    if (!catalog) throw new Error("model catalog is invalid");
    return catalog;
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new Error("model catalog request timed out");
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

function parseModelCatalog(body: unknown): ModelCatalog | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (typeof o.harness !== "string" || !Array.isArray(o.models)) return null;
  const models: CatalogModel[] = [];
  for (const entry of o.models) {
    if (!entry || typeof entry !== "object") continue;
    const m = entry as Record<string, unknown>;
    if (typeof m.id !== "string" || typeof m.label !== "string") continue;
    const efforts = Array.isArray(m.efforts)
      ? m.efforts.filter((value): value is string => typeof value === "string")
      : [];
    models.push({
      id: m.id,
      label: m.label,
      efforts,
      ...(m.default === true ? { default: true } : {}),
    });
  }
  return { harness: o.harness, models };
}

/**
 * Ask the agent container to replace itself: sessions close, the gateway
 * exits, and the operator's platform recreates the container from the image.
 * Expect the connection to drop and the agent to be back in ~10–30s.
 */
export async function resetSession(
  conn: Connection,
): Promise<{ ok: boolean; restarting: boolean }> {
  const err = connectionError(conn);
  if (err) throw new Error(err);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(resetSessionUrl(conn), {
      method: "POST",
      headers: headers(conn),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(await readError(res, "reset failed"));
    return (await res.json()) as { ok: boolean; restarting: boolean };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new Error("reset timed out");
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

export async function killSession(
  conn: Connection,
): Promise<{ ok: boolean; killed: number }> {
  const err = connectionError(conn);
  if (err) throw new Error(err);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(killSessionUrl(conn), {
      method: "POST",
      headers: headers(conn),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(await readError(res, "kill session failed"));
    return (await res.json()) as { ok: boolean; killed: number };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new Error("kill session timed out");
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}
