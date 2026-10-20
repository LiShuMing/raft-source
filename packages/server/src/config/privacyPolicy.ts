import { isStandaloneMode } from "./deploymentMode";

export function requireExternalService(service: string, env: NodeJS.ProcessEnv = process.env): void {
  if (isStandaloneMode(env)) {
    throw new Error(`${service} is disabled by the standalone privacy policy`);
  }
}

/** Native processes and their tools are outside this application policy. */
export function getPrivacyPolicy(env: NodeJS.ProcessEnv = process.env) {
  const standalone = isStandaloneMode(env);
  return {
    deploymentMode: standalone ? "standalone" : "standard",
    htmlPreview: standalone ? "offline-static" : "sandboxed-interactive",
    externalServices: Object.fromEntries([
      "vendorUpdates", "productFeedback", "messageTranslation", "pushNotifications", "appWebhooks", "managedMcp",
    ].map((service) => [service, !standalone])),
    nativeAgentNetworkIsolation: "not-enforced",
  } as const;
}

export const STANDALONE_WEB_CSP = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:"],
  "font-src": ["'self'", "data:"],
  "connect-src": ["'self'"],
  "frame-src": ["'self'", "blob:"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'self'"],
  "worker-src": ["'self'", "blob:"],
  // Loopback deployments and browser forwarding use HTTP intentionally.
  "upgrade-insecure-requests": null,
};
