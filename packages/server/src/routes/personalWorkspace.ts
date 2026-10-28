import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { personalResources, personalResourceRevisions } from "../db/schema";
import * as service from "../services/personalWorkspaceService";
import { queuePersonalRoutineTest } from "../services/personalRoutineWorker";
import type { Server as SocketServer } from "socket.io";
import type { AgentOrchestrator } from "../services/agentOrchestrator";

export const personalWorkspaceRouter: RouterType = Router();
const uuid = z.string().uuid();
const title = z.string().trim().min(1).max(160);
const content = z.string().trim().min(1).max(250_000);
const version = z.number().int().positive();
const resource = z
  .object({
    id: uuid.optional(),
    agentId: uuid.nullable(),
    kind: z.enum(["memory", "skill"]),
    title,
    content: content.max(16_000),
    enabled: z.boolean().default(true),
    sourceMessageId: uuid.nullable().optional(),
  })
  .strict();
const artifact = z
  .object({
    id: uuid.optional(),
    channelId: uuid,
    agentId: uuid.nullable(),
    title,
    content: content.optional(),
    sourceMessageId: uuid.nullable().optional(),
  })
  .strict();
const draft = z
  .object({
    id: uuid.optional(),
    channelId: uuid,
    targetChannelId: uuid,
    title,
    content,
  })
  .strict();
const plan = z.object({
  schedule: z.enum(["daily", "weekdays", "weekly"]),
  time: z.string(),
  timezone: z.string().max(100),
  weekday: z.number().int().min(0).max(6).default(2),
});
const routine = plan
  .extend({
    id: uuid.optional(),
    agentId: uuid,
    channelId: uuid,
    title,
    instruction: content.max(24_000),
    enabled: z.boolean().default(true),
    skillId: uuid.nullable().optional(),
  })
  .strict();
