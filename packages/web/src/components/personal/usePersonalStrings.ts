import { useCallback } from "react";
import { useIntl } from "react-intl";
import type { WorkspaceWord } from "./workspaceMessages";
export function usePersonalStrings() {
  const { formatMessage } = useIntl();
  return useCallback(
    (key: WorkspaceWord, values?: Record<string, string | number>) =>
      formatMessage({ id: `personal.workspace.${key}` }, values),
    [formatMessage],
  );
}
