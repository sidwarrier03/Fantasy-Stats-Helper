#!/usr/bin/env python3
"""Huddle: a self-updating fantasy football stats database with dynasty and redraft tools.

  python3 huddle.py              start the app at http://localhost:8765 (keeps itself updated)
  python3 huddle.py update       run one data sync and exit (for cron / Task Scheduler)
  python3 huddle.py update --full    re-download everything

Options: --port N, --host H, --every HOURS (auto-update interval), --history N (past seasons), --no-browser
Windows launcher options: --background (no console; log to data/huddle.log), --shortcut (add a desktop icon once)
"""
import argparse
import json
import os
import subprocess
import sys
import threading
import traceback
import urllib.request
import webbrowser

if sys.version_info < (3, 9):
    sys.exit("Huddle needs Python 3.9 or newer.")

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
sys.path.insert(0, ROOT)

from core import db  # noqa: E402
from core.server import App, serve  # noqa: E402
from core.updater import Scheduler, Updater  # noqa: E402


def already_running(port):
    """True if a Huddle server is already answering on this port."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f"http://127.0.0.1:{port}/api/status", timeout=1.5) as r:
            return "week" in json.loads(r.read() or b"{}")
    except Exception:
        return False


def show_error(msg, background):
    """Print the error, and on Windows background launches also show a message box."""
    print(msg, file=sys.stderr)
    if background and os.name == "nt":
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, msg, "Huddle", 0x10)
        except Exception:
            pass


def ensure_windows_shortcut():
    """Create (or repair) the Huddle icon on the Windows desktop. Runs when started from Start Huddle.bat."""
    if os.name != "nt":
        return
    bat = os.path.join(ROOT, "Start Huddle.bat")
    # Files extracted from a downloaded ZIP are tagged "from the internet", which makes Windows show a
    # security prompt on every launch. Remove the tag from our own launcher (same as right-click > Unblock).
    try:
        os.remove(bat + ":Zone.Identifier")
    except OSError:
        pass
    # The icon starts Huddle with the window-less Python directly, so no console window flashes up.
    exe = sys.executable
    pyw = os.path.join(os.path.dirname(exe), "pythonw.exe")
    if os.path.exists(pyw):
        target, arguments = pyw, f'"{os.path.join(ROOT, "huddle.py")}" --background'
    else:
        target, arguments = bat, ""
    env = dict(os.environ, HUDDLE_TARGET=target, HUDDLE_ARGS=arguments, HUDDLE_DIR=ROOT,
               HUDDLE_ICON=os.path.join(ROOT, "web", "huddle.ico"))
    script = (
        "$l = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Huddle.lnk';"
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($l);"
        "$s.TargetPath = $env:HUDDLE_TARGET; $s.Arguments = $env:HUDDLE_ARGS;"
        "$s.WorkingDirectory = $env:HUDDLE_DIR; $s.IconLocation = $env:HUDDLE_ICON;"
        "$s.Description = 'Open Huddle fantasy football'; $s.Save()"
    )
    try:
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
                       env=env, timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=True)
        print("Desktop icon is ready.")
    except Exception as e:
        print(f"Couldn't create the desktop icon: {e}")


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
    ap.add_argument("--background", action="store_true", help="run without a console; log to data/huddle.log")
    ap.add_argument("--shortcut", action="store_true", help="on Windows, add a desktop icon the first time")
    args = ap.parse_args()

    if args.background:
        os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
        log = open(os.path.join(ROOT, "data", "huddle.log"), "a", buffering=1, encoding="utf-8")
        sys.stdout = sys.stderr = log

    updater = Updater(args.db, history=args.history)
    if args.command == "update":
        updater.run(force=args.full)
        err = updater.status.get("last_error")
        print("Done." if not err else f"Done with errors: {err}")
        sys.exit(1 if err else 0)

    url = f"http://{'localhost' if args.host in ('127.0.0.1', '0.0.0.0') else args.host}:{args.port}"
    if args.shortcut:
        threading.Thread(target=ensure_windows_shortcut).start()  # not daemon: finish even if we exit early

    # Opening Huddle twice just brings up the browser on the copy that's already running.
    if already_running(args.port):
        print(f"Huddle is already running at {url}")
        if not args.no_browser:
            webbrowser.open(url)
        return

    try:
        db.connect(args.db).close()  # create the schema before the first request
        app = App(args.db, updater, None)
        httpd = serve(app, args.host, args.port)
    except OSError as e:
        show_error(f"Huddle couldn't start: port {args.port} is being used by another program.\n\n"
                   f"Close that program, or start Huddle with a different port, e.g. --port 8800.\n\n({e})",
                   args.background)
        sys.exit(1)
    except Exception:
        show_error("Huddle couldn't start:\n\n" + traceback.format_exc(limit=3), args.background)
        sys.exit(1)

    scheduler = Scheduler(updater, args.every)
    scheduler.force_next = args.full
    app.scheduler = scheduler
    app.httpd = httpd
    scheduler.start()
    print(f"Huddle is running at {url}  (auto-updates every {args.every:g}h)")
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    print("Huddle stopped.")


if __name__ == "__main__":
    main()
