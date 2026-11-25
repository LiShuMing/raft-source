import { useEffect, useMemo, useState } from "react";
import api from "../api/client";

export type SocialAuthProviderId = "google" | "github" | "apple";

export interface AuthProvider {
  id: SocialAuthProviderId;
  label: string;
  enabled: boolean;
}

const DEFAULT_PROVIDERS: AuthProvider[] = [];

/**
 * How many sign-in buttons the deployment showed last time, on this device:
 * the space a sign-in page keeps for them while `/auth/providers` is on its
 * way, so nothing moves when they arrive. Never seen here: every provider
 * Raft has (Google, GitHub, Apple), what production shows.
 */
export const SIGN_IN_PROVIDER_COUNT_STORAGE = "raft:auth-provider-count:v1";
const ALL_PROVIDER_COUNT = 3;

export function rememberedProviderCount(): number {
  try {
    const raw = localStorage.getItem(SIGN_IN_PROVIDER_COUNT_STORAGE);
    const stored = raw === null || raw === "" ? Number.NaN : Number(raw);
    return Number.isInteger(stored) && stored >= 0 && stored <= ALL_PROVIDER_COUNT ? stored : ALL_PROVIDER_COUNT;
  } catch {
    return ALL_PROVIDER_COUNT;
  }
}

function rememberProviderCount(providers: AuthProvider[]): void {
  try {
    localStorage.setItem(SIGN_IN_PROVIDER_COUNT_STORAGE, String(providers.filter((provider) => provider.enabled).length));
  } catch {
    // Private mode, quota: the next visit reserves the default.
  }
}

interface AuthConfiguration {
  providers: AuthProvider[];
  standalone: boolean;
}

const DEFAULT_CONFIGURATION: AuthConfiguration = { providers: DEFAULT_PROVIDERS, standalone: false };

let cachedConfiguration: AuthConfiguration | null = null;
let providersRequest: Promise<AuthConfiguration> | null = null;
/** Some Server offers single sign-on (RFC 083): the sign-in page shows "Continue with SSO". */
let ssoOffered = false;
/** The source-available deployment is at the Raft License's user limit: the sign-up page says so (signing up still works). */
let deploymentUserLimitReached = false;

export function __resetAuthProvidersForTest(): void {
  cachedConfiguration = null;
  providersRequest = null;
  ssoOffered = false;
  deploymentUserLimitReached = false;
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
      .then(({ data }) => {
        ssoOffered = (data as { sso?: unknown } | null)?.sso === true;
        deploymentUserLimitReached = (data as { deploymentUserLimitReached?: unknown } | null)?.deploymentUserLimitReached === true;
        const providers = normalizeProviders(data);
        rememberProviderCount(providers);
        return {
          providers,
          standalone: (data as { deploymentMode?: unknown } | null)?.deploymentMode === "standalone",
        };
      })
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
  const [expectedCount] = useState(rememberedProviderCount);

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

  // Read after the load settles (the module value is set before `loading` turns false).
  return {
    providers,
    enabledProviders,
    loading,
    expectedCount,
    ssoOffered: !loading && ssoOffered,
    deploymentUserLimitReached: !loading && deploymentUserLimitReached,
    standalone,
  };
}
