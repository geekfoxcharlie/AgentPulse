import assert from "node:assert/strict";
import test from "node:test";
import { loadRegistry, upsertApi, validateApi } from "../lib/config.js";
import { createProbeRequest } from "../lib/health.js";
import { instantiateApiTemplate, loadTemplateCatalog } from "../lib/templates.js";
import type { ApiDefinition, ApiTemplate } from "../lib/types.js";
import { withTempPaths } from "./helpers.js";

function materialize(template: ApiTemplate): ApiDefinition {
  const { environment: templateEnvironment, ...templateDefinition } = template;
  const api: ApiDefinition = {
    ...templateDefinition,
    kind: "api",
    credential: {
      type: "environment",
      name: template.credential.defaultName,
      configuredAt: "~/.zshenv",
      placement: template.credential.placement
    }
  };
  if (templateEnvironment) {
    api.environment = templateEnvironment.map((requirement) => ({
      name: requirement.defaultName,
      configuredAt: "~/.zshenv",
      description: requirement.description
    }));
  }
  return api;
}

test("built-in templates cover the search catalog and Cloudflare image generation", async () => {
  const catalog = await loadTemplateCatalog();
  assert.deepEqual(catalog.groups.map((group) => group.id), ["search", "image-generation", "browser"]);
  assert.deepEqual(catalog.apis.map((api) => api.id), [
    "brave-search",
    "cloudflare-gpt-image-2",
    "exa-search",
    "firecrawl-search",
    "serper-google-search",
    "tavily-search",
    "x-api-search-posts"
  ]);

  const requests = Object.fromEntries(
    catalog.apis.map((template) => [
      template.id,
      createProbeRequest(materialize(template), "test-secret", { CLOUDFLARE_ACCOUNT_ID: "account-for-test" })
    ])
  );

  const brave = requests["brave-search"];
  assert.ok(brave);
  assert.equal(new URL(brave.url).hostname, "api.search.brave.com");
  assert.equal(new Headers(brave.init.headers).get("X-Subscription-Token"), "test-secret");
  assert.equal(new URL(brave.url).searchParams.get("count"), "1");

  const tavily = requests["tavily-search"];
  assert.ok(tavily);
  assert.equal(tavily.init.method, "POST");
  assert.equal(new Headers(tavily.init.headers).get("Authorization"), "Bearer test-secret");
  assert.match(String(tavily.init.body), /"max_results":1/);

  const exa = requests["exa-search"];
  assert.ok(exa);
  assert.equal(exa.init.method, "POST");
  assert.equal(new Headers(exa.init.headers).get("x-api-key"), "test-secret");
  assert.match(String(exa.init.body), /"numResults":1/);

  const firecrawl = requests["firecrawl-search"];
  assert.ok(firecrawl);
  assert.equal(firecrawl.init.method, "POST");
  assert.equal(new URL(firecrawl.url).pathname, "/v2/search");
  assert.equal(new Headers(firecrawl.init.headers).get("Authorization"), "Bearer test-secret");
  assert.match(String(firecrawl.init.body), /"limit":1/);

  const serper = requests["serper-google-search"];
  assert.ok(serper);
  assert.equal(serper.init.method, "POST");
  assert.equal(new URL(serper.url).hostname, "google.serper.dev");
  assert.equal(new Headers(serper.init.headers).get("X-API-KEY"), "test-secret");
  assert.match(String(serper.init.body), /"q":"OpenAI"/);

  const xApi = requests["x-api-search-posts"];
  assert.ok(xApi);
  assert.equal(xApi.init.method, "GET");
  assert.equal(new URL(xApi.url).hostname, "api.x.com");
  assert.equal(new URL(xApi.url).pathname, "/2/tweets/search/recent");
  assert.equal(new Headers(xApi.init.headers).get("Authorization"), "Bearer test-secret");
  assert.equal(new URL(xApi.url).searchParams.get("max_results"), "10");

  const cloudflare = requests["cloudflare-gpt-image-2"];
  assert.ok(cloudflare);
  assert.equal(cloudflare.init.method, "GET");
  assert.equal(new URL(cloudflare.url).pathname, "/client/v4/accounts/account-for-test/ai-gateway/gateways");
  assert.equal(new URL(cloudflare.url).searchParams.get("per_page"), "1");
  assert.equal(new Headers(cloudflare.init.headers).get("Authorization"), "Bearer test-secret");
  assert.equal(new Headers(cloudflare.init.headers).get("cf-aig-gateway-id"), null);
  assert.equal(cloudflare.init.body, undefined);
});

