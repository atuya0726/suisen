// ISBN から書誌・書影URLを楽天ブックス書籍検索API で補完し、data/books.json を更新する。
//
//   pnpm fetch-books 9784478025819 9784000000000   … 指定した ISBN（books.json になければ追加）
//   pnpm fetch-books --missing                     … 書影URL がまだない本すべて
//   pnpm fetch-books --missing --dry-run           … 書き込まずに結果だけ表示
//   pnpm fetch-books --search in.json --out out.json … 書名（＋著者）から ISBN と書誌をまとめて引く
//
// --search の入力は [{ "title": "書名", "author": "著者（任意）", "publisher": "出版社（任意）" }, ...]。
// 楽天ブックスで探し、見つからない本だけ国立国会図書館サーチで補う。結果は --out のファイル（省略時は標準出力）に
// 書くだけで、books.json は変更しない。候補が複数ある本は alternatives に並ぶので、人が見て版を選ぶ。
//
// 既に入っている値（手入力値）は上書きしない。空の項目だけを埋める。
// 書影は URL を記録するだけで、画像そのものは保存しない。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bookSchema, isValidIsbn13, type Book } from "../src/lib/schema";

if (existsSync(".env")) process.loadEnvFile(".env");

// 楽天ウェブサービスの新方式（openapi.rakuten.co.jp）。applicationId と accessKey の両方が必要で、
// アプリに登録した URL を Referer / Origin として送る（hyoushidake・kibunyomi と同じ呼び方）。
// 仕様が変わったらここだけを直す。
const ENDPOINT =
  process.env.RAKUTEN_API_ENDPOINT?.trim() || "https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404";
// 変数名は他プロジェクトと共通の RAKUTEN_APPLICATION_ID。RAKUTEN_APP_ID でも受け付ける
/**
 * 環境変数になければ macOS キーチェーンから読む。値はこのプロセスの中でしか使わず、表示もしない
 * （キーをコマンドラインや出力に出さずに済ませるため、スクリプト自身が読む）。
 */
