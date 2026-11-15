export const SITE_NAME = "suisen";
export const SITE_TAGLINE = "あの人が薦めた本を、出典つきで。";
export const SITE_DESCRIPTION =
  "経営者・作家・研究者などが記事やインタビューで紹介した本を、出典つきで集めたサイトです。人物から、本から、ランキングから探せます。";

/** 訂正依頼・削除の申し出・問い合わせ先（環境変数 CONTACT_EMAIL でも上書きできる） */
export const CONTACT_EMAIL = process.env.CONTACT_EMAIL?.trim() || "nagasunari.it@gmail.com";
/** 運営者名（環境変数 OPERATOR_NAME でも上書きできる） */
export const OPERATOR_NAME = process.env.OPERATOR_NAME?.trim() || "suisen運営";

export const PR_NOTICE = "本ページはプロモーションを含みます";

/** 2025-03-01 → 2025年3月1日、2025-03 → 2025年3月 */
export function formatDate(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return `${y}年${m}月${d ? `${d}日` : ""}`;
}

export function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/** 著者表記。3人以上は「先頭 ほか」 */
export function authorsLabel(authors: string[]): string {
  return authors.length > 2 ? `${authors[0]} ほか` : authors.join("、");
}

export const titles = {
  person: (name: string, n: number) => `${name}のおすすめ本・愛読書 ${n}冊｜${SITE_NAME}`,
  /** 大学・賞など個人ではない推薦者（kind: "organization"） */
  organization: (name: string, n: number) => `${name}の推薦本 ${n}冊｜${SITE_NAME}`,
  book: (title: string, authors: string[], n: number) =>
    `${title}（${authorsLabel(authors)}）を推薦した人 ${n}人｜${SITE_NAME}`,
  tagRanking: (tag: string) => `${tag}が推薦する本ランキング｜${SITE_NAME}`,
};

export interface Crumb {
  name: string;
  /** 末尾（現在のページ）は省略 */
  href?: string;
}

export const RANKING_PAGE_SIZE = 50;
export const PEOPLE_PAGE_SIZE = 100;