test("template instantiation materializes user configuration without a secret", async () => {
  await withTempPaths(async (paths) => {
    const api = await instantiateApiTemplate(paths, "brave-search", "~/.zshenv");
    assert.equal(api.credential.name, "BRAVE_SEARCH_API_KEY");
    assert.equal(api.credential.configuredAt, "~/.zshenv");
    const registry = await loadRegistry(paths);
    assert.deepEqual(registry.groups.map((group) => group.id), ["search"]);
    assert.deepEqual(registry.apis.map((item) => item.id), ["brave-search"]);
  });
});

test("Cloudflare image template materializes its account ID requirement and its group", async () => {
  await withTempPaths(async (paths) => {
    const api = await instantiateApiTemplate(paths, "cloudflare-gpt-image-2", "~/.zshenv");
    assert.equal(api.credential.name, "CLOUDFLARE_API_TOKEN");
    assert.deepEqual(api.environment, [
      {
        name: "CLOUDFLARE_ACCOUNT_ID",
        configuredAt: "~/.zshenv",
        description: "Cloudflare account ID used in the AI Gateway request path."
      }
    ]);
    const registry = await loadRegistry(paths);
    assert.deepEqual(registry.groups.map((group) => group.id), ["image-generation"]);
    assert.deepEqual(registry.apis.map((item) => item.id), ["cloudflare-gpt-image-2"]);
  });
});

test("template URL interpolation supports more than one auxiliary environment requirement", async () => {
  const template = (await loadTemplateCatalog()).apis.find((api) => api.id === "cloudflare-gpt-image-2");
  assert.ok(template);
  const api = materialize(template);
  api.environment = [
    ...(api.environment ?? []),
    {
      name: "CLOUDFLARE_GATEWAY_ID",
      configuredAt: "~/.zshenv",
      description: "Cloudflare gateway identifier used in an endpoint path."
    },
    {
      name: "CLOUDFLARE_GATEWAY_TOKEN",
      configuredAt: "~/.zshenv",
      description: "Cloudflare gateway token sent as an additional request header.",
      placement: { type: "header", name: "X-Gateway-Token" }
    }
  ];
  api.probe = {
    ...api.probe,
    url: "https://api.cloudflare.com/client/v4/accounts/{{CLOUDFLARE_ACCOUNT_ID}}/ai-gateway/gateways/{{CLOUDFLARE_GATEWAY_ID}}"
  };

  const validated = validateApi(api);
  const request = createProbeRequest(validated, "test-secret", {
    CLOUDFLARE_ACCOUNT_ID: "account-for-test",
    CLOUDFLARE_GATEWAY_ID: "gateway-for-test",
    CLOUDFLARE_GATEWAY_TOKEN: "gateway-token-for-test"
  });
  assert.equal(new URL(request.url).pathname, "/client/v4/accounts/account-for-test/ai-gateway/gateways/gateway-for-test");
  assert.equal(new Headers(request.init.headers).get("X-Gateway-Token"), "gateway-token-for-test");
});

test("schema validation rejects invalid requests and registry validation rejects unknown groups", async () => {
  const template = (await loadTemplateCatalog()).apis.find((api) => api.id === "brave-search");
  assert.ok(template);
  const api = materialize(template);
  assert.throws(() => validateApi({ ...api, probe: { ...api.probe, method: "PATCH" } }, "invalid-api"), /api schema/);

  await withTempPaths(async (paths) => {
    await assert.rejects(upsertApi(paths, api), /AgentPulse configuration is invalid/);
  });
});