function fromKeychain(name: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const value = execFileSync("/usr/bin/security", ["find-generic-password", "-s", name, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return value.trim() || undefined;
  } catch {
    return undefined;
  }
}
const APP_ID =
  (process.env.RAKUTEN_APPLICATION_ID ?? process.env.RAKUTEN_APP_ID)?.trim() || fromKeychain("RAKUTEN_APPLICATION_ID");
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY?.trim() || fromKeychain("RAKUTEN_ACCESS_KEY");
const REFERER = process.env.RAKUTEN_HTTP_REFERER?.trim() || process.env.SITE_URL?.trim();
/** 書影の取得サイズ（表示は最大 200px 幅。高精細画面用に2倍） */
const COVER_SIZE = 400;
const INTERVAL_MS = 1100;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const missing = args.includes("--missing");
const optionValue = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const searchFile = optionValue("--search");
const outFile = optionValue("--out");
const isbnArgs = args
  .filter((a) => !a.startsWith("--") && a !== searchFile && a !== outFile)
  .map((a) => a.replaceAll("-", ""));

if (!APP_ID || !ACCESS_KEY) {
  console.error(
    "[fetch-books] RAKUTEN_APPLICATION_ID と RAKUTEN_ACCESS_KEY が必要です（環境変数か macOS キーチェーン。README 参照）。",
  );
  process.exit(1);
}
const invalid = isbnArgs.filter((isbn) => !isValidIsbn13(isbn));
if (invalid.length > 0) {
  console.error(`[fetch-books] ISBN13 として正しくありません: ${invalid.join(", ")}`);
  process.exit(1);
}

interface RakutenItem {
  title?: string;
  author?: string;
  publisherName?: string;
  salesDate?: string;
  isbn?: string;
  largeImageUrl?: string;
  mediumImageUrl?: string;
  itemUrl?: string;
}

/** 楽天ブックス書籍検索API を呼ぶ。params は isbn / title / author など API の検索条件 */
async function rakutenSearch(params: Record<string, string>): Promise<RakutenItem[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("applicationId", APP_ID!);
  url.searchParams.set("accessKey", ACCESS_KEY!);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatVersion", "2");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers: Record<string, string> = { accept: "application/json" };
  if (REFERER) {
    headers.referer = REFERER;
    headers.origin = new URL(REFERER).origin;
  }
  const res = await fetch(url, { headers });
  // URL にはキーが含まれるので、エラーには出さない
  if (!res.ok) {
    // 応答本文にキーが含まれていても出力に残らないよう伏せる
    const body = (await res.text()).replaceAll(ACCESS_KEY!, "***").replaceAll(APP_ID!, "***");
    throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const list = json.Items ?? json.items;
  if (!Array.isArray(list)) return [];
  return list
    .filter((x): x is object => typeof x === "object" && x !== null)
    // formatVersion=1 だと { Item: {...} } で包まれる
    .map((x) => {
      const wrapped = x as { Item?: RakutenItem; item?: RakutenItem };
      return wrapped.Item ?? wrapped.item ?? (x as RakutenItem);
    });
}

async function fetchItem(isbn13: string): Promise<RakutenItem | null> {
  return (await rakutenSearch({ isbn: isbn13 }))[0] ?? null;
}

/** "2013年12月13日頃" → "2013-12-13"、"2013年12月" → "2013-12" */
function parseSalesDate(value: string | undefined): string | undefined {
  const m = value?.match(/(\d{4})年(\d{1,2})月(?:(\d{1,2})日)?/);
  if (!m) return undefined;
  const [, y, mo, d] = m;
  return [y, mo!.padStart(2, "0"), ...(d ? [d.padStart(2, "0")] : [])].join("-");
}

function splitAuthors(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[/／,、]/)
    .map((s) => s.replaceAll("　", " ").trim())
    .filter(Boolean);
}

/** 画像なしのときに返るダミー画像は使わない。URL のサイズ指定（_ex）だけを差し替える */
function coverOf(item: RakutenItem): string | undefined {
  const raw = item.largeImageUrl || item.mediumImageUrl;
  if (!raw || !raw.startsWith("https://") || raw.includes("noimage")) return undefined;
  const url = new URL(raw);
  url.searchParams.set("_ex", `${COVER_SIZE}x${COVER_SIZE}`);
  return url.href;
}

/** 商品ページの URL（アフィリエイトID は含めない。付与は src/lib/links.ts で行う） */
function itemUrlOf(item: RakutenItem): string | undefined {
  if (!item.itemUrl?.startsWith("https://books.rakuten.co.jp/")) return undefined;
  const url = new URL(item.itemUrl);
  return `${url.origin}${url.pathname}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// --search: 書名（＋著者）から ISBN と書誌を引く
// ---------------------------------------------------------------------------

interface Query {
  title: string;
  author?: string;
  publisher?: string;
}
interface Candidate {
  isbn13: string;
  title: string;
  authors: string[];
  publisher?: string;
  publishedAt?: string;
  rakutenUrl?: string;
  coverUrl?: string;
  coverSource?: "rakuten";
}
interface SearchResult {
  query: Query;
  /** found: 1冊に決まった / ambiguous: 同じくらい合う版が複数ある / not-found: どちらにもない */
  status: "found" | "ambiguous" | "not-found" | "error";
  from?: "rakuten" | "ndl";
  book?: Candidate;
  /** book と同点だった別の版（単行本と文庫など） */
  alternatives?: Candidate[];
  error?: string;
}

/** 表記ゆれを吸収して比べるための正規化（全角半角・空白・記号を無視） */
const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s・:;\-‐―—–~〜!?、。,.'"“”‘’「」『』()[\]【】〔〕〈〉《》<>＝=／/]/g, "");

function isbn10to13(isbn10: string): string {
  const body = `978${isbn10.slice(0, 9)}`;
  const sum = [...body].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** 「新版」「文庫版」など版を表す語を外した書名。版違いを同じ本として比べるために使う */
const stripEdition = (s: string) =>
  norm(s).replace(/(新装|新訳|改訂|増補|完全|決定|文庫|普及|愛蔵|特装)+版|新版|第\d+版|\d+周年記念版/g, "");

/** 書名・著者・出版社の一致度。0 は「別の本」 */
function score(q: Query, c: Candidate): number {
  // 版違い（「夜と霧」と「夜と霧 新版」）は同点にして、どちらにするか人が選べるようにする
  const qt = stripEdition(q.title);
  const ct = stripEdition(c.title);
  let s = ct === qt ? 6 : ct.startsWith(qt) || qt.startsWith(ct) ? 4 : ct.includes(qt) ? 2 : 0;
  if (s === 0) return 0;
  if (q.author) {
    const qa = norm(q.author);
    const ca = c.authors.map(norm);
    // 「姓 名」の順や共著者の有無が違っても拾えるよう、どちらかが他方を含めば一致とみなす
    // ミドルネームの有無（「クレイトン・クリステンセン」と「クレイトン・M・クリステンセン」）でも拾えるよう、
    // 名前のいちばん長い部分（多くは姓）だけの一致も認める
    const key = q.author
      .split(/[・\s　,、／/]/)
      .map(norm)
      .sort((a, b) => b.length - a.length)[0];
    if (ca.some((a) => a.includes(qa) || qa.includes(a))) s += 3;
    else if (key && key.length >= 3 && ca.some((a) => a.includes(key))) s += 2;
    else return 0;
  }
  if (q.publisher && c.publisher && norm(c.publisher).includes(norm(q.publisher))) s += 1;
  return s;
}

function toCandidate(item: RakutenItem): Candidate | null {
  const isbn = (item.isbn ?? "").replaceAll("-", "");
  const isbn13 = isbn.length === 10 ? isbn10to13(isbn) : isbn;
  // 978/979 で始まらない番号は書籍の ISBN ではない（「謝恩価格本」などの店独自コード）
  if (!isValidIsbn13(isbn13) || !/^97[89]/.test(isbn13) || !item.title) return null;
  const cover = coverOf(item);
  return {
    isbn13,
    title: item.title,
    authors: splitAuthors(item.author),
    publisher: item.publisherName || undefined,
    publishedAt: parseSalesDate(item.salesDate),
    rakutenUrl: itemUrlOf(item),
    ...(cover ? { coverUrl: cover, coverSource: "rakuten" as const } : {}),
  };
}

/** 国立国会図書館サーチ（OpenSearch）。楽天にない本（絶版など）の補完用 */
async function ndlSearch(q: Query): Promise<Candidate[]> {
  const url = new URL("https://ndlsearch.ndl.go.jp/api/opensearch");
  url.searchParams.set("title", q.title);
  if (q.author) url.searchParams.set("creator", q.author.replace(/[\s　]/g, ""));
  url.searchParams.set("mediatype", "books");
  url.searchParams.set("cnt", "20");
  // 混んでいると 429 で拒否されるので、間を空けて2回までやり直す
  let res = await fetch(url);
  for (const wait of [5000, 15000]) {
    if (res.status !== 429) break;
    await sleep(wait);
    res = await fetch(url);
  }
  if (!res.ok) throw new Error(`NDL HTTP ${res.status}`);
  const xml = await res.text();
  const pick = (block: string, tag: string) =>
    [...block.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, "g"))].map((m) =>
      m[1]!.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"'),
    );
  const out: Candidate[] = [];
  for (const block of xml.split("<item>").slice(1)) {
    const isbnRaw = block.match(/<dc:identifier xsi:type="dcndl:ISBN">([^<]+)</)?.[1]?.replaceAll("-", "");
    if (!isbnRaw) continue;
    const isbn13 = isbnRaw.length === 10 ? isbn10to13(isbnRaw) : isbnRaw;
    const title = pick(block, "dc:title")[0];
    // 国内で刊行された本（9784…）だけを対象にする。原書や海外版は除く
    if (!title || !isValidIsbn13(isbn13) || !isbn13.startsWith("9784")) continue;
    // "嶋田, 英治, 1936-" → "嶋田 英治"
    const authors = pick(block, "dc:creator").map((a) =>
      a
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p && !/^\d{4}-?/.test(p))
        .join(" "),
    );
    const issued = pick(block, "dcterms:issued")[0]?.match(/^(\d{4})(?:\.(\d{1,2}))?/);
    out.push({
      isbn13,
      title,
      authors,
      publisher: pick(block, "dc:publisher")[0],
      // 年しか分からないときは入れない（books.json の形式は YYYY-MM か YYYY-MM-DD）
      publishedAt: issued?.[2] ? `${issued[1]}-${issued[2].padStart(2, "0")}` : undefined,
    });
  }
  return out;
}

/** loose: 書名を短くして探し直した結果。シリーズの別の巻などを拾いやすいので、必ず「要確認」にして候補を並べる */
function choose(q: Query, candidates: Candidate[], from: "rakuten" | "ndl", loose = false): SearchResult | null {
  const seen = new Set<string>();
  const scored = candidates
    .filter((c) => !seen.has(c.isbn13) && seen.add(c.isbn13))
    .map((c) => ({ c, s: score(q, c) }))
    .filter((x) => x.s > 0)
    // 同点なら元の並び（楽天は売れている順）を保つ
    .sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (!best) return null;
  const ties = loose ? scored.slice(1) : scored.slice(1).filter((x) => x.s === best.s);
  // 候補が1冊だけなら取り違えようがないので確定にする
  if (loose && ties.length > 0) {
    return { query: q, status: "ambiguous", from, book: best.c, alternatives: ties.slice(0, 5).map((x) => x.c) };
  }
  return {
    query: q,
    status: ties.length > 0 ? "ambiguous" : "found",
    from,
    book: best.c,
    ...(ties.length > 0 ? { alternatives: ties.slice(0, 5).map((x) => x.c) } : {}),
  };
}

async function runSearch(inputPath: string): Promise<void> {
  const raw: unknown = JSON.parse(readFileSync(inputPath, "utf8"));
  const queries = (Array.isArray(raw) ? raw : []).filter(
    (q): q is Query => typeof q === "object" && q !== null && typeof (q as Query).title === "string",
  );
  if (queries.length === 0) {
    console.error('[fetch-books] --search の入力は [{ "title": "...", "author": "..." }] の配列です。');
    process.exit(1);
  }
  const results: SearchResult[] = [];
  let lastNdl = 0;
  for (const [i, q] of queries.entries()) {
    if (i > 0) await sleep(INTERVAL_MS);
    let result: SearchResult | null = null;
    try {
      // 著者は API に渡さず手元で照合する（「姓 名」の空白や共著者の表記ゆれで取りこぼさないため）
      const search = async (title: string) =>
        (await rakutenSearch({ title, hits: "30", sort: "sales", outOfStockFlag: "1" }))
          .map(toCandidate)
          .filter((c) => c !== null);
      result = choose(q, await search(q.title), "rakuten");
      // 副題つきの長い書名は楽天の検索に掛からないことがあるので、主題だけでもう一度探す
      // 先頭の【エッセンシャル版】のような飾りも外す
      const main = q.title
        .replace(/^【[^】]*】/, "")
        .split(/[―—–:：　 ]/)[0]!
        .trim();
      if (!result && main.length >= 4 && main !== q.title) {
        await sleep(INTERVAL_MS);
        result = choose({ ...q, title: main }, await search(main), "rakuten", true);
        if (result) result.query = q;
      }
      if (!result) {
        // NDL は続けて叩くと拒否（429）されるので、間隔を空ける
        await sleep(Math.max(0, lastNdl + 2000 - Date.now()));
        lastNdl = Date.now();
        result = choose(q, await ndlSearch(q), "ndl");
      }
    } catch (e) {
      result = { query: q, status: "error", error: e instanceof Error ? e.message : String(e) };
    }
    result ??= { query: q, status: "not-found" };
    results.push(result);
    const label = result.book ? `${result.book.isbn13} ${result.book.title}（${result.from}）` : (result.error ?? "");
    console.error(`[fetch-books] ${result.status.padEnd(9)} ${q.title} → ${label}`);
  }
  const json = `${JSON.stringify(results, null, 2)}\n`;
  if (outFile) writeFileSync(outFile, json);
  else process.stdout.write(json);
  const count = (s: SearchResult["status"]) => results.filter((r) => r.status === s).length;
  console.error(
    `[fetch-books] 検索完了: 確定 ${count("found")} / 要確認 ${count("ambiguous")} / 見つからず ${count("not-found")} / 失敗 ${count("error")} / 対象 ${results.length} 冊`,
  );
}

if (searchFile) {
  await runSearch(searchFile);
  process.exit(0);
}

const file = join(process.cwd(), "data", "books.json");
const books = JSON.parse(readFileSync(file, "utf8")) as Partial<Book>[];
const targets = [
  ...new Set([...isbnArgs, ...(missing ? books.filter((b) => !b.coverUrl).map((b) => b.isbn13!) : [])]),
];
if (targets.length === 0) {
  console.error("使い方: pnpm fetch-books <isbn13...> | --missing [--dry-run] | --search in.json [--out out.json]");
  process.exit(1);
}

let updated = 0;
let failed = 0;
let notFound = 0;

for (const [i, isbn13] of targets.entries()) {
  if (i > 0) await sleep(INTERVAL_MS);
  try {
    const item = await fetchItem(isbn13);
    if (!item) {
      console.warn(`[fetch-books] ${isbn13}: 楽天ブックスに見つかりませんでした`);
      notFound++;
      continue;
    }
    const existing = books.find((b) => b.isbn13 === isbn13);
    const book: Partial<Book> = existing ?? { isbn13 };
    const cover = coverOf(item);
    const fetched: Partial<Book> = {
      title: item.title,
      authors: splitAuthors(item.author),
      publisher: item.publisherName,
      publishedAt: parseSalesDate(item.salesDate),
      rakutenUrl: itemUrlOf(item),
      ...(cover && !book.coverUrl ? { coverUrl: cover, coverSource: "rakuten" as const } : {}),
    };
    const filled: string[] = [];
    for (const [key, value] of Object.entries(fetched) as [keyof Book, unknown][]) {
      const current = book[key];
      const empty = current === undefined || current === "" || (Array.isArray(current) && current.length === 0);
      const usable = Array.isArray(value) ? value.length > 0 : Boolean(value);
      if (empty && usable) {
        (book as Record<string, unknown>)[key] = value;
        filled.push(key);
      }
    }
    const check = bookSchema.safeParse(book);
    if (!check.success) {
      console.warn(`[fetch-books] ${isbn13}: 取得結果が不完全なため反映しません（${check.error.issues[0]?.message}）`);
      failed++;
      continue;
    }
    if (!existing) books.push(book);
    if (filled.length > 0) updated++;
    console.log(`[fetch-books] ${isbn13} ${book.title}: ${filled.length > 0 ? `${filled.join(", ")} を補完` : "変更なし"}`);
  } catch (e) {
    console.error(`[fetch-books] ${isbn13}: 取得に失敗しました（${e instanceof Error ? e.message : e}）`);
    failed++;
  }
}

if (!dryRun && updated > 0) writeFileSync(file, `${JSON.stringify(books, null, 2)}\n`);
console.log(
  `[fetch-books] 完了: ${updated} 冊を更新${dryRun ? "（dry-run のため未保存）" : ""} / 見つからず ${notFound} 冊 / 失敗 ${failed} 冊 / 対象 ${targets.length} 冊`,
);
if (failed > 0) process.exitCode = 1;
