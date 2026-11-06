import * as L from "../lib.js";

let ids = [];
let init = false;

export async function render(root, args) {
  if (args[0]) ids = [...new Set([...args[0].split(","), ...ids])].slice(0, 4);
  if (!ids.length && !init) {
    const idx = await L.loadIndex();
    const wrs = idx.filter((p) => p.pos === "WR").sort((a, b) => L.valueOf(b) - L.valueOf(a));
    ids = wrs.slice(3, 5).map((p) => p.id);
  }
  init = true;
  const details = await Promise.all(ids.map((id) => L.api("player", { id }).catch(() => null)));
  const players = details.filter(Boolean);
  const season = players[0]?.week.stats_season;
  const cur = (d) => d.career.find((c) => c.season === season) || {};
  const vk = L.valueKey();

  const rows = [
    ["Value", (d) => d.values[vk]?.value, L.int, 1],
    ["30-day value change", (d) => d.values[vk]?.trend30, L.signed, 1],
    ["Age", (d) => d.player.age, (v) => L.n(v), -1],
    ["Games", (d) => cur(d).gp, L.int, 0],
    ["Points per game", (d) => cur(d).ppg, (v) => L.n(v), 1],
    ["Last 3 games", (d) => cur(d).l3, (v) => L.n(v), 1],
    ["Position finish", (d) => cur(d).pos_rank, (v, d) => (v ? `${d.player.pos}${v}` : "–"), -1],
    ["Top-12 week rate", (d) => cur(d).top12, L.pct, 1],
    ["Volatility (std dev)", (d) => cur(d).sd, (v) => L.n(v), -1],
    ["Snap share", (d) => cur(d).snap, L.pct, 1],
    ["Target share", (d) => cur(d).tgt_share, (v) => L.pct(v, 1), 1],
    ["Rush share", (d) => cur(d).rush_share, (v) => L.pct(v, 1), 1],
    ["Red-zone opportunities", (d) => (cur(d).rec_rz_tgt ?? 0) + (cur(d).rush_rz_att ?? 0), L.int, 1],
    ["Rest-of-season projection", (d) => d.ros, (v) => L.n(v), 1],
  ];

  root.innerHTML = `
    ${L.pageHead("Compare Players", `Side by side for ${season}, scored in ${L.esc(L.scoringLabel())}. Best value in each row is highlighted.`)}
    <section class="card">
      <div class="toolbar" style="margin-bottom:14px">
        <div class="picker" id="add" style="width:280px"><input type="search" placeholder="${ids.length >= 4 ? "Remove a player to add another" : "Add a player (up to 4)"}" ${ids.length >= 4 ? "disabled" : ""}></div>
        ${players.map((d, i) => `<span class="pill" style="border:1px solid ${L.SERIES[i]}">${L.esc(d.player.full_name)} <button class="btn ghost sm" data-rm="${d.player.player_id}" aria-label="Remove">×</button></span>`).join("")}
      </div>
      ${players.length ? `<div class="table-wrap"><table class="data"><thead><tr><th></th>${players.map((d) => `<th>${L.playerCell({ id: d.player.player_id, name: d.player.full_name, pos: d.player.pos, team: d.player.team, inj: d.player.injury_status })}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(([label, get, f, better]) => {
        const vals = players.map(get);
        const real = vals.filter((v) => v != null);
        const best = better && real.length > 1 ? (better > 0 ? Math.max(...real) : Math.min(...real)) : null;
        return `<tr><td class="muted">${label}</td>${players.map((d, i) => `<td class="n ${best != null && vals[i] === best ? "best" : ""}">${f(vals[i], d)}</td>`).join("")}</tr>`;
      }).join("")}</tbody></table></div>` : `<div class="empty">Add players to compare.</div>`}
    </section>
    ${players.length ? `<section class="card"><div class="card-head"><h2>Weekly points · ${season}</h2>
      <div class="legend">${players.map((d, i) => `<span><i style="background:${L.SERIES[i]}"></i>${L.esc(d.player.full_name)}</span>`).join("")}</div></div>
      <div id="chart"></div></section>` : ""}`;

  if (players.length) {
    const maxW = Math.max(1, ...players.flatMap((d) => (d.logs[season] || []).map((g) => g.week)));
    const labels = Array.from({ length: maxW }, (_, i) => `W${i + 1}`);
    const series = players.map((d, i) => {
      const by = Object.fromEntries((d.logs[season] || []).filter((g) => g.gp > 0).map((g) => [g.week, g.pts]));
      return { name: d.player.full_name, color: L.SERIES[i], values: labels.map((_, w) => by[w + 1] ?? null) };
    });
    root.querySelector("#chart").innerHTML = L.lineChart(series, labels, { height: 240 });
  }
  L.attachPicker(root.querySelector("#add"), {
    filter: (p) => p.pos !== "PICK" && !ids.includes(p.id),
    onPick: (p) => { ids = [...ids, p.id].slice(0, 4); location.hash = "#compare"; render(root, []); },
  });
  root.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { ids = ids.filter((x) => x !== b.dataset.rm); render(root, []); }));
}
