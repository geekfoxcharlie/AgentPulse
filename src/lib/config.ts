import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse, stringify } from "yaml";
import { AppError } from "./errors.js";
import { validateSchema } from "./schema.js";
import { invalidateHealthEntry, atomicWrite } from "./state.js";
import {
  SCHEMA_VERSION,
  type ApiDefinition,
  type CliDefinition,
  type ConfigPaths,
  type CredentialPlacement,
  type EnvironmentRequirement,
  type GroupDefinition,
  type HttpMethod,
  type ProbeAssertion,
  type ProbeDefinition,
  type Registry
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

export async function loadRegistry(paths: ConfigPaths): Promise<Registry> {
  const [groupFiles, apiFiles, cliFiles] = await Promise.all([
    readYamlFiles(paths.groupsDir),
    readYamlFiles(paths.apisDir),
    readYamlFiles(paths.clisDir)
  ]);
  const groups = groupFiles.map(({ value, source }) => validateGroup(value, source));
  const apis = apiFiles.map(({ value, source }) => validateApi(value, source));
  const clis = cliFiles.map(({ value, source }) => validateCli(value, source));
  validateRegistryData({ groups, apis, clis });
  return {
    groups: groups.sort(compareByOrderThenName),
    apis: apis.sort((left, right) => left.name.localeCompare(right.name)),
    clis: clis.sort((left, right) => left.name.localeCompare(right.name))
  };
}

export function validateRegistryData(registry: Registry): void {
  const issues: Array<{ path: string; message: string }> = [];
  const groupIds = new Set<string>();
  const apiIds = new Set<string>();
  const cliIds = new Set<string>();

  for (const group of registry.groups) {
    if (groupIds.has(group.id)) issues.push({ path: `groups.${group.id}`, message: "Duplicate group ID." });
    groupIds.add(group.id);
  }

  for (const api of registry.apis) {
    if (apiIds.has(api.id)) issues.push({ path: `apis.${api.id}`, message: "Duplicate API ID." });
    apiIds.add(api.id);
    if (!groupIds.has(api.group)) {
      issues.push({ path: `apis.${api.id}.group`, message: `Unknown group ID: ${api.group}.` });
    }
  }

  for (const cli of registry.clis) {
    if (cliIds.has(cli.id)) issues.push({ path: `clis.${cli.id}`, message: "Duplicate CLI capability ID." });
    cliIds.add(cli.id);
    if (apiIds.has(cli.id)) {
      issues.push({ path: `clis.${cli.id}.id`, message: `ID is already used by an API: ${cli.id}.` });
    }
    if (!groupIds.has(cli.group)) {
      issues.push({ path: `clis.${cli.id}.group`, message: `Unknown group ID: ${cli.group}.` });
    }
  }

  if (issues.length > 0) throw new AppError("invalid_config", "AgentPulse configuration is invalid.", issues);
}

export async function parseConfigFile(filePath: string): Promise<unknown> {
  try {
    return parse(await readFile(filePath, "utf8"));
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    throw new AppError("invalid_config_file", `Could not read ${filePath}.`, error instanceof Error ? error.message : undefined);
  }
}

export async function addOrUpdateGroupFromFile(paths: ConfigPaths, filePath: string, expectedId?: string): Promise<GroupDefinition> {
  const group = validateGroup(await parseConfigFile(filePath), filePath);
  if (expectedId && group.id !== expectedId) {
    throw new AppError("id_mismatch", `Group file ID ${group.id} does not match requested ID ${expectedId}.`);
  }
  return upsertGroup(paths, group);
}

export async function addOrUpdateApiFromFile(paths: ConfigPaths, filePath: string, expectedId?: string): Promise<ApiDefinition> {
  const api = validateApi(await parseConfigFile(filePath), filePath);
  if (expectedId && api.id !== expectedId) {
    throw new AppError("id_mismatch", `API file ID ${api.id} does not match requested ID ${expectedId}.`);
  }
  return upsertApi(paths, api);
}

export async function addOrUpdateCliFromFile(paths: ConfigPaths, filePath: string, expectedId?: string): Promise<CliDefinition> {
  const cli = validateCli(await parseConfigFile(filePath), filePath);
  if (expectedId && cli.id !== expectedId) {
    throw new AppError("id_mismatch", `CLI capability file ID ${cli.id} does not match requested ID ${expectedId}.`);
  }
  return upsertCli(paths, cli);
}

export async function upsertGroup(paths: ConfigPaths, group: GroupDefinition): Promise<GroupDefinition> {
  const registry = await loadRegistry(paths);
  const groups = replaceById(registry.groups, group);
  validateRegistryData({ groups, apis: registry.apis, clis: registry.clis });
  await atomicWrite(join(paths.groupsDir, `${group.id}.yaml`), stringify(group));
  return group;
}

export async function upsertApi(paths: ConfigPaths, api: ApiDefinition): Promise<ApiDefinition> {
  const registry = await loadRegistry(paths);
  const apis = replaceById(registry.apis, api);
  validateRegistryData({ groups: registry.groups, apis, clis: registry.clis });
  await atomicWrite(join(paths.apisDir, `${api.id}.yaml`), stringify(api));
  await invalidateHealthEntry(paths, api.id);
  return api;
}

export async function upsertCli(paths: ConfigPaths, cli: CliDefinition): Promise<CliDefinition> {
  const registry = await loadRegistry(paths);
  const clis = replaceById(registry.clis, cli);
  validateRegistryData({ groups: registry.groups, apis: registry.apis, clis });
  await atomicWrite(join(paths.clisDir, `${cli.id}.yaml`), stringify(cli));
  await invalidateHealthEntry(paths, cli.id);
  return cli;
}

export async function setCliEnabled(paths: ConfigPaths, cliId: string, enabled: boolean): Promise<CliDefinition> {
  const registry = await loadRegistry(paths);
  const current = registry.clis.find((cli) => cli.id === cliId);
  if (!current) throw new AppError("not_found", `No configured CLI capability with ID ${cliId}.`);
  return upsertCli(paths, { ...current, enabled });
}

export async function getCli(paths: ConfigPaths, cliId: string): Promise<CliDefinition> {
  const registry = await loadRegistry(paths);
  const cli = registry.clis.find((entry) => entry.id === cliId);
  if (!cli) throw new AppError("not_found", `No configured CLI capability with ID ${cliId}.`);
  return cli;
}

export async function setApiEnabled(paths: ConfigPaths, apiId: string, enabled: boolean): Promise<ApiDefinition> {
  const registry = await loadRegistry(paths);
  const current = registry.apis.find((api) => api.id === apiId);
  if (!current) throw new AppError("not_found", `No configured API with ID ${apiId}.`);
  return upsertApi(paths, { ...current, enabled });
}

export async function getApi(paths: ConfigPaths, apiId: string): Promise<ApiDefinition> {
  const registry = await loadRegistry(paths);
  const api = registry.apis.find((entry) => entry.id === apiId);
  if (!api) throw new AppError("not_found", `No configured API with ID ${apiId}.`);
  return api;
}

export function getGroup(registry: Registry, groupId: string): GroupDefinition {
  const group = registry.groups.find((entry) => entry.id === groupId);
  if (!group) throw new AppError("not_found", `No configured group with ID ${groupId}.`);
  return group;
}

export function validateGroup(value: unknown, source = "group"): GroupDefinition {
  validateSchema("group", value, source);
  const input = asRecord(value, source);
  assertSchemaVersion(input, source);
  assertLiteral(input, "kind", "group", source);
  const group: GroupDefinition = {
    schemaVersion: SCHEMA_VERSION,
    kind: "group",
    id: requiredId(input, "id", source),
    name: requiredString(input, "name", source),
    description: requiredString(input, "description", source)
  };
  const order = optionalNumber(input, "order", source);
  if (order !== undefined) group.order = order;
  return group;
}

export function validateApi(value: unknown, source = "api"): ApiDefinition {
  validateSchema("api", value, source);
  const input = asRecord(value, source);
  assertSchemaVersion(input, source);
  assertLiteral(input, "kind", "api", source);
  const environment = optionalEnvironmentRequirements(input, "environment", source);
  const api: ApiDefinition = {
    schemaVersion: SCHEMA_VERSION,
    kind: "api",
    id: requiredId(input, "id", source),
    name: requiredString(input, "name", source),
    group: requiredId(input, "group", source),
    description: requiredString(input, "description", source),
    enabled: requiredBoolean(input, "enabled", source),
    service: validateService(input.service, `${source}.service`),
    credential: validateCredential(input.credential, `${source}.credential`),
    probe: validateProbe(input.probe, `${source}.probe`),
    usage: validateUsage(input.usage, `${source}.usage`)
  };
  if (environment) api.environment = environment;
  validateEnvironmentPlaceholders(api, source);
  return api;
}

export function validateCli(value: unknown, source = "cli"): CliDefinition {
  validateSchema("cli", value, source);
  const input = asRecord(value, source);
  assertSchemaVersion(input, source);
  assertLiteral(input, "kind", "cli", source);
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "cli",
    id: requiredId(input, "id", source),
    name: requiredString(input, "name", source),
    group: requiredId(input, "group", source),
    description: requiredString(input, "description", source),
    enabled: requiredBoolean(input, "enabled", source),
    command: requiredCommand(input, "command", source),
    docsUrl: requiredUrl(input, "docsUrl", source),
    install: validateCliInstall(input.install, `${source}.install`),
    probe: validateCliProbe(input.probe, `${source}.probe`),
    usage: validateUsage(input.usage, `${source}.usage`)
  };
}

