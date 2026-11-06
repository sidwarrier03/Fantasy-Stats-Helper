# Huddle

A fantasy football stats database you run on your own computer. It downloads player stats, projections, injuries and trade values, keeps them up to date by itself, and gives you a browser app with tools for both **dynasty** and **redraft** leagues.

No accounts, no API keys, no installs. You only need Python 3.9 or newer.

## Start it

### Windows: one click

1. On GitHub, click **Code > Download ZIP**. Right-click the ZIP and choose **Extract All**. Keep the folder somewhere permanent, like Documents, because the desktop icon points to it.
2. Double-click **Start Huddle.bat**. If Windows says "Windows protected your PC", click **More info > Run anyway**. You only have to do this once.
   - If Python isn't installed, the launcher installs it for you. This takes a minute or two and doesn't need admin rights.
   - Huddle opens in your browser, and a **Huddle** icon appears on your desktop.
3. From then on, just double-click the **Huddle** icon on your desktop.

Huddle runs quietly in the background, with no window, and keeps itself updated. Clicking the icon while it's already running just opens it in your browser again. To stop it, click **Quit Huddle** at the bottom of the sidebar.

**Updating from a ZIP download:** click **Quit Huddle** in the sidebar, download the new ZIP, and copy everything inside it into your Huddle folder, replacing the old files. Your data folder isn't touched. Windows may ask "Windows protected your PC" once more for the new launcher: click **More info > Run anyway**. The first start after an update takes a minute or two while Huddle imports any new stats.

**If Huddle won't open on Windows:** double-click **Troubleshoot Huddle.bat** in the Huddle folder. It runs Huddle in a visible window, so any error message stays on screen. Huddle also writes what it's doing to `data\huddle.log`.

### Mac / Linux

Double-click `start-mac-linux.sh`, or run:

```bash
python3 huddle.py
```

Your browser opens at <http://localhost:8765>. Leave the terminal window open while you use Huddle. Stop it with **Quit Huddle** in the sidebar, or Ctrl+C in the terminal.

The first start builds the database (about 30 seconds). After that it opens instantly, and while it's running it updates itself every 2 hours.

## What updates, and when

| Data | Source | Refreshed |
|---|---|---|
| Weekly box scores (2 past seasons + this one) | Sleeper | Hourly while a week's games are being played; a finished week is locked in 4 days after its last game, once stat corrections are done |
| Projections for every remaining week | Sleeper | This week and next: hourly. Later weeks: daily |
| Players, teams, injuries, depth charts | Sleeper | Every 12 hours |
| Dynasty and redraft trade values (1QB and Superflex) | FantasyCalc | Every 6 hours, with a daily snapshot saved for value history |
| Trending adds and drops | Sleeper | Hourly |
| NFL schedule | Sleeper | Every 12 hours |
| Advanced play-by-play metrics: EPA, success rate, CPOE, air yards, red-zone and end-zone looks, team efficiency | nflverse play-by-play (the nflfastR data RBSDM and NFL Savant are built on) | Every 12 hours for the current season; past seasons once |
| Pressures, blitzes, bad throws, drops, broken tackles, yards before/after contact | Pro-Football-Reference, via nflverse's weekly mirror | Every 12 hours |
| Separation, YAC over expected, rush yards over expected, time to throw, aggressiveness | NFL Next Gen Stats, via nflverse | Every 12 hours |

The **Update now** button in the sidebar runs a check right away.

To keep the database fresh even when the app is closed, schedule the headless updater, e.g. on Mac/Linux with `crontab -e`:

```bash
0 */3 * * * cd /path/to/huddle && python3 huddle.py update
```

## The tools

- **Dashboard**: the week at a glance. Top scorers from the last finished week, this week's games, the most added and dropped players, 30-day value risers and fallers, and an injury report.
- **Stats Database**: every player's season in one sortable, searchable table, with views for:
  - **Fantasy** and **Usage** (snap %, target share, air-yard share, WOPR)
  - **Passing**: EPA per dropback, success rate, CPOE, aDOT, deep %, time to throw, aggressiveness, pressure %, sack %, bad-throw %
  - **Rushing**: EPA per run, success rate, rush yards over expected, yards after contact, broken tackles, 10+ yard runs, 8-man boxes
  - **Receiving**: EPA per target, success rate, WOPR, RACR, YAC over expected, separation, drop %, passer rating when targeted
  - **Red zone**: red-zone and end-zone targets, red-zone and inside-5 carries
  - **Efficiency**: total EPA across passing, rushing and receiving

  Filter by position, team and a minimum volume (dropbacks, carries, targets), then stack your own filters on any stat (for example "EPA/target at least 0.3" and "Drop % at most 5"). Hover a column name for what it measures and where it comes from. CSV export includes every column.
- **Team Tiers**: offense vs defense EPA per play on one chart (the RBSDM / SumerSports-style tier chart), plus pass and rush EPA, success rates and pass rate over expected for every team, for the full season or the last 4 or 8 weeks.
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
python3 huddle.py --background       run without a console window (logs to data/huddle.log)
python3 huddle.py update --full      re-download everything once and exit
```

## Where things live

- `data/huddle.db`: the SQLite database. Open it with any SQLite tool, or use the SQL Console. Delete it to start fresh.
- `data/huddle.log`: what Huddle did while running in the background, useful if something goes wrong.
- `Start Huddle.bat` and `start-mac-linux.sh`: the launchers.
- `core/`: the Python backend (`updater.py` syncs data, `queries.py` powers each page, `server.py` serves the app).
- `web/`: the browser app (plain HTML, CSS and JavaScript, no build step).

## Data sources

- **Sleeper**: players, injuries, weekly box scores, fantasy points, projections, trending players, and your leagues.
- **FantasyCalc**: dynasty and redraft trade values.
- **nflverse** (open NFL data, CC BY 4.0): play-by-play with the nflfastR expected-points model, Pro-Football-Reference advanced stats and NFL Next Gen Stats. RBSDM.com and NFL Savant are built on this same play-by-play, so EPA and success rates line up with those sites. Pro-Football-Reference blocks automated downloads, so Huddle uses nflverse's weekly copy of PFR's advanced stats instead of PFR directly. SumerSports' terms don't allow automated access, so Huddle computes its own team tiers from the same play-by-play instead.

Huddle only reads public data and never posts anything to your leagues.
