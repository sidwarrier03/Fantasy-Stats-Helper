import * as L from "../lib.js";

const st = { season: null, pos: "ALL", view: "fantasy", q: "", minGp: 1 };
const PCT = (v) => L.pct(v, 1);

const BASE = [
  { key: "pos_rank", label: "Rk", num: true, d: 0, asc: true, title: "Position rank by total points", render: (r) => `<span class="muted">${r.pos}${r.pos_rank}</span>`, sortVal: (r) => r.pos_rank },
  { key: "name", label: "Player", asc: true, render: (r) => L.playerCell(r) },
  { key: "gp", label: "GP", num: true, d: 0 },
  { key: "pts", label: "Pts", num: true },
  { key: "ppg", label: "PPG", num: true, render: (r) => `<b>${L.n(r.ppg)}</b>` },
];
const VIEWS = {
  fantasy: [
    { key: "l3", label: "Last 3", num: true, title: "Points per game over the last three games played" },
    { key: "top12", label: "Top-12", num: true, fmt: L.pct, title: "Share of games finishing top 12 at the position" },
    { key: "top24", label: "Top-24", num: true, fmt: L.pct, title: "Share of games finishing top 24 at the position" },
    { key: "sd", label: "Std dev", num: true, title: "Week-to-week volatility (lower = steadier)" },
    { key: "hi", label: "High", num: true },
    { key: "lo", label: "Low", num: true },
    { key: "wk", label: "Weekly", sort: false, render: (r) => L.sparkline(r.wk, { color: L.POS_COLOR[r.pos] }) },
    { key: "dyn", label: "Dyn value", num: true, fmt: L.int },
    { key: "red", label: "Red value", num: true, fmt: L.int },
    { key: "age", label: "Age", num: true, asc: true },
  ],
  usage: [
    { key: "snap", label: "Snap %", num: true, fmt: L.pct },
    { key: "tgt_share", label: "Tgt share", num: true, fmt: PCT },
    { key: "air_share", label: "Air yd share", num: true, fmt: PCT },
    { key: "rush_share", label: "Rush share", num: true, fmt: PCT },
    { key: "adot", label: "aDOT", num: true, title: "Average depth of target (air yards per target)" },
    { key: "rec_rz_tgt", label: "RZ tgt", num: true, d: 0 },
    { key: "rush_rz_att", label: "RZ carries", num: true, d: 0 },
    { key: "opp_pg", label: "Opp/G", num: true, title: "Carries + targets per game", sortVal: (r) => (r.rush_att + r.rec_tgt) / r.gp, render: (r) => L.n((r.rush_att + r.rec_tgt) / r.gp) },
  ],
  passing: [
    { key: "pass_cmp", label: "Cmp", num: true, d: 0 },
    { key: "pass_att", label: "Att", num: true, d: 0 },
    { key: "cmp_pct", label: "Cmp %", num: true, fmt: PCT },
    { key: "pass_yd", label: "Yds", num: true, d: 0 },
    { key: "ypg", label: "Yds/G", num: true, sortVal: (r) => r.pass_yd / r.gp, render: (r) => L.n(r.pass_yd / r.gp) },
    { key: "pass_td", label: "TD", num: true, d: 0 },
    { key: "pass_int", label: "INT", num: true, d: 0 },
    { key: "rush_yd", label: "Rush yds", num: true, d: 0 },
    { key: "rush_td", label: "Rush TD", num: true, d: 0 },
  ],
  rushing: [
    { key: "rush_att", label: "Att", num: true, d: 0 },
    { key: "rush_yd", label: "Yds", num: true, d: 0 },
    { key: "ypc", label: "YPC", num: true },
    { key: "rush_td", label: "TD", num: true, d: 0 },
    { key: "rush_share", label: "Rush share", num: true, fmt: PCT },
    { key: "rush_rz_att", label: "RZ carries", num: true, d: 0 },
    { key: "rec_tgt", label: "Tgt", num: true, d: 0 },
    { key: "rec_yd", label: "Rec yds", num: true, d: 0 },
    { key: "fum_lost", label: "Fum lost", num: true, d: 0 },
  ],
  receiving: [
    { key: "rec_tgt", label: "Tgt", num: true, d: 0 },
    { key: "rec", label: "Rec", num: true, d: 0 },
    { key: "rec_yd", label: "Yds", num: true, d: 0 },
    { key: "rec_td", label: "TD", num: true, d: 0 },
    { key: "ypr", label: "Y/R", num: true },
    { key: "tgt_share", label: "Tgt share", num: true, fmt: PCT },
    { key: "rec_air_yd", label: "Air yds", num: true, d: 0 },
    { key: "adot", label: "aDOT", num: true },
    { key: "rec_rz_tgt", label: "RZ tgt", num: true, d: 0 },
  ],
};

