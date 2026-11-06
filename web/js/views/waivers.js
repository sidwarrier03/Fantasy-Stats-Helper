import * as L from "../lib.js";

const st = { league: "", tab: "add", pos: "ALL" };

export async function render(root) {
  const leagues = L.settings.leagues;
  if (st.league && !leagues.some((l) => l.id === st.league)) st.league = "";
  const d = await L.api("waivers", { league: st.league });
  if (!st.league && st.tab === "avail") st.tab = "add";
  const lg = leagues.find((l) => l.id === st.league);

  root.innerHTML = `
    ${L.pageHead("Waiver Wire", `Who Sleeper managers are adding and dropping in the last 24 hours, with the numbers behind them. Pick one of your leagues to see who is actually available.`,
      `<label class="check">League
        <select id="league"><option value="">All of Sleeper</option>${leagues.map((l) => `<option value="${L.esc(l.id)}" ${l.id === st.league ? "selected" : ""}>${L.esc(l.name)}</option>`).join("")}</select></label>`)}
    ${!leagues.length ? `<div class="note">Connect your Sleeper account on <a href="#leagues" style="color:var(--accent)">My Leagues</a> to see which players are free agents in your leagues.</div>` : ""}
    <section class="card">
      <div class="tabs" style="margin-bottom:12px">
        <button data-tab="add" class="${st.tab === "add" ? "on" : ""}">Trending adds</button>
        <button data-tab="drop" class="${st.tab === "drop" ? "on" : ""}">Trending drops</button>
        ${st.league ? `<button data-tab="avail" class="${st.tab === "avail" ? "on" : ""}">Best available in ${L.esc(lg?.name || "league")}</button>` : ""}
      </div>
      <div class="toolbar" style="margin-bottom:10px">${L.seg("pos", ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"].map((p) => [p, p === "ALL" ? "All" : p]), st.pos)}
        <span class="small muted">Projections are for week ${d.week.upcoming ?? "–"} in ${L.esc(L.scoringLabel())}.</span></div>
      <div id="tbl"></div>
    </section>`;

  const rowsFor = () => {
    const src = st.tab === "avail" ? d.available || [] : d.trending[st.tab];
    return src.filter((r) => st.pos === "ALL" || r.pos === st.pos);
  };
  const cols = [
    { key: "name", label: "Player", asc: true, render: (r) => L.playerCell(r) },
    ...(st.tab !== "avail" ? [{ key: "count", label: st.tab === "add" ? "Adds" : "Drops", num: true, fmt: L.int }] : []),
    ...(st.league && st.tab !== "avail" ? [{ key: "rostered", label: "In your league", render: (r) => (r.rostered ? `<span class="pill">Rostered</span>` : `<span class="pill good">Available</span>`) }] : []),
    { key: "proj", label: "Proj", num: true, title: "This week's projection" },
    { key: "opp", label: "Opp", render: (r) => L.esc(r.opp || "–") },
    { key: "l3", label: "Last 3", num: true },
    { key: "ppg", label: "PPG", num: true },
    { key: "snap", label: "Snap %", num: true, fmt: L.pct },
    { key: "tgt_share", label: "Tgt %", num: true, fmt: L.pct },
    { key: "rush_share", label: "Rush %", num: true, fmt: L.pct },
    { key: "ros", label: "ROS proj", num: true },
    ...(st.tab === "avail" ? [{ key: "vor", label: "Over starter", num: true, title: "Rest-of-season points above the last starter at his position in this league (higher = bigger upgrade)", render: (r) => (r.vor == null ? "–" : `<span class="${r.vor > 0 ? "up" : "muted"}">${L.signed(r.vor, 1)}</span>`) }] : []),
    { key: "value", label: "Value", num: true, fmt: L.int, title: "Trade value in your selected format" },
    { key: "age", label: "Age", num: true, asc: true },
  ];
  const table = L.dataTable(root.querySelector("#tbl"), {
    columns: cols, rows: rowsFor(), sort: st.tab === "avail" ? (L.settings.fmt === "dynasty" ? "value" : "vor") : "count", page: 60,
    onRow: (r) => { location.hash = `#player/${r.id}`; },
  });
  root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { st.tab = b.dataset.tab; render(root); }));
  L.onSeg(root, { pos: (v) => { st.pos = v; table.update(rowsFor()); } });
  root.querySelector("#league").onchange = (e) => { st.league = e.target.value; st.tab = st.league ? "avail" : "add"; render(root); };
}
