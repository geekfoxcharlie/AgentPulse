import { homedir } from "node:os";
import { join } from "node:path";
import type { ConfigPaths } from "./types.js";

export interface PathOverrides {
  configDir?: string;
  stateDir?: string;
}

export function resolvePaths(overrides: PathOverrides = {}, env: NodeJS.ProcessEnv = process.env): ConfigPaths {
  const home = homedir();
  const configDir = overrides.configDir ?? env.AGENTPULSE_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "agentpulse");
  const stateDir = overrides.stateDir ?? env.AGENTPULSE_STATE_DIR ?? join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "agentpulse");

  return {
    configDir,
    groupsDir: join(configDir, "groups"),
    apisDir: join(configDir, "apis"),
    clisDir: join(configDir, "clis"),
    stateDir,
    healthCachePath: join(stateDir, "health-cache.json")
  };
}
