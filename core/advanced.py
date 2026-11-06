"""Advanced metrics from the open NFL datasets published by nflverse.

- Play-by-play (nflfastR model: EPA, success rate, CPOE, air yards, expected pass rate). This is the
  same data RBSDM.com and NFL Savant are built on.
- Pro-Football-Reference advanced stats (pressures, blitzes, bad throws, drops, broken tackles,
  yards before/after contact), mirrored weekly by nflverse because PFR blocks automated access.
- NFL Next Gen Stats (separation, YAC over expected, rush yards over expected, time to throw).

Everything is stored per player per week (sums and counts, so any date range aggregates correctly)
in `adv_week`, per team per week in `team_adv_week`, and Next Gen season rows in `ngs_season`.
"""
import csv
import gzip
import io
import json
import re
import time
import unicodedata

from . import db
from .net import get_bytes

NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
ID_MAP_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
TEAM_FIX = {"LA": "LAR", "OAK": "LV", "SD": "LAC", "STL": "LAR"}  # nflverse -> Sleeper abbreviations
HOUR = 3600

SCHEMA = """
CREATE TABLE IF NOT EXISTS id_map(gsis_id TEXT PRIMARY KEY, sleeper_id TEXT, pfr_id TEXT, name TEXT, pos TEXT);
CREATE INDEX IF NOT EXISTS id_map_pfr ON id_map(pfr_id);

CREATE TABLE IF NOT EXISTS adv_week(
  season INTEGER, week INTEGER, player_id TEXT, gsis_id TEXT, team TEXT,
  dropbacks INTEGER, pass_att INTEGER, pass_cmp INTEGER, pass_epa REAL, pass_success INTEGER,
  cpoe_sum REAL, cpoe_n INTEGER, pass_air_yds REAL, deep_att INTEGER, sacks INTEGER, scrambles INTEGER,
  ints INTEGER, pass_td INTEGER, rz_dropbacks INTEGER,
  rush_att INTEGER, rush_epa REAL, rush_success INTEGER, rush_yds REAL, rz_rush INTEGER, i5_rush INTEGER,
  explosive_rush INTEGER,
  targets INTEGER, rec INTEGER, rec_epa REAL, rec_success INTEGER, air_yds REAL, yac REAL, rec_yds REAL,
  rec_td INTEGER, rz_targets INTEGER, ez_targets INTEGER, deep_targets INTEGER, tgt_ints INTEGER,
  rec_first_downs INTEGER,
  pressured INTEGER, blitzed INTEGER, hurried INTEGER, hit INTEGER, bad_throws INTEGER, thrown_drops INTEGER,
  pfr_carries INTEGER, yds_before_contact REAL, yds_after_contact REAL, rush_broken_tackles INTEGER,
  rec_broken_tackles INTEGER, drops INTEGER,
  PRIMARY KEY(season, week, player_id));
CREATE INDEX IF NOT EXISTS adv_week_player ON adv_week(player_id, season);

CREATE TABLE IF NOT EXISTS team_adv_week(
  season INTEGER, week INTEGER, team TEXT, side TEXT,
  plays INTEGER, epa REAL, success INTEGER,
  pass_plays INTEGER, pass_epa REAL, pass_success INTEGER,
  rush_plays INTEGER, rush_epa REAL, rush_success INTEGER,
  xpass_n INTEGER, xpass_sum REAL, pass_oe_sum REAL,
  PRIMARY KEY(season, week, team, side));

CREATE TABLE IF NOT EXISTS ngs_season(season INTEGER, player_id TEXT, kind TEXT, data TEXT,
  PRIMARY KEY(season, player_id, kind));
"""

PLAYER_COLS = [
    "dropbacks", "pass_att", "pass_cmp", "pass_epa", "pass_success", "cpoe_sum", "cpoe_n", "pass_air_yds",
    "deep_att", "sacks", "scrambles", "ints", "pass_td", "rz_dropbacks",
    "rush_att", "rush_epa", "rush_success", "rush_yds", "rz_rush", "i5_rush", "explosive_rush",
    "targets", "rec", "rec_epa", "rec_success", "air_yds", "yac", "rec_yds", "rec_td", "rz_targets",
    "ez_targets", "deep_targets", "tgt_ints", "rec_first_downs",
    "pressured", "blitzed", "hurried", "hit", "bad_throws", "thrown_drops",
    "pfr_carries", "yds_before_contact", "yds_after_contact", "rush_broken_tackles", "rec_broken_tackles", "drops",
]
TEAM_COLS = ["plays", "epa", "success", "pass_plays", "pass_epa", "pass_success", "rush_plays", "rush_epa",
             "rush_success", "xpass_n", "xpass_sum", "pass_oe_sum"]
