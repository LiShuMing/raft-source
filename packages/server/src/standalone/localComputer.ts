import { fork, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index";
import { servers } from "../db/schema";
import { actorHasServerCapabilityInServer } from "../lib/actorPermissions";
import { attachComputer, findComputerByApiKey } from "../services/computerCredentialService";
import { deleteMachine } from "../services/machineService";

const attachmentSchema = z.object({
  version: z.literal(1),
  serverId: z.uuid(),
  machineId: z.uuid(),
  computerId: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
});
type Attachment = z.infer<typeof attachmentSchema>;

export class LocalComputerError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

/** Keep native HOME/configuration, but never give the runner the server's secrets. */
export function localRunnerEnvironment(raftHome: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (/^(DATABASE_|JWT_|REDIS_|S3_|SCOPEDB_|RESEND_|STRIPE_|SLACK_BRIDGE_|AGENT_API_KEY_HMAC_SECRET$)/.test(key)) delete env[key];
  }
  delete env.NODE_OPTIONS;
  delete env.SLOCK_DAEMON_API_KEY_FILE;
  delete env.SLOCK_PROVIDER_CREDENTIAL_KEY;
  return {
    ...env,
    RAFT_HOME: raftHome,
    SLOCK_HOME: raftHome,
    SLOCK_DAEMON_TRACE_UPLOAD_DISABLED: "1",
    RAFT_TRACE_SCOPEDB_SINK: "off",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_AUTOUPDATER: "1",
  };
}

interface Runner {
  attachment: Attachment;
  child?: ChildProcess;
  retry?: ReturnType<typeof setTimeout>;
  failures: number;
  error?: string;
}

interface LocalComputerOptions {
  stateDir: string;
  origin: string;
  machineStatus: (machineId: string) => Promise<string>;
  /** Lifecycle tests exercise real registration/persistence without native processes. */
  launch?: (keyFile: string, home: string) => ChildProcess;
}

/** Thin local host adapter; credentials, wire protocol and native drivers stay original. */
export class LocalComputerManager {
  private readonly root: string;
  private readonly runners = new Map<string, Runner>();
  private readonly pending = new Map<string, Promise<Attachment>>();
  private stopping = false;

