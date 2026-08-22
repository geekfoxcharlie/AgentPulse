import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "../lib/paths.js";
import type { ConfigPaths } from "../lib/types.js";

export async function withTempPaths<T>(callback: (paths: ConfigPaths, root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "agentpulse-test-"));
  const paths = resolvePaths({ configDir: join(root, "config"), stateDir: join(root, "state") });
  try {
    return await callback(paths, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function withEnvironment<T>(name: string, value: string | undefined, callback: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}
