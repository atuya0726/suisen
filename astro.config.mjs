// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { existsSync, readFileSync } from "node:fs";

// .env を process.env に読み込む（すでに設定済みの環境変数＝Cloudflare 側の値が優先される）
if (existsSync(".env")) process.loadEnvFile(".env");

const site = process.env.SITE_URL?.trim();
if (!site) {
  throw new Error("SITE_URL が未設定です。.env（または Cloudflare の環境変数）に設定してください。");
}

// 推薦者が少ない本ページは noindex にしているので、sitemap にも載せない（しきい値は src/lib/indexing.json）
const { minRecommendersToIndexBook } = JSON.parse(readFileSync("src/lib/indexing.json", "utf8"));
/** @type {Map<string, Set<string>>} */
const recommenders = new Map();
for (const r of JSON.parse(readFileSync("data/recommendations.json", "utf8"))) {
  if (!r.verified) continue;
  if (!recommenders.has(r.isbn13)) recommenders.set(r.isbn13, new Set());
  recommenders.get(r.isbn13)?.add(r.personId);
}
/** @param {string} page */
function inSitemap(page) {
  const path = new URL(page).pathname;
  if (path.startsWith("/search/")) return false;
  const book = path.match(/^\/books\/(\d{13})\/$/);
  if (book) return (recommenders.get(book[1])?.size ?? 0) >= minRecommendersToIndexBook;
  return true;
}

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "never" },
  integrations: [sitemap({ filter: inSitemap })],
});
