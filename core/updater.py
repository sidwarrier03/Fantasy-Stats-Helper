"""Keeps the local database in sync with Sleeper, FantasyCalc and nflverse (advanced metrics).

Every run is incremental: each source has its own refresh interval, and finished
weeks are only re-downloaded until their stat corrections have settled.
"""
import datetime as dt
import json
import threading
import time
import traceback

from . import advanced, db
from .net import get_json

SLEEPER = "https://api.sleeper.app"
FANTASY_POS = ["QB", "RB", "WR", "TE", "K", "DEF"]
POS_QUERY = "&".join(f"position%5B%5D={p}" for p in FANTASY_POS)
FC_URL = "https://api.fantasycalc.com/values/current?isDynasty={d}&numQbs={q}&numTeams=12&ppr=1"
VALUE_FORMATS = {
    "dynasty_1qb": ("true", 1),
    "dynasty_sf": ("true", 2),
    "redraft_1qb": ("false", 1),
    "redraft_sf": ("false", 2),
}
REG_SEASON_WEEKS = 18

HOUR = 3600
EVERY = {  # minimum seconds between refreshes of each source
    "state": 0,
    "schedule": 12 * HOUR,
    "players": 12 * HOUR,
    "values": 6 * HOUR,
    "trending": 1 * HOUR,
    "proj_near": 1 * HOUR,
    "proj_far": 24 * HOUR,
    "stats_live": 1 * HOUR,
}


def _age(birth):
    try:
        b = dt.date.fromisoformat(birth)
    except (TypeError, ValueError):
        return None
    return round((dt.date.today() - b).days / 365.25, 1)


