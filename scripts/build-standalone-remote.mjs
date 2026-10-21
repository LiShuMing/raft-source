// Package only the built daemon and its installed production dependency graph.
// No registry resolution, install scripts, credentials or workspace state.
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
// Allow packaging a validated build without replacing a running local daemon.
const daemonDist = path.resolve(process.env.RAFT_REMOTE_DAEMON_DIST || path.join(root, "packages/daemon/dist"));
const output = path.join(root, ".raft-standalone", "packages");
await mkdir(output, { recursive: true, mode: 0o700 });
const staging = await mkdtemp(path.join(output, ".build-"));
const archiveName = `raft-runner-${process.platform}-${process.arch}.tar.gz`;
const archive = path.join(output, archiveName);
const seen = new Map();
const manifest = [];

async function vendor(directory, daemon = false) {
  const source = await realpath(directory);
  if (seen.has(source)) return seen.get(source);
  const pkg = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
  const target = path.join(staging, "raft-runner", "vendor", String(seen.size));
  seen.set(source, target);
  const require = createRequire(path.join(source, "package.json"));
  await mkdir(target, { recursive: true });
  if (daemon) {
    await cp(daemonDist, path.join(target, "dist"), { recursive: true });
    await cp(path.join(source, "package.json"), path.join(target, "package.json"));
  } else {
    await cp(source, target, { recursive: true, dereference: false,
      filter: (name) => !["node_modules", ".git", ".env"].includes(path.basename(name)) });
  }
  manifest.push({ name: pkg.name, version: pkg.version });
  const optional = pkg.optionalDependencies || {};
  const peers = pkg.peerDependencies || {};
  for (const name of new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(optional), ...Object.keys(peers)])) {
    const resolved = (require.resolve.paths(name) || [])
      .map((search) => path.join(search, name)).find((candidate) => existsSync(path.join(candidate, "package.json")));
    if (!resolved) {
      if (name in optional || name in peers || isBuiltin(name)) continue;
      throw new Error(`Installed production dependency missing: ${pkg.name} -> ${name}`);
    }
    const destination = await vendor(resolved);
    const link = path.join(target, "node_modules", name);
    await mkdir(path.dirname(link), { recursive: true });
    await symlink(path.relative(path.dirname(link), destination), link);
  }
  return target;
}

try {
  const daemon = await vendor(path.join(root, "packages/daemon"), true);
  const runnerRoot = path.join(staging, "raft-runner");
  const entry = path.relative(runnerRoot, path.join(daemon, "dist/standaloneRemote.js"));
  if (!existsSync(path.join(runnerRoot, entry))) throw new Error("Build the daemon before packaging the remote runner.");
  await writeFile(path.join(runnerRoot, "connect"), `#!/bin/sh\nset -eu\nTASK_NODE_BIN="\${RAFT_NODE_BIN:-node}"\nTASK_RUNNER_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$TASK_NODE_BIN" "$TASK_RUNNER_DIR/${entry}" "$@"\n`, { mode: 0o755 });
  await cp(path.join(root, "LICENSE"), path.join(runnerRoot, "LICENSE"));
  await writeFile(path.join(runnerRoot, "README.txt"), "Raft private runner. Requires Node 24+ and the same OS/architecture as this package.\n./connect setup --server-url http://127.0.0.1:15280 --server WORKSPACE --name UNIQUE_MACHINE_NAME\nApprove the device code at your center's /login/device page. Keep the process running.\n./connect start with the same flags resumes the stored attachment; no new credential is minted.\nEach machine needs its own private RAFT_HOME. Do not copy attachment or session state between hosts.\nNative Claude/Codex configuration stays on the execution machine. This is not an OS sandbox.\nNo Node installer, registry install, cloud updater or vendor download runs during setup.\n");
  await writeFile(path.join(runnerRoot, "dependencies.json"), JSON.stringify(manifest, null, 2));
  const tar = spawnSync("tar", ["-czf", `${archive}.tmp`, "-C", staging, "raft-runner"], { stdio: "inherit" });
  if (tar.status !== 0) throw new Error("Cannot create the runner archive.");
  const { rename } = await import("node:fs/promises");
  await rename(`${archive}.tmp`, archive);
  const bytes = await readFile(archive);
  const metadata = { filename: archiveName, platform: process.platform, arch: process.arch, nodeMajor: 24,
    sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, dependencies: manifest.length };
  await writeFile(path.join(output, "remote-runner.json"), JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify(metadata));
} finally { await rm(staging, { recursive: true, force: true }); }
