import { lstat, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  applyRemotePrivacy, localHostIdentity, readRemoteAttachment, remoteHome, remoteOrigin, saveRemoteAttachment,
  type RemoteAttachment,
} from "./standaloneRemoteState";

async function main(): Promise<void> {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("The private runner requires Node 24 or newer.");
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help")) {
    console.log("Raft private runner (Node 24+).\nUsage: ./connect setup|start|status --server-url <origin> --server <slug> [--name <name>]\nSetup uses browser device approval. Credentials and agent sessions stay on this machine.\nUse a dedicated OS user for file isolation; working directories are not a sandbox.");
    return;
  }
  const command = args.shift();
  if (!["setup", "start", "status", "__detect-runtimes"].includes(command!)) throw new Error("Unknown runner command; use --help.");
  if (command === "__detect-runtimes") {
    applyRemotePrivacy(process.env.RAFT_HOME || process.env.SLOCK_HOME || os.homedir());
    const { runRuntimeDetectionChildMain } = await import("./runtimeDetectionChild");
    process.exitCode = await runRuntimeDetectionChildMain();
    return;
  }
  const options = new Map<string, string>();
  while (args.length) {
    const flag = args.shift()!;
    const value = args.shift();
    if (!["--server-url", "--server", "--name"].includes(flag) || !value || options.has(flag)) throw new Error("Invalid runner arguments; use --help.");
    options.set(flag, value);
  }
  const origin = remoteOrigin(options.get("--server-url") || "");
  const slug = (options.get("--server") || "").replace(/^\//, "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(slug)) throw new Error("A valid --server slug is required.");
  const home = remoteHome(origin, slug);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const stateInfo = await lstat(home);
  if (!stateInfo.isDirectory() || (stateInfo.mode & 0o077)) throw new Error("RAFT_HOME must be a private directory (0700).");
  applyRemotePrivacy(home);
  let attachment = await readRemoteAttachment(home);
  if (attachment && (attachment.origin !== origin || attachment.serverSlug !== slug)) throw new Error("RAFT_HOME is attached to another center or workspace. Choose a separate directory.");
  if (command === "status") {
    console.log(JSON.stringify({ attached: Boolean(attachment), machineId: attachment?.machineId, name: attachment?.name,
      host: await localHostIdentity(), stateDirectory: home, origin, serverSlug: slug }, null, 2));
    return;
  }
  if (!attachment && command !== "setup") throw new Error("This machine is not enrolled. Run setup first.");
  if (!attachment) {
    const partialKey = await lstat(path.join(home, "computer.key")).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (partialKey) throw new Error("An incomplete attachment already has a credential. Restore its state or revoke it before enrolling again.");
    const lock = path.join(home, ".setup-lock");
    await mkdir(lock, { mode: 0o700 }).catch(() => { throw new Error("Setup is already running, or its lock needs operator recovery. No new credential was issued."); });
    try {
      attachment = await readRemoteAttachment(home);
      if (!attachment) attachment = await enroll(origin, slug, options.get("--name") || os.hostname(), home);
    } finally { await rm(lock, { recursive: true }); }
  }
  const keyFile = path.join(home, "computer.key");
  const keyInfo = await lstat(keyFile);
  if (!keyInfo.isFile() || (keyInfo.mode & 0o077)) throw new Error("Computer credential must be a private regular file (0600).");
  const apiKey = (await readFile(keyFile, "utf8")).trim();
  if (!/^sk_computer_[A-Za-z0-9_-]+$/.test(apiKey)) throw new Error("Invalid Computer credential.");
  console.log(`Starting ${attachment.name} (${attachment.machineId}) on ${attachment.host.hostname} as ${attachment.host.username}.\nState: ${home}\nAgents run here using this OS user's native configuration. Stop with Ctrl+C.`);
  // Original machine authentication, reconnect, runtime detection and agent drivers.
  const { DaemonCore } = await import("./core");
  const daemon = new DaemonCore({ serverUrl: origin, apiKey, localTrace: true });
  let stopping = false;
  const stop = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    await daemon.stop({ source: "external_signal", signal });
    process.exit(0);
  };
  process.once("SIGINT", () => { void stop("SIGINT"); });
  process.once("SIGTERM", () => { void stop("SIGTERM"); });
  daemon.start();
}

async function request(origin: string, route: string, body: unknown, token?: string) {
  const response = await fetch(`${origin}${route}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const data = await response.json() as Record<string, unknown>;
  return { response, data };
}

async function enroll(origin: string, slug: string, name: string, home: string): Promise<RemoteAttachment> {
  if (!name.trim() || name.length > 200 || /[\x00-\x1f\x7f]/.test(name)) throw new Error("Computer name must contain 1–200 printable characters.");
  const grant = await request(origin, "/api/auth/device/authorize", { clientName: `Private runner: ${name}`.slice(0, 200) });
  if (!grant.response.ok || typeof grant.data.deviceCode !== "string" || typeof grant.data.userCode !== "string"
    || typeof grant.data.expiresIn !== "number" || typeof grant.data.interval !== "number") throw new Error("Cannot start device authorization.");
  console.log(`Open your center's /login/device page in the browser and approve code: ${grant.data.userCode}\nWorkspace: ${slug}; machine: ${name}. Never approve an unexpected code.`);
  const deadline = Date.now() + Math.min(grant.data.expiresIn, 600) * 1000;
  let session: Record<string, unknown> | undefined;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(5, grant.data.interval as number) * 1000));
    const poll = await request(origin, "/api/auth/device/token", { deviceCode: grant.data.deviceCode });
    if (poll.response.ok) { session = poll.data; break; }
    if (poll.data.code !== "authorization_pending") throw new Error("Device authorization was denied, expired or consumed. Run setup again.");
  }
  if (typeof session?.accessToken !== "string") throw new Error("Device authorization expired.");
  try {
    const attached = await request(origin, "/api/computer/attach", { serverSlug: slug, name }, session.accessToken);
    if (!attached.response.ok) throw new Error(`Computer registration refused (${String(attached.data.code || attached.response.status)}). No existing attachment was replaced.`);
    const attachment: RemoteAttachment = { version: 1, origin, serverSlug: slug,
      serverId: attached.data.serverId as string, machineId: attached.data.machineId as string,
      computerId: attached.data.serverMachineId as string, name, host: await localHostIdentity() };
    await saveRemoteAttachment(home, attachment, attached.data.apiKey as string);
    return (await readRemoteAttachment(home))!;
  } finally {
    // Do not persist a human session in a machine runner.
    if (typeof session.refreshToken === "string") await request(origin, "/api/auth/logout", { refreshToken: session.refreshToken }, session.accessToken).catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  // Never print HTTP response bodies, credentials or native configuration.
  console.error(error instanceof Error ? error.message : "Private runner failed.");
  process.exitCode = 1;
});
