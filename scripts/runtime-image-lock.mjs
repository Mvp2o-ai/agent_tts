#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = resolve(ROOT, "mobile/runtime-image.lock.json");
const RUNTIME_INPUTS = [
  ".dockerignore",
  "package.json",
  "package-lock.json",
  "gateway",
  "agentbox/adapter",
];
const IGNORED_DIRECTORIES = new Set(["dist", "node_modules"]);
const IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
const execFile = promisify(execFileCallback);

async function runtimeFiles() {
  const files = [];
  for (const input of RUNTIME_INPUTS) {
    await collect(resolve(ROOT, input), files);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function collect(path, files) {
  const entries = await readdir(path, { withFileTypes: true }).catch(
    (error) => {
      if (error?.code === "ENOTDIR") {
        files.push(path);
        return null;
      }
      throw error;
    },
  );
  if (!entries) return;
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      await collect(child, files);
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
}

export async function runtimeFingerprint() {
  const hash = createHash("sha256");
  for (const path of await runtimeFiles()) {
    const name = relative(ROOT, path);
    const contents = await readFile(path);
    hash.update(name);
    hash.update("\0");
    hash.update(String(contents.length));
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function readLock() {
  const parsed = JSON.parse(await readFile(LOCK_PATH, "utf8"));
  if (parsed.status !== "ready" && parsed.status !== "pending") {
    throw new Error("runtime image lock status must be ready or pending");
  }
  if (!IMAGE_PATTERN.test(parsed.image ?? "")) {
    throw new Error("runtime image lock must contain an immutable image digest");
  }
  if (!COMMIT_PATTERN.test(parsed.sourceCommit ?? "")) {
    throw new Error("runtime image lock must contain a full source commit SHA");
  }
  if (!FINGERPRINT_PATTERN.test(parsed.runtimeFingerprint ?? "")) {
    throw new Error("runtime image lock must contain a runtime fingerprint");
  }
  return parsed;
}

async function checkReady() {
  const lock = await readLock();
  if (lock.status !== "ready") {
    throw new Error(
      "runtime image lock is pending: publish the runtime, then pin its immutable digest before building mobile",
    );
  }
  const current = await runtimeFingerprint();
  if (lock.runtimeFingerprint !== current) {
    throw new Error(
      [
        "runtime image lock is stale",
        `locked:  ${lock.runtimeFingerprint}`,
        `current: ${current}`,
        "run: node scripts/runtime-image-lock.mjs mark-pending",
      ].join("\n"),
    );
  }
  await verifySourceCommit(lock);
  await verifyImageRevision(lock);
  console.log(`runtime image lock ready: ${lock.image}`);
}

async function verifySourceCommit(lock) {
  try {
    await execFile("git", ["cat-file", "-e", `${lock.sourceCommit}^{commit}`], {
      cwd: ROOT,
    });
    await execFile(
      "git",
      ["diff", "--quiet", lock.sourceCommit, "HEAD", "--", ...RUNTIME_INPUTS],
      { cwd: ROOT },
    );
  } catch (error) {
    if (error?.code === 1) {
      throw new Error(
        "runtime source differs from the commit that produced the locked image",
      );
    }
    throw new Error(
      `cannot verify locked runtime source commit ${lock.sourceCommit}`,
    );
  }
}

async function verifyImageRevision(lock) {
  const match = /^([^/]+)\/([^@]+)@(sha256:[a-f0-9]{64})$/.exec(lock.image);
  if (!match) {
    throw new Error("runtime image lock must include an OCI registry hostname");
  }
  const [, configuredRegistry, repository, digest] = match;
  const registry =
    configuredRegistry === "docker.io"
      ? "registry-1.docker.io"
      : configuredRegistry;
  const base = `https://${registry}/v2/${repository}`;
  const headers = {
    Accept: [
      "application/vnd.oci.image.index.v1+json",
      "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
    ].join(", "),
  };
  let indexResponse = await fetch(`${base}/manifests/${digest}`, { headers });
  if (indexResponse.status === 401) {
    const challenge = indexResponse.headers.get("www-authenticate") ?? "";
    const realm = /realm="([^"]+)"/.exec(challenge)?.[1];
    const service = /service="([^"]+)"/.exec(challenge)?.[1];
    const scope =
      /scope="([^"]+)"/.exec(challenge)?.[1] ??
      `repository:${repository}:pull`;
    if (!realm) {
      throw new Error("public OCI registry did not provide bearer authentication");
    }
    const tokenUrl = new URL(realm);
    if (service) tokenUrl.searchParams.set("service", service);
    tokenUrl.searchParams.set("scope", scope);
    const tokenResponse = await fetch(tokenUrl);
    if (!tokenResponse.ok) {
      throw new Error(
        `cannot authenticate public OCI pull (${tokenResponse.status})`,
      );
    }
    const tokenBody = await tokenResponse.json();
    const token = tokenBody.token ?? tokenBody.access_token;
    if (!token) throw new Error("OCI registry did not return a public pull token");
    headers.Authorization = `Bearer ${token}`;
    indexResponse = await fetch(`${base}/manifests/${digest}`, { headers });
  }
  if (!indexResponse.ok) {
    throw new Error(`locked runtime image is not publicly pullable (${indexResponse.status})`);
  }
  if (indexResponse.headers.get("docker-content-digest") !== digest) {
    throw new Error("OCI registry returned a different digest than the runtime lock");
  }
  const index = await indexResponse.json();
  const platforms = Array.isArray(index.manifests)
    ? index.manifests.filter(
        (entry) =>
          entry.platform?.os === "linux" &&
          (entry.platform?.architecture === "amd64" ||
            entry.platform?.architecture === "arm64"),
      )
    : [];
  if (platforms.length === 0) {
    throw new Error("locked runtime image has no Linux amd64/arm64 manifests");
  }
  for (const platform of platforms) {
    const manifestResponse = await fetch(
      `${base}/manifests/${platform.digest}`,
      { headers },
    );
    if (!manifestResponse.ok) {
      throw new Error(`cannot read locked ${platform.platform.architecture} manifest`);
    }
    const manifest = await manifestResponse.json();
    const configResponse = await fetch(
      `${base}/blobs/${manifest.config?.digest}`,
      { headers },
    );
    if (!configResponse.ok) {
      throw new Error(`cannot read locked ${platform.platform.architecture} config`);
    }
    const config = await configResponse.json();
    const revision =
      config.config?.Labels?.["org.opencontainers.image.revision"];
    if (revision !== lock.sourceCommit) {
      throw new Error(
        `locked ${platform.platform.architecture} image revision ${revision ?? "missing"} does not match ${lock.sourceCommit}`,
      );
    }
  }
}