function validateCliInstall(value: unknown, source: string): CliDefinition["install"] {
  const input = asRecord(value, source);
  return {
    method: requiredId(input, "method", source),
    command: requiredString(input, "command", source)
  };
}

function validateCliProbe(value: unknown, source: string): CliDefinition["probe"] {
  const input = asRecord(value, source);
  assertLiteral(input, "type", "cli", source);
  const args = input.args;
  if (!Array.isArray(args) || args.some((item) => typeof item !== "string")) {
    throw invalid(`${source}.args`, "must be an array of strings.");
  }
  const expectedExit = input.expectedExit;
  if (typeof expectedExit !== "number" || !Number.isInteger(expectedExit)) {
    throw invalid(`${source}.expectedExit`, "must be an integer.");
  }
  const timeoutMs = optionalNumber(input, "timeoutMs", source);
  if (timeoutMs === undefined) throw invalid(`${source}.timeoutMs`, "must be a positive number.");
  return { type: "cli", args: [...args], expectedExit, timeoutMs };
}

function requiredCommand(input: UnknownRecord, key: string, source: string): string {
  const value = requiredString(input, key, source);
  if (/\s/.test(value)) throw invalid(`${source}.${key}`, "must be a single executable name or path without whitespace.");
  return value;
}

export function validateService(value: unknown, source: string): ApiDefinition["service"] {
  const input = asRecord(value, source);
  const baseUrl = requiredUrl(input, "baseUrl", source);
  const docsUrl = requiredUrl(input, "docsUrl", source);
  return { baseUrl, docsUrl };
}

