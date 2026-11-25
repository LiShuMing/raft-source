import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateStandaloneWebDist } from "./startup";

test("web preflight accepts a built directory and rejects missing or directory indexes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "raft-web-preflight-"));
  try {
    const env = { RAFT_STANDALONE_WEB_DIST: root };
    await assert.rejects(validateStandaloneWebDist(env), /Run pnpm standalone:build/);
    await mkdir(path.join(root, "index.html"));
    await assert.rejects(validateStandaloneWebDist(env), /missing or unreadable/);
    await rm(path.join(root, "index.html"), { recursive: true });
    await writeFile(path.join(root, "index.html"), "<!doctype html><title>test</title>");
    assert.equal(await validateStandaloneWebDist(env), root);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("incomplete installation exits before creating persistent state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "raft-startup-preflight-"));
  try {
    const state = path.join(root, "state");
    const result = spawnSync(process.execPath, ["--import", "@oxc-node/core/register", "src/standalone.ts"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, RAFT_STANDALONE_WEB_DIST: path.join(root, "missing-web"), RAFT_STANDALONE_DIR: state },
      encoding: "utf8", timeout: 15000,
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Standalone web assets are missing or unreadable/);
    await assert.rejects(access(state), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
