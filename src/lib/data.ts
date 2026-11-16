import indexing from "./indexing.json";
import { loadRaw } from "./load";
import { TAG_SLUGS, validateAll, type Book, type Person, type Recommendation, type Source, type Tag } from "./schema";

export type { Book, Person, Source, Tag };

/** 画面に出す推薦1件（参照を解決済み） */
export interface Rec extends Omit<Recommendation, "verified"> {
  person: Person;
  book: Book;
  source: Source;
}

export interface RankedBook {
  rank: number;
  book: Book;
  /** 推薦者数（distinct person） */
  count: number;
  latest: string;
}

const { data, errors } = validateAll(loadRaw());
if (errors.length > 0) {
  throw new Error(`データに不整合があります（pnpm validate-data で確認）:\n${errors.join("\n")}`);
}

const personById = new Map(data.people.map((p) => [p.id, p]));
const bookByIsbn = new Map(data.books.map((b) => [b.isbn13, b]));
const sourceById = new Map(data.sources.map((s) => [s.id, s]));

/** verified のみ。新しい出典順 */
export const recs: Rec[] = data.recommendations
  .filter((r) => r.verified)
  .map(({ verified: _verified, ...r }) => ({
    ...r,
    person: personById.get(r.personId)!,
    book: bookByIsbn.get(r.isbn13)!,
    source: sourceById.get(r.sourceId)!,
  }))
  .sort(
    (a, b) =>
      (b.source.publishedAt ?? "").localeCompare(a.source.publishedAt ?? "") ||
      a.personId.localeCompare(b.personId) ||
      a.isbn13.localeCompare(b.isbn13),
  );

export const unverifiedCount = data.recommendations.length - recs.length;

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

const recsByPersonId = groupBy(recs, (r) => r.personId);
const recsByIsbn = groupBy(recs, (r) => r.isbn13);

/** 推薦が1件以上あり、個別ページを作る人物（よみ順）。noPage の推薦者は含めない */
export const people: Person[] = data.people
  .filter((p) => recsByPersonId.has(p.id) && !p.noPage)
  .sort((a, b) => (a.kana ?? a.name).localeCompare(b.kana ?? b.name, "ja") || a.id.localeCompare(b.id));

/** 推薦が1件以上ある本 */
export const books: Book[] = data.books.filter((b) => recsByIsbn.has(b.isbn13));

export const recsOfPerson = (id: string): Rec[] => recsByPersonId.get(id) ?? [];
export const recsOfBook = (isbn13: string): Rec[] => recsByIsbn.get(isbn13) ?? [];

const isbnsByPersonId = new Map([...recsByPersonId].map(([id, list]) => [id, new Set(list.map((r) => r.isbn13))]));
const personIdsByIsbn = new Map([...recsByIsbn].map(([isbn, list]) => [isbn, new Set(list.map((r) => r.personId))]));

/** その人が紹介した本の冊数（distinct） */
export const bookCountOfPerson = (id: string): number => isbnsByPersonId.get(id)?.size ?? 0;
/** その本の推薦者数（distinct person） */
export const recommenderCount = (isbn13: string): number => personIdsByIsbn.get(isbn13)?.size ?? 0;

/** 同じ出典の推薦をまとめる（人物ページ用。出典の説明を1回だけ出すため）。並びは最新の出典順を保つ */
export function groupRecsBySource(list: Rec[]): Rec[][] {
  return [...groupBy(list, (r) => r.sourceId).values()];
}

/** 同じ相手（本 or 人）への推薦をまとめる。並びは最新の出典順を保つ */
export function groupRecs(list: Rec[], by: "book" | "person"): Rec[][] {
  return [...groupBy(list, (r) => (by === "book" ? r.isbn13 : r.personId)).values()];
}

function rank(source: Rec[]): RankedBook[] {
  return [...groupBy(source, (r) => r.isbn13)]
    .map(([isbn13, list]) => ({
      book: bookByIsbn.get(isbn13)!,
      count: new Set(list.map((r) => r.personId)).size,
      latest: list.reduce((max, r) => ((r.source.publishedAt ?? "") > max ? r.source.publishedAt! : max), ""),
    }))
    // 1人しか薦めていない本は順位に意味がないので、ランキングには載せない（しきい値は indexing.json）
    .filter((item) => item.count >= indexing.minRecommendersToRank)
    .sort(
      (a, b) => b.count - a.count || b.latest.localeCompare(a.latest) || a.book.isbn13.localeCompare(b.book.isbn13),
    )
    .map((item, i) => ({ rank: i + 1, ...item }));
}

/** 総合ランキング */
export const ranking: RankedBook[] = rank(recs);

export interface TagRanking {
  tag: Tag;
  slug: string;
  peopleCount: number;
  items: RankedBook[];
}

/** 属性別ランキング。推薦者が3人以上いて、載せられる本が3冊以上ある属性だけ */
export const tagRankings: TagRanking[] = (Object.keys(TAG_SLUGS) as Tag[])
  .map((tag) => {
    // noPage の推薦者も人数に数える（個別ページを作らないだけで、推薦者数には含める決まり）
    const ids = new Set(
      data.people.filter((p) => recsByPersonId.has(p.id) && p.tags.includes(tag)).map((p) => p.id),
    );
    return {
      tag,
      slug: TAG_SLUGS[tag],
      peopleCount: ids.size,
      items: rank(recs.filter((r) => ids.has(r.personId))),
    };
  })
  .filter((t) => t.peopleCount >= 3 && t.items.length >= 3);

export const tagRankingSlug = (tag: Tag): string | undefined => tagRankings.find((t) => t.tag === tag)?.slug;

/** 「この本を推薦した人は、こんな本も推薦」: 共通の推薦者が多い順に最大12冊 */
export function alsoRecommended(isbn13: string): { book: Book; shared: number }[] {
  const tally = new Map<string, number>();
  for (const personId of personIdsByIsbn.get(isbn13) ?? []) {
    for (const other of isbnsByPersonId.get(personId) ?? []) {
      if (other !== isbn13) tally.set(other, (tally.get(other) ?? 0) + 1);
    }
  }
  return [...tally]
    .sort((a, b) => b[1] - a[1] || recommenderCount(b[0]) - recommenderCount(a[0]) || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([isbn, shared]) => ({ book: bookByIsbn.get(isbn)!, shared }));
}

/** 「似た人」: 推薦本が重なる人物を、重なり冊数の多い順に最大8人 */
export function similarPeople(id: string): { person: Person; shared: number }[] {
  const tally = new Map<string, number>();
  for (const isbn of isbnsByPersonId.get(id) ?? []) {
    for (const other of personIdsByIsbn.get(isbn) ?? []) {
      if (other !== id && !personById.get(other)?.noPage) tally.set(other, (tally.get(other) ?? 0) + 1);
    }
  }
  return [...tally]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([personId, shared]) => ({ person: personById.get(personId)!, shared }));
}

export const usesRakutenCovers: boolean = books.some((b) => b.coverUrl && b.coverSource === "rakuten");

export function paginate<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages.length > 0 ? pages : [[]];
}
