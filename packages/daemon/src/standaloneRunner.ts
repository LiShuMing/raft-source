// Reuse the original daemon entry, including detection-child dispatch and shutdown.
// The standalone server owns this runner: an abrupt parent exit must stop agents.
import "./index";

if (process.connected) {
  process.once("disconnect", () => { process.kill(process.pid, "SIGTERM"); });
}
