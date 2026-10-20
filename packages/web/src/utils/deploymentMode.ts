/** Server-injected before application scripts; no async request or false-default race. */
export function isStandaloneDeployment(): boolean {
  return typeof document !== "undefined"
    && document.querySelector('meta[name="raft-deployment-mode"]')?.getAttribute("content") === "standalone";
}
