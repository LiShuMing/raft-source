import { and, eq, isNull } from "drizzle-orm";
import type { ServerPlan } from "@botiverse/raft-shared";
import { isStandaloneMode } from "../config/deploymentMode";
import { getDb, type DatabaseExecutor } from "../db/index";
import { servers } from "../db/schema";

/** Standalone deployments disable Stripe billing and grant full local workspace features. */
export const STANDALONE_SERVER_PLAN: ServerPlan = "founder";

export function resolveEffectiveStandalonePlan(
  plan: ServerPlan,
  env: NodeJS.ProcessEnv = process.env,
): ServerPlan {
  return isStandaloneMode(env) && plan === "free" ? STANDALONE_SERVER_PLAN : plan;
}

/**
 * Upgrade active standalone workspaces still stored on `free` to `founder` so
 * both service checks and direct SQL read sources (unread/inbox eligibility)
 * grant unlimited message history, uploads and Pro features.
 */
export async function ensureStandaloneServerPlans(
  executor: DatabaseExecutor = getDb(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (!isStandaloneMode(env)) return 0;
  const upgraded = await executor
    .update(servers)
    .set({
      plan: STANDALONE_SERVER_PLAN,
      planDowngradedAt: null,
    })
    .where(and(eq(servers.plan, "free"), isNull(servers.deletedAt)))
    .returning({ id: servers.id });
  return upgraded.length;
}
