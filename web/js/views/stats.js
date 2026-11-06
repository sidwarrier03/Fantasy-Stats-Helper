import * as L from "../lib.js";

const st = { season: null, pos: "ALL", autoPos: false, view: "fantasy", q: "", minGp: 1, team: "", filters: [], minVol: {} };

// ---------------------------------------------------------------- column helpers
// unit: "pct" = stored as a fraction, shown and filtered as a percent; "pct100" = already 0-100 (Next Gen Stats).
const pct = (d = 0) => ({ fmt: (v) => L.pct(v, d), unit: "pct" });
const ngsPct = { fmt: (v) => (v == null ? "–" : `${L.n(v, 1)}%`), unit: "pct100" };
const signedFmt = (d) => (v) => (v == null ? "–" : `<span class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${v > 0 ? "+" : ""}${Number(v).toFixed(d)}</span>`);
const epa = { fmt: signedFmt(2) };
const C = (key, label, title, opts = {}) => ({ key, label, num: true, title, ...opts });
const SRC = { pbp: "nflverse play-by-play", pfr: "Pro-Football-Reference via nflverse", ngs: "NFL Next Gen Stats via nflverse" };
const T = (text, src) => `${text}${src ? ` Source: ${SRC[src]}.` : ""}`;

const BASE = [
  { key: "pos_rank", label: "Rk", num: true, d: 0, asc: true, title: "Position rank by total fantasy points", render: (r) => `<span class="muted">${r.pos}${r.pos_rank}</span>`, sortVal: (r) => r.pos_rank, nofilter: true },
  { key: "name", label: "Player", asc: true, render: (r) => L.playerCell(r), nofilter: true },
  C("gp", "GP", "Games played", { d: 0 }),
  C("pts", "Pts", "Total fantasy points"),
  C("ppg", "PPG", "Fantasy points per game", { render: (r) => `<b>${L.n(r.ppg)}</b>` }),
];

