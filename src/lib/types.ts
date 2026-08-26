export const SCHEMA_VERSION = 1 as const;

export type HttpMethod = "GET" | "POST";
export type CredentialPlacement =
  | { type: "header"; name: string }
  | { type: "bearer" }
  | { type: "query"; name: string };

export interface CredentialReference {
  type: "environment";
  name: string;
  configuredAt: string;
  placement: CredentialPlacement;
}

export interface TemplateCredentialReference {
  type: "environment";
  defaultName: string;
  placement: CredentialPlacement;
}

export interface EnvironmentRequirement {
  name: string;
  configuredAt: string;
  description: string;
  placement?: CredentialPlacement;
}

export interface TemplateEnvironmentRequirement {
  defaultName: string;
  description: string;
  placement?: CredentialPlacement;
}

export interface ProbeAssertion {
  path: string;
  exists?: boolean;
  equals?: string | number | boolean | null;
}

export interface ProbeDefinition {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: Record<string, unknown>;
  expectedStatus: number[];
  assertions?: ProbeAssertion[];
  timeoutMs: number;
}

export interface UsageDefinition {
  notes: string;
  example: string;
}

export interface ServiceDefinition {
  baseUrl: string;
  docsUrl: string;
}

export interface GroupDefinition {
  schemaVersion: typeof SCHEMA_VERSION;
  kind: "group";
  id: string;
  name: string;
  description: string;
  order?: number;
}

export interface GroupTemplate extends Omit<GroupDefinition, "kind"> {
  kind: "group-template";
}

export interface ApiDefinition {
  schemaVersion: typeof SCHEMA_VERSION;
  kind: "api";
  id: string;
  name: string;
  group: string;
  description: string;
  enabled: boolean;
  service: ServiceDefinition;
  credential: CredentialReference;
  environment?: EnvironmentRequirement[];
  probe: ProbeDefinition;
  usage: UsageDefinition;
}

export interface ApiTemplate extends Omit<ApiDefinition, "kind" | "credential" | "environment"> {
  kind: "api-template";
  credential: TemplateCredentialReference;
  environment?: TemplateEnvironmentRequirement[];
}

export interface Registry {
  groups: GroupDefinition[];
  apis: ApiDefinition[];
}

export type HealthStatus = "healthy" | "unhealthy" | "misconfigured" | "disabled" | "unknown";

export interface HealthError {
  category:
    | "credential_missing"
    | "authentication"
    | "rate_limited"
    | "http"
    | "timeout"
    | "network"
    | "response_validation";
  message: string;
  statusCode?: number;
}

export interface HealthEntry {
  apiId: string;
  fingerprint: string;
  status: Exclude<HealthStatus, "disabled" | "unknown">;
  checkedAt: string;
  expiresAt: string;
  latencyMs?: number;
  credentialPresent: boolean;
  error?: HealthError;
}

export interface HealthState {
  schemaVersion: typeof SCHEMA_VERSION;
  entries: Record<string, HealthEntry>;
}

export interface HealthSnapshot {
  status: HealthStatus;
  checkedAt: string | null;
  expiresAt: string | null;
  isExpired: boolean;
  latencyMs?: number;
  error?: HealthError;
}

export interface ConfigPaths {
  configDir: string;
  groupsDir: string;
  apisDir: string;
  stateDir: string;
  healthCachePath: string;
}

export interface CliEnvelope<T> {
  schemaVersion: typeof SCHEMA_VERSION;
  command: string;
  generatedAt: string;
  data: T | null;
  errors: Array<{ code: string; message: string; details?: unknown }>;
}
