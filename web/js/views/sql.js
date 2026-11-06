import * as L from "../lib.js";

const EXAMPLES = [
  ["QB EPA per dropback (RBSDM style)", `SELECT p.full_name, p.team, SUM(a.dropbacks) AS dropbacks,
       ROUND(SUM(a.pass_epa) / SUM(a.dropbacks), 3) AS epa_per_db,
       ROUND(1.0 * SUM(a.pass_success) / SUM(a.dropbacks), 3) AS success_rate,
       ROUND(SUM(a.cpoe_sum) / SUM(a.cpoe_n), 1) AS cpoe,
       ROUND(1.0 * SUM(a.pressured) / SUM(a.dropbacks), 3) AS pressure_rate
FROM adv_week a JOIN players p USING (player_id)
WHERE a.season = (SELECT MAX(season) FROM adv_week)
GROUP BY a.player_id HAVING SUM(a.dropbacks) >= 100 ORDER BY epa_per_db DESC`],
  ["End-zone and red-zone targets", `SELECT p.full_name, p.pos, p.team, SUM(a.ez_targets) AS end_zone_tgt, SUM(a.rz_targets) AS rz_tgt,
       SUM(a.targets) AS targets, ROUND(SUM(a.rec_epa) / SUM(a.targets), 3) AS epa_per_tgt
FROM adv_week a JOIN players p USING (player_id)
WHERE a.season = (SELECT MAX(season) FROM adv_week) AND p.pos IN ('WR','TE','RB')
GROUP BY a.player_id ORDER BY end_zone_tgt DESC, rz_tgt DESC LIMIT 30`],
  ["Team offense EPA/play by week", `SELECT team, week, plays, ROUND(epa / plays, 3) AS epa_per_play,
       ROUND(1.0 * success / plays, 3) AS success_rate, ROUND(pass_oe_sum / xpass_n, 1) AS proe
FROM team_adv_week WHERE side = 'off' AND season = (SELECT MAX(season) FROM team_adv_week)
ORDER BY week DESC, epa_per_play DESC`],
  ["Next Gen Stats: separation leaders", `SELECT p.full_name, p.team, json_extract(n.data, '$.sep') AS separation,
       json_extract(n.data, '$.yacoe') AS yac_over_expected, json_extract(n.data, '$.cushion') AS cushion
FROM ngs_season n JOIN players p USING (player_id)
WHERE n.kind = 'receiving' AND n.season = (SELECT MAX(season) FROM ngs_season)
ORDER BY separation DESC LIMIT 25`],
  ["Target share leaders, last 4 weeks", `WITH recent AS (SELECT MAX(week) - 3 AS w FROM stats WHERE season = (SELECT MAX(season) FROM stats))
SELECT p.full_name, s.team, SUM(s.rec_tgt) AS targets, ROUND(1.0 * SUM(s.rec_tgt) / SUM(t.tm_tgt), 3) AS tgt_share,
       ROUND(AVG(s.pts_ppr), 1) AS ppr_ppg
FROM stats s JOIN team_week t USING (season, week, team) JOIN players p USING (player_id)
WHERE s.season = (SELECT MAX(season) FROM stats) AND s.week >= (SELECT w FROM recent) AND s.pos IN ('WR','TE','RB')
GROUP BY s.player_id HAVING COUNT(*) >= 3 ORDER BY tgt_share DESC LIMIT 30`],
  ["RBs on 65%+ of snaps", `SELECT p.full_name, s.team, COUNT(*) AS games,
       ROUND(AVG(1.0 * s.off_snp / s.tm_off_snp), 3) AS snap_pct, ROUND(AVG(s.pts_half), 1) AS half_ppg
FROM stats s JOIN players p USING (player_id)
WHERE s.season = (SELECT MAX(season) FROM stats) AND s.pos = 'RB' AND s.tm_off_snp > 0
GROUP BY s.player_id HAVING snap_pct >= 0.65 ORDER BY snap_pct DESC`],
  ["Red-zone looks vs touchdowns", `SELECT p.full_name, s.pos, SUM(COALESCE(s.rec_rz_tgt,0) + COALESCE(s.rush_rz_att,0)) AS rz_opps,
       SUM(COALESCE(s.rec_td,0) + COALESCE(s.rush_td,0)) AS tds
FROM stats s JOIN players p USING (player_id)
WHERE s.season = (SELECT MAX(season) FROM stats) AND s.pos IN ('RB','WR','TE')
GROUP BY s.player_id ORDER BY rz_opps DESC LIMIT 30`],
  ["Biggest single games this season", `SELECT p.full_name, s.pos, s.week, s.team, s.opp, s.pts_ppr
FROM stats s JOIN players p USING (player_id)
WHERE s.season = (SELECT MAX(season) FROM stats) ORDER BY s.pts_ppr DESC LIMIT 25`],
  ["Young players by dynasty value", `SELECT v.name, v.pos, v.team, v.age, v.value, v.trend30
FROM player_values v WHERE v.fmt = 'dynasty_1qb' AND v.age < 24 AND v.pos != 'PICK'
ORDER BY v.value DESC LIMIT 40`],
  ["Year-over-year PPG change", `WITH y AS (SELECT player_id, season, AVG(pts_ppr) AS ppg, COUNT(*) AS g FROM stats WHERE gp > 0 GROUP BY player_id, season)
SELECT p.full_name, p.pos, ROUND(prev.ppg, 1) AS last_year, ROUND(cur.ppg, 1) AS this_year, ROUND(cur.ppg - prev.ppg, 1) AS change
FROM y cur JOIN y prev ON prev.player_id = cur.player_id AND prev.season = cur.season - 1 JOIN players p ON p.player_id = cur.player_id
WHERE cur.season = (SELECT MAX(season) FROM stats) AND cur.g >= 4 AND prev.g >= 8 AND p.pos IN ('QB','RB','WR','TE')
ORDER BY change DESC LIMIT 30`],
];

