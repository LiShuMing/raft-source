import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { AgentOrchestrator } from "../services/agentOrchestrator";
import { createLocalReplicaStateStore } from "./localReplicaStateStore";

class RoutingProbe extends AgentOrchestrator {
  ping(machineId: string) { return this.sendToMachine(machineId, { type: "ping" }); }
}

test("one center sends only to the selected machine and never substitutes the admin connection when it goes offline", async () => {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const orchestrator = new RoutingProbe(createLocalReplicaStateStore());
  const connections = Reflect.get(orchestrator, "machineConnections") as Map<string, { ws: WebSocket }>;
  const clients: WebSocket[] = [];
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    for (const machine of ["admin", "remote-b"]) {
      const accepted = once(wss, "connection");
      const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
      clients.push(client);
      const [ws] = await accepted;
      await once(client, "open");
      connections.set(machine, { ws });
    }
    let adminMessages = 0;
    clients[0].on("message", () => { adminMessages++; });
    const received = once(clients[1], "message");
    assert.equal(await orchestrator.ping("remote-b"), true);
    const [data] = await received;
    assert.equal(JSON.parse(data.toString()).type, "ping");
    assert.equal(adminMessages, 0);
    connections.delete("remote-b");
    assert.equal(await orchestrator.ping("remote-b"), false);
    assert.equal(adminMessages, 0);
    assert.equal(await orchestrator.ping("unknown-machine"), false);
    assert.equal(adminMessages, 0);
  } finally {
    connections.clear();
    for (const client of clients) client.terminate();
    for (const client of wss.clients) client.terminate();
    await orchestrator.shutdown();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
