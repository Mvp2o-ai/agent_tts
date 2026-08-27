import { mkdtemp, writeFile, unlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { attachProcess, type BoxConnection } from "./box-client.js";
import type { UserConfig } from "./config-schema.js";

export function harnessEnv(config: UserConfig): Record<string, string> {
  const env: Record<string, string> = {
    AGENT_TTS_HARNESS: config.harness,
    AGENT_TTS_REPO_URL: config.repo.url,
    AGENT_TTS_GIT_CREDENTIAL: config.repo.credential,
    AGENT_TTS_WORKSPACE: "/workspace",
  };
  if (config.repo.defaultBranch) {
    env.AGENT_TTS_GIT_BRANCH = config.repo.defaultBranch;
  }
  for (const [k, v] of Object.entries(config.modelKeys)) {
    if (k && v) env[k] = v;
  }
  return env;
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
