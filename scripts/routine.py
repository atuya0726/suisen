#!/usr/bin/env python3
"""suisen の定期実行を、Claude Code の非対話モードで行う。

launchd（~/Library/LaunchAgents/page.suisen.routine.plist）から1時間ごとに呼ばれ、
実行すべきものがあれば1つだけ実行する。失敗したら Discord に知らせる。

  collect  毎日 6時以降に1回。推薦データを足して本番に出す（.claude/skills/collect/SKILL.md）
  review   毎週月曜 7時以降に1回。数字を読んで収集の方向性を見直す（.claude/skills/weekly-review/SKILL.md）

Mac が止まっていて時刻を逃したときは、次に呼ばれた時点で実行する
（collect はその日のうち、review は前回の成功から8日以上あいた時点）。

  routine.py                    実行すべきものがあれば実行する（launchd 用）
  routine.py collect --force    今日すでに実行済みでも実行する
  routine.py review --force
  routine.py collect --dry-run  調べる対象を選ぶところまでで止め、何も変更しない
  routine.py review --dry-run   数字を取るところまでで止め、何も変更しない
"""
import argparse
import datetime as dt
import fcntl
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOGS = Path.home() / "Library/Logs/suisen-routine"
NOTIFY = Path.home() / ".claude/bin/discord-notify"
MAX_ATTEMPTS = 2  # 1日に試す回数の上限

TASKS = {
    "collect": {
        "label": "収集",
        "start_hour": 6,
        "timeout": 120 * 60,
        "prompt": (
            "スケジュール実行です。collect スキル（.claude/skills/collect/SKILL.md）に従い、"
            "今日の収集を無人で1周実行してください。途中で質問はできません。"
        ),
        "dry_prompt": (
            "試運転です。collect スキル（.claude/skills/collect/SKILL.md）の手順1〜2だけを行ってください。"
            "調べる対象を選ぶところまでで止め、調査役の起動、ファイルの変更、git の操作、デプロイ、Discord への送信はしないでください。"
            "選んだ対象とその理由、途中で拒否された操作があればその内容を報告してください。"
        ),
    },
    "review": {
        "label": "週次の振り返り",
        "start_hour": 7,
        "timeout": 60 * 60,
        "prompt": (
            "スケジュール実行です。weekly-review スキル（.claude/skills/weekly-review/SKILL.md）に従い、"
            "今週の振り返りを無人で1周実行してください。途中で質問はできません。"
        ),
        "dry_prompt": (
            "試運転です。weekly-review スキル（.claude/skills/weekly-review/SKILL.md）の手順1〜2だけを行ってください。"
            "数字を取るところまでで止め、ファイルの変更、git の操作、Discord への送信はしないでください。"
            "取得できた数字と、途中で拒否された操作があればその内容を報告してください。"
        ),
    },
}


def due(task, state, now):
    """予定どおりの実行として、いま走らせるべきか。"""
    cfg = TASKS[task]
    today = now.date().isoformat()
    if now.hour < cfg["start_hour"]:
        return False
    if state.get("date") == today and (state.get("status") == "ok" or state.get("attempts", 0) >= MAX_ATTEMPTS):
        return False
    last_ok = state.get("lastOk")
    if task == "collect":
        return last_ok != today
    # review: 月曜、または前回の成功から8日以上あいたとき（初回は月曜を待つ）
    if last_ok == today:
        return False
    overdue = last_ok is not None and (now.date() - dt.date.fromisoformat(last_ok)).days >= 8
    return now.weekday() == 0 or overdue


def notify(title, body):
    try:
        subprocess.run([str(NOTIFY), "-t", title, body], timeout=30, cwd=ROOT)
    except Exception as e:  # 通知の失敗で本体を落とさない
        print(f"notify failed: {e}", file=sys.stderr)


def run(task, dry_run, now):
    cfg = TASKS[task]
    today = now.date().isoformat()
    state_path = LOGS / f"{task}.state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    attempts = state.get("attempts", 0) + 1 if state.get("date") == today else 1
    if not dry_run:
        state_path.write_text(json.dumps({**state, "date": today, "status": "running", "attempts": attempts}))

    cmd = ["claude", "-p", cfg["dry_prompt"] if dry_run else cfg["prompt"],
           "--permission-mode", "auto", "--permission-prompts", "none",
           "--output-format", "json"]
    if os.environ.get("SUISEN_ROUTINE_MODEL"):
        cmd += ["--model", os.environ["SUISEN_ROUTINE_MODEL"]]
    log = LOGS / f"{today}-{task}{'-dry' if dry_run else ''}-{now:%H%M}.json"

    status, detail = "ok", ""
    try:
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=cfg["timeout"])
        log.write_text(r.stdout + ("\n--- stderr ---\n" + r.stderr if r.stderr else ""))
        try:
            out = json.loads(r.stdout)
        except Exception:
            out = {}
        if r.returncode != 0 or out.get("is_error"):
            status, detail = "failed", f"終了コード {r.returncode}"
        if dry_run:
            print(out.get("result", r.stdout))
    except subprocess.TimeoutExpired:
        status, detail = "failed", f"{cfg['timeout'] // 60}分で打ち切り"
    except FileNotFoundError:
        status, detail = "failed", "claude コマンドが見つからない"

    if not dry_run:
        last_ok = today if status == "ok" else state.get("lastOk")
        state_path.write_text(json.dumps({"date": today, "status": status, "attempts": attempts, "lastOk": last_ok}))
        if status != "ok":
            retry = "1時間以内にもう一度試します。" if attempts < MAX_ATTEMPTS else "今日はもう再試行しません。"
            notify(f"suisen {cfg['label']} 失敗", f"無人実行が失敗しました（{detail}、{attempts}回目）。{retry}\nログ: {log}")
    return status == "ok"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("task", nargs="?", choices=sorted(TASKS))
    p.add_argument("--force", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    if (args.force or args.dry_run) and not args.task:
        p.error("--force と --dry-run は、collect か review を指定して使う")

    LOGS.mkdir(parents=True, exist_ok=True)
    lock = open(LOGS / "lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return  # 別の実行が走っている（次の呼び出しでやり直す）

    now = dt.datetime.now()
    if args.task and (args.force or args.dry_run):
        sys.exit(0 if run(args.task, args.dry_run, now) else 1)

    # 予定どおりの実行: 収集を先に、振り返りはその次の呼び出しで
    for task in ([args.task] if args.task else ["collect", "review"]):
        state_path = LOGS / f"{task}.state.json"
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        if due(task, state, now):
            sys.exit(0 if run(task, False, now) else 1)


if __name__ == "__main__":
    main()
