export interface PersonalTaskRequest {
  agentId: string;
  content: string;
  randomId: string;
}

/** A failed/unknown receipt retries the same logical message, not a new task. */
export function personalTaskRequest(
  previous: PersonalTaskRequest | null,
  agentId: string,
  content: string,
  newId: () => string,
): PersonalTaskRequest {
  const trimmed = content.trim();
  if (!agentId || !trimmed) throw new Error("A personal task requires an agent and content");
  if (previous?.agentId === agentId && previous.content === trimmed) return previous;
  return { agentId, content: trimmed, randomId: newId() };
}

export async function deliverPersonalTask(
  request: PersonalTaskRequest,
  deps: {
    isCurrent: () => boolean;
    openDM: (agentId: string) => Promise<{ id: string }>;
    send: (channelId: string, content: string, randomId: string) => Promise<unknown>;
  },
): Promise<string | null> {
  if (!deps.isCurrent()) return null;
  const channel = await deps.openDM(request.agentId);
  // A space/account change while opening the DM must not send into that new scope.
  if (!deps.isCurrent()) return null;
  await deps.send(channel.id, request.content, request.randomId);
  return deps.isCurrent() ? channel.id : null;
}
