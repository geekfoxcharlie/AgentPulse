import assert from "node:assert/strict";
import test from "node:test";
import { loadRegistry, upsertSite, validateSite } from "../lib/config.js";
import { checkGroupHealth, getCachedHealthSnapshots } from "../lib/health.js";
import { instantiateApiTemplate, instantiateSiteTemplate, loadTemplateCatalog } from "../lib/templates.js";
import { withTempPaths } from "./helpers.js";

const EXPECTED_SITE_IDS = [
  "baidu-index",
  "douyin-creator",
  "google-scholar",
  "google-trends",
  "perplexity",
  "wayback-machine",
  "xiaohongshu-creator"
];

test("the built-in sites catalog covers the registered research websites", async () => {
  const catalog = await loadTemplateCatalog();
  const sites = catalog.groups.find((group) => group.id === "sites");
  assert.ok(sites);
  assert.equal(catalog.sites.length, EXPECTED_SITE_IDS.length);
  assert.deepEqual(catalog.sites.map((site) => site.id).sort(), EXPECTED_SITE_IDS);

  const perplexity = catalog.sites.find((site) => site.id === "perplexity");
  assert.ok(perplexity);
  assert.equal(perplexity.login.required, true);
  assert.equal(perplexity.url, "https://www.perplexity.ai");
  assert.match(perplexity.usage.example, /browser-harness <<'PY'/);
  assert.match(perplexity.usage.example, /new_tab\("https:\/\/www\.perplexity\.ai"\)/);

  const trends = catalog.sites.find((site) => site.id === "google-trends");
  assert.ok(trends);
  assert.equal(trends.login.required, false);
});

test("site template materialization creates the sites group and needs no credential", async () => {
  await withTempPaths(async (paths) => {
    const site = await instantiateSiteTemplate(paths, "perplexity");
    assert.equal(site.kind, "site");
    assert.equal(site.login.required, true);
    const registry = await loadRegistry(paths);
    assert.deepEqual(registry.groups.map((group) => group.id), ["sites"]);
    assert.deepEqual(registry.sites.map((entry) => entry.id), ["perplexity"]);
    assert.deepEqual(registry.apis, []);
    assert.deepEqual(registry.clis, []);
  });
});

test("validateSite rejects a missing login check and a non-http url", async () => {
  const catalog = await loadTemplateCatalog();
  const template = catalog.sites.find((site) => site.id === "perplexity");
  assert.ok(template);
  assert.throws(() => validateSite({ ...template, kind: "site", url: "not-a-url" }, "bad-url"), /site schema|valid HTTP/);
  assert.throws(
    () => validateSite({ ...template, kind: "site", login: { required: true, check: "" } }, "bad-login"),
    /site schema|non-empty/
  );
});

test("registry rejects a site ID that collides with an API ID", async () => {
  await withTempPaths(async (paths) => {
    await instantiateApiTemplate(paths, "brave-search", "~/.zshenv");
    const catalog = await loadTemplateCatalog();
    const template = catalog.sites.find((site) => site.id === "perplexity");
    assert.ok(template);
    await assert.rejects(
      upsertSite(paths, { ...template, kind: "site", id: "brave-search", group: "search" }),
      (error: unknown) => {
        const appError = error as { message: string; details?: Array<{ message: string }> };
        return (
          appError.message.includes("configuration is invalid") === true &&
          appError.details?.some((detail) => detail.message.includes("already used by an API")) === true
        );
      }
    );
  });
});

test("site capabilities are listed but never probed during group health checks", async () => {
  await withTempPaths(async (paths) => {
    await instantiateSiteTemplate(paths, "perplexity");
    await instantiateSiteTemplate(paths, "google-trends");
    const registry = await loadRegistry(paths);
    const snapshots = await getCachedHealthSnapshots(registry, paths);
    assert.equal(snapshots.perplexity?.status, "unknown");
    assert.equal(snapshots["google-trends"]?.status, "unknown");

    let fetchRuns = 0;
    let spawnRuns = 0;
    const health = await checkGroupHealth(registry, "sites", paths, {
      fetchImpl: async () => {
        fetchRuns += 1;
        return new Response("{}", { status: 200 });
      },
      spawnImpl: async () => {
        spawnRuns += 1;
        return { code: 0, timedOut: false, outputTail: "" };
      }
    });
    assert.equal(health.perplexity?.status, "unknown");
    assert.equal(health["google-trends"]?.status, "unknown");
    assert.equal(fetchRuns, 0);
    assert.equal(spawnRuns, 0);
  });
});
