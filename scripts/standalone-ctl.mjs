#!/usr/bin/env node
/**
 * Standalone lifecycle & maintenance helper for Raft.
 *
 * Subcommands:
 *   status              Inspect service.json, /health, /api/privacy-policy, and storage breakdown.
 *   prune [--apply]     Dry-run by default. Safely removes expired cli-transport dirs (>7d) and
 *                       rotated log backups while never deleting postgres, uploads, keys, or backups.
 *   restart             Gracefully stops the running standalone server, rotates the server log if
 *                       oversized, starts a detached instance via setsid, and verifies /health.
 *
 * Environment:
 *   RAFT_STANDALONE_DIR          State directory (default: ~/.raft-standalone)
 *   RAFT_STANDALONE_HOST         Bind host (default: 127.0.0.1)
 *   RAFT_STANDALONE_PORT         Port (default: 5280)
 *   RAFT_STANDALONE_WEB_DIST     Web dist path (default: <repo>/packages/web/dist)
 *   RAFT_STANDALONE_HTML_PREVIEW offline-static | local-interactive (default: offline-static)
 *   RAFT_STANDALONE_LOG_FILE     Server log file (default: /tmp/raft-standalone.log)
 *   RAFT_NODE_BIN                Node binary (default: /tmp/raft-node24/bin/node if present else process.execPath)
 */
import { spawn } from "node:child_process";
import { existsSync, openSync, closeSync, renameSync, statSync, unlinkSync } from "node:fs";
import { lstat, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(REPO_ROOT, "packages", "server");
const DEFAULT_WEB_DIST = path.join(REPO_ROOT, "packages", "web", "dist");

const stateDir = path.resolve(process.env.RAFT_STANDALONE_DIR?.trim() || path.join(os.homedir(), ".raft-standalone"));
const port = Number(process.env.RAFT_STANDALONE_PORT?.trim() || "5280");
const host = process.env.RAFT_STANDALONE_HOST?.trim() || "127.0.0.1";
const webDist = path.resolve(process.env.RAFT_STANDALONE_WEB_DIST?.trim() || DEFAULT_WEB_DIST);
const htmlPreview = process.env.RAFT_STANDALONE_HTML_PREVIEW?.trim() || "offline-static";
const logFile = process.env.RAFT_STANDALONE_LOG_FILE?.trim() || "/tmp/raft-standalone.log";
const nodeBin = process.env.RAFT_NODE_BIN?.trim()
  || (existsSync("/tmp/raft-node24/bin/node") ? "/tmp/raft-node24/bin/node" : process.execPath);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let index = -1;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

async function dirSizeBytes(target, maxDepth = 8) {
  if (maxDepth < 0) return 0;
  let info;
  try {
    info = await lstat(target);
  } catch {
    return 0;
  }
  if (info.isSymbolicLink()) return 0;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  let total = 0;
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile()) {
      try { total += (await lstat(child)).size; } catch { /* ignore */ }
    } else if (entry.isDirectory()) {
      total += await dirSizeBytes(child, maxDepth - 1);
    }
  }
  return total;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readServiceState() {
  try {
    return JSON.parse(await readFile(path.join(stateDir, "service.json"), "utf8"));
  } catch {
    return null;
  }
}

