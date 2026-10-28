/** User-owned personal workspace objects. Runtime evidence remains in the existing agent/task domain. */
export type PersonalResourceKind = "memory" | "skill";
export interface PersonalResource {
  id: string;
  agentId: string | null;
  kind: PersonalResourceKind;
  title: string;
  content: string;
  enabled: boolean;
  version: number;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PersonalArtifact {
  id: string;
  agentId: string | null;
  channelId: string;
  title: string;
  version: number;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PersonalArtifactRevision {
  artifactId: string;
  revision: number;
  content: string;
  digest: string;
  sourceMessageId: string | null;
  createdAt: string;
}
export interface PersonalRoutine {
  id: string;
  agentId: string;
  channelId: string;
  title: string;
  instruction: string;
  schedule: "daily" | "weekdays" | "weekly";
  time: string;
  timezone: string;
  weekday: number;
  enabled: boolean;
  version: number;
  nextRunAt: string;
  skillId: string | null;
  skillVersion: number | null;
  createdAt: string;
  updatedAt: string;
}
export interface PersonalRoutineRun {
  id: string;
  routineId: string;
  scheduleVersion: number;
  scheduledFor: string;
  trigger: "scheduled" | "test";
  status: "queued" | "dispatched" | "completed" | "missed" | "failed";
  messageId: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PersonalDraft {
  id: string;
  channelId: string;
  targetChannelId: string;
  title: string;
  content: string;
  version: number;
  digest: string;
  state:
    | "pending"
    | "denied"
    | "executing"
    | "executed"
    | "unknown"
    | "expired";
  expiresAt: string;
  receiptMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PersonalGroup {
  id: string;
  channelId: string;
  title: string;
  agentIds: string[];
  createdAt: string;
}
export interface PersonalTaskSummary {
  id: string;
  messageId: string | null;
  channelId: string;
  channelName: string;
  agentId: string | null;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done" | "closed";
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface PersonalSnapshot {
  resources: PersonalResource[];
  artifacts: PersonalArtifact[];
  routines: PersonalRoutine[];
  drafts: PersonalDraft[];
  groups: PersonalGroup[];
  tasks: PersonalTaskSummary[];
  preferences: {
    lastAgentId?: string;
    lastChannelId?: string;
    pinnedAgentIds?: string[];
    hiddenAgentIds?: string[];
  };
  nextTaskCursor: string | null;
}
