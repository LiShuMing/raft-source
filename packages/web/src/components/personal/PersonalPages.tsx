import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import {
  FileText,
  Inbox,
  Clock3,
  ExternalLink,
  Monitor,
  Bot,
  Plus,
  RefreshCw,
  Check,
  Pencil,
} from "lucide-react";
import type {
  PersonalArtifact,
  PersonalDraft,
  PersonalRoutine,
  PersonalRoutineRun,
  PersonalTaskSummary,
} from "@botiverse/raft-shared";
import type { Agent } from "../../store/agentStore";
import { useChannelStore } from "../../store/channelStore";
import { useMachineStore } from "../../store/machineStore";
import {
  personalApi,
  usePersonalWorkspaceStore,
} from "../../store/personalWorkspaceStore";
import {
  PersonalDialog as DialogCard,
  PersonalEmpty,
  PersonalErrorNotice,
} from "./PersonalUi";
import { usePersonalStrings } from "./usePersonalStrings";
import type { WorkspaceWord } from "./workspaceMessages";
const ProviderConnectionsSettings = lazy(
  () => import("../settings/ProviderConnectionsSettings"),
);
const SettingsPanel = lazy(() => import("../settings/SettingsPanel"));
const IntegrationsSection = lazy(() =>
  import("../settings/SettingsPanel").then((m) => ({
    default: m.IntegrationsSection,
  })),
);
type Run = (work: () => Promise<unknown>) => Promise<void>;

