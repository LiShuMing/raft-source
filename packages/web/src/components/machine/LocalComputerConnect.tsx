import { useCallback, useEffect, useState } from "react";
import { Button } from "@botiverse/raft-ui";
import { useIntl } from "react-intl";
import api from "../../api/client";
import { useMachineStore } from "../../store/machineStore";
import Banner from "../ui/Banner";

interface LocalComputerStatus {
  hostname: string;
  platform: string;
  machineId: string | null;
  state: "offline" | "starting" | "online" | "failed";
  error: string | null;
}

export default function LocalComputerConnect({ serverId }: { serverId: string }) {
  return <LocalComputerConnection key={serverId} serverId={serverId} />;
}

function LocalComputerConnection({ serverId }: { serverId: string }) {
  const { formatMessage } = useIntl();
  const [status, setStatus] = useState<LocalComputerStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      let delay = 5000;
      try {
        const { data } = await api.get<LocalComputerStatus>(`/servers/${serverId}/local-computer`, { headers: { "X-Server-Id": serverId } });
        if (cancelled) return;
        setStatus(data);
        setStatusError("");
        delay = data.state === "starting" ? 1500 : 5000;
      } catch (err: any) {
        if (!cancelled) setStatusError(err.response?.data?.error || formatMessage({ id: "machine.local.statusFailed" }));
      } finally {
        if (!cancelled) timer = setTimeout(() => { void refresh(); }, delay);
      }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [serverId, formatMessage]);

  const connect = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    setError("");
    try {
      const { data } = await api.post<LocalComputerStatus>(`/servers/${serverId}/local-computer`, undefined, { headers: { "X-Server-Id": serverId } });
      setStatus(data);
      await useMachineStore.getState().loadMachines();
    } catch (err: any) {
      setError(err.response?.data?.error || formatMessage({ id: "machine.local.connectFailed" }));
    } finally { setConnecting(false); }
  }, [connecting, serverId, formatMessage]);

  return (
    <div className="space-y-3" data-testid="local-computer-connect">
      <p className="text-callout text-foreground-muted">{formatMessage({ id: "machine.local.description" })}</p>
      {status ? <p className="text-footnote text-foreground-muted">{status.hostname} · {status.platform}</p> : null}
      {error || statusError || status?.error ? <Banner intent="warning">{error || statusError || status?.error}</Banner> : null}
      <Button
        variant="accent"
        size="lg"
        disabled={connecting || status?.state === "online" || status?.state === "starting"}
        onClick={connect}
      >
        {formatMessage({ id: connecting || status?.state === "starting"
          ? "machine.local.connecting" : status?.state === "online" ? "machine.local.connected" : "machine.local.connect" })}
      </Button>
    </div>
  );
}
