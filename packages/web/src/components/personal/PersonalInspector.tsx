import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  X,
  Download,
  FileText,
  BookOpen,
  Clock3,
  Monitor,
  Plus,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import type {
  PersonalArtifact,
  PersonalArtifactRevision,
  PersonalResource,
  PersonalRoutine,
} from "@botiverse/raft-shared";
import { useAgentDisplayState } from "../../store/agentStore";
import type { Agent } from "../../store/agentStore";
import type { Channel } from "../../store/channelStore";
import { useMachineStore } from "../../store/machineStore";
import {
  personalApi,
  usePersonalWorkspaceStore,
} from "../../store/personalWorkspaceStore";
import { formatAgentDisplayStateText } from "../../utils/activity";
import { PersonalEmpty, PersonalErrorNotice } from "./PersonalUi";
import { usePersonalStrings } from "./usePersonalStrings";
const AgentWorkspace = lazy(() => import("../agent/AgentWorkspace"));
const AgentSkills = lazy(() => import("../agent/AgentSkills"));
const AgentActivityLog = lazy(() => import("../agent/AgentActivityLog"));
const ChannelFilesPanel = lazy(() => import("../message/ChannelFilesPanel"));
const MARKDOWN_PLUGINS = [remarkGfm];
export type PersonalPanel =
  | { kind: "artifact"; id: string }
  | { kind: "computer" }
  | { kind: "profile" };
export type PersonalProfileTab =
  | "role"
  | "memory"
  | "skills"
  | "routines"
  | "files"
  | "activity";
