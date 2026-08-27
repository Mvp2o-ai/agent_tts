import {
  configUrl,
  connectionError,
  killSessionUrl,
  type Connection,
  voiceUrl,
} from "./protocol";
import type { HarnessId } from "./settings";
import { HARNESSES } from "./settings";

export type { Connection, HarnessId };
export { connectionError, HARNESSES, voiceUrl };

export interface UserConfig {
  userId: string;
  repo: { url: string; credential: string; defaultBranch?: string };
  harness: HarnessId;
  modelKeys: Record<string, string>;
  voice: { stopWord: string; ttsVoiceId?: string };
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