function scope(req: Request): service.PersonalScope {
  return { serverId: req.serverId!, userId: req.userId! };
}
function pathId(req: Request) {
  return uuid.parse(req.params.id);
}
function handler(work: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await service.assertPersonalMember(scope(req));
      await work(req, res);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({
            error: "Invalid personal workspace request",
            code: "invalid_request",
            issues: error.issues.map((i) => ({ path: i.path, code: i.code })),
          });
        return;
      }
      if (error instanceof service.PersonalError) {
        res
          .status(error.status)
          .json({ error: error.message, code: error.code });
        return;
      }
      console.error("[Personal workspace] Request failed", {
        method: req.method,
        errorClass: error instanceof Error ? error.name : "unknown",
      });
      res
        .status(500)
        .json({
          error: "Could not complete this operation",
          code: "personal_operation_failed",
        });
    }
  };
}
personalWorkspaceRouter.get(
  "/overview",
  handler(async (req, res) =>
    res.json(await service.getPersonalSnapshot(scope(req))),
  ),
);
personalWorkspaceRouter.get(
  "/search/messages",
  handler(async (req, res) =>
    res.json({
      messages: await service.searchPersonalMessages(
        scope(req),
        z.string().trim().min(2).max(160).parse(req.query.q),
      ),
    }),
  ),
);
personalWorkspaceRouter.get(
  "/tasks",
  handler(async (req, res) =>
    res.json(
      await service.listPersonalTasks(
        scope(req),
        z.string().max(300).optional().parse(req.query.after),
      ),
    ),
  ),
);
personalWorkspaceRouter.put(
  "/preferences",
  handler(async (req, res) => {
    const value = z
      .object({
        lastAgentId: uuid.optional(),
        lastChannelId: uuid.optional(),
        pinnedAgentIds: z.array(uuid).max(100).optional(),
        hiddenAgentIds: z.array(uuid).max(100).optional(),
      })
      .strict()
      .parse(req.body);
    res.json({
      preferences: await service.savePersonalPreferences(scope(req), value),
    });
  }),
);
personalWorkspaceRouter.post(
  "/resources",
  handler(async (req, res) =>
    res
      .status(201)
      .json({
        resource: await service.createPersonalResource(
          scope(req),
          resource.parse(req.body),
        ),
      }),
  ),
);
personalWorkspaceRouter.patch(
  "/resources/:id",
  handler(async (req, res) => {
    const { expectedVersion, ...patch } = z
      .object({
        expectedVersion: version,
        title: title.optional(),
        content: content.max(16_000).optional(),
        enabled: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    res.json({
      resource: await service.updatePersonalResource(
        scope(req),
        pathId(req),
        expectedVersion,
        patch,
      ),
    });
  }),
);
personalWorkspaceRouter.get(
  "/resources/:id/history",
  handler(async (req, res) => {
    const s = scope(req),
      id = pathId(req);
    const [row] = await getDb()
      .select()
      .from(personalResources)
      .where(
        and(
          eq(personalResources.id, id),
          eq(personalResources.serverId, s.serverId),
          eq(personalResources.ownerUserId, s.userId),
        ),
      );
    if (!row) throw service.personalNotFound();
    res.json({
      revisions: await getDb()
        .select()
        .from(personalResourceRevisions)
        .where(eq(personalResourceRevisions.resourceId, id))
        .orderBy(desc(personalResourceRevisions.version)),
    });
  }),
);
personalWorkspaceRouter.post(
  "/artifacts",
  handler(async (req, res) =>
    res
      .status(201)
      .json({
        artifact: await service.savePersonalArtifact(
          scope(req),
          artifact.parse(req.body),
        ),
      }),
  ),
);
personalWorkspaceRouter.post(
  "/artifacts/:id/revisions",
  handler(async (req, res) => {
    const { expectedVersion, ...input } = artifact
      .omit({ id: true })
      .extend({ expectedVersion: version })
      .parse(req.body);
    res.json({
      artifact: await service.savePersonalArtifact(scope(req), input, {
        id: pathId(req),
        expectedVersion,
      }),
    });
  }),
);
personalWorkspaceRouter.get(
  "/artifacts/:id/revisions",
  handler(async (req, res) =>
    res.json(
      await service.getPersonalArtifactRevisions(scope(req), pathId(req)),
    ),
  ),
);
personalWorkspaceRouter.post(
  "/routines/preview",
  handler(async (req, res) =>
    res.json({
      dates: service.previewPersonalRoutine(plan.strict().parse(req.body)),
    }),
  ),
);
personalWorkspaceRouter.post(
  "/routines",
  handler(async (req, res) =>
    res
      .status(201)
      .json({
        routine: await service.savePersonalRoutine(
          scope(req),
          routine.parse(req.body),
        ),
      }),
  ),
);
personalWorkspaceRouter.patch(
  "/routines/:id",
  handler(async (req, res) => {
    const id = pathId(req);
    if (
      Object.keys(req.body ?? {}).every(
        (k) => k === "enabled" || k === "expectedVersion",
      )
    ) {
      const input = z
        .object({ enabled: z.boolean(), expectedVersion: version })
        .strict()
        .parse(req.body);
      res.json({
        routine: await service.togglePersonalRoutine(
          scope(req),
          id,
          input.expectedVersion,
          input.enabled,
        ),
      });
      return;
    }
    const { expectedVersion, ...input } = routine
      .omit({ id: true })
      .extend({ expectedVersion: version })
      .parse(req.body);
    res.json({
      routine: await service.savePersonalRoutine(scope(req), input, {
        id,
        expectedVersion,
      }),
    });
  }),
);
personalWorkspaceRouter.get(
  "/routines/:id/runs",
  handler(async (req, res) =>
    res.json({
      runs: await service.listPersonalRoutineRuns(scope(req), pathId(req)),
    }),
  ),
);
personalWorkspaceRouter.post(
  "/routines/:id/test",
  handler(async (req, res) => {
    const { requestId } = z
      .object({ requestId: uuid })
      .strict()
      .parse(req.body);
    res
      .status(202)
      .json({
        run: await queuePersonalRoutineTest(scope(req), pathId(req), requestId),
      });
  }),
);
personalWorkspaceRouter.post(
  "/groups",
  handler(async (req, res) => {
    const input = z
      .object({ id: uuid, title, agentIds: z.array(uuid).min(2).max(6) })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json({ group: await service.createPersonalGroup(scope(req), input) });
  }),
);
personalWorkspaceRouter.post(
  "/drafts",
  handler(async (req, res) =>
    res
      .status(201)
      .json({
        draft: await service.savePersonalDraft(
          scope(req),
          draft.parse(req.body),
        ),
      }),
  ),
);
personalWorkspaceRouter.patch(
  "/drafts/:id",
  handler(async (req, res) => {
    const { expectedVersion, ...input } = draft
      .omit({ id: true })
      .extend({ expectedVersion: version })
      .parse(req.body);
    res.json({
      draft: await service.savePersonalDraft(scope(req), input, {
        id: pathId(req),
        expectedVersion,
      }),
    });
  }),
);
personalWorkspaceRouter.post(
  "/drafts/:id/decision",
  handler(async (req, res) => {
    const input = z
      .object({
        version,
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        approve: z.boolean(),
      })
      .strict()
      .parse(req.body);
    res.json({
      draft: await service.decidePersonalDraft(
        scope(req),
        pathId(req),
        input,
        req.app.get("io") as SocketServer,
        req.app.get("agentOrchestrator") as AgentOrchestrator,
      ),
    });
  }),
);
personalWorkspaceRouter.post(
  "/drafts/:id/reconcile",
  handler(async (req, res) =>
    res.json({
      draft: await service.reconcilePersonalDraft(scope(req), pathId(req)),
    }),
  ),
);
