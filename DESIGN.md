# DESIGN.md — suisen

> AIエージェント向けのデザイン仕様書。UIを作る・変更するときは必ずこのファイルに従うこと。
> ベース: awesome-design-md-jp の `design-md/muji/DESIGN.md`（MIT License, © 2026 awesome-design-md-jp contributors）を、suisen 用に再構成したもの。MUJIのブランド要素（ロゴ・MUJI Red・名称）は使わない。

---

## 1. Visual Theme & Atmosphere

- **方針**: 必要なものだけを置く。装飾ではなく、余白・文字組み・整列で質感を出す
- **目指す印象**: 静かで、新しく、信頼できる。「安っぽい」「古臭い」に見えないこと
- **キーワード**: 余白、素朴、静謐、整列、紙と活字
- **主役**: 書影と文字。UIの部品は目立たせない

### 「安っぽく・古臭く」見せないための原則

- 小さすぎる文字を使わない（本文 16px 以上、補足でも 13px 以上）
- 枠線で囲みすぎない。区切りは余白と細い罫線（hairline）で作る
- 色数を絞る（文字のグレー階調＋きなり＋アクセント1色）
- 角丸・影・グラデーション・アイコンの多用をしない
- 要素の左端をそろえ、縦のリズム（spacing scale）を崩さない
- 見出しは大きく・行間は詰め気味、本文は行間をゆったり。このコントラストで「今っぽさ」を出す
- 書影は必ず同じ比率・同じ扱いで並べる（ばらつきが一番安っぽく見える）

---

## 2. Color Palette & Roles

### Neutral（基本はこれだけで組む）

| Token | Value | 用途 |
|---|---|---|
| `--color-text` | `#2b2b2e` | 本文・見出し。純黒は使わない |
| `--color-text-secondary` | `#6d6d72` | 補足、メタ情報、ラベル |
| `--color-text-tertiary` | `#8e8e93` | キャプション、出典の日付など |
| `--color-border` | `#e3e3e5` | 罫線、入力欄の枠 |
| `--color-border-light` | `#efefef` | ごく薄い区切り |
| `--color-bg` | `#ffffff` | ページ背景 |
| `--color-bg-subtle` | `#f7f7f7` | 書影の背景、placeholder |

### Brand Neutral

| Token | Value | 用途 |
|---|---|---|
| `--color-kinari` | `#f6f2e8` | きなり。ヒーロー、フッター、セクション背景に限定 |

### Accent（水仙）

| Token | Value | 用途 |
|---|---|---|
| `--color-accent` | `#e8b923` | 水仙の花の黄。**小さな面積だけ**（ロゴの i の点、ランキング順位の印、フォーカスリングの補助） |
| `--color-accent-ink` | `#3f5a3c` | 水仙の葉の深緑。リンクの hover、選択状態、PR表記の文字など控えめに |

- 黄色は白背景上の文字色に使わない（コントラスト不足）
- リンクは基本 `--color-text` ＋下線。色でリンクを表現しない

### Semantic

- **Danger**: `#c62828`（エラー表示のみ）

---

## 3. Typography Rules

### 3.1 font-family

```css
--font-sans: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif;
--font-num: "Helvetica Neue", Arial, var(--font-sans); /* 数字・欧文の小要素 */
```

- Webフォントは原則読み込まない（速度優先）。例外はロゴのみ（SVG化して配置）
- 明朝体は使わない

### 3.2 サイズ・ウェイト階層

| Role | Size (PC / SP) | Weight | Line Height | Letter Spacing |
|---|---|---|---|---|
| Display（トップの見出し） | 40px / 28px | 700 | 1.3 | 0.02em |
| H1（ページタイトル） | 32px / 24px | 700 | 1.35 | 0.02em |
| H2（セクション見出し） | 22px / 19px | 700 | 1.45 | 0.02em |
| H3（カード内タイトル・書名） | 16px | 700 | 1.5 | normal |
| Body | 16px | 400 | 1.85 | 0.02em |
| Small（メタ情報） | 14px | 400 | 1.7 | normal |
| Caption（出典・日付） | 13px | 400 | 1.6 | normal |
| Label（小見出し・セクション名） | 12px | 700 | 1.4 | 0.12em（英字ラベルは大文字にしない、小文字のまま） |

- 本文の行間は和文の可読性を優先して 1.85（MUJI原典の 1.6 より広め）
- 見出しは行間を詰めて本文と差をつける
- 数字（推薦者数、順位、年）は `font-variant-numeric: tabular-nums;`

### 3.3 禁則・改行

```css
line-break: strict;
overflow-wrap: anywhere;
word-break: normal;
text-wrap: pretty;       /* 本文 */
text-wrap: balance;      /* 見出し */
```

- `word-break: break-all` は使わない（英単語や書名が途中で切れて安っぽく見える）
- palt は使わない

