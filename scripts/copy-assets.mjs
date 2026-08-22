import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const assets = ["templates", "schemas", "guides"];

await mkdir(resolve("dist"), { recursive: true });
for (const asset of assets) {
  const source = resolve(asset);
  const destination = resolve("dist", asset);
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
}
