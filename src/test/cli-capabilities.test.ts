import assert from "node:assert/strict";
import test from "node:test";
import { loadRegistry, upsertApi, upsertCli, validateCli } from "../lib/config.js";
import { checkGroupHealth, getCachedHealthSnapshots } from "../lib/health.js";
import { instantiateApiTemplate, instantiateCliTemplate, loadTemplateCatalog } from "../lib/templates.js";
import type { CliProbeOutcome } from "../lib/types.js";
import { withEnvironment, withTempPaths } from "./helpers.js";

function outcome(partial: Partial<CliProbeOutcome>): CliProbeOutcome {
  return { code: 0, timedOut: false, outputTail: "", ...partial };
}

test("the built-in browser-harness CLI template ships a passive doctor probe", async () => {
  const catalog = await loadTemplateCatalog();
  const template = catalog.clis.find((cli) => cli.id === "browser-harness");
  assert.ok(template);
  assert.equal(template.group, "browser");
  assert.equal(template.command, "browser-harness");
  assert.equal(template.probe.type, "cli");
  assert.deepEqual(template.probe.args, ["doctor", "--json"]);
  assert.equal(template.probe.expectedExit, 0);
  assert.match(template.usage.example, /browser-harness <<'PY'/);
});

test("CLI template materialization creates the browser group and needs no credential", async () => {
  await withTempPaths(async (paths) => {
    const cli = await instantiateCliTemplate(paths, "browser-harness");
    assert.equal(cli.kind, "cli");
    assert.equal(cli.install.method, "uv-tool");
    const registry = await loadRegistry(paths);
    assert.deepEqual(registry.groups.map((group) => group.id), ["browser"]);
    assert.deepEqual(registry.clis.map((entry) => entry.id), ["browser-harness"]);
    assert.deepEqual(registry.apis, []);
  });
});

test("validateCli rejects whitespace commands and non-integer exit codes", async () => {
  const catalog = await loadTemplateCatalog();
  const template = catalog.clis.find((cli) => cli.id === "browser-harness");
  assert.ok(template);
  assert.throws(() => validateCli({ ...template, kind: "cli", command: "browser harness" }, "bad-command"), /cli schema/);
  assert.throws(() => validateCli({ ...template, kind: "cli", probe: { ...template.probe, expectedExit: 1.5 } }, "bad-probe"), /cli schema/);
});

test("registry rejects a CLI capability ID that collides with an API ID", async () => {
  await withTempPaths(async (paths) => {
    await instantiateApiTemplate(paths, "brave-search", "~/.zshenv");
    const catalog = await loadTemplateCatalog();
    const template = catalog.clis.find((cli) => cli.id === "browser-harness");
    assert.ok(template);
    await assert.rejects(
      upsertCli(paths, { ...template, kind: "cli", id: "brave-search", group: "search" }),
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

test("CLI probe maps healthy, command_missing, exit_code, and timeout outcomes", async () => {
  await withTempPaths(async (paths) => {
    await instantiateCliTemplate(paths, "browser-harness");
    const registry = await loadRegistry(paths);
    const now = new Date("2026-08-27T00:00:00.000Z");
    let runs = 0;
    let next: CliProbeOutcome = outcome({ code: 0 });

    const first = await checkGroupHealth(registry, "browser", paths, {
      now: () => now,
      spawnImpl: async () => {
        runs += 1;
        return next;
      }
    });
    assert.equal(first["browser-harness"]?.status, "healthy");
    assert.equal(runs, 1);

    const second = await checkGroupHealth(registry, "browser", paths, { now: () => now, spawnImpl: async () => (runs += 1, next) });
    assert.equal(second["browser-harness"]?.status, "healthy");
    assert.equal(runs, 1);

    next = outcome({ code: null, timedOut: false, spawnError: Object.assign(new Error("spawn browser-harness ENOENT"), { code: "ENOENT" }) });
    const afterChange = await checkGroupHealth(await loadRegistry(paths), "browser", paths, {
      now: () => new Date(now.getTime() + 60 * 60 * 1000 + 1),
      spawnImpl: async () => (runs += 1, next)
    });
    assert.equal(afterChange["browser-harness"]?.status, "misconfigured");
    assert.equal(afterChange["browser-harness"]?.error?.category, "command_missing");

    next = outcome({ code: 1, outputTail: "chrome-not-running" });
    const failing = await checkGroupHealth(await loadRegistry(paths), "browser", paths, {
      now: () => new Date(now.getTime() + 2 * 60 * 60 * 1000 + 1),
      spawnImpl: async () => (runs += 1, next)
    });
    assert.equal(failing["browser-harness"]?.status, "unhealthy");
    assert.equal(failing["browser-harness"]?.error?.category, "exit_code");
    assert.match(failing["browser-harness"]?.error?.message ?? "", /chrome-not-running/);

    next = outcome({ code: null, timedOut: true });
    const timedOut = await checkGroupHealth(await loadRegistry(paths), "browser", paths, {
      now: () => new Date(now.getTime() + 3 * 60 * 60 * 1000 + 1),
      spawnImpl: async () => (runs += 1, next)
    });
    assert.equal(timedOut["browser-harness"]?.status, "unhealthy");
    assert.equal(timedOut["browser-harness"]?.error?.category, "timeout");
    assert.equal(runs, 4);
  });
});

test("editing a CLI capability invalidates its health cache entry", async () => {
  await withTempPaths(async (paths) => {
    await instantiateCliTemplate(paths, "browser-harness");
    let runs = 0;
    const spawnImpl = async (): Promise<CliProbeOutcome> => {
      runs += 1;
      return outcome({ code: 0 });
    };
    const registry = await loadRegistry(paths);
    await checkGroupHealth(registry, "browser", paths, { spawnImpl });
    assert.equal(runs, 1);

    await checkGroupHealth(await loadRegistry(paths), "browser", paths, { spawnImpl });
    assert.equal(runs, 1);

    const current = (await loadRegistry(paths)).clis[0];
    assert.ok(current);
    await upsertCli(paths, { ...current, description: "Updated description invalidates the health cache." });
    await checkGroupHealth(await loadRegistry(paths), "browser", paths, { spawnImpl });
    assert.equal(runs, 2);
  });
});

test("cached snapshots and group health cover CLI capabilities alongside APIs", async () => {
  await withTempPaths(async (paths) => {
    await instantiateApiTemplate(paths, "brave-search", "~/.zshenv");
    await instantiateCliTemplate(paths, "browser-harness");
    const registry = await loadRegistry(paths);
    const snapshots = await getCachedHealthSnapshots(registry, paths);
    assert.deepEqual(Object.keys(snapshots).sort(), ["brave-search", "browser-harness"]);
    assert.equal(snapshots["browser-harness"]?.status, "unknown");

    await withEnvironment("BRAVE_SEARCH_API_KEY", undefined, async () => {
      let cliRuns = 0;
      const searchHealth = await checkGroupHealth(registry, "search", paths, {
        fetchImpl: async () => new Response("{}", { status: 200 }),
        spawnImpl: async () => {
          cliRuns += 1;
          return outcome({ code: 0 });
        }
      });
      assert.equal(searchHealth["brave-search"]?.status, "misconfigured");
      assert.equal(cliRuns, 0);
    });
  });
});