def _num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class Updater:
    def __init__(self, db_path=db.DEFAULT_DB, history=2, log=print):
        self.db_path = db_path
        self.history = history  # number of past seasons to keep
        self.log = log
        self.lock = threading.Lock()
        self.status = {"running": False, "step": None, "last_run": None, "last_error": None, "log": []}

    # ------------------------------------------------------------------ helpers
    def _note(self, msg):
        stamp = time.strftime("%H:%M:%S")
        self.status["step"] = msg
        self.status["log"] = (self.status["log"] + [f"{stamp} {msg}"])[-40:]
        self.log(f"[update] {msg}")

    def _due(self, conn, key, every, force):
        if force:
            return True
        last = db.meta_get(conn, f"last:{key}", 0) or 0
        return time.time() - float(last) >= every

    def _done(self, conn, key):
        db.meta_set(conn, f"last:{key}", time.time())
        conn.commit()

    # ------------------------------------------------------------------ main
    def run(self, force=False):
        """Run one sync pass. Returns False if another pass is already running."""
        if not self.lock.acquire(blocking=False):
            return False
        self.status.update(running=True, last_error=None)
        conn = db.connect(self.db_path)
        errors = []
        try:
            state = self.sync_state(conn)
            season = int(state.get("season") or dt.date.today().year)
            seasons = [season - i for i in range(self.history, -1, -1)]
            steps = [
                ("schedule", lambda: self.sync_schedule(conn, seasons, force)),
                ("players", lambda: self.sync_players(conn, force)),
                ("stats", lambda: self.sync_stats(conn, seasons, state, force)),
                ("projections", lambda: self.sync_projections(conn, season, state, force)),
                ("advanced", lambda: advanced.sync_all(conn, seasons, season, self._note, force)),
                ("values", lambda: self.sync_values(conn, force)),
                ("trending", lambda: self.sync_trending(conn, force)),
            ]
            for name, fn in steps:
                try:
                    fn()
                except Exception as e:  # keep going; one bad source should not block the rest
                    errors.append(f"{name}: {e}")
                    self._note(f"{name} failed: {e}")
                    traceback.print_exc()
            db.bump_version(conn)
            db.meta_set(conn, "last_sync", time.time())
            conn.commit()
            self._note("Up to date" if not errors else f"Finished with {len(errors)} error(s)")
        except Exception as e:
            errors.append(str(e))
            self._note(f"Sync failed: {e}")
            traceback.print_exc()
        finally:
            conn.close()
            self.status.update(running=False, last_run=time.time(), last_error="; ".join(errors) or None)
            self.lock.release()
        return True

    # ------------------------------------------------------------------ sources
    def sync_state(self, conn):
        self._note("Checking NFL calendar")
        state = get_json(f"{SLEEPER}/v1/state/nfl") or {}
        db.meta_set(conn, "nfl_state", state)
        conn.commit()
        return state

    def sync_schedule(self, conn, seasons, force):
        if not self._due(conn, "schedule", EVERY["schedule"], force):
            return
        for s in seasons:
            self._note(f"Schedule {s}")
            games = get_json(f"{SLEEPER}/schedule/nfl/regular/{s}") or []
            conn.executemany(
                "INSERT OR REPLACE INTO schedule VALUES(?,?,?,?,?,?,?)",
                [(s, g.get("week"), g.get("game_id"), g.get("home"), g.get("away"), g.get("date"), g.get("status"))
                 for g in games],
            )
        self._done(conn, "schedule")

    def sync_players(self, conn, force):
        if not self._due(conn, "players", EVERY["players"], force):
            return
        self._note("Player database (rosters, injuries, depth charts)")
        data = get_json(f"{SLEEPER}/v1/players/nfl", timeout=120) or {}
        rows = []
        for pid, p in data.items():
            pos = p.get("position")
            fpos = p.get("fantasy_positions") or []
            if pos not in FANTASY_POS and not set(fpos) & set(FANTASY_POS):
                continue
            if pos not in FANTASY_POS:
                pos = next(x for x in fpos if x in FANTASY_POS)
            name = p.get("full_name") or f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
            meta = p.get("metadata") or {}
            rows.append((
                pid, name, p.get("first_name"), p.get("last_name"), pos, p.get("team"),
                _age(p.get("birth_date")) or p.get("age"), p.get("birth_date"), p.get("years_exp"),
                _num(meta.get("rookie_year")), p.get("college"), p.get("height"), p.get("weight"), _num(p.get("number")),
                p.get("status"), 1 if p.get("active") else 0, p.get("injury_status"), p.get("injury_body_part"),
                p.get("injury_notes"), p.get("depth_chart_position"), p.get("depth_chart_order"),
                p.get("search_rank"), (name or "").lower(),
            ))
        conn.executemany(f"INSERT OR REPLACE INTO players VALUES({','.join('?' * 23)})", rows)
        self._done(conn, "players")
        self._note(f"Saved {len(rows)} players")

    def _week_state(self, conn, season, week):
        """Returns (any_game_started, settled). Settled = all games final 4+ days ago."""
        games = conn.execute("SELECT date, status FROM schedule WHERE season=? AND week=?", (season, week)).fetchall()
        if not games:
            return False, False
        today = dt.date.today()
        dates = [dt.date.fromisoformat(g["date"]) for g in games if g["date"]]
        started = any(d <= today for d in dates) or any(g["status"] == "complete" for g in games)
        done = all(g["status"] == "complete" for g in games)
        settled = done and dates and (today - max(dates)).days >= 4
        return started, settled

    def sync_stats(self, conn, seasons, state, force):
        cur_season = int(state.get("season") or 0)
        for s in seasons:
            for w in range(1, REG_SEASON_WEEKS + 1):
                started, settled = self._week_state(conn, s, w)
                if not started:
                    if s == cur_season:
                        break
                    continue
                key = f"stats:{s}:{w}"
                if db.meta_get(conn, key + ":final"):
                    continue
                if not settled and not self._due(conn, key, EVERY["stats_live"], force):
                    continue
                self._note(f"Stats {s} week {w}")
                rows = get_json(f"{SLEEPER}/stats/nfl/{s}/{w}?season_type=regular&{POS_QUERY}", timeout=90) or []
                self._store_weekly(conn, "stats", s, w, rows)
                self._done(conn, key)
                if settled:
                    db.meta_set(conn, key + ":final", True)
                    conn.commit()

    def sync_projections(self, conn, season, state, force):
        if state.get("season_type") not in ("regular", "pre"):
            return
        week = int(state.get("week") or 1) if state.get("season_type") == "regular" else 1
        for w in range(max(1, week), REG_SEASON_WEEKS + 1):
            near = w <= week + 1
            key = f"proj:{season}:{w}"
            if not self._due(conn, key, EVERY["proj_near" if near else "proj_far"], force):
                continue
            self._note(f"Projections {season} week {w}")
            rows = get_json(f"{SLEEPER}/projections/nfl/{season}/{w}?season_type=regular&{POS_QUERY}", timeout=90) or []
            self._store_weekly(conn, "projections", season, w, rows)
            self._done(conn, key)

    def _store_weekly(self, conn, table, season, week, rows):
        out = []
        players = []
        for r in rows:
            st = r.get("stats") or {}
            pid = r.get("player_id")
            p = r.get("player") or {}
            pos = p.get("position")
            if pos not in FANTASY_POS:  # e.g. FB -> RB, or two-way players
                pos = next((x for x in (p.get("fantasy_positions") or []) if x in FANTASY_POS), pos)
            if not pid or not st:
                continue
            if table == "projections" and (st.get("pts_ppr") or 0) < 0.3 and pos != "DEF":
                continue  # skip deep-bench noise
            base = [season, week, pid, pos, r.get("team"), r.get("opponent")]
            if table == "stats":
                if not st.get("gp") and not st.get("pts_ppr"):
                    continue
                out.append(tuple(base + [r.get("game_id"), st.get("pts_ppr"), st.get("pts_half_ppr"), st.get("pts_std")]
                                 + [st.get(c) for c in db.STAT_COLS] + [json.dumps(st, separators=(",", ":"))]))
            else:
                out.append(tuple(base + [st.get("pts_ppr"), st.get("pts_half_ppr"), st.get("pts_std"),
                                         json.dumps(st, separators=(",", ":"))]))
            if p:
                name = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
                players.append((pid, name, p.get("first_name"), p.get("last_name"), pos, p.get("team"), name.lower()))
        conn.execute(f"DELETE FROM {table} WHERE season=? AND week=?", (season, week))
        if out:
            conn.executemany(f"INSERT OR REPLACE INTO {table} VALUES({','.join('?' * len(out[0]))})", out)
        # Make sure every player in the box score exists in the players table (old/retired players).
        conn.executemany(
            "INSERT OR IGNORE INTO players(player_id, full_name, first_name, last_name, pos, team, search_name) "
            "VALUES(?,?,?,?,?,?,?)", players)
        conn.commit()

    def sync_values(self, conn, force):
        if not self._due(conn, "values", EVERY["values"], force):
            return
        today = dt.date.today().isoformat()
        for fmt, (dyn, qbs) in VALUE_FORMATS.items():
            self._note(f"Trade values ({fmt.replace('_', ' ')})")
            data = get_json(FC_URL.format(d=dyn, q=qbs)) or []
            rows = []
            for v in data:
                p = v.get("player") or {}
                pid = p.get("sleeperId") or f"fc:{p.get('id')}"
                rows.append((fmt, pid, p.get("name"), p.get("position"), p.get("maybeTeam"), p.get("maybeAge"),
                             v.get("value"), v.get("overallRank"), v.get("positionRank"), v.get("maybeTier"),
                             v.get("trend30Day")))
            if not rows:
                continue
            conn.execute("DELETE FROM player_values WHERE fmt=?", (fmt,))
            conn.executemany(f"INSERT OR REPLACE INTO player_values VALUES({','.join('?' * 11)})", rows)
            conn.executemany("INSERT OR REPLACE INTO value_history VALUES(?,?,?,?)",
                             [(today, fmt, r[1], r[6]) for r in rows])
        self._done(conn, "values")

    def sync_trending(self, conn, force):
        if not self._due(conn, "trending", EVERY["trending"], force):
            return
        self._note("Trending adds and drops")
        conn.execute("DELETE FROM trending")
        for kind in ("add", "drop"):
            data = get_json(f"{SLEEPER}/v1/players/nfl/trending/{kind}?lookback_hours=24&limit=60") or []
            conn.executemany("INSERT OR REPLACE INTO trending VALUES(?,?,?)",
                             [(kind, d["player_id"], d.get("count", 0)) for d in data])
        self._done(conn, "trending")


class Scheduler(threading.Thread):
    """Runs the updater on start-up and then every `interval_hours`."""

    def __init__(self, updater, interval_hours=2.0):
        super().__init__(daemon=True)
        self.updater = updater
        self.interval = max(0.25, interval_hours) * HOUR
        self.wake = threading.Event()
        self.force_next = False

    def trigger(self, force=False):
        self.force_next = self.force_next or force
        self.wake.set()

    def run(self):
        while True:
            force, self.force_next = self.force_next, False
            self.updater.run(force=force)
            self.updater.status["next_run"] = time.time() + self.interval
            self.wake.wait(self.interval)
            self.wake.clear()
