# suisen — 開発指示書（Claude Code 向け）

著名人・経営者・作家などが「推薦した本」を、出典付きで集めて見せる静的サイト。
人物ページ・本ページ・ランキングでロングテール検索を取り、Amazon アソシエイトと楽天アフィリエイトで収益化する。

UI を作るときは必ずリポジトリ直下の `DESIGN.md` に従うこと。

---

## 0. 進め方

1. まず §2〜§4 の構成でプロジェクトを作り、サンプルデータでビルドが通る状態にする
2. ページを §5 の順に実装する
3. §9 の受け入れ条件をすべて満たしたら完了。途中で仕様の判断に迷ったら、勝手に機能を足さずに質問する
4. 「必要最小限」が最優先。ここに書いていない機能（ログイン、コメント、いいね、レビュー投稿、ダークモード、アニメーション等）は作らない

---

## 1. 技術構成

| 項目 | 採用 |
|---|---|
| フレームワーク | Astro 6（`output: "static"`、全ページをビルド時に生成） |
| 言語 | TypeScript（strict） |
| スタイル | 素の CSS（CSS custom properties）。Tailwind・UIライブラリは入れない |
| クライアントJS | 原則ゼロ。例外は検索ページの Pagefind のみ（ソースコードに書くものの話。Cloudflare Web Analytics の計測スクリプトは、Cloudflare が配信時に自動で差し込む） |
| 検索 | Pagefind（ビルド後にインデックス生成） |
| サイトマップ | `@astrojs/sitemap` |
| ホスティング | Cloudflare Workers の Static Assets（`wrangler.jsonc` の `assets.directory = "./dist"`）。SSRアダプターは使わない |
| DB | なし。データはリポジトリ内の JSON |
| パッケージ管理 | pnpm |

- 本番の Workers Paid の Static Assets は、Worker のバージョンごとに 100,000 ファイルが上限。`pnpm build` の最後に `dist` のファイル数を表示し、90,000 を超えたら警告を出す
- 環境変数（`.env`、Cloudflare 側にも設定）:
  - `SITE_URL`（例 `https://suisen.page`、ドメイン未確定なので必ず変数で扱う）
  - `AMAZON_ASSOCIATE_TAG`
  - `RAKUTEN_AFFILIATE_ID`
  - `RAKUTEN_APP_ID`（書影・書誌取得スクリプト用。ビルドでは使わない）

---

## 2. ディレクトリ構成

```
/
├─ CLAUDE.md
├─ DESIGN.md
├─ astro.config.mjs
├─ wrangler.jsonc
├─ data/
│  ├─ people.json
│  ├─ books.json
│  ├─ recommendations.json
│  ├─ sources.json
│  ├─ research/checked-urls.json  # 調査済みURLの台帳（採用・不採用と理由）。次の調査で除外する。ビルドでは使わない
│  └─ sample/              # 開発用のダミーデータ（退避）
├─ scripts/
│  ├─ validate-data.ts     # スキーマ検証＋参照整合性チェック
│  ├─ fetch-books.ts       # ISBN から書誌・書影URLを楽天ブックスAPIで補完
│  ├─ count-dist.ts        # dist のファイル数チェック
│  ├─ import-research.py   # 調査結果（JSON）を data/ に取り込む（本の特定、ID の採番、台帳の更新）
│  └─ routine.py           # 定期実行（日次の収集・週次の振り返り）を Claude Code の非対話モードで回す
├─ src/
│  ├─ lib/
│  │  ├─ schema.ts         # zod スキーマ
│  │  ├─ data.ts           # JSON 読み込み・集計（ランキング計算など）
│  │  └─ links.ts          # アフィリエイトURL生成
│  ├─ layouts/Base.astro
│  ├─ components/          # BookCover, BookCard, PersonRow, Recommendation, BuyButtons, Breadcrumbs, Pagination
│  ├─ styles/global.css    # DESIGN.md のトークンをここに定義
│  └─ pages/               # §5
└─ public/
   ├─ robots.txt（ビルド時生成でもよい）
   └─ og-default.png
```

---

## 3. データ設計

ID は URL にそのまま使う。変更しない前提で付ける。

### people.json

