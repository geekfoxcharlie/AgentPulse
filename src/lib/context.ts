import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function agentContext(): string {
  return readFileSync(fileURLToPath(new URL("../guides/agent-context.md", import.meta.url)), "utf8").trim();
}
