import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { AppError } from "./errors.js";
import { getApi, loadRegistry, parseConfigFile, upsertApi, upsertGroup, validateApi, validateGroup } from "./config.js";
import {
  SCHEMA_VERSION,
  type ApiDefinition,
  type ApiTemplate,
  type ConfigPaths,
  type GroupDefinition,
  type GroupTemplate,
  type TemplateCredentialReference
} from "./types.js";

export interface TemplateCatalog {
  groups: GroupTemplate[];
  apis: ApiTemplate[];
}

export async function loadTemplateCatalog(): Promise<TemplateCatalog> {
  const root = fileURLToPath(new URL("../templates/", import.meta.url));
  const [groupFiles, apiFiles] = await Promise.all([readTemplateFiles(join(root, "groups")), readTemplateFiles(join(root, "apis"))]);
  const groups = groupFiles.map(({ value, source }) => validateGroupTemplate(value, source)).sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  const apis = apiFiles.map(({ value, source }) => validateApiTemplate(value, source)).sort((left, right) => left.name.localeCompare(right.name));
  const groupIds = new Set(groups.map((group) => group.id));
  for (const api of apis) {
    if (!groupIds.has(api.group)) throw new AppError("invalid_template", `${api.id} references unknown template group ${api.group}.`);
  }
  return { groups, apis };
}

export async function getApiTemplate(templateId: string): Promise<ApiTemplate> {
  const template = (await loadTemplateCatalog()).apis.find((api) => api.id === templateId);
  if (!template) throw new AppError("template_not_found", `No built-in API template with ID ${templateId}.`);
  return template;
}

export async function instantiateApiTemplate(
  paths: ConfigPaths,
  templateId: string,
  configuredAt: string,
  credentialName?: string
): Promise<ApiDefinition> {
  if (!configuredAt.trim()) throw new AppError("invalid_argument", "--configured-at must not be empty.");
  const catalog = await loadTemplateCatalog();
  const template = catalog.apis.find((api) => api.id === templateId);
  if (!template) throw new AppError("template_not_found", `No built-in API template with ID ${templateId}.`);

  const registry = await loadRegistry(paths);
  if (!registry.groups.some((group) => group.id === template.group)) {
    const groupTemplate = catalog.groups.find((group) => group.id === template.group);
    if (!groupTemplate) throw new AppError("invalid_template", `Template ${template.id} references unavailable group ${template.group}.`);
    await upsertGroup(paths, materializeGroup(groupTemplate));
  }

  const api: ApiDefinition = {
    ...template,
    kind: "api",
    credential: {
      type: "environment",
      name: credentialName ?? template.credential.defaultName,
      configuredAt,
      placement: template.credential.placement
    }
  };

  return upsertApi(paths, validateApi(api, `template:${template.id}`));
}

export async function compareTemplateWithConfigured(paths: ConfigPaths, templateId: string): Promise<{ template: ApiTemplate; configured: ApiDefinition | null }> {
  const template = await getApiTemplate(templateId);
  const registry = await loadRegistry(paths);
  return { template, configured: registry.apis.find((api) => api.id === templateId) ?? null };
}

export function validateGroupTemplate(value: unknown, source = "group template"): GroupTemplate {
  const raw = asRecord(value, source);
  if (raw.kind !== "group-template") throw new AppError("invalid_template", `${source}.kind must equal group-template.`);
  const materialized = validateGroup({ ...raw, kind: "group" }, source);
  return { ...materialized, kind: "group-template" };
}

export function validateApiTemplate(value: unknown, source = "API template"): ApiTemplate {
  const raw = asRecord(value, source);
  if (raw.kind !== "api-template") throw new AppError("invalid_template", `${source}.kind must equal api-template.`);
  const credential = validateTemplateCredential(raw.credential, `${source}.credential`);
  const materialized = validateApi(
    {
      ...raw,
      kind: "api",
      credential: {
        type: "environment",
        name: credential.defaultName,
        configuredAt: "built-in-template",
        placement: credential.placement
      }
    },
    source
  );
  return { ...materialized, kind: "api-template", credential };
}

function materializeGroup(template: GroupTemplate): GroupDefinition {
  return { ...template, kind: "group" };
}

function validateTemplateCredential(value: unknown, source: string): TemplateCredentialReference {
  const raw = asRecord(value, source);
  if (raw.type !== "environment") throw new AppError("invalid_template", `${source}.type must equal environment.`);
  const defaultName = raw.defaultName;
  if (typeof defaultName !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(defaultName)) {
    throw new AppError("invalid_template", `${source}.defaultName must be an uppercase environment variable name.`);
  }
  const placement = raw.placement;
  if (!placement || typeof placement !== "object" || Array.isArray(placement)) {
    throw new AppError("invalid_template", `${source}.placement must be an object.`);
  }
  const placementRecord = placement as Record<string, unknown>;
  if (placementRecord.type === "bearer") return { type: "environment", defaultName, placement: { type: "bearer" } };
  if ((placementRecord.type === "header" || placementRecord.type === "query") && typeof placementRecord.name === "string" && placementRecord.name) {
    return {
      type: "environment",
      defaultName,
      placement: { type: placementRecord.type, name: placementRecord.name }
    };
  }
  throw new AppError("invalid_template", `${source}.placement must be header, bearer, or query.`);
}

async function readTemplateFiles(directory: string): Promise<Array<{ value: unknown; source: string }>> {
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".yaml") || name.endsWith(".yml")).sort();
    return Promise.all(names.map(async (name) => ({ value: await parseConfigFile(join(directory, name)), source: join(directory, name) })));
  } catch (error: unknown) {
    throw new AppError("template_read_error", `Could not load built-in templates from ${directory}.`, error instanceof Error ? error.message : undefined);
  }
}

function asRecord(value: unknown, source: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("invalid_template", `${source} must be an object.`);
  return value as Record<string, unknown>;
}
