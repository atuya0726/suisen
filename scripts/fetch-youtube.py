#!/usr/bin/env python3
"""YouTube の動画のタイトル・公開日・概要欄を取り、概要欄にある本（Amazon のリンクなど）を抜き出す。

  python3 scripts/fetch-youtube.py find "チャンネル名"              チャンネルを探す（ID を調べる。1回 100 単位）
  python3 scripts/fetch-youtube.py channel <チャンネルID か @ハンドル> [--max 200] [--query 語]
                                                                    そのチャンネルの動画を新しい順に取る
  python3 scripts/fetch-youtube.py videos <動画ID>...               動画を指定して取る
  共通: --out ファイル（省略時は標準出力）、--books-only（本が見つかった動画だけ出す）

出力は動画ごとの JSON:
  { "videoId", "url", "title", "publishedAt"(YYYY-MM-DD), "channelId", "channelTitle",
    "isbns": ["978…"],            概要欄の Amazon リンクから取れた ISBN（紙の本のリンクだけ。Kindle 版は取れない）
    "bookLines": ["…"],           『書名』や「著：」を含む行（ISBN が取れなかった本の手がかり）
    "description": "概要欄の全文" }

YouTube Data API v3 を使う（公開情報の読み取りだけ）。キーは環境変数 YOUTUBE_API_KEY か、
macOS キーチェーンの YOUTUBE_API_KEY から、このスクリプトが実行時に読む（表示しない）。
利用枠は 1日 10,000 単位。動画の取得は 50件で 1 単位、チャンネルの検索（find）は 1回 100 単位。

この出力は「概要欄に本が載っている」ことしか示さない。その人がその本を薦めているかどうかは、
動画のタイトルと概要欄の文脈を読んで判断する（自著の宣伝、スポンサーの本、参考文献の列挙は推薦ではない）。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://www.googleapis.com/youtube/v3/"


def api_key():
    key = (os.environ.get("YOUTUBE_API_KEY") or "").strip()
    if key:
        return key
    if sys.platform == "darwin":
        try:
            r = subprocess.run(
                ["/usr/bin/security", "find-generic-password", "-s", "YOUTUBE_API_KEY", "-w"],
                capture_output=True, text=True, timeout=20,
            )
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip()
        except Exception:
            pass
    sys.exit("YOUTUBE_API_KEY が見つかりません（環境変数か macOS キーチェーンに登録する）。")


KEY = None


def call(path, **params):
    global KEY
    KEY = KEY or api_key()
    url = API + path + "?" + urllib.parse.urlencode({**params, "key": KEY})
    try:
        with urllib.request.urlopen(url, timeout=30) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "ignore").replace(KEY, "***")
        try:
            msg = json.loads(body)["error"]["message"]
        except Exception:
            msg = body[:200]
        sys.exit(f"YouTube API エラー（HTTP {e.code}）: {msg}")


def isbn10_to_13(isbn10):
    body = "978" + isbn10[:9]
    check = (10 - sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(body)) % 10) % 10
    return body + str(check)


def valid13(d):
    return len(d) == 13 and d.isdigit() and sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(d)) % 10 == 0


def books_in(description):
    """概要欄から、紙の本の ISBN（国内の本だけ）と、本らしい行を抜き出す。"""
    isbns = []
    # Amazon の商品リンク。ASIN が数字10桁（末尾 X も可）なら ISBN-10。Kindle 版（B0…）は ISBN ではない
    for asin in re.findall(r"amazon\.co\.jp/(?:[^\s/]+/)?(?:dp|gp/product|exec/obidos/ASIN)/([0-9]{9}[0-9Xx])", description):
        i13 = isbn10_to_13(asin.upper())
        if i13.startswith("9784") and i13 not in isbns:
            isbns.append(i13)
    # ISBN がそのまま書かれている場合
    for raw in re.findall(r"(?:ISBN[-: ]*)?(97[89][- ]?4[- ]?[0-9][0-9- ]{8,12}[0-9])", description):
        d = re.sub(r"[^0-9]", "", raw)
        if valid13(d) and d not in isbns:
            isbns.append(d)
    lines = []
    for line in description.splitlines():
        s = line.strip()
        if not s or len(s) > 200:
            continue
        if re.search(r"『[^』]{2,}』", s) or re.search(r"(著|著者|作|訳)[:：]", s) or "amzn.to" in s or "amazon.co.jp" in s:
            lines.append(s)
    return isbns, lines


def shape(item):
    sn = item["snippet"]
    vid = item["id"] if isinstance(item["id"], str) else item["id"].get("videoId")
    desc = sn.get("description", "")
    isbns, lines = books_in(desc)
    return {
        "videoId": vid,
        "url": f"https://www.youtube.com/watch?v={vid}",
        "title": sn.get("title", ""),
        "publishedAt": sn.get("publishedAt", "")[:10],
        "channelId": sn.get("channelId", ""),
        "channelTitle": sn.get("channelTitle", ""),
        "isbns": isbns,
        "bookLines": lines,
        "description": desc,
    }


def get_videos(ids):
    out = []
    for i in range(0, len(ids), 50):
        data = call("videos", part="snippet", id=",".join(ids[i : i + 50]), maxResults=50)
        out += [shape(it) for it in data.get("items", [])]
    return out


def channel_id(ref):
    ref = ref.strip()
    m = re.search(r"youtube\.com/(channel/(UC[\w-]{22})|(@[^/?\s]+))", ref)
    if m:
        ref = m.group(2) or m.group(3)
    if re.fullmatch(r"UC[\w-]{22}", ref):
        return ref
    handle = ref if ref.startswith("@") else "@" + ref
    data = call("channels", part="id", forHandle=handle)
    if not data.get("items"):
        sys.exit(f"チャンネルが見つかりません: {ref}（find で探して、UC… の ID を使う）")
    return data["items"][0]["id"]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("mode", choices=["find", "channel", "videos"])
    p.add_argument("args", nargs="+")
    p.add_argument("--max", type=int, default=200, help="channel: 取る動画の数（新しい順）")
    p.add_argument("--query", help="channel: タイトルか概要欄にこの語を含む動画だけ出す")
    p.add_argument("--books-only", action="store_true", help="本（ISBN か本らしい行）が見つかった動画だけ出す")
    p.add_argument("--out")
    a = p.parse_args()

    if a.mode == "find":
        data = call("search", part="snippet", type="channel", q=" ".join(a.args), maxResults=5)
        result = [
            {"channelId": it["id"]["channelId"], "title": it["snippet"]["title"], "description": it["snippet"]["description"][:120]}
            for it in data.get("items", [])
        ]
    elif a.mode == "videos":
        result = get_videos(a.args)
    else:
        cid = channel_id(a.args[0])
        ch = call("channels", part="contentDetails,snippet,statistics", id=cid)["items"][0]
        uploads = ch["contentDetails"]["relatedPlaylists"]["uploads"]
        ids, token = [], None
        while len(ids) < a.max:
            page = call("playlistItems", part="contentDetails", playlistId=uploads, maxResults=50, **({"pageToken": token} if token else {}))
            ids += [it["contentDetails"]["videoId"] for it in page.get("items", [])]
            token = page.get("nextPageToken")
            if not token:
                break
        result = get_videos(ids[: a.max])
        print(f"# {ch['snippet']['title']}（{cid}）動画 {ch['statistics'].get('videoCount', '?')} 本のうち {len(result)} 本を取得", file=sys.stderr)
        if a.query:
            result = [v for v in result if a.query in v["title"] or a.query in v["description"]]

    if a.mode != "find" and a.books_only:
        result = [v for v in result if v["isbns"] or v["bookLines"]]
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"# {len(result)} 件を {a.out} に書きました", file=sys.stderr)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