NGS_FIELDS = {
    "passing": {"avg_time_to_throw": "ttt", "aggressiveness": "aggr", "avg_air_yards_to_sticks": "ay_sticks",
                "completion_percentage_above_expectation": "cpoe_ngs"},
    "rushing": {"rush_yards_over_expected_per_att": "ryoe_att", "rush_yards_over_expected": "ryoe",
                "percent_attempts_gte_eight_defenders": "box8", "efficiency": "rush_eff"},
    "receiving": {"avg_separation": "sep", "avg_cushion": "cushion", "avg_yac_above_expectation": "yacoe",
                  "percent_share_of_intended_air_yards": "iay_share"},
}


def ensure_schema(conn):
    conn.executescript(SCHEMA)


def _f(v):
    if v in ("", "NA", None):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _norm(name):
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", s)
    return re.sub(r"[^a-z]", "", s)


def _csv(data, gz=False):
    raw = gzip.decompress(data) if gz else data
    return csv.reader(io.StringIO(raw.decode("utf-8", "replace")))


def _due(conn, key, every, force):
    return force or time.time() - float(db.meta_get(conn, f"last:{key}", 0) or 0) >= every


def _done(conn, key):
    db.meta_set(conn, f"last:{key}", time.time())
    conn.commit()


# ---------------------------------------------------------------------- player ids
def sync_ids(conn, note, force=False):
    """Crosswalk NFL (gsis) and PFR ids to Sleeper ids."""
    if not _due(conn, "adv_ids", 24 * HOUR, force):
        return
    note("Player ID crosswalk (nflverse, DynastyProcess)")
    rows = {}
    data = get_bytes(ID_MAP_URL)
    if data:
        rd = _csv(data)
        h = {k: i for i, k in enumerate(next(rd))}
        for r in rd:
            g = r[h["gsis_id"]]
            if g in ("", "NA"):
                continue
            sid = r[h["sleeper_id"]]
            pfr = r[h["pfr_id"]]
            rows[g] = [None if sid in ("", "NA") else sid, None if pfr in ("", "NA") else pfr,
                       r[h["name"]], r[h["position"]]]
    data = get_bytes(f"{NFLVERSE}/players/players.csv")
    if data:
        rd = _csv(data)
        h = {k: i for i, k in enumerate(next(rd))}
        for r in rd:
            g = r[h["gsis_id"]]
            if not g:
                continue
            cur = rows.setdefault(g, [None, None, r[h["display_name"]], r[h["position"]]])
            if not cur[1] and r[h["pfr_id"]] not in ("", "NA"):
                cur[1] = r[h["pfr_id"]]
            if not cur[2]:
                cur[2] = r[h["display_name"]]
    if not rows:
        return
    # Name + position fallback for anyone the crosswalks don't link to a Sleeper id.
    by_name = {}
    for p in conn.execute("SELECT player_id, full_name, pos FROM players WHERE full_name IS NOT NULL"):
        by_name.setdefault((_norm(p["full_name"]), p["pos"]), []).append(p["player_id"])
    for g, v in rows.items():
        if not v[0]:
            hits = by_name.get((_norm(v[2]), v[3])) or []
            if len(hits) == 1:
                v[0] = hits[0]
    conn.execute("DELETE FROM id_map")
    conn.executemany("INSERT INTO id_map VALUES(?,?,?,?,?)", [(g, *v) for g, v in rows.items()])
    _done(conn, "adv_ids")
    note(f"Linked {sum(1 for v in rows.values() if v[0])} NFL player ids to Sleeper")


def _id_lookup(conn):
    gsis, pfr = {}, {}
    for r in conn.execute("SELECT gsis_id, sleeper_id, pfr_id FROM id_map"):
        gsis[r["gsis_id"]] = r["sleeper_id"]
        if r["pfr_id"]:
            pfr[r["pfr_id"]] = (r["sleeper_id"], r["gsis_id"])
    return gsis, pfr


