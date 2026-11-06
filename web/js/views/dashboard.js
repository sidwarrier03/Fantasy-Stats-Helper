import * as L from "../lib.js";

let topPos = "QB";

export async function render(root) {
  const d = await L.api("dashboard");
  const wk = d.week;
  const valueLabel = `${L.settings.fmt === "dynasty" ? "Dynasty" : "Redraft"} ${L.settings.qb === "2" ? "SF" : "1QB"}`;
  const gameDay = (g) => new Date(`${g.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
  const done = d.games.filter((g) => g.status === "complete").length;

  root.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">${wk.season} NFL season · ${L.esc(L.scoringLabel())}</div>
        <div class="big">Week <em>${wk.upcoming || wk.week}</em> ${wk.upcoming ? "is on" : "is wrapped"}</div>
        <div class="muted">${wk.last_done ? `Week ${wk.last_done} stats are final.` : ""} ${d.games.length ? `${done} of ${d.games.length} games played this week.` : ""}</div>
      </div>
      <div class="toolbar">
        <a class="btn primary" href="#start-sit">Start / Sit</a>
        <a class="btn" href="#trade">Trade calculator</a>
        <a class="btn" href="#waivers">Waiver wire</a>
      </div>
    </section>

    <div class="grid g3">
      <section class="card span2">
        <div class="card-head"><h2>Top scorers · ${d.top_week.season} week ${d.top_week.week}</h2>
          ${L.seg("toppos", ["QB", "RB", "WR", "TE"].map((p) => [p, p]), topPos)}</div>
        <div class="list" id="top-list"></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>This week's games</h2><span class="sub">Week ${wk.upcoming || wk.week}</span></div>
        <div class="list">${d.games.map((g) => `
          <div class="li"><span class="rank-n small">${gameDay(g)}</span>
            <div class="grow">${L.esc(g.away)} <span class="muted">at</span> ${L.esc(g.home)}</div>
            ${g.status === "complete" ? `<span class="pill">Final</span>` : `<span class="pill accent">Upcoming</span>`}</div>`).join("") || `<div class="muted">No games scheduled.</div>`}
        </div>
      </section>
    </div>

    <div class="grid g2">
      <section class="card">
        <div class="card-head"><h2>Most added · last 24h</h2><a class="sub" href="#waivers">All trending →</a></div>
        <div class="list">${trendList(d.trending.add, "add")}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Most dropped · last 24h</h2><span class="sub">Sleeper leagues</span></div>
        <div class="list">${trendList(d.trending.drop, "drop")}</div>
      </section>
    </div>

    <div class="grid g3">
      <section class="card">
        <div class="card-head"><h2>Value risers</h2><span class="sub">${valueLabel} · 30 days</span></div>
        <div class="list">${movers(d.risers)}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Value fallers</h2><span class="sub">${valueLabel} · 30 days</span></div>
        <div class="list">${movers(d.fallers)}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Injury report</h2><span class="sub">Highest-value players</span></div>
        <div class="list">${d.injuries.map((p) => `
          <a class="li clickable" href="#player/${p.id}">${L.avatar(p.id, p.name)}
            <div class="grow"><div>${L.esc(p.name)}</div><div class="small muted">${L.posTag(p.pos)} ${L.esc(p.team)} · ${L.esc(p.part || "Undisclosed")}</div></div>
            ${L.injTag(p.status)}</a>`).join("") || `<div class="muted">No notable injuries.</div>`}</div>
      </section>
    </div>`;

  const drawTop = () => {
    const rows = d.top_week.players[topPos] || [];
    root.querySelector("#top-list").innerHTML = rows.map((p, i) => `
      <a class="li clickable" href="#player/${p.id}"><span class="rank-n">${i + 1}</span>${L.avatar(p.id, p.name)}
        <div class="grow"><div>${L.esc(p.name)} <span class="muted small">${L.esc(p.team)} vs ${L.esc(p.opp)}</span></div>
        <div class="small muted">${L.esc(p.line)}</div></div>
        <div class="right"><div style="font-size:1.1rem;font-weight:600">${L.n(p.pts)}</div><div class="small muted">pts</div></div></a>`).join("")
      || `<div class="muted">No games played yet.</div>`;
  };
  drawTop();
  L.onSeg(root, { toppos: (v) => { topPos = v; drawTop(); } });
}

function trendList(rows, kind) {
  if (!rows.length) return `<div class="muted">No trending data yet.</div>`;
  const max = Math.max(...rows.map((r) => r.count));
  return rows.slice(0, 8).map((p) => `
    <a class="li clickable" href="#player/${p.id}">${L.avatar(p.id, p.name)}
      <div class="grow"><div>${L.esc(p.name)} ${L.injTag(p.inj)}</div>
        <div class="small muted">${L.posTag(p.pos)} ${L.esc(p.team || "FA")}${p.l3 != null ? ` · ${L.n(p.l3)} ppg last 3` : ""}${p.proj != null ? ` · proj ${L.n(p.proj)}` : ""}</div></div>
      <div style="width:90px" class="right"><div class="small ${kind === "add" ? "up" : "down"}">${kind === "add" ? "+" : "−"}${L.int(p.count)}</div>
        <div class="bar"><i style="width:${(100 * p.count) / max}%;background:${kind === "add" ? "var(--good)" : "var(--bad)"}"></i></div></div></a>`).join("");
}

function movers(rows) {
  return rows.map((p) => `
    <a class="li clickable" href="#player/${p.id}">${L.avatar(p.id, p.name)}
      <div class="grow"><div>${L.esc(p.name)}</div><div class="small muted">${L.posTag(p.pos)} ${L.esc(p.team || "FA")} · ${L.int(p.value)}</div></div>
      <div class="right ${L.trendCls(p.trend30)}">${L.signed(p.trend30)}</div></a>`).join("") || `<div class="muted">No value data yet.</div>`;
}
