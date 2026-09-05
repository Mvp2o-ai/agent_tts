#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
  await readFile(resolve(mobileRoot, "runtime-image.lock.json"), "utf8"),
);
const immutableImage =
  /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/.test(lock.image ?? "");

if (lock.status !== "ready" || !immutableImage) {
  console.error(
    "Mobile build blocked: the runtime image lock is pending or not immutable.",
  );
  console.error(
    "Publish the matching runtime and mark its digest ready before building.",
  );
  process.exit(1);
}

console.log(`Mobile runtime ready: ${lock.image}`);