# ---------------------------------------------------------------------- play-by-play + PFR
def sync_season(conn, season, current, note, force=False):
    """Download and aggregate one season. Past seasons are processed once; the current one every 12 hours."""
    key = f"adv:{season}"
    if not current and db.meta_get(conn, key + ":final") and not force:
        return
    if current and not _due(conn, key, 12 * HOUR, force):
        return
    note(f"Play-by-play {season} (EPA, success rate, air yards)")
    data = get_bytes(f"{NFLVERSE}/pbp/play_by_play_{season}.csv.gz")
    if not data:
        return
    gsis_to_sleeper, pfr_to = _id_lookup(conn)
    players, teams = {}, {}

    def P(week, gid, team):
        pid = gsis_to_sleeper.get(gid) or f"gsis:{gid}"
        rec = players.get((week, pid))
        if rec is None:
            rec = players[(week, pid)] = dict.fromkeys(PLAYER_COLS, 0)
            rec.update(gsis_id=gid, team=team)
        return rec

    def T(week, team, side):
        k = (week, team, side)
        if k not in teams:
            teams[k] = dict.fromkeys(TEAM_COLS, 0)
        return teams[k]

    rd = _csv(data, gz=True)
    h = {k: i for i, k in enumerate(next(rd))}
    col = lambda r, k: r[h[k]]
    for r in rd:
        if col(r, "season_type") != "REG":
            continue
        is_pass, is_rush = col(r, "pass") == "1", col(r, "rush") == "1"
        epa = _f(col(r, "epa"))
        if epa is None or not (is_pass or is_rush) or col(r, "two_point_attempt") == "1":
            continue
        week = int(col(r, "week"))
        off = TEAM_FIX.get(col(r, "posteam"), col(r, "posteam"))
        dfn = TEAM_FIX.get(col(r, "defteam"), col(r, "defteam"))
        succ = 1 if col(r, "success") == "1" else 0
        yl = _f(col(r, "yardline_100")) or 100
        air = _f(col(r, "air_yards"))
        complete = col(r, "complete_pass") == "1"
        sack = col(r, "sack") == "1"
        intercepted = col(r, "interception") == "1"

        # Team EPA/play follows RBSDM and counts plays wiped out by penalties (the `pass`/`rush` flags
        # include them). Player stats only count real plays, which matches official totals exactly.
        for side, team in (("off", off), ("def", dfn)):
            t = T(week, team, side)
            t["plays"] += 1
            t["epa"] += epa
            t["success"] += succ
            kind = "pass" if is_pass else "rush"
            t[f"{kind}_plays"] += 1
            t[f"{kind}_epa"] += epa
            t[f"{kind}_success"] += succ
            xp = _f(col(r, "xpass"))
            if xp is not None:
                t["xpass_n"] += 1
                t["xpass_sum"] += xp
                t["pass_oe_sum"] += _f(col(r, "pass_oe")) or 0

        if col(r, "play_type") == "no_play":
            continue
        if is_pass and col(r, "passer_id") not in ("", "NA"):
            q = P(week, col(r, "passer_id"), off)
            q["dropbacks"] += 1
            q["pass_epa"] += _f(col(r, "qb_epa")) if _f(col(r, "qb_epa")) is not None else epa
            q["pass_success"] += succ
            q["sacks"] += sack
            q["scrambles"] += col(r, "qb_scramble") == "1"
            q["ints"] += intercepted
            q["pass_td"] += col(r, "pass_touchdown") == "1"
            q["rz_dropbacks"] += yl <= 20
            if col(r, "pass_attempt") == "1" and not sack:
                q["pass_att"] += 1
                q["pass_cmp"] += complete
                if air is not None:
                    q["pass_air_yds"] += air
                    q["deep_att"] += air >= 20
                cp = _f(col(r, "cpoe"))
                if cp is not None:
                    q["cpoe_sum"] += cp
                    q["cpoe_n"] += 1
        if is_rush and col(r, "rusher_id") not in ("", "NA"):
            ru = P(week, col(r, "rusher_id"), off)
            yds = _f(col(r, "rushing_yards")) or 0
            ru["rush_att"] += 1
            ru["rush_epa"] += epa
            ru["rush_success"] += succ
            ru["rush_yds"] += yds
            ru["rz_rush"] += yl <= 20
            ru["i5_rush"] += yl <= 5
            ru["explosive_rush"] += yds >= 10
        if is_pass and not sack and col(r, "receiver_id") not in ("", "NA"):
            w = P(week, col(r, "receiver_id"), off)
            w["targets"] += 1
            w["rec"] += complete
            w["rec_epa"] += epa
            w["rec_success"] += succ
            if air is not None:
                w["air_yds"] += air
                w["deep_targets"] += air >= 20
                w["ez_targets"] += air >= yl
            if complete:
                w["yac"] += _f(col(r, "yards_after_catch")) or 0
                w["rec_first_downs"] += col(r, "first_down") == "1"
            w["rec_yds"] += _f(col(r, "receiving_yards")) or 0
            w["rec_td"] += col(r, "pass_touchdown") == "1"
            w["rz_targets"] += yl <= 20
            w["tgt_ints"] += intercepted

    # Pro-Football-Reference advanced stats (nflverse weekly mirror).
    pfr_map = {"pass": {"times_pressured": "pressured", "times_blitzed": "blitzed", "times_hurried": "hurried",
                        "times_hit": "hit", "passing_bad_throws": "bad_throws", "passing_drops": "thrown_drops"},
               "rush": {"carries": "pfr_carries", "rushing_yards_before_contact": "yds_before_contact",
                        "rushing_yards_after_contact": "yds_after_contact",
                        "rushing_broken_tackles": "rush_broken_tackles"},
               "rec": {"receiving_broken_tackles": "rec_broken_tackles", "receiving_drop": "drops"}}
    for kind, fields in pfr_map.items():
        note(f"Pro-Football-Reference advanced {kind} {season}")
        raw = get_bytes(f"{NFLVERSE}/pfr_advstats/advstats_week_{kind}_{season}.csv")
        if not raw:
            continue
        rd = _csv(raw)
        hh = {k: i for i, k in enumerate(next(rd))}
        for r in rd:
            if r[hh["game_type"]] != "REG":
                continue
            sid, gid = pfr_to.get(r[hh["pfr_player_id"]], (None, None))
            pid = sid or (f"gsis:{gid}" if gid else f"pfr:{r[hh['pfr_player_id']]}")
            week = int(r[hh["week"]])
            rec = players.get((week, pid))
            if rec is None:
                rec = players[(week, pid)] = dict.fromkeys(PLAYER_COLS, 0)
                rec.update(gsis_id=gid, team=TEAM_FIX.get(r[hh["team"]], r[hh["team"]]))
            for src, dst in fields.items():
                v = _f(r[hh[src]])
                if v is not None:
                    rec[dst] = v

    conn.execute("DELETE FROM adv_week WHERE season=?", (season,))
    conn.executemany(
        f"INSERT OR REPLACE INTO adv_week VALUES({','.join('?' * (5 + len(PLAYER_COLS)))})",
        [(season, w, pid, v["gsis_id"], v["team"], *[v[c] for c in PLAYER_COLS]) for (w, pid), v in players.items()])
    conn.execute("DELETE FROM team_adv_week WHERE season=?", (season,))
    conn.executemany(
        f"INSERT INTO team_adv_week VALUES({','.join('?' * (4 + len(TEAM_COLS)))})",
        [(season, w, t, s, *[v[c] for c in TEAM_COLS]) for (w, t, s), v in teams.items()])
    _done(conn, key)
    if not current:
        db.meta_set(conn, key + ":final", True)
        conn.commit()
    note(f"Advanced stats {season}: {len(players)} player-weeks, {len({k[1] for k in teams})} teams")