```ts
{
  id: string;          // URL用。p0001 からの連番（例 "p0042"）。名前の読みから作らない（読みの確認が難しく、間違えると URL を直せないため）。新しい人は最大の番号+1。番号は変えない・使い回さない
  name: string;        // 表示名
  kana?: string;       // よみ（並び替え用）。確認できたときだけ入れる。未確認なら省き、後から足してよい
  title: string;       // 肩書き（例 "株式会社〇〇 代表取締役"）。時点が重要なら sources 側の日付と併記
  tags: string[];      // 属性（"経営者" | "作家" | "研究者" | "スポーツ選手" | "芸能" | "エンジニア" | "大学" | "書店" ...）
  affiliation?: string; // 所属する大学・会社などの名前（例 "立命館大学" "サイバーエージェント"）。学部・役職・「株式会社」は含めない。同じ所属は同じ表記にそろえる。所属別ページ（`/affiliations/[slug]/`）に使う。3人以上になった所属は `src/lib/affiliations.json` に slug（ローマ字 kebab-case、変えない）を足す（無いと `validate-data` が警告する）。作家・芸能など所属で語られない人は省く
  noPage?: boolean;     // true なら個別ページを作らず、人物一覧にも載せない。推薦者数には数え、本ページに名前と出典を出す。選書記事を書いた書店主・選書家など、その人のページが元の選書リストの再現になってしまう推薦者に使う（属性は "選書家"）
  kind?: "person" | "organization";  // 大学・書店の賞（キノベス等）など個人ではない推薦者は "organization"。省略時は個人。推薦者数には個人と同じく1として数える
  sameAs?: string[];   // 本人を特定できる外部ページの https URL（Wikipedia・公式サイトなど）。人物ページの JSON-LD（Person.sameAs）に出す
}
```

### books.json

```ts
{
  isbn13: string;      // 主キー。URL にも使う
  title: string;
  authors: string[];
  publisher?: string;
  publishedAt?: string;   // YYYY-MM or YYYY-MM-DD
  coverUrl?: string;      // 楽天ブックス or Amazon の書影URL（fetch-books.ts が埋める）
  coverSource?: "rakuten" | "amazon";
  asin?: string;          // あれば Amazon リンクに使う
}
```

- 漫画などのシリーズを「作品として」薦めている場合（巻の指定がない場合）は、第1巻の ISBN で登録し、`title` は巻数を付けないシリーズ名にする（例: ISBN は『キングダム 1』、title は「キングダム」）。特定の巻を薦めている場合はその巻のまま
- 上下巻は上巻の ISBN で登録し、`title` に「上」を残す

### sources.json（出典）

```ts
{
  id: string;
  type: "article" | "interview" | "podcast" | "video" | "book" | "sns";
  media: string;       // 媒体名（例 "日本経済新聞"）
  title: string;       // 記事・回のタイトル
  url: string;
  publishedAt?: string; // YYYY-MM-DD。出典ページから分からなければ省く（推測で埋めない）。画面には「掲載日不明」と出し、並び順では最も古い扱い
}
```

### recommendations.json（人×本の推薦。サイトの中心データ）

```ts
{
  personId: string;
  isbn13: string;
  sourceId: string;
  timestamp?: string;  // 動画・音声の該当位置 "12:34"
  note?: string;       // 出典の行だけでは分からない事実の短い補足（任意、40字以内）。例「第3位」「上下巻のうち上巻を掲載」。推薦理由の要約は書かない（§7）
  quote?: string;      // 本人の発言の短い引用（任意、40字以内）
  context?: "座右の書" | "人生を変えた一冊" | "社員に薦めたい" | "最近読んだ" | "その他";
  verified: boolean;   // 人が出典を確認したか
}
```

### ルール（validate-data.ts で検査し、違反があればビルドを失敗させる）

- 参照整合性: recommendations の personId / isbn13 / sourceId がすべて存在する
- ISBN13 のチェックディジットが正しい
- 同じ (personId, isbn13, sourceId) の重複なし
- `verified: false` の推薦はサイトに出さない（ビルド時に除外し、件数だけログに出す）
- `quote` は 40 字以内
- 推薦が1件もない人物・本はページを生成しない

### サンプルデータ

- 開発用に人物 8人・本 30冊・推薦 60件程度のダミーデータを作る
- **実在の人物名・実在の推薦は使わない**（誤った紐付けを公開しないため）。人物は「サンプル 一郎」のような明らかな架空名、本は実在の ISBN を使ってよい

---

## 4. 集計ロジック（src/lib/data.ts）

