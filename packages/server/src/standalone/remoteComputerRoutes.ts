import { Router, type Router as RouterType } from "express";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isStandaloneMode } from "../config/deploymentMode";
import { actorHasServerCapabilityInServer } from "../lib/actorPermissions";
import { getDb } from "../db/index";
import { servers } from "../db/schema";
import { eq } from "drizzle-orm";
import { sendJsonServerError } from "../routes/errorResponse";

const defaultPackageDir = fileURLToPath(new URL("../../../../.raft-standalone/packages/", import.meta.url));
export const remoteComputerRouter: RouterType = Router({ mergeParams: true });

remoteComputerRouter.use(async (req, res, next) => {
  if (!isStandaloneMode()) { res.status(404).json({ error: "Not found" }); return; }
  try {
    if (!await actorHasServerCapabilityInServer(req.params.id as string, "user", req.userId!, "registerMachines")) {
      res.status(403).json({ error: "An owner or admin must enroll remote Computers" });
      return;
    }
    next();
  } catch (err) { sendJsonServerError(req, res, { error: "Cannot authorize remote enrollment", logPrefix: "Remote enrollment authorization:", err }); }
});

async function bundle(req: import("express").Request) {
  const directory = req.app.get("standaloneRemotePackageDir") as string | undefined || defaultPackageDir;
  const metadata = JSON.parse(await readFile(path.join(directory, "remote-runner.json"), "utf8"));
  if (typeof metadata.filename !== "string" || !/^raft-runner-(linux|darwin)-(x64|arm64)\.tar\.gz$/.test(metadata.filename)
    || !/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new Error("Invalid remote package metadata");
  const file = path.join(directory, metadata.filename);
  const info = await stat(file);
  if (info.size !== metadata.sizeBytes) throw new Error("Remote package size mismatch");
  return { metadata, file };
}

remoteComputerRouter.get<{ id: string }>("/", async (req, res) => {
  try {
    const [server] = await getDb().select({ slug: servers.slug }).from(servers).where(eq(servers.id, req.params.id));
    if (!server) { res.status(404).json({ error: "Workspace not found" }); return; }
    res.setHeader("Cache-Control", "no-store");
    try {
      const { metadata } = await bundle(req);
      res.json({ ready: true, serverSlug: server.slug, port: Number(process.env.PORT) || 5280, ...metadata });
    } catch {
      res.json({ ready: false, serverSlug: server.slug, port: Number(process.env.PORT) || 5280 });
    }
  } catch (err) { sendJsonServerError(req, res, { error: "Cannot read remote setup", logPrefix: "Remote setup:", err }); }
});

remoteComputerRouter.get("/download", async (req, res) => {
  try {
    const { metadata, file } = await bundle(req);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest("hex") !== metadata.sha256) { res.status(503).json({ error: "Runner package checksum mismatch; rebuild standalone" }); return; }
    res.setHeader("Cache-Control", "private, no-store");
    res.download(file, metadata.filename);
  } catch {
    res.status(503).json({ error: "Build the private runner with pnpm standalone:remote:build" });
  }
});
