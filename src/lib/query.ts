import { getGroup } from "./config.js";
import { getCachedHealthSnapshots } from "./health.js";
import type { ApiDefinition, ConfigPaths, HealthSnapshot, Registry } from "./types.js";

export interface ApiView {
  id: string;
  name: string;
  group: string;
  description: string;
  enabled: boolean;
  service: ApiDefinition["service"];
  credential: {
    type: "environment";
    name: string;
    configuredAt: string;
    placement: ApiDefinition["credential"]["placement"];
    availableToProcess: boolean;
  };
  probe: {
    method: ApiDefinition["probe"]["method"];
    url: string;
    expectedStatus: number[];
    timeoutMs: number;
  };
  usage: ApiDefinition["usage"];
  health: HealthSnapshot;
}

export async function apiView(api: ApiDefinition, paths: ConfigPaths, health?: HealthSnapshot): Promise<ApiView> {
  const snapshot = health ?? (await getCachedHealthSnapshots({ groups: [], apis: [api] }, paths))[api.id];
  return {
    id: api.id,
    name: api.name,
    group: api.group,
    description: api.description,
    enabled: api.enabled,
    service: api.service,
    credential: {
      type: "environment",
      name: api.credential.name,
      configuredAt: api.credential.configuredAt,
      placement: api.credential.placement,
      availableToProcess: Boolean(process.env[api.credential.name])
    },
    probe: {
      method: api.probe.method,
      url: api.probe.url,
      expectedStatus: api.probe.expectedStatus,
      timeoutMs: api.probe.timeoutMs
    },
    usage: api.usage,
    health: snapshot ?? { status: "unknown", checkedAt: null, expiresAt: null, isExpired: false }
  };
}

export async function groupView(
  registry: Registry,
  groupId: string,
  paths: ConfigPaths,
  healthByApi?: Record<string, HealthSnapshot>
): Promise<{ group: Registry["groups"][number]; apis: ApiView[] }> {
  const group = getGroup(registry, groupId);
  const apis = registry.apis.filter((api) => api.group === groupId);
  return {
    group,
    apis: await Promise.all(apis.map((api) => apiView(api, paths, healthByApi?.[api.id])))
  };
}

export async function groupsView(registry: Registry, paths: ConfigPaths): Promise<Array<{ id: string; name: string; description: string; order?: number; apiCount: number; health: Record<string, number> }>> {
  const health = await getCachedHealthSnapshots(registry, paths);
  return registry.groups.map((group) => {
    const apis = registry.apis.filter((api) => api.group === group.id);
    const counts: Record<string, number> = { healthy: 0, unhealthy: 0, misconfigured: 0, disabled: 0, unknown: 0, stale: 0 };
    for (const api of apis) {
      const status = health[api.id]?.status ?? "unknown";
      counts[status] = (counts[status] ?? 0) + 1;
      if (health[api.id]?.isExpired) counts.stale = (counts.stale ?? 0) + 1;
    }
    const item = { id: group.id, name: group.name, description: group.description, apiCount: apis.length, health: counts };
    return group.order === undefined ? item : { ...item, order: group.order };
  });
}
