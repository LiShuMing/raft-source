import "dotenv/config";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import path from "node:path";
import { configureStandalone } from "./standalone/config";

// Configure before importing the server: many original modules capture env at import time.
const config = await configureStandalone();
const webDist = path.resolve(process.env.RAFT_STANDALONE_WEB_DIST || fileURLToPath(new URL("../../web/dist/", import.meta.url)));
await access(path.join(webDist, "index.html"));
process.env.RAFT_STANDALONE_WEB_DIST = webDist;
console.log(`[Raft standalone] State: ${config.stateDir}`);
console.log(`[Raft standalone] Open ${config.origin}`);
await import("./server");
