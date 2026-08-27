import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { AppError } from "./errors.js";
import { getGroup } from "./config.js";
import { loadHealthState, saveHealthState } from "./state.js";
import {
  type ApiDefinition,
  type CliDefinition,
  type CliProbeOutcome,
  type CliProbeRunner,
  type ConfigPaths,
  type HealthEntry,
  type HealthError,
  type HealthSnapshot,
  type HealthState,
  type Registry
} from "./types.js";

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const CLI_OUTPUT_TAIL_LIMIT = 240;
const inFlight = new Map<string, Promise<Record<string, HealthSnapshot>>>();

export interface HealthOptions {
  fetchImpl?: typeof fetch;
  spawnImpl?: CliProbeRunner;
  now?: () => Date;
  ttlMs?: number;
}

export function createProbeRequest(api: ApiDefinition, secret: string, environment: NodeJS.ProcessEnv = process.env): { url: string; init: RequestInit } {
  const url = new URL(expandEnvironmentUrl(api.probe.url, environment));
  for (const [name, value] of Object.entries(api.probe.query ?? {})) url.searchParams.set(name, String(value));

  const headers = new Headers(api.probe.headers);
  injectCredential(url, headers, api.credential.placement, secret);
  for (const requirement of api.environment ?? []) {
    if (!requirement.placement) continue;
    const value = environment[requirement.name];
    if (!value) throw new Error(`Environment variable ${requirement.name} is not available to this process.`);
    injectCredential(url, headers, requirement.placement, value);
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
  return Object.fromEntries([...registry.apis, ...registry.clis].map((entry) => [entry.id, snapshotFor(entry, state, now)]));
}

type HealthTracked = Pick<ApiDefinition, "id" | "enabled">;

function snapshotFor(tracked: HealthTracked, state: HealthState, now: Date): HealthSnapshot {
  if (!tracked.enabled) return { status: "disabled", checkedAt: null, expiresAt: null, isExpired: false };
  const entry = state.entries[tracked.id];
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
  const clis = registry.clis.filter((cli) => cli.group === groupId);
  const results = await Promise.all([
    ...apis.map(async (api) => {
      if (!api.enabled) return [api.id, { status: "disabled", checkedAt: null, expiresAt: null, isExpired: false } satisfies HealthSnapshot] as const;

      const secret = process.env[api.credential.name];
      const missingEnvironment = requiredEnvironmentNames(api).filter((name) => !process.env[name]);
      const fingerprint = fingerprintForApi(api);
      const cached = state.entries[api.id];
      if (isCacheCurrent(cached, fingerprint, missingEnvironment.length === 0, now())) {
        return [api.id, snapshotFor(api, state, now())] as const;
      }

      const entry = await probeApi(api, secret, missingEnvironment, fingerprint, now, ttlMs, options.fetchImpl ?? fetch);
      state.entries[api.id] = entry;
      return [api.id, snapshotFor(api, state, now())] as const;
    }),
    ...clis.map(async (cli) => {
      if (!cli.enabled) return [cli.id, { status: "disabled", checkedAt: null, expiresAt: null, isExpired: false } satisfies HealthSnapshot] as const;

      const fingerprint = fingerprintForCli(cli);
      const cached = state.entries[cli.id];
      if (isCacheCurrent(cached, fingerprint, true, now())) {
        return [cli.id, snapshotFor(cli, state, now())] as const;
      }

      const entry = await probeCli(cli, fingerprint, now, ttlMs, options.spawnImpl ?? runCliCommand);
      state.entries[cli.id] = entry;
      return [cli.id, snapshotFor(cli, state, now())] as const;
    })
  ]);

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
  missingEnvironment: string[],
  fingerprint: string,
  now: () => Date,
  ttlMs: number,
  fetchImpl: typeof fetch
): Promise<HealthEntry> {
  const startedAt = now();
  const expiresAt = new Date(startedAt.getTime() + ttlMs).toISOString();
  const base = { apiId: api.id, fingerprint, checkedAt: startedAt.toISOString(), expiresAt, credentialPresent: missingEnvironment.length === 0 };
  if (!secret || missingEnvironment.length > 0) {
    return {
      ...base,
      status: "misconfigured",
      error: {
        category: "credential_missing",
        message: `Required environment variable${missingEnvironment.length === 1 ? "" : "s"} ${missingEnvironment.join(", ")} ${missingEnvironment.length === 1 ? "is" : "are"} not available to this process.`
      }
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
    return {
      ...base,
      status: "unhealthy",
      latencyMs,
      error: networkError(error, [secret, ...(api.environment?.map((requirement) => process.env[requirement.name]) ?? [])])
    };
  } finally {
    clearTimeout(timer);
  }
}

function fingerprintForApi(api: ApiDefinition): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: "api",
        enabled: api.enabled,
        credential: { name: api.credential.name, placement: api.credential.placement },
        environment: api.environment,
        probe: api.probe
      })
    )
    .digest("hex");
}

