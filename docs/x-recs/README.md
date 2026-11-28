# X収集の推薦本リスト（未検証）

suisenに取り込む前の作業用リストです。ISBNの補完とインポートはローカルのスクリプトで行ってください。このまま `data/` には入れないでください。

- ファイル: `x-recs-all.csv`（UTF-8、BOMなし）
- 件数: 526件、102人分（収集日: 2026-11-27 および 2026-11-28）

## 検証状態

全行が未検証です。`verified` 列は `False` または空で、`true` はありません。引用の取り違えや書名の誤認が残っている可能性があるので、投入前に確認してください。

## 出典

- 478件は本人のXポストです（`source_type=sns`、`source_url` は x.com）
- 残りの48件はX以外の出典です（主に 2026-11-27 バッチ）。内訳は Gates Notes などの公式リスト 39件、インタビュー・メディア記事など 9件

各行の `source_url` に元ポストまたは記事のURLがあります。

## ISBN

ISBNはほとんど空です。`isbn13` が入っているのは5件、`jp_isbn13` が入っているのは133件、どちらかがある行は138件です。欠けている分はローカルのスクリプトで埋める想定です。

## 列

| 列 | 内容 |
|---|---|
| person | 人物名 |
| personId_if_exists | suisen上の人物ID（既存のとき） |
| handle | Xのハンドル |
| book_title | 出典どおりの書名 |
| author_if_known | 著者（判明している場合） |
| jp_title | 日本語タイトル |
| isbn13 | ISBN-13 |
| jp_isbn13 | 日本語版ISBN-13 |
| already_in_suisen_person | 人物がsuisenに既存か |
| already_in_suisen_book | 本がsuisenに既存か |
| already_in_suisen_rec | この推薦がsuisenに既存か |
| quote | 引用 |
| quote_len | 引用の文字数 |
| japanese_note | 日本語の補足 |
| context | 文脈カテゴリ |
| confidence | 確信度 |
| source_type | 出典種別（sns / official_list など） |
| source_url | 出典URL |
| publishedAt | 出典の日付 |
| note | メモ |
| batch | 収集バッチ |
| suisen_book_title | suisen上の書名（既存のとき） |
| verified | 検証済みか。本リストではすべて未検証 |

収集時点の照合では、人物が既存の行が114件、本が既存の行が119件、推薦自体が既存の行が8件でした。
