import { getGroup } from "./config.js";
import { getCachedHealthSnapshots } from "./health.js";
import type { ApiDefinition, CliDefinition, ConfigPaths, HealthSnapshot, Registry, SiteDefinition } from "./types.js";

export interface CliView {
  id: string;
  name: string;
  group: string;
  description: string;
  enabled: boolean;
  command: string;
  docsUrl: string;
  install: CliDefinition["install"];
  probe: {
    args: string[];
    expectedExit: number;
    timeoutMs: number;
  };
  usage: CliDefinition["usage"];
  health: HealthSnapshot;
}

export interface SiteView {
  id: string;
  name: string;
  group: string;
  description: string;
  enabled: boolean;
  url: string;
  docsUrl: string;
  login: SiteDefinition["login"];
  usage: SiteDefinition["usage"];
  health: HealthSnapshot;
}

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
  environment: Array<{
    name: string;
    configuredAt: string;
    description: string;
    placement?: ApiDefinition["credential"]["placement"];
    availableToProcess: boolean;
  }>;
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
  const snapshot = health ?? (await getCachedHealthSnapshots({ groups: [], apis: [api], clis: [], sites: [] }, paths))[api.id];
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
    environment: (api.environment ?? []).map((requirement) => ({
      ...requirement,
      availableToProcess: Boolean(process.env[requirement.name])
    })),
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

export async function cliView(cli: CliDefinition, paths: ConfigPaths, health?: HealthSnapshot): Promise<CliView> {
  const snapshot = health ?? (await getCachedHealthSnapshots({ groups: [], apis: [], clis: [cli], sites: [] }, paths))[cli.id];
  return {
    id: cli.id,
    name: cli.name,
    group: cli.group,
    description: cli.description,
    enabled: cli.enabled,
    command: cli.command,
    docsUrl: cli.docsUrl,
    install: cli.install,
    probe: {
      args: cli.probe.args,
      expectedExit: cli.probe.expectedExit,
      timeoutMs: cli.probe.timeoutMs
    },
    usage: cli.usage,
    health: snapshot ?? { status: "unknown", checkedAt: null, expiresAt: null, isExpired: false }
  };
}

export async function siteView(site: SiteDefinition, paths: ConfigPaths, health?: HealthSnapshot): Promise<SiteView> {
  const snapshot = health ?? (await getCachedHealthSnapshots({ groups: [], apis: [], clis: [], sites: [site] }, paths))[site.id];
  return {
    id: site.id,
    name: site.name,
    group: site.group,
    description: site.description,
    enabled: site.enabled,
    url: site.url,
    docsUrl: site.docsUrl,
    login: site.login,
    usage: site.usage,
    health: snapshot ?? { status: "unknown", checkedAt: null, expiresAt: null, isExpired: false }
  };
}

export async function groupView(
  registry: Registry,
  groupId: string,
  paths: ConfigPaths,
  healthByApi?: Record<string, HealthSnapshot>
): Promise<{ group: Registry["groups"][number]; apis: ApiView[]; clis: CliView[]; sites: SiteView[] }> {
  const group = getGroup(registry, groupId);
  const apis = registry.apis.filter((api) => api.group === groupId);
  const clis = registry.clis.filter((cli) => cli.group === groupId);
  const sites = registry.sites.filter((site) => site.group === groupId);
  return {
    group,
    apis: await Promise.all(apis.map((api) => apiView(api, paths, healthByApi?.[api.id]))),
    clis: await Promise.all(clis.map((cli) => cliView(cli, paths, healthByApi?.[cli.id]))),
    sites: await Promise.all(sites.map((site) => siteView(site, paths, healthByApi?.[site.id])))
  };
}

export async function groupsView(registry: Registry, paths: ConfigPaths): Promise<Array<{ id: string; name: string; description: string; order?: number; apiCount: number; cliCount: number; siteCount: number; health: Record<string, number> }>> {
  const health = await getCachedHealthSnapshots(registry, paths);
  return registry.groups.map((group) => {
    const apis = registry.apis.filter((api) => api.group === group.id);
    const clis = registry.clis.filter((cli) => cli.group === group.id);
    const sites = registry.sites.filter((site) => site.group === group.id);
    const counts: Record<string, number> = { healthy: 0, unhealthy: 0, misconfigured: 0, disabled: 0, unknown: 0, stale: 0 };
    for (const entry of [...apis, ...clis]) {
      const status = health[entry.id]?.status ?? "unknown";
      counts[status] = (counts[status] ?? 0) + 1;
      if (health[entry.id]?.isExpired) counts.stale = (counts.stale ?? 0) + 1;
    }
    for (const site of sites) {
      if (!site.enabled) counts.disabled = (counts.disabled ?? 0) + 1;
    }
    const item = { id: group.id, name: group.name, description: group.description, apiCount: apis.length, cliCount: clis.length, siteCount: sites.length, health: counts };
    return group.order === undefined ? item : { ...item, order: group.order };
  });
}
