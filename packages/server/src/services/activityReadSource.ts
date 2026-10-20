import { isStandaloneMode } from "../config/deploymentMode";
/** Read source selection: standard uses RisingWave; standalone uses canonical
 * PostgreSQL. Tests may inject a source without changing the deployment profile.
 * Selection is explicit, never an error-triggered fallback.
 */
import type { DbQueryTracer } from "../tracing/dbQueryTrace";
import type {
  ActivityUnreadTotals,
  ActivityUnreadTotalsBatchInput,
  FollowedThreadMetadataRow,
  FollowedThreadRwRow,
  FollowedThreadStatsRow,
  InboxItemsQuery,
  InboxItemsResult,
} from "./channelService";

export type FollowedThreadStatsQuery = {
  serverId: string;
  userId: string;
  threads: FollowedThreadMetadataRow[];
  traceQuery: DbQueryTracer;
};

export type FollowedThreadRowsQuery = {
  serverId: string;
  userId: string;
  traceQuery: DbQueryTracer;
};

export type ActivityReadSource = {
  /** Replaces the RisingWave Activity item read of getInboxItems. */
  inboxItems(serverId: string, userId: string, query: InboxItemsQuery): Promise<InboxItemsResult>;
  /** Replaces the RisingWave Activity totals read of getActivityUnreadTotalsBatch. */
  activityUnreadTotals(
    inputs: ActivityUnreadTotalsBatchInput[],
    userId: string,
    opts: { traceQuery: DbQueryTracer },
  ): Promise<Map<string, ActivityUnreadTotals>>;
  /** Replaces the RisingWave followed-thread stats read (no cutoff, no upper bound). */
  followedThreadStats(query: FollowedThreadStatsQuery): Promise<FollowedThreadStatsRow[]>;
  /**
   * Replaces the rw_followed_threads_v5 read of getFollowedThreads' active path:
   * every row of (server, user), all follow states.
   */
  followedThreadRows(query: FollowedThreadRowsQuery): Promise<FollowedThreadRwRow[]>;
};

const standaloneSource: ActivityReadSource = {
  async inboxItems(...args) {
    const { postgresActivityReadSource } = await import("./postgresActivityReadSource");
    return postgresActivityReadSource.inboxItems(...args);
  },
  async activityUnreadTotals(...args) {
    const { postgresActivityReadSource } = await import("./postgresActivityReadSource");
    return postgresActivityReadSource.activityUnreadTotals(...args);
  },
  async followedThreadStats(query) {
    const { postgresActivityReadSource } = await import("./postgresActivityReadSource");
    return postgresActivityReadSource.followedThreadStats(query);
  },
  async followedThreadRows(query) {
    const { postgresActivityReadSource } = await import("./postgresActivityReadSource");
    return postgresActivityReadSource.followedThreadRows(query);
  },
};

let testSource: ActivityReadSource | null = null;

/** TEST-ONLY: replace the RisingWave Activity reads with another source (null restores RisingWave). */
export function __setActivityReadSourceForTests(source: ActivityReadSource | null): void {
  testSource = source;
}

export function getActivityReadSource(): ActivityReadSource | null {
  return testSource ?? (isStandaloneMode() ? standaloneSource : null);
}

/** Compatibility name for tests that snapshot the installed source. */
export const getActivityReadSourceOverride = getActivityReadSource;