interface Props {
  panel: PersonalPanel;
  agent: Agent | undefined;
  channel: Channel | null;
  tab: PersonalProfileTab;
  onTab: (tab: PersonalProfileTab) => void;
  onClose: () => void;
  onConfigure: (agent: Agent) => void;
  onResource: (
    kind: "memory" | "skill",
    resource?: PersonalResource,
    initialContent?: string,
  ) => void;
  onArtifactEdit: (artifact: PersonalArtifact) => void;
  onRoutine: (routine?: PersonalRoutine) => void;
  onUseSkill: (resource: PersonalResource) => void;
  onOpenChannel: (channelId: string, messageId?: string) => void;
  onRun: (work: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}

function ArtifactPreview({
  artifact,
  onEdit,
  onSkill,
  onRoutine,
  onOpenChannel,
}: {
  artifact: PersonalArtifact;
  onEdit: () => void;
  onSkill: (text: string) => void;
  onRoutine: () => void;
  onOpenChannel: (messageId?: string) => void;
}) {
  const t = usePersonalStrings();
  const intl = useIntl();
  const [revisions, setRevisions] = useState<PersonalArtifactRevision[]>([]),
    [selected, setSelected] = useState<number | null>(null),
    [error, setError] = useState(false);
  // oxlint-disable-next-line react-doctor/no-cascading-set-state -- Immutable revision contents arrive from a cancellable server request.
  useEffect(() => {
    let current = true;
    void personalApi
      .revisions(artifact.id)
      .then((data) => {
        if (current) {
          setRevisions(data.revisions);
          setError(false);
        }
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [artifact.id, artifact.version]);
  const revision =
    revisions.find((r) => r.revision === selected) ?? revisions[0];
  const exportDocument = () => {
    if (!revision) return;
    const url = URL.createObjectURL(
      new Blob([revision.content], { type: "text/markdown;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${artifact.title.replace(/[\\/:*?"<>|]/g, "_")}-v${revision.revision}.md`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      {error ? (
        <PersonalErrorNotice />
      ) : (
        <>
          <div className="pw-row pw-between">
            <span className="pw-eyebrow">{t("result")}</span>
            <select
              className="pw-version"
              aria-label={t("selectVersion")}
              value={revision?.revision ?? ""}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {revisions.map((r) => (
                <option value={r.revision} key={r.revision}>
                  {t("versionTag", { version: r.revision })}
                </option>
              ))}
            </select>
          </div>
          <article className="pw-document">
            <h1>{artifact.title}</h1>
            {revision ? (
              <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>
                {revision.content}
              </ReactMarkdown>
            ) : (
              <p>{t("loading")}</p>
            )}
          </article>
          <dl className="pw-metadata">
            <dt>{t("source")}</dt>
            <dd>
              {revision?.sourceMessageId ? (
                <button
                  onClick={() => onOpenChannel(revision.sourceMessageId!)}
                >
                  {t("fromMessage")} <ExternalLink size={11} />
                </button>
              ) : (
                t("manualSource")
              )}
            </dd>
            <dt>{t("createdAt")}</dt>
            <dd>
              {intl.formatDate(
                new Date(revision?.createdAt ?? artifact.createdAt),
                { dateStyle: "medium", timeStyle: "short" },
              )}
            </dd>
            <dt>{t("scope")}</dt>
            <dd>{t("privateLibrary")}</dd>
          </dl>
          <div className="pw-actions">
            <button
              type="button"
              className="pw-button"
              onClick={exportDocument}
              disabled={!revision}
            >
              <Download size={13} />
              {t("export")}
            </button>
            <button type="button" className="pw-button" onClick={onEdit}>
              <FileText size={13} />
              {t("newVersion")}
            </button>
            <button
              type="button"
              className="pw-button"
              onClick={() => revision && onSkill(revision.content)}
              disabled={!revision}
            >
              <BookOpen size={13} />
              {t("saveSkill")}
            </button>
            <button type="button" className="pw-button" onClick={onRoutine}>
              <Clock3 size={13} />
              {t("newRoutine")}
            </button>
          </div>
        </>
      )}
    </>
  );
}
export default function PersonalInspector(props: Props) {
  const { panel, agent, channel, tab } = props;
  const t = usePersonalStrings();
  const intl = useIntl();
  const snapshot = usePersonalWorkspaceStore((s) => s.snapshot);
  const machines = useMachineStore((s) => s.machines);
  const displayState = useAgentDisplayState(agent?.id ?? "");
  const machine = machines.find((m) => m.id === agent?.machineId);
  const resources =
    snapshot?.resources.filter((r) => !r.agentId || r.agentId === agent?.id) ??
    [];
  const artifact =
    panel.kind === "artifact"
      ? snapshot?.artifacts.find((a) => a.id === panel.id)
      : undefined;
  const pendingRoutines =
    snapshot?.routines.filter((r) => r.agentId === agent?.id) ?? [];
  const editPreview = useCallback(() => {
    if (artifact) props.onArtifactEdit(artifact);
  }, [artifact, props]);
  const skillFromPreview = useCallback(
    (text: string) => props.onResource("skill", undefined, text),
    [props],
  );
  const routineFromPreview = useCallback(() => props.onRoutine(), [props]);
  const sourceFromPreview = useCallback(
    (messageId?: string) => {
      if (artifact) props.onOpenChannel(artifact.channelId, messageId);
    },
    [artifact, props],
  );
  return (
    <aside
      className="pw-inspector"
      aria-label={t("details")}
      data-testid="personal-inspector"
    >
      <header>
        <h2>
          {t(
            panel.kind === "artifact"
              ? "preview"
              : panel.kind === "computer"
                ? "workspace"
                : "profile",
          )}
        </h2>
        <button
          className="pw-icon"
          aria-label={t("close")}
          onClick={props.onClose}
        >
          <X size={17} />
        </button>
      </header>
      <div className="pw-inspector-content">
        <Suspense fallback={<p className="pw-muted">{t("loading")}</p>}>
          {panel.kind === "artifact" &&
            (artifact ? (
              <ArtifactPreview
                key={artifact.id}
                {...{ artifact }}
                onEdit={editPreview}
                onSkill={skillFromPreview}
                onRoutine={routineFromPreview}
                onOpenChannel={sourceFromPreview}
              />
            ) : (
              <PersonalEmpty title={t("empty")} />
            ))}
          {panel.kind === "computer" && (
            <>
              <span className="pw-eyebrow">{t("thisComputer")}</span>
              <h2 className="pw-environment-name">
                {machine?.hostname || machine?.name || t("noEnvironment")}
              </h2>
              <p className="pw-muted">
                {agent?.runtime} ·{" "}
                {machine
                  ? t(machine.status === "online" ? "online" : "offline")
                  : t("unknown")}
              </p>
              <div className="pw-notice">
                {formatAgentDisplayStateText(intl, displayState)}
              </div>
              <p className="pw-muted">{t("localTrust")}</p>
              <p className="pw-notice">{t("browserUnavailable")}</p>
              <h3 className="pw-section-title">{t("files")}</h3>
              {agent && !agent.external ? (
                <AgentWorkspace agentId={agent.id} compact />
              ) : channel ? (
                <ChannelFilesPanel channel={channel} />
              ) : (
                <PersonalEmpty title={t("noEnvironment")} />
              )}
              <p className="pw-meta">{t("deviceHint")}</p>
            </>
          )}
          {panel.kind === "profile" && (
            <>
              <div className="pw-tabs pw-wrap-tabs">
                {(
                  [
                    "role",
                    "memory",
                    "skills",
                    "routines",
                    "files",
                    "activity",
                  ] as const
                ).map((key) => (
                  <button
                    key={key}
                    aria-current={tab === key ? "page" : undefined}
                    onClick={() => props.onTab(key)}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
              {tab === "role" && (
                <>
                  <div className="pw-row">
                    <span className="pw-avatar">
                      {(agent?.displayName || agent?.name || "").slice(0, 1)}
                    </span>
                    <div>
                      <h2>{agent?.displayName || agent?.name}</h2>
                      <p className="pw-meta">{agent?.runtime}</p>
                    </div>
                  </div>
                  <h3 className="pw-section-title">{t("responsibilities")}</h3>
                  <p>{agent?.description || t("roleHint")}</p>
                  <h3 className="pw-section-title">{t("execution")}</h3>
                  <div className="pw-detail-row">
                    <Monitor size={16} />{" "}
                    {machine?.hostname || machine?.name || t("unknown")}
                    <p>
                      {agent?.runtime} · {agent?.model}
                    </p>
                  </div>
                  <div className="pw-actions">
                    {agent && (
                      <button
                        type="button"
                        className="pw-button"
                        onClick={() => props.onConfigure(agent)}
                      >
                        {t("configure")}
                      </button>
                    )}
                  </div>
                  <p className="pw-meta">{t("preferencesHint")}</p>
                </>
              )}
              {(tab === "memory" || tab === "skills") && (
                <>
                  <p className="pw-muted">
                    {t(tab === "memory" ? "memoryHint" : "skillsHint")}
                  </p>
                  <div className="pw-actions">
                    <button
                      type="button"
                      className="pw-button"
                      onClick={() =>
                        props.onResource(tab === "memory" ? "memory" : "skill")
                      }
                    >
                      <Plus size={14} />
                      {t(tab === "memory" ? "addMemory" : "addSkill")}
                    </button>
                  </div>
                  {!resources.some(
                    (r) => r.kind === (tab === "memory" ? "memory" : "skill"),
                  ) && (
                    <PersonalEmpty
                      title={t(
                        tab === "memory" ? "emptyMemory" : "emptySkills",
                      )}
                    />
                  )}
                  {resources
                    .filter(
                      (r) => r.kind === (tab === "memory" ? "memory" : "skill"),
                    )
                    .map((resource) => (
                      <div className="pw-detail-row" key={resource.id}>
                        <h3>
                          {resource.title}{" "}
                          <span className="pw-chip">
                            {t("versionTag", { version: resource.version })} ·{" "}
                            {t(resource.enabled ? "enabled" : "disabled")}
                          </span>
                        </h3>
                        <p className="pw-resource-content">
                          {resource.content}
                        </p>
                        <p className="pw-meta">
                          {t(
                            resource.agentId
                              ? "assistantScope"
                              : "personalScope",
                          )}
                        </p>
                        <div className="pw-actions">
                          <button
                            type="button"
                            className="pw-button"
                            onClick={() =>
                              props.onResource(resource.kind, resource)
                            }
                          >
                            {t("edit")}
                          </button>
                          <button
                            type="button"
                            className="pw-button"
                            disabled={props.busy}
                            onClick={() =>
                              void props.onRun(() =>
                                personalApi.toggleResource(resource),
                              )
                            }
                          >
                            {t(resource.enabled ? "pause" : "resume")}
                          </button>
                          {resource.kind === "skill" && resource.enabled && (
                            <button
                              type="button"
                              className="pw-button"
                              onClick={() => props.onUseSkill(resource)}
                            >
                              {t("useSkill")}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  {tab === "skills" && agent && !agent.external && (
                    <AgentSkills agentId={agent.id} embedded />
                  )}
                </>
              )}
              {tab === "routines" && (
                <>
                  <button
                    type="button"
                    className="pw-button"
                    onClick={() => props.onRoutine()}
                  >
                    <Plus size={14} />
                    {t("newRoutine")}
                  </button>
                  {!pendingRoutines.length && (
                    <PersonalEmpty title={t("empty")} />
                  )}
                  {pendingRoutines.map((routine) => (
                    <div className="pw-detail-row" key={routine.id}>
                      <h3>{routine.title}</h3>
                      <p>
                        {routine.time} · {routine.timezone} ·{" "}
                        {t(routine.enabled ? "enabled" : "disabled")}
                      </p>
                      <div className="pw-actions">
                        <button
                          type="button"
                          className="pw-button"
                          onClick={() => props.onRoutine(routine)}
                        >
                          {t("edit")}
                        </button>
                        <button
                          type="button"
                          className="pw-button"
                          disabled={props.busy}
                          onClick={() =>
                            void props.onRun(() =>
                              personalApi.toggleRoutine(routine),
                            )
                          }
                        >
                          {t(routine.enabled ? "pause" : "resume")}
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {tab === "files" &&
                (channel ? (
                  <ChannelFilesPanel channel={channel} />
                ) : (
                  <PersonalEmpty title={t("empty")} />
                ))}
              {tab === "activity" && agent && (
                <>
                  <button
                    type="button"
                    className="pw-button"
                    onClick={() =>
                      void props.onRun(async () => {
                        const { useAgentStore } = await import(
                          "../../store/agentStore"
                        );
                        await useAgentStore.getState().loadAgents();
                      })
                    }
                  >
                    <RefreshCw size={13} />
                    {t("refresh")}
                  </button>
                  <AgentActivityLog
                    agentId={agent.id}
                    machineId={agent.machineId}
                  />
                </>
              )}
            </>
          )}
        </Suspense>
      </div>
    </aside>
  );
}
