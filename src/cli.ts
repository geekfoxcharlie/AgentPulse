#!/usr/bin/env node
import { addOrUpdateApiFromFile, addOrUpdateGroupFromFile, getApi, loadRegistry, setApiEnabled } from "./lib/config.js";
import { agentContext } from "./lib/context.js";
import { asAppError, AppError } from "./lib/errors.js";
import { checkGroupHealth, getCachedHealthSnapshots } from "./lib/health.js";
import { resolvePaths } from "./lib/paths.js";
import { apiView, groupView, groupsView } from "./lib/query.js";
import { instantiateApiTemplate, loadTemplateCatalog } from "./lib/templates.js";
import { SCHEMA_VERSION, type CliEnvelope } from "./lib/types.js";
import { startWebServer } from "./web/server.js";

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const json = rawArgs.includes("--json");
  const args = rawArgs.filter((argument) => argument !== "--json");
  const paths = resolvePaths();
  const command = args[0] ?? "help";

  try {
    if (command === "help" || command === "--help" || command === "-h") {
      printHelp();
      return;
    }
    if (command === "context") {
      printSuccess("context", { text: agentContext() }, json);
      return;
    }
    if (command === "groups") {
      const registry = await loadRegistry(paths);
      printSuccess("groups", await groupsView(registry, paths), json);
      return;
    }
    if (command === "templates") {
      const groupId = option(args, "--group");
      const catalog = await loadTemplateCatalog();
      const groups = groupId ? catalog.groups.filter((group) => group.id === groupId) : catalog.groups;
      if (groupId && groups.length === 0) throw new AppError("not_found", `No built-in template group with ID ${groupId}.`);
      const templates = (groupId ? catalog.apis.filter((api) => api.group === groupId) : catalog.apis).map((api) => ({
        id: api.id,
        name: api.name,
        group: api.group,
        description: api.description,
        defaultCredentialEnv: api.credential.defaultName,
        docsUrl: api.service.docsUrl,
        probe: { method: api.probe.method, url: api.probe.url }
      }));
      printSuccess("templates", { groups, templates }, json);
      return;
    }
    if (command === "group") {
      await handleGroupCommand(args.slice(1), json, paths);
      return;
    }
    if (command === "api") {
      await handleApiCommand(args.slice(1), json, paths);
      return;
    }
    if (command === "validate") {
      const [registry, catalog] = await Promise.all([loadRegistry(paths), loadTemplateCatalog()]);
      printSuccess("validate", { valid: true, groups: registry.groups.length, apis: registry.apis.length, templates: catalog.apis.length }, json);
      return;
    }
    if (command === "web") {
      if (json) throw new AppError("invalid_argument", "The web command does not support --json.");
      const port = option(args, "--port") ? parsePort(requiredOption(args, "--port")) : 4123;
      const { url } = await startWebServer(paths, port);
      process.stdout.write(`AgentPulse read-only web page: ${url}\nPress Ctrl+C to stop.\n`);
      return;
    }
    throw new AppError("unknown_command", `Unknown command: ${command}.`);
  } catch (error: unknown) {
    printError(command, asAppError(error), json);
  }
}

async function handleGroupCommand(args: string[], json: boolean, paths: ReturnType<typeof resolvePaths>): Promise<void> {
  const action = args[0];
  if (!action) throw new AppError("invalid_argument", "A group ID or group command is required.");

  if (action === "add") {
    const group = await addOrUpdateGroupFromFile(paths, requiredOption(args, "--file"));
    printSuccess("group.add", group, json);
    return;
  }
  if (action === "update") {
    const groupId = requiredPositional(args, 1, "A group ID is required for update.");
    const group = await addOrUpdateGroupFromFile(paths, requiredOption(args, "--file"), groupId);
    printSuccess("group.update", group, json);
    return;
  }

  const registry = await loadRegistry(paths);
  const health = args.includes("--health") ? await checkGroupHealth(registry, action, paths) : await getCachedHealthSnapshots(registry, paths);
  printSuccess("group", await groupView(registry, action, paths, health), json);
}