- 本の「推薦者数」= その本を推薦した distinct person 数（verified のみ）
- 総合ランキング: 推薦者数 降順 → 同数なら最新の推薦日 降順 → isbn13 昇順
- 属性別ランキング: 推薦者の tags で絞った上で同じ計算
- 「この本を推薦した人は、こんな本も推薦」: 推薦者が共通する本を、共通人数の多い順に最大12冊
- 「似た人」: 推薦本が重なる人物を、重なり冊数の多い順に最大8人
- すべてビルド時に計算する

---

## 5. ページ

すべてのページに: `<title>`、meta description、canonical（`SITE_URL` 基準）、OGP、パンくず（トップ以外）、PR表記（§7）

| URL | 内容 | 優先度 |
|---|---|---|
| `/` | 一言の説明＋検索ボックス、総合ランキング上位12冊、新着の推薦10件、属性への入口 | 1 |
| `/people/[id]/` | 人物ページ。名前・肩書き・属性、推薦本一覧（推薦ごとに出典と購入ボタン。検索の入口になるページなので、本ページを経由せずに買えるようにする）、似た人 | 1 |
| `/books/[isbn13]/` | 本ページ。書影・書誌・購入ボタン、推薦した人一覧（出典つき）、こんな本も推薦 | 1 |
| `/ranking/` | 総合ランキング（1ページ50冊、ページネーション `/ranking/2/`） | 2 |
| `/ranking/[tag]/` | 属性別ランキング（例 経営者が推薦する本）。推薦者が3人以上いる属性だけ生成 | 2 |
| `/people/` | 人物一覧（よみ順、1ページ100人） | 2 |
| `/affiliations/[slug]/` | 所属別ページ（例 北海道大学の人が紹介した本）。所属する人が紹介した本の上位24冊と、人物の一覧。個別ページのある人が3人以上いて、`src/lib/affiliations.json` に slug がある所属だけ生成（noPage の人は載せない）。一覧は `/affiliations/` | 2 |
| `/search/` | Pagefind による検索（人物名・書名・著者名） | 3 |
| `/about/` | サイトの説明、データの集め方・掲載基準、訂正依頼の連絡先、運営者情報、アフィリエイトについて | 3 |
| `404` | シンプルなお知らせとトップへのリンク | 3 |

### 検索エンジンに載せるページ

- 推薦者が 2 人未満の本ページは `noindex` にし、sitemap にも載せない（中身が「1人が紹介した」の1行だけで薄く、数が多いとサイト全体の評価を下げるため）。ページ自体は生成し、人物ページやランキングからのリンクは残す
- しきい値は `src/lib/indexing.json` の `minRecommendersToIndexBook`。本ページと `astro.config.mjs`（sitemap）の両方がここを読む

### タイトルの型（ロングテール検索の受け皿なので厳守）

- 人物: `{name}のおすすめ本・愛読書 {n}冊｜suisen`
- 組織（kind: "organization"）: `{name}の推薦本 {n}冊｜suisen`
- 本: `{title}（{著者}）を推薦した人 {n}人｜suisen`
- 属性別ランキング: `{tag}が推薦する本ランキング｜suisen`
- 所属（大学）: `{name}の推薦図書｜{n}人が薦める本 {m}冊｜suisen`、所属（大学以外）: `{name}の{n}人が薦める本 {m}冊｜suisen`
- description も同じ情報を自然な文で（120字以内）

### 構造化データ（JSON-LD）

- 本ページ: `Book`（name, author, isbn, image）
- ランキング・人物ページ: `ItemList`
- 全ページ: `BreadcrumbList`
- `Review` や `AggregateRating` は使わない（星評価のデータはないため）

---

## 6. 書影とアフィリエイトリンク

- 書影は楽天ブックス・Amazon が提供する画像URLを `<img>` でそのまま表示する。**自サーバーに保存・加工しない**
- 優先順位: `coverUrl`（楽天 → Amazon）→ なければ DESIGN.md の placeholder
- `scripts/fetch-books.ts`: ISBN を渡すと楽天ブックス書籍検索APIで title / authors / publisher / 発売日 / 書影URL を取得し `books.json` を更新する。既存の手入力値は上書きしない。APIの利用規約上の帰属表示が必要なら `/about/` とフッターに入れる
- Amazon リンク: `https://www.amazon.co.jp/dp/{asin or isbn10}?tag={AMAZON_ASSOCIATE_TAG}`（ISBN13→ISBN10 変換関数を `links.ts` に）
- 楽天リンク: 楽天アフィリエイトの形式でアフィリエイトIDを付与（形式は `links.ts` 1か所に閉じ込める）
- 外部リンクはすべて `target="_blank" rel="sponsored noopener"`（出典リンクは `rel="noopener"`）

