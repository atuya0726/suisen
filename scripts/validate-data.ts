// スキーマ検証＋参照整合性チェック。違反があれば exit 1（pnpm build を止める）
import { loadRaw } from "../src/lib/load";
import { validateAll } from "../src/lib/schema";

const { data, errors } = validateAll(loadRaw());

if (errors.length > 0) {
  console.error(`[validate-data] ${errors.length} 件の不整合があります:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const verified = data.recommendations.filter((r) => r.verified);
const withRec = {
  people: new Set(verified.map((r) => r.personId)).size,
  books: new Set(verified.map((r) => r.isbn13)).size,
};
console.log(
  `[validate-data] OK  人物 ${data.people.length}（掲載 ${withRec.people}） / 本 ${data.books.length}（掲載 ${withRec.books}） / 出典 ${data.sources.length} / 推薦 ${data.recommendations.length}`,
);
console.log(`[validate-data] verified: false のため掲載しない推薦: ${data.recommendations.length - verified.length} 件`);

// 所属別ページ（/affiliations/[slug]/）は slug が決まっている所属だけ作る。人数が足りているのに slug が無い所属を知らせる
const { affiliationsWithoutSlug } = await import("../src/lib/data");
if (affiliationsWithoutSlug.length > 0) {
  console.warn(
    `[validate-data] 警告: 3人以上いるのに所属別ページが無い所属: ${affiliationsWithoutSlug.join("、")}（src/lib/affiliations.json に slug を足す）`,
  );
}