---

## 4. Component Stylings

### Logo（ワードマーク）

- 小文字 `suisen` のみ。シンボルマークなし
- 最終版は SVG で差し替える前提。暫定は `--font-num` の 600、`letter-spacing: -0.02em`
- i の点だけ `--color-accent` にしてよい（SVG化後）

### Book Cover（書影）

- 比率は 2:3 固定（`aspect-ratio: 2 / 3; object-fit: contain;`）、背景 `--color-bg-subtle`
- 枠線 1px `--color-border-light`、角丸 2px、影なし
- 画像がない本は、同じ枠内に書名を 13px で中央寄せした placeholder
- `loading="lazy"`、`width`/`height` を必ず指定（CLS防止）

### Book Card（一覧）

- 書影 → 書名（H3, 2行で省略）→ 著者（Small, secondary）→ 「推薦 n人」（Caption）
- カード自体に枠線・背景はつけない。書影だけが面になる
- hover: 書影を `opacity: .85` にする程度。移動・拡大・影はしない

### Person Row（人物一覧）

- 名前（H3）＋肩書き（Small, secondary）＋推薦冊数（Caption）を1行に
- 区切りは下罫線 1px `--color-border-light`
- 人物写真・アバター・頭文字アイコンは使わない

### Recommendation（推薦の記述）

- 「誰が」「どの本を」「どこで（出典）」「いつ」「どんな理由で（要約）」を必ずセットで表示
- 出典は Caption サイズで、媒体名＋日付＋外部リンク
- 理由の要約は Body。引用する場合は短く、`<blockquote>` は左罫線 2px `--color-border` のみ

### Buttons（購入リンク）

- Primary（Amazonで見る）: 背景 `--color-text`、文字 白、角丸 4px、高さ 44px、14px/700
- Secondary（楽天ブックスで見る）: 背景透明、枠 1px `--color-border`、文字 `--color-text`、同サイズ
- 外部リンクであることは文末の小さな「↗」程度で示す。アイコンフォントは使わない

### Tags（属性・カテゴリ）

- 背景なし、枠 1px `--color-border`、角丸 999px、12px、padding 4px 10px
- 多用しない（1ブロックに最大5個）

### Inputs（検索）

- 枠 1px `--color-border`、角丸 4px、高さ 48px、16px（iOSのズーム防止）
- focus: 枠 `--color-text` ＋ `outline: 2px solid var(--color-accent); outline-offset: 2px`

### PR表記

- アフィリエイト参加と紹介料の説明は全ページ共通のフッターに Small サイズで掲載する。

---

## 5. Layout Principles

### Spacing Scale

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 48px |
| `--space-8` | 64px |
| `--space-9` | 96px |

- セクション間は PC `--space-9` / SP `--space-8`
- これ以外の値を使わない

### Container

- 本文幅: max 720px（読み物部分）
- 一覧幅: max 1120px
- 左右 padding: SP 20px / PC 32px

### Grid（書影一覧）

- SP 3列 / タブレット 4列 / PC 6列、gap 横 16px 縦 32px

---

## 6. Depth & Elevation

- 影は使わない。例外は検索候補などのポップオーバーのみ `0 4px 16px rgba(0,0,0,.06)`

---

## 7. Do's and Don'ts

### Do

- 余白と整列で構造を見せる
- テキスト色は `#2b2b2e`、補足は secondary に落とす
- 書影の比率・サイズをそろえる
- 1画面の情報を絞る。「もっと見る」で段階的に出す

### Don't

- 純黒 `#000` の文字
- 角丸 8px 以上（タグの pill を除く）
- グラデーション、ドロップシャドウ、ぼかし、アニメーション（`prefers-reduced-motion` に関係なく基本なし）
- 絵文字、アイコンの多用、人物写真
- 黄色 `--color-accent` を広い面や文字色に使う
- カードを枠と背景で囲う「箱だらけ」のレイアウト
- 12px 未満の文字

---

## 8. Responsive Behavior

| Name | Width |
|---|---|
| SP | ≤ 767px |
| Tablet | 768–1023px |
| PC | ≥ 1024px |

- モバイルファーストで書く
- タッチターゲット最小 44×44px
- ヘッダーは SP でもハンバーガーにしない（ロゴ＋検索アイコンのみ）

---

## 9. Agent Quick Reference

```
Text: #2b2b2e / Secondary: #6d6d72 / Border: #e3e3e5
Bg: #fff / Kinari: #f6f2e8 / Accent (small only): #e8b923 / Accent ink: #3f5a3c
Font: "Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif
Body: 16px / line-height 1.85 / letter-spacing .02em
Headings: 700, line-height 1.3–1.45
Radius: 2px (covers) / 4px (buttons, inputs) / 999px (tags only)
No shadows, no gradients, no photos of people, no emoji
```