export function validateCredential(value: unknown, source: string): ApiDefinition["credential"] {
  const input = asRecord(value, source);
  assertLiteral(input, "type", "environment", source);
  return {
    type: "environment",
    name: requiredEnvName(input, "name", source),
    configuredAt: requiredString(input, "configuredAt", source),
    placement: validatePlacement(input.placement, `${source}.placement`)
  };
}

export function validatePlacement(value: unknown, source: string): CredentialPlacement {
  const input = asRecord(value, source);
  const type = requiredString(input, "type", source);
  if (type === "bearer") return { type };
  if (type === "header" || type === "query") return { type, name: requiredString(input, "name", source) };
  throw invalid(source, "type must be header, bearer, or query.");
}

export function validateProbe(value: unknown, source: string): ProbeDefinition {
  const input = asRecord(value, source);
  const method = requiredString(input, "method", source);
  if (method !== "GET" && method !== "POST") throw invalid(source, "method must be GET or POST.");
  const probe: ProbeDefinition = {
    method: method as HttpMethod,
    url: requiredUrl(input, "url", source),
    expectedStatus: requiredNumberArray(input, "expectedStatus", source),
    timeoutMs: optionalNumber(input, "timeoutMs", source) ?? 10_000
  };
  const headers = optionalStringRecord(input, "headers", source);
  if (headers) probe.headers = headers;
  const query = optionalScalarRecord(input, "query", source);
  if (query) probe.query = query;
  const body = optionalRecord(input, "body", source);
  if (body) probe.body = body;
  const assertions = optionalAssertions(input, "assertions", source);
  if (assertions) probe.assertions = assertions;
  return probe;
}

