import { useEffect, useState } from "react";
import { Button, Input } from "@botiverse/raft-ui";
import api from "../../api/client";
import { useMachineStore } from "../../store/machineStore";
import Banner from "../ui/Banner";
import FormField from "../ui/FormField";

interface RemoteSetup {
  ready: boolean;
  serverSlug: string;
  port: number;
  filename?: string;
  platform?: string;
  arch?: string;
  nodeMajor?: number;
  sha256?: string;
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export default function RemoteComputerConnect({ serverId }: { serverId: string }) {
  const [setup, setSetup] = useState<RemoteSetup | null>(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [origin, setOrigin] = useState("http://127.0.0.1:15280");
  const [name, setName] = useState("dev-b");
  const machines = useMachineStore((state) => state.machines);
  const machine = machines.find((candidate) => candidate.name === name.trim());
  useEffect(() => {
    let cancelled = false;
    void api.get<RemoteSetup>(`/servers/${serverId}/remote-computer`, { headers: { "X-Server-Id": serverId } })
      .then(({ data }) => { if (!cancelled) setSetup(data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error || "Cannot load remote setup"); });
    const refresh = () => { void useMachineStore.getState().loadMachines().catch(() => undefined); };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [serverId]);

  const download = async () => {
    setDownloading(true);
    setError("");
    try {
      const { data } = await api.get(`/servers/${serverId}/remote-computer/download`, {
        headers: { "X-Server-Id": serverId }, responseType: "blob",
      });
      const url = URL.createObjectURL(data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = setup!.filename!;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch { setError("Cannot download the private runner. Rebuild standalone and try again."); }
    finally { setDownloading(false); }
  };

  let validOrigin = false;
  try {
    const url = new URL(origin);
    validOrigin = !url.username && !url.password && !url.search && !url.hash && url.pathname === "/"
      && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch { /* The editable field may contain an incomplete URL. */ }
  const command = setup && validOrigin && name.trim()
    ? `./connect setup --server-url ${quote(origin)} --server ${quote(setup.serverSlug)} --name ${quote(name.trim())}` : null;

  return (
    <div className="space-y-4 text-callout" data-testid="remote-computer-connect">
      <p>Run the private runner on the machine that should execute your agents. Its Claude/Codex login, skills and files stay on that machine.</p>
      {error ? <Banner intent="warning">{error}</Banner> : null}
      {setup && !setup.ready ? <Banner intent="warning">The private runner has not been built. Run pnpm standalone:remote:build on the server.</Banner> : null}
      <div className="space-y-2">
        <p className="font-semibold">1. Download and transfer the runner</p>
        <Button variant="outline" disabled={!setup?.ready || downloading} onClick={() => { void download(); }}>
          {downloading ? "Downloading…" : "Download private runner"}
        </Button>
        {setup?.ready ? <p className="text-footnote text-foreground-muted">{setup.platform}/{setup.arch} · Node {setup.nodeMajor}+ required · includes installed dependencies; no npm install or vendor installer.</p> : null}
        {setup?.sha256 ? <p className="break-all font-mono text-footnote">SHA-256: {setup.sha256}</p> : null}
        <p className="text-footnote text-foreground-muted">Copy the archive to the target machine. Verify its checksum, extract it, then enter the raft-runner directory.</p>
      </div>
      <div className="space-y-2">
        <p className="font-semibold">2. Connect to this center</p>
        <p className="text-footnote text-foreground-muted">For SSH access, run this on the target machine and keep it open. Replace admin@ADMIN_HOST with your actual SSH destination.</p>
        <pre className="overflow-x-auto rounded-control border border-line-seam p-3 text-footnote">{`ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:15280:127.0.0.1:${setup?.port || 5280} admin@ADMIN_HOST`}</pre>
        <FormField label="Center URL as seen from the target machine" htmlFor="remote-center-origin">
          <Input id="remote-center-origin" value={origin} onChange={(event) => setOrigin(event.target.value)} />
        </FormField>
        {!validOrigin ? <p role="alert">Use an HTTPS origin, or HTTP loopback through an SSH tunnel.</p> : null}
        <FormField label="Unique machine name" htmlFor="remote-computer-name">
          <Input id="remote-computer-name" maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
        </FormField>
        {command ? <pre className="overflow-x-auto rounded-control border border-line-seam p-3 text-footnote">{command}</pre> : null}
      </div>
      <div className="space-y-2">
        <p className="font-semibold">3. Approve and select the machine</p>
        <p>Open <a className="underline" href="/login/device" target="_blank" rel="noopener noreferrer">device approval</a> in this center and enter the code printed by the runner. Approve only the code you just requested.</p>
        <p className="text-footnote text-foreground-muted">Keep the runner process open. Create an agent and select this Computer. An offline target must reconnect; it is not replaced by the server host. Setup resumes its saved credential on later runs.</p>
        {machine ? <Banner intent={machine.status === "online" ? "info" : "warning"}>
          {machine.name} · {machine.hostname || "Host identity pending"} · {machine.os || "OS pending"} · {machine.status}
          <div className="font-mono text-footnote">Machine ID: {machine.id}</div>
          <div className="text-footnote">Runtimes: {machine.runtimes.join(", ") || "Detection pending"}. Confirm this is your target machine.</div>
        </Banner> : null}
      </div>
      <p className="text-footnote text-foreground-muted">Each host and OS user needs a separate attachment. Do not copy credentials or session directories between hosts. Working directories are not an OS sandbox.</p>
    </div>
  );
}
