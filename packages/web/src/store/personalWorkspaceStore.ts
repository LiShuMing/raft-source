import { create } from "zustand";
import type {
  PersonalSnapshot,
  PersonalArtifact,
  PersonalArtifactRevision,
  PersonalResource,
  PersonalRoutine,
  PersonalDraft,
  PersonalRoutineRun,
  PersonalGroup,
  PersonalTaskSummary,
} from "@botiverse/raft-shared";
import api from "../api/client";
import { useServerStore } from "./serverStore";
import { useAuthStore } from "./authStore";
import { registerServerReset } from "./serverResetRegistry";

interface PersonalState {
  snapshot: PersonalSnapshot | null;
  loading: boolean;
  error: boolean;
  generation: number;
  load: (refresh?: boolean) => Promise<void>;
  loadMoreTasks: () => Promise<void>;
}
function currentScope() {
  return `${useAuthStore.getState().user?.id}:${useServerStore.getState().current?.id}:${useServerStore.getState().serverEpoch}`;
}
let inFlight: { scope: string; promise: Promise<void> } | null = null;
export const usePersonalWorkspaceStore = create<PersonalState>((set, get) => ({
  snapshot: null,
  loading: false,
  error: false,
  generation: 0,
  load: (refresh = false) => {
    const scope = currentScope();
    if (!useServerStore.getState().current) return Promise.resolve();
    if (!refresh && inFlight?.scope === scope) return inFlight.promise;
    if (refresh) set((state) => ({ generation: state.generation + 1 }));
    set({ loading: !get().snapshot });
    const generation = get().generation;
    let promise!: Promise<void>;
    promise = (async () => {
      try {
        const { data } = await api.get<PersonalSnapshot>("/personal/overview");
        if (scope === currentScope() && generation === get().generation)
          set({ snapshot: data, error: false });
      } catch {
        if (scope === currentScope() && generation === get().generation)
          set({ error: true });
      } finally {
        if (scope === currentScope() && generation === get().generation)
          set({ loading: false });
        if (inFlight?.promise === promise) inFlight = null;
      }
    })();
    inFlight = { scope, promise };
    return promise;
  },
  loadMoreTasks: async () => {
    const cursor = get().snapshot?.nextTaskCursor;
    if (!cursor) return;
    const scope = currentScope();
    const { data } = await api.get<{
      tasks: PersonalTaskSummary[];
      nextTaskCursor: string | null;
    }>("/personal/tasks", { params: { after: cursor } });
    if (scope !== currentScope()) return;
    set((state) =>
      state.snapshot
        ? {
            snapshot: {
              ...state.snapshot,
              tasks: [
                ...new Map(
                  [...state.snapshot.tasks, ...data.tasks].map((t) => [
                    t.id,
                    t,
                  ]),
                ).values(),
              ],
              nextTaskCursor: data.nextTaskCursor,
            },
          }
        : {},
    );
  },
}));
registerServerReset(() =>
  usePersonalWorkspaceStore.setState((s) => ({
    snapshot: null,
    loading: false,
    error: false,
    generation: s.generation + 1,
  })),
);

async function mutate<T>(work: () => Promise<{ data: T }>): Promise<T> {
  const scope = currentScope();
  const { data } = await work();
  if (currentScope() !== scope) throw new Error("workspace_changed");
  await usePersonalWorkspaceStore.getState().load(true);
  return data;
}
export const personalApi = {
  searchMessages: async (query: string) =>
    (
      await api.get<{
        messages: {
          id: string;
          channelId: string;
          content: string;
          createdAt: string;
        }[];
      }>("/personal/search/messages", { params: { q: query } })
    ).data.messages,
  saveResource: (
    input: Omit<PersonalResource, "createdAt" | "updatedAt" | "version"> & {
      version?: number;
    },
  ) => {
    const { version, ...body } = input;
    return version
      ? mutate(() =>
          api.patch<{ resource: PersonalResource }>(
            `/personal/resources/${input.id}`,
            {
              title: body.title,
              content: body.content,
              enabled: body.enabled,
              expectedVersion: version,
            },
          ),
        )
      : mutate(() =>
          api.post<{ resource: PersonalResource }>("/personal/resources", body),
        );
  },
  toggleResource: (resource: PersonalResource) =>
    mutate(() =>
      api.patch(`/personal/resources/${resource.id}`, {
        expectedVersion: resource.version,
        enabled: !resource.enabled,
      }),
    ),
  saveArtifact: (input: {
    id: string;
    title: string;
    channelId: string;
    agentId: string | null;
    sourceMessageId?: string | null;
    content?: string;
    version?: number;
  }) => {
    const { version, id, ...body } = input;
    return version
      ? mutate(() =>
          api.post<{ artifact: PersonalArtifact }>(
            `/personal/artifacts/${id}/revisions`,
            { ...body, expectedVersion: version },
          ),
        )
      : mutate(() =>
          api.post<{ artifact: PersonalArtifact }>("/personal/artifacts", {
            ...body,
            id,
          }),
        );
  },
  revisions: async (id: string) =>
    (
      await api.get<{
        artifact: PersonalArtifact;
        revisions: PersonalArtifactRevision[];
      }>(`/personal/artifacts/${id}/revisions`)
    ).data,
  preview: async (
    input: Pick<PersonalRoutine, "schedule" | "time" | "timezone" | "weekday">,
  ) =>
    (await api.post<{ dates: string[] }>("/personal/routines/preview", input))
      .data.dates,
  saveRoutine: (
    input: Omit<
      PersonalRoutine,
      "createdAt" | "updatedAt" | "nextRunAt" | "skillVersion" | "version"
    > & { version?: number },
  ) => {
    const { version, id, ...body } = input;
    return version
      ? mutate(() =>
          api.patch(`/personal/routines/${id}`, {
            ...body,
            expectedVersion: version,
          }),
        )
      : mutate(() => api.post("/personal/routines", { ...body, id }));
  },
  toggleRoutine: (routine: PersonalRoutine) =>
    mutate(() =>
      api.patch(`/personal/routines/${routine.id}`, {
        expectedVersion: routine.version,
        enabled: !routine.enabled,
      }),
    ),
  testRoutine: (id: string, requestId: string) =>
    mutate(() => api.post(`/personal/routines/${id}/test`, { requestId })),
  routineRuns: async (id: string) =>
    (
      await api.get<{ runs: PersonalRoutineRun[] }>(
        `/personal/routines/${id}/runs`,
      )
    ).data.runs,
  saveDraft: (input: {
    id: string;
    title: string;
    content: string;
    channelId: string;
    targetChannelId: string;
    version?: number;
  }) => {
    const { version, id, ...body } = input;
    return version
      ? mutate(() =>
          api.patch(`/personal/drafts/${id}`, {
            ...body,
            expectedVersion: version,
          }),
        )
      : mutate(() => api.post("/personal/drafts", { ...body, id }));
  },
  decideDraft: (draft: PersonalDraft, approve: boolean) =>
    mutate(() =>
      api.post(`/personal/drafts/${draft.id}/decision`, {
        version: draft.version,
        digest: draft.digest,
        approve,
      }),
    ),
  reconcileDraft: (id: string) =>
    mutate(() => api.post(`/personal/drafts/${id}/reconcile`)),
  createGroup: (input: { id: string; title: string; agentIds: string[] }) =>
    mutate(() => api.post<{ group: PersonalGroup }>("/personal/groups", input)),
  preferences: (value: PersonalSnapshot["preferences"]) =>
    mutate(() => api.put("/personal/preferences", value)),
};