# ---------------------------------------------------------------------- Next Gen Stats
def sync_ngs(conn, seasons, note, force=False):
    if not _due(conn, "adv_ngs", 12 * HOUR, force):
        return
    gsis_to_sleeper, _ = _id_lookup(conn)
    keep = {str(s) for s in seasons}
    rows = []
    for kind, fields in NGS_FIELDS.items():
        note(f"Next Gen Stats {kind}")
        raw = get_bytes(f"{NFLVERSE}/nextgen_stats/ngs_{kind}.csv.gz")
        if not raw:
            continue
        rd = _csv(raw, gz=True)
        hh = {k: i for i, k in enumerate(next(rd))}
        for r in rd:
            if r[hh["season"]] not in keep or r[hh["season_type"]] != "REG" or r[hh["week"]] != "0":
                continue  # week 0 = season-to-date row
            gid = r[hh["player_gsis_id"]]
            pid = gsis_to_sleeper.get(gid) or f"gsis:{gid}"
            vals = {dst: _f(r[hh[src]]) for src, dst in fields.items() if src in hh}
            rows.append((int(r[hh["season"]]), pid, kind, json.dumps(vals)))
    if rows:
        conn.execute(f"DELETE FROM ngs_season WHERE season IN ({','.join('?' * len(keep))})", [int(s) for s in keep])
        conn.executemany("INSERT OR REPLACE INTO ngs_season VALUES(?,?,?,?)", rows)
    _done(conn, "adv_ngs")


def sync_all(conn, seasons, current_season, note, force=False):
    ensure_schema(conn)
    sync_ids(conn, note, force)
    for s in seasons:
        sync_season(conn, s, s == current_season, note, force)
    sync_ngs(conn, seasons, note, force)
