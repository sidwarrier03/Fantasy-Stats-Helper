# Huddle

A fantasy football stats database you run on your own computer. It downloads player stats, projections, injuries and trade values, keeps them up to date by itself, and gives you a browser app with tools for both **dynasty** and **redraft** leagues.

No accounts, no API keys, no installs. You only need Python 3.9 or newer.

## Start it

**Mac / Linux:** double-click `start-mac-linux.sh`, or run:

```bash
python3 huddle.py
```

**Windows:** double-click `start-windows.bat`.

Your browser opens at <http://localhost:8765>. The first start builds the database (about 30 seconds). After that it opens instantly.

Leave it running and it updates itself every 2 hours. Close it with Ctrl+C.

## What updates, and when

| Data | Source | Refreshed |
|---|---|---|
| Weekly box scores (2 past seasons + this one) | Sleeper | Hourly while a week's games are being played; a finished week is locked in 4 days after its last game, once stat corrections are done |
| Projections for every remaining week | Sleeper | This week and next: hourly. Later weeks: daily |
| Players, teams, injuries, depth charts | Sleeper | Every 12 hours |
| Dynasty and redraft trade values (1QB and Superflex) | FantasyCalc | Every 6 hours, with a daily snapshot saved for value history |
| Trending adds and drops | Sleeper | Hourly |
| NFL schedule | Sleeper | Every 12 hours |

The **Update now** button in the sidebar runs a check right away.

To keep the database fresh even when the app is closed, schedule the headless updater, e.g. on Mac/Linux with `crontab -e`:

```bash
0 */3 * * * cd /path/to/huddle && python3 huddle.py update
```

## The tools

- **Dashboard**: the week at a glance. Top scorers from the last finished week, this week's games, the most added and dropped players, 30-day value risers and fallers, and an injury report.
- **Stats Database**: every player's season in one sortable table, with views for fantasy, usage (snap %, target share, air-yard share, rush share, aDOT, red-zone looks), passing, rushing and receiving. Weekly sparklines, Top-12/Top-24 hit rates, consistency, and CSV export.
- **Player pages**: weekly points chart colored by positional finish, snap-share and target-share trends, game logs, career table, all four trade values with history, and the upcoming schedule with matchup difficulty and projections.
- **Rankings**: dynasty or redraft, 1QB or Superflex, with tiers, 30-day trends, rookies-only and draft-pick filters, and a Buy/Sell signal that compares market price with actual production.
- **Compare Players**: up to four players side by side, with an overlaid weekly points chart.
- **Strength of Schedule**: fantasy points each defense allows to every position, and a heatmap of every team's remaining schedule (next 4 weeks, fantasy playoffs, or rest of season).
- **Trade Calculator**: values for your format, a consolidation premium so 2-for-1 deals are judged fairly, a fairness verdict, and suggestions for what to add to even it out.
- **Start / Sit**: two modes.
  - **My Sleeper team** imports your roster from any connected league, scores every player with that league's exact scoring, and builds the best lineup for your league's actual slots (FLEX, Superflex, etc.). It compares that lineup with the one you have set in Sleeper and tells you exactly which swaps to make. Players whose game has already kicked off are locked in place, and you can switch to any other team in the league to scout an opponent.
  - **Compare players** ranks any players you pick head to head.

  Both blend this week's projection, recent form, matchup and injury status into a "Huddle score", with the reasons shown for every player.
- **Waiver Wire**: trending adds and drops; pick one of your leagues to see the best players actually available there, ranked by rest-of-season points over the last starter at each position.
- **My Leagues** (Sleeper): enter your username to get, for each league, power rankings with a contend/rebuild window, rosters with values and draft picks (trades included), weekly matchups with win odds, and a trade finder that builds offers from your roster that fit the other team's needs.
- **Portfolio**: your exposure to every player across all your leagues.
- **SQL Console**: query the raw database directly, with example queries and CSV export.

**Scoring:** the menu in the top bar switches every number on the site between PPR, Half PPR and Standard. Once you connect Sleeper, your leagues appear there too, and Huddle re-scores every box score with that league's exact settings (TE premium, 6-point passing TDs, bonuses, and so on).

## Options

```text
python3 huddle.py --port 9000        use a different port
python3 huddle.py --every 1          auto-update every hour
python3 huddle.py --history 4        keep 4 past seasons of stats
python3 huddle.py --no-browser       don't open a browser tab
python3 huddle.py update --full      re-download everything once and exit
```

## Where things live

- `data/huddle.db`: the SQLite database. Open it with any SQLite tool, or use the SQL Console. Delete it to start fresh.
- `core/`: the Python backend (`updater.py` syncs data, `queries.py` powers each page, `server.py` serves the app).
- `web/`: the browser app (plain HTML, CSS and JavaScript, no build step).

Data comes from Sleeper's and FantasyCalc's free public APIs. Huddle only reads public data and never posts anything to your leagues.
