import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function standalonePaths(env: NodeJS.ProcessEnv = process.env) {
  const stateDir = path.resolve(env.RAFT_STANDALONE_DIR?.trim() || path.join(os.homedir(), ".raft-standalone"));
  const rawPort = env.RAFT_STANDALONE_PORT?.trim() || "5280";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("RAFT_STANDALONE_PORT must be an integer between 1 and 65535");
  }
  return {
    stateDir,
    port,
    origin: `http://127.0.0.1:${port}`,
    databaseUrl: `pglite://${path.join(stateDir, "postgres")}`,
    uploadsDir: path.join(stateDir, "uploads"),
    secretFile: path.join(stateDir, "jwt-secret"),
    providerCredentialKeyFile: path.join(stateDir, "provider-credential-key"),
  };
}

/** Persist the signing key across restarts. Never log it or put it in source control. */
export async function readOrCreateSigningKey(secretFile: string): Promise<string> {
  const key = (await readOrCreateSecret(secretFile, randomBytes(48).toString("base64url"))).trim();
  if (key.length < 32) throw new Error(`Invalid signing key in ${secretFile}`);
  return key;
}

async function readOrCreateSecret(secretFile: string, initialValue: string): Promise<string> {
  await mkdir(path.dirname(secretFile), { recursive: true, mode: 0o700 });
  const temporary = `${secretFile}.${randomBytes(12).toString("hex")}.tmp`;
  await writeFile(temporary, initialValue, { flag: "wx", mode: 0o600 });
  try {
    // Publishing a complete inode avoids another launcher reading an empty key.
    await link(temporary, secretFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await unlink(temporary);
  }
  return readFile(secretFile, "utf8");
}

function validateProviderCredentialKey(value: string): string {
  const key = value.trim();
  const bytes = Buffer.from(key, "base64");
  if (bytes.length !== 32 || bytes.toString("base64").replace(/=+$/u, "") !== key.replace(/=+$/u, "")) {
    throw new Error("Invalid standalone provider credential key; restore the original key before opening saved connections");
  }
  return key;
}

/** Keep encryption separate from JWT signing. Never rotate on restart or corruption. */
export async function readOrCreateProviderCredentialKey(secretFile: string): Promise<string> {
  return validateProviderCredentialKey(await readOrCreateSecret(secretFile, randomBytes(32).toString("base64")));
}

export async function configureStandalone(env: NodeJS.ProcessEnv = process.env) {
  const config = standalonePaths(env);
  // An isolated profile must never inherit a cloud database or storage target.
  env.RAFT_DEPLOYMENT_MODE = "standalone";
  env.DATABASE_URL = config.databaseUrl;
  env.PORT = String(config.port);
  env.APP_URL = config.origin;
  env.CORS_ORIGIN = config.origin;
  env.JWT_SECRET = await readOrCreateSigningKey(config.secretFile);
  // Preserve explicitly configured keys so existing encrypted connections remain readable.
  // Default standalone installs need no manual secret-generation step.
  env.SLOCK_PROVIDER_CREDENTIAL_KEY = env.SLOCK_PROVIDER_CREDENTIAL_KEY?.trim()
    ? validateProviderCredentialKey(env.SLOCK_PROVIDER_CREDENTIAL_KEY)
    : await readOrCreateProviderCredentialKey(config.providerCredentialKeyFile);
  env.UPLOADS_LOCAL = "true";
  env.UPLOADS_DIR = config.uploadsDir;
  env.STRIPE_BILLING_ENABLED = "false";
  env.SLOCK_DRAIN_DETECTOR_DISABLED = "1";
  env.SLOCK_DAEMON_TRACE_UPLOAD_DISABLED = "1";
  env.RAFT_TRACE_SCOPEDB_SINK = "off";
  for (const name of Object.keys(env)) {
    if (/^(S3_|SCOPEDB_|SLACK_BRIDGE_|HANDS_FEEDBACK_|TRANSLATION_|OTLP_RELAY_|VAPID_|APNS_|FCM_)/.test(name)) delete env[name];
  }
  for (const name of [
    "DATABASE_URL_READ_REPLICA", "REDIS_URL", "RISINGWAVE_DATABASE_URL",
    "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ATTACHMENTS_BUCKET",
    "CDN_BASE_URL", "PUBLIC_CONTENT_BASE_URL", "RESEND_API_KEY",
    "SLOCK_TRACE_OTLP_ENDPOINT", "SCOPEDB_TRACE_EVENTS_ENDPOINT", "SCOPEDB_TRACE_EVENTS_WRITE_KEY",
    "TRANSLATION_SSM_ENVIRONMENT", "ECS_CONTAINER_METADATA_URI_V4",
  ]) delete env[name];
  return config;
}