async function requirePending() {
  const lock = await readLock();
  if (lock.status !== "pending") {
    throw new Error(
      "runtime inputs changed but the runtime image lock is still ready; run: node scripts/runtime-image-lock.mjs mark-pending",
    );
  }
  console.log("runtime image lock pending publication");
}

async function writeLock(next) {
  await writeFile(LOCK_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

async function markPending() {
  const lock = await readLock();
  await writeLock({ ...lock, status: "pending" });
  console.log(`marked pending: ${relative(ROOT, LOCK_PATH)}`);
}

async function markReady(image, sourceCommit) {
  if (!IMAGE_PATTERN.test(image ?? "")) {
    throw new Error("ready requires an immutable image@sha256:... reference");
  }
  if (!COMMIT_PATTERN.test(sourceCommit ?? "")) {
    throw new Error("ready requires the full 40-character source commit SHA");
  }
  const runtimeFingerprintValue = await runtimeFingerprint();
  await writeLock({
    status: "ready",
    image,
    sourceCommit,
    runtimeFingerprint: runtimeFingerprintValue,
  });
  console.log(`pinned runtime image: ${image}`);
}

const [command = "check", ...args] = process.argv.slice(2);
try {
  if (command === "fingerprint") {
    console.log(await runtimeFingerprint());
  } else if (command === "check") {
    await checkReady();
  } else if (command === "require-pending") {
    await requirePending();
  } else if (command === "mark-pending") {
    await markPending();
  } else if (command === "mark-ready") {
    await markReady(args[0], args[1]);
  } else {
    throw new Error(
      "usage: runtime-image-lock.mjs [check|fingerprint|require-pending|mark-pending|mark-ready <image@digest> <source-commit>]",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
