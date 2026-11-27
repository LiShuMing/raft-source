import "dotenv/config";
import { validateStandaloneWebDist } from "./standalone/startup";
import { configureStandalone } from "./standalone/config";
import { getStandaloneHtmlPreviewMode } from "./standalone/htmlPreview";
import { writeStandaloneServiceState } from "./standalone/maintenance";

// Configure before importing the server: many original modules capture env at import time.
// Reject an incomplete installation before creating state or signing keys.
const webDist = await validateStandaloneWebDist();
const htmlPreview = getStandaloneHtmlPreviewMode();
const config = await configureStandalone();
process.env.RAFT_STANDALONE_WEB_DIST = webDist;
const host = process.env.RAFT_STANDALONE_HOST?.trim() || "127.0.0.1";
await writeStandaloneServiceState(config.stateDir, {
  pid: process.pid,
  cwd: process.cwd(),
  host,
  port: config.port,
  entrypoint: "src/standalone.ts",
  webDist,
  htmlPreview,
  startedAt: new Date().toISOString(),
});
console.log(`[Raft standalone] State: ${config.stateDir}`);
console.log(`[Raft standalone] HTML preview: ${htmlPreview}`);
console.log(`[Raft standalone] Open ${config.origin}`);
await import("./server");
