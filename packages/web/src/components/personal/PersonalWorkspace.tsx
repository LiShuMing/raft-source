import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search,
  Plus,
  Inbox,
  FileText,
  Clock3,
  Plug,
  Settings2,
  Menu,
  PanelRight,
  Monitor,
  X,
  ChevronRight,
  Pin,
  RefreshCw,
  ArrowLeft,
  Bot,
  Sparkles,
} from "lucide-react";
import type {
  PersonalArtifact,
  PersonalDraft,
  PersonalResource,
  PersonalRoutine,
} from "@botiverse/raft-shared";
import { useAgentDisplayState, useAgentStore } from "../../store/agentStore";
import type { Agent } from "../../store/agentStore";
import { useChannelStore } from "../../store/channelStore";
import {
  selectChannelMessageBucket,
  useMessageStore,
} from "../../store/messageStore";
import { useMachineStore } from "../../store/machineStore";
import { useServerStore } from "../../store/serverStore";
import { useAuthStore } from "../../store/authStore";
import { useTaskStore } from "../../store/taskStore";
import {
  personalApi,
  usePersonalWorkspaceStore,
} from "../../store/personalWorkspaceStore";
import { useServerPermissions } from "../../hooks/useServerPermissions";
import { formatAgentDisplayStateText } from "../../utils/activity";
import ChatPanel from "../message/ChatPanel";
import {
  PersonalDialog as DialogCard,
  PersonalEmpty,
  PersonalErrorNotice,
} from "./PersonalUi";
import PersonalInspector from "./PersonalInspector";
import type { PersonalPanel, PersonalProfileTab } from "./PersonalInspector";
import {
  ArtifactDialog,
  DraftDialog,
  GroupDialog,
  ResourceDialog,
  RoutineDialog,
} from "./PersonalDialogs";
import {
  AttentionPage,
  ConnectionsPage,
  DraftCard,
  LibraryPage,
  RoutinesPage,
  RoutineHistoryDialog,
  useTaskLabel,
} from "./PersonalPages";
import type { ConnectionTab } from "./PersonalPages";
import { usePersonalStrings } from "./usePersonalStrings";
import "./personalWorkspace.css";
const AgentDetailPanel = lazy(() => import("../agent/AgentDetailPanel"));
type Page =
  | "chat"
  | "attention"
  | "library"
  | "routines"
  | "connections"
  | "tasks";
type Modal =
  | { kind: "new" }
  | { kind: "search" }
  | { kind: "group" }
  | { kind: "settings" }
  | { kind: "configure"; agentId: string }
  | {
      kind: "resource";
      resourceKind: "memory" | "skill";
      resource?: PersonalResource;
      initialContent?: string;
    }
  | { kind: "artifact"; artifact?: PersonalArtifact }
  | { kind: "routine"; routine?: PersonalRoutine }
  | { kind: "history"; routine: PersonalRoutine }
  | { kind: "draft"; draft?: PersonalDraft }
  | { kind: "stop" };
