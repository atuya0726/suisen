#!/usr/bin/env python3
"""人物名ごとに「名前＋愛読書／おすすめ本／好きな本」の検索需要があるかを、Google のサジェストで調べる。

検索回数は分からない。分かるのは「候補に出るかどうか」だけ（出れば一定の検索がある）。
収集の優先順位を決めるための足切りに使う。ビルドでは使わない。

使い方:
  python3 scripts/check-demand.py people                 # data/people.json の全員（noPage と組織は除く）
  python3 scripts/check-demand.py names 候補.tsv          # 1行に「名前<TAB>区分」。まだ載せていない人の候補
  python3 scripts/check-demand.py report                 # たまった結果を集計して表示

結果は data/research/demand.json に名前をキーにしてためる（調べ済みの名前は飛ばす。やり直すなら --refresh）。

注意:
- 非公式の URL なので、1秒以上空けて呼ぶ。
- 作家の「おすすめ」は本人の著作を探す検索のことが多い。作家は 愛読書・好きな本 のほうを見る。
- 同姓同名の別人の需要が混ざることがある。
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "research" / "demand.json"
ENDPOINT = "https://suggestqueries.google.com/complete/search"
INTERVAL = 1.1


def suggest(query: str) -> list[str]:
    url = ENDPOINT + "?" + urllib.parse.urlencode({"client": "firefox", "hl": "ja", "gl": "jp", "q": query})
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                raw = res.read()
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                text = raw.decode("shift_jis", errors="replace")
            time.sleep(INTERVAL)
            return list(json.loads(text)[1])
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                raise
            print(f"  再試行（{e}）", file=sys.stderr)
            time.sleep(30 * (attempt + 1))
    return []


def has(suggestions: list[str], *words: str) -> list[str]:
    return [s for s in suggestions if any(w in s.replace(" ", "").replace("　", "") for w in words)]


def check(name: str) -> dict:
    base = suggest(name + " ")
    result: dict = {"known": len(base), "checked": date.today().isoformat()}
    # 名前だけで候補が1つも出ない人は、名前で検索されていない。これ以上は調べない
    if not base:
        result.update({"aidoku": [], "osusume": [], "suki": [], "score": 0})
        return result
    aidoku = has(suggest(name + " 愛読"), "愛読書")
    osusume = has(suggest(name + " おすすめ") + has(base, "本おすすめ"), "おすすめ本", "本おすすめ", "おすすめの本", "推薦図書", "おすすめ小説", "おすすめ漫画")
    suki = has(suggest(name + " 好きな"), "好きな本", "好きな小説", "好きな作家", "好きな漫画")
    result.update(
        {
            "aidoku": aidoku,
            "osusume": sorted(set(osusume)),
            "suki": suki,
            # 種類の数（0〜3）。候補の語が多いほど需要が厚いと見て、同点のときの並びに語数を使う
            "score": sum(1 for x in (aidoku, osusume, suki) if x),
        }
    )
    return result


def load() -> dict:
    return json.loads(OUT.read_text()) if OUT.exists() else {}


def save(data: dict) -> None:
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")


def run(targets: list[tuple[str, dict]], refresh: bool) -> None:
    data = load()
    todo = [(n, meta) for n, meta in targets if refresh or n not in data]
    print(f"対象 {len(targets)}人、うち未調査 {len(todo)}人", flush=True)
    for i, (name, meta) in enumerate(todo, 1):
        entry = check(name)
        entry.update(meta)
        data[name] = entry
        if entry["score"]:
            print(f"[{i}/{len(todo)}] {name}: {entry['score']} {entry['aidoku'][:1]} {entry['osusume'][:1]} {entry['suki'][:1]}", flush=True)
        if i % 20 == 0:
            save(data)
    save(data)
    print("完了", flush=True)


def report() -> None:
    data = load()
    rows = sorted(data.items(), key=lambda kv: (-kv[1]["score"], -len(kv[1]["aidoku"]) - len(kv[1]["osusume"]) - len(kv[1]["suki"]), kv[0]))
    for listed in (True, False):
        group = [(n, e) for n, e in rows if bool(e.get("id")) == listed]
        if not group:
            continue
        print(f"\n== {'掲載済み' if listed else '未掲載の候補'}: {len(group)}人 ==")
        print("需要の種類の数:", dict(sorted(Counter(e["score"] for _, e in group).items())))
        print("名前で候補が出ない:", sum(1 for _, e in group if e["known"] == 0))
        by_tag: dict[str, list[int]] = {}
        for _, e in group:
            for t in e.get("tags") or [e.get("category", "?")]:
                by_tag.setdefault(t, []).append(1 if e["score"] else 0)
        for t, v in sorted(by_tag.items(), key=lambda kv: -len(kv[1])):
            print(f"  {t}: {sum(v)}/{len(v)}人に需要あり")
        for n, e in group:
            if e["score"] == 0:
                break
            kinds = "・".join(k for k, key in (("愛読書", "aidoku"), ("おすすめ本", "osusume"), ("好きな本", "suki")) if e[key])
            label = e.get("id") or e.get("category", "")
            extra = f" 本{e['books']}冊" if "books" in e else ""
            print(f"  {e['score']} {n}（{label}）{kinds}{extra}")


def main() -> None:
    global OUT
    # --out=パス で結果の書き込み先を変える（2つを同時に走らせるとき、同じファイルを上書きし合わないように）
    for a in sys.argv[1:]:
        if a.startswith("--out="):
            OUT = Path(a.removeprefix("--out="))
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    refresh = "--refresh" in sys.argv
    if not args:
        sys.exit(__doc__)
    if args[0] == "people":
        people = json.loads((ROOT / "data" / "people.json").read_text())
        recs = json.loads((ROOT / "data" / "recommendations.json").read_text())
        books: dict[str, set] = {}
        for r in recs:
            if r.get("verified"):
                books.setdefault(r["personId"], set()).add(r["isbn13"])
        targets = [
            (p["name"], {"id": p["id"], "tags": p["tags"], "books": len(books.get(p["id"], ()))})
            for p in people
            if not p.get("noPage") and p.get("kind") != "organization"
        ]
        run(targets, refresh)
    elif args[0] == "names":
        known = {p["name"].replace(" ", "").replace("　", "") for p in json.loads((ROOT / "data" / "people.json").read_text())}
        targets = []
        for line in Path(args[1]).read_text().splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            name, _, category = line.partition("\t")
            if name.strip().replace(" ", "").replace("　", "") in known:
                continue
            targets.append((name.strip(), {"category": category.strip()}))
        run(targets, refresh)
    elif args[0] == "report":
        report()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
