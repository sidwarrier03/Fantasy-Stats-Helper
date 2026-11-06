"""Read-side queries behind every page of the app.

Scoring is applied at read time: `scoring` is "ppr", "half", "std", or "league:<sleeper league id>",
in which case each box score is re-scored with that league's exact scoring settings.
"""
import datetime as dt
import json
import statistics
import time

from . import db, sleeper

PRESET = {"ppr": "pts_ppr", "half": "pts_half", "std": "pts_std"}
TOP = {"QB": 12, "RB": 24, "WR": 24, "TE": 12, "K": 12, "DEF": 12}
SKILL = ("QB", "RB", "WR", "TE")
FANTASY = SKILL + ("K", "DEF")
INJ_FACTOR = {"Out": 0.0, "IR": 0.0, "PUP": 0.0, "Sus": 0.0, "NA": 0.0, "Doubtful": 0.25, "Questionable": 0.9}
_cache = {}


# ---------------------------------------------------------------------- utils
def memo(conn, key, fn):
    version = db.meta_get(conn, "data_version", 0)
    hit = _cache.get(key)
    if hit and hit[0] == version:
        return hit[1]
    val = fn()
    if len(_cache) > 300:
        _cache.clear()
    _cache[key] = (version, val)
    return val


def _r(x, n=3):
    return None if x is None else round(x, n)


def _div(a, b):
    return a / b if b and a is not None else None


def value_fmt(fmt, qb):
    return f"{'dynasty' if fmt == 'dynasty' else 'redraft'}_{'sf' if str(qb) == '2' else '1qb'}"


def nfl_state(conn):
    return db.meta_get(conn, "nfl_state", {}) or {}


def stat_seasons(conn):
    return [r[0] for r in conn.execute("SELECT DISTINCT season FROM stats ORDER BY season DESC")]


def week_info(conn):
    st = nfl_state(conn)
    season = int(st.get("season") or dt.date.today().year)
    weeks = conn.execute(
        "SELECT week, SUM(status='complete') AS done, COUNT(*) AS n FROM schedule WHERE season=? "
        "GROUP BY week ORDER BY week", (season,)).fetchall()
    last_done = max([w["week"] for w in weeks if w["done"] == w["n"]] or [0])
    upcoming = next((w["week"] for w in weeks if w["done"] < w["n"]), None)
    seasons = stat_seasons(conn)
    stats_season = season if season in seasons else (seasons[0] if seasons else season)
    return {"season": season, "week": int(st.get("week") or 0), "season_type": st.get("season_type"),
            "last_done": last_done, "upcoming": upcoming, "stats_season": stats_season, "seasons": seasons}


def scorer(conn, scoring):
    """Returns (fn(row)->points, needs_raw)."""
    if scoring in PRESET:
        col = PRESET[scoring]
        return (lambda r: r.get(col) or 0.0), False
    if scoring and scoring.startswith("league:"):
        lg = sleeper.league(conn, scoring.split(":", 1)[1]) or {}
        ss = {k: v for k, v in (lg.get("scoring_settings") or {}).items() if isinstance(v, (int, float)) and v}
        if ss:
            def score(r):
                raw = json.loads(r["raw"]) if r.get("raw") else {}
                return sum(raw.get(k, 0) * v for k, v in ss.items())
            return score, True
    return (lambda r: r.get("pts_ppr") or 0.0), False


def player_map(conn):
    def build():
        cols = ("player_id, full_name, pos, team, age, years_exp, rookie_year, injury_status, injury_body_part, "
                "status, depth_chart_order, college, height, weight, number, search_rank, birth_date")
        return {r["player_id"]: dict(r) for r in conn.execute(f"SELECT {cols} FROM players")}
    return memo(conn, ("players",), build)


def values_map(conn, fmt):
    def build():
        return {r["player_id"]: dict(r) for r in conn.execute("SELECT * FROM player_values WHERE fmt=?", (fmt,))}
    return memo(conn, ("values", fmt), build)


# ---------------------------------------------------------------------- weekly rows
STAT_SELECT = "season, week, player_id, pos, team, opp, pts_ppr, pts_half, pts_std, " + ", ".join(db.STAT_COLS)


def season_rows(conn, season, scoring):
    """Every player-game of a season, scored, with team shares and weekly position rank."""
    def build():
        score, need_raw = scorer(conn, scoring)
        sql = f"SELECT {STAT_SELECT}{', raw' if need_raw else ''} FROM stats WHERE season=?"
        rows, team = [], {}
        for r in conn.execute(sql, (season,)):
            d = dict(r)
            d["pts"] = round(score(d), 2)
            d.pop("raw", None)
            rows.append(d)
            if d["pos"] in SKILL:
                t = team.setdefault((d["week"], d["team"]), [0.0, 0.0, 0.0])
                t[0] += d["rec_tgt"] or 0
                t[1] += d["rush_att"] or 0
                t[2] += d["rec_air_yd"] or 0
        groups = {}
        for d in rows:
            d["tm_tgt"], d["tm_rush"], d["tm_air"] = team.get((d["week"], d["team"]), (0, 0, 0))
            d["wk_rank"] = None
            if (d["gp"] or 0) > 0:
                groups.setdefault((d["week"], d["pos"]), []).append(d)
        for g in groups.values():
            g.sort(key=lambda x: -x["pts"])
            for i, d in enumerate(g):
                d["wk_rank"] = i + 1
        return rows
    return memo(conn, ("rows", season, scoring), build)


