import { randomBytes } from "node:crypto";
import { renameSync, statSync, unlinkSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_RUNNER_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_RUNNER_LOG_MAX_FILES = 3;
export const DEFAULT_PGLITE_CHECKPOINT_INTERVAL_MS = 30 * 60 * 1000;
export const DEFAULT_PGLITE_CHECKPOINT_INITIAL_DELAY_MS = 5_000;

export interface StandaloneServiceState {
  pid: number;
  cwd: string;
  host: string;
  port: number;
  entrypoint: string;
  webDist?: string;
  htmlPreview?: string;
  startedAt: string;
}

/**
 * Rotate a single append-only log file before opening it when its size reaches
 * `maxBytes`. Keeps up to `maxFiles` historical copies (`<file>.1` .. `.N`).
 * Never throws so log rotation cannot block process startup.
 */
export function rotateLogFileIfNeeded(
  logPath: string,
  options: { maxBytes?: number; maxFiles?: number } = {},
): boolean {
  const maxBytes = options.maxBytes ?? DEFAULT_RUNNER_LOG_MAX_BYTES;
  const maxFiles = Math.max(1, Math.floor(options.maxFiles ?? DEFAULT_RUNNER_LOG_MAX_FILES));
  if (maxBytes <= 0) return false;
  try {
    const info = statSync(logPath);
    if (!info.isFile() || info.size < maxBytes) return false;
  } catch {
    return false;
  }

  try {
    for (let index = maxFiles; index >= 1; index -= 1) {
      const target = `${logPath}.${index}`;
      if (index === maxFiles) {
        try { unlinkSync(target); } catch { /* ignore ENOENT */ }
        continue;
      }
      try {
        renameSync(target, `${logPath}.${index + 1}`);
      } catch { /* ignore ENOENT */ }
    }
    renameSync(logPath, `${logPath}.1`);
    return true;
  } catch {
    return false;
  }
}

export function standaloneServiceStatePath(stateDir: string): string {
  return path.join(stateDir, "service.json");
}

/** Atomically publish the active standalone server metadata to `<stateDir>/service.json`. */
export async function writeStandaloneServiceState(
  stateDir: string,
  state: StandaloneServiceState,
): Promise<string> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const target = standaloneServiceStatePath(stateDir);
  const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return target;
}

/** Remove `<stateDir>/service.json` on shutdown only when it still belongs to `pid`. */
export async function removeStandaloneServiceStateIfOwned(
  stateDir: string,
  pid: number,
): Promise<boolean> {
  const target = standaloneServiceStatePath(stateDir);
  try {
    const parsed = JSON.parse(await readFile(target, "utf8")) as { pid?: unknown };
    if (parsed.pid !== pid) return false;
    await unlink(target);
    return true;
  } catch {
    return false;
  }
}

export function resolveStandaloneCheckpointIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.RAFT_STANDALONE_CHECKPOINT_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_PGLITE_CHECKPOINT_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_PGLITE_CHECKPOINT_INTERVAL_MS;
  return Math.floor(parsed);
}

export interface StandalonePgliteMaintenanceHandle {
  stop: () => void;
  runNow: () => Promise<boolean>;
}

/**
 * Embedded PGlite runs PostgreSQL in single-user mode without a background
 * checkpointer, so `pg_wal` segments accumulate until a `CHECKPOINT` executes.
 * Run a best-effort checkpoint shortly after startup and periodically thereafter.
 */
export function startStandalonePgliteMaintenance(options: {
  checkpoint: () => Promise<boolean>;
  initialDelayMs?: number;
  intervalMs?: number;
  log?: (message: string) => void;
}): StandalonePgliteMaintenanceHandle {
  const intervalMs = options.intervalMs ?? resolveStandaloneCheckpointIntervalMs();
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_PGLITE_CHECKPOINT_INITIAL_DELAY_MS;
  const log = options.log ?? console.warn;

  let stopped = false;
  let running = false;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let periodicTimer: ReturnType<typeof setInterval> | null = null;

  const runNow = async (): Promise<boolean> => {
    if (stopped || running) return false;
    running = true;
    try {
      return await options.checkpoint();
    } catch (error) {
      log(`[Raft standalone] PGlite checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      running = false;
    }
  };

  if (intervalMs > 0) {
    initialTimer = setTimeout(() => {
      initialTimer = null;
      void runNow();
    }, Math.max(0, initialDelayMs));
    initialTimer.unref();

    periodicTimer = setInterval(() => {
      void runNow();
    }, intervalMs);
    periodicTimer.unref();
  }

  return {
    stop() {
      stopped = true;
      if (initialTimer) {
        clearTimeout(initialTimer);
        initialTimer = null;
      }
      if (periodicTimer) {
        clearInterval(periodicTimer);
        periodicTimer = null;
      }
    },
    runNow,
  };
}
