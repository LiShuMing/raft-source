import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useIntl } from "react-intl";
import {
  ArrowRight,
  ArrowUp,
  KeyRound,
  MessageSquare,
  Monitor,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button, Textarea } from "@botiverse/raft-ui";
import { useAgentStore } from "../../store/agentStore";
import type { Agent } from "../../store/agentStore";
import { useMachineStore } from "../../store/machineStore";
import type { Machine } from "../../store/machineStore";
import { useServerStore } from "../../store/serverStore";
import { useAuthStore } from "../../store/authStore";
import { useChannelStore } from "../../store/channelStore";
import { useMessageStore } from "../../store/messageStore";
import { useServerPermissions } from "../../hooks/useServerPermissions";
import { deliverPersonalTask, personalTaskRequest } from "./personalTask";
import type { PersonalTaskRequest } from "./personalTask";

export interface PersonalHomeProps {
  agents: Agent[];
  machines: Machine[];
  loading: boolean;
  machineError: boolean;
  canCreateAgent: boolean;
  canConnectComputer: boolean;
  onCreateAgent: () => void;
  onComputers: () => void;
  onProviders: () => void;
  onRefresh: () => void;
  onConversation: (agentId: string) => Promise<void>;
  onSubmit: (agentId: string, content: string) => Promise<void>;
}

