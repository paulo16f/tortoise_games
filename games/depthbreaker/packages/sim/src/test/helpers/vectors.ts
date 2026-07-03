import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// packages/sim/src/test/helpers -> games/depthbreaker/shared-spec/vectors
const vectorsDir = join(here, "..", "..", "..", "..", "..", "shared-spec", "vectors");

export function loadVector<T>(name: string): T {
  return JSON.parse(readFileSync(join(vectorsDir, name), "utf8")) as T;
}
