import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError } from "./errors.js";
import { SCHEMA_VERSION, type ConfigPaths, type HealthState } from "./types.js";

function emptyState(): HealthState {
  return { schemaVersion: SCHEMA_VERSION, entries: {} };
}

export async function loadHealthState(paths: ConfigPaths): Promise<HealthState> {
  try {
    const raw = await readFile(paths.healthCachePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyState();
    const candidate = parsed as Partial<HealthState>;
    if (candidate.schemaVersion !== SCHEMA_VERSION || !candidate.entries || typeof candidate.entries !== "object") {
      return emptyState();
    }
    return { schemaVersion: SCHEMA_VERSION, entries: candidate.entries as HealthState["entries"] };
  } catch (error: unknown) {
    if (isNotFound(error)) return emptyState();
    return emptyState();
  }
}

export async function saveHealthState(paths: ConfigPaths, state: HealthState): Promise<void> {
  await mkdir(paths.stateDir, { recursive: true });
  await atomicWrite(paths.healthCachePath, `${JSON.stringify(state, null, 2)}\n`);
}

export async function invalidateHealthEntry(paths: ConfigPaths, apiId: string): Promise<void> {
  const state = await loadHealthState(paths);
  if (!(apiId in state.entries)) return;
  delete state.entries[apiId];
  await saveHealthState(paths, state);
}

export async function atomicWrite(target: string, contents: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${target.split("/").at(-1) ?? "agentpulse"}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
