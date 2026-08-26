import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { withTempPaths } from "./helpers.js";

const run = promisify(execFile);
const cliPath = fileURLToPath(new URL("../cli.js", import.meta.url));

test("CLI exposes templates, materializes an API, and returns a structured missing-credential health result", async () => {
  await withTempPaths(async (paths) => {
    const env: NodeJS.ProcessEnv = { ...process.env, AGENTPULSE_CONFIG_DIR: paths.configDir, AGENTPULSE_STATE_DIR: paths.stateDir };
    delete env.BRAVE_SEARCH_API_KEY;

    const templates = await run(process.execPath, [cliPath, "templates", "--group", "search", "--json"], { env });
    const templateEnvelope = JSON.parse(templates.stdout) as { schemaVersion: number; data: { templates: Array<{ id: string }> } };
    assert.equal(templateEnvelope.schemaVersion, 1);
    assert.equal(templateEnvelope.data.templates.length, 6);

    const context = await run(process.execPath, [cliPath, "context", "--json"], { env });
    const contextEnvelope = JSON.parse(context.stdout) as { data: { text: string } };
    assert.match(contextEnvelope.data.text, /agentpulse groups --json/);

    const add = await run(
      process.execPath,
      [cliPath, "api", "add", "--template", "brave-search", "--configured-at", "~/.zshenv", "--json"],
      { env }
    );
    const addEnvelope = JSON.parse(add.stdout) as { data: { id: string } };
    assert.equal(addEnvelope.data.id, "brave-search");

    const health = await run(process.execPath, [cliPath, "group", "search", "--health", "--json"], { env });
    const healthEnvelope = JSON.parse(health.stdout) as {
      data: { apis: Array<{ health: { status: string; error?: { category: string } } }> };
    };
    assert.equal(healthEnvelope.data.apis[0]?.health.status, "misconfigured");
    assert.equal(healthEnvelope.data.apis[0]?.health.error?.category, "credential_missing");

    await assert.rejects(
      run(process.execPath, [cliPath, "api", "not-configured", "--json"], { env }),
      (error: unknown) => {
        const result = error as { stderr?: string };
        const envelope = JSON.parse(result.stderr ?? "{}") as { errors?: Array<{ code?: string }> };
        return envelope.errors?.[0]?.code === "not_found";
      }
    );
  });
});

test("CLI exposes and configures the Cloudflare GPT Image 2 template", async () => {
  await withTempPaths(async (paths) => {
    const env: NodeJS.ProcessEnv = { ...process.env, AGENTPULSE_CONFIG_DIR: paths.configDir, AGENTPULSE_STATE_DIR: paths.stateDir };
    delete env.CLOUDFLARE_ACCOUNT_ID;
    delete env.CLOUDFLARE_API_TOKEN;

    const templates = await run(process.execPath, [cliPath, "templates", "--group", "image-generation", "--json"], { env });
    const templateEnvelope = JSON.parse(templates.stdout) as {
      data: { groups: Array<{ id: string }>; templates: Array<{ id: string; defaultCredentialEnv: string; requiredEnvironment: string[] }> };
    };
    assert.deepEqual(templateEnvelope.data.groups.map((group) => group.id), ["image-generation"]);
    const template = templateEnvelope.data.templates[0];
    assert.equal(template?.id, "cloudflare-gpt-image-2");
    assert.equal(template?.defaultCredentialEnv, "CLOUDFLARE_API_TOKEN");
    assert.deepEqual(template?.requiredEnvironment, ["CLOUDFLARE_ACCOUNT_ID"]);

    await run(
      process.execPath,
      [cliPath, "api", "add", "--template", "cloudflare-gpt-image-2", "--configured-at", "~/.zshenv", "--json"],
      { env }
    );

    const health = await run(process.execPath, [cliPath, "group", "image-generation", "--health", "--json"], { env });
    const healthEnvelope = JSON.parse(health.stdout) as {
      data: { apis: Array<{ environment: Array<{ name: string; availableToProcess: boolean }>; health: { status: string; error?: { message: string } } }> };
    };
    assert.equal(healthEnvelope.data.apis[0]?.health.status, "misconfigured");
    assert.match(healthEnvelope.data.apis[0]?.health.error?.message ?? "", /CLOUDFLARE_API_TOKEN.*CLOUDFLARE_ACCOUNT_ID/);
    assert.deepEqual(healthEnvelope.data.apis[0]?.environment, [
      { name: "CLOUDFLARE_ACCOUNT_ID", configuredAt: "~/.zshenv", description: "Cloudflare account ID used in the AI Gateway request path.", availableToProcess: false }
    ]);
  });
});
