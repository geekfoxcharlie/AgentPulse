import assert from "node:assert/strict";
import test from "node:test";
import { loadRegistry, upsertApi } from "../lib/config.js";
import { checkGroupHealth } from "../lib/health.js";
import { instantiateApiTemplate } from "../lib/templates.js";
import { withEnvironment, withTempPaths } from "./helpers.js";

test("group health reuses TTL, invalidates after a config write, and redacts missing credentials", async () => {
  await withTempPaths(async (paths) => {
    await instantiateApiTemplate(paths, "brave-search", "~/.zshenv");
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
    await instantiateApiTemplate(paths, "brave-search", "~/.zshenv");
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

test("Cloudflare GPT Image 2 uses a non-generative AI Gateway probe and requires both local variables", async () => {
  await withTempPaths(async (paths) => {
    await instantiateApiTemplate(paths, "cloudflare-gpt-image-2", "~/.zshenv");
    let requestCount = 0;
    const fakeFetch: typeof fetch = async (input, init) => {
      requestCount += 1;
      assert.equal(new URL(String(input)).pathname, "/client/v4/accounts/account-for-test/ai-gateway/gateways");
      assert.equal(new URL(String(input)).searchParams.get("per_page"), "1");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer token-for-test");
      assert.equal(headers.get("cf-aig-gateway-id"), null);
      assert.equal(init?.body, undefined);
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    };

    await withEnvironment("CLOUDFLARE_ACCOUNT_ID", undefined, async () => {
      await withEnvironment("CLOUDFLARE_API_TOKEN", "token-for-test", async () => {
        await withEnvironment("CLOUDFLARE_ACCOUNT_ID", "account-for-test", async () => {
          const result = await checkGroupHealth(await loadRegistry(paths), "image-generation", paths, { fetchImpl: fakeFetch });
          assert.equal(result["cloudflare-gpt-image-2"]?.status, "healthy");
          assert.equal(requestCount, 1);
        });

        const result = await checkGroupHealth(await loadRegistry(paths), "image-generation", paths, { fetchImpl: fakeFetch });
        const health = result["cloudflare-gpt-image-2"];
        assert.equal(health?.status, "misconfigured");
        assert.equal(health?.error?.category, "credential_missing");
        assert.match(health?.error?.message ?? "", /CLOUDFLARE_ACCOUNT_ID/);
        assert.equal(requestCount, 1);
      });
    });
  });
});

test("Cloudflare health checks redact both the token and account ID from network errors", async () => {
  await withTempPaths(async (paths) => {
    await instantiateApiTemplate(paths, "cloudflare-gpt-image-2", "~/.zshenv");
    const fakeFetch: typeof fetch = async () => {
      throw new Error("Request for account-for-test failed with token-for-test.");
    };

    await withEnvironment("CLOUDFLARE_API_TOKEN", "token-for-test", async () => {
      await withEnvironment("CLOUDFLARE_ACCOUNT_ID", "account-for-test", async () => {
        const result = await checkGroupHealth(await loadRegistry(paths), "image-generation", paths, { fetchImpl: fakeFetch });
        const error = result["cloudflare-gpt-image-2"]?.error;
        assert.equal(error?.category, "network");
        assert.equal(error?.message.includes("token-for-test"), false);
        assert.equal(error?.message.includes("account-for-test"), false);
      });
    });
  });
});
