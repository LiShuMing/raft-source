/** Infrastructure profile. Business routes and authorization are shared. */
export type DeploymentMode = "standard" | "standalone";

export function getDeploymentMode(env: NodeJS.ProcessEnv = process.env): DeploymentMode {
  const mode = env.RAFT_DEPLOYMENT_MODE?.trim() || "standard";
  if (mode !== "standard" && mode !== "standalone") {
    throw new Error(`Invalid RAFT_DEPLOYMENT_MODE: ${mode}`);
  }
  return mode;
}

export function isStandaloneMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return getDeploymentMode(env) === "standalone";
}