  constructor(private readonly options: LocalComputerOptions) {
    this.root = path.join(options.stateDir, "computers");
    const origin = new URL(options.origin);
    if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") {
      throw new Error("The bundled local runner must connect to the loopback server");
    }
  }

  private directory(serverId: string): string {
    return path.join(this.root, z.uuid().parse(serverId));
  }

  private async authorize(serverId: string, userId: string): Promise<void> {
    if (!await actorHasServerCapabilityInServer(serverId, "user", userId, "registerMachines")) {
      throw new LocalComputerError("An owner or admin must connect the server host", 403);
    }
  }

  private async load(serverId: string): Promise<Attachment | null> {
    try {
      const attachment = attachmentSchema.parse(JSON.parse(await readFile(path.join(this.directory(serverId), "attachment.json"), "utf8")));
      if (attachment.serverId !== serverId) throw new Error("Local attachment identity mismatch");
      return attachment;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new LocalComputerError("Cannot read the local Computer attachment; restore its private state before reconnecting");
    }
  }

  private async validate(attachment: Attachment): Promise<void> {
    const key = (await readFile(path.join(this.directory(attachment.serverId), "computer.key"), "utf8")).trim();
    const principal = await findComputerByApiKey(key);
    if (!principal || principal.serverId !== attachment.serverId || principal.machineId !== attachment.machineId || principal.computerId !== attachment.computerId) {
      throw new LocalComputerError("This local Computer attachment was revoked or changed. Restore its private attachment before reconnecting.");
    }
  }

  async status(serverId: string, userId: string) {
    await this.authorize(serverId, userId);
    const runner = this.runners.get(serverId);
    const attachment = runner?.attachment ?? await this.load(serverId);
    const online = attachment ? await this.options.machineStatus(attachment.machineId) === "online" : false;
    return {
      hostname: os.hostname(),
      platform: process.platform,
      machineId: attachment?.machineId ?? null,
      state: online ? "online" : runner?.error ? "failed" : runner?.child ? "starting" : "offline",
      error: runner?.error ?? null,
    };
  }

  async connect(serverId: string, userId: string): Promise<Attachment> {
    await this.authorize(serverId, userId);
    if (this.stopping) throw new LocalComputerError("The server is shutting down", 503);
    const existing = this.pending.get(serverId);
    if (existing) return existing;
    const work = this.connectOnce(serverId, userId);
    this.pending.set(serverId, work);
    try { return await work; }
    finally { this.pending.delete(serverId); }
  }

  private async connectOnce(serverId: string, userId: string): Promise<Attachment> {
    // Check the bundled artifact before issuing credentials or creating rows.
    if (!this.options.launch) await access(this.runnerEntry());
    let attachment = await this.load(serverId);
    if (attachment) {
      await this.validate(attachment);
    } else {
      const [server] = await getDb().select({ slug: servers.slug }).from(servers)
        .where(and(eq(servers.id, serverId), isNull(servers.deletedAt)));
      if (!server) throw new LocalComputerError("Server not found", 404);
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const temporary = await mkdtemp(path.join(this.root, ".attach-"));
      let createdMachineId: string | undefined;
      try {
        const name = `Server host · ${os.hostname()}`;
        const result = await attachComputer({ userId, serverSlug: server.slug, name });
        if (!result.ok) throw new LocalComputerError(`Cannot attach the server host: ${result.error}`, result.error === "requires_admin" ? 403 : 409);
        createdMachineId = result.machineId;
        attachment = { version: 1, serverId, machineId: result.machineId, computerId: result.serverMachineId, userId, name };
        await writeFile(path.join(temporary, "computer.key"), result.apiKey, { mode: 0o600, flag: "wx" });
        await writeFile(path.join(temporary, "attachment.json"), JSON.stringify(attachment), { mode: 0o600, flag: "wx" });
        await rename(temporary, this.directory(serverId));
      } catch (error) {
        // No runner has started, so a failed durable attachment must not consume quota.
        if (createdMachineId) await deleteMachine(createdMachineId);
        throw error;
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
    if (this.stopping) throw new LocalComputerError("The server is shutting down", 503);
    let runner = this.runners.get(serverId);
    if (!runner) {
      runner = { attachment, failures: 0 };
      this.runners.set(serverId, runner);
    }
    if (!runner.child) {
      if (runner.retry) clearTimeout(runner.retry);
      runner.failures = 0;
      this.start(runner);
    }
    return attachment;
  }

  private runnerEntry(): string {
    return fileURLToPath(new URL("../../../daemon/dist/standaloneRunner.js", import.meta.url));
  }

  private start(runner: Runner): void {
    if (this.stopping) return;
    const home = this.directory(runner.attachment.serverId);
    const keyFile = path.join(home, "computer.key");
    let child: ChildProcess;
    try {
      if (this.options.launch) child = this.options.launch(keyFile, home);
      else {
        const log = openSync(path.join(home, "runner.log"), "a", 0o600);
        try {
          child = fork(this.runnerEntry(), ["--server-url", this.options.origin, "--api-key-file", keyFile], {
            cwd: home,
            env: localRunnerEnvironment(home),
            execArgv: [],
            stdio: ["ignore", log, log, "ipc"],
          });
        } finally { closeSync(log); }
      }
    } catch {
      runner.error = "Cannot start the bundled runner. Rebuild standalone and reconnect.";
      return;
    }
    runner.child = child;
    runner.error = undefined;
    const started = Date.now();
    child.once("error", () => { runner.error = "The bundled runner could not start"; });
    child.once("close", () => {
      runner.child = undefined;
      if (this.stopping) return;
      if (Date.now() - started > 60_000) runner.failures = 0;
      runner.failures += 1;
      runner.error = "The bundled runner stopped. Check its local log and reconnect.";
      if (runner.failures <= 5) {
        runner.retry = setTimeout(() => { runner.retry = undefined; this.start(runner); }, Math.min(1000 * 2 ** runner.failures, 30_000));
        runner.retry.unref();
      }
    });
  }

  async resume(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success) continue;
      try {
        const attachment = await this.load(entry.name);
        if (attachment) await this.connect(attachment.serverId, attachment.userId);
      } catch {
        // Revoked credentials/permissions never trigger silent re-enrollment.
        console.warn("[Raft standalone] Local Computer was not resumed", { serverId: entry.name });
      }
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const runner of this.runners.values()) if (runner.retry) clearTimeout(runner.retry);
    await Promise.allSettled(this.pending.values());
    await Promise.all([...this.runners.values()].map(async (runner) => {
      const child = runner.child;
      if (!child || child.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); }, 12_000);
        timer.unref();
        child.once("close", () => { clearTimeout(timer); resolve(); });
        child.kill("SIGTERM");
      });
    }));
  }
}
