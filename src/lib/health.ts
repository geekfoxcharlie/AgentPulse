import { createHash } from "node:crypto";
import { AppError } from "./errors.js";
import { getGroup } from "./config.js";
import { loadHealthState, saveHealthState } from "./state.js";
import {
  type ApiDefinition,
  type ConfigPaths,
  type HealthEntry,
  type HealthError,
  type HealthSnapshot,
  type HealthState,
  type Registry
} from "./types.js";

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const inFlight = new Map<string, Promise<Record<string, HealthSnapshot>>>();

export interface HealthOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  ttlMs?: number;
}

export function createProbeRequest(api: ApiDefinition, secret: string): { url: string; init: RequestInit } {
  const url = new URL(api.probe.url);
  for (const [name, value] of Object.entries(api.probe.query ?? {})) url.searchParams.set(name, String(value));

  const headers = new Headers(api.probe.headers);
  if (api.credential.placement.type === "header") {
    headers.set(api.credential.placement.name, secret);
  } else if (api.credential.placement.type === "bearer") {
    headers.set("Authorization", `Bearer ${secret}`);
  } else {
    url.searchParams.set(api.credential.placement.name, secret);
  }

  const init: RequestInit = { method: api.probe.method, headers };
  if (api.probe.body !== undefined) init.body = JSON.stringify(api.probe.body);
  return { url: url.toString(), init };
}

