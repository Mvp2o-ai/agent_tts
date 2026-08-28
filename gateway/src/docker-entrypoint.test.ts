import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../docker-entrypoint.sh", import.meta.url));

function writeExec(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function runEntrypoint(bin: string, extraEnv: Record<string, string> = {}) {
  return spawnSync("sh", [script, "node", "dist/index.js"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, ...extraEnv },
  });
}

describe("docker-entrypoint", () => {
  it("chowns a root-owned data volume then execs as agent", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-tts-entrypoint-"));
    const bin = join(root, "bin");
    const data = join(root, "data");
    const workspace = join(root, "workspace");
    mkdirSync(bin);
    mkdirSync(data);
    mkdirSync(workspace);
    writeExec(
      join(bin, "id"),
      `#!/bin/sh
if [ "$1" = "-u" ] && [ "$2" = "agent" ]; then echo 1000; exit 0; fi
if [ "$1" = "-u" ]; then echo 0; exit 0; fi
exit 1
`,
    );
    writeExec(join(bin, "stat"), "#!/bin/sh\necho 0\n");
    writeExec(
      join(bin, "chown"),
      `#!/bin/sh
echo "chown $*" >> "${root}/chown.log"
`,
    );
    writeExec(
      join(bin, "gosu"),
      `#!/bin/sh
echo "gosu $*" > "${root}/gosu.log"
`,
    );

    const result = runEntrypoint(bin, {
      AGENT_TTS_DATA_DIR: data,
      WORKSPACE_DIR: workspace,
    });
    assert.equal(result.status, 0, result.stderr);
    const chownLog = readFileSync(join(root, "chown.log"), "utf8");
    assert.match(chownLog, new RegExp(`agent:agent ${data}`));
    assert.match(chownLog, new RegExp(`agent:agent ${workspace}`));
    assert.equal(
      readFileSync(join(root, "gosu.log"), "utf8").trim(),
      "gosu agent:agent node dist/index.js",
    );
  });

  it("skips chown when already running as the agent user", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-tts-entrypoint-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeExec(join(bin, "id"), "#!/bin/sh\necho 1000\n");
    writeExec(
      join(bin, "chown"),
      `#!/bin/sh
echo ran >> "${root}/chown.log"
`,
    );
    writeExec(
      join(bin, "gosu"),
      `#!/bin/sh
echo ran >> "${root}/gosu.log"
`,
    );
    writeExec(
      join(bin, "node"),
      `#!/bin/sh
echo "node $*" > "${root}/node.log"
`,
    );

    const result = runEntrypoint(bin);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, "node.log"), "utf8").trim(), "node dist/index.js");
    assert.throws(() => readFileSync(join(root, "chown.log")));
    assert.throws(() => readFileSync(join(root, "gosu.log")));
  });
});
