import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawData } from "./schema";

/** data/*.json をそのまま読む（検証前）。ビルドと scripts の両方から使う。 */
export function loadRaw(dir = join(process.cwd(), "data")): RawData {
  const read = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));
  return {
    people: read("people.json"),
    books: read("books.json"),
    sources: read("sources.json"),
    recommendations: read("recommendations.json"),
  };
}
