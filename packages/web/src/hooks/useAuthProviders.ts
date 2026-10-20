import { useEffect, useMemo, useState } from "react";
import api from "../api/client";

export type SocialAuthProviderId = "google" | "github" | "apple";

export interface AuthProvider {
  id: SocialAuthProviderId;
  label: string;
  enabled: boolean;
}

const DEFAULT_PROVIDERS: AuthProvider[] = [];

interface AuthConfiguration {
  providers: AuthProvider[];
  standalone: boolean;
}

const DEFAULT_CONFIGURATION: AuthConfiguration = { providers: DEFAULT_PROVIDERS, standalone: false };
let cachedConfiguration: AuthConfiguration | null = null;
let providersRequest: Promise<AuthConfiguration> | null = null;

export function __resetAuthProvidersForTest(): void {
  cachedConfiguration = null;
  providersRequest = null;
}

function isSocialAuthProviderId(value: unknown): value is SocialAuthProviderId {
  return value === "google" || value === "github" || value === "apple";
}

function normalizeProviders(data: unknown): AuthProvider[] {
  if (!data || typeof data !== "object" || !("providers" in data) || !Array.isArray(data.providers)) {
    return DEFAULT_PROVIDERS;
  }

  return data.providers
    .filter((provider): provider is { id: SocialAuthProviderId; label?: unknown; enabled?: unknown } =>
      !!provider && typeof provider === "object" && isSocialAuthProviderId((provider as { id?: unknown }).id)
    )
    .map((provider) => ({
      id: provider.id,
      label: typeof provider.label === "string" ? provider.label : provider.id,
      enabled: !!provider.enabled,
    }));
}

async function fetchAuthProviders(): Promise<AuthConfiguration> {
  if (cachedConfiguration) return cachedConfiguration;
  if (!providersRequest) {
    providersRequest = api.get("/auth/providers")
      .then(({ data }) => ({
        providers: normalizeProviders(data),
        standalone: data?.deploymentMode === "standalone",
      }))
      .catch(() => DEFAULT_CONFIGURATION)
      .finally(() => {
        providersRequest = null;
      });
  }

  cachedConfiguration = await providersRequest;
  return cachedConfiguration;
}

export function useAuthProviders() {
  const [configuration, setConfiguration] = useState<AuthConfiguration>(cachedConfiguration ?? DEFAULT_CONFIGURATION);
  const { providers, standalone } = configuration;
  const [loading, setLoading] = useState(!cachedConfiguration);

  useEffect(() => {
    let cancelled = false;

    async function loadProviders() {
      try {
        const data = await fetchAuthProviders();
        if (!cancelled) {
          setConfiguration(data);
        }
      } catch {
        if (!cancelled) setConfiguration(DEFAULT_CONFIGURATION);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadProviders();

    return () => {
      cancelled = true;
    };
  }, []);

  // Desktop shell now runs OAuth through the native PKCE + loopback flow, and the
  // backend supporting it is live in production (PR #7450, verified deployed
  // 2026-09-15), so the 2026-09-10 desktop hide is removed — social providers show
  // in every shell.
  const enabledProviders = useMemo(
    () => providers.filter((provider) => provider.enabled),
    [providers],
  );

  return { providers, enabledProviders, loading, standalone };
}
