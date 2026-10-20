import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { mountStandaloneWeb } from "./web";

test("one origin serves original web routes while unknown APIs and assets remain 404", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "raft-standalone-web-"));
  const app = express();
  const server = createServer(app);
  try {
    await writeFile(path.join(dir, "index.html"), "<!doctype html><html><head><title>Raft</title></head><body></body></html>");
    app.get("/api/example", (_req, res) => { res.json({ originalRoute: true }); });
    mountStandaloneWeb(app, dir);
    app.use((_req, res) => { res.status(404).json({ code: "not_found" }); });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    assert.deepEqual(await (await fetch(`${origin}/api/example`)).json(), { originalRoute: true });
    for (const route of ["/", "/index.html", "/servers/local/channels/general"]) {
      const response = await fetch(`${origin}${route}`, { headers: { accept: "text/html" } });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /<title>Raft<\/title>/);
      assert.match(html, /<meta name="raft-deployment-mode" content="standalone">/);
      assert.equal(response.headers.get("cache-control"), "no-cache");
    }
    for (const route of ["/api/unknown", "/internal/unknown", "/assets/missing.js"]) {
      const response = await fetch(`${origin}${route}`, { headers: { accept: "text/html" } });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { code: "not_found" });
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
