import * as L from "../lib.js";

const st = { pos: "ALL", q: "", rookies: false, picks: false };

export async function render(root) {
  const d = await L.api("rankings");
  const dyn = L.settings.fmt === "dynasty";
  const max = Math.max(...d.rows.map((r) => r.value || 0));
  root.innerHTML = `
    ${L.pageHead(`${dyn ? "Dynasty" : "Redraft"} Rankings`,
      `${L.settings.qb === "2" ? "Superflex" : "1QB"} trade values from FantasyCalc (built from real trades), next to ${d.season} production in ${L.esc(L.scoringLabel())}. Switch format and QB setting in the top bar.`,
      `<button class="btn" id="csv">Export CSV</button>`)}
    <section class="card">
      <div class="toolbar" style="margin-bottom:12px">
        ${L.seg("pos", ["ALL", "QB", "RB", "WR", "TE"].map((p) => [p, p === "ALL" ? "All" : p]), st.pos)}
        <input type="search" id="q" placeholder="Filter by name or team" value="${L.esc(st.q)}" style="width:200px">
        ${dyn ? `<label class="check"><input type="checkbox" id="rookies" ${st.rookies ? "checked" : ""}> Rookies only</label>
        <label class="check"><input type="checkbox" id="picks" ${st.picks ? "checked" : ""}> Show draft picks</label>` : ""}
      </div>
      <div id="tbl"></div>
      <p class="small muted" style="margin:10px 0 0"><b>Signal</b> compares where the market ranks a player at his position with where he ranks in points per game this season.
        <span class="pill good">Buy</span> means he is producing well above his price; <span class="pill bad">Sell</span> means the price is ahead of the production.</p>
    </section>`;

  const filtered = () => {
    const q = L.norm(st.q);
    return d.rows.filter((r) => {
      if (r.pos === "PICK") return st.picks && st.pos === "ALL" && !q;
      if (st.pos !== "ALL" && r.pos !== st.pos) return false;
      if (st.rookies && r.yoe !== 0) return false;
      return !q || L.norm(r.name).includes(q) || L.norm(r.team) === q;
    });
  };
  const signal = (r) => (r.pos_rank && r.ppg_rank && r.pos !== "PICK" ? r.pos_rank - r.ppg_rank : null);
  const cols = [
    { key: "rank", label: "#", num: true, d: 0, asc: true },
    { key: "name", label: "Player", asc: true, render: (r) => L.playerCell(r) },
    { key: "pos_rank", label: "Pos rk", num: true, asc: true, render: (r) => `<span class="muted">${r.pos}${r.pos_rank}</span>` },
    { key: "value", label: "Value", num: true, render: (r) => L.valueBar(r.value, max) },
    { key: "trend30", label: "30 days", num: true, render: (r) => `<span class="${L.trendCls(r.trend30)}">${L.signed(r.trend30)}</span>` },
    { key: "age", label: "Age", num: true, asc: true },
    { key: "ppg", label: "PPG", num: true, title: `${d.season} points per game` },
    { key: "ppg_rank", label: "PPG rk", num: true, asc: true, render: (r) => (r.ppg_rank ? `${r.pos}${r.ppg_rank}` : "–") },
    ...(!dyn ? [{ key: "ros", label: "ROS proj", num: true, title: "Projected points for the rest of the regular season" }] : []),
    { key: "signal", label: "Signal", num: true, sortVal: signal, render: (r) => {
      const s = signal(r);
      if (s == null) return "–";
      if (s >= 8) return `<span class="pill good" title="Market rank ${r.pos}${r.pos_rank}, scoring rank ${r.pos}${r.ppg_rank}">Buy</span>`;
      if (s <= -12) return `<span class="pill bad" title="Market rank ${r.pos}${r.pos_rank}, scoring rank ${r.pos}${r.ppg_rank}">Sell</span>`;
      return `<span class="muted small">${s > 0 ? "+" : ""}${s}</span>`;
    } },
  ];
  const table = L.dataTable(root.querySelector("#tbl"), {
    columns: cols, rows: filtered(), sort: "value", page: 100,
    onRow: (r) => { if (r.pos !== "PICK") location.hash = `#player/${r.id}`; },
    breakBefore: (r, prev, sort) => (sort === "value" && r.tier && (!prev || prev.tier !== r.tier) ? `Tier ${r.tier}` : null),
  });
  const upd = () => table.update(filtered());
  L.onSeg(root, { pos: (v) => { st.pos = v; upd(); } });
  root.querySelector("#q").oninput = (e) => { st.q = e.target.value; upd(); };
  root.querySelector("#rookies")?.addEventListener("change", (e) => { st.rookies = e.target.checked; upd(); });
  root.querySelector("#picks")?.addEventListener("change", (e) => { st.picks = e.target.checked; upd(); });
  root.querySelector("#csv").onclick = () => L.downloadCSV(`huddle-rankings-${d.fmt}.csv`,
    ["rank", "name", "pos", "team", "age", "value", "pos_rank", "tier", "trend30", "ppg", "ppg_rank", "ros"], table.rows());
}
