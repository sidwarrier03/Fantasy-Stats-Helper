#!/usr/bin/env python3
"""Huddle: a self-updating fantasy football stats database with dynasty and redraft tools.

  python3 huddle.py              start the app at http://localhost:8765 (keeps itself updated)
  python3 huddle.py update       run one data sync and exit (for cron / Task Scheduler)
  python3 huddle.py update --full    re-download everything

Options: --port N, --host H, --every HOURS (auto-update interval), --history N (past seasons), --no-browser
"""
import argparse
import sys
import threading
import webbrowser

if sys.version_info < (3, 9):
    sys.exit("Huddle needs Python 3.9 or newer.")

from core import db
from core.server import App, serve
from core.updater import Scheduler, Updater


def main():
    ap = argparse.ArgumentParser(description="Huddle fantasy football database")
    ap.add_argument("command", nargs="?", default="serve", choices=["serve", "update"])
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--every", type=float, default=2.0, help="hours between automatic updates (default 2)")
    ap.add_argument("--history", type=int, default=2, help="past seasons of stats to keep (default 2)")
    ap.add_argument("--db", default=db.DEFAULT_DB, help="database file path")
    ap.add_argument("--full", action="store_true", help="ignore refresh timers and re-download")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    updater = Updater(args.db, history=args.history)
    if args.command == "update":
        updater.run(force=args.full)
        err = updater.status.get("last_error")
        print("Done." if not err else f"Done with errors: {err}")
        sys.exit(1 if err else 0)

    db.connect(args.db).close()  # create the schema before the first request
    scheduler = Scheduler(updater, args.every)
    scheduler.force_next = args.full
    scheduler.start()
    httpd = serve(App(args.db, updater, scheduler), args.host, args.port)
    url = f"http://{'localhost' if args.host in ('127.0.0.1', '0.0.0.0') else args.host}:{args.port}"
    print(f"Huddle is running at {url}  (auto-updates every {args.every:g}h, Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
