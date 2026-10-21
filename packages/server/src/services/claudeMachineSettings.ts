import { DAEMON_CAPABILITY_CLAUDE_MACHINE_SETTINGS, type RuntimeConfig } from "@botiverse/raft-shared";

/** Older Computers would silently turn the new model policy into Sonnet. */
export function assertClaudeMachineSettingsSupported(config: RuntimeConfig, capabilities: readonly string[]): void {
  if (config.model.kind === "machine" && !capabilities.includes(DAEMON_CAPABILITY_CLAUDE_MACHINE_SETTINGS)) {
    throw new Error("The selected Computer must be online and upgraded to use Claude machine settings. Upgrade that Computer or choose Override model.");
  }
}
