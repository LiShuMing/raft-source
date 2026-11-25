import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface RemoteAttachment {
  version: 1;
  origin: string;
  serverSlug: string;
  serverId: string;
  machineId: string;
  computerId: string;
  name: string;
  host: { hostname: string; username: string; home: string };
}

export function remoteOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Use an HTTPS center origin, or HTTP loopback through an SSH tunnel.");
  }
  return url.origin;
}

export function remoteHome(origin: string, slug: string, env = process.env): string {
  return path.resolve(env.RAFT_HOME || path.join(os.homedir(), ".raft-standalone", "remote",
    createHash("sha256").update(`${origin}/${slug}`).digest("hex").slice(0, 20)));
}

export async function localHostIdentity(): Promise<RemoteAttachment["host"]> {
  return { hostname: os.hostname(), username: os.userInfo().username, home: await realpath(os.homedir()) };
}

export function assertRemoteHost(attachment: RemoteAttachment, host: RemoteAttachment["host"]): void {
  if (Object.keys(host).some((key) => host[key as keyof typeof host] !== attachment.host[key as keyof typeof host])) {
    throw new Error("This attachment belongs to another host or OS user. Use a new RAFT_HOME and enroll this machine separately.");
  }
}

export async function readRemoteAttachment(home: string): Promise<RemoteAttachment | null> {
  try {
    const file = path.join(home, "attachment.json");
    const info = await lstat(file);
    if (!info.isFile() || (info.mode & 0o077)) throw new Error("Attachment must be a private regular file (0600).");
    const attachment = JSON.parse(await readFile(file, "utf8")) as RemoteAttachment;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (attachment.version !== 1 || !uuid.test(attachment.machineId) || !uuid.test(attachment.computerId)
      || !uuid.test(attachment.serverId) || !attachment.host || !attachment.serverSlug || !attachment.name
      || remoteOrigin(attachment.origin) !== attachment.origin) throw new Error("Invalid remote attachment.");
    assertRemoteHost(attachment, await localHostIdentity());
    return attachment;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function saveRemoteAttachment(home: string, attachment: RemoteAttachment, key: string): Promise<void> {
  if (!/^sk_computer_[A-Za-z0-9_-]+$/.test(key)) throw new Error("Invalid Computer credential.");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(path.join(home, "computer.key"), key, { mode: 0o600, flag: "wx" });
  await writeFile(path.join(home, "attachment.json"), JSON.stringify(attachment), { mode: 0o600, flag: "wx" });
}

/** Applied before importing the original daemon, including its tracing modules. */
export function applyRemotePrivacy(home: string): void {
  Object.assign(process.env, {
    RAFT_HOME: home, SLOCK_HOME: home, RAFT_DEPLOYMENT_MODE: "standalone",
    SLOCK_DAEMON_TRACE_UPLOAD_DISABLED: "1", RAFT_TRACE_SCOPEDB_SINK: "off",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1",
  });
  delete process.env.NODE_OPTIONS;
}
