/** Test setup shares the canonical PostgreSQL backend with standalone mode.
 * RisingWave contract/parity tests remain responsible for independent view parity.
 */
import { __setActivityReadSourceForTests } from "../services/activityReadSource";
import { __setConversationUnreadSourceForTests } from "../services/conversationUnreadSource";
import { postgresActivityReadSource } from "../services/postgresActivityReadSource";
import { postgresConversationUnreadSource } from "../services/postgresConversationUnreadSource";

export { postgresActivityReadSource as referenceActivityReadSource } from "../services/postgresActivityReadSource";

export function installRisingWaveReadReferences(): void {
  __setActivityReadSourceForTests(postgresActivityReadSource);
  __setConversationUnreadSourceForTests(postgresConversationUnreadSource);
}

export function uninstallRisingWaveReadReferences(): void {
  __setActivityReadSourceForTests(null);
  __setConversationUnreadSourceForTests(null);
}