const VIEWS = {
  fantasy: { label: "Fantasy", sort: "pts", cols: [
    C("l3", "Last 3", "Points per game over the last three games played"),
    C("top12", "Top-12", "Share of games finishing top 12 at the position", pct()),
    C("top24", "Top-24", "Share of games finishing top 24 at the position", pct()),
    C("sd", "Std dev", "Week-to-week volatility (lower = steadier)"),
    C("hi", "High", "Best game"),
    C("lo", "Low", "Worst game"),
    { key: "wk", label: "Weekly", sort: false, nofilter: true, render: (r) => L.sparkline(r.wk, { color: L.POS_COLOR[r.pos] }) },
    C("dyn", "Dyn value", "Dynasty trade value (FantasyCalc)", { fmt: L.int }),
    C("red", "Red value", "Redraft trade value (FantasyCalc)", { fmt: L.int }),
    C("age", "Age", "Age in years", { asc: true }),
  ] },
  usage: { label: "Usage", sort: "pts", cols: [
    C("snap", "Snap %", "Share of the team's offensive snaps", pct()),
    C("tgt_share", "Tgt share", "Share of team targets in games played", pct(1)),
    C("air_share", "Air yd share", "Share of team air yards in games played", pct(1)),
    C("wopr", "WOPR", "Weighted opportunity rating: 1.5 × target share + 0.7 × air-yard share. Above 0.7 is elite.", { d: 2 }),
    C("rush_share", "Rush share", "Share of team carries in games played", pct(1)),
    C("adot", "aDOT", "Average depth of target (air yards per target)"),
    C("opp_pg", "Opp/G", "Carries + targets per game", { sortVal: (r) => (r.rush_att + r.rec_tgt) / r.gp, render: (r) => L.n((r.rush_att + r.rec_tgt) / r.gp) }),
  ] },
  passing: { label: "Passing", sort: "epa_db", vol: ["dropbacks", "Min dropbacks", 100], pos: "QB", cols: [
    C("pass_att", "Att", "Pass attempts", { d: 0 }),
    C("cmp_pct", "Cmp %", "Completion percentage", pct(1)),
    C("pass_yd", "Yds", "Passing yards", { d: 0 }),
    C("pass_td", "TD", "Passing touchdowns", { d: 0 }),
    C("pass_int", "INT", "Interceptions", { d: 0 }),
    C("dropbacks", "Dropbacks", T("Pass attempts + sacks + scrambles.", "pbp"), { d: 0 }),
    C("epa_db", "EPA/db", T("Expected points added per dropback (RBSDM's headline QB stat). +0.20 is very good, 0 is average.", "pbp"), epa),
    C("sr_db", "Success", T("Share of dropbacks with positive EPA.", "pbp"), pct(1)),
    C("cpoe", "CPOE", T("Completion % over expected, given throw difficulty.", "pbp"), { fmt: signedFmt(1) }),
    C("adot_pass", "aDOT", T("Air yards per pass attempt.", "pbp")),
    C("deep_pct", "Deep %", T("Share of attempts thrown 20+ air yards.", "pbp"), pct(1)),
    C("ttt", "Time to throw", T("Average seconds from snap to throw.", "ngs"), { d: 2 }),
    C("aggr", "Aggressive", T("Share of throws into tight windows (defender within 1 yard).", "ngs"), ngsPct),
    C("press_pct", "Pressure %", T("Share of dropbacks under pressure.", "pfr"), pct(1)),
    C("sack_pct", "Sack %", T("Sacks per dropback.", "pbp"), pct(1)),
    C("bad_pct", "Bad throw %", T("Inaccurate throws per attempt.", "pfr"), pct(1)),
    C("scrambles", "Scrambles", T("QB scrambles.", "pbp"), { d: 0 }),
  ] },
  rushing: { label: "Rushing", sort: "epa_rush", vol: ["runs", "Min carries", 40], cols: [
    C("rush_att", "Att", "Rushing attempts", { d: 0 }),
    C("rush_yd", "Yds", "Rushing yards", { d: 0 }),
    C("ypc", "YPC", "Yards per carry"),
    C("rush_td", "TD", "Rushing touchdowns", { d: 0 }),
    C("epa_rush", "EPA/rush", T("Expected points added per designed run (scrambles and kneel-downs excluded).", "pbp"), epa),
    C("sr_rush", "Success", T("Share of designed runs with positive EPA.", "pbp"), pct(1)),
    C("ryoe_att", "RYOE/att", T("Rush yards over expected per attempt, given blockers and defenders.", "ngs"), { fmt: signedFmt(2) }),
    C("ryoe", "RYOE", T("Total rush yards over expected.", "ngs"), { fmt: signedFmt(0) }),
    C("yco_att", "YCO/att", T("Yards after contact per attempt.", "pfr"), { d: 2 }),
    C("ybc_att", "YBC/att", T("Yards before contact per attempt (a blocking indicator).", "pfr"), { d: 2 }),
    C("btk", "Broken tkl", T("Broken tackles, rushing + receiving.", "pfr"), { d: 0 }),
    C("expl_pct", "10+ yd %", T("Share of designed runs gaining 10+ yards.", "pbp"), pct(1)),
    C("box8", "8+ box %", T("Share of carries against 8+ defenders in the box.", "ngs"), ngsPct),
    C("rush_share", "Rush share", "Share of team carries in games played", pct(1)),
  ] },
  receiving: { label: "Receiving", sort: "epa_tgt", vol: ["rec_tgt", "Min targets", 20], cols: [
    C("rec_tgt", "Tgt", "Targets", { d: 0 }),
    C("rec", "Rec", "Receptions", { d: 0 }),
    C("rec_yd", "Yds", "Receiving yards", { d: 0 }),
    C("rec_td", "TD", "Receiving touchdowns", { d: 0 }),
    C("epa_tgt", "EPA/tgt", T("Expected points added per target.", "pbp"), epa),
    C("sr_tgt", "Success", T("Share of targets with positive EPA.", "pbp"), pct(1)),
    C("wopr", "WOPR", "Weighted opportunity rating: 1.5 × target share + 0.7 × air-yard share", { d: 2 }),
    C("tgt_share", "Tgt share", "Share of team targets in games played", pct(1)),
    C("adot", "aDOT", "Average depth of target"),
    C("racr", "RACR", T("Receiver air conversion ratio: receiving yards per air yard.", "pbp"), { d: 2 }),
    C("yac_rec", "YAC/rec", T("Yards after catch per reception.", "pbp")),
    C("yacoe", "YAC+", T("YAC above expectation per reception.", "ngs"), { fmt: signedFmt(1) }),
    C("sep", "Separation", T("Average yards of separation at the catch point or incompletion.", "ngs"), { d: 2 }),
    C("drop_pct", "Drop %", T("Drops per target.", "pfr"), pct(1)),
    C("rtg_tgt", "Rtg when tgt", T("Passer rating on throws to this player.", "pbp")),
    C("first_downs", "1st downs", T("Receiving first downs.", "pbp"), { d: 0 }),
  ] },
  redzone: { label: "Red zone", sort: "rz_opps", cols: [
    C("rz_opps", "RZ opps", T("Red-zone targets + designed runs (inside the 20).", "pbp"), { d: 0, sortVal: (r) => (r.rz_tgt || 0) + (r.rz_rush || 0), render: (r) => L.int((r.rz_tgt || 0) + (r.rz_rush || 0)) }),
    C("rz_tgt", "RZ tgt", T("Targets inside the opponent's 20.", "pbp"), { d: 0 }),
    C("ez_tgt", "End-zone tgt", T("Targets thrown into the end zone.", "pbp"), { d: 0 }),
    C("rz_rush", "RZ carries", T("Designed runs inside the 20.", "pbp"), { d: 0 }),
    C("i5_rush", "Inside-5", T("Designed runs inside the 5.", "pbp"), { d: 0 }),
    C("rz_db", "RZ dropbacks", T("QB dropbacks inside the 20.", "pbp"), { d: 0 }),
    C("deep_tgt", "Deep tgt", T("Targets 20+ air yards downfield.", "pbp"), { d: 0 }),
    C("rec_td", "Rec TD", "Receiving touchdowns", { d: 0 }),
    C("rush_td", "Rush TD", "Rushing touchdowns", { d: 0 }),
  ] },
  efficiency: { label: "Efficiency", sort: "tot_epa", vol: ["adv_plays", "Min plays", 50], cols: [
    C("tot_epa", "Total EPA", T("All expected points added as passer, rusher and receiver.", "pbp"), { fmt: signedFmt(1) }),
    C("epa_play", "EPA/play", T("Total EPA per dropback, designed run or target.", "pbp"), epa),
    C("adv_plays", "Plays", T("Dropbacks + designed runs + targets.", "pbp"), { d: 0 }),
    C("pass_epa", "Pass EPA", T("EPA on dropbacks.", "pbp"), { fmt: signedFmt(1) }),
    C("epa_db", "EPA/db", T("EPA per dropback.", "pbp"), epa),
    C("rush_epa", "Rush EPA", T("EPA on designed runs.", "pbp"), { fmt: signedFmt(1) }),
    C("epa_rush", "EPA/rush", T("EPA per designed run.", "pbp"), epa),
    C("rec_epa", "Rec EPA", T("EPA on targets.", "pbp"), { fmt: signedFmt(1) }),
    C("epa_tgt", "EPA/tgt", T("EPA per target.", "pbp"), epa),
  ] },
};
const ALL = [...BASE, ...Object.values(VIEWS).flatMap((v) => v.cols)].filter((c, i, a) => a.findIndex((x) => x.key === c.key) === i);
const BY_KEY = Object.fromEntries(ALL.map((c) => [c.key, c]));
const val = (c, r) => (c.sortVal ? c.sortVal(r) : r[c.key]);
const shown = (c, v) => (c.unit === "pct" ? v * 100 : v);  // value in the units the user types

