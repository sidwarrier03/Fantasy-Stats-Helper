"""SQLite schema and connection helpers."""
import json
import os
import sqlite3
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = os.path.join(ROOT, "data", "huddle.db")

# Box-score columns copied out of Sleeper's raw stat blob so they are easy to query in SQL.
STAT_COLS = [
    "gp", "off_snp", "tm_off_snp",
    "pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int", "pass_air_yd", "pass_rz_att",
    "rush_att", "rush_yd", "rush_td", "rush_rz_att",
    "rec_tgt", "rec", "rec_yd", "rec_td", "rec_air_yd", "rec_rz_tgt",
    "fum_lost",
]

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS players(
  player_id TEXT PRIMARY KEY, full_name TEXT, first_name TEXT, last_name TEXT,
  pos TEXT, team TEXT, age REAL, birth_date TEXT, years_exp INTEGER, rookie_year INTEGER,
  college TEXT, height TEXT, weight TEXT, number INTEGER, status TEXT, active INTEGER,
  injury_status TEXT, injury_body_part TEXT, injury_notes TEXT,
  depth_chart_pos TEXT, depth_chart_order INTEGER, search_rank INTEGER, search_name TEXT);

CREATE TABLE IF NOT EXISTS stats(
  season INTEGER, week INTEGER, player_id TEXT, pos TEXT, team TEXT, opp TEXT, game_id TEXT,
  pts_ppr REAL, pts_half REAL, pts_std REAL,
  {", ".join(c + " REAL" for c in STAT_COLS)},
  raw TEXT, PRIMARY KEY(season, week, player_id));
CREATE INDEX IF NOT EXISTS stats_player ON stats(player_id, season);
CREATE INDEX IF NOT EXISTS stats_team ON stats(season, week, team);

CREATE TABLE IF NOT EXISTS projections(
  season INTEGER, week INTEGER, player_id TEXT, pos TEXT, team TEXT, opp TEXT,
  pts_ppr REAL, pts_half REAL, pts_std REAL, raw TEXT, PRIMARY KEY(season, week, player_id));

CREATE TABLE IF NOT EXISTS schedule(
  season INTEGER, week INTEGER, game_id TEXT, home TEXT, away TEXT, date TEXT, status TEXT,
  PRIMARY KEY(season, game_id));

CREATE TABLE IF NOT EXISTS player_values(
  fmt TEXT, player_id TEXT, name TEXT, pos TEXT, team TEXT, age REAL, value INTEGER,
  overall_rank INTEGER, pos_rank INTEGER, tier INTEGER, trend30 INTEGER,
  PRIMARY KEY(fmt, player_id));

CREATE TABLE IF NOT EXISTS value_history(
  day TEXT, fmt TEXT, player_id TEXT, value INTEGER, PRIMARY KEY(day, fmt, player_id));

CREATE TABLE IF NOT EXISTS trending(kind TEXT, player_id TEXT, count INTEGER, PRIMARY KEY(kind, player_id));

CREATE TABLE IF NOT EXISTS http_cache(url TEXT PRIMARY KEY, body TEXT, fetched_at REAL);

CREATE VIEW IF NOT EXISTS team_week AS
  SELECT season, week, team, SUM(rec_tgt) AS tm_tgt, SUM(rush_att) AS tm_rush,
         SUM(rec_air_yd) AS tm_air, SUM(pass_att) AS tm_pass_att
  FROM stats WHERE pos IN ('QB','RB','WR','TE') GROUP BY season, week, team;
"""


def connect(path=DEFAULT_DB, readonly=False):
    if readonly:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30, check_same_thread=False)
    else:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        conn = sqlite3.connect(path, timeout=30, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        from . import advanced  # imported here to avoid a circular import
        advanced.ensure_schema(conn)
    conn.row_factory = sqlite3.Row
    return conn


def meta_get(conn, key, default=None):
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    if not row:
        return default
    try:
        return json.loads(row[0])
    except (TypeError, ValueError):
        return row[0]


def meta_set(conn, key, value):
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)", (key, json.dumps(value)))


def bump_version(conn):
    meta_set(conn, "data_version", time.time())