function fingerprintForCli(cli: CliDefinition): string {
  return createHash("sha256")
    .update(JSON.stringify({ kind: "cli", enabled: cli.enabled, command: cli.command, probe: cli.probe }))
    .digest("hex");
}

async function probeCli(
  cli: CliDefinition,
  fingerprint: string,
  now: () => Date,
  ttlMs: number,
  runProbe: CliProbeRunner
): Promise<HealthEntry> {
  const startedAt = now();
  const expiresAt = new Date(startedAt.getTime() + ttlMs).toISOString();
  const base = { apiId: cli.id, fingerprint, checkedAt: startedAt.toISOString(), expiresAt, credentialPresent: true };
  let outcome: CliProbeOutcome;
  try {
    outcome = await runProbe(cli.command, cli.probe.args, cli.probe.timeoutMs);
  } catch (error: unknown) {
    return { ...base, status: "unhealthy", error: executionError(error) };
  }
  const latencyMs = Math.max(0, now().getTime() - startedAt.getTime());

  if (outcome.spawnError) {
    if (outcome.spawnError instanceof Error && "code" in outcome.spawnError && (outcome.spawnError as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ...base,
        status: "misconfigured",
        error: { category: "command_missing", message: `The command \`${cli.command}\` is not installed or not on PATH for this process.` }
      };
    }
    return { ...base, status: "unhealthy", latencyMs, error: executionError(outcome.spawnError) };
  }
  if (outcome.timedOut) {
    return {
      ...base,
      status: "unhealthy",
      latencyMs,
      error: { category: "timeout", message: `The probe command \`${cli.command}\` timed out after ${cli.probe.timeoutMs} ms.` }
    };
  }
  if (outcome.code === cli.probe.expectedExit) {
    return { ...base, status: "healthy", latencyMs };
  }
  const tail = outcome.outputTail.trim().slice(0, CLI_OUTPUT_TAIL_LIMIT);
  const detail = tail ? ` Output: ${tail}` : "";
  return {
    ...base,
    status: "unhealthy",
    latencyMs,
    error: { category: "exit_code", message: `The probe command \`${cli.command}\` exited with ${outcome.code ?? "no exit code"}; expected ${cli.probe.expectedExit}.${detail}` }
  };
}

function executionError(error: unknown): HealthError {
  const message = error instanceof Error ? error.message : "The probe command could not be executed.";
  return { category: "execution", message: message.slice(0, CLI_OUTPUT_TAIL_LIMIT) };
}

export function runCliCommand(command: string, args: string[], timeoutMs: number): Promise<CliProbeOutcome> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error: unknown) {
      resolve({ code: null, timedOut: false, outputTail: "", spawnError: error instanceof Error ? error : new Error(String(error)) });
      return;
    }

    let output = "";
    const append = (chunk: Buffer): void => {
      output = (output + chunk.toString("utf8")).slice(-1024);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, timedOut: true, outputTail: output.slice(-CLI_OUTPUT_TAIL_LIMIT) });
    }, timeoutMs);

    child.on("error", (error: Error) => {
      clearTimeout(timer);
      resolve({ code: null, timedOut: false, outputTail: output.slice(-CLI_OUTPUT_TAIL_LIMIT), spawnError: error });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, timedOut: false, outputTail: output.slice(-CLI_OUTPUT_TAIL_LIMIT) });
    });
  });
}

function requiredEnvironmentNames(api: ApiDefinition): string[] {
  return [api.credential.name, ...(api.environment?.map((requirement) => requirement.name) ?? [])];
}

function expandEnvironmentUrl(template: string, environment: NodeJS.ProcessEnv): string {
  return template.replaceAll(/{{([A-Z][A-Z0-9_]*)}}/g, (_match, name: string) => {
    const value = environment[name];
    if (!value) throw new Error(`Environment variable ${name} is not available to this process.`);
    return encodeURIComponent(value);
  });
}

function injectCredential(url: URL, headers: Headers, placement: ApiDefinition["credential"]["placement"], value: string): void {
  if (placement.type === "header") {
    headers.set(placement.name, value);
  } else if (placement.type === "bearer") {
    headers.set("Authorization", `Bearer ${value}`);
  } else {
    url.searchParams.set(placement.name, value);
  }
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

function networkError(error: unknown, valuesToRedact: Array<string | undefined>): HealthError {
  if (error instanceof Error && error.name === "AbortError") {
    return { category: "timeout", message: "The minimal probe timed out." };
  }
  const rawMessage = error instanceof Error ? error.message : "The network request failed.";
  let message = rawMessage;
  for (const value of valuesToRedact) {
    if (value) message = message.replaceAll(value, "[redacted]");
  }
  message = message.slice(0, 240);
  return { category: "network", message: message || "The network request failed." };
}
