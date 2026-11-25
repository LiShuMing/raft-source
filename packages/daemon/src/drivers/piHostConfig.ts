import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { parse as parseJsonc } from "jsonc-parser";

export function readPiHostEnv(env: NodeJS.ProcessEnv, home = os.homedir()): Record<string, string> {
  const file = env.PI_ENV_FILE || path.join(home, ".env");
  try {
    return Object.fromEntries(Object.entries(parseEnv(readFileSync(file, "utf8")))
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && env[entry[0]] === undefined));
  } catch (error) {
    if (!env.PI_ENV_FILE && (error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Cannot read the Pi host environment file.");
  }
}

export function resolvePiAgentDir(env: NodeJS.ProcessEnv, fallback: string): string {
  const directory = env.PI_CODING_AGENT_DIR || fallback;
  return directory === "~" ? os.homedir()
    : directory.startsWith("~/") ? path.join(os.homedir(), directory.slice(2))
    : path.resolve(directory);
}

export function piHostDefaultModel(
  model: string | null | undefined,
  env: NodeJS.ProcessEnv,
  defaults: { getDefaultProvider(): string | undefined; getDefaultModel(): string | undefined },
  models: readonly { provider: string; id: string }[],
  modelsPath?: string,
): string | null | undefined {
  if (model && model !== "default") return model;
  if (defaults.getDefaultProvider() || defaults.getDefaultModel() || !env.LLM_MODEL) return model;
  let configuredProviders: string[] = [];
  if (modelsPath) {
    try {
      const providers = parseJsonc(readFileSync(modelsPath, "utf8"))?.providers;
      configuredProviders = Object.entries(providers ?? {}).filter(([, provider]) => {
        const entries = (provider as { models?: { id: string }[] })?.models;
        return Array.isArray(entries) && entries.some((entry) => entry.id === env.LLM_MODEL);
      }).map(([provider]) => provider);
    } catch { /* The SDK reports invalid model configuration. */ }
  }
  const configured = models.filter((candidate) => candidate.id === env.LLM_MODEL && configuredProviders.includes(candidate.provider));
  const matches = configured.length ? configured : models.filter((candidate) => candidate.id === env.LLM_MODEL);
  return matches.length === 1 ? `${matches[0].provider}/${matches[0].id}` : model;
}
