// dist のファイル数を数える。Workers Static Assets の上限（Free 20,000）に近づいたら警告する
import { readdirSync } from "node:fs";
import { join } from "node:path";

const WARN_AT = 18_000;
const LIMIT_FREE = 20_000;

function count(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? count(join(dir, entry.name)) : 1;
  }
  return n;
}

const total = count(join(process.cwd(), "dist"));
console.log(`[count-dist] dist のファイル数: ${total.toLocaleString()} / ${LIMIT_FREE.toLocaleString()}（Free プランの上限）`);
if (total > WARN_AT) {
  console.warn(
    `[count-dist] 警告: ${WARN_AT.toLocaleString()} ファイルを超えました。Free プランの上限 ${LIMIT_FREE.toLocaleString()} に近づいています（Paid は 100,000）。`,
  );
}
