import { z } from "zod";

/**
 * 属性（tags）と URL スラッグの対応。
 * /ranking/[tag]/ の URL に日本語を入れないため、ここで英字スラッグを固定する。
 * 属性を増やすときはここに1行足す（スラッグは一度公開したら変えない）。
 */
export const TAG_SLUGS = {
  経営者: "executive",
  作家: "writer",
  研究者: "researcher",
  スポーツ選手: "athlete",
  芸能: "entertainer",
  エンジニア: "engineer",
  大学: "university",
  書店: "bookstore",
  選書家: "book-curator",
} as const satisfies Record<string, string>;

export type Tag = keyof typeof TAG_SLUGS;
const TAGS = Object.keys(TAG_SLUGS) as [Tag, ...Tag[]];

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "ローマ字 kebab-case で書く")
  .refine((s) => !/^\d+$/.test(s), "数字だけの ID は使えない");

export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  const sum = [...isbn].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  return sum % 10 === 0;
}

const isbn13 = z.string().refine(isValidIsbn13, "ISBN13 の形式またはチェックディジットが不正");

/**
 * 人物（推薦者）の ID。p0001 からの連番で、URL にそのまま使う。
 * 名前の読みから作らない（読みの確認が難しく、間違えると公開後に URL を直せないため）。一度付けた番号は変えない・使い回さない。
 */
const personId = z.string().regex(/^p\d{4,}$/, "p0001 のような連番で書く");

export const personSchema = z.strictObject({
  id: personId,
  name: z.string().min(1),
  kana: z.string().min(1).optional(),
  title: z.string().min(1),
  tags: z.array(z.enum(TAGS)),
  /** 所属する大学・会社などの名前（例 "立命館大学"）。学部や役職は含めない。所属ごとの集計に使う */
  affiliation: z.string().min(1).optional(),
  /**
   * true なら個別ページ（/people/pNNNN/）を作らず、人物一覧にも載せない。推薦者数には数え、本ページには名前と出典を出す。
   * 選書記事を書いた書店主・選書家など、その人のページが「元の選書リストの再現」になってしまう推薦者に使う
   */
  noPage: z.boolean().optional(),
  /** 大学・書店の賞など、個人ではない推薦者は "organization"。省略時は個人 */
  kind: z.enum(["person", "organization"]).optional(),
  /** 本人を特定できる外部ページ（Wikipedia・公式サイトなど）。JSON-LD の sameAs に出す */
  sameAs: z
    .array(z.url({ protocol: /^https$/ }))
    .min(1)
    .optional(),
});

export const bookSchema = z.strictObject({
  isbn13,
  title: z.string().min(1),
  authors: z.array(z.string().min(1)).min(1),
  publisher: z.string().min(1).optional(),
  publishedAt: z
    .string()
    .regex(/^\d{4}-\d{2}(-\d{2})?$/, "YYYY-MM か YYYY-MM-DD")
    .optional(),
  coverUrl: z.url({ protocol: /^https$/ }).optional(),
  coverSource: z.enum(["rakuten", "amazon"]).optional(),
  /** 楽天ブックスの商品ページ（fetch-books.ts が埋める。なければ ISBN 検索にリンクする） */
  rakutenUrl: z.url({ protocol: /^https$/, hostname: /^books\.rakuten\.co\.jp$/ }).optional(),
  asin: z
    .string()
    .regex(/^[A-Z0-9]{10}$/)
    .optional(),
});

export const sourceSchema = z.strictObject({
  id: slug,
  type: z.enum(["article", "interview", "podcast", "video", "book", "sns"]),
  media: z.string().min(1),
  title: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
  /** 出典ページから公開日が分からないときは省く（推測で埋めない）。並び順では最も古い扱いになる */
  publishedAt: z.iso.date().optional(),
});

export const recommendationSchema = z.strictObject({
  personId: z.string(),
  isbn13: z.string(),
  sourceId: z.string(),
  timestamp: z
    .string()
    .regex(/^(\d{1,2}:)?\d{1,2}:\d{2}$/, '"12:34" の形式')
    .optional(),
  /**
   * 出典の行（媒体・日付）だけでは分からない事実の短い補足（任意、40字以内）。例「第3位」「上下巻のうち上巻を掲載」。
   * 推薦理由の要約は書かない（記事の内容を再現することになり、翻案に当たるおそれがあるため）。理由は出典で読んでもらう。
   */
  note: z
    .string()
    .min(1)
    .refine((s) => [...s].length <= 40, "note は 40 字以内")
    .optional(),
  quote: z
    .string()
    .min(1)
    .refine((s) => [...s].length <= 40, "quote は 40 字以内")
    .optional(),
  context: z.enum(["座右の書", "人生を変えた一冊", "社員に薦めたい", "最近読んだ", "その他"]).optional(),
  verified: z.boolean(),
});

export type Person = z.infer<typeof personSchema>;
export type Book = z.infer<typeof bookSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;

export interface RawData {
  people: unknown;
  books: unknown;
  sources: unknown;
  recommendations: unknown;
}

export interface Dataset {
  people: Person[];
  books: Book[];
  sources: Source[];
  recommendations: Recommendation[];
}

function parseList<T>(file: string, schema: z.ZodType<T>, raw: unknown, errors: string[]): T[] {
  if (!Array.isArray(raw)) {
    errors.push(`${file}: 配列ではありません`);
    return [];
  }
  const out: T[] = [];
  raw.forEach((item, i) => {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
    else
      for (const issue of r.error.issues)
        errors.push(`${file}[${i}] ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  });
  return out;
}

function checkUnique<T>(file: string, items: T[], key: (t: T) => string, label: string, errors: string[]) {
  const seen = new Set<string>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) errors.push(`${file}: ${label} が重複しています: ${k}`);
    seen.add(k);
  }
}

/** スキーマ検証＋参照整合性チェック。errors が空なら data は安全に使える。 */
export function validateAll(raw: RawData): { data: Dataset; errors: string[] } {
  const errors: string[] = [];
  const people = parseList("people.json", personSchema, raw.people, errors);
  const books = parseList("books.json", bookSchema, raw.books, errors);
  const sources = parseList("sources.json", sourceSchema, raw.sources, errors);
  const recommendations = parseList("recommendations.json", recommendationSchema, raw.recommendations, errors);

  checkUnique("people.json", people, (p) => p.id, "id", errors);
  checkUnique("books.json", books, (b) => b.isbn13, "isbn13", errors);
  checkUnique("sources.json", sources, (s) => s.id, "id", errors);
  checkUnique(
    "recommendations.json",
    recommendations,
    (r) => `${r.personId} / ${r.isbn13} / ${r.sourceId}`,
    "(personId, isbn13, sourceId)",
    errors,
  );

  const personIds = new Set(people.map((p) => p.id));
  const isbns = new Set(books.map((b) => b.isbn13));
  const sourceIds = new Set(sources.map((s) => s.id));
  recommendations.forEach((r, i) => {
    const at = `recommendations.json[${i}]`;
    if (!personIds.has(r.personId)) errors.push(`${at}: personId "${r.personId}" が people.json にありません`);
    if (!isbns.has(r.isbn13)) errors.push(`${at}: isbn13 "${r.isbn13}" が books.json にありません`);
    if (!sourceIds.has(r.sourceId)) errors.push(`${at}: sourceId "${r.sourceId}" が sources.json にありません`);
  });

  return { data: { people, books, sources, recommendations }, errors };
}
