import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCallback } from "react";
import type { ChangeEvent } from "react";
import { useIntl } from "react-intl";
import {
  Bookmark,
  CheckSquare,
  ChevronDown,
  MessageSquare,
  Settings2,
  SquarePen,
} from "lucide-react";
import { useServerStore } from "../../store/serverStore";
import { useChannelStore } from "../../store/channelStore";

/** One persistent navigation surface, backed by the existing workspace and DMs. */
export default function PersonalNavigation({
  mobile = false,
}: {
  mobile?: boolean;
}) {
  const { formatMessage: t } = useIntl();
  const server = useServerStore((state) => state.current);
  const servers = useServerStore((state) => state.servers);
  const conversations = useChannelStore((state) => state.dmChannels);
  const activity = useChannelStore((state) => state.channelActivity);
  const location = useLocation();
  const navigate = useNavigate();
  const base = `/s/${server?.slug}`;
  const home = `${base}/personal`;
  const recent = [...conversations]
    .filter((item) => !item.archivedAt)
    .sort((a, b) =>
      (activity[b.id] || b.createdAt).localeCompare(
        activity[a.id] || a.createdAt,
      ),
    )
    .slice(0, 12);
  const changeWorkspace = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      navigate(`/s/${event.target.value}/personal`);
    },
    [navigate],
  );
  const current = (path: string) =>
    location.pathname === path ? ("page" as const) : undefined;

  if (mobile)
    return (
      <nav
        className="flex shrink-0 items-center justify-between border-b border-line-hairline bg-layer-canvas px-3 py-2 md:hidden"
        aria-label={t({ id: "personal.nav.main" })}
        data-testid="personal-mobile-navigation"
      >
        <Link
          to={home}
          className="personal-navigation-link"
          aria-current={current(home)}
        >
          <SquarePen size={17} aria-hidden="true" />
          {t({ id: "personal.nav.new" })}
        </Link>
        <Link
          to={`${base}/tasks`}
          className="personal-navigation-link"
          aria-current={current(`${base}/tasks`)}
        >
          {t({ id: "personal.nav.tasks" })}
        </Link>
        <Link
          to={`${base}/settings/providers`}
          className="personal-navigation-link"
        >
          {t({ id: "personal.nav.settings" })}
        </Link>
      </nav>
    );

  return (
    <aside
      className="hidden w-56 shrink-0 flex-col border-r border-line-hairline bg-layer-sidebar px-3 py-5 md:flex"
      data-testid="personal-navigation"
    >
      <Link
        to={home}
        className="mb-7 px-3 text-base font-medium text-foreground"
      >
        {t({ id: "personal.title" })}
      </Link>
      <nav aria-label={t({ id: "personal.nav.main" })}>
        <Link
          className="personal-navigation-link"
          to={home}
          aria-current={current(home)}
        >
          <SquarePen size={17} aria-hidden="true" />
          {t({ id: "personal.nav.new" })}
        </Link>
        <Link
          className="personal-navigation-link"
          to={`${base}/tasks`}
          aria-current={current(`${base}/tasks`)}
        >
          <CheckSquare size={17} aria-hidden="true" />
          {t({ id: "personal.nav.tasks" })}
        </Link>
        <Link
          className="personal-navigation-link"
          to={`${base}/saved`}
          aria-current={current(`${base}/saved`)}
        >
          <Bookmark size={17} aria-hidden="true" />
          {t({ id: "personal.nav.saved" })}
        </Link>
      </nav>
      <div className="mt-8 min-h-0 flex-1 overflow-y-auto">
        <p className="mb-2 px-3 text-xs text-foreground-hint">
          {t({ id: "personal.nav.recent" })}
        </p>
        <nav aria-label={t({ id: "personal.nav.recent" })}>
          {recent.map((channel) => (
            <Link
              key={channel.id}
              className="personal-navigation-link"
              to={`${base}/dm/${channel.id}`}
              aria-current={current(`${base}/dm/${channel.id}`)}
            >
              <MessageSquare
                size={15}
                className="shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">
                {channel.peerDisplayName || channel.peerName || channel.name}
              </span>
            </Link>
          ))}
        </nav>
        {!recent.length && (
          <p className="px-3 py-2 text-xs text-foreground-hint">
            {t({ id: "personal.nav.empty" })}
          </p>
        )}
      </div>
      <details className="mt-4 text-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-3 py-2 text-foreground-muted">
          <span className="flex items-center gap-2">
            <Settings2 size={16} aria-hidden="true" />
            {t({ id: "personal.nav.settings" })}
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <nav className="mt-1" aria-label={t({ id: "personal.nav.settings" })}>
          <Link
            className="personal-navigation-link"
            to={`${base}/settings/providers`}
          >
            {t({ id: "personal.providers" })}
          </Link>
          <Link className="personal-navigation-link" to={`${base}/computers`}>
            {t({ id: "personal.viewComputers" })}
          </Link>
          <Link className="personal-navigation-link" to={`${base}/members`}>
            {t({ id: "personal.agents" })}
          </Link>
          <Link
            className="personal-navigation-link"
            to={`${base}/settings/account`}
          >
            {t({ id: "personal.nav.allSettings" })}
          </Link>
        </nav>
        {servers.length > 1 && (
          <select
            aria-label={t({ id: "personal.nav.workspace" })}
            className="mt-2 w-full rounded-md border border-line-hairline bg-layer-canvas p-2 text-xs text-foreground-muted"
            value={server?.slug}
            onChange={changeWorkspace}
          >
            {servers.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        )}
      </details>
    </aside>
  );
}