export function useTaskLabel() {
  const t = usePersonalStrings();
  return useCallback(
    (status: PersonalTaskSummary["status"]) =>
      t(
        (
          {
            todo: "taskTodo",
            in_progress: "taskProgress",
            in_review: "taskInReview",
            done: "taskDone",
            closed: "taskClosed",
          } as const
        )[status],
      ),
    [t],
  );
}
export function DraftCard({
  draft,
  targetName,
  onEdit,
  onRun,
  busy,
  onOpen,
}: {
  onOpen?: (channelId: string, messageId?: string) => void;
  draft: PersonalDraft;
  targetName: string;
  onEdit: (draft: PersonalDraft) => void;
  onRun: Run;
  busy: boolean;
}) {
  const t = usePersonalStrings();
  const intl = useIntl();
  const label = t(
    (
      {
        pending: "pending",
        denied: "denied",
        executing: "executing",
        executed: "executed",
        unknown: "outcomeUnknown",
        expired: "expired",
      } as const
    )[draft.state],
  );
  return (
    <section
      className="pw-approval"
      aria-label={t("reviewDraft")}
      data-testid="personal-draft-card"
    >
      <div className="pw-approval-header">
        <Inbox size={15} />
        {label}
        <span className="pw-grow" />
        <span className="pw-chip">
          {t("versionTag", { version: draft.version })}
        </span>
      </div>
      <div className="pw-approval-body">
        <h3>{draft.title}</h3>
        <p className="pw-muted">
          {t("target")} · {targetName}
        </p>
        <div className="pw-draft-content">{draft.content}</div>
        <p className="pw-meta">
          {intl.formatDate(new Date(draft.updatedAt), {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
        <div className="pw-actions">
          {draft.state === "pending" && (
            <>
              <button
                type="button"
                className="pw-button pw-primary"
                disabled={busy}
                onClick={() =>
                  void onRun(() => personalApi.decideDraft(draft, true))
                }
              >
                {t("approve")}
              </button>
              <button
                type="button"
                className="pw-button"
                disabled={busy}
                onClick={() =>
                  void onRun(() => personalApi.decideDraft(draft, false))
                }
              >
                {t("deny")}
              </button>
            </>
          )}
          {["pending", "denied", "expired"].includes(draft.state) && (
            <button
              type="button"
              className="pw-button"
              onClick={() => onEdit(draft)}
              disabled={busy}
            >
              <Pencil size={13} />
              {t("edit")}
            </button>
          )}
          {["executing", "unknown"].includes(draft.state) && (
            <button
              type="button"
              className="pw-button"
              disabled={busy}
              onClick={() =>
                void onRun(() => personalApi.reconcileDraft(draft.id))
              }
            >
              {t("reconcile")}
            </button>
          )}
        </div>
        {draft.state === "executed" && (
          <p className="pw-meta">
            {t("draftReceipt")}
            {onOpen && (
              <button
                className="pw-button"
                type="button"
                onClick={() =>
                  onOpen(
                    draft.targetChannelId,
                    draft.receiptMessageId ?? undefined,
                  )
                }
              >
                {t("open")}
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

export function AttentionPage({
  onConversation,
  onEditDraft,
  onRun,
  busy,
}: {
  onConversation: (channelId: string, messageId?: string) => void;
  onEditDraft: (draft: PersonalDraft) => void;
  onRun: Run;
  busy: boolean;
}) {
  const t = usePersonalStrings();
  const snapshot = usePersonalWorkspaceStore((s) => s.snapshot);
  const channels = useChannelStore((s) => s.channels),
    dms = useChannelStore((s) => s.dmChannels);
  const targetName = (id: string) => {
    const target = [...channels, ...dms].find((channel) => channel.id === id);
    return target?.peerDisplayName || target?.description || target?.name || id;
  };
  const processed =
    snapshot?.drafts.filter(
      (draft) => !["pending", "unknown", "executing"].includes(draft.state),
    ) ?? [];
  const drafts =
    snapshot?.drafts.filter((d) =>
      ["pending", "unknown", "executing"].includes(d.state),
    ) ?? [];
  const reviews =
    snapshot?.tasks.filter((task) => task.status === "in_review") ?? [];
  return (
    <div className="pw-page">
      <div className="pw-page-title">
        <h1>{t("attention")}</h1>
        <p>{t("noAttentionHint")}</p>
      </div>
      {!drafts.length && !reviews.length && (
        <PersonalEmpty icon={<Check size={28} />} title={t("noAttention")} />
      )}
      {drafts.map((draft) => (
        <div key={draft.id} className="pw-attention-item">
          <DraftCard
            {...{ draft, busy, onRun }}
            targetName={targetName(draft.targetChannelId)}
            onEdit={onEditDraft}
            onOpen={onConversation}
          />
          <button
            type="button"
            className="pw-button"
            onClick={() => onConversation(draft.channelId)}
          >
            {t("openConversation")}
            <ExternalLink size={13} />
          </button>
        </div>
      ))}
      {processed.length > 0 && (
        <details>
          <summary>{t("processed")}</summary>
          {processed.map((draft) => (
            <DraftCard
              key={draft.id}
              {...{ draft, busy, onRun }}
              targetName={targetName(draft.targetChannelId)}
              onEdit={onEditDraft}
              onOpen={onConversation}
            />
          ))}
        </details>
      )}
      {reviews.length > 0 && (
        <h2 className="pw-section-title">{t("taskReview")}</h2>
      )}
      {reviews.map((task) => (
        <div className="pw-list-row" key={task.id}>
          <FileText size={18} />
          <div className="pw-grow">
            <h3>{task.title}</h3>
            <p>{t("taskInReview")}</p>
          </div>
          <button
            type="button"
            className="pw-button"
            onClick={() => onConversation(task.channelId)}
          >
            {t("open")}
          </button>
        </div>
      ))}
    </div>
  );
}
export function LibraryPage({
  onOpen,
  onCreate,
  agents,
}: {
  onOpen: (artifact: PersonalArtifact) => void;
  onCreate: () => void;
  agents: Agent[];
}) {
  const t = usePersonalStrings();
  const intl = useIntl();
  const artifacts = usePersonalWorkspaceStore((s) => s.snapshot?.artifacts);
  const [filter, setFilter] = useState("");
  const rows = (artifacts ?? []).filter((a) => !filter || a.agentId === filter);
  return (
    <div className="pw-page">
      <div className="pw-page-title pw-row pw-between">
        <div>
          <h1>{t("library")}</h1>
          <p>{t("privateLibrary")}</p>
        </div>
        <button type="button" className="pw-button" onClick={onCreate}>
          <Plus size={14} />
          {t("saveResult")}
        </button>
      </div>
      <select
        className="pw-filter"
        aria-label={t("chooseAssistant")}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      >
        <option value="">{t("allAssistants")}</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.displayName || a.name}
          </option>
        ))}
      </select>
      {!rows.length && (
        <PersonalEmpty
          icon={<FileText size={30} />}
          title={t("empty")}
          description={t("noResultsHint")}
        />
      )}
      {rows.map((artifact) => (
        <div className="pw-list-row" key={artifact.id}>
          <span className="pw-file-icon">
            <FileText size={18} />
          </span>
          <div className="pw-grow">
            <h3>{artifact.title}</h3>
            <p>
              {agents.find((a) => a.id === artifact.agentId)?.displayName ||
                agents.find((a) => a.id === artifact.agentId)?.name ||
                t("personalScope")}{" "}
              · {t("versionTag", { version: artifact.version })} ·{" "}
              {intl.formatDate(new Date(artifact.updatedAt), {
                dateStyle: "medium",
              })}
            </p>
          </div>
          <button
            type="button"
            className="pw-button"
            onClick={() => onOpen(artifact)}
          >
            {t("open")}
          </button>
        </div>
      ))}
    </div>
  );
}
export function RoutinesPage({
  onCreate,
  onEdit,
  onHistory,
  onRun,
  busy,
  agentId,
}: {
  onCreate: () => void;
  onEdit: (routine: PersonalRoutine) => void;
  onHistory: (routine: PersonalRoutine) => void;
  onRun: Run;
  busy: boolean;
  agentId?: string;
}) {
  const t = usePersonalStrings();
  const intl = useIntl();
  const routines = usePersonalWorkspaceStore((s) => s.snapshot?.routines);
  return (
    <div className="pw-page">
      <div className="pw-page-title pw-row pw-between">
        <div>
          <h1>{t("routines")}</h1>
          <p>{t("routineHint")}</p>
        </div>
        <button
          type="button"
          className="pw-button pw-primary"
          onClick={onCreate}
        >
          <Plus size={14} />
          {t("create")}
        </button>
      </div>
      {!(routines ?? []).filter((r) => !agentId || r.agentId === agentId)
        .length && (
        <PersonalEmpty icon={<Clock3 size={28} />} title={t("empty")} />
      )}
      {(routines ?? [])
        .filter((r) => !agentId || r.agentId === agentId)
        .map((routine) => (
          <div className="pw-list-row pw-routine-row" key={routine.id}>
            <span className="pw-avatar">
              <Clock3 size={16} />
            </span>
            <div className="pw-grow">
              <h3>
                {routine.title}{" "}
                <span className="pw-chip">
                  {t(routine.enabled ? "enabled" : "disabled")}
                </span>
              </h3>
              <p>
                {t(routine.schedule)} · {routine.time} · {routine.timezone}
              </p>
              {routine.enabled && (
                <p>
                  {t("nextRun")} ·{" "}
                  {intl.formatDate(new Date(routine.nextRunAt), {
                    timeZone: routine.timezone,
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              )}
              <div className="pw-actions">
                <button
                  type="button"
                  className="pw-button"
                  disabled={busy}
                  onClick={() => onEdit(routine)}
                >
                  {t("edit")}
                </button>
                <button
                  type="button"
                  className="pw-button"
                  disabled={busy}
                  onClick={() => onHistory(routine)}
                >
                  {t("history")}
                </button>
                <button
                  type="button"
                  className="pw-button"
                  disabled={busy}
                  onClick={() =>
                    void onRun(() => personalApi.toggleRoutine(routine))
                  }
                >
                  {t(routine.enabled ? "pause" : "resume")}
                </button>
              </div>
            </div>
          </div>
        ))}
      <div className="pw-notice">{t("routinePolicy")}</div>
    </div>
  );
}
const runLabels = {
  queued: "runQueued",
  dispatched: "runDispatched",
  completed: "runCompleted",
  missed: "runMissed",
  failed: "runFailed",
} as const;
const errorLabels: Record<string, WorkspaceWord> = {
  waiting_for_computer: "waitingForComputer",
  computer_offline: "waitingForComputer",
  catchup_window_expired: "catchupExpired",
  previous_run_active: "previousRunActive",
  dispatch_failed: "dispatchFailed",
  schedule_changed: "scheduleChanged",
  task_closed: "taskWasClosed",
};
export function RoutineHistoryDialog({
  routine,
  onClose,
  onRun,
  busy,
}: {
  routine: PersonalRoutine;
  onClose: () => void;
  onRun: Run;
  busy: boolean;
}) {
  const t = usePersonalStrings();
  const intl = useIntl();
  const [runs, setRuns] = useState<PersonalRoutineRun[]>([]),
    [error, setError] = useState(false),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  // oxlint-disable-next-line react-doctor/no-cascading-set-state -- Polling reconciles externally committed runs and errors atomically.
  useEffect(() => {
    let current = true;
    const load = () => {
      void personalApi
        .routineRuns(routine.id)
        .then((rows) => {
          if (current) {
            setRuns(rows);
            setError(false);
          }
        })
        .catch(() => {
          if (current) setError(true);
        });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [routine.id]);
  return (
    <DialogCard
      title={routine.title + " · " + t("history")}
      onClose={onClose}
      maxWidthClass="max-w-xl"
    >
      <div className="pw-dialog">
        <p className="pw-muted">{t("testHint")}</p>
        <button
          type="button"
          className="pw-button pw-primary"
          disabled={busy}
          onClick={() =>
            void onRun(async () => {
              await personalApi.testRoutine(routine.id, requestId);
              setRequestId(crypto.randomUUID());
              setRuns(await personalApi.routineRuns(routine.id));
            })
          }
        >
          {t("test")}
        </button>
        {error && <PersonalErrorNotice />}
        {!runs.length && <PersonalEmpty title={t("empty")} />}
        {runs.map((run) => (
          <div className="pw-detail-row" key={run.id}>
            <h3>{t(runLabels[run.status])}</h3>
            <p>
              {intl.formatDate(new Date(run.scheduledFor), {
                timeZone: routine.timezone,
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
            {run.errorCode && <p>{t(errorLabels[run.errorCode] ?? "error")}</p>}
            {run.messageId && (
              <p className="pw-meta">
                {t("source")} · {run.messageId.slice(0, 8)}
              </p>
            )}
          </div>
        ))}
      </div>
    </DialogCard>
  );
}
export type ConnectionTab =
  | "applications"
  | "localAgent"
  | "modelApi"
  | "devices"
  | "mcp";
export function ConnectionsPage({
  tab,
  onTab,
  agents,
  onAgent,
  onConnectComputer,
}: {
  tab: ConnectionTab;
  onTab: (tab: ConnectionTab) => void;
  agents: Agent[];
  onAgent: (agent: Agent) => void;
  onConnectComputer: () => void;
}) {
  const t = usePersonalStrings();
  const machines = useMachineStore((s) => s.machines);
  const loadMachines = useMachineStore((s) => s.loadMachines);
  return (
    <div className="pw-page pw-connections">
      <div className="pw-page-title">
        <h1>{t("connections")}</h1>
        <p>{t("appHint")}</p>
      </div>
      <div className="pw-tabs">
        {(
          ["applications", "localAgent", "modelApi", "devices", "mcp"] as const
        ).map((key) => (
          <button
            key={key}
            aria-current={key === tab ? "page" : undefined}
            onClick={() => onTab(key)}
          >
            {t(key)}
          </button>
        ))}
      </div>
      <Suspense fallback={<p className="pw-muted">{t("loading")}</p>}>
        {tab === "applications" && (
          <div className="pw-settings-embed">
            <IntegrationsSection />
          </div>
        )}
        {tab === "modelApi" && <ProviderConnectionsSettings />}
        {tab === "mcp" && (
          <div className="pw-settings-embed">
            <SettingsPanel tab="mcp" />
          </div>
        )}
        {tab === "localAgent" && (
          <>
            <p className="pw-muted">{t("runtimeFacts")}</p>
            {agents.map((agent) => {
              const machine = machines.find((m) => m.id === agent.machineId);
              return (
                <div key={agent.id} className="pw-list-row">
                  <span className="pw-avatar">
                    <Bot size={17} />
                  </span>
                  <div className="pw-grow">
                    <h3>{agent.displayName || agent.name}</h3>
                    <p>
                      {agent.runtime} ·{" "}
                      {machine?.hostname || machine?.name || t("unknown")}
                    </p>
                    <p>
                      {machine?.runtimeVersions?.[agent.runtime] || agent.model}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="pw-button"
                    onClick={() => onAgent(agent)}
                  >
                    {t("configure")}
                  </button>
                </div>
              );
            })}
            <div className="pw-notice">{t("localTrust")}</div>
          </>
        )}
        {tab === "devices" && (
          <>
            <div className="pw-actions">
              <button
                type="button"
                className="pw-button"
                onClick={onConnectComputer}
              >
                <Plus size={14} />
                {t("noComputer")}
              </button>
              <button
                type="button"
                className="pw-button"
                onClick={() => void loadMachines()}
              >
                <RefreshCw size={14} />
                {t("refresh")}
              </button>
            </div>
            {machines.map((machine) => (
              <div className="pw-list-row" key={machine.id}>
                <Monitor size={19} />
                <div className="pw-grow">
                  <h3>{machine.hostname || machine.name}</h3>
                  <p>
                    {t(machine.status === "online" ? "online" : "offline")} ·{" "}
                    {machine.os} · {machine.runtimes.join(" / ")}
                  </p>
                </div>
              </div>
            ))}
            <p className="pw-notice">{t("deviceHint")}</p>
          </>
        )}
      </Suspense>
    </div>
  );
}
