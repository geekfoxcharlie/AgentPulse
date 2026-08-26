import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { instantiateApiTemplate } from "../lib/templates.js";
import { startWebServer } from "../web/server.js";
import { withEnvironment, withTempPaths } from "./helpers.js";

test("read-only web page shows metadata but never renders the secret or writes health state", async () => {
  await withTempPaths(async (paths) => {
    await instantiateApiTemplate(paths, "brave-search", "~/.zshenv");
    const configPath = join(paths.apisDir, "brave-search.yaml");
    const before = await readFile(configPath, "utf8");

    await withEnvironment("BRAVE_SEARCH_API_KEY", "secret-must-not-appear", async () => {
      const { server, url } = await startWebServer(paths, 0);
      try {
        const response = await fetch(url);
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.match(html, /Configured capabilities/);
        assert.match(html, /BRAVE_SEARCH_API_KEY/);
        assert.equal(html.includes("secret-must-not-appear"), false);
        assert.equal(html.includes("Checked"), false);
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    });

    assert.equal(await readFile(configPath, "utf8"), before);
    await assert.rejects(stat(paths.healthCachePath));
  });
});