export async function checkGroupHealth(
  registry: Registry,
  groupId: string,
  paths: ConfigPaths,
  options: HealthOptions = {}
): Promise<Record<string, HealthSnapshot>> {
  getGroup(registry, groupId);
  const key = `${paths.healthCachePath}:${groupId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const operation = runGroupHealth(registry, groupId, paths, options).finally(() => inFlight.delete(key));
  inFlight.set(key, operation);
  return operation;
}

export async function getCachedHealthSnapshots(
  registry: Registry,
  paths: ConfigPaths,
  now = new Date()
): Promise<Record<string, HealthSnapshot>> {
  const state = await loadHealthState(paths);
  return Object.fromEntries(registry.apis.map((api) => [api.id, snapshotFor(api, state, now)]));
}

function snapshotFor(api: ApiDefinition, state: HealthState, now: Date): HealthSnapshot {
  if (!api.enabled) return { status: "disabled", checkedAt: null, expiresAt: null, isExpired: false };
  const entry = state.entries[api.id];
  if (!entry) return { status: "unknown", checkedAt: null, expiresAt: null, isExpired: false };
  const snapshot: HealthSnapshot = {
    status: entry.status,
    checkedAt: entry.checkedAt,
    expiresAt: entry.expiresAt,
    isExpired: Date.parse(entry.expiresAt) <= now.getTime()
  };
  if (entry.latencyMs !== undefined) snapshot.latencyMs = entry.latencyMs;
  if (entry.error !== undefined) snapshot.error = entry.error;
  return snapshot;
}

async function runGroupHealth(
  registry: Registry,
  groupId: string,
  paths: ConfigPaths,
  options: HealthOptions
): Promise<Record<string, HealthSnapshot>> {
  const now = options.now ?? (() => new Date());
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const state = await loadHealthState(paths);
  const apis = registry.apis.filter((api) => api.group === groupId);
  const results = await Promise.all(
    apis.map(async (api) => {
      if (!api.enabled) return [api.id, { status: "disabled", checkedAt: null, expiresAt: null, isExpired: false } satisfies HealthSnapshot] as const;

      const secret = process.env[api.credential.name];
      const fingerprint = fingerprintFor(api);
      const cached = state.entries[api.id];
      if (isCacheCurrent(cached, fingerprint, Boolean(secret), now())) {
        return [api.id, snapshotFor(api, state, now())] as const;
      }

      const entry = await probeApi(api, secret, fingerprint, now, ttlMs, options.fetchImpl ?? fetch);
      state.entries[api.id] = entry;
      return [api.id, snapshotFor(api, state, now())] as const;
    })
  );

  await saveHealthState(paths, state);
  return Object.fromEntries(results);
}

function isCacheCurrent(entry: HealthEntry | undefined, fingerprint: string, credentialPresent: boolean, now: Date): boolean {
  return Boolean(
    entry &&
      entry.fingerprint === fingerprint &&
      entry.credentialPresent === credentialPresent &&
      Date.parse(entry.expiresAt) > now.getTime()
  );
}

async function probeApi(
  api: ApiDefinition,
  secret: string | undefined,
  fingerprint: string,
  now: () => Date,
  ttlMs: number,
  fetchImpl: typeof fetch
): Promise<HealthEntry> {
  const startedAt = now();
  const expiresAt = new Date(startedAt.getTime() + ttlMs).toISOString();
  const base = { apiId: api.id, fingerprint, checkedAt: startedAt.toISOString(), expiresAt, credentialPresent: Boolean(secret) };
  if (!secret) {
    return {
      ...base,
      status: "misconfigured",
      error: { category: "credential_missing", message: `Environment variable ${api.credential.name} is not available to this process.` }
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), api.probe.timeoutMs);
  try {
    const request = createProbeRequest(api, secret);
    const response = await fetchImpl(request.url, { ...request.init, signal: controller.signal });
    const latencyMs = Math.max(0, now().getTime() - startedAt.getTime());
    if (!api.probe.expectedStatus.includes(response.status)) {
      return {
        ...base,
        status: "unhealthy",
        latencyMs,
        error: httpError(response.status)
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        ...base,
        status: "unhealthy",
        latencyMs,
        error: { category: "response_validation", message: "The probe response was not valid JSON." }
      };
    }

    const assertionError = verifyAssertions(body, api.probe.assertions ?? []);
    if (assertionError) {
      return { ...base, status: "unhealthy", latencyMs, error: assertionError };
    }
    return { ...base, status: "healthy", latencyMs };
  } catch (error: unknown) {
    const latencyMs = Math.max(0, now().getTime() - startedAt.getTime());
    return { ...base, status: "unhealthy", latencyMs, error: networkError(error, secret) };
  } finally {
    clearTimeout(timer);
  }
}

function fingerprintFor(api: ApiDefinition): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        enabled: api.enabled,
        credential: { name: api.credential.name, placement: api.credential.placement },
        probe: api.probe
      })
    )
    .digest("hex");
}

function verifyAssertions(body: unknown, assertions: ApiDefinition["probe"]["assertions"]): HealthError | null {
  for (const assertion of assertions ?? []) {
    const value = valueAtPath(body, assertion.path);
    if (assertion.exists === true && value === undefined) {
      return { category: "response_validation", message: `Expected response field ${assertion.path} was absent.` };
    }
    if (assertion.exists === false && value !== undefined) {
      return { category: "response_validation", message: `Response field ${assertion.path} was unexpectedly present.` };
    }
    if (assertion.equals !== undefined && value !== assertion.equals) {
      return { category: "response_validation", message: `Response field ${assertion.path} did not match the expected value.` };
    }
  }
  return null;
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function httpError(statusCode: number): HealthError {
  if (statusCode === 401 || statusCode === 403) {
    return { category: "authentication", statusCode, message: `The provider rejected the configured credential (${statusCode}).` };
  }
  if (statusCode === 429) {
    return { category: "rate_limited", statusCode, message: "The provider rate-limited the minimal probe (429)." };
  }
  return { category: "http", statusCode, message: `The provider returned HTTP ${statusCode} for the minimal probe.` };
}

function networkError(error: unknown, secret: string): HealthError {
  if (error instanceof Error && error.name === "AbortError") {
    return { category: "timeout", message: "The minimal probe timed out." };
  }
  const rawMessage = error instanceof Error ? error.message : "The network request failed.";
  const message = rawMessage.replaceAll(secret, "[redacted]").slice(0, 240);
  return { category: "network", message: message || "The network request failed." };
}