def summarize(games):
    played = sorted([g for g in games if (g.get("gp") or 0) > 0], key=lambda g: g["week"])
    n = len(played)
    if not n:
        return None
    pts = [g["pts"] for g in played]

    def tot(k):
        return sum((g.get(k) or 0) for g in played)

    snaps = [g["off_snp"] / g["tm_off_snp"] for g in played if g.get("tm_off_snp") and g.get("off_snp") is not None]
    out = {
        "gp": n, "pts": round(sum(pts), 1), "ppg": round(sum(pts) / n, 2),
        "l3": round(sum(pts[-3:]) / len(pts[-3:]), 2),
        "sd": round(statistics.pstdev(pts), 2) if n > 1 else 0.0,
        "hi": round(max(pts), 1), "lo": round(min(pts), 1),
        "top12": round(sum(1 for g in played if (g["wk_rank"] or 999) <= 12) / n, 3),
        "top24": round(sum(1 for g in played if (g["wk_rank"] or 999) <= 24) / n, 3),
        "snap": _r(sum(snaps) / len(snaps)) if snaps else None,
        "tgt_share": _r(_div(tot("rec_tgt"), tot("tm_tgt"))),
        "air_share": _r(_div(tot("rec_air_yd"), tot("tm_air"))),
        "rush_share": _r(_div(tot("rush_att"), tot("tm_rush"))),
        "adot": _r(_div(tot("rec_air_yd"), tot("rec_tgt")), 1),
        "ypc": _r(_div(tot("rush_yd"), tot("rush_att")), 2),
        "ypr": _r(_div(tot("rec_yd"), tot("rec")), 1),
        "cmp_pct": _r(_div(tot("pass_cmp"), tot("pass_att"))),
        "weeks": {g["week"]: g["pts"] for g in played},
    }
    for c in ("pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td",
              "rec_tgt", "rec", "rec_yd", "rec_td", "rec_air_yd", "rec_rz_tgt", "rush_rz_att", "fum_lost"):
        out[c] = round(tot(c), 1)
    return out