async function handleApiCommand(args: string[], json: boolean, paths: ReturnType<typeof resolvePaths>): Promise<void> {
  const action = args[0];
  if (!action) throw new AppError("invalid_argument", "An API ID or API command is required.");

  if (action === "add") {
    const templateId = option(args, "--template");
    if (templateId) {
      const api = await instantiateApiTemplate(paths, templateId, requiredOption(args, "--configured-at"), option(args, "--credential-env"));
      printSuccess("api.add", api, json);
      return;
    }
    const api = await addOrUpdateApiFromFile(paths, requiredOption(args, "--file"));
    printSuccess("api.add", api, json);
    return;
  }
  if (action === "update") {
    const apiId = requiredPositional(args, 1, "An API ID is required for update.");
    const api = await addOrUpdateApiFromFile(paths, requiredOption(args, "--file"), apiId);
    printSuccess("api.update", api, json);
    return;
  }
  if (action === "enable" || action === "disable") {
    const apiId = requiredPositional(args, 1, `An API ID is required for ${action}.`);
    const api = await setApiEnabled(paths, apiId, action === "enable");
    printSuccess(`api.${action}`, api, json);
    return;
  }

  const api = await getApi(paths, action);
  printSuccess("api", await apiView(api, paths), json);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new AppError("invalid_argument", `${name} requires a value.`);
  return value;
}

function requiredOption(args: string[], name: string): string {
  return option(args, name) ?? (() => { throw new AppError("invalid_argument", `${name} is required.`); })();
}

function requiredPositional(args: string[], index: number, message: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new AppError("invalid_argument", message);
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError("invalid_argument", "--port must be an integer from 1 to 65535.");
  return port;
}

function printSuccess(command: string, data: unknown, json: boolean): void {
  if (json) {
    const envelope: CliEnvelope<unknown> = { schemaVersion: SCHEMA_VERSION, command, generatedAt: new Date().toISOString(), data, errors: [] };
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderHuman(command, data)}\n`);
}

function printError(command: string, error: AppError, json: boolean): void {
  process.exitCode = 1;
  if (json) {
    const envelope: CliEnvelope<null> = {
      schemaVersion: SCHEMA_VERSION,
      command,
      generatedAt: new Date().toISOString(),
      data: null,
      errors: [error.toJson()]
    };
    process.stderr.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }
  process.stderr.write(`${error.code}: ${error.message}\n`);
}

function renderHuman(command: string, data: unknown): string {
  if (command === "context") return (data as { text: string }).text;
  if (command === "groups") {
    const groups = data as Awaited<ReturnType<typeof groupsView>>;
    return groups.length === 0 ? "No configured groups. Run `agentpulse templates --group search`." : groups.map((group) => `${group.id}\t${group.name}\t${group.apiCount} APIs\t${group.health.healthy} healthy / ${group.health.unhealthy} unhealthy / ${group.health.misconfigured} needs configuration`).join("\n");
  }
  if (command === "templates") {
    const result = data as { templates: Array<{ id: string; name: string; group: string; defaultCredentialEnv: string }> };
    return result.templates.map((template) => `${template.id}\t${template.name}\t${template.group}\t${template.defaultCredentialEnv}`).join("\n");
  }
  if (command === "group") {
    const result = data as Awaited<ReturnType<typeof groupView>>;
    return [`${result.group.name} (${result.group.id})`, ...result.apis.map((api) => `  ${api.id}\t${api.health.status}\t${api.credential.name}`)].join("\n");
  }
  if (command === "api") {
    const api = data as Awaited<ReturnType<typeof apiView>>;
    return `${api.name} (${api.id})\n${api.description}\nCredential: ${api.credential.name} at ${api.credential.configuredAt}\nHealth: ${api.health.status}\nDocs: ${api.service.docsUrl}\n\n${api.usage.example}`;
  }
  if (command === "validate") return `Configuration valid: ${JSON.stringify(data)}`;
  if (command.startsWith("api.") || command.startsWith("group.")) return `Updated: ${(data as { id: string }).id}`;
  return JSON.stringify(data, null, 2);
}

function printHelp(): void {
  process.stdout.write(`AgentPulse — local API field manual

Query
  agentpulse groups [--json]
  agentpulse group <group-id> [--health] [--json]
  agentpulse api <api-id> [--json]
  agentpulse templates [--group <group-id>] [--json]
  agentpulse context [--json]

Configure
  agentpulse group add --file <path>
  agentpulse group update <group-id> --file <path>
  agentpulse api add --template <template-id> --configured-at <path> [--credential-env <name>]
  agentpulse api add --file <path>
  agentpulse api update <api-id> --file <path>
  agentpulse api enable|disable <api-id>
  agentpulse validate [--json]

View
  agentpulse web [--port <port>]
`);
}

void main();
