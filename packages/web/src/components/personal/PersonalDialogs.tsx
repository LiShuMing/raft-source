import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useIntl } from "react-intl";
import type {
  PersonalArtifact,
  PersonalDraft,
  PersonalResource,
  PersonalRoutine,
} from "@botiverse/raft-shared";
import type { Agent } from "../../store/agentStore";
import type { Channel } from "../../store/channelStore";
import type { Message } from "../../store/messageStore";
import { PersonalDialog as DialogCard } from "./PersonalUi";
import { personalApi } from "../../store/personalWorkspaceStore";
import { usePersonalStrings } from "./usePersonalStrings";

type CommonProps = { onClose: () => void; onSaved: () => void };
function Field({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="pw-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
function useSubmission(onSaved: () => void) {
  const t = usePersonalStrings();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const inFlight = useRef(false);
  const submit = async (work: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
      onSaved();
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      setError(t(status === 409 ? "conflict" : "error"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { busy, error, submit };
}
function FormActions({
  busy,
  error,
  onClose,
  label,
}: {
  busy: boolean;
  error: string;
  onClose: () => void;
  label: string;
}) {
  const t = usePersonalStrings();
  return (
    <>
      <div className="pw-form-error" role={error ? "alert" : undefined}>
        {error}
      </div>
      <div className="pw-dialog-actions">
        <button
          type="button"
          className="pw-button"
          disabled={busy}
          onClick={onClose}
        >
          {t("cancel")}
        </button>
        <button className="pw-button pw-primary" type="submit" disabled={busy}>
          {busy ? t("loading") : label}
        </button>
      </div>
    </>
  );
}
export function ResourceDialog({
  resource,
  kind,
  agentId,
  initialContent,
  ...common
}: CommonProps & {
  resource?: PersonalResource;
  kind: "memory" | "skill";
  agentId: string | null;
  initialContent?: string;
}) {
  const t = usePersonalStrings();
  const [id] = useState(() => resource?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(resource?.title ?? "");
  const [content, setContent] = useState(
    resource?.content ??
      initialContent ??
      (kind === "skill" ? t("skillTemplate") : ""),
  );
  const [enabled, setEnabled] = useState(resource?.enabled ?? true),
    [global, setGlobal] = useState(resource ? !resource.agentId : false);
  const { busy, error, submit } = useSubmission(common.onSaved);
  const save = (event: FormEvent) => {
    event.preventDefault();
    void submit(() =>
      personalApi.saveResource({
        id,
        kind,
        agentId: global ? null : agentId,
        title: title.trim(),
        content: content.trim(),
        enabled,
        sourceMessageId: resource?.sourceMessageId ?? null,
        version: resource?.version,
      }),
    );
  };
  return (
    <DialogCard
      title={t(kind === "memory" ? "addMemory" : "addSkill")}
      onClose={common.onClose}
      maxWidthClass="max-w-xl"
    >
      <form className="pw-dialog" onSubmit={save}>
        <p className="pw-muted">
          {t(kind === "memory" ? "memoryHint" : "resourceHint")}
        </p>
        <Field label={t("title")} htmlFor="pw-resource-title">
          <input
            id="pw-resource-title"
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </Field>
        <Field label={t("content")} htmlFor="pw-resource-content">
          <textarea
            id="pw-resource-content"
            value={content}
            rows={7}
            maxLength={16000}
            onChange={(e) => setContent(e.target.value)}
            required
          />
        </Field>
        {!resource && (
          <Field label={t("scope")} htmlFor="pw-resource-scope">
            <select
              id="pw-resource-scope"
              value={global ? "global" : "agent"}
              onChange={(e) => setGlobal(e.target.value === "global")}
            >
              <option value="agent">{t("assistantScope")}</option>
              <option value="global">{t("personalScope")}</option>
            </select>
          </Field>
        )}
        <label className="pw-check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t("enabled")}
        </label>
        <FormActions
          {...{ busy, error }}
          onClose={common.onClose}
          label={t("save")}
        />
      </form>
    </DialogCard>
  );
}
export function ArtifactDialog({
  artifact,
  channel,
  agentId,
  messages,
  ...common
}: CommonProps & {
  artifact?: PersonalArtifact;
  channel: Channel;
  agentId: string | null;
  messages: Message[];
}) {
  const t = usePersonalStrings();
  const [id] = useState(() => artifact?.id ?? crypto.randomUUID());
  const choices = messages
    .filter((m) => m.messageType !== "system" && m.content.trim())
    .slice(-30)
    .reverse();
  const [source, setSource] = useState(
    choices.find((m) => m.senderType === "agent")?.id ?? "",
  );
  const [title, setTitle] = useState(artifact?.title ?? ""),
    [content, setContent] = useState("");
  const { busy, error, submit } = useSubmission(common.onSaved);
  return (
    <DialogCard
      title={t(artifact ? "newVersion" : "resultTitle")}
      onClose={common.onClose}
      maxWidthClass="max-w-xl"
    >
      <form
        className="pw-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(() =>
            personalApi.saveArtifact({
              id,
              channelId: channel.id,
              agentId,
              title,
              sourceMessageId: source || null,
              ...(source ? {} : { content }),
              version: artifact?.version,
            }),
          );
        }}
      >
        <p className="pw-muted">{t("resultHint")}</p>
        <Field label={t("title")} htmlFor="pw-artifact-title">
          <input
            id="pw-artifact-title"
            required
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={t("sourceReply")} htmlFor="pw-artifact-source">
          <select
            id="pw-artifact-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">{t("manualResult")}</option>
            {choices.map((m) => (
              <option key={m.id} value={m.id}>
                {(m.senderName || m.senderType) +
                  " · " +
                  m.content.replace(/\s+/g, " ").slice(0, 100)}
              </option>
            ))}
          </select>
        </Field>
        {source ? (
          <div className="pw-source-preview">
            {choices.find((m) => m.id === source)?.content}
          </div>
        ) : (
          <Field label={t("content")} htmlFor="pw-artifact-content">
            <textarea
              id="pw-artifact-content"
              required
              rows={8}
              maxLength={250000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </Field>
        )}
        <FormActions
          {...{ busy, error }}
          onClose={common.onClose}
          label={t("save")}
        />
      </form>
    </DialogCard>
  );
}
export function RoutineDialog({
  routine,
  agents,
  channelId,
  agentId,
  skills,
  ...common
}: CommonProps & {
  routine?: PersonalRoutine;
  agents: Agent[];
  channelId: string;
  agentId: string;
  skills: PersonalResource[];
}) {
  const t = usePersonalStrings();
  const intl = useIntl();
  const [id] = useState(() => routine?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(routine?.title ?? ""),
    [instruction, setInstruction] = useState(routine?.instruction ?? "");
  const [owner, setOwner] = useState(routine?.agentId ?? agentId),
    [schedule, setSchedule] = useState<PersonalRoutine["schedule"]>(
      routine?.schedule ?? "weekdays",
    );
  const [time, setTime] = useState(routine?.time ?? "09:00"),
    [timezone, setTimezone] = useState(
      routine?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  const [weekday, setWeekday] = useState(routine?.weekday ?? 2),
    [skillId, setSkillId] = useState(routine?.skillId ?? "");
  const planKey = JSON.stringify([schedule, time, timezone, weekday]);
  const [preview, setPreview] = useState<{
    key: string;
    dates: string[];
    error: boolean;
  } | null>(null);
  const dates = preview?.key === planKey ? preview.dates : [];
  const previewError = preview?.key === planKey && preview.error;
  const { busy, error, submit } = useSubmission(common.onSaved);
  useEffect(() => {
    let current = true;
    void personalApi
      .preview({ schedule, time, timezone, weekday })
      .then((value) => {
        if (current) setPreview({ key: planKey, dates: value, error: false });
      })
      .catch(() => {
        if (current) setPreview({ key: planKey, dates: [], error: true });
      });
    return () => {
      current = false;
    };
  }, [planKey, schedule, time, timezone, weekday]);
  const execution = agents.find((a) => a.id === owner);
  const launchable = !!execution?.machineId && !execution.external;
  return (
    <DialogCard
      title={t("newRoutine")}
      onClose={common.onClose}
      maxWidthClass="max-w-xl"
    >
      <form
        className="pw-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(async () => {
            // Opening an existing DM is idempotent and preserves the selected owner's identity.
            const { useChannelStore } = await import(
              "../../store/channelStore"
            );
            const target =
              routine?.agentId === owner
                ? routine.channelId
                : (await useChannelStore.getState().openDM(owner)).id;
            return personalApi.saveRoutine({
              id,
              agentId: owner,
              channelId: target || channelId,
              title,
              instruction,
              schedule,
              time,
              timezone,
              weekday,
              skillId: skillId || null,
              enabled: routine?.enabled ?? true,
              version: routine?.version,
            });
          });
        }}
      >
        <p className="pw-muted">{t("routineHint")}</p>
        <Field label={t("title")} htmlFor="pw-routine-title">
          <input
            id="pw-routine-title"
            required
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={t("chooseAssistant")} htmlFor="pw-routine-agent">
          <select
            id="pw-routine-agent"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName || a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("instruction")} htmlFor="pw-routine-instruction">
          <textarea
            id="pw-routine-instruction"
            rows={4}
            required
            maxLength={24000}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </Field>
        <div className="pw-form-row">
          <Field label={t("repeat")} htmlFor="pw-repeat">
            <select
              id="pw-repeat"
              value={schedule}
              onChange={(e) =>
                setSchedule(e.target.value as PersonalRoutine["schedule"])
              }
            >
              {(["daily", "weekdays", "weekly"] as const).map((key) => (
                <option value={key} key={key}>
                  {t(key)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("time")} htmlFor="pw-time">
            <input
              id="pw-time"
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>
        {schedule === "weekly" && (
          <Field label={t("weekday")} htmlFor="pw-weekday">
            <select
              id="pw-weekday"
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
            >
              {Array.from({ length: 7 }, (_, i) => (
                <option key={i} value={i}>
                  {intl.formatDate(new Date(Date.UTC(2026, 9, 25 + i, 12)), {
                    weekday: "long",
                    timeZone: "UTC",
                  })}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t("timezone")} htmlFor="pw-timezone">
          <input
            id="pw-timezone"
            required
            list="pw-timezones"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
          <datalist id="pw-timezones">
            {[
              "Asia/Shanghai",
              "UTC",
              "America/Los_Angeles",
              "Europe/London",
            ].map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </Field>
        {skills.length > 0 && (
          <Field label={t("skill")} htmlFor="pw-routine-skill">
            <select
              id="pw-routine-skill"
              value={skillId}
              onChange={(e) => setSkillId(e.target.value)}
            >
              <option value="">—</option>
              {skills
                .filter((s) => !s.agentId || s.agentId === owner)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} · {t("versionTag", { version: s.version })}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <div className="pw-notice">
          <strong>{t("nextRuns")}</strong>
          {previewError ? (
            <p>{t("error")}</p>
          ) : (
            dates.map((date) => (
              <div key={date}>
                {intl.formatDate(new Date(date), {
                  timeZone: timezone,
                  dateStyle: "medium",
                })}{" "}
                · {time} · {timezone}
              </div>
            ))
          )}
        </div>
        <p className="pw-muted">{t("routinePolicy")}</p>
        {!launchable && (
          <p role="alert" className="pw-notice">
            {t("routineUnavailable")}
          </p>
        )}
        <FormActions
          busy={busy || !launchable || !dates.length}
          error={error}
          onClose={common.onClose}
          label={t("save")}
        />
      </form>
    </DialogCard>
  );
}
export function DraftDialog({
  draft,
  channel,
  conversations,
  ...common
}: CommonProps & {
  draft?: PersonalDraft;
  channel: Channel;
  conversations: Channel[];
}) {
  const t = usePersonalStrings();
  const [id] = useState(() => draft?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(draft?.title ?? ""),
    [content, setContent] = useState(draft?.content ?? "");
  const [target, setTarget] = useState(draft?.targetChannelId ?? channel.id);
  const { busy, error, submit } = useSubmission(common.onSaved);
  return (
    <DialogCard
      title={t("newDraft")}
      onClose={common.onClose}
      maxWidthClass="max-w-xl"
    >
      <form
        className="pw-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(() =>
            personalApi.saveDraft({
              id,
              channelId: channel.id,
              targetChannelId: target,
              title,
              content,
              version: draft?.version,
            }),
          );
        }}
      >
        <p className="pw-muted">{t("draftHint")}</p>
        <Field label={t("title")} htmlFor="pw-draft-title">
          <input
            id="pw-draft-title"
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={t("target")} htmlFor="pw-draft-target">
          <select
            id="pw-draft-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {conversations.map((c) => (
              <option value={c.id} key={c.id}>
                {c.peerDisplayName || c.peerName || c.description || c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("content")} htmlFor="pw-draft-content">
          <textarea
            id="pw-draft-content"
            rows={7}
            required
            value={content}
            maxLength={250000}
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
        <p className="pw-muted">{t("draftAfterEdit")}</p>
        <FormActions
          {...{ busy, error }}
          onClose={common.onClose}
          label={t("saveDraft")}
        />
      </form>
    </DialogCard>
  );
}
export function GroupDialog({
  agents,
  onCreated,
  ...common
}: CommonProps & { agents: Agent[]; onCreated: (channelId: string) => void }) {
  const t = usePersonalStrings();
  const [id] = useState(() => crypto.randomUUID()),
    [title, setTitle] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const { busy, error, submit } = useSubmission(common.onSaved);
  return (
    <DialogCard title={t("newGroup")} onClose={common.onClose}>
      <form
        className="pw-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(async () => {
            const { group } = await personalApi.createGroup({
              id,
              title,
              agentIds: selected,
            });
            onCreated(group.channelId);
          });
        }}
      >
        <p className="pw-muted">{t("createGroupHint")}</p>
        <Field label={t("groupTitle")} htmlFor="pw-group-title">
          <input
            id="pw-group-title"
            value={title}
            required
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <fieldset>
          <legend>{t("groupMembers")}</legend>
          {agents.map((a) => (
            <label className="pw-check" key={a.id}>
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, a.id]
                      : selected.filter((id) => id !== a.id),
                  )
                }
              />
              {a.displayName || a.name}
            </label>
          ))}
        </fieldset>
        <FormActions
          busy={busy || selected.length < 2 || selected.length > 6}
          error={error}
          onClose={common.onClose}
          label={t("create")}
        />
      </form>
    </DialogCard>
  );
}