async function fetchJson(url, timeoutMs = 3_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, body: await res.json() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function rotateLogIfNeeded(filePath, maxBytes = 20 * 1024 * 1024, maxFiles = 3) {
  try {
    const info = statSync(filePath);
    if (!info.isFile() || info.size < maxBytes) return false;
    for (let i = maxFiles; i >= 1; i -= 1) {
      const target = `${filePath}.${i}`;
      if (i === maxFiles) {
        try { unlinkSync(target); } catch { /* ignore */ }
        continue;
      }
      try { renameSync(target, `${filePath}.${i + 1}`); } catch { /* ignore */ }
    }
    renameSync(filePath, `${filePath}.1`);
    return true;
  } catch {
    return false;
  }
}

async function cmdStatus() {
  const state = await readServiceState();
  const pidAlive = state?.pid ? isPidAlive(state.pid) : false;
  const origin = `http://127.0.0.1:${port}`;
  const health = await fetchJson(`${origin}/health`);
  const policy = await fetchJson(`${origin}/api/privacy-policy`);

  const buckets = [
    ["postgres/base", path.join(stateDir, "postgres", "base")],
    ["postgres/pg_wal", path.join(stateDir, "postgres", "pg_wal")],
    ["uploads", path.join(stateDir, "uploads")],
    ["computers", path.join(stateDir, "computers")],
    ["packages", path.join(stateDir, "packages")],
    ["deployments", path.join(stateDir, "deployments")],
    ["backups", path.join(stateDir, "backups")],
    ["validation", path.join(stateDir, "validation")],
  ];

  console.log(`State directory : ${stateDir}`);
  console.log(`Service state   : ${state ? `pid=${state.pid} (${pidAlive ? "alive" : "stale"}) port=${state.port} host=${state.host ?? "?"} htmlPreview=${state.htmlPreview ?? "?"}` : "none"}`);
  console.log(`Health (${origin}/health) : ${health.ok ? JSON.stringify(health.body) : `unreachable (${health.error ?? health.status})`}`);
  if (policy.ok) {
    console.log(`Privacy policy  : mode=${policy.body.deploymentMode} htmlPreview=${policy.body.htmlPreview}`);
  }
  console.log("\nStorage breakdown:");
  let total = 0;
  for (const [label, target] of buckets) {
    const bytes = await dirSizeBytes(target);
    total += bytes;
    if (bytes > 0) {
      console.log(`  ${label.padEnd(18)} ${formatBytes(bytes)}`);
    }
  }
  console.log(`  ${"TOTAL (tracked)".padEnd(18)} ${formatBytes(total)}`);
}

async function cmdPrune(apply) {
  const staleAgeMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const candidates = [];

  // 1. Old service.log.bak-* files
  try {
    for (const entry of await readdir(stateDir, { withFileTypes: true })) {
      if (entry.isFile() && /^service\.log\.bak-/.test(entry.name)) {
        const full = path.join(stateDir, entry.name);
        const info = await lstat(full);
        candidates.push({ path: full, bytes: info.size, kind: "log_backup" });
      }
    }
  } catch { /* ignore */ }

  // 2. Stale cli-transport launch directories older than 7 days
  const computersDir = path.join(stateDir, "computers");
  try {
    for (const comp of await readdir(computersDir, { withFileTypes: true })) {
      if (!comp.isDirectory()) continue;
      const compPath = path.join(computersDir, comp.name);
      const cliTransportDir = path.join(compPath, "cli-transport");
      try {
        for (const agentDir of await readdir(cliTransportDir, { withFileTypes: true })) {
          if (!agentDir.isDirectory()) continue;
          const agentPath = path.join(cliTransportDir, agentDir.name);
          for (const launchDir of await readdir(agentPath, { withFileTypes: true })) {
            if (!launchDir.isDirectory()) continue;
            const launchPath = path.join(agentPath, launchDir.name);
            const info = await lstat(launchPath);
            if (now - info.mtimeMs > staleAgeMs) {
              const bytes = await dirSizeBytes(launchPath, 4);
              candidates.push({ path: launchPath, bytes, kind: "stale_cli_transport" });
            }
          }
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  let reclaimable = 0;
  for (const item of candidates) reclaimable += item.bytes;

  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN (pass --apply to delete)"}`);
  console.log(`Ephemeral candidates: ${candidates.length} (${formatBytes(reclaimable)})`);
  for (const item of candidates.slice(0, 20)) {
    console.log(`  [${item.kind}] ${formatBytes(item.bytes).padStart(10)}  ${item.path}`);
  }
  if (candidates.length > 20) console.log(`  ... and ${candidates.length - 20} more`);

  if (apply) {
    for (const item of candidates) {
      await rm(item.path, { recursive: true, force: true });
    }
    console.log(`Removed ${candidates.length} ephemeral item(s), reclaimed ~${formatBytes(reclaimable)}.`);
  }

  // Report operator-managed directories without touching them.
  for (const name of ["backups", "validation"]) {
    const target = path.join(stateDir, name);
    const bytes = await dirSizeBytes(target);
    if (bytes > 0) {
      console.log(`Operator-managed (untouched): ${target} (${formatBytes(bytes)})`);
    }
  }
}

async function cmdRestart() {
  const state = await readServiceState();
  if (state?.pid && isPidAlive(state.pid)) {
    console.log(`Stopping standalone server PID ${state.pid}...`);
    process.kill(state.pid, "SIGTERM");
    for (let i = 0; i < 30; i += 1) {
      if (!isPidAlive(state.pid)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (isPidAlive(state.pid)) {
      throw new Error(`PID ${state.pid} did not exit within 30s`);
    }
  }

  if (rotateLogIfNeeded(logFile)) {
    console.log(`Rotated oversized server log: ${logFile}`);
  }

  const outFd = openSync(logFile, "a", 0o600);
  try {
    const child = spawn("setsid", [
      nodeBin,
      "--import",
      "@oxc-node/core/register",
      "src/standalone.ts",
    ], {
      cwd: SERVER_DIR,
      detached: true,
      stdio: ["ignore", outFd, outFd],
      env: {
        ...process.env,
        NODE_ENV: "production",
        RAFT_STANDALONE_DIR: stateDir,
        RAFT_STANDALONE_HOST: host,
        RAFT_STANDALONE_PORT: String(port),
        RAFT_STANDALONE_WEB_DIST: webDist,
        RAFT_STANDALONE_HTML_PREVIEW: htmlPreview,
        PATH: `${path.dirname(nodeBin)}:${process.env.PATH ?? ""}`,
      },
    });
    child.unref();
    console.log(`Launched standalone server (setsid pid=${child.pid}) -> ${logFile}`);
  } finally {
    closeSync(outFd);
  }

  const origin = `http://127.0.0.1:${port}`;
  for (let i = 1; i <= 30; i += 1) {
    const health = await fetchJson(`${origin}/health`, 1_500);
    if (health.ok) {
      console.log(`Healthy after ${i}s: ${JSON.stringify(health.body)}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Standalone server did not become healthy at ${origin}/health within 30s`);
}

const [cmd = "status", ...rest] = process.argv.slice(2);
switch (cmd) {
  case "status":
    await cmdStatus();
    break;
  case "prune":
    await cmdPrune(rest.includes("--apply"));
    break;
  case "restart":
    await cmdRestart();
    break;
  default:
    console.error(`Usage: standalone-ctl.mjs <status|prune [--apply]|restart>`);
    process.exit(2);
}
