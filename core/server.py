"""HTTP server: JSON API under /api/*, static UI from web/."""
import gzip
import json
import mimetypes
import os
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import db, queries as q

WEB = os.path.join(db.ROOT, "web")


class App:
    def __init__(self, db_path, updater, scheduler):
        self.db_path = db_path
        self.updater = updater
        self.scheduler = scheduler
        self.local = threading.local()
        self.httpd = None  # set once the server is created, so the app can shut itself down

    def conn(self):
        c = getattr(self.local, "conn", None)
        if c is None:
            c = self.local.conn = db.connect(self.db_path)
        return c

    def route(self, method, path, params, body):
        conn = self.conn()
        g = lambda k, d=None: params.get(k, [d])[0]
        scoring = g("scoring", "ppr")
        fmt = g("fmt", "dynasty")
        qb = g("qb", "1")

        if path == "/api/status":
            return q.status(conn, self.updater.status)
        if path == "/api/update" and method == "POST":
            self.scheduler.trigger(force=(body or {}).get("force", False))
            return {"ok": True}
        if path == "/api/quit" and method == "POST":
            if self.httpd:  # shut down after this response has been sent
                threading.Timer(0.3, self.httpd.shutdown).start()
            return {"ok": True}
        if path == "/api/dashboard":
            return q.dashboard(conn, scoring, fmt, qb)
        if path == "/api/index":
            return q.player_index(conn)
        if path == "/api/stats":
            wi = q.week_info(conn)
            return q.stats_table(conn, int(g("season", wi["stats_season"])), scoring, qb)
        if path == "/api/player":
            res = q.player_detail(conn, g("id", ""), scoring, qb)
            if res is None:
                raise LookupError("Player not found")
            return res
        if path == "/api/rankings":
            return q.rankings(conn, fmt, qb, scoring)
        if path == "/api/sos":
            return q.sos(conn, scoring)
        if path == "/api/teams":
            return q.team_tiers(conn, g("season"), g("last"))
        if path == "/api/startsit":
            ids = [i for i in (g("ids", "") or "").split(",") if i]
            return q.start_sit(conn, ids, scoring, g("week"))
        if path == "/api/startsit/team":
            res = q.team_lineup(conn, g("league", ""), g("owner"), g("username"), g("roster"), g("week"))
            if res is None:
                raise LookupError("Couldn't load that league from Sleeper")
            return res
        if path == "/api/waivers":
            return q.waivers(conn, scoring, fmt, qb, g("league"))
        if path == "/api/sleeper/leagues":
            res = q.user_leagues(conn, g("username", ""))
            if res is None:
                raise LookupError("No Sleeper user with that username")
            return res
        if path == "/api/league":
            res = q.league_detail(conn, g("id", ""), g("fmt"), g("scoring"))
            if res is None:
                raise LookupError("League not found")
            return res
        if path == "/api/portfolio":
            res = q.portfolio(conn, g("username", ""))
            if res is None:
                raise LookupError("No Sleeper user with that username")
            return res
        if path == "/api/schema":
            return q.schema(conn)
        if path == "/api/sql" and method == "POST":
            return q.run_sql(self.db_path, (body or {}).get("query", ""))
        raise FileNotFoundError(path)


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Huddle/1.0"

        def log_message(self, fmt, *args):  # quiet access log
            pass

        def _send(self, code, payload, ctype="application/json; charset=utf-8", cache=False):
            data = payload if isinstance(payload, bytes) else json.dumps(payload, separators=(",", ":")).encode()
            gz = "gzip" in (self.headers.get("Accept-Encoding") or "") and len(data) > 1400
            if gz:
                data = gzip.compress(data, 5)
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "max-age=300" if cache else "no-store")
            if gz:
                self.send_header("Content-Encoding", "gzip")
            self.end_headers()
            self.wfile.write(data)

        def _handle(self, method):
            url = urllib.parse.urlparse(self.path)
            if url.path.startswith("/api/"):
                body = None
                if method == "POST":
                    n = int(self.headers.get("Content-Length") or 0)
                    body = json.loads(self.rfile.read(n) or b"{}") if n else {}
                try:
                    res = app.route(method, url.path, urllib.parse.parse_qs(url.query), body)
                    self._send(200, res)
                except FileNotFoundError:
                    self._send(404, {"error": "Unknown endpoint"})
                except LookupError as e:
                    self._send(404, {"error": str(e)})
                except ValueError as e:
                    self._send(400, {"error": str(e)})
                except Exception as e:
                    traceback.print_exc()
                    self._send(500, {"error": f"{type(e).__name__}: {e}"})
                return
            self._static(url.path)

        def _static(self, path):
            rel = "index.html" if path in ("", "/") else path.lstrip("/")
            full = os.path.normpath(os.path.join(WEB, rel))
            if not full.startswith(WEB) or not os.path.isfile(full):
                full = os.path.join(WEB, "index.html")
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype.endswith("javascript"):
                ctype += "; charset=utf-8"
            with open(full, "rb") as f:
                self._send(200, f.read(), ctype)

        def do_GET(self):
            self._handle("GET")

        def do_POST(self):
            self._handle("POST")

    return Handler


def serve(app, host, port):
    httpd = ThreadingHTTPServer((host, port), make_handler(app))
    httpd.daemon_threads = True
    return httpd