export async function render(root) {
  const status = await L.api("status");
  const seasons = status.week.seasons;
  st.season ??= status.week.stats_season;
  const data = await L.api("stats", { season: st.season });

  root.innerHTML = `
    ${L.pageHead("Stats Database", `Every player-game from ${seasons.slice(-1)[0]}–${seasons[0]}, scored in ${L.esc(L.scoringLabel())}. Updates automatically as games finish. Click a player for game logs.`,
      `<button class="btn" id="csv">Export CSV</button>`)}
    <section class="card">
      <div class="toolbar" style="margin-bottom:12px">
        <select id="season" aria-label="Season">${seasons.map((s) => `<option ${s == st.season ? "selected" : ""}>${s}</option>`).join("")}</select>
        ${L.seg("pos", ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"].map((p) => [p, p === "ALL" ? "All" : p]), st.pos)}
        <input type="search" id="q" placeholder="Filter by name or team" value="${L.esc(st.q)}" style="width:200px">
        <label class="check">Min games <input type="number" id="mingp" min="1" max="18" value="${st.minGp}" style="width:62px"></label>
        <span class="grow"></span>
        ${L.seg("view", [["fantasy", "Fantasy"], ["usage", "Usage"], ["passing", "Passing"], ["rushing", "Rushing"], ["receiving", "Receiving"]], st.view)}
      </div>
      <div id="tbl"></div>
      <p class="small muted" style="margin:10px 0 0">Shares are the player's share of his team's targets, air yards or carries in the games he played. Through week ${data.max_week}.</p>
    </section>`;

  const filtered = () => {
    const q = L.norm(st.q);
    return data.rows.filter((r) => (st.pos === "ALL" || r.pos === st.pos) && r.gp >= st.minGp
      && (!q || L.norm(r.name).includes(q) || L.norm(r.team) === q));
  };
  let table;
  const build = () => {
    table = L.dataTable(root.querySelector("#tbl"), {
      columns: [...BASE, ...VIEWS[st.view]], rows: filtered(), sort: "pts", page: 75,
      onRow: (r) => { location.hash = `#player/${r.id}`; },
    });
  };
  build();
  L.onSeg(root, {
    pos: (v) => { st.pos = v; table.update(filtered()); },
    view: (v) => { st.view = v; build(); },
  });
  root.querySelector("#q").oninput = (e) => { st.q = e.target.value; table.update(filtered()); };
  root.querySelector("#mingp").oninput = (e) => { st.minGp = +e.target.value || 1; table.update(filtered()); };
  root.querySelector("#season").onchange = (e) => { st.season = +e.target.value; render(root); };
  root.querySelector("#csv").onclick = () => {
    const cols = [...BASE, ...VIEWS.fantasy, ...VIEWS.usage, ...VIEWS.passing, ...VIEWS.rushing, ...VIEWS.receiving]
      .filter((c, i, a) => c.key !== "wk" && c.key !== "opp_pg" && c.key !== "ypg" && a.findIndex((x) => x.key === c.key) === i);
    L.downloadCSV(`huddle-stats-${st.season}-${L.settings.scoring.replace(":", "-")}.csv`,
      [{ key: "pos", label: "Pos" }, { key: "team", label: "Team" }, ...cols], table.rows());
  };
}
