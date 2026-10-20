import { Router, type Router as RouterType } from "express";
import type { Server as SocketServer } from "socket.io";
import { isStandaloneMode } from "../config/deploymentMode";
import { LocalComputerError, type LocalComputerManager } from "./localComputer";
import { sendJsonServerError } from "../routes/errorResponse";

export const localComputerRouter: RouterType = Router({ mergeParams: true });

localComputerRouter.use((req, res, next) => {
  if (!isStandaloneMode()) { res.status(404).json({ error: "Not found" }); return; }
  if (!req.app.get("localComputerManager")) {
    res.status(503).json({ error: "The local Computer manager is unavailable" });
    return;
  }
  next();
});

localComputerRouter.get<{ id: string }>("/", async (req, res) => {
  try {
    const manager = req.app.get("localComputerManager") as LocalComputerManager;
    res.json(await manager.status(req.params.id, req.userId!));
  } catch (error) { respond(error, req, res); }
});

localComputerRouter.post<{ id: string }>("/", async (req, res) => {
  try {
    const manager = req.app.get("localComputerManager") as LocalComputerManager;
    await manager.connect(req.params.id, req.userId!);
    const io = req.app.get("io") as SocketServer | undefined;
    io?.to(`server:${req.params.id}`).emit("machine:updated", { serverId: req.params.id });
    res.json(await manager.status(req.params.id, req.userId!));
  } catch (error) { respond(error, req, res); }
});

function respond(error: unknown, req: import("express").Request, res: import("express").Response): void {
  if (error instanceof LocalComputerError) { res.status(error.status).json({ error: error.message }); return; }
  sendJsonServerError(req, res, { error: "Cannot connect the local Computer", logPrefix: "Local Computer connection failed:", err: error });
}
