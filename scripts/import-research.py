#!/usr/bin/env python3
"""調査結果（JSON）を data/ に取り込む。

  python3 scripts/import-research.py data/research/incoming/NAME.json            取り込む
  python3 scripts/import-research.py data/research/incoming/NAME.json --dry-run  何が入るかだけ表示（書き込まない）

入力の形（調査役が書く。ISBN と推薦理由は不要）:
  {
    "people":  [{ "id": "仮の名前", "name": "表示名", "kana": "よみ（任意）", "title": "肩書き", "tags": ["作家"], "affiliation": "所属（任意）", "noPage": "個別ページを作らない推薦者は true（任意）" }],
    "sources": [{ "id": "仮の名前", "type": "article|interview|podcast|video|book|sns", "media": "媒体名", "title": "記事タイトル", "url": "https://…", "publishedAt": "YYYY-MM-DD（任意）" }],
    "recommendations": [{ "personId": "", "sourceId": "", "book": { "title": "本題", "author": "著者", "publisher": "出版社", "isbn": "ページにあれば", "edition": "版・刊行年・叢書名。漫画などシリーズで巻の指定がなければ「シリーズ」" }, "context": "任意", "note": "任意（40字以内の事実の補足）" }],
    "checkedUrls": [{ "url": "", "result": "rejected|unreachable|candidate|index", "reason": "", "person": "" }]
  }

やること:
  1. 本を特定する。ページに ISBN があればそれを使い、なければ書名と著者で検索する（pnpm fetch-books --search）。
     版が複数あるときは、出典の版元・刊行年に合う版、巻のある本は第1巻（上巻）を選ぶ。決めきれない本は取り込まない。
  2. 「シリーズ」と書かれた本は第1巻の ISBN で登録し、書名から巻数を外す。
  3. 人物に連番の ID（p0001…）を振る。同じ名前の人がいれば、その人に足す。
  4. data/*.json と、調査済み URL の台帳（data/research/checked-urls.json）を更新する。
  5. 取り込んだ本の書名が、出典の書名と食い違っていないかを人ごとに突き合わせて報告する。

同じ場所に NAME.pick.json（{"書名": "ISBN13" または null}）を置くと、版を手で指定できる（null は取り込まない）。
"""
import datetime as dt
import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
LEDGER = DATA / "research" / "checked-urls.json"
TODAY = dt.date.today().isoformat()

NFKC = lambda s: unicodedata.normalize("NFKC", s or "")
nospace = lambda s: re.sub(r"[ 　]", "", s or "")


def isbn13(raw):
    """10桁・13桁の ISBN を 13桁にそろえる。国内の本（9784…）以外や不正な番号は None。"""
    d = re.sub(r"[^0-9Xx]", "", raw or "")
    if len(d) == 10:
        body = "978" + d[:9]
        d = body + str((10 - sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(body)) % 10) % 10)
    ok = len(d) == 13 and d.isdigit() and sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(d)) % 10 == 0
    return d if ok and d.startswith("9784") else None


def strip_title(t):
    """版や記号の違いを無視して書名を比べるための形。"""
    return re.sub(
        r"[\s・:：!！?？（）()\[\]［］【】〔〕「」『』\-―&＆,、.。~〜=＝/／<>〈〉×]|新装版|新版|新訳版|完全版|改訂版|増補版|文庫版|文庫|愛蔵版|新装|改版",
        "",
        NFKC(t),
    ).lower()