---

## 7. 法令・掲載ポリシー（必ず守る）

- **PR表記**: 全ページ共通のフッターにアフィリエイト参加と紹介料の説明を掲載する。`/about/` にも参加プログラムを明記する。
- **出典必須**: 推薦はすべて出典（媒体・日付・URL）とセットで表示。日付が出典ページから分からない場合だけ「掲載日不明」として載せてよい。出典のない推薦は表示しない
- **有料・会員限定の記事は出典にしない**: ログインなしで該当箇所を読める出典だけを使う（読者が確かめられず、こちらも全文を確認できないため）
- **テレビ・ラジオ番組での紹介**: 番組の公式ページか、放送内容を伝える報道記事（番組名と放送日が特定できるもの）を出典にしてよい。「誰がどの本を紹介したか」が記事の本文に書かれていること。補足（note）に番組名と放送日を書く。第三者のまとめ記事、個人ブログ、プレスリリースの宣伝文は出典にしない
- **本人の公式サイトによる引用**: 本人（故人を含む）の公式サイト・事務所・財団のページが、本人の文章や発言を引用して、愛読した本・影響を受けた本を挙げている場合は出典にしてよい。引用か、その出どころ（掲載紙・年）が示されている本に限る。編集部の推測だけの本は載せない
- **推薦理由の要約を載せない**: 自分の言葉で書き直しても、記事の内容（どの本をなぜ薦めたか）を再現すると翻案に当たるおそれがある。載せるのは「誰が・どの本を・どこで・いつ紹介したか」という事実と、文脈の区分（context）、短い補足（note）だけ。理由は出典へのリンクで読んでもらう
- **申し出があれば外す**: 選書リストを丸ごと載せている出典（大学の「おすすめの10冊」など）は、編集著作物として問題になる余地がある。媒体・大学・本人から削除の申し出があれば、その出典の推薦を速やかに外す（出典 ID 単位で消せる）。窓口は `/about/` の連絡先
- **引用は最小限**: 本人の発言は 40 字以内の短い引用のみ。記事本文の転載はしない
- **人物写真を使わない**（肖像権・パブリシティ権）
- **訂正依頼の窓口**を `/about/` に置く（メールアドレスは環境変数 or 定数、後で差し替え）
- 「〇〇さんおすすめ」と断定せず、事実として「〇〇（媒体, 日付）で紹介」と書く

---

## 8. パフォーマンス・品質

- クライアント JS は `/search/` 以外ゼロ
- 画像は `width`/`height` 指定、`loading="lazy"`（ファーストビューの1枚だけ eager）
- CSS は 1 ファイル、20KB 以下目安
- アクセシビリティ: 見出し階層を飛ばさない、`alt` は「{書名}の書影」、コントラスト AA
- `pnpm build` の流れ: `validate-data` → `astro build` → `pagefind --site dist` → `count-dist`

---

## 9. 受け入れ条件

- [ ] `pnpm build` がサンプルデータで成功し、`pnpm preview`（または `wrangler dev`）で全ページが表示される
- [ ] データに不整合を入れると `validate-data` がビルドを止める
- [ ] `verified: false` の推薦が画面に出ない
- [ ] 人物・本・ランキングのタイトル／description が §5 の型どおり
- [ ] sitemap.xml と robots.txt が `SITE_URL` 基準で出力される
- [ ] 全ページに PR 表記・canonical・パンくずがある
- [ ] SP（375px）と PC（1280px）で DESIGN.md の見た目になっている。影・グラデーション・人物写真・絵文字がない
- [ ] Lighthouse（モバイル）で Performance / Accessibility / SEO / Best Practices がすべて 95 以上
- [ ] `wrangler deploy` で Workers にデプロイできる手順を README.md に記載

---

## 10. やらないこと（v1）

- ユーザー登録、レビュー投稿、お気に入り
- DB（D1 等）・SSR
- 記事・ブログ機能
- 多言語対応、ダークモード
- （変更）データ収集はこのリポジトリで行う。日次の収集と週次の振り返りを launchd から無人実行する（`scripts/routine.py`、手順は `.claude/skills/collect/` と `.claude/skills/weekly-review/`、状態は `docs/operations.md`）