export async function render(root) {
  const status = await L.api("status");
  const seasons = status.week.seasons;
  st.season ??= status.week.stats_season;
  const data = await L.api("stats", { season: st.season });
  const teams = [...new Set(data.rows.map((r) => r.team).filter(Boolean))].sort();
  const view = VIEWS[st.view];
  const vol = view.vol;
  const volVal = vol ? (st.minVol[st.view] ?? vol[2]) : null;

  root.innerHTML = `
    ${L.pageHead("Stats Database", `Every player-game from ${seasons.slice(-1)[0]}–${seasons[0]}: fantasy scoring in ${L.esc(L.scoringLabel())}, plus advanced efficiency from play-by-play, Pro-Football-Reference and Next Gen Stats. Hover a column name for what it means and where it comes from.`,
      `<button class="btn" id="csv">Export CSV</button>`)}
    <section class="card">
      <div class="toolbar" style="margin-bottom:10px">
        ${L.seg("view", Object.entries(VIEWS).map(([k, v]) => [k, v.label]), st.view)}
      </div>
      <div class="toolbar" style="margin-bottom:10px">
        <select id="season" aria-label="Season">${seasons.map((s) => `<option ${s == st.season ? "selected" : ""}>${s}</option>`).join("")}</select>
        ${L.seg("pos", ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"].map((p) => [p, p === "ALL" ? "All" : p]), st.pos)}
        <select id="team" aria-label="Team"><option value="">All teams</option>${teams.map((t) => `<option ${t === st.team ? "selected" : ""}>${t}</option>`).join("")}</select>
        <input type="search" id="q" placeholder="Search players" value="${L.esc(st.q)}" style="width:170px">
        <label class="check">Min games <input type="number" id="mingp" min="1" max="18" value="${st.minGp}" style="width:58px"></label>
        ${vol ? `<label class="check">${vol[1]} <input type="number" id="minvol" min="0" value="${volVal}" style="width:68px"></label>` : ""}
      </div>
      <div class="toolbar" style="margin-bottom:12px">
        <button class="btn sm" id="add-filter" type="button">+ Add filter</button>
        <span class="chips" id="chips"></span>
        <form id="filter-form" class="toolbar" hidden>
          <select id="f-key" aria-label="Stat">${Object.entries(VIEWS).map(([, v]) => `<optgroup label="${v.label}">${v.cols.filter((c) => !c.nofilter).map((c) => `<option value="${c.key}">${L.esc(c.label)}${c.unit ? " (%)" : ""}</option>`).join("")}</optgroup>`).join("")}
            <optgroup label="Fantasy">${BASE.filter((c) => !c.nofilter).map((c) => `<option value="${c.key}">${L.esc(c.label)}</option>`).join("")}</optgroup></select>
          <select id="f-op" aria-label="Comparison"><option value="ge">at least</option><option value="le">at most</option></select>
          <input type="number" id="f-val" step="any" placeholder="value" style="width:90px" required>
          <button class="btn sm primary" type="submit">Apply</button>
          <button class="btn sm ghost" type="button" id="f-cancel">Cancel</button>
        </form>
      </div>
      <div class="small muted" id="count" style="margin-bottom:6px"></div>
      <div id="tbl"></div>
      <p class="small muted" style="margin:12px 0 0">Through week ${data.max_week}. <b>Sources:</b> fantasy points, snaps and shares from Sleeper.
        EPA, success rate, CPOE, air yards and red-zone/end-zone looks from nflverse play-by-play (the nflfastR data RBSDM and NFL Savant are built on).
        Pressures, bad throws, drops, broken tackles and yards before/after contact from Pro-Football-Reference via nflverse.
        Time to throw, aggressiveness, separation, YAC+ and rush yards over expected from NFL Next Gen Stats via nflverse.</p>
    </section>`;

  const drawChips = () => {
    root.querySelector("#chips").innerHTML = st.filters.map((f, i) => {
      const c = BY_KEY[f.key];
      return `<span class="chip on">${L.esc(c.label)} ${f.op === "ge" ? "≥" : "≤"} ${L.esc(f.val)}${c.unit ? "%" : ""} <button type="button" class="btn ghost sm" data-rmf="${i}" aria-label="Remove filter" style="padding:0 4px">✕</button></span>`;
    }).join("");
  };
  const filtered = () => {
    const q = L.norm(st.q);
    const minVol = vol ? (st.minVol[st.view] ?? vol[2]) : 0;
    return data.rows.filter((r) => {
      if (st.pos !== "ALL" && r.pos !== st.pos) return false;
      if (st.team && r.team !== st.team) return false;
      if (r.gp < st.minGp) return false;
      if (vol && minVol && !((r[vol[0]] || 0) >= minVol)) return false;
      if (q && !L.norm(r.name).includes(q) && L.norm(r.team) !== q) return false;
      return st.filters.every((f) => {
        const c = BY_KEY[f.key];
        const v = val(c, r);
        if (v == null || Number.isNaN(v)) return false;
        return f.op === "ge" ? shown(c, v) >= +f.val : shown(c, v) <= +f.val;
      });
    });
  };
  let table;
  const refresh = () => {
    const rows = filtered();
    root.querySelector("#count").textContent = `${rows.length} player${rows.length === 1 ? "" : "s"}`;
    table.update(rows);
  };
  table = L.dataTable(root.querySelector("#tbl"), {
    columns: [...BASE, ...view.cols], rows: filtered(), sort: view.sort, page: 75,
    onRow: (r) => { location.hash = `#player/${r.id}`; },
  });
  root.querySelector("#count").textContent = `${filtered().length} players`;
  drawChips();

  L.onSeg(root, {
    pos: (v) => { st.pos = v; st.autoPos = false; refresh(); },
    view: (v) => {
      st.view = v;
      if (VIEWS[v].pos && st.pos === "ALL") { st.pos = VIEWS[v].pos; st.autoPos = true; }
      else if (!VIEWS[v].pos && st.autoPos) { st.pos = "ALL"; st.autoPos = false; }
      render(root);
    },
  });
  root.querySelector("#q").oninput = (e) => { st.q = e.target.value; refresh(); };
  root.querySelector("#team").onchange = (e) => { st.team = e.target.value; refresh(); };
  root.querySelector("#mingp").oninput = (e) => { st.minGp = +e.target.value || 1; refresh(); };
  root.querySelector("#minvol")?.addEventListener("input", (e) => { st.minVol[st.view] = +e.target.value || 0; refresh(); });
  root.querySelector("#season").onchange = (e) => { st.season = +e.target.value; render(root); };
  const form = root.querySelector("#filter-form");
  root.querySelector("#add-filter").onclick = () => {
    form.hidden = false;
    const first = view.cols.find((c) => !c.nofilter);
    if (first) root.querySelector("#f-key").value = first.key;
    root.querySelector("#f-val").focus();
  };
  root.querySelector("#f-cancel").onclick = () => { form.hidden = true; };
  form.onsubmit = (e) => {
    e.preventDefault();
    st.filters.push({ key: root.querySelector("#f-key").value, op: root.querySelector("#f-op").value, val: root.querySelector("#f-val").value });
    form.hidden = true;
    form.reset();
    drawChips();
    refresh();
  };
  root.querySelector("#chips").onclick = (e) => {
    const b = e.target.closest("[data-rmf]");
    if (!b) return;
    st.filters.splice(+b.dataset.rmf, 1);
    drawChips();
    refresh();
  };
  root.querySelector("#csv").onclick = () => {
    const cols = ALL.filter((c) => !["wk", "opp_pg", "rz_opps"].includes(c.key));
    L.downloadCSV(`huddle-stats-${st.season}-${L.settings.scoring.replace(":", "-")}.csv`,
      [{ key: "pos", label: "Pos" }, { key: "team", label: "Team" }, ...cols.map((c) => ({ key: c.key, label: c.label }))], table.rows());
  };
}