const PAGES: Page[] = [
  "chat",
  "attention",
  "library",
  "routines",
  "connections",
  "tasks",
];
function BotNavigationRow({
  agent,
  selected,
  pinned,
  onOpen,
}: {
  agent: Agent;
  selected: boolean;
  pinned: boolean;
  onOpen: (id: string) => void;
}) {
  const intl = useIntl();
  const state = useAgentDisplayState(agent.id, agent);
  return (
    <button
      className={`pw-bot${selected ? " pw-active" : ""}`}
      aria-current={selected ? "page" : undefined}
      onClick={() => onOpen(agent.id)}
    >
      <span className="pw-avatar">
        {(agent.displayName || agent.name).slice(0, 1)}
      </span>
      <span className="pw-grow">
        <span className="pw-bot-name">{agent.displayName || agent.name}</span>
        <span className="pw-bot-sub">
          {formatAgentDisplayStateText(intl, state)}
        </span>
      </span>
      {pinned && <Pin size={11} aria-hidden="true" />}
      <span
        className={`pw-presence${state.isOnline ? " pw-present" : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}

export default function PersonalWorkspace() {
  const t = usePersonalStrings();
  const intl = useIntl();
  const navigate = useNavigate();
  const [query, setQuery] = useSearchParams();
  const server = useServerStore((s) => s.current),
    user = useAuthStore((s) => s.user);
  const agents = useAgentStore((s) => s.agents),
    agentsLoading = useAgentStore((s) => s.loading);
  const machines = useMachineStore((s) => s.machines);
  const dmChannels = useChannelStore((s) => s.dmChannels),
    allChannels = useChannelStore((s) => s.channels);
  const snapshot = usePersonalWorkspaceStore((s) => s.snapshot),
    loading = usePersonalWorkspaceStore((s) => s.loading),
    snapshotError = usePersonalWorkspaceStore((s) => s.error);
  const permissions = useServerPermissions();
  const taskLabel = useTaskLabel();
  const load = usePersonalWorkspaceStore((s) => s.load);
  const [modal, setModal] = useState<Modal | null>(null),
    [panel, setPanel] = useState<PersonalPanel | null>(null),
    [tab, setTab] = useState<PersonalProfileTab>("role");
  const [connectionTab, setConnectionTab] =
      useState<ConnectionTab>("applications"),
    [mobileNav, setMobileNav] = useState(false),
    [compactNav, setCompactNav] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [notice, setNotice] = useState("");
  const [initializing, setInitializing] = useState(true),
    [channelError, setChannelError] = useState(false);
  const activeRequest = useRef("");
  const mounted = useRef(true);
  const operation = useRef(false);
  const pageParam = query.get("page");
  const page: Page = PAGES.includes(pageParam as Page)
    ? (pageParam as Page)
    : "chat";
  const visibleAgents = useMemo(
    () => agents.filter((a) => !a.deletedAt && !a.raftbenchService),
    [agents],
  );
  const snapshotReady = !!snapshot;
  const requestedBot = query.get("bot");
  const explicitChat = query.get("chat");
  const channelId =
    explicitChat ||
    (!requestedBot ? snapshot?.preferences.lastChannelId : null) ||
    null;
  const channel = useMemo(
    () =>
      [...dmChannels, ...allChannels].find((c) => c.id === channelId) ?? null,
    [dmChannels, allChannels, channelId],
  );
  const selectedGroup = snapshot?.groups.find((g) => g.channelId === channelId);
  const agentId =
    requestedBot ||
    (channel?.peerType === "agent" ? channel.peerId : null) ||
    snapshot?.preferences.lastAgentId ||
    visibleAgents[0]?.id ||
    "";
  const agent = visibleAgents.find((a) => a.id === agentId);
  const machine = machines.find((m) => m.id === agent?.machineId);
  const displayState = useAgentDisplayState(agentId, agent);
  const messages = useMessageStore((s) =>
    selectChannelMessageBucket(s, channel?.id ?? null),
  );
  const currentTasks =
    snapshot?.tasks.filter((task) => task.channelId === channel?.id) ?? [];
  const activeTask = currentTasks.find(
    (task) => !["done", "closed"].includes(task.status),
  );
  const currentDrafts =
    snapshot?.drafts.filter((d) => d.channelId === channel?.id).slice(0, 5) ??
    [];
  const pendingCount =
    (snapshot?.drafts.filter((d) =>
      ["pending", "unknown", "executing"].includes(d.state),
    ).length ?? 0) +
    (snapshot?.tasks.filter((task) => task.status === "in_review").length ?? 0);
  const preferences = snapshot?.preferences ?? {};
  const hiddenIds = preferences.hiddenAgentIds ?? [],
    pinnedIds = preferences.pinnedAgentIds ?? [];
  const roster = [...visibleAgents]
    .filter((a) => !hiddenIds.includes(a.id))
    .sort(
      (a, b) =>
        Number(pinnedIds.includes(b.id)) - Number(pinnedIds.includes(a.id)),
    );
  const conversations = [
    ...new Map(
      [...dmChannels, ...allChannels]
        .filter(
          (c) =>
            !c.archivedAt &&
            c.joined !== false &&
            c.type !== "joint" &&
            c.type !== "thread",
        )
        .map((c) => [c.id, c]),
    ).values(),
  ];

  const run = useCallback(async (work: () => Promise<unknown>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(false);
    try {
      await work();
    } catch {
      if (mounted.current) setError(true);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  const openChannel = useCallback(
    (id: string, focusMessage?: string) => {
      activeRequest.current = id;
      setMobileNav(false);
      setChannelError(false);
      setQuery((previous) => {
        const next = new URLSearchParams(previous);
        next.set("chat", id);
        next.delete("page");
        next.delete("bot");
        next.delete("thread");
        if (focusMessage) next.set("msg", focusMessage);
        else next.delete("msg");
        return next;
      });
    },
    [setQuery],
  );
  const openAgent = useCallback(
    (id: string) => {
      activeRequest.current = id;
      setMobileNav(false);
      setChannelError(false);
      setPanel(null);
      setQuery({ bot: id });
    },
    [setQuery],
  );
  const goPage = useCallback(
    (nextPage: Page) => {
      setMobileNav(false);
      setPanel(null);
      setQuery((previous) => {
        const next = new URLSearchParams(previous);
        if (nextPage === "chat") next.delete("page");
        else next.set("page", nextPage);
        next.delete("thread");
        return next;
      });
    },
    [setQuery],
  );
  const openConnections = useCallback(
    (nextTab: ConnectionTab) => {
      setConnectionTab(nextTab);
      goPage("connections");
    },
    [goPage],
  );
  const createAgent = useCallback(() => {
    setModal(null);
    useAgentStore.getState().setShowCreateAgent(true);
  }, []);
  const connectComputer = useCallback(
    () => useMachineStore.getState().setShowAddMachine(true),
    [],
  );
  const closeModal = useCallback(() => setModal(null), []);
  const onSaved = useCallback(() => {
    setModal(null);
    setNotice(t("saved"));
  }, [t]);

  useEffect(() => {
    mounted.current = true;
    void Promise.all([
      useAgentStore.getState().loadAgents(),
      useMachineStore.getState().loadMachines(),
      load(),
    ]).finally(() => {
      if (mounted.current) setInitializing(false);
    });
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15_000);
    const refresh = () => {
      if (!document.hidden) void load();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  // Only navigate after the DM request for the still-selected assistant settles.
  // oxlint-disable-next-line react-doctor/no-cascading-set-state -- A single guarded async DM request reports channel resolution failure.
  useEffect(() => {
    if (initializing || !snapshotReady || (!agentId && !channelId)) return;
    let current = true;
    if (explicitChat || (!requestedBot && channelId)) {
      void useChannelStore
        .getState()
        .ensureChannel(explicitChat || channelId!)
        .then((resolved) => {
          if (current && !resolved) setChannelError(true);
        })
        .catch(() => {
          if (current) setChannelError(true);
        });
      return () => {
        current = false;
      };
    }
    if (!agentId) return;
    activeRequest.current = agentId;
    void useChannelStore
      .getState()
      .openDM(agentId)
      .then((dm) => {
        if (current && activeRequest.current === agentId) openChannel(dm.id);
      })
      .catch(() => {
        if (current) setChannelError(true);
      });
    return () => {
      current = false;
    };
  }, [
    initializing,
    snapshotReady,
    requestedBot,
    explicitChat,
    agentId,
    channelId,
    openChannel,
  ]);
  useEffect(() => {
    if (!channel || !server) return;
    const scope =
      usePersonalWorkspaceStore.getState().snapshot?.preferences ?? {};
    if (
      scope.lastChannelId === channel.id &&
      (!agentId || scope.lastAgentId === agentId)
    )
      return;
    void personalApi
      .preferences({
        ...scope,
        lastChannelId: channel.id,
        ...(agentId ? { lastAgentId: agentId } : {}),
      })
      .catch(() => {});
  }, [channel, agentId, server]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey)
      )
        return;
      const key = event.key.toLowerCase();
      if (!["k", "n", ",", "b"].includes(key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (key === "k") setModal({ kind: "search" });
      else if (key === "n") setModal({ kind: "new" });
      else if (key === ",") setModal({ kind: "settings" });
      else setCompactNav((value) => !value);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const togglePin = () => {
    if (!agent) return;
    void run(() =>
      personalApi.preferences({
        ...preferences,
        pinnedAgentIds: pinnedIds.includes(agent.id)
          ? pinnedIds.filter((id) => id !== agent.id)
          : [...pinnedIds, agent.id],
      }),
    );
  };
  const onResource = useCallback(
    (
      kind: "memory" | "skill",
      resource?: PersonalResource,
      initialContent?: string,
    ) =>
      setModal({
        kind: "resource",
        resourceKind: kind,
        resource,
        initialContent,
      }),
    [],
  );
  const onRoutine = useCallback(
    (routine?: PersonalRoutine) => {
      if (!agent && !routine) {
        setModal({ kind: "new" });
        return;
      }
      setModal({ kind: "routine", routine });
    },
    [agent],
  );
  const openArtifact = useCallback(
    (artifact: PersonalArtifact) => {
      openChannel(artifact.channelId);
      setPanel({ kind: "artifact", id: artifact.id });
    },
    [openChannel],
  );
  const useSkill = useCallback(
    (resource: PersonalResource) => {
      if (!channel) return;
      useMessageStore
        .getState()
        .setDraft(
          channel.id,
          `${useMessageStore.getState().drafts[channel.id] ?? ""} /${resource.title} `,
        );
      setNotice(t("insertHint"));
    },
    [channel, t],
  );
  const pageTitle =
    page === "tasks"
      ? t("taskHistory")
      : page === "chat"
        ? selectedGroup?.title ||
          agent?.displayName ||
          agent?.name ||
          t("space")
        : t(page);
  const subtitle = selectedGroup
    ? t("groupHint")
    : agent
      ? `${machine?.hostname || machine?.name || t("unknown")} · ${agent.runtime}`
      : t("savedConnection");
  const selectSearchMessage = useCallback(
    (channelId: string, messageId: string) => {
      setModal(null);
      openChannel(channelId, messageId);
    },
    [openChannel],
  );
  const startAssistant = useCallback(
    () =>
      void run(async () => {
        if (!agent) return;
        const { default: api } = await import("../../api/client");
        await api.post(`/agents/${agent.id}/start`);
        await useAgentStore.getState().loadAgents();
        setNotice(t("submitted"));
      }),
    [agent, run, t],
  );
  const searchRows = useMemo(
    () => [
      ...visibleAgents.map((a) => ({
        id: a.id,
        title: a.displayName || a.name,
        detail: a.description || a.runtime,
        action: () => {
          setModal(null);
          openAgent(a.id);
        },
      })),
      ...(snapshot?.groups.map((g) => ({
        id: g.id,
        title: g.title,
        detail: t("groups"),
        action: () => {
          setModal(null);
          openChannel(g.channelId);
        },
      })) ?? []),
      ...(snapshot?.artifacts.map((a) => ({
        id: a.id,
        title: a.title,
        detail: t("result") + ` · v${a.version}`,
        action: () => {
          setModal(null);
          openArtifact(a);
        },
      })) ?? []),
      ...(snapshot?.resources.map((resource) => ({
        id: resource.id,
        title: resource.title,
        detail: resource.content.slice(0, 120),
        action: () => {
          setModal(null);
          if (resource.agentId || agentId)
            openAgent(resource.agentId || agentId);
          setTab(resource.kind === "memory" ? "memory" : "skills");
          setPanel({ kind: "profile" });
        },
      })) ?? []),
      ...(snapshot?.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        detail: taskLabel(task.status),
        action: () => {
          setModal(null);
          openChannel(task.channelId, task.messageId ?? undefined);
        },
      })) ?? []),
      ...(snapshot?.routines.map((r) => ({
        id: r.id,
        title: r.title,
        detail: t("routines"),
        action: () => {
          setModal(null);
          goPage("routines");
        },
      })) ?? []),
      ...messages.map((m) => ({
        id: m.id,
        title: m.content.slice(0, 120),
        detail: m.senderName || t("fromMessage"),
        action: () => {
          setModal(null);
          openChannel(m.channelId, m.id);
        },
      })),
    ],
    [
      visibleAgents,
      snapshot,
      messages,
      openAgent,
      openChannel,
      goPage,
      t,
      openArtifact,
      taskLabel,
      agentId,
    ],
  );
  const navButton = (
    id: Page,
    icon: ReactNode,
    label: string,
    count?: number,
  ) => (
    <button
      key={id}
      className={`pw-nav${page === id ? " pw-active" : ""}`}
      onClick={() => goPage(id)}
      aria-current={page === id ? "page" : undefined}
    >
      {icon}
      <span>{label}</span>
      {!!count && <span className="pw-count">{count}</span>}
    </button>
  );
  const inspectorAgent =
    panel?.kind === "artifact"
      ? agents.find(
          (a) =>
            a.id ===
            snapshot?.artifacts.find((x) => x.id === panel.id)?.agentId,
        ) || agent
      : agent;
  const artifactModalChannel =
    modal?.kind === "artifact" && modal.artifact
      ? ([...allChannels, ...dmChannels].find(
          (c) => c.id === modal.artifact?.channelId,
        ) ?? channel)
      : channel;

  const retry = useCallback(() => {
    setError(false);
    setChannelError(false);
    void load();
  }, [load]);
  const closeInspector = useCallback(() => setPanel(null), []);
  const openProfile = useCallback(() => setPanel({ kind: "profile" }), []);
  const editDraft = useCallback(
    (draft: PersonalDraft) => {
      openChannel(draft.channelId);
      setModal({ kind: "draft", draft });
    },
    [openChannel],
  );
  const newArtifact = useCallback(
    () => setModal({ kind: channel ? "artifact" : "new" }),
    [channel],
  );
  const newRoutine = useCallback(() => onRoutine(), [onRoutine]);
  const routineHistory = useCallback(
    (routine: PersonalRoutine) => setModal({ kind: "history", routine }),
    [],
  );
  const configureAgent = useCallback(
    (a: Agent) => setModal({ kind: "configure", agentId: a.id }),
    [],
  );
  const editArtifact = useCallback(
    (artifact: PersonalArtifact) => setModal({ kind: "artifact", artifact }),
    [],
  );
  const onConfigureClosed = useCallback(() => setModal(null), []);
  const artifactSaved = useCallback(() => {
    onSaved();
    goPage("library");
  }, [onSaved, goPage]);
  const artifactMessages = useMemo(
    () => messages.filter((m) => m.channelId === artifactModalChannel?.id),
    [messages, artifactModalChannel?.id],
  );
  const activeSkills = useMemo(
    () =>
      snapshot?.resources.filter((r) => r.kind === "skill" && r.enabled) ?? [],
    [snapshot?.resources],
  );

  return (
    <div
      className={`personal-workspace${compactNav ? " pw-compact" : ""}`}
      data-testid="personal-workspace"
    >
      <aside
        className={`pw-sidebar${mobileNav ? " pw-mobile-open" : ""}`}
        aria-label={t("space")}
      >
        <div className="pw-brand">
          <Sparkles size={23} aria-hidden="true" />
          {t("space")}
          <button
            className="pw-icon pw-mobile-only"
            aria-label={t("close")}
            onClick={() => setMobileNav(false)}
          >
            <X size={16} />
          </button>
        </div>
        <button className="pw-nav" onClick={() => setModal({ kind: "search" })}>
          <Search size={17} />
          {t("search")}
          <kbd>{t("shortcutSearch")}</kbd>
        </button>
        <button className="pw-nav" onClick={() => setModal({ kind: "new" })}>
          <Plus size={17} />
          {t("create")}
          <kbd>{t("shortcutNew")}</kbd>
        </button>
        {navButton(
          "attention",
          <Inbox size={17} />,
          t("attention"),
          pendingCount,
        )}
        <div className="pw-roster">
          <div className="pw-nav-label">
            {t("assistants")}
            {permissions.capabilities.createAgents && (
              <button
                className="pw-icon"
                aria-label={t("newAssistant")}
                onClick={createAgent}
              >
                <Plus size={14} />
              </button>
            )}
          </div>
          {roster.map((a) => (
            <BotNavigationRow
              key={a.id}
              agent={a}
              selected={page === "chat" && a.id === agentId && !selectedGroup}
              pinned={pinnedIds.includes(a.id)}
              onOpen={openAgent}
            />
          ))}
          {!roster.length && (
            <p className="pw-sidebar-hint">
              {initializing ? t("loading") : t("noAgentHint")}
            </p>
          )}
          {hiddenIds.length > 0 && (
            <details className="pw-hidden">
              <summary>{t("hidden")}</summary>
              {visibleAgents
                .filter((a) => hiddenIds.includes(a.id))
                .map((a) => (
                  <div key={a.id} className="pw-row">
                    <span className="pw-grow">{a.displayName || a.name}</span>
                    <button
                      onClick={() =>
                        void run(() =>
                          personalApi.preferences({
                            ...preferences,
                            hiddenAgentIds: hiddenIds.filter(
                              (id) => id !== a.id,
                            ),
                          }),
                        )
                      }
                    >
                      {t("show")}
                    </button>
                  </div>
                ))}
            </details>
          )}
          <div className="pw-nav-label">
            {t("groups")}
            {permissions.capabilities.createChannels && (
              <button
                className="pw-icon"
                aria-label={t("newGroup")}
                onClick={() => setModal({ kind: "group" })}
              >
                <Plus size={14} />
              </button>
            )}
          </div>
          {snapshot?.groups.map((group) => (
            <button
              className={`pw-bot${channelId === group.channelId && page === "chat" ? " pw-active" : ""}`}
              key={group.id}
              onClick={() => openChannel(group.channelId)}
            >
              <span className="pw-avatar">
                <Bot size={15} />
              </span>
              <span className="pw-grow">
                <span className="pw-bot-name">{group.title}</span>
                <span className="pw-bot-sub">
                  {group.agentIds
                    .map(
                      (id) =>
                        agents.find((a) => a.id === id)?.displayName ||
                        agents.find((a) => a.id === id)?.name,
                    )
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="pw-sidebar-bottom">
          {navButton("library", <FileText size={17} />, t("library"))}
          {navButton("routines", <Clock3 size={17} />, t("routines"))}
          {navButton("connections", <Plug size={17} />, t("connections"))}
          <div className="pw-account">
            <span className="pw-user-avatar">
              {(user?.displayName || user?.name || "").slice(0, 2)}
            </span>
            <div className="pw-grow">
              <span>{server?.name || t("space")}</span>
              <small>
                {machine
                  ? t("computerStatus", {
                      name: machine.hostname || machine.name,
                      status: t(
                        machine.status === "online" ? "online" : "offline",
                      ),
                    })
                  : t("unknown")}
              </small>
            </div>
            <button
              className="pw-icon"
              aria-label={t("settings")}
              onClick={() => setModal({ kind: "settings" })}
            >
              <Settings2 size={16} />
            </button>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="pw-mobile-backdrop"
          aria-label={t("close")}
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="pw-workbench">
        <main className="pw-main">
          <header className="pw-header">
            <div className="pw-row pw-grow">
              <button
                className="pw-icon pw-mobile-only"
                onClick={() => setMobileNav(true)}
                aria-label={t("openNavigation")}
              >
                <Menu size={18} />
              </button>
              {compactNav && (
                <button
                  className="pw-icon"
                  onClick={() => setCompactNav(false)}
                  aria-label={t("openNavigation")}
                >
                  <Menu size={18} />
                </button>
              )}
              <div className="pw-grow">
                <h1>{pageTitle}</h1>
                <p className="pw-header-subtitle">
                  {page === "chat" ? subtitle : server?.name}
                </p>
              </div>
            </div>
            <div className="pw-header-actions">
              {page === "chat" && (
                <>
                  <button
                    type="button"
                    className="pw-button pw-subtle"
                    onClick={() => setPanel({ kind: "computer" })}
                  >
                    <Monitor size={16} />
                    <span>{t("workspace")}</span>
                  </button>
                  <button
                    className="pw-icon"
                    aria-label={t("profile")}
                    onClick={() => setPanel({ kind: "profile" })}
                  >
                    <PanelRight size={17} />
                  </button>
                </>
              )}
              <button
                className="pw-icon"
                aria-label={t("refreshHint")}
                onClick={() => void load()}
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </header>
          {(snapshotError || error || channelError) && (
            <PersonalErrorNotice onRetry={retry} />
          )}
          {page === "chat" && (
            <>
              {channel && (
                <div className="pw-task-strip">
                  <Clock3 size={14} />
                  <button onClick={() => goPage("tasks")} className="pw-grow">
                    {activeTask?.title || t("noTask")}
                  </button>
                  <span className="pw-chip">
                    {activeTask
                      ? taskLabel(activeTask.status)
                      : formatAgentDisplayStateText(intl, displayState, {
                          withDetail: false,
                        })}
                  </span>
                  <button
                    className="pw-icon"
                    aria-label={t("taskHistory")}
                    onClick={() => goPage("tasks")}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
              {initializing || loading || agentsLoading ? (
                <div className="pw-loading" role="status">
                  {t("loading")}
                </div>
              ) : !visibleAgents.length ? (
                <PersonalEmpty
                  icon={<Bot size={34} />}
                  title={t("firstTitle")}
                  description={t("firstDescription")}
                >
                  <div className="pw-actions">
                    {permissions.capabilities.createAgents && (
                      <button
                        type="button"
                        className="pw-button pw-primary"
                        onClick={createAgent}
                      >
                        {t("newAssistant")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="pw-button"
                      onClick={() => openConnections("devices")}
                    >
                      {t("localAgent")}
                    </button>
                    <button
                      type="button"
                      className="pw-button"
                      onClick={() => openConnections("modelApi")}
                    >
                      {t("modelApi")}
                    </button>
                  </div>
                </PersonalEmpty>
              ) : channel ? (
                <div className="pw-chat-host">
                  <ChatPanel
                    key={channel.id}
                    channel={channel}
                    hideHeader
                    personal
                    defaultAsTask={!activeTask}
                    onOpenProfile={openProfile}
                    personalAccessory={
                      <div className="pw-chat-accessory">
                        <div className="pw-accessory-buttons">
                          <button
                            onClick={() => setModal({ kind: "artifact" })}
                          >
                            {t("saveReply")}
                          </button>
                          <button onClick={() => setModal({ kind: "draft" })}>
                            {t("newDraft")}
                          </button>
                          <button
                            onClick={() => {
                              setPanel({ kind: "profile" });
                              setTab("skills");
                            }}
                          >
                            {t("skills")}
                          </button>
                          {agent &&
                            !agent.external &&
                            machine?.status === "online" &&
                            !displayState.isOnline && (
                              <button disabled={busy} onClick={startAssistant}>
                                {t("start")}
                              </button>
                            )}
                          {agent && displayState.isOnline && (
                            <button
                              disabled={busy}
                              onClick={() => setModal({ kind: "stop" })}
                            >
                              {t("stop")}
                            </button>
                          )}
                        </div>
                        <div className="pw-draft-list">
                          {currentDrafts.map((draft) => (
                            <DraftCard
                              key={draft.id}
                              {...{ draft, busy }}
                              onRun={run}
                              targetName={
                                conversations.find(
                                  (c) => c.id === draft.targetChannelId,
                                )?.peerDisplayName ||
                                conversations.find(
                                  (c) => c.id === draft.targetChannelId,
                                )?.description ||
                                conversations.find(
                                  (c) => c.id === draft.targetChannelId,
                                )?.name ||
                                draft.targetChannelId
                              }
                              onEdit={editDraft}
                              onOpen={openChannel}
                            />
                          ))}
                        </div>
                      </div>
                    }
                  />
                </div>
              ) : (
                <div className="pw-loading">
                  {channelError ? t("error") : t("loading")}
                </div>
              )}
            </>
          )}
          {page === "attention" && (
            <AttentionPage
              onConversation={openChannel}
              onEditDraft={editDraft}
              onRun={run}
              busy={busy}
            />
          )}
          {page === "library" && (
            <LibraryPage
              agents={visibleAgents}
              onOpen={openArtifact}
              onCreate={newArtifact}
            />
          )}
          {page === "routines" && (
            <RoutinesPage
              onCreate={newRoutine}
              onEdit={onRoutine}
              onHistory={routineHistory}
              onRun={run}
              busy={busy}
            />
          )}
          {page === "connections" && (
            <ConnectionsPage
              tab={connectionTab}
              onTab={setConnectionTab}
              agents={visibleAgents}
              onAgent={configureAgent}
              onConnectComputer={connectComputer}
            />
          )}
          {page === "tasks" && (
            <div className="pw-page">
              <div className="pw-page-title pw-row pw-between">
                <div>
                  <h1>{t("taskHistory")}</h1>
                  <p>{t("sourceTasks")}</p>
                </div>
                <button
                  type="button"
                  className="pw-button"
                  onClick={() => goPage("chat")}
                >
                  <ArrowLeft size={14} />
                  {t("back")}
                </button>
              </div>
              {!snapshot?.tasks.length && <PersonalEmpty title={t("noTask")} />}
              {snapshot?.tasks.map((task) => (
                <div key={task.id} className="pw-list-row">
                  <Clock3 size={16} />
                  <div className="pw-grow">
                    <h3>{task.title}</h3>
                    <p>
                      {taskLabel(task.status)} ·{" "}
                      {intl.formatDate(new Date(task.updatedAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  {task.status === "in_review" && (
                    <button
                      type="button"
                      className="pw-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await useTaskStore
                            .getState()
                            .updateTaskStatus(task.channelId, task.id, "done");
                          await load();
                        })
                      }
                    >
                      {t("accept")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="pw-button"
                    onClick={() =>
                      openChannel(task.channelId, task.messageId ?? undefined)
                    }
                  >
                    {t("open")}
                  </button>
                </div>
              ))}
              {snapshot?.nextTaskCursor && (
                <button
                  type="button"
                  className="pw-button"
                  onClick={() =>
                    void run(() =>
                      usePersonalWorkspaceStore.getState().loadMoreTasks(),
                    )
                  }
                >
                  {t("more")}
                </button>
              )}
            </div>
          )}
        </main>
        {panel && page === "chat" && (
          <PersonalInspector
            {...{ panel, channel, tab, busy }}
            agent={inspectorAgent}
            onTab={setTab}
            onClose={closeInspector}
            onConfigure={configureAgent}
            onResource={onResource}
            onArtifactEdit={editArtifact}
            onRoutine={onRoutine}
            onUseSkill={useSkill}
            onOpenChannel={openChannel}
            onRun={run}
          />
        )}
      </div>
      {notice && (
        <div className="pw-toast" role="status">
          {notice}
        </div>
      )}
      {modal?.kind === "search" && (
        <SearchDialog
          key="search"
          rows={searchRows}
          onClose={closeModal}
          onMessage={selectSearchMessage}
        />
      )}
      {modal?.kind === "new" && (
        <DialogCard title={t("create")} onClose={closeModal}>
          <div className="pw-dialog">
            <p className="pw-muted">{t("firstDescription")}</p>
            {visibleAgents.map((a) => (
              <button
                key={a.id}
                className="pw-choice"
                onClick={() => {
                  closeModal();
                  openAgent(a.id);
                }}
              >
                <span className="pw-avatar">
                  {(a.displayName || a.name).slice(0, 1)}
                </span>
                <span className="pw-grow">
                  <strong>{a.displayName || a.name}</strong>
                  <small>{a.description || a.runtime}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            <div className="pw-actions">
              {permissions.capabilities.createAgents && (
                <button
                  type="button"
                  className="pw-button pw-primary"
                  onClick={createAgent}
                >
                  {t("newAssistant")}
                </button>
              )}
              {permissions.capabilities.createChannels && (
                <button
                  type="button"
                  className="pw-button"
                  onClick={() => setModal({ kind: "group" })}
                >
                  {t("newGroup")}
                </button>
              )}
            </div>
          </div>
        </DialogCard>
      )}
      {modal?.kind === "resource" && (
        <ResourceDialog
          key={modal.resource?.id ?? modal.resourceKind}
          kind={modal.resourceKind}
          resource={modal.resource}
          agentId={agent?.id ?? null}
          initialContent={modal.initialContent}
          onClose={closeModal}
          onSaved={onSaved}
        />
      )}
      {modal?.kind === "artifact" && artifactModalChannel && (
        <ArtifactDialog
          key={modal.artifact?.id ?? "new-artifact"}
          artifact={modal.artifact}
          channel={artifactModalChannel}
          agentId={modal.artifact?.agentId ?? agent?.id ?? null}
          messages={artifactMessages}
          onClose={closeModal}
          onSaved={artifactSaved}
        />
      )}
      {modal?.kind === "draft" &&
        channel &&
        (!modal.draft || modal.draft.channelId === channel.id) && (
          <DraftDialog
            key={modal.draft?.id ?? "new-draft"}
            draft={modal.draft}
            {...{ channel, conversations }}
            onClose={closeModal}
            onSaved={onSaved}
          />
        )}
      {modal?.kind === "group" && (
        <GroupDialog
          agents={visibleAgents}
          onClose={closeModal}
          onSaved={onSaved}
          onCreated={openChannel}
        />
      )}
      {modal?.kind === "routine" && (
        <RoutineDialog
          key={modal.routine?.id ?? "new-routine"}
          routine={modal.routine}
          agents={visibleAgents}
          channelId={channel?.id ?? ""}
          agentId={agent?.id ?? ""}
          skills={activeSkills}
          onClose={closeModal}
          onSaved={onSaved}
        />
      )}
      {modal?.kind === "history" && (
        <RoutineHistoryDialog
          routine={modal.routine}
          onClose={closeModal}
          onRun={run}
          busy={busy}
        />
      )}
      {modal?.kind === "configure" && (
        <DialogCard
          title={t("agentConfig")}
          onClose={closeModal}
          maxWidthClass="max-w-3xl"
        >
          <div className="pw-config-dialog">
            <Suspense fallback={<p>{t("loading")}</p>}>
              {agents.find((a) => a.id === modal.agentId) && (
                <AgentDetailPanel
                  agent={agents.find((a) => a.id === modal.agentId)!}
                  onClose={onConfigureClosed}
                />
              )}
            </Suspense>
          </div>
        </DialogCard>
      )}
      {modal?.kind === "settings" && (
        <DialogCard
          title={t("settings")}
          onClose={closeModal}
          maxWidthClass="max-w-2xl"
        >
          <div className="pw-dialog pw-settings-dialog">
            <div className="pw-actions">
              {(["account", "appearance", "notifications"] as const).map(
                (key) => (
                  <button
                    type="button"
                    className="pw-button"
                    key={key}
                    onClick={() => {
                      closeModal();
                      navigate(`/s/${server?.slug}/settings/${key}`);
                    }}
                  >
                    {t(key)}
                  </button>
                ),
              )}
              <button
                type="button"
                className="pw-button"
                onClick={() => {
                  closeModal();
                  openConnections("localAgent");
                }}
              >
                {t("onboarding")}
              </button>
            </div>
            {agent && (
              <div className="pw-actions">
                <button type="button" className="pw-button" onClick={togglePin}>
                  {t(pinnedIds.includes(agent.id) ? "unpin" : "pin")}
                </button>
                <button
                  type="button"
                  className="pw-button"
                  onClick={() =>
                    void run(async () => {
                      await personalApi.preferences({
                        ...preferences,
                        hiddenAgentIds: [...hiddenIds, agent.id],
                      });
                      closeModal();
                    })
                  }
                >
                  {t("hide")}
                </button>
              </div>
            )}
            <p className="pw-muted">{t("preferencesHint")}</p>
            <button
              type="button"
              className="pw-button"
              onClick={() => navigate(`/s/${server?.slug}/settings/account`)}
            >
              {t("openSettings")}
              <ExternalLinkIcon />
            </button>
          </div>
        </DialogCard>
      )}
      {modal?.kind === "stop" && agent && (
        <DialogCard title={t("stop")} onClose={closeModal}>
          <div className="pw-dialog">
            <p>{t("stopHint")}</p>
            <div className="pw-dialog-actions">
              <button type="button" className="pw-button" onClick={closeModal}>
                {t("cancel")}
              </button>
              <button
                type="button"
                className="pw-button pw-primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const { default: api } = await import("../../api/client");
                    await api.post(`/agents/${agent.id}/stop`);
                    await useAgentStore.getState().loadAgents();
                    closeModal();
                    setNotice(t("stopped"));
                  })
                }
              >
                {busy ? t("stopping") : t("stop")}
              </button>
            </div>
          </div>
        </DialogCard>
      )}
    </div>
  );
}
function ExternalLinkIcon() {
  return <ChevronRight size={13} />;
}
function SearchDialog({
  rows,
  onClose,
  onMessage,
}: {
  onMessage: (channelId: string, messageId: string) => void;
  rows: { id: string; title: string; detail: string; action: () => void }[];
  onClose: () => void;
}) {
  const t = usePersonalStrings();
  const [query, setQuery] = useState("");
  const term = query.trim();
  const [remote, setRemote] = useState<{
    term: string;
    messages: { id: string; channelId: string; content: string }[];
    failed: boolean;
  } | null>(null);
  // oxlint-disable-next-line react-doctor/no-cascading-set-state -- Debounced search reconciles an external response or network failure, with stale responses discarded.
  useEffect(() => {
    if (term.length < 2) return;
    let current = true;
    const timer = setTimeout(() => {
      void personalApi
        .searchMessages(term)
        .then((messages) => {
          if (current) setRemote({ term, messages, failed: false });
        })
        .catch(() => {
          if (current) setRemote({ term, messages: [], failed: true });
        });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term]);
  const results = rows
    .filter((row) =>
      (row.title + row.detail)
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    )
    .slice(0, 25);
  return (
    <DialogCard title={t("search")} onClose={onClose} maxWidthClass="max-w-xl">
      <div className="pw-dialog">
        <input
          aria-label={t("searchLabel")}
          placeholder={t("placeholderSearch")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {!results.length && <PersonalEmpty title={t("noSearch")} />}
        <div className="pw-search-results">
          {remote?.term === term && remote.failed && <PersonalErrorNotice />}
          {results.map((row) => (
            <button className="pw-choice" key={row.id} onClick={row.action}>
              <Search size={16} />
              <span className="pw-grow">
                <strong>{row.title}</strong>
                <small>{row.detail}</small>
              </span>
            </button>
          ))}
          {remote?.term === term &&
            remote.messages
              .filter((hit) => !results.some((row) => row.id === hit.id))
              .map((hit) => (
                <button
                  className="pw-choice"
                  key={hit.id}
                  onClick={() => onMessage(hit.channelId, hit.id)}
                >
                  <Search size={16} />
                  <span className="pw-grow">
                    <strong>{hit.content.slice(0, 140)}</strong>
                    <small>{t("fromMessage")}</small>
                  </span>
                </button>
              ))}
        </div>
      </div>
    </DialogCard>
  );
}
