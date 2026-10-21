import { useIntl } from "react-intl";

export interface ExecutionComputer {
  id: string;
  name: string;
  status: string;
}

/** Describe the execution target without reading the admin host's settings. */
export function ClaudeConfigurationSummary({ computer, mode }: {
  computer: ExecutionComputer;
  mode: string;
}) {
  const { formatMessage } = useIntl();
  return (
    <div className="rounded-lg border border-line-hairline p-3 text-caption text-foreground-muted" data-testid="claude-configuration-summary">
      <p className="font-medium text-foreground">
        {formatMessage({ id: "agent.claudeSettings.target" }, { name: computer.name })}
        {` · ${formatMessage({ id: computer.status === "online" ? "agent.claudeSettings.online" : "agent.claudeSettings.offline" })}`}
      </p>
      <p className="mt-1">{formatMessage({ id: mode === "machine" ? "agent.claudeSettings.machineHint" : mode === "custom" ? "agent.claudeSettings.customHint" : "agent.claudeSettings.overrideHint" })}</p>
    </div>
  );
}
