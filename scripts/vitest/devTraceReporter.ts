import { fileURLToPath } from "node:url";

/** Repository root (this file is scripts/vitest/devTraceReporter.ts). */
export const DEV_TRACE_WORKTREE = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Upstream source-available snapshots omit internal scripts/devtrace/ telemetry.
 * Keep the plugin export as a no-op so Vitest configs load cleanly in local/standalone runs.
 */
export function devTracePlugin(_packageName: string, _worktree = DEV_TRACE_WORKTREE) {
  return {
    name: "raft-dev-trace",
    configureVitest() {},
  };
}
