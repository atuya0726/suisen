# suisen

著名人・経営者・作家などが紹介した本を、出典つきで集めて見せる静的サイト。
仕様は `CLAUDE.md`、デザインは `DESIGN.md` を参照。

## 必要なもの

- Node.js 22.12 以上
- pnpm

## セットアップ

```sh
pnpm install
cp .env.example .env   # 値を編集する
```

| 環境変数 | 用途 |
|---|---|
| `SITE_URL` | サイトの URL（canonical・sitemap・robots.txt・OGP の基準）。必須 |
| `AMAZON_ASSOCIATE_TAG` | Amazon アソシエイトのトラッキングID。空ならタグなしのリンクになる |
| `RAKUTEN_AFFILIATE_ID` | 楽天アフィリエイトID。空なら通常の楽天ブックスへのリンクになる |
| `RAKUTEN_APPLICATION_ID` / `RAKUTEN_ACCESS_KEY` | `pnpm fetch-books` 用（ビルドでは使わない）。両方必要 |
| `RAKUTEN_HTTP_REFERER` | 楽天のアプリに登録した参照元 URL。未設定なら `SITE_URL` を使う |
| `CONTACT_EMAIL` | `/about/` に出す訂正依頼の窓口 |
| `OPERATOR_NAME` | `/about/` に出す運営者名 |

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発サーバー（検索は `pnpm build` 後のみ動く） |
| `pnpm build` | データ検証 → `astro build` → Pagefind のインデックス生成 → `dist` のファイル数チェック |
| `pnpm preview` | ビルド結果をローカルで確認 |
| `pnpm validate-data` | `data/*.json` のスキーマ・参照整合性チェックだけを実行 |
| `pnpm fetch-books <isbn13...>` | 楽天ブックスAPI で書誌・書影URL を補完（`--missing` で書影のない本すべて、`--dry-run` で保存なし） |
| `pnpm check` | 型チェック |

## 楽天ブックスAPI のキー（書影・書誌の取得用）

`pnpm fetch-books` は `RAKUTEN_APPLICATION_ID` と `RAKUTEN_ACCESS_KEY` を、環境変数（`.env` を含む）→ macOS キーチェーンの順に探す。
キーはローカルでしか使わないので、`.env` に書かずにキーチェーンに入れておけば、スクリプトが実行時に自分で読む（値は表示しない）。

```sh
# 登録（初回のみ。値は対話入力になり、シェル履歴に残らない）
security add-generic-password -a "$USER" -s RAKUTEN_APPLICATION_ID -w
security add-generic-password -a "$USER" -s RAKUTEN_ACCESS_KEY -w

# 実行（キーを渡す指定は不要）
pnpm fetch-books --missing --dry-run
```

書名から ISBN をまとめて引くこともできる（調査で集めた本の ISBN・書誌・書影を一度に確定する用途）。

```sh
# in.json: [{ "title": "書名", "author": "著者（任意）", "publisher": "出版社（任意）" }, ...]
pnpm fetch-books --search in.json --out out.json
```

楽天ブックスで探し、見つからない本だけ国立国会図書館サーチで補う。結果は `out.json` に書くだけで `data/books.json` は変更しない。`status` が `ambiguous` の本は同じくらい合う版が複数ある（単行本と文庫など）ので、`alternatives` を見て版を選ぶ。

`SITE_URL`・`AMAZON_ASSOCIATE_TAG`・`RAKUTEN_AFFILIATE_ID` は秘密情報ではなく（リンクに含まれて公開される）、Cloudflare 側のビルドでも必要なので、環境変数のままにする。

## データの編集

`data/` の4つの JSON を編集する。スキーマは `src/lib/schema.ts`。

- `verified: false` の推薦はサイトに出ない（件数だけビルドログに出る）
- 推薦が1件もない人物・本はページが作られない
- 属性（`tags`）を増やすときは `src/lib/schema.ts` の `TAG_SLUGS` に「属性名 → URL スラッグ」を1行足す
- 不整合（存在しない ID、ISBN のチェックディジット違い、重複、40字を超える引用）があるとビルドが止まる

`data/` には実データが入っている（出典つきで集めた実在の推薦）。開発用のダミーデータは `data/sample/` に退避してある。調査済み URL の台帳は `data/research/checked-urls.json`。

## デプロイ（Cloudflare Workers の Static Assets）

`dist/` を静的ファイルとして配信する。Worker スクリプト・SSR は使わない（設定は `wrangler.jsonc`）。

### 手元からデプロイする

```sh
pnpm exec wrangler login     # 初回のみ
pnpm build                   # .env の値でビルドされる
pnpm exec wrangler deploy
```

独自ドメイン `suisen.page` は `wrangler.jsonc` の `routes`（`custom_domain: true`）で指定してあり、デプロイ時に DNS と証明書が自動で設定される（ドメインは Cloudflare で管理している前提）。`.env` の `SITE_URL` も同じドメインにしておく。

`workers_dev: false` / `preview_urls: false` にしているため、`*.workers.dev` では配信されない（重複コンテンツ防止）。

### Git 連携（Workers Builds）でデプロイする

1. Cloudflare ダッシュボードの Workers & Pages → Create → Import a repository でリポジトリを接続する
2. Build command: `pnpm build` / Deploy command: `npx wrangler deploy`
3. Settings → Build → Variables and secrets に `SITE_URL`・`AMAZON_ASSOCIATE_TAG`・`RAKUTEN_AFFILIATE_ID`・`CONTACT_EMAIL`・`OPERATOR_NAME` を設定する（ビルド時に読まれる）

### ファイル数の上限

Static Assets のファイル数上限は Free 20,000 / Paid 100,000。`pnpm build` の最後に `dist` のファイル数が表示され、18,000 を超えると警告が出る。
