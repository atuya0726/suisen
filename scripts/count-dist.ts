// dist のファイル数を数え、suisen が使う Workers Paid の上限に近づいたら警告する。
import { readdirSync } from "node:fs";
import { join } from "node:path";

const WARN_AT = 90_000;
const LIMIT_PAID = 100_000;

function count(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? count(join(dir, entry.name)) : 1;
  }
  return n;
}

const total = count(join(process.cwd(), "dist"));
console.log(`[count-dist] dist のファイル数: ${total.toLocaleString()} / ${LIMIT_PAID.toLocaleString()}（Paid プランの上限）`);
if (total > WARN_AT) {
  console.warn(
    `[count-dist] 警告: ${WARN_AT.toLocaleString()} ファイルを超えました。Paid プランの上限 ${LIMIT_PAID.toLocaleString()} に近づいています。`,
  );
}
