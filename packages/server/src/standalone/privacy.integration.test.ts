import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { vi } from "vitest";
import { attachmentObjects, attachments } from "../db/schema";
import { createApiTest } from "../test/integration/apiTest";
import { __setStorageForTests, resetStorageForTests } from "../services/storageService";

const test = createApiTest();
afterEach(() => { resetStorageForTests(); vi.unstubAllEnvs(); });

test("real attachment route serves static HTML with offline CSP while preserving access checks and stored bytes", async ({ seed, db, http, app }) => {
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standalone");
  const owner = await seed.human();
  const outsider = await seed.human();
  const server = await seed.server({ owner, members: [outsider] });
  const channel = await seed.channel({ server, members: [owner], visibility: "private" });
  const message = await seed.message({ channel, author: owner, content: "Local HTML report" });
  const html = '<h1>Local report</h1><meta http-equiv="refresh" content="0;url=https://audit.invalid"><script>location="https://audit.invalid"</script><img src="https://audit.invalid/leak">';
  let reads = 0;
  __setStorageForTests({ async put() {}, async delete() {}, async get() { reads++; return Readable.from([html]); } });
  const id = randomUUID();
  const objectId = randomUUID();
  await db.insert(attachmentObjects).values({
    id: objectId,
    originServerId: server.id,
    uploaderId: owner.id,
    uploaderType: "user",
    storageKey: `${server.id}/report.html`,
    contentHash: "privacy-test",
    mimeType: "text/html",
    sizeBytes: Buffer.byteLength(html),
  });
  await db.insert(attachments).values({
    id,
    channelId: channel.id,
    messageId: message.id,
    objectId,
    uploaderId: owner.id,
    uploaderType: "user",
    filename: "report.html",
  });
  const previewUrlRes = await http.as(owner, server).get(`/api/attachments/${id}/html-preview-url`);
  assert.equal(previewUrlRes.status, 200);
  const previewUrlBody = await previewUrlRes.json() as { url: string; previewMode: string };
  assert.equal(previewUrlBody.previewMode, "offline-static");
  const path = `/api/attachments/${id}/html-preview`;
  assert.equal((await http.as(outsider, server).get(path)).status, 404);
  assert.equal(reads, 0);
  const preview = await http.as(owner, server).get(path);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-security-policy")!, /script-src 'none'/);
  const body = await preview.text();
  assert.match(body, /Local report/);
  assert.doesNotMatch(body, /audit\.invalid|<meta|<script/);
  assert.equal(html.includes("<script>"), true, "storage source is unchanged");
  for (const path of ["/api/product-feedback", "/api/push", "/api/mcp", "/internal/trace-ingest/otlp/v1/traces"]) {
    const response = await fetch(`${app.baseUrl}${path}`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "standalone_external_service_disabled");
  }
  const policy = await (await fetch(`${app.baseUrl}/api/privacy-policy`)).json();
  assert.equal(policy.htmlPreview, "offline-static");
  assert.equal(policy.externalServices.managedMcp, false);

  // Explicit local-interactive opt-in keeps zero external egress while enabling inline scripts + measurement bridge.
  vi.stubEnv("RAFT_STANDALONE_HTML_PREVIEW", "local-interactive");
  const interactiveUrlRes = await http.as(owner, server).get(`/api/attachments/${id}/html-preview-url`);
  assert.equal(interactiveUrlRes.status, 200);
  assert.equal((await interactiveUrlRes.json() as { previewMode: string }).previewMode, "sandboxed-interactive");
  const interactivePreview = await http.as(owner, server).get(path);
  assert.equal(interactivePreview.status, 200);
  const interactiveCsp = interactivePreview.headers.get("content-security-policy")!;
  assert.match(interactiveCsp, /sandbox allow-scripts/);
  assert.match(interactiveCsp, /connect-src 'none'/);
  assert.doesNotMatch(interactiveCsp, /https:|allow-same-origin/);
  const interactiveBody = await interactivePreview.text();
  assert.match(interactiveBody, /slockAcBridge/);
  const interactivePolicy = await (await fetch(`${app.baseUrl}/api/privacy-policy`)).json();
  assert.equal(interactivePolicy.htmlPreview, "local-interactive");
});
