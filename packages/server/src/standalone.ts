import "dotenv/config";
import { validateStandaloneWebDist } from "./standalone/startup";
import { configureStandalone } from "./standalone/config";

// Configure before importing the server: many original modules capture env at import time.
// Reject an incomplete installation before creating state or signing keys.
const webDist = await validateStandaloneWebDist();
const config = await configureStandalone();
process.env.RAFT_STANDALONE_WEB_DIST = webDist;
console.log(`[Raft standalone] State: ${config.stateDir}`);
console.log(`[Raft standalone] Open ${config.origin}`);
await import("./server");
