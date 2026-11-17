#!/usr/bin/env python3
"""「愛読書 さ」のように、検索語＋かな1〜2文字で Google のサジェストを引き、「〇〇 愛読書」と検索されている名前を拾う。

こちらが名前を思いつけない人（声優、K-POP、歴史上の人物、漫画家など）の需要を見つけるために使う。
拾えるのは候補に出た名前だけで、検索回数は分からない。ビルドでは使わない。

使い方:
  python3 scripts/discover-demand.py            # 調べて data/research/demand-discovered.json にためる（続きから再開できる）
  python3 scripts/discover-demand.py report     # 見つかった名前を、掲載済みかどうかを付けて表示

かな1文字で候補が上限（8件以上）まで出たら、2文字目を足して掘る。非公式の URL なので1秒以上空ける。
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "research" / "demand-discovered.json"
SEEDS = ["愛読書", "好きな本", "おすすめ本"]
KANA = list("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわがぎぐげござじずぜぞだでどばびぶべぼぱぴぷぺぽ")
STOP = {"有名人", "芸能人", "著名人", "ランキング", "意味", "英語", "漫画", "小説", "面接", "社長", "経営者", "東大生", "中学生", "高校生", "小学生", "大学生", "社会人", "女性", "男性"}


def suggest(query: str) -> list[str]:
    url = "https://suggestqueries.google.com/complete/search?" + urllib.parse.urlencode({"client": "firefox", "hl": "ja", "gl": "jp", "q": query})
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                raw = res.read()
            time.sleep(1.1)
            try:
                return list(json.loads(raw.decode("utf-8"))[1])
            except UnicodeDecodeError:
                return list(json.loads(raw.decode("shift_jis", errors="replace"))[1])
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                raise
            print(f"  再試行（{e}）", file=sys.stderr)
            time.sleep(30 * (attempt + 1))
    return []


def run() -> None:
    data = json.loads(OUT.read_text()) if OUT.exists() else {"queries": {}}
    done = data["queries"]
    n = 0
    for seed in SEEDS:
        for k1 in KANA:
            first = f"{seed} {k1}"
            if first not in done:
                done[first] = suggest(first)
                n += 1
            # 候補が上限近くまで出た文字だけ、2文字目を足して掘る
            if len(done[first]) >= 8:
                for k2 in KANA[:46] + ["ー", "ん"]:
                    q = f"{seed} {k1}{k2}"
                    if q not in done:
                        done[q] = suggest(q)
                        n += 1
                        if n % 25 == 0:
                            OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
            print(f"{first}: {len(done[first])}件", flush=True)
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    print("完了", flush=True)


def names(data: dict) -> dict[str, set[str]]:
    """候補の文字列から「名前」を取り出す。「名前 愛読書」「名前 愛読書 補足」の形だけを採る。"""
    found: dict[str, set[str]] = {}
    for suggestions in data["queries"].values():
        for s in suggestions:
            parts = s.replace("　", " ").split(" ")
            for seed in SEEDS:
                if seed in parts[1:]:
                    name = " ".join(parts[: parts.index(seed)])
                    if name and name not in STOP and not any(x in name for x in SEEDS):
                        found.setdefault(name, set()).add(seed)
    return found


def report() -> None:
    data = json.loads(OUT.read_text())
    people = json.loads((ROOT / "data" / "people.json").read_text())
    listed = {p["name"].replace(" ", "").replace("　", "") for p in people}
    found = names(data)
    new = {n: s for n, s in found.items() if n.replace(" ", "") not in listed}
    print(f"引いた検索語 {len(data['queries'])}、見つかった名前 {len(found)}、うち未掲載 {len(new)}")
    for seed in SEEDS:
        group = sorted(n for n, s in new.items() if seed in s)
        print(f"\n== {seed}（未掲載 {len(group)}）==\n" + "、".join(group))
    print("\n== 掲載済み ==\n" + "、".join(sorted(n for n in found if n.replace(" ", "") in listed)))


if __name__ == "__main__":
    report() if sys.argv[1:] == ["report"] else run()
