import type { Book } from "./schema";

// astro.config.mjs が .env を process.env に読み込んでいる（ビルド時のみ参照）
const amazonTag = process.env.AMAZON_ASSOCIATE_TAG?.trim();
const rakutenAffiliateId = process.env.RAKUTEN_AFFILIATE_ID?.trim();

/** 978 始まりの ISBN13 を ISBN10 に変換する。979 始まりは ISBN10 がないので null */
export function isbn13to10(isbn13: string): string | null {
  if (!/^978\d{10}$/.test(isbn13)) return null;
  const body = isbn13.slice(3, 12);
  const sum = [...body].reduce((acc, ch, i) => acc + Number(ch) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? "X" : String(check));
}

/** Amazon の商品ページ。ASIN も ISBN10 もない本（979 始まり）は ISBN 検索にする */
export function amazonUrl(book: Pick<Book, "isbn13" | "asin">): string {
  const id = book.asin ?? isbn13to10(book.isbn13);
  const url = new URL(id ? `https://www.amazon.co.jp/dp/${id}` : "https://www.amazon.co.jp/s");
  if (!id) url.searchParams.set("k", book.isbn13);
  if (amazonTag) url.searchParams.set("tag", amazonTag);
  return url.href;
}

/**
 * 楽天ブックスの ISBN 検索ページ。アフィリエイトID があれば楽天アフィリエイトのリンクで包む。
 * リンク形式を変えるときはこの関数だけを直す。
 */
export function rakutenUrl(book: Pick<Book, "isbn13" | "rakutenUrl">): string {
  // 商品ページが分かっていればそこへ、なければ ISBN 検索へ
  const target = book.rakutenUrl ?? `https://books.rakuten.co.jp/search?sitem=${book.isbn13}`;
  if (!rakutenAffiliateId) return target;
  const encoded = encodeURIComponent(target);
  return `https://hb.afl.rakuten.co.jp/hgc/${rakutenAffiliateId}/?pc=${encoded}&m=${encoded}`;
}
