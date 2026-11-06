import * as L from "../lib.js";

export async function render(root) {
  const username = L.settings.username;
  if (!username) {
    root.innerHTML = `${L.pageHead("Portfolio", "See every player you own across all your Sleeper leagues.")}
      <div class="card empty"><h2>Connect Sleeper first</h2><p>Add your Sleeper username on My Leagues and your exposure shows up here.</p><a class="btn primary" href="#leagues">Connect Sleeper</a></div>`;
    return;
  }
  const d = await L.api("portfolio", { username });
  const posTotals = {};
  d.rows.forEach((r) => { posTotals[r.pos] = (posTotals[r.pos] || 0) + r.value; });
  const total = Object.values(posTotals).reduce((a, b) => a + b, 0) || 1;
  root.innerHTML = `
    ${L.pageHead("Portfolio", `${L.esc(d.user.name)} owns ${d.rows.length} different players across ${d.leagues} leagues. High exposure means one injury or bust hits many of your teams at once.`)}
    <div class="grid g4">${["QB", "RB", "WR", "TE"].map((p) => `<div class="stat-tile"><span class="l">${p} share of value</span><span class="v">${L.pct((posTotals[p] || 0) / total)}</span><div class="bar"><i style="width:${(100 * (posTotals[p] || 0)) / total}%;background:${L.POS_COLOR[p]}"></i></div></div>`).join("")}</div>
    <section class="card"><div id="tbl"></div></section>`;
  L.dataTable(root.querySelector("#tbl"), {
    rows: d.rows, sort: "count", page: 100,
    onRow: (r) => { location.hash = `#player/${r.id}`; },
    columns: [
      { key: "name", label: "Player", asc: true, render: (r) => L.playerCell(r) },
      { key: "count", label: "Leagues", num: true, d: 0 },
      { key: "share", label: "Exposure", num: true, render: (r) => `<div class="vbar"><span class="num">${L.pct(r.share)}</span><div class="bar"><i style="width:${r.share * 100}%"></i></div></div>` },
      { key: "value", label: "Combined value", num: true, fmt: L.int },
      { key: "age", label: "Age", num: true, asc: true },
      { key: "leagues", label: "Where", sort: false, render: (r) => `<span class="small muted">${L.esc(r.leagues.join(", "))}</span>` },
    ],
  });
}
