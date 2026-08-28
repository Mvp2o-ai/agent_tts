import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { redact } from "./git.js";

export interface AttachedRepository {
  id: number;
  fullName: string;
  cloneUrl: string;
  defaultBranch?: string;
}

export interface ProvisioningProgress {
  stage: "preparing" | "cloning" | "starting_harness";
  repository?: string;
  index?: number;
  total: number;
}

export function parseAttachedRepositories(raw: string | undefined): AttachedRepository[] {
  if (!raw?.trim()) return [];
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) throw new Error("attached repositories must be an array");
  if (value.length > 1_000) throw new Error("at most 1000 repositories may be attached");

  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`attached repository ${index + 1} is invalid`);
    }
    const repo = item as Record<string, unknown>;
    const id = repo.id;
    const fullName = typeof repo.fullName === "string" ? repo.fullName.trim() : "";
    const cloneUrl = typeof repo.cloneUrl === "string" ? repo.cloneUrl.trim() : "";
    const defaultBranch =
      typeof repo.defaultBranch === "string" ? repo.defaultBranch.trim() : "";
    if (!Number.isSafeInteger(id) || Number(id) <= 0) {
      throw new Error(`attached repository ${index + 1} has an invalid id`);
    }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
      throw new Error(`attached repository ${index + 1} has an invalid full name`);
    }
    const [owner, name] = fullName.split("/");
    if (owner === "." || owner === ".." || name === "." || name === "..") {
      throw new Error(`attached repository ${index + 1} has an unsafe full name`);
    }
    let parsed: URL;
    try {
      parsed = new URL(cloneUrl);
    } catch {
      throw new Error(`attached repository ${fullName} has an invalid clone URL`);
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error(`attached repository ${fullName} must use a credential-free HTTPS URL`);
    }
    const clonePath = parsed.pathname.replace(/^\/|\.git\/?$/g, "");
    if (clonePath.toLowerCase() !== fullName.toLowerCase()) {
      throw new Error(`attached repository ${fullName} does not match its clone URL`);
    }
    const key = fullName.toLowerCase();
    if (seen.has(key)) throw new Error(`attached repository ${fullName} is duplicated`);
    seen.add(key);
    return {
      id: Number(id),
      fullName,
      cloneUrl,
      ...(defaultBranch ? { defaultBranch } : {}),
    };
  });
}

export function repositoryDestinations(
  repositories: AttachedRepository[],
): Map<string, string> {
  return new Map(
    repositories.map((repo) => {
      const [owner, name] = repo.fullName.split("/") as [string, string];
      return [repo.fullName, `${owner}--${name}`];
    }),
  );
}

export async function provisionRepositories(options: {
  workspace: string;
  repositories: AttachedRepository[];
  onProgress: (progress: ProvisioningProgress) => void;
  runGit?: (args: string[], cwd: string) => Promise<void>;
}): Promise<void> {
  const { workspace, repositories, onProgress } = options;
  const runGit = options.runGit ?? runGitCommand;
  await mkdir(workspace, { recursive: true });
  onProgress({ stage: "preparing", total: repositories.length });

  const destinations = repositoryDestinations(repositories);
  for (const [offset, repo] of repositories.entries()) {
    const index = offset + 1;
    onProgress({
      stage: "cloning",
      repository: repo.fullName,
      index,
      total: repositories.length,
    });
    const directory = destinations.get(repo.fullName)!;
    const destination = join(workspace, directory);
    if (!(await isGitCheckout(destination))) {
      await runGit(["clone", "--", repo.cloneUrl, directory], workspace);
    }
  }
  onProgress({ stage: "starting_harness", total: repositories.length });
}

async function isGitCheckout(path: string): Promise<boolean> {
  try {
    return (await stat(join(path, ".git"))).isDirectory();
  } catch {
    return false;
  }
}

async function runGitCommand(args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("git clone timed out after 10 minutes"));
    }, 10 * 60 * 1_000);
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 32_000) stderr += chunk.toString();
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      const target = basename(args.at(-1) ?? "repository");
      const detail = redact(stderr.trim()).split("\n").at(-1);
      finish(
        new Error(
          `git clone failed for ${target}${detail ? `: ${detail}` : ""} (${signal ?? code ?? "unknown"})`,
        ),
      );
    });
  });
}
