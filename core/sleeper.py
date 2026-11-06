"""Cached access to Sleeper user/league endpoints (used for league sync)."""
import json
import time
import urllib.parse

from .net import get_json

BASE = "https://api.sleeper.app/v1"


def cached(conn, path, ttl):
    url = BASE + path
    row = conn.execute("SELECT body, fetched_at FROM http_cache WHERE url=?", (url,)).fetchone()
    if row and time.time() - row["fetched_at"] < ttl:
        return json.loads(row["body"])
    try:
        data = get_json(url, timeout=30)
    except Exception:
        if row:  # serve stale data when offline
            return json.loads(row["body"])
        raise
    conn.execute("INSERT OR REPLACE INTO http_cache VALUES(?,?,?)", (url, json.dumps(data), time.time()))
    conn.commit()
    return data


def user(conn, username):
    return cached(conn, f"/user/{urllib.parse.quote(username.strip())}", 24 * 3600)


def leagues(conn, user_id, season):
    return cached(conn, f"/user/{user_id}/leagues/nfl/{season}", 3600) or []


def league(conn, league_id):
    return cached(conn, f"/league/{league_id}", 3600)


def rosters(conn, league_id):
    return cached(conn, f"/league/{league_id}/rosters", 600) or []


def users(conn, league_id):
    return cached(conn, f"/league/{league_id}/users", 3600) or []


def matchups(conn, league_id, week):
    return cached(conn, f"/league/{league_id}/matchups/{week}", 300) or []


def traded_picks(conn, league_id):
    return cached(conn, f"/league/{league_id}/traded_picks", 3600) or []