export function validateUsage(value: unknown, source: string): ApiDefinition["usage"] {
  const input = asRecord(value, source);
  return { notes: requiredString(input, "notes", source), example: requiredString(input, "example", source) };
}

async function readYamlFiles(directory: string): Promise<Array<{ value: unknown; source: string }>> {
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".yaml") || name.endsWith(".yml")).sort();
    return Promise.all(names.map(async (name) => ({ value: await parseConfigFile(join(directory, name)), source: join(directory, name) })));
  } catch (error: unknown) {
    if (isNotFound(error)) return [];
    throw new AppError("config_read_error", `Could not read configuration directory ${directory}.`, error instanceof Error ? error.message : undefined);
  }
}

function replaceById<T extends { id: string }>(entries: T[], replacement: T): T[] {
  const found = entries.some((entry) => entry.id === replacement.id);
  return found ? entries.map((entry) => (entry.id === replacement.id ? replacement : entry)) : [...entries, replacement];
}

function compareByOrderThenName(left: GroupDefinition, right: GroupDefinition): number {
  return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name);
}

function asRecord(value: unknown, source: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(source, "must be an object.");
  return value as UnknownRecord;
}

function assertSchemaVersion(input: UnknownRecord, source: string): void {
  if (input.schemaVersion !== SCHEMA_VERSION) throw invalid(`${source}.schemaVersion`, `must equal ${SCHEMA_VERSION}.`);
}

function assertLiteral(input: UnknownRecord, key: string, expected: string, source: string): void {
  if (input[key] !== expected) throw invalid(`${source}.${key}`, `must equal ${expected}.`);
}

function requiredId(input: UnknownRecord, key: string, source: string): string {
  const value = requiredString(input, key, source);
  if (!/^[a-z][a-z0-9-]*$/.test(value)) throw invalid(`${source}.${key}`, "must use lowercase letters, numbers, and hyphens.");
  return value;
}

function requiredEnvName(input: UnknownRecord, key: string, source: string): string {
  const value = requiredString(input, key, source);
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) throw invalid(`${source}.${key}`, "must be an uppercase environment variable name.");
  return value;
}

function requiredString(input: UnknownRecord, key: string, source: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") throw invalid(`${source}.${key}`, "must be a non-empty string.");
  return value;
}

function requiredBoolean(input: UnknownRecord, key: string, source: string): boolean {
  const value = input[key];
  if (typeof value !== "boolean") throw invalid(`${source}.${key}`, "must be a boolean.");
  return value;
}

function optionalNumber(input: UnknownRecord, key: string, source: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(`${source}.${key}`, "must be a finite number.");
  return value;
}

function requiredUrl(input: UnknownRecord, key: string, source: string): string {
  const value = requiredString(input, key, source);
  try {
    const url = new URL(value.replaceAll(/{{[A-Z][A-Z0-9_]*}}/g, "environment-value"));
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported protocol.");
    return value;
  } catch {
    throw invalid(`${source}.${key}`, "must be a valid HTTP(S) URL.");
  }
}

