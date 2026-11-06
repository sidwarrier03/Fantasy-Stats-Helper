import * as L from "../lib.js";

const st = { season: null, last: "" };
const signed = (d) => (v) => (v == null ? "–" : `<span class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${v > 0 ? "+" : ""}${Number(v).toFixed(d)}</span>`);
// For defense, allowing fewer expected points is good, so color the sign the other way round.
const defSigned = (v) => (v == null ? "–" : `<span class="${v < 0 ? "up" : v > 0 ? "down" : ""}">${v > 0 ? "+" : ""}${Number(v).toFixed(3)}</span>`);

export async function render(root) {
  const d = await L.api("teams", { season: st.season || "", last: st.last });
  st.season = d.season;
  if (!d.teams.length) {
    root.innerHTML = `${L.pageHead("Team Tiers")}<div class="card empty"><h2>No play-by-play yet</h2><p>Advanced team stats appear after the next data update.</p></div>`;
    return;
  }
  root.innerHTML = `
    ${L.pageHead("Team Tiers", "Offense vs defense efficiency in expected points added (EPA) per play: the team-tier chart RBSDM and SumerSports are known for, computed from the same nflverse play-by-play. Up and to the right is better.",
      `<select id="season" aria-label="Season">${d.seasons.map((s) => `<option ${s === d.season ? "selected" : ""}>${s}</option>`).join("")}</select>
       ${L.seg("last", [["", "Full season"], ["8", "Last 8 weeks"], ["4", "Last 4 weeks"]], st.last)}`)}
    <section class="card">
      <div class="card-head"><h2>${d.season} team tiers</h2><span class="sub">Weeks ${d.weeks[0]}–${d.weeks[d.weeks.length - 1]} · defense axis flipped so better defenses sit higher</span></div>
      <div id="chart"></div>
    </section>
    <section class="card">
      <div id="tbl"></div>
      <p class="small muted" style="margin:10px 0 0">EPA/play counts every pass and run, including plays wiped out by penalties (RBSDM's convention). Success = share of plays with positive EPA.
        PROE = pass rate over expected, given down, distance, field position, score and clock (positive = throws more than expected).</p>
    </section>`;

  root.querySelector("#chart").innerHTML = tierChart(d.teams);
  L.dataTable(root.querySelector("#tbl"), {
    rows: d.teams, sort: "net_epa", page: 40,
    columns: [
      { key: "net_rank", label: "#", num: true, sort: false, render: (t) => t.net_epa_rank },
      { key: "team", label: "Team", asc: true, render: (t) => `<div class="pcell">${L.avatar(t.team, t.team)}<b>${t.team}</b></div>` },
      { key: "net_epa", label: "Net EPA/play", num: true, title: "Offense EPA/play minus defense EPA/play allowed", fmt: signed(3) },
      { key: "off_epa", label: "Off EPA", num: true, title: "Offensive EPA per play", render: (t) => `${signed(3)(t.off_epa)} <span class="muted small">${L.ordinal(t.off_epa_rank)}</span>` },
      { key: "def_epa", label: "Def EPA", num: true, asc: true, title: "EPA per play allowed (lower is better)", render: (t) => `${defSigned(t.def_epa)} <span class="muted small">${L.ordinal(t.def_epa_rank)}</span>` },
      { key: "off_pass_epa", label: "Pass EPA", num: true, title: "Offensive EPA per dropback", fmt: signed(3) },
      { key: "off_rush_epa", label: "Rush EPA", num: true, title: "Offensive EPA per designed run", fmt: signed(3) },
      { key: "off_sr", label: "Off success", num: true, fmt: (v) => L.pct(v, 1) },
      { key: "def_pass_epa", label: "Def pass EPA", num: true, asc: true, title: "EPA per dropback allowed", fmt: defSigned },
      { key: "def_rush_epa", label: "Def rush EPA", num: true, asc: true, title: "EPA per designed run allowed", fmt: defSigned },
      { key: "def_sr", label: "Def success", num: true, asc: true, title: "Opponent success rate (lower is better)", fmt: (v) => L.pct(v, 1) },
      { key: "proe", label: "PROE", num: true, title: "Pass rate over expected, in percentage points", fmt: (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`) },
      { key: "db_rate", label: "Dropback %", num: true, fmt: (v) => L.pct(v, 1) },
      { key: "plays_pg", label: "Plays/G", num: true },
    ],
  });
  root.querySelector("#season").onchange = (e) => { st.season = +e.target.value; render(root); };
  L.onSeg(root, { last: (v) => { st.last = v; render(root); } });
}

function tierChart(teams) {
  const W = 760, H = 480, M = { l: 56, r: 20, t: 20, b: 46 };
  const xs = teams.map((t) => t.off_epa), ys = teams.map((t) => t.def_epa);
  const pad = 0.03;
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
  const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const X = (v) => M.l + ((v - x0) / (x1 - x0)) * (W - M.l - M.r);
  const Y = (v) => M.t + ((v - y0) / (y1 - y0)) * (H - M.t - M.b); // flipped: low EPA allowed sits high
  const avgX = xs.reduce((a, b) => a + b, 0) / xs.length, avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
  const ticks = (a, b) => { const out = []; for (let v = Math.ceil(a * 20) / 20; v <= b; v += 0.05) out.push(+v.toFixed(2)); return out; };
  let s = `<svg class="chart" style="min-width:560px" viewBox="0 0 ${W} ${H}" role="img" aria-label="Team offense versus defense EPA per play"><g class="grid">`;
  ticks(x0, x1).forEach((v) => { s += `<line x1="${X(v)}" x2="${X(v)}" y1="${M.t}" y2="${H - M.b}"/><text x="${X(v)}" y="${H - M.b + 16}" text-anchor="middle">${v > 0 ? "+" : ""}${v.toFixed(2)}</text>`; });
  ticks(y0, y1).forEach((v) => { s += `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${M.l - 8}" y="${Y(v) + 3}" text-anchor="end">${v > 0 ? "+" : ""}${v.toFixed(2)}</text>`; });
  s += "</g>";
  // Diagonal tier lines: equal net EPA/play.
  for (const net of [-0.2, -0.1, 0, 0.1, 0.2, 0.3]) {
    const pts = [];
    for (const xv of [x0, x1]) { const yv = xv - net; if (yv >= y0 && yv <= y1) pts.push([X(xv), Y(yv)]); }
    for (const yv of [y0, y1]) { const xv = yv + net; if (xv >= x0 && xv <= x1) pts.push([X(xv), Y(yv)]); }
    if (pts.length >= 2) s += `<line x1="${pts[0][0]}" y1="${pts[0][1]}" x2="${pts[1][0]}" y2="${pts[1][1]}" style="stroke:var(--line-2);stroke-dasharray:2 5"/>`;
  }
  s += `<line x1="${X(avgX)}" x2="${X(avgX)}" y1="${M.t}" y2="${H - M.b}" style="stroke:var(--muted);stroke-dasharray:6 4;opacity:.6"/>
        <line x1="${M.l}" x2="${W - M.r}" y1="${Y(avgY)}" y2="${Y(avgY)}" style="stroke:var(--muted);stroke-dasharray:6 4;opacity:.6"/>`;
  const q = (x, y, a, txt) => `<text x="${x}" y="${y}" text-anchor="${a}" style="fill:var(--muted);font-size:11px;font-family:var(--font-ui)">${txt}</text>`;
  s += q(W - M.r - 4, M.t + 12, "end", "Good offense · good defense") + q(M.l + 4, M.t + 12, "start", "Bad offense · good defense")
     + q(W - M.r - 4, H - M.b - 6, "end", "Good offense · bad defense") + q(M.l + 4, H - M.b - 6, "start", "Bad offense · bad defense");
  teams.forEach((t) => {
    const cx = X(t.off_epa), cy = Y(t.def_epa);
    s += `<g><title>${t.team}: offense ${t.off_epa > 0 ? "+" : ""}${t.off_epa.toFixed(3)}, defense ${t.def_epa > 0 ? "+" : ""}${t.def_epa.toFixed(3)} EPA/play</title>
      <circle cx="${cx}" cy="${cy}" r="14" style="fill:var(--surface);stroke:var(--accent);stroke-width:1.5"/>
      <text x="${cx}" y="${cy + 3.5}" text-anchor="middle" style="fill:var(--text);font-size:9.5px;font-weight:600;font-family:var(--font-ui)">${t.team}</text>
      <image href="https://sleepercdn.com/images/team_logos/nfl/${t.team.toLowerCase()}.png" x="${cx - 13}" y="${cy - 13}" width="26" height="26" onerror="this.remove()"/></g>`;
  });
  s += `<text x="${(M.l + W - M.r) / 2}" y="${H - 6}" text-anchor="middle" style="fill:var(--text-2);font-size:12px;font-family:var(--font-ui)">Offense EPA per play →</text>
        <text transform="translate(14 ${(M.t + H - M.b) / 2}) rotate(-90)" text-anchor="middle" style="fill:var(--text-2);font-size:12px;font-family:var(--font-ui)">Defense EPA per play allowed (better ↑)</text>`;
  return `<div class="table-wrap">${s}</svg></div>`;
}
