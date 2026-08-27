import { mkdtemp, writeFile, unlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { attachProcess, type BoxConnection } from "./box-client.js";
import type { UserConfig } from "./config-schema.js";

/** Host for git extraheader / gh. Empty or SSH remotes → github.com. */
export function gitHostFromRepoUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return "github.com";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.host || "github.com";
    }
  } catch {
    /* host or scp-style */
  }
  if (/^[A-Za-z0-9.-]+$/.test(raw)) return raw;
  return "github.com";
}

export function harnessEnv(config: UserConfig): Record<string, string> {
  const env: Record<string, string> = {
    AGENT_TTS_HARNESS: config.harness,
    AGENT_TTS_GIT_CREDENTIAL: config.repo.credential,
    AGENT_TTS_GIT_HOST: gitHostFromRepoUrl(config.repo.url),
    AGENT_TTS_WORKSPACE: "/workspace",
  };
  for (const [k, v] of Object.entries(config.modelKeys)) {
    if (k && v) env[k] = v;
  }
  return env;
}

/** Docker `--filter name=` prefix for a user's session and debug boxes. */
export function dockerKillFilter(userId: string): string {
  const safe = userId.replace(/[^A-Za-z0-9._-]+/g, "-") || "default";
  return `agent-tts-${safe}-`;
}

export function dockerPsArgs(userId: string): string[] {
  return ["ps", "-aq", "--filter", `name=${dockerKillFilter(userId)}`];
}

export function dockerRmArgs(ids: string[]): string[] {
  return ["rm", "-f", ...ids];
}

export async function killSessionBoxes(
  dockerBin: string,
  userId: string,
): Promise<string[]> {
  const listed = await runDocker(dockerBin, dockerPsArgs(userId));
  const ids = listed.split(/\s+/).filter(Boolean);
  if (ids.length === 0) return [];
  await runDocker(dockerBin, dockerRmArgs(ids));
  return ids;
}

function runDocker(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString();
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `${bin} ${args[0]} exited ${code}`));
    });
  });
}

export function dockerRunArgs(opts: {
  image: string;
  name: string;
  envFile: string;
}): string[] {
  return [
    "run",
    "--rm",
    "-i",
    "--name",
    opts.name,
    "--env-file",
    opts.envFile,
    opts.image,
  ];
}

export async function writeEnvFile(env: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agent-tts-"));
  const file = join(dir, "env");
  const body = Object.entries(env)
    .map(([k, v]) => `${k}=${v.replace(/\n/g, " ")}`)
    .join("\n");
  await writeFile(file, body, { encoding: "utf8", mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

export async function spawnDockerBox(opts: {
  dockerBin: string;
  image: string;
  name: string;
  config: UserConfig;
}): Promise<{ box: BoxConnection; envFile: string }> {
  const envFile = await writeEnvFile(harnessEnv(opts.config));
  const args = dockerRunArgs({
    image: opts.image,
    name: opts.name,
    envFile,
  });
  const child = spawn(opts.dockerBin, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const box = attachProcess(child);
  const originalClose = box.close.bind(box);
  box.close = async () => {
    await originalClose();
    await unlink(envFile).catch(() => undefined);
  };
  return { box, envFile };
}