function optionalEnvironmentRequirements(input: UnknownRecord, key: string, source: string): EnvironmentRequirement[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw invalid(`${source}.${key}`, "must be a non-empty array.");

  const requirements = value.map((item, index) => {
    const requirement = asRecord(item, `${source}.${key}[${index}]`);
    const result: EnvironmentRequirement = {
      name: requiredEnvName(requirement, "name", `${source}.${key}[${index}]`),
      configuredAt: requiredString(requirement, "configuredAt", `${source}.${key}[${index}]`),
      description: requiredString(requirement, "description", `${source}.${key}[${index}]`)
    };
    if (requirement.placement !== undefined) result.placement = validatePlacement(requirement.placement, `${source}.${key}[${index}].placement`);
    return result;
  });

  const names = new Set<string>();
  for (const requirement of requirements) {
    if (names.has(requirement.name)) throw invalid(`${source}.${key}`, `must not repeat environment variable ${requirement.name}.`);
    names.add(requirement.name);
  }
  return requirements;
}

function validateEnvironmentPlaceholders(api: ApiDefinition, source: string): void {
  const placeholderNames = [...api.probe.url.matchAll(/{{([A-Z][A-Z0-9_]*)}}/g)].map((match) => match[1] ?? "");
  const declaredNames = new Set(api.environment?.map((requirement) => requirement.name) ?? []);
  for (const name of placeholderNames) {
    if (!declaredNames.has(name)) {
      throw invalid(`${source}.probe.url`, `references undeclared environment variable ${name}.`);
    }
  }
}

function optionalStringRecord(input: UnknownRecord, key: string, source: string): Record<string, string> | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  const record = asRecord(value, `${source}.${key}`);
  const result: Record<string, string> = {};
  for (const [recordKey, recordValue] of Object.entries(record)) {
    if (typeof recordValue !== "string") throw invalid(`${source}.${key}.${recordKey}`, "must be a string.");
    result[recordKey] = recordValue;
  }
  return result;
}

function optionalScalarRecord(input: UnknownRecord, key: string, source: string): Record<string, string | number | boolean> | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  const record = asRecord(value, `${source}.${key}`);
  const result: Record<string, string | number | boolean> = {};
  for (const [recordKey, recordValue] of Object.entries(record)) {
    if (typeof recordValue !== "string" && typeof recordValue !== "number" && typeof recordValue !== "boolean") {
      throw invalid(`${source}.${key}.${recordKey}`, "must be a string, number, or boolean.");
    }
    result[recordKey] = recordValue;
  }
  return result;
}

function optionalRecord(input: UnknownRecord, key: string, source: string): Record<string, unknown> | undefined {
  const value = input[key];
  return value === undefined ? undefined : asRecord(value, `${source}.${key}`);
}

function requiredNumberArray(input: UnknownRecord, key: string, source: string): number[] {
  const value = input[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "number" || !Number.isInteger(item))) {
    throw invalid(`${source}.${key}`, "must be a non-empty integer array.");
  }
  return [...value] as number[];
}

function optionalAssertions(input: UnknownRecord, key: string, source: string): ProbeAssertion[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw invalid(`${source}.${key}`, "must be an array.");
  return value.map((item, index) => {
    const assertion = asRecord(item, `${source}.${key}[${index}]`);
    const result: ProbeAssertion = { path: requiredString(assertion, "path", `${source}.${key}[${index}]`) };
    if (assertion.exists !== undefined) {
      if (typeof assertion.exists !== "boolean") throw invalid(`${source}.${key}[${index}].exists`, "must be a boolean.");
      result.exists = assertion.exists;
    }
    if (assertion.equals !== undefined) {
      const valueToMatch = assertion.equals;
      if (valueToMatch !== null && !["string", "number", "boolean"].includes(typeof valueToMatch)) {
        throw invalid(`${source}.${key}[${index}].equals`, "must be a string, number, boolean, or null.");
      }
      result.equals = valueToMatch as string | number | boolean | null;
    }
    return result;
  });
}

function invalid(path: string, message: string): AppError {
  return new AppError("invalid_config", `${path} ${message}`, [{ path, message }]);
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