def season_summaries(conn, season, scoring):
    """pid -> summary with season position ranks (by total and by PPG)."""
    def build():
        rows = season_rows(conn, season, scoring)
        by = {}
        for d in rows:
            by.setdefault(d["player_id"], []).append(d)
        out = {}
        for pid, games in by.items():
            sm = summarize(games)
            if sm:
                sm["pos"] = games[-1]["pos"]
                sm["last_team"] = sorted(games, key=lambda g: g["week"])[-1]["team"]
                out[pid] = sm
        bypos = {}
        for pid, sm in out.items():
            bypos.setdefault(sm["pos"], []).append((pid, sm))
        for items in bypos.values():
            items.sort(key=lambda x: -x[1]["pts"])
            for i, (_, sm) in enumerate(items):
                sm["pos_rank"] = i + 1
            max_gp = max(sm["gp"] for _, sm in items)
            qual = [x for x in items if x[1]["gp"] >= max(1, max_gp // 2)]
            qual.sort(key=lambda x: -x[1]["ppg"])
            for i, (_, sm) in enumerate(qual):
                sm["ppg_rank"] = i + 1
        return out
    return memo(conn, ("summ", season, scoring), build)


# ---------------------------------------------------------------------- projections & matchups
def proj_rows(conn, season, week, scoring):
    def build():
        score, need_raw = scorer(conn, scoring)
        sql = (f"SELECT player_id, pos, team, opp, pts_ppr, pts_half, pts_std{', raw' if need_raw else ''} "
               "FROM projections WHERE season=? AND week=?")
        return {r["player_id"]: {"pts": round(score(dict(r)), 2), "opp": r["opp"], "team": r["team"], "pos": r["pos"]}
                for r in conn.execute(sql, (season, week))}
    return memo(conn, ("proj", season, week, scoring), build)


def ros_proj(conn, season, start, scoring):
    def build():
        out = {}
        if not start:
            return out
        weeks = [r[0] for r in conn.execute(
            "SELECT DISTINCT week FROM projections WHERE season=? AND week>=?", (season, start))]
        for w in weeks:
            for pid, p in proj_rows(conn, season, w, scoring).items():
                out[pid] = round(out.get(pid, 0) + p["pts"], 1)
        return out
    return memo(conn, ("ros", season, start, scoring), build)


def defense_vs_pos(conn, season, scoring):
    """Average fantasy points each defense allows per game to each position. rank 1 = softest matchup."""
    def build():
        weekly = {}
        for d in season_rows(conn, season, scoring):
            if (d["gp"] or 0) > 0 and d["opp"] and d["pos"] in FANTASY:
                k = (d["opp"], d["pos"], d["week"])
                weekly[k] = weekly.get(k, 0) + d["pts"]
        agg = {}
        for (opp, pos, _), v in weekly.items():
            agg.setdefault((opp, pos), []).append(v)
        teams = {}
        avg = {}
        for pos in FANTASY:
            items = [(opp, sum(v) / len(v), len(v)) for (opp, p), v in agg.items() if p == pos]
            if not items:
                continue
            avg[pos] = round(sum(x[1] for x in items) / len(items), 2)
            items.sort(key=lambda x: -x[1])
            for i, (opp, a, n) in enumerate(items):
                teams.setdefault(opp, {})[pos] = {"avg": round(a, 2), "rank": i + 1, "g": n,
                                                  "diff": round(a - avg[pos], 2)}
        return {"teams": teams, "avg": avg, "n": len(teams)}
    return memo(conn, ("dvp", season, scoring), build)


def opponents(conn, season):
    """(week, team) -> (opp, is_home)."""
    def build():
        out = {}
        for g in conn.execute("SELECT week, home, away FROM schedule WHERE season=?", (season,)):
            out[(g["week"], g["home"])] = (g["away"], True)
            out[(g["week"], g["away"])] = (g["home"], False)
        return out
    return memo(conn, ("opps", season), build)


# ---------------------------------------------------------------------- pages
def status(conn, updater_status):
    wi = week_info(conn)
    counts = {
        "players": conn.execute("SELECT COUNT(*) FROM players").fetchone()[0],
        "stat_rows": conn.execute("SELECT COUNT(*) FROM stats").fetchone()[0],
        "projection_rows": conn.execute("SELECT COUNT(*) FROM projections").fetchone()[0],
        "values": conn.execute("SELECT COUNT(DISTINCT player_id) FROM player_values").fetchone()[0],
    }
    last = {k[5:]: v for k, v in ((r[0], r[1]) for r in conn.execute("SELECT key, value FROM meta WHERE key LIKE 'last:%'"))
            if ":" not in k[5:]}
    return {"week": wi, "counts": counts, "last_sync": db.meta_get(conn, "last_sync"),
            "sources": {k: float(v) for k, v in last.items()}, "updater": updater_status,
            "version": db.meta_get(conn, "data_version", 0)}


def stats_table(conn, season, scoring, qb):
    def build():
        summ = season_summaries(conn, season, scoring)
        pm = player_map(conn)
        dyn, red = values_map(conn, value_fmt("dynasty", qb)), values_map(conn, value_fmt("redraft", qb))
        max_week = max([max(s["weeks"]) for s in summ.values()] or [0])
        rows = []
        for pid, sm in summ.items():
            p = pm.get(pid, {})
            r = {k: v for k, v in sm.items() if k != "weeks"}
            r.update(id=pid, name=p.get("full_name") or pid, team=p.get("team") or sm["last_team"],
                     age=p.get("age"), inj=p.get("injury_status"),
                     dyn=(dyn.get(pid) or {}).get("value"), red=(red.get(pid) or {}).get("value"),
                     wk=[sm["weeks"].get(w) for w in range(1, max_week + 1)])
            rows.append(r)
        rows.sort(key=lambda r: -r["pts"])
        return {"season": season, "scoring": scoring, "max_week": max_week, "rows": rows}
    return memo(conn, ("table", season, scoring, qb), build)


def player_index(conn):
    """Compact list for search boxes and the trade calculator: players and draft picks."""
    def build():
        pm = player_map(conn)
        fmts = ["dynasty_1qb", "dynasty_sf", "redraft_1qb", "redraft_sf"]
        vals = {f: values_map(conn, f) for f in fmts}
        wi = week_info(conn)
        recent = {r[0] for r in conn.execute("SELECT DISTINCT player_id FROM stats WHERE season>=?",
                                             ((wi["seasons"] or [wi["season"]])[0] - 1,))}
        ids = set().union(*[set(v) for v in vals.values()]) | recent
        out = []
        for pid in ids:
            p = pm.get(pid)
            vrow = next((vals[f][pid] for f in fmts if pid in vals[f]), None)
            if p:
                name, pos, team, age = p["full_name"], p["pos"], p["team"], p["age"]
            elif vrow:
                name, pos, team, age = vrow["name"], vrow["pos"], vrow["team"], vrow["age"]
            else:
                continue
            if pos not in FANTASY and pos != "PICK":
                continue
            out.append([pid, name, pos, team, age] + [(vals[f].get(pid) or {}).get("value") or 0 for f in fmts])
        out.sort(key=lambda x: -(x[5] + x[7]))
        return {"fields": ["id", "name", "pos", "team", "age"] + fmts, "rows": out}
    return memo(conn, ("index",), build)


def rankings(conn, fmt, qb, scoring):
    vf = value_fmt(fmt, qb)
    pm = player_map(conn)
    wi = week_info(conn)
    summ = season_summaries(conn, wi["stats_season"], scoring)
    ros = ros_proj(conn, wi["season"], wi["upcoming"], scoring) if fmt == "redraft" else {}
    rows = []
    for v in conn.execute("SELECT * FROM player_values WHERE fmt=? ORDER BY value DESC", (vf,)):
        pid = v["player_id"]
        p = pm.get(pid, {})
        sm = summ.get(pid) or {}
        rows.append({
            "id": pid, "name": p.get("full_name") or v["name"], "pos": v["pos"], "team": p.get("team") or v["team"],
            "age": p.get("age") or v["age"], "yoe": p.get("years_exp"), "inj": p.get("injury_status"),
            "value": v["value"], "rank": v["overall_rank"], "pos_rank": v["pos_rank"], "tier": v["tier"],
            "trend30": v["trend30"], "ppg": sm.get("ppg"), "gp": sm.get("gp"), "ppg_rank": sm.get("ppg_rank"),
            "ros": ros.get(pid),
        })
    return {"fmt": vf, "season": wi["stats_season"], "rows": rows}


def value_history(conn, pid, fmt):
    return [[r["day"], r["value"]] for r in conn.execute(
        "SELECT day, value FROM value_history WHERE fmt=? AND player_id=? ORDER BY day", (fmt, pid))]


def player_detail(conn, pid, scoring, qb):
    p = conn.execute("SELECT * FROM players WHERE player_id=?", (pid,)).fetchone()
    if not p:
        return None
    p = dict(p)
    wi = week_info(conn)
    career, logs = [], {}
    for s in sorted(wi["seasons"]):
        sm = season_summaries(conn, s, scoring).get(pid)
        if not sm:
            continue
        career.append({k: v for k, v in sm.items() if k != "weeks"} | {"season": s})
        games = sorted([d for d in season_rows(conn, s, scoring) if d["player_id"] == pid], key=lambda d: d["week"])
        logs[s] = [{
            "week": g["week"], "team": g["team"], "opp": g["opp"], "pts": g["pts"], "rank": g["wk_rank"],
            "gp": g["gp"],
            "snap": _r(_div(g["off_snp"], g["tm_off_snp"])), "tgt_share": _r(_div(g["rec_tgt"], g["tm_tgt"])),
            **{c: g[c] for c in ("pass_cmp", "pass_att", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd",
                                  "rush_td", "rec_tgt", "rec", "rec_yd", "rec_td", "rec_air_yd", "off_snp")},
        } for g in games]
    values = {}
    for f in ("dynasty_1qb", "dynasty_sf", "redraft_1qb", "redraft_sf"):
        v = values_map(conn, f).get(pid)
        values[f] = (v or {}) | {"history": value_history(conn, pid, f)}
    upcoming = []
    if wi["upcoming"]:
        dvp = defense_vs_pos(conn, wi["stats_season"], scoring)
        opps = opponents(conn, wi["season"])
        for w in range(wi["upcoming"], 19):
            pr = proj_rows(conn, wi["season"], w, scoring).get(pid)
            o = opps.get((w, p["team"]))
            if not o and not pr:
                continue
            opp = (pr or {}).get("opp") or (o[0] if o else None)
            m = (dvp["teams"].get(opp) or {}).get(p["pos"]) if opp else None
            upcoming.append({"week": w, "opp": opp, "home": o[1] if o else None, "proj": (pr or {}).get("pts"),
                             "opp_rank": m and m["rank"], "opp_avg": m and m["avg"]})
    return {"player": p, "career": career, "logs": logs, "values": values, "upcoming": upcoming,
            "value_fmt": value_fmt("dynasty", qb), "week": wi,
            "ros": round(sum(u["proj"] or 0 for u in upcoming), 1) if upcoming else None}


def sos(conn, scoring):
    wi = week_info(conn)
    dvp = defense_vs_pos(conn, wi["stats_season"], scoring)
    start = wi["upcoming"] or 19
    sched = {}
    weeks = []
    for g in conn.execute("SELECT week, home, away FROM schedule WHERE season=? AND week>=? ORDER BY week",
                          (wi["season"], start)):
        if g["week"] not in weeks:
            weeks.append(g["week"])
        sched.setdefault(g["home"], {})[g["week"]] = g["away"]
        sched.setdefault(g["away"], {})[g["week"]] = "@" + g["home"]
    return {"season": wi["stats_season"], "dvp": dvp, "weeks": weeks, "schedule": sched}


def _matchup_note(rank, n):
    if not rank:
        return None
    if rank <= 6:
        return "great"
    if rank <= 12:
        return "good"
    if rank > n - 6:
        return "tough"
    if rank > n - 12:
        return "below avg"
    return "neutral"


def start_sit(conn, ids, scoring, week=None):
    wi = week_info(conn)
    week = int(week or wi["upcoming"] or wi["week"] or 1)
    pm = player_map(conn)
    pr = proj_rows(conn, wi["season"], week, scoring)
    dvp = defense_vs_pos(conn, wi["stats_season"], scoring)
    summ = season_summaries(conn, wi["stats_season"], scoring)
    opps = opponents(conn, wi["season"])
    played = {d["player_id"]: d for d in season_rows(conn, wi["season"], scoring) if d["week"] == week}
    out = []
    for pid in ids:
        p = pm.get(pid)
        if not p:
            continue
        sm = summ.get(pid) or {}
        proj = pr.get(pid) or {}
        o = opps.get((week, p["team"]))
        opp = proj.get("opp") or (o[0] if o else None)
        m = (dvp["teams"].get(opp) or {}).get(p["pos"]) if opp else None
        base_proj = proj.get("pts")
        l3, ppg = sm.get("l3"), sm.get("ppg")
        parts = [(base_proj, 0.6), (l3, 0.25), (ppg, 0.15)]
        num = sum(v * w for v, w in parts if v is not None)
        den = sum(w for v, w in parts if v is not None)
        score = num / den if den else 0.0
        if m and dvp["avg"].get(p["pos"]):
            # projections already account for the opponent, so only nudge the recent-form part
            score *= 1 + 0.4 * (1 - (0.6 if base_proj is not None else 0)) * (m["diff"] / dvp["avg"][p["pos"]])
        inj = p.get("injury_status")
        score *= INJ_FACTOR.get(inj, 1.0)
        if not o:
            score = 0.0
        reasons = []
        if not o:
            reasons.append(f"Bye or no game in week {week}")
        if inj:
            reasons.append(f"Injury status: {inj}" + (f" ({p['injury_body_part']})" if p.get("injury_body_part") else ""))
        if base_proj is not None:
            reasons.append(f"Projected {base_proj:.1f} pts")
        if m:
            reasons.append(f"{opp} allows {m['avg']:.1f} to {p['pos']}s ({_ordinal(m['rank'])} most of {dvp['n']})")
        if l3 is not None and ppg is not None:
            trend = "up" if l3 > ppg * 1.1 else "down" if l3 < ppg * 0.9 else "steady"
            reasons.append(f"Last 3: {l3:.1f} ppg vs {ppg:.1f} season ({trend})")
        if sm.get("snap") is not None and p["pos"] in SKILL and p["pos"] != "QB":
            reasons.append(f"{sm['snap'] * 100:.0f}% snaps" + (f", {sm['tgt_share'] * 100:.0f}% target share"
                                                                if sm.get("tgt_share") else ""))
        g = played.get(pid)
        out.append({
            "id": pid, "name": p["full_name"], "pos": p["pos"], "team": p["team"], "inj": inj,
            "opp": opp, "home": o[1] if o else None, "proj": base_proj, "l3": l3, "ppg": ppg,
            "opp_rank": m and m["rank"], "matchup": _matchup_note(m and m["rank"], dvp["n"]),
            "score": round(score, 2), "reasons": reasons, "actual": g["pts"] if g and (g["gp"] or 0) > 0 else None,
        })
    out.sort(key=lambda x: -x["score"])
    return {"week": week, "season": wi["season"], "players": out}


def _ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def _enrich(conn, pid, vf, scoring, wi, extra=None):
    pm = player_map(conn)
    p = pm.get(pid) or {}
    sm = season_summaries(conn, wi["stats_season"], scoring).get(pid) or {}
    nxt = proj_rows(conn, wi["season"], wi["upcoming"], scoring).get(pid) if wi["upcoming"] else None
    ros = ros_proj(conn, wi["season"], wi["upcoming"], scoring).get(pid) if wi["upcoming"] else None
    v = values_map(conn, vf).get(pid) or {}
    return {"id": pid, "name": p.get("full_name") or v.get("name") or pid, "pos": p.get("pos") or v.get("pos"),
            "team": p.get("team"), "age": p.get("age"), "inj": p.get("injury_status"), "value": v.get("value"),
            "trend30": v.get("trend30"), "ppg": sm.get("ppg"), "l3": sm.get("l3"), "gp": sm.get("gp"),
            "snap": sm.get("snap"), "tgt_share": sm.get("tgt_share"), "rush_share": sm.get("rush_share"),
            "proj": nxt and nxt["pts"], "opp": nxt and nxt["opp"], "ros": ros, **(extra or {})}


def waivers(conn, scoring, fmt, qb, league_id=None):
    wi = week_info(conn)
    vf = value_fmt(fmt, qb)
    trend = {"add": [], "drop": []}
    for r in conn.execute("SELECT kind, player_id, count FROM trending ORDER BY count DESC"):
        trend[r["kind"]].append(_enrich(conn, r["player_id"], vf, scoring, wi, {"count": r["count"]}))
    available = None
    rostered = set()
    if league_id:
        for r in sleeper.rosters(conn, league_id):
            rostered |= set(r.get("players") or []) | set(r.get("taxi") or []) | set(r.get("reserve") or [])
        for k in trend:
            for t in trend[k]:
                t["rostered"] = t["id"] in rostered
        pm = player_map(conn)
        summ = season_summaries(conn, wi["stats_season"], scoring)
        ros = ros_proj(conn, wi["season"], wi["upcoming"], scoring) if wi["upcoming"] else {}
        vals = values_map(conn, vf)
        cands = []
        for pid, p in pm.items():
            if pid in rostered or p["pos"] not in FANTASY or not p["team"]:
                continue
            sm = summ.get(pid) or {}
            interest = (vals.get(pid) or {}).get("value") or 0
            if not interest and not sm and not ros.get(pid):
                continue
            cands.append((pid, (ros.get(pid) or 0) * 10 + interest * 0.05 + (sm.get("l3") or 0) * 5))
        cands.sort(key=lambda x: -x[1])
        base = replacement_levels(conn, league_id, ros, pm)
        available = []
        for pid, _ in cands[:150]:
            row = _enrich(conn, pid, vf, scoring, wi)
            b = base.get(row["pos"])
            row["vor"] = round((row["ros"] or 0) - b, 1) if b is not None and row["ros"] is not None else None
            available.append(row)
    return {"trending": trend, "available": available, "week": wi, "fmt": vf}


def replacement_levels(conn, league_id, ros, pm):
    """Rest-of-season points of the last starter at each position, given the league's size and lineup."""
    lg = sleeper.league(conn, league_id) or {}
    teams = lg.get("total_rosters") or 12
    rp = lg.get("roster_positions") or ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF"]
    slots = {p: rp.count(p) for p in FANTASY}
    share = {"FLEX": {"RB": 0.45, "WR": 0.45, "TE": 0.1}, "WRRB_FLEX": {"RB": 0.5, "WR": 0.5},
             "REC_FLEX": {"WR": 0.75, "TE": 0.25}, "SUPER_FLEX": {"QB": 0.85, "RB": 0.05, "WR": 0.07, "TE": 0.03}}
    for s, split in share.items():
        for p, f in split.items():
            slots[p] += rp.count(s) * f
    out = {}
    for pos in FANTASY:
        pts = sorted([v for pid, v in ros.items() if (pm.get(pid) or {}).get("pos") == pos], reverse=True)
        if pts:
            out[pos] = pts[min(len(pts) - 1, max(0, round(teams * slots[pos]) - 1))]
    return out


def dashboard(conn, scoring, fmt, qb):
    wi = week_info(conn)
    vf = value_fmt(fmt, qb)
    pm = player_map(conn)
    vals = values_map(conn, vf)
    # Last completed week's top scorers (fall back to last week of the previous season).
    season, week = wi["season"], wi["last_done"]
    if not week and wi["seasons"]:
        season = wi["seasons"][0] if wi["seasons"][0] != wi["season"] else (wi["seasons"][1:] or [season])[0]
        week = conn.execute("SELECT MAX(week) FROM stats WHERE season=?", (season,)).fetchone()[0] or 0
    rows = [d for d in season_rows(conn, season, scoring) if d["week"] == week and (d["gp"] or 0) > 0]
    top = {}
    for pos in SKILL:
        best = sorted([d for d in rows if d["pos"] == pos], key=lambda d: -d["pts"])[:6]
        top[pos] = [{"id": d["player_id"], "name": (pm.get(d["player_id"]) or {}).get("full_name") or d["player_id"],
                     "team": d["team"], "opp": d["opp"], "pts": d["pts"], "line": _stat_line(d)} for d in best]
    trend = {"add": [], "drop": []}
    for r in conn.execute("SELECT kind, player_id, count FROM trending ORDER BY count DESC"):
        if len(trend[r["kind"]]) < 10:
            trend[r["kind"]].append(_enrich(conn, r["player_id"], vf, scoring, wi, {"count": r["count"]}))
    movers = [v for v in vals.values() if v["pos"] != "PICK" and (v["value"] or 0) >= 1500 and v["trend30"] is not None]
    risers = sorted(movers, key=lambda v: -v["trend30"])[:8]
    fallers = sorted(movers, key=lambda v: v["trend30"])[:8]
    mv = lambda v: {"id": v["player_id"], "name": v["name"], "pos": v["pos"], "team": v["team"],
                    "value": v["value"], "trend30": v["trend30"]}
    inj = []
    for pid, p in pm.items():
        if p["injury_status"] and p["team"] and pid in vals and p["pos"] in SKILL:
            inj.append({"id": pid, "name": p["full_name"], "pos": p["pos"], "team": p["team"],
                        "status": p["injury_status"], "part": p["injury_body_part"], "value": vals[pid]["value"]})
    inj.sort(key=lambda x: -(x["value"] or 0))
    games = [dict(g) for g in conn.execute(
        "SELECT week, home, away, date, status FROM schedule WHERE season=? AND week=? ORDER BY date",
        (wi["season"], wi["upcoming"] or wi["week"]))]
    return {"week": wi, "top_week": {"season": season, "week": week, "players": top}, "trending": trend,
            "risers": [mv(v) for v in risers], "fallers": [mv(v) for v in fallers], "injuries": inj[:14],
            "games": games, "fmt": vf}


def _stat_line(d):
    parts = []
    if d.get("pass_att"):
        parts.append(f"{int(d['pass_cmp'] or 0)}/{int(d['pass_att'])}, {int(d['pass_yd'] or 0)} yds, "
                     f"{int(d['pass_td'] or 0)} TD" + (f", {int(d['pass_int'])} INT" if d.get("pass_int") else ""))
    if d.get("rush_att"):
        parts.append(f"{int(d['rush_att'])}-{int(d['rush_yd'] or 0)}" + (f", {int(d['rush_td'])} TD" if d.get("rush_td") else "")
                     + " rush")
    if d.get("rec_tgt"):
        parts.append(f"{int(d['rec'] or 0)}/{int(d['rec_tgt'])}-{int(d['rec_yd'] or 0)}"
                     + (f", {int(d['rec_td'])} TD" if d.get("rec_td") else "") + " rec")
    return " · ".join(parts)


# ---------------------------------------------------------------------- leagues
SLOT_ELIGIBLE = {
    "QB": {"QB"}, "RB": {"RB"}, "WR": {"WR"}, "TE": {"TE"}, "K": {"K"}, "DEF": {"DEF"},
    "FLEX": {"RB", "WR", "TE"}, "WRRB_FLEX": {"RB", "WR"}, "REC_FLEX": {"WR", "TE"},
    "SUPER_FLEX": {"QB", "RB", "WR", "TE"},
}
SLOT_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "REC_FLEX", "WRRB_FLEX", "FLEX", "SUPER_FLEX"]


def best_lineup(players, slots, key):
    """Greedy optimal lineup: fill the strictest slots first with the highest `key` value."""
    pool = sorted([p for p in players if (p.get(key) or 0) > 0], key=lambda p: -(p.get(key) or 0))
    used, lineup = set(), []
    for slot in sorted([s for s in slots if s in SLOT_ELIGIBLE], key=SLOT_ORDER.index):
        pick = next((p for p in pool if p["id"] not in used and p["pos"] in SLOT_ELIGIBLE[slot]), None)
        if pick:
            used.add(pick["id"])
            lineup.append((slot, pick))
    return lineup


def user_leagues(conn, username, season=None):
    u = sleeper.user(conn, username)
    if not u:
        return None
    wi = week_info(conn)
    season = season or wi["season"]
    lgs = sleeper.leagues(conn, u["user_id"], season)
    if not lgs:
        season -= 1
        lgs = sleeper.leagues(conn, u["user_id"], season)
    out = []
    for lg in lgs:
        rp = lg.get("roster_positions") or []
        typ = (lg.get("settings") or {}).get("type", 0)
        out.append({"id": lg["league_id"], "name": lg.get("name"), "avatar": lg.get("avatar"),
                    "teams": lg.get("total_rosters"), "status": lg.get("status"), "season": lg.get("season"),
                    "type": {2: "dynasty", 1: "keeper"}.get(typ, "redraft"),
                    "sf": "SUPER_FLEX" in rp or rp.count("QB") > 1,
                    "ppr": (lg.get("scoring_settings") or {}).get("rec", 0),
                    "te_prem": (lg.get("scoring_settings") or {}).get("bonus_rec_te", 0)})
    return {"user": {"id": u["user_id"], "name": u.get("display_name"), "avatar": u.get("avatar")},
            "season": season, "leagues": out}


def league_detail(conn, league_id, fmt=None, scoring=None):
    lg = sleeper.league(conn, league_id)
    if not lg:
        return None
    rp = lg.get("roster_positions") or []
    settings = lg.get("settings") or {}
    sf = "SUPER_FLEX" in rp or rp.count("QB") > 1
    qb = 2 if sf else 1
    dynasty = settings.get("type") in (1, 2)
    fmt = fmt or ("dynasty" if dynasty else "redraft")
    scoring = scoring or f"league:{league_id}"
    wi = week_info(conn)
    dyn, red = values_map(conn, value_fmt("dynasty", qb)), values_map(conn, value_fmt("redraft", qb))
    pm = player_map(conn)
    summ = season_summaries(conn, wi["stats_season"], scoring)
    week = wi["upcoming"] or wi["week"]
    proj = proj_rows(conn, wi["season"], week, scoring) if week else {}
    ros = ros_proj(conn, wi["season"], wi["upcoming"], scoring) if wi["upcoming"] else {}
    users = {u["user_id"]: u for u in sleeper.users(conn, league_id)}
    rosters = sleeper.rosters(conn, league_id)
    starters_slots = [s for s in rp if s not in ("BN", "TAXI", "IR")]

    # Draft picks (own picks, adjusted for trades).
    first = int(lg.get("season")) + (0 if lg.get("status") in ("pre_draft", "drafting") else 1)
    pick_seasons = [first, first + 1, first + 2]
    rounds = int(settings.get("draft_rounds") or 4)
    owner = {(s, rd, r["roster_id"]): r["roster_id"] for s in pick_seasons for rd in range(1, rounds + 1) for r in rosters}
    for tp in sleeper.traded_picks(conn, league_id):
        k = (int(tp["season"]), int(tp["round"]), tp["roster_id"])
        if k in owner:
            owner[k] = tp["owner_id"]
    years_avail = sorted({int(k.split("_")[1]) for k in dyn if k.startswith("FP_") and k.count("_") == 2})

    def pick_value(season, rd):
        for y in [season] + sorted(years_avail, reverse=True):
            v = dyn.get(f"FP_{y}_{rd}")
            if v:
                return v["value"]
        return 0

    teams = []
    for r in rosters:
        u = users.get(r.get("owner_id")) or {}
        rs = r.get("settings") or {}
        ids = list(dict.fromkeys((r.get("players") or [])))
        taxi, reserve = set(r.get("taxi") or []), set(r.get("reserve") or [])
        players = []
        for pid in ids:
            p = pm.get(pid) or {}
            sm = summ.get(pid) or {}
            players.append({"id": pid, "name": p.get("full_name") or pid, "pos": p.get("pos"), "team": p.get("team"),
                            "age": p.get("age"), "inj": p.get("injury_status"), "yoe": p.get("years_exp"),
                            "dyn": (dyn.get(pid) or {}).get("value") or 0, "red": (red.get(pid) or {}).get("value") or 0,
                            "ppg": sm.get("ppg"), "proj": (proj.get(pid) or {}).get("pts"), "ros": ros.get(pid),
                            "slot": "TAXI" if pid in taxi else "IR" if pid in reserve else
                            ("ST" if pid in (r.get("starters") or []) else "BN")})
        picks = [{"season": s, "round": rd, "from": orig, "value": pick_value(s, rd)}
                 for (s, rd, orig), own in owner.items() if own == r["roster_id"]]
        picks.sort(key=lambda x: (x["season"], x["round"]))
        vkey = "dyn" if fmt == "dynasty" else "red"
        lineup_val = best_lineup(players, starters_slots, "red")
        lineup_proj = best_lineup(players, starters_slots, "proj")
        core = [p for p in players if p["pos"] in SKILL and p["dyn"] and p["age"]]
        wage = _div(sum(p["age"] * p["dyn"] for p in core), sum(p["dyn"] for p in core))
        pos_val = {pos: sum(p[vkey] for p in players if p["pos"] == pos) for pos in SKILL}
        teams.append({
            "roster_id": r["roster_id"], "owner_id": r.get("owner_id"),
            "owner": u.get("display_name") or f"Team {r['roster_id']}",
            "team_name": (u.get("metadata") or {}).get("team_name") or u.get("display_name") or f"Team {r['roster_id']}",
            "avatar": u.get("avatar"), "co_owners": r.get("co_owners") or [],
            "wins": rs.get("wins", 0), "losses": rs.get("losses", 0), "ties": rs.get("ties", 0),
            "pf": round(rs.get("fpts", 0) + rs.get("fpts_decimal", 0) / 100, 2),
            "pa": round(rs.get("fpts_against", 0) + rs.get("fpts_against_decimal", 0) / 100, 2),
            "players": players, "picks": picks,
            "total": sum(p[vkey] for p in players) + (sum(pk["value"] for pk in picks) if fmt == "dynasty" else 0),
            "pick_value": sum(pk["value"] for pk in picks),
            "starter_value": sum(p["red"] for _, p in lineup_val),
            "proj_week": round(sum(p["proj"] for _, p in lineup_proj), 1),
            "ros": round(sum(p["ros"] or 0 for _, p in best_lineup(players, starters_slots, "ros")), 1),
            "lineup": [[s, p["id"]] for s, p in lineup_proj],
            "wage": _r(wage, 1), "pos_value": pos_val,
        })
    n = len(teams)
    for key in ("total", "starter_value", "proj_week", "ros", "pf"):
        for i, t in enumerate(sorted(teams, key=lambda t: -t[key])):
            t.setdefault("ranks", {})[key] = i + 1
    for pos in SKILL:
        for i, t in enumerate(sorted(teams, key=lambda t: -t["pos_value"][pos])):
            t["ranks"][pos] = i + 1
    for t in teams:
        sr = t["ranks"]["starter_value"]
        t["window"] = "Contender" if sr <= max(1, round(n / 3)) else "Rebuilding" if sr > n - round(n / 3) else "Middle"
        # Power score: blend of current lineup strength and long-term asset value.
        t["power"] = round(100 * (0.5 * (n - sr) / max(1, n - 1)
                                  + 0.3 * (n - t["ranks"]["total"]) / max(1, n - 1)
                                  + 0.2 * (n - t["ranks"]["pf"]) / max(1, n - 1)), 1)
    teams.sort(key=lambda t: -t["power"])

    match = []
    if week and lg.get("season") == str(wi["season"]):
        by_mid = {}
        for m in sleeper.matchups(conn, league_id, week):
            if m.get("matchup_id"):
                by_mid.setdefault(m["matchup_id"], []).append(m)
        for mid, pair in sorted(by_mid.items()):
            side = []
            for m in pair:
                st = [s for s in (m.get("starters") or []) if s and s != "0"]
                side.append({"roster_id": m["roster_id"], "points": m.get("points") or 0,
                             "proj": round(sum((proj.get(s) or {}).get("pts", 0) for s in st), 1), "starters": st})
            match.append({"id": mid, "sides": side})
    return {"league": {"id": league_id, "name": lg.get("name"), "season": lg.get("season"), "status": lg.get("status"),
                       "teams": n, "sf": sf, "dynasty": dynasty, "fmt": fmt, "roster_positions": rp,
                       "scoring": scoring, "ppr": (lg.get("scoring_settings") or {}).get("rec", 0),
                       "te_prem": (lg.get("scoring_settings") or {}).get("bonus_rec_te", 0),
                       "pass_td": (lg.get("scoring_settings") or {}).get("pass_td", 4)},
            "teams": teams, "matchups": match, "week": week, "qb": qb}


def portfolio(conn, username):
    ul = user_leagues(conn, username)
    if not ul:
        return None
    uid = ul["user"]["id"]
    pm = player_map(conn)
    exposure = {}
    for lg in ul["leagues"]:
        vf = value_fmt("dynasty" if lg["type"] != "redraft" else "redraft", 2 if lg["sf"] else 1)
        vals = values_map(conn, vf)
        for r in sleeper.rosters(conn, lg["id"]):
            if r.get("owner_id") != uid and uid not in (r.get("co_owners") or []):
                continue
            for pid in r.get("players") or []:
                e = exposure.setdefault(pid, {"id": pid, "leagues": [], "value": 0})
                e["leagues"].append(lg["name"])
                e["value"] += (vals.get(pid) or {}).get("value") or 0
    rows = []
    for pid, e in exposure.items():
        p = pm.get(pid) or {}
        rows.append(e | {"name": p.get("full_name") or pid, "pos": p.get("pos"), "team": p.get("team"),
                         "age": p.get("age"), "inj": p.get("injury_status"), "count": len(e["leagues"]),
                         "share": round(len(e["leagues"]) / max(1, len(ul["leagues"])), 3)})
    rows.sort(key=lambda r: (-r["count"], -r["value"]))
    return {"user": ul["user"], "leagues": len(ul["leagues"]), "rows": rows}


# ---------------------------------------------------------------------- SQL console
def run_sql(path, query, limit=2000):
    q = query.strip().rstrip(";").strip()
    first = q.split(None, 1)[0].lower() if q else ""
    if first not in ("select", "with", "pragma", "explain"):
        raise ValueError("Only read-only queries (SELECT / WITH / PRAGMA) are allowed.")
    conn = db.connect(path, readonly=True)
    started = time.time()
    conn.set_progress_handler(lambda: 1 if time.time() - started > 8 else 0, 10000)
    try:
        cur = conn.execute(q)
        cols = [c[0] for c in cur.description or []]
        rows = cur.fetchmany(limit + 1)
        return {"columns": cols, "rows": [list(r) for r in rows[:limit]], "truncated": len(rows) > limit,
                "ms": round((time.time() - started) * 1000, 1)}
    finally:
        conn.close()


def schema(conn):
    out = []
    for t in conn.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') "
                          "AND name NOT IN ('http_cache','meta') ORDER BY type, name"):
        cols = [c["name"] for c in conn.execute(f"PRAGMA table_info({t['name']})")]
        out.append({"name": t["name"], "type": t["type"], "columns": cols})
    return out
