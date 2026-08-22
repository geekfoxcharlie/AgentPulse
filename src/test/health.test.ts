import assert from "node:assert/strict";
import test from "node:test";
import { loadRegistry, upsertApi } from "../lib/config.js";
import { checkGroupHealth } from "../lib/health.js";
import { instantiateApiTemplate } from "../lib/templates.js";
import { withEnvironment, withTempPaths } from "./helpers.js";

test("group health reuses TTL, invalidates after a config write, and redacts missing credentials", async () => {
  await withTempPaths(async (paths) => {
    await instantiateApiTemplate(paths, "brave-search", "~/.config/agentpulse/secrets.zsh");
    let requestCount = 0;
    let now = new Date("2026-08-21T00:00:00.000Z");
    const fakeFetch: typeof fetch = async (input, init) => {
      requestCount += 1;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("X-Subscription-Token"), "test-key");
      assert.equal(new URL(String(input)).searchParams.get("q"), "OpenAI");
      return new Response(JSON.stringify({ query: { original: "OpenAI" } }), { status: 200 });
    };

    await withEnvironment("BRAVE_SEARCH_API_KEY", "test-key", async () => {
      const registry = await loadRegistry(paths);
      const options = { fetchImpl: fakeFetch, now: () => now };
      const first = await checkGroupHealth(registry, "search", paths, options);
      assert.equal(first["brave-search"]?.status, "healthy");
      assert.equal(requestCount, 1);

      const second = await checkGroupHealth(registry, "search", paths, options);
      assert.equal(second["brave-search"]?.status, "healthy");
      assert.equal(requestCount, 1);

      const currentApi = registry.apis[0];
      assert.ok(currentApi);
      await upsertApi(paths, { ...currentApi, description: "Updated description invalidates the health cache." });
      const afterUpdate = await checkGroupHealth(await loadRegistry(paths), "search", paths, options);
      assert.equal(afterUpdate["brave-search"]?.status, "healthy");
      assert.equal(requestCount, 2);

      now = new Date(now.getTime() + 60 * 60 * 1000 + 1);
      const afterExpiry = await checkGroupHealth(await loadRegistry(paths), "search", paths, options);
      assert.equal(afterExpiry["brave-search"]?.status, "healthy");
      assert.equal(requestCount, 3);
    });

    await withEnvironment("BRAVE_SEARCH_API_KEY", undefined, async () => {
      const result = await checkGroupHealth(await loadRegistry(paths), "search", paths, { fetchImpl: fakeFetch, now: () => now });
      const health = result["brave-search"];
      assert.equal(health?.status, "misconfigured");
      assert.equal(health?.error?.category, "credential_missing");
      assert.equal(JSON.stringify(health).includes("test-key"), false);
      assert.equal(requestCount, 3);
    });
  });
});

test("simultaneous group checks share a single in-process probe", async () => {
  await withTempPaths(async (paths) => {
    await instantiateApiTemplate(paths, "brave-search", "~/.config/agentpulse/secrets.zsh");
    await withEnvironment("BRAVE_SEARCH_API_KEY", "test-key", async () => {
      let requestCount = 0;
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const fakeFetch: typeof fetch = async () => {
        requestCount += 1;
        await gate;
        return new Response(JSON.stringify({ query: { original: "OpenAI" } }), { status: 200 });
      };
      const registry = await loadRegistry(paths);
      const first = checkGroupHealth(registry, "search", paths, { fetchImpl: fakeFetch });
      const second = checkGroupHealth(registry, "search", paths, { fetchImpl: fakeFetch });
      release?.();
      const [left, right] = await Promise.all([first, second]);
      assert.equal(left["brave-search"]?.status, "healthy");
      assert.equal(right["brave-search"]?.status, "healthy");
      assert.equal(requestCount, 1);
    });
  });
});
