import * as SecureStore from "expo-secure-store";
import { createCredentialVault } from "./credential-vault";
import {
  GITHUB_CLIENT_ID,
  parseGithubCredential,
  refreshGithubCredential,
  serializeGithubCredential,
} from "./github";

export const credentialVault = createCredentialVault(SecureStore);

const githubRefreshes = new Map<string, Promise<string>>();

export async function githubAccessToken(credentialId: string): Promise<string> {
  const existing = githubRefreshes.get(credentialId);
  if (existing) return existing;

  const pending = (async () => {
    const [entries, secret] = await Promise.all([
      credentialVault.list(),
      credentialVault.getSecret(credentialId),
    ]);
    const entry = entries.find((item) => item.id === credentialId);
    if (!entry || !secret) throw new Error("GitHub credential is unavailable");
    if (entry.kind === "git-pat") return secret;
    if (entry.kind !== "github-token") {
      throw new Error("Selected credential is not a GitHub credential");
    }

    const current = parseGithubCredential(secret);
    const refreshed = await refreshGithubCredential(GITHUB_CLIENT_ID, current);
    const serialized = serializeGithubCredential(refreshed);
    if (serialized !== secret) {
      await credentialVault.save({
        id: entry.id,
        kind: entry.kind,
        label: entry.label,
        secret: serialized,
      });
    }
    return refreshed.accessToken;
  })();
  githubRefreshes.set(credentialId, pending);
  try {
    return await pending;
  } finally {
    if (githubRefreshes.get(credentialId) === pending) {
      githubRefreshes.delete(credentialId);
    }
  }
}
