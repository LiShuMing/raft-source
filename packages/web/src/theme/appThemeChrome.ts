import type { ResolvedThemeMode } from "@botiverse/raft-ui";

/**
 * Browser / OS chrome follows the application's neutral frame.
 */
export const RAFT_LIGHT_THEME_CHROME_COLOR = "#FAFAFA";
export const RAFT_DARK_THEME_CHROME_COLOR = "#121212";
/** A pushed page's header is paper, so its chrome is too. */
export const RAFT_LIGHT_PAPER_CHROME_COLOR = "#FFFFFF";
export const RAFT_DARK_PAPER_CHROME_COLOR = "#1B1B1B";

export function appThemeChromeColor(resolvedMode: ResolvedThemeMode): string {
  return resolvedMode === "dark" ? RAFT_DARK_THEME_CHROME_COLOR : RAFT_LIGHT_THEME_CHROME_COLOR;
}

export function applyAppThemeChromeColor(
  targetDocument: Document,
  resolvedMode: ResolvedThemeMode,
): void {
  const themeColor = targetDocument.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (themeColor) themeColor.content = appThemeChromeColor(resolvedMode);
}