let query = EXAMPLES[0][1];

export async function render(root) {
  const schema = await L.api("schema");
  root.innerHTML = `
    ${L.pageHead("SQL Console", "Query the raw database directly. Read-only: SELECT and WITH only. Box scores are in <b>stats</b> (one row per player per week, with the full Sleeper stat line in <b>raw</b> as JSON).")}
    <div class="grid g3">
      <section class="card span2" style="display:grid;gap:10px">
        <div class="chips">${EXAMPLES.map(([l], i) => `<button class="chip" data-ex="${i}">${L.esc(l)}</button>`).join("")}</div>
        <textarea class="sql" id="q" spellcheck="false" aria-label="SQL query">${L.esc(query)}</textarea>
        <div class="toolbar"><button class="btn primary" id="run">Run query</button><span class="small muted">Ctrl/⌘ + Enter</span><span class="grow"></span><span class="small muted" id="meta"></span><button class="btn sm" id="csv" disabled>Export CSV</button></div>
        <div id="res"></div>
      </section>
      <section class="card"><div class="card-head"><h2>Tables</h2><span class="sub">click to insert</span></div>
        <div class="schema-list">${schema.map((t) => `<div><b data-ins="${t.name}">${t.name}</b> <span>${t.type === "view" ? "view · " : ""}${t.columns.join(", ")}</span></div>`).join("")}</div>
        <p class="small muted" style="margin-top:12px">Tip: <code>json_extract(raw, '$.rec_yd')</code> pulls any stat Sleeper tracks (first downs, yards after catch, rush yards by quarter, and more).</p></section>
    </div>`;
  const ta = root.querySelector("#q");
  let last = null;
  const run = async () => {
    query = ta.value;
    const res = root.querySelector("#res");
    res.innerHTML = L.loading("Running");
    try {
      const r = await L.api("sql", {}, { query });
      last = r;
      root.querySelector("#meta").textContent = `${r.rows.length}${r.truncated ? "+" : ""} rows · ${r.ms} ms`;
      root.querySelector("#csv").disabled = false;
      const rows = r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
      L.dataTable(res, {
        rows, page: 100,
        columns: r.columns.map((c) => ({ key: c, label: L.esc(c), num: rows.some((x) => typeof x[c] === "number"),
          fmt: (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")) : L.esc(v ?? "NULL")) })),
      });
    } catch (e) { res.innerHTML = L.errorBox(e); }
  };
  root.querySelector("#run").onclick = run;
  ta.onkeydown = (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } };
  root.querySelectorAll("[data-ex]").forEach((b) => (b.onclick = () => { ta.value = EXAMPLES[+b.dataset.ex][1]; run(); }));
  root.querySelectorAll("[data-ins]").forEach((b) => (b.onclick = () => { ta.setRangeText(b.dataset.ins, ta.selectionStart, ta.selectionEnd, "end"); ta.focus(); }));
  root.querySelector("#csv").onclick = () => last && L.downloadCSV("huddle-query.csv", last.columns, last.rows.map((row) => Object.fromEntries(last.columns.map((c, i) => [c, row[i]]))));
  run();
}
