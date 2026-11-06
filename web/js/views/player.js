import * as L from "../lib.js";

let season = null;

export async function render(root, [id]) {
  const d = await L.api("player", { id });
  const p = d.player;
  const seasons = Object.keys(d.logs).map(Number).sort((a, b) => b - a);
  if (!seasons.includes(season)) season = seasons[0];
  const career = d.career;
  const fmtNames = { dynasty_1qb: "Dynasty 1QB", dynasty_sf: "Dynasty SF", redraft_1qb: "Redraft 1QB", redraft_sf: "Redraft SF" };
  const active = L.valueKey();
  const hist = d.values[active]?.history || [];
  const ht = p.height ? `${Math.floor(p.height / 12)}'${p.height % 12}"` : null;
  const bio = [p.age && `${L.n(p.age)} yrs`, ht, p.weight && `${p.weight} lb`, p.college,
    p.years_exp != null && (p.years_exp === 0 ? "Rookie" : `${p.years_exp} yrs exp`)].filter(Boolean).join(" · ");
  const cur = career.find((c) => c.season === seasons[0]);

  root.innerHTML = `
    <section class="hero">
      <div class="pcell" style="gap:18px">${L.avatar(p.player_id, p.full_name, "lg")}
        <div><div class="eyebrow">${L.posTag(p.pos)} ${L.esc(p.team || "Free agent")} ${p.number ? `#${p.number}` : ""} ${p.depth_chart_order ? `· depth ${p.pos}${p.depth_chart_order}` : ""}</div>
          <div class="big">${L.esc(p.full_name)}</div>
          <div class="muted">${L.esc(bio)}</div>
          ${p.injury_status ? `<div style="margin-top:6px">${L.injTag(p.injury_status)} <span class="small">${L.esc(p.injury_status)}${p.injury_body_part ? ` · ${L.esc(p.injury_body_part)}` : ""}</span></div>` : ""}
        </div></div>
      <div class="toolbar">
        <a class="btn" href="#compare/${p.player_id}">Compare</a>
        <a class="btn primary" href="#trade/${p.player_id}">Add to trade</a>
      </div>
    </section>

    <div class="grid g4">
      ${Object.entries(fmtNames).map(([k, label]) => {
        const v = d.values[k] || {};
        return `<div class="stat-tile" style="${k === active ? "outline:1px solid var(--accent)" : ""}">
          <span class="l">${label}</span><span class="v">${v.value ? L.int(v.value) : "–"}</span>
          <span class="small muted">${v.overall_rank ? `#${v.overall_rank} overall · ${p.pos}${v.pos_rank}` : "Unranked"}
          ${v.trend30 != null ? ` · <span class="${L.trendCls(v.trend30)}">${L.signed(v.trend30)}</span> 30d` : ""}</span></div>`;
      }).join("")}
    </div>

    <div class="grid g3">
      <section class="card span2">
        <div class="card-head"><h2>Fantasy points by week</h2>
          <div class="toolbar">${seasons.length > 1 ? L.seg("season", seasons.map((s) => [s, s]), season) : `<span class="sub">${season ?? ""}</span>`}</div></div>
        <div id="weekly"></div>
        <div class="legend" style="margin-top:8px"><span><i style="background:var(--good)"></i>Top-12 week</span><span><i style="background:var(--accent)"></i>Top-24</span><span><i style="background:var(--surface-3)"></i>Outside top 24</span></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>${seasons[0] ?? ""} at a glance</h2><span class="sub">${L.esc(L.scoringLabel())}</span></div>
        ${cur ? `<div class="grid g2" style="gap:10px">
          ${tile("PPG", L.n(cur.ppg), `${p.pos}${cur.ppg_rank ?? "–"} by PPG`)}
          ${tile("Total", L.n(cur.pts), `${p.pos}${cur.pos_rank} overall`)}
          ${tile("Top-12 weeks", L.pct(cur.top12), `${cur.gp} games`)}
          ${tile("Last 3", L.n(cur.l3), "points per game")}
          ${p.pos === "QB" ? tile("Pass yds/G", L.n(cur.pass_yd / cur.gp, 0), `${cur.pass_td} TD · ${cur.pass_int} INT`)
            : tile("Snap share", L.pct(cur.snap), "of offensive snaps")}
          ${p.pos === "QB" ? tile("Rush yds/G", L.n(cur.rush_yd / cur.gp, 0), `${cur.rush_td} rush TD`)
            : p.pos === "RB" ? tile("Rush share", L.pct(cur.rush_share), `${L.n(cur.ypc)} YPC`)
            : tile("Target share", L.pct(cur.tgt_share, 1), `${L.n(cur.adot)} aDOT`)}
        </div>` : `<div class="muted">No games this season.</div>`}
        ${d.ros != null ? `<p class="small muted" style="margin:12px 0 0">Rest-of-season projection: <b class="num" style="color:var(--text)">${L.n(d.ros)}</b> pts</p>` : ""}
      </section>
    </div>

    <div class="grid g2">
      <section class="card">
        <div class="card-head"><h2>Usage by week</h2><span class="sub">${season}</span></div>
        <div id="usage"></div>
        <div class="legend" style="margin-top:8px"><span><i style="background:var(--accent)"></i>Snap %</span><span><i style="background:var(--wr)"></i>Target share</span></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Trade value history</h2><span class="sub">${fmtNames[active]} · saved daily while Huddle runs</span></div>
        ${hist.length > 1 ? L.lineChart([{ name: "Value", color: "var(--accent)", values: hist.map((h) => h[1]) }], hist.map((h) => h[0].slice(5)), { height: 190, area: true })
          : `<div class="empty small">Huddle saves a value snapshot every day it runs. The chart fills in from ${hist[0]?.[0] || "today"}.<br>30-day change from FantasyCalc: <b class="${L.trendCls(d.values[active]?.trend30)}">${L.signed(d.values[active]?.trend30)}</b></div>`}
      </section>
    </div>

    ${d.upcoming.length ? `<section class="card">
      <div class="card-head"><h2>Upcoming schedule</h2><span class="sub">Matchup rank = fantasy points the defense allows to ${p.pos}s (1st = softest)</span></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Week</th>${d.upcoming.map((u) => `<th class="n ${u.week >= 15 && u.week <= 17 ? "playoff" : ""}">${u.week}</th>`).join("")}</tr></thead>
      <tbody><tr><td class="muted">Opponent</td>${d.upcoming.map((u) => `<td class="n">${u.opp ? `${u.home === false ? "@" : ""}${L.esc(u.opp)}` : "BYE"}</td>`).join("")}</tr>
      <tr><td class="muted">Matchup</td>${d.upcoming.map((u) => `<td class="n">${u.opp ? L.matchupPill(u.opp_rank) : ""}</td>`).join("")}</tr>
      <tr><td class="muted">Projection</td>${d.upcoming.map((u) => `<td class="n">${L.n(u.proj)}</td>`).join("")}</tr></tbody></table></div>
      <p class="small muted" style="margin:8px 0 0">Weeks 15–17 (highlighted) are the usual fantasy playoffs.</p></section>` : ""}

    <section class="card">
      <div class="card-head"><h2>Game log</h2><span class="sub">${season} · ${L.esc(L.scoringLabel())}</span></div>
      <div id="log"></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Career</h2><span class="sub">Seasons in your database</span></div>
      <div id="career"></div>
    </section>`;

  const draw = () => {
    const logs = d.logs[season] || [];
    const maxW = Math.max(17, ...logs.map((g) => g.week));
    const byW = Object.fromEntries(logs.map((g) => [g.week, g]));
    const pts = Array.from({ length: maxW }, (_, i) => {
      const g = byW[i + 1];
      const played = g && g.gp > 0;
      return { label: i + 1, value: played ? g.pts : null,
        color: !played ? null : g.rank <= 12 ? "var(--good)" : g.rank <= 24 ? "var(--accent)" : "var(--surface-3)",
        title: played ? `Week ${i + 1} vs ${g.opp}: ${L.n(g.pts)} pts (${p.pos}${g.rank})` : "" };
    }).filter((x, i) => i < Math.max(...logs.map((g) => g.week), 1));
    const cs = career.find((c) => c.season === season);
    root.querySelector("#weekly").innerHTML = logs.length ? L.barChart(pts, { avg: cs?.ppg, avgLabel: "avg" }) : `<div class="empty">No games.</div>`;
    const played = logs.filter((g) => g.gp > 0);
    root.querySelector("#usage").innerHTML = played.length ? L.lineChart([
      { name: "Snap %", color: "var(--accent)", values: played.map((g) => (g.snap != null ? g.snap * 100 : null)) },
      { name: "Target share", color: "var(--wr)", values: played.map((g) => (g.tgt_share != null ? g.tgt_share * 100 : null)) },
    ], played.map((g) => `W${g.week}`), { height: 190, yMax: 100, yFmt: (v) => `${Math.round(v)}%` }) : `<div class="empty">No games.</div>`;

    const isQB = p.pos === "QB";
    L.dataTable(root.querySelector("#log"), {
      rows: logs, sort: "week", dir: 1, page: 25,
      columns: [
        { key: "week", label: "Wk", num: true, d: 0, asc: true },
        { key: "opp", label: "Opp", render: (g) => `${L.esc(g.team)} vs ${L.esc(g.opp)}` },
        { key: "pts", label: "Pts", num: true, render: (g) => `<b>${L.n(g.pts)}</b>` },
        { key: "rank", label: "Finish", num: true, asc: true, render: (g) => (g.rank ? `${p.pos}${g.rank}` : "–") },
        { key: "snap", label: "Snap %", num: true, fmt: L.pct },
        ...(isQB ? [
          { key: "pass_att", label: "Cmp/Att", num: true, render: (g) => `${L.int(g.pass_cmp)}/${L.int(g.pass_att)}` },
          { key: "pass_yd", label: "Pass yds", num: true, d: 0 },
          { key: "pass_td", label: "TD", num: true, d: 0 },
          { key: "pass_int", label: "INT", num: true, d: 0 },
        ] : [
          { key: "rec_tgt", label: "Tgt", num: true, d: 0 },
          { key: "tgt_share", label: "Tgt %", num: true, fmt: (v) => L.pct(v) },
          { key: "rec", label: "Rec", num: true, d: 0 },
          { key: "rec_yd", label: "Rec yds", num: true, d: 0 },
          { key: "rec_td", label: "Rec TD", num: true, d: 0 },
        ]),
        { key: "rush_att", label: "Car", num: true, d: 0 },
        { key: "rush_yd", label: "Rush yds", num: true, d: 0 },
        { key: "rush_td", label: "Rush TD", num: true, d: 0 },
      ],
    });
  };
  draw();
  L.dataTable(root.querySelector("#career"), {
    rows: career, sort: "season", page: 10,
    columns: [
      { key: "season", label: "Season", num: true, d: 0 },
      { key: "gp", label: "GP", num: true, d: 0 },
      { key: "pts", label: "Pts", num: true },
      { key: "ppg", label: "PPG", num: true },
      { key: "pos_rank", label: "Finish", num: true, asc: true, render: (c) => `${p.pos}${c.pos_rank}` },
      { key: "top12", label: "Top-12 %", num: true, fmt: L.pct },
      { key: "snap", label: "Snap %", num: true, fmt: L.pct },
      { key: "tgt_share", label: "Tgt share", num: true, fmt: (v) => L.pct(v, 1) },
      { key: "pass_yd", label: "Pass yds", num: true, d: 0 },
      { key: "pass_td", label: "Pass TD", num: true, d: 0 },
      { key: "rush_yd", label: "Rush yds", num: true, d: 0 },
      { key: "rec", label: "Rec", num: true, d: 0 },
      { key: "rec_yd", label: "Rec yds", num: true, d: 0 },
      { key: "td", label: "Total TD", num: true, sortVal: (c) => c.rush_td + c.rec_td, render: (c) => L.int(c.rush_td + c.rec_td) },
    ],
  });
  L.onSeg(root, { season: (v) => { season = +v; draw(); } });
}

const tile = (l, v, sub) => `<div class="stat-tile"><span class="l">${l}</span><span class="v">${v}</span><span class="small muted">${sub}</span></div>`;