# 第1巻・上巻を表す末尾（「21」「81」の 1 を拾わないよう、直前が数字でないことを確かめる）
VOL1 = re.compile(r"(上巻?|[（(]上[)）]|(?<![0-9])[\s]*[（(]?(?:第)?[1一](?:巻|冊)?[)）]?)\s*$")
# 書名から外す「第1巻」の表記（上巻の「上」は残す）
VOL1_NUM = re.compile(r"(?<![0-9０-９])[\s　]*(?:[（(](?:第)?[1１一](?:巻|冊)?[)）]|(?:第)?[1１](?:巻|冊)|[\s　][1１])\s*$")


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def dump(path, obj):
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch_books(*args):
    return subprocess.run(["pnpm", "-s", "fetch-books", *args], cwd=ROOT, capture_output=True, text=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    if len(args) != 1:
        print(__doc__)
        sys.exit(2)
    src_path = Path(args[0]).resolve()
    research = load(src_path)
    pick_path = src_path.with_suffix(".pick.json")
    pick = load(pick_path) if pick_path.exists() else {}

    people = load(DATA / "people.json")
    books = load(DATA / "books.json")
    sources = load(DATA / "sources.json")
    recs = load(DATA / "recommendations.json")

    # ---- 入力の整理: 著者も ISBN も分からない本は取り違えやすいので取り込まない
    notes = {}
    wanted = []
    dropped = []
    for r in research.get("recommendations", []):
        b = r.get("book") or {}
        title = (b.get("title") or "").strip()
        if not title or not (b.get("author") or isbn13(b.get("isbn"))):
            dropped.append(title or "(書名なし)")
            continue
        b["title"] = title
        notes[title] = " ".join(x for x in (b.get("note"), b.get("edition")) if x)
        wanted.append(r)

    is_series = lambda title: "シリーズ" in notes.get(title, "")

    # ---- 本の特定 1: ページに書かれた ISBN
    page_isbn = {r["book"]["title"]: isbn13(r["book"].get("isbn")) for r in wanted if isbn13(r["book"].get("isbn"))}
    have = {b["isbn13"]: b for b in books}
    need = sorted(set(page_isbn.values()) - set(have))
    if need and not dry:
        for i in range(0, len(need), 40):
            fetch_books(*need[i : i + 40])  # 楽天から書誌と書影を入れる（books.json に追記される）
        books = load(DATA / "books.json")
        have = {b["isbn13"]: b for b in books}

    # ---- 本の特定 2: 書名と著者で検索（ISBN のない本だけ）
    queries, seen = [], set()
    for r in wanted:
        b = r["book"]
        if b["title"] in seen or b["title"] in page_isbn:
            continue
        seen.add(b["title"])
        q = {"title": b["title"]}
        if b.get("author"):
            q["author"] = re.split(r"[、,／/（(]| 著|原作|・(?=[^ァ-ヶ])", b["author"])[0].strip() or b["author"]
        if b.get("publisher"):
            q["publisher"] = b["publisher"]
        if is_series(b["title"]):
            q["sort"] = "+releaseDate"  # 発売の古い順 = 第1巻が先頭に来る
        queries.append(q)
    lookup_path = src_path.with_suffix(".lookup.json")
    results = {}
    if queries:
        if lookup_path.exists():
            results = {r["query"]["title"]: r for r in load(lookup_path)}
        missing = [q for q in queries if q["title"] not in results]
        if missing:
            q_path = src_path.with_suffix(".queries.json")
            dump(q_path, missing)
            out_path = src_path.with_suffix(".lookup-new.json")
            fetch_books("--search", str(q_path), "--out", str(out_path))
            if out_path.exists():
                results.update({r["query"]["title"]: r for r in load(out_path)})
                out_path.unlink()
            q_path.unlink(missing_ok=True)
            dump(lookup_path, list(results.values()))

    def choose(title):
        """その書名に当てる本（books.json の形）を返す。決めきれなければ None。"""
        if title in pick:
            want = pick[title]
            if want is None:
                return None
            if want in have:
                return have[want]
            for c in candidates(title):
                if c["isbn13"] == want:
                    return c
            # 手で指定された ISBN: 楽天から書誌を取り、無ければ出典の書誌で登録する
            if not isbn13(want):
                return None
            if not dry:
                fetch_books(want)
                fresh = {b["isbn13"]: b for b in load(DATA / "books.json")}
                if want in fresh:
                    return fresh[want]
            b = next(r["book"] for r in wanted if r["book"]["title"] == title)
            authors = [a.strip() for a in re.split(r"[,、;；／/]", b.get("author") or "") if a.strip()] or ["不明"]
            return {"isbn13": want, "title": title, "authors": authors, **({"publisher": b["publisher"]} if b.get("publisher") else {})}
        if title in page_isbn:
            i = page_isbn[title]
            if i in have:
                return have[i]
            # 楽天にない本（絶版など）は、ページの書誌で登録する
            b = next(r["book"] for r in wanted if r["book"]["title"] == title)
            authors = [a.strip() for a in re.split(r"[,、;；／/]", b.get("author") or "") if a.strip()] or ["不明"]
            return {"isbn13": i, "title": title, "authors": authors, **({"publisher": b["publisher"]} if b.get("publisher") else {})}
        r = results.get(title)
        if not r:
            return None
        cs = candidates(title)
        if not cs:
            return None
        note = notes.get(title, "") + " " + (r["query"].get("publisher") or "")
        base = strip_title(title)
        if is_series(title):
            # シリーズは第1巻だけを採る。第1巻が候補になければ取り込まない
            v1 = [c for c in cs if VOL1.search(NFKC(c["title"]).strip()) and strip_title(VOL1.sub("", NFKC(c["title"]).strip())).startswith(base[: max(2, len(base) - 1)])]
            return v1[0] if v1 else None
        if r["status"] == "found":
            return r.get("book")
        year = re.search(r"(19|20)\d\d", notes.get(title, ""))
        if year:
            hit = [c for c in cs if (c.get("publishedAt") or "").startswith(year.group(0))]
            if len(hit) == 1:
                return hit[0]
        pub = NFKC(r["query"].get("publisher"))[:2]
        pool = [c for c in cs if pub and pub in NFKC(c.get("publisher"))] or cs
        same = [c for c in pool if strip_title(c["title"]) == base]
        if same:
            if "文庫" in note or "新書" in note:
                return sorted(same, key=lambda c: c.get("publishedAt") or "")[-1]
            return same[0]
        vol = [c for c in pool if VOL1.search(NFKC(c["title"]).strip()) and strip_title(VOL1.sub("", NFKC(c["title"]).strip())).startswith(base[: max(2, len(base) - 1)])]
        if vol:
            return sorted(vol, key=lambda c: c.get("publishedAt") or "")[-1] if "文庫" in note else vol[0]
        return None

    def candidates(title):
        r = results.get(title) or {}
        # 英語学習者向けの版などを避ける
        return [c for c in [r.get("book")] + r.get("alternatives", []) if c and "IBC" not in (c.get("publisher") or "")]

    # ---- 人物: 連番の ID を振る（同じ名前の人がいれば、その人に足す）
    by_name = {nospace(p["name"]): p for p in people}
    next_no = max((int(p["id"][1:]) for p in people), default=0) + 1
    idmap, new_people = {}, []
    for p in research.get("people", []):
        name = nospace(p.get("name"))
        if not name:
            continue
        if name in by_name:
            existing = by_name[name]
            idmap[p["id"]] = existing["id"]
            if p.get("kana") and not existing.get("kana"):
                existing["kana"] = p["kana"]
            continue
        np = {"id": f"p{next_no:04d}", "name": name}
        next_no += 1
        for k in ("kana", "title", "tags", "affiliation", "noPage", "kind", "sameAs"):
            if p.get(k) not in (None, "", []):
                np[k] = p[k]
        np.setdefault("title", "")
        np.setdefault("tags", [])
        np = {k: np[k] for k in ("id", "name", "kana", "title", "tags", "affiliation", "noPage", "kind", "sameAs") if k in np}
        idmap[p["id"]] = np["id"]
        by_name[name] = np
        new_people.append(np)

    # ---- 出典: 同じ URL がすでにあれば、その ID を使う
    by_url = {s["url"].rstrip("/"): s["id"] for s in sources}
    source_ids = {s["id"] for s in sources}
    src_in = {s["id"]: s for s in research.get("sources", [])}
    src_map = {}
    for sid, s in src_in.items():
        url = (s.get("url") or "").rstrip("/")
        if url in by_url:
            src_map[sid] = by_url[url]
        else:
            new_id = sid
            while new_id in source_ids:
                new_id += "-b"
            src_map[sid] = new_id

    # ---- 推薦を足す
    keys = {(r["personId"], r["isbn13"], r["sourceId"]) for r in recs}
    added, skipped, used_sources, used_people, used_titles = [], [], set(), set(), {}
    for r in wanted:
        title = r["book"]["title"]
        pid, sid = idmap.get(r["personId"]), src_map.get(r["sourceId"])
        if not pid or not sid:
            skipped.append(title + "（人物か出典が見つからない）")
            continue
        book = choose(title)
        if not book:
            skipped.append(title)
            continue
        book = dict(book)
        if is_series(title) or VOL1_NUM.search(book["title"]):
            stripped = VOL1_NUM.sub("", book["title"]).strip()
            if len(stripped) >= 2 and not re.search(r"(BOOK|Vol\.?|第|No\.?)$", stripped, re.I):
                book["title"] = stripped  # 書名に巻数を出さない
        if " = " in book["title"]:
            book["title"] = book["title"].split(" = ")[0]
        if book.get("publishedAt") and not re.match(r"^\d{4}-\d{2}(-\d{2})?$", book["publishedAt"]):
            book.pop("publishedAt")
        if not book.get("authors"):
            book["authors"] = ["不明"]
        if book["isbn13"] not in have:
            books.append(book)
            have[book["isbn13"]] = book
        key = (pid, book["isbn13"], sid)
        used_titles.setdefault(pid, []).append((title, have[book["isbn13"]]["title"]))
        if key in keys:
            continue
        keys.add(key)
        rec = {"personId": pid, "isbn13": book["isbn13"], "sourceId": sid}
        if r.get("timestamp"):
            rec["timestamp"] = r["timestamp"]
        if r.get("note"):
            rec["note"] = "".join(list(r["note"])[:40])
        if r.get("context") in ("座右の書", "人生を変えた一冊", "社員に薦めたい", "最近読んだ", "その他"):
            rec["context"] = r["context"]
        rec["verified"] = True
        recs.append(rec)
        added.append(rec)
        used_sources.add(r["sourceId"])
        used_people.add(pid)

    people += [p for p in new_people if p["id"] in used_people]
    for sid in used_sources:
        if src_map[sid] not in source_ids:
            s = {k: v for k, v in src_in[sid].items() if v}
            s["id"] = src_map[sid]
            sources.append(s)
            source_ids.add(s["id"])
    used_isbn = {r["isbn13"] for r in recs}
    books = [b for b in books if b["isbn13"] in used_isbn]

    # ---- 突き合わせ: 当てた本の書名が、出典の書名と食い違っていないか
    suspects = []
    for pid, pairs in used_titles.items():
        for asked, got in pairs:
            a, b = strip_title(asked), strip_title(VOL1.sub("", NFKC(got)))
            if not (a[:3] == b[:3] or a in b or b in a):
                suspects.append({"person": next(p["name"] for p in people + new_people if p["id"] == pid), "source": asked, "matched": got})

    summary = {
        "added": len(added),
        "newPeople": len([p for p in new_people if p["id"] in used_people]),
        "skipped": skipped,
        "droppedNoAuthor": dropped,
        "suspects": suspects,
        "totals": {"people": len(people), "books": len(books), "sources": len(sources), "recommendations": len(recs)},
        "dryRun": dry,
    }
    if dry:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    dump(DATA / "people.json", people)
    dump(DATA / "books.json", books)
    dump(DATA / "sources.json", sources)
    dump(DATA / "recommendations.json", recs)

    # ---- 台帳: 採用した出典と、調査役が報告した URL を記録する
    ledger = load(LEDGER)
    by_ledger_url = {e["url"].rstrip("/"): e for e in ledger}
    for sid in used_sources:
        s = src_in[sid]
        url = s["url"].rstrip("/")
        entry = by_ledger_url.get(url)
        if not entry:
            entry = {"url": s["url"]}
            ledger.append(entry)
            by_ledger_url[url] = entry
        entry.update(result="adopted", reason=f"sources.json の {src_map[sid]}", checkedAt=TODAY)
    for c in research.get("checkedUrls", []):
        url = (c.get("url") or "").rstrip("/")
        if not url or url in by_ledger_url:
            continue
        entry = {k: v for k, v in c.items() if v}
        entry["checkedAt"] = TODAY
        ledger.append(entry)
        by_ledger_url[url] = entry
    dump(LEDGER, ledger)

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