/** Presentation boundary used by the live route and behavior tests. */
export function PersonalHomeView(props: PersonalHomeProps) {
  const { onSubmit, onConversation } = props;
  const { formatMessage: t } = useIntl();
  const [agentId, setAgentId] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const submitting = useRef(false);
  const agents = props.agents.filter(
    (agent) => !agent.deletedAt && !agent.raftbenchService,
  );
  const selected = agents.find((agent) => agent.id === agentId) ?? agents[0];
  const machine = props.machines.find(
    (item) => item.id === selected?.machineId,
  );
  const label = selected?.displayName || selected?.name;
  const location = machine?.hostname || machine?.name;
  const canSend = !!selected && !!content.trim() && !busy && !props.loading;

  const submit = useCallback(async () => {
    if (!canSend || !selected || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(false);
    try {
      await onSubmit(selected.id, content.trim());
      setContent("");
    } catch {
      setError(true);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }, [canSend, selected, content, onSubmit]);

  const openConversation = useCallback(
    async (id: string) => {
      if (submitting.current) return;
      submitting.current = true;
      setBusy(true);
      setError(false);
      try {
        await onConversation(id);
      } catch {
        setError(true);
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    },
    [onConversation],
  );

  const changeContent = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setContent(event.target.value),
    [],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        void submit();
      }
    },
    [submit],
  );
  const selectExample = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const kind = event.currentTarget.dataset.prompt;
      if (kind === "research" || kind === "files" || kind === "code")
        setContent(t({ id: `personal.prompt.${kind}` }));
    },
    [t],
  );
  const handleConversation = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.agentId;
      if (id) void openConversation(id);
    },
    [openConversation],
  );

  return (
    <main
      className="min-h-0 flex-1 overflow-y-auto bg-layer-canvas text-foreground"
      data-testid="personal-home"
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-12 md:px-10 md:py-24">
        <section aria-labelledby="personal-heading">
          <h1
            id="personal-heading"
            className="text-title font-medium md:text-3xl"
          >
            {t({ id: "personal.heading" })}
          </h1>
          <p className="mt-3 max-w-xl text-callout text-foreground-muted">
            {t({ id: "personal.subtitle" })}
          </p>
          <form
            className="mt-7 rounded-2xl border border-line-seam bg-layer-card p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="sr-only" htmlFor="personal-goal">
              {t({ id: "personal.goal" })}
            </label>
            <Textarea
              id="personal-goal"
              rows={4}
              value={content}
              onChange={changeContent}
              disabled={busy}
              placeholder={t({ id: "personal.placeholder" })}
              className="w-full resize-none border-0 bg-transparent shadow-none"
              onKeyDown={handleKeyDown}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line-seam pt-3">
              <div className="min-w-0">
                <label htmlFor="personal-agent" className="sr-only">
                  {t({ id: "personal.agent" })}
                </label>
                <select
                  id="personal-agent"
                  value={selected?.id ?? ""}
                  onChange={(event) => setAgentId(event.target.value)}
                  disabled={busy || props.loading || !agents.length}
                  className="max-w-full rounded-md border border-line-seam bg-layer-canvas px-3 py-2 text-callout"
                >
                  {!agents.length && (
                    <option value="">
                      {t({
                        id: props.loading
                          ? "personal.loading"
                          : "personal.chooseAgent",
                      })}
                    </option>
                  )}
                  {agents.map((agent) => (
                    <option value={agent.id} key={agent.id}>
                      {agent.displayName || agent.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="primary" disabled={!canSend}>
                <ArrowUp size={16} aria-hidden="true" />
                {t({ id: busy ? "personal.sending" : "personal.send" })}
              </Button>
            </div>
            {selected && (
              <p
                className="mt-3 text-caption text-foreground-muted"
                role="status"
              >
                {t(
                  {
                    id: location
                      ? machine?.status === "online"
                        ? "personal.runsOn"
                        : "personal.deviceOffline"
                      : "personal.executionUnknown",
                  },
                  { name: location ?? label },
                )}
              </p>
            )}
          </form>
          {error && (
            <p role="alert" className="mt-3 text-callout text-foreground-muted">
              {t({ id: "personal.sendError" })}
            </p>
          )}
          <div
            className="mt-5 flex flex-wrap gap-2"
            aria-label={t({ id: "personal.examples" })}
          >
            {(["research", "files", "code"] as const).map((kind) => (
              <Button
                key={kind}
                variant="ghost"
                size="sm"
                disabled={busy}
                data-prompt={kind}
                onClick={selectExample}
              >
                {t({ id: `personal.example.${kind}` })}
              </Button>
            ))}
          </div>
        </section>

        <section
          className={`mt-10${agents.length ? " md:hidden" : ""}`}
          aria-labelledby="personal-agents-heading"
        >
          <div className="flex items-center justify-between gap-4 border-b border-line-seam pb-3">
            <h2 id="personal-agents-heading" className="text-headline">
              {t({ id: "personal.agents" })}
            </h2>
            {props.canCreateAgent && (
              <Button
                variant="ghost"
                size="sm"
                onClick={props.onCreateAgent}
                disabled={busy}
              >
                <Plus size={14} aria-hidden="true" />
                {t({ id: "personal.addAgent" })}
              </Button>
            )}
          </div>
          {props.loading ? (
            <p
              className="py-6 text-callout text-foreground-muted"
              role="status"
            >
              {t({ id: "personal.loading" })}
            </p>
          ) : agents.length === 0 ? (
            <div className="py-6">
              <p className="text-callout text-foreground-muted">
                {t({ id: "personal.empty" })}
              </p>
              {props.canCreateAgent && (
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={props.onCreateAgent}
                >
                  {t({ id: "personal.addAgent" })}
                  <ArrowRight size={14} aria-hidden="true" />
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-line-seam">
              {agents.map((agent) => {
                const host = props.machines.find(
                  (item) => item.id === agent.machineId,
                );
                return (
                  <li
                    key={agent.id}
                    className="flex items-center justify-between gap-4 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-callout font-medium">
                        {agent.displayName || agent.name}
                      </p>
                      <p className="mt-1 truncate text-caption text-foreground-muted">
                        {agent.runtime} ·{" "}
                        {host?.hostname ||
                          host?.name ||
                          t({ id: "personal.managedElsewhere" })}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      data-agent-id={agent.id}
                      onClick={handleConversation}
                    >
                      <MessageSquare size={15} aria-hidden="true" />
                      {t({ id: "personal.continue" })}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <details className="mt-10 text-foreground-muted">
          <summary className="w-fit cursor-pointer text-caption">
            {t({ id: "personal.details" })}
          </summary>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="ghost" size="sm" onClick={props.onComputers}>
              <Monitor size={16} aria-hidden="true" />
              {t({
                id: props.canConnectComputer
                  ? "personal.computers"
                  : "personal.viewComputers",
              })}
            </Button>
            <Button variant="ghost" size="sm" onClick={props.onProviders}>
              <KeyRound size={16} aria-hidden="true" />
              {t({ id: "personal.providers" })}
            </Button>
            {agents.length > 0 && props.canCreateAgent && (
              <Button variant="ghost" size="sm" onClick={props.onCreateAgent}>
                <Plus size={14} aria-hidden="true" />
                {t({ id: "personal.addAgent" })}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onRefresh}
              disabled={busy || props.loading}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {t({ id: "personal.refresh" })}
            </Button>
          </div>
          <p className="mt-3 text-caption text-foreground-muted">
            {t({ id: "personal.setupHint" })}
          </p>
          <p className="mt-2 text-caption text-foreground-muted">
            {t({ id: "personal.receiptHint" })}
          </p>
          {props.machineError && (
            <p role="alert" className="mt-2 text-caption text-foreground-muted">
              {t({ id: "personal.deviceError" })}
            </p>
          )}
        </details>
      </div>
    </main>
  );
}

export default function PersonalHome() {
  const agents = useAgentStore((state) => state.agents);
  const loading = useAgentStore((state) => state.loading);
  const machines = useMachineStore((state) => state.machines);
  const machineError = useMachineStore((state) => state.loadError);
  const server = useServerStore((state) => state.current);
  const { capabilities } = useServerPermissions();
  const navigate = useNavigate();
  const request = useRef<PersonalTaskRequest | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    void useAgentStore.getState().loadAgents();
    void useMachineStore.getState().loadMachines();
  }, []);
  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const currentScope = useCallback(() => {
    const epoch = useServerStore.getState().serverEpoch;
    const userId = useAuthStore.getState().user?.id;
    return () =>
      mounted.current &&
      useServerStore.getState().current?.id === server?.id &&
      useServerStore.getState().serverEpoch === epoch &&
      useAuthStore.getState().user?.id === userId;
  }, [server?.id]);
  const base = `/s/${server?.slug}`;
  const createAgent = useCallback(
    () => useAgentStore.getState().setShowCreateAgent(true),
    [],
  );
  const openComputers = useCallback(
    () => navigate(`${base}/computers`),
    [base, navigate],
  );
  const openProviders = useCallback(
    () => navigate(`${base}/settings/providers`),
    [base, navigate],
  );
  const continueConversation = useCallback(
    async (agentId: string) => {
      const isCurrent = currentScope();
      const channel = await useChannelStore.getState().openDM(agentId);
      if (isCurrent()) navigate(`${base}/dm/${channel.id}`);
    },
    [base, currentScope, navigate],
  );
  const sendTask = useCallback(
    async (agentId: string, content: string) => {
      const pending = personalTaskRequest(
        request.current,
        agentId,
        content,
        () => crypto.randomUUID(),
      );
      request.current = pending;
      const channelId = await deliverPersonalTask(pending, {
        isCurrent: currentScope(),
        openDM: (id) => useChannelStore.getState().openDM(id),
        send: (id, text, randomId) =>
          useMessageStore
            .getState()
            .sendMessage(id, text, undefined, true, undefined, randomId),
      });
      if (channelId) {
        request.current = null;
        navigate(`${base}/dm/${channelId}`);
      }
    },
    [base, currentScope, navigate],
  );

  return (
    <PersonalHomeView
      agents={agents}
      machines={machines}
      loading={loading}
      machineError={machineError}
      canCreateAgent={capabilities.createAgents}
      canConnectComputer={capabilities.registerMachines}
      onCreateAgent={createAgent}
      onComputers={openComputers}
      onProviders={openProviders}
      onRefresh={refresh}
      onConversation={continueConversation}
      onSubmit={sendTask}
    />
  );
}
