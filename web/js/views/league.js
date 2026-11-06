import * as L from "../lib.js";

const st = { tab: "power", team: null, target: null, fmt: null, leagueId: null };
const P = 1.3;
const adjusted = (vals) => Math.pow(vals.reduce((a, v) => a + Math.pow(Math.max(0, v), P), 0), 1 / P);
const teamAvatar = (t) => (t.avatar
  ? `<span class="avatar" data-ini="${L.esc(t.team_name.slice(0, 2).toUpperCase())}"><img src="https://sleepercdn.com/avatars/thumbs/${L.esc(t.avatar)}" alt="" loading="lazy" onerror="this.parentNode.textContent=this.parentNode.dataset.ini"></span>`
  : L.avatar("", t.team_name));
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const winProb = (a, b) => 0.5 * (1 + erf((a - b) / (28 * Math.SQRT2)));

export async function render(root, [id]) {
  if (st.leagueId !== id) Object.assign(st, { tab: "power", team: null, target: null, fmt: null, leagueId: id });
  const d = await L.api("league", { id, fmt: st.fmt || "", scoring: "" });
  const lg = d.league;
  st.fmt = lg.fmt;
  const me = d.teams.find((t) => t.owner_id === L.settings.userId || t.co_owners.includes(L.settings.userId));
  st.team ??= (me || d.teams[0]).roster_id;
  const vkey = lg.fmt === "dynasty" ? "dyn" : "red";
  const scoringText = `${lg.ppr === 1 ? "PPR" : lg.ppr === 0.5 ? "Half PPR" : lg.ppr ? `${lg.ppr} PPR` : "Standard"}${lg.te_prem ? `, TE +${lg.te_prem}` : ""}${lg.pass_td !== 4 ? `, ${lg.pass_td}-pt pass TD` : ""}`;

  root.innerHTML = `
    ${L.pageHead(L.esc(lg.name), `${lg.season} · ${lg.teams} teams · ${lg.dynasty ? "Dynasty" : "Redraft"} · ${lg.sf ? "Superflex" : "1QB"} · ${scoringText}. Points use this league's exact scoring.`,
      `${L.seg("lfmt", [["dynasty", "Dynasty values"], ["redraft", "Redraft values"]], lg.fmt)}<a class="btn ghost" href="#leagues">All leagues</a>`)}
    <div class="tabs">
      ${[["power", "Power rankings"], ["rosters", "Rosters"], ["matchups", `Week ${d.week ?? ""} matchups`], ["finder", "Trade finder"]]
        .map(([k, l]) => `<button data-tab="${k}" class="${st.tab === k ? "on" : ""}">${l}</button>`).join("")}
    </div>
    <div id="tab"></div>`;

  const tab = root.querySelector("#tab");
  const byRoster = Object.fromEntries(d.teams.map((t) => [t.roster_id, t]));
  const allPlayers = Object.fromEntries(d.teams.flatMap((t) => t.players.map((p) => [p.id, { ...p, roster_id: t.roster_id }])));

  const views = {
    power() {
      const n = d.teams.length;
      const heat = (r) => `heat ${["heat-0", "heat-1", "heat-2", "heat-3", "heat-4"][Math.min(4, Math.floor(((r - 1) / n) * 5))]}`;
      tab.innerHTML = `<section class="card"><div id="pr"></div>
        <p class="small muted" style="margin:10px 0 0">Power blends best-lineup value (50%), total ${lg.fmt} asset value${lg.fmt === "dynasty" ? " including picks" : ""} (30%) and points scored (20%).
        Window: <b>Contender</b> = top third by starting-lineup value, <b>Rebuilding</b> = bottom third. Position cells show league rank (green = deepest).</p></section>`;
      L.dataTable(tab.querySelector("#pr"), {
        rows: d.teams, sort: "power", page: 40,
        rowClass: (t) => (me && t.roster_id === me.roster_id ? "mine" : ""),
        onRow: (t) => { st.team = t.roster_id; st.tab = "rosters"; render(root, [id]); },
        columns: [
          { key: "rank", label: "#", num: true, sort: false, render: (t) => d.teams.indexOf(t) + 1 },
          { key: "team_name", label: "Team", asc: true, render: (t) => `<div class="pcell">${teamAvatar(t)}<div><div class="nm">${L.esc(t.team_name)}${me && t.roster_id === me.roster_id ? ` <span class="pill accent">You</span>` : ""}</div><div class="meta">${L.esc(t.owner)}</div></div></div>` },
          { key: "wins", label: "Record", num: true, render: (t) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}` },
          { key: "pf", label: "PF", num: true },
          { key: "power", label: "Power", num: true, render: (t) => `<b>${L.n(t.power, 0)}</b>` },
          { key: "starter_value", label: "Lineup value", num: true, fmt: L.int, title: "Redraft value of the best possible starting lineup" },
          { key: "total", label: "Total value", num: true, fmt: L.int },
          { key: "proj_week", label: `Wk ${d.week ?? ""} proj`, num: true },
          { key: "ros", label: "ROS proj", num: true },
          { key: "wage", label: "Core age", num: true, asc: true, title: "Average age of QB/RB/WR/TE weighted by dynasty value" },
          { key: "window", label: "Window", render: (t) => `<span class="pill ${t.window === "Contender" ? "good" : t.window === "Rebuilding" ? "bad" : ""}">${t.window}</span>` },
          ...["QB", "RB", "WR", "TE"].map((p) => ({ key: `r${p}`, label: p, num: true, sortVal: (t) => -t.ranks[p], cls: (t) => heat(t.ranks[p]), render: (t) => L.ordinal(t.ranks[p]) })),
        ],
      });
    },
    rosters() {
      const t = byRoster[st.team];
      const lineup = new Set(t.lineup.map(([, pid]) => pid));
      const max = Math.max(1, ...Object.values(allPlayers).map((p) => p[vkey]));
      tab.innerHTML = `
        <div class="toolbar" style="margin:4px 0 12px"><select id="team">${d.teams.map((x) => `<option value="${x.roster_id}" ${x.roster_id === st.team ? "selected" : ""}>${L.esc(x.team_name)} (${L.esc(x.owner)})</option>`).join("")}</select>
          <span class="pill">${t.window}</span><span class="small muted">Total ${L.int(t.total)} · core age ${L.n(t.wage)} · power #${d.teams.indexOf(t) + 1}</span></div>
        <div class="grid g3"><section class="card span2"><div id="roster"></div>
          <p class="small muted" style="margin:10px 0 0">★ = Huddle's best projected lineup for week ${d.week ?? ""}.</p></section>
          <section class="card"><div class="card-head"><h2>Draft picks</h2><span class="sub">${L.int(t.pick_value)} total</span></div>
          <div class="list">${t.picks.map((pk) => `<div class="li"><span class="pos PICK">R${pk.round}</span><div class="grow">${pk.season} round ${pk.round}${pk.from !== t.roster_id ? `<div class="small muted">via ${L.esc(byRoster[pk.from]?.team_name || "another team")}</div>` : ""}</div><span class="right">${L.int(pk.value)}</span></div>`).join("") || `<div class="muted">No picks.</div>`}</div></section></div>`;
      const order = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
      L.dataTable(tab.querySelector("#roster"), {
        rows: t.players, sort: vkey, page: 60,
        onRow: (p) => { location.hash = `#player/${p.id}`; },
        columns: [
          { key: "pos", label: "Pos", asc: true, sortVal: (p) => order[p.pos] ?? 9, render: (p) => L.posTag(p.pos) },
          { key: "name", label: "Player", asc: true, render: (p) => L.playerCell(p, { meta: `${L.esc(p.team || "FA")} · ${p.slot === "ST" ? "Starter" : p.slot === "BN" ? "Bench" : p.slot}${lineup.has(p.id) ? " ★" : ""}` }) },
          { key: "age", label: "Age", num: true, asc: true },
          { key: vkey, label: "Value", num: true, render: (p) => L.valueBar(p[vkey], max) },
          { key: "ppg", label: "PPG", num: true },
          { key: "proj", label: `Wk ${d.week ?? ""}`, num: true },
          { key: "ros", label: "ROS", num: true },
        ],
      });
      tab.querySelector("#team").onchange = (e) => { st.team = +e.target.value; views.rosters(); };
    },
    matchups() {
      if (!d.matchups.length) { tab.innerHTML = `<div class="card empty">No matchups for this week.</div>`; return; }
      tab.innerHTML = `<div class="grid g2">${d.matchups.map((m) => {
        const [a, b] = m.sides;
        if (!b) return "";
        const ta = byRoster[a.roster_id], tb = byRoster[b.roster_id];
        const started = a.points > 0 || b.points > 0;
        const pa = winProb(a.proj, b.proj);
        const side = (s, t, al) => `<div style="text-align:${al};min-width:0"><div class="pcell" style="justify-content:${al === "right" ? "flex-end" : "flex-start"}">${al === "left" ? teamAvatar(t) : ""}<div class="nm">${L.esc(t.team_name)}</div>${al === "right" ? teamAvatar(t) : ""}</div>
          <div class="num" style="font-size:1.5rem;font-weight:600">${started ? L.n(s.points) : L.n(s.proj)}</div><div class="small muted">${started ? `proj ${L.n(s.proj)}` : "projected"}</div></div>`;
        return `<section class="card"><div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center">${side(a, ta, "left")}<span class="muted">vs</span>${side(b, tb, "right")}</div>
          <div class="tug" style="margin-top:12px"><div class="a" style="width:${pa * 100}%"></div><div class="b" style="width:${100 - pa * 100}%"></div></div>
          <div style="display:flex;justify-content:space-between" class="small muted"><span>${L.pct(pa)} to win</span><span>${L.pct(1 - pa)}</span></div></section>`;
      }).join("")}</div><p class="small muted">Win odds compare projected points of each team's set lineup, with typical weekly variance.</p>`;
    },
    finder() {
      const mine = byRoster[st.team];
      const others = Object.values(allPlayers).filter((p) => p.roster_id !== mine.roster_id && p[vkey] > 0).sort((a, b) => b[vkey] - a[vkey]);
      if (!st.target || !allPlayers[st.target] || allPlayers[st.target].roster_id === mine.roster_id) st.target = others[Math.min(others.length - 1, 15)]?.id;
      const target = allPlayers[st.target];
      let html = `<section class="card"><div class="toolbar">
        <label class="check">Your team <select id="me">${d.teams.map((x) => `<option value="${x.roster_id}" ${x.roster_id === st.team ? "selected" : ""}>${L.esc(x.team_name)}</option>`).join("")}</select></label>
        <label class="check">Player you want <select id="target">${others.map((p) => `<option value="${p.id}" ${p.id === st.target ? "selected" : ""}>${L.esc(p.name)} · ${p.pos} · ${L.esc(byRoster[p.roster_id].team_name)} (${L.int(p[vkey])})</option>`).join("")}</select></label>
      </div></section>`;
      if (target) {
        const owner = byRoster[target.roster_id];
        const need = ["QB", "RB", "WR", "TE"].sort((a, b) => owner.ranks[b] - owner.ranks[a])[0];
        const tv = target[vkey];
        const assets = [...mine.players.map((p) => ({ ...p, v: p[vkey] })),
          ...(lg.fmt === "dynasty" ? mine.picks.map((pk) => ({ id: `pk${pk.season}${pk.round}${pk.from}`, name: `${pk.season} round ${pk.round}`, pos: "PICK", v: pk.value })) : [])]
          .filter((a) => a.v > 0 && a.v < tv * 1.25);
        const pkgs = [];
        for (let i = 0; i < assets.length; i++) {
          pkgs.push([assets[i]]);
          for (let j = i + 1; j < assets.length; j++) pkgs.push([assets[i], assets[j]]);
        }
        const scored = pkgs.map((pk) => ({ pk, adj: adjusted(pk.map((a) => a.v)) }))
          .filter((x) => x.adj >= tv * 0.97 && x.adj <= tv * 1.12)
          .map((x) => ({ ...x, fit: x.pk.some((a) => a.pos === need) }))
          .sort((a, b) => (b.fit - a.fit) || (a.adj - b.adj))
          .slice(0, 12);
        html += `<section class="card"><div class="card-head"><h2>Offers for ${L.esc(target.name)}</h2>
          <span class="sub">${L.esc(owner.team_name)} is thinnest at <b>${need}</b> (${L.ordinal(owner.ranks[need])} in the league), so offers that send a ${need} come first.</span></div>
          <div class="grid g2">${scored.map((x) => `<div class="asset" style="align-items:flex-start"><div class="grow" style="display:grid;gap:6px">
            ${x.pk.map((a) => `<div class="pcell">${L.avatar(a.id, a.name)}<div><div>${L.esc(a.name)}</div><div class="small muted">${L.posTag(a.pos)} ${L.int(a.v)}</div></div></div>`).join("")}</div>
            <div class="right"><div class="num">${L.int(x.adj)}</div><div class="small muted">vs ${L.int(tv)}</div>${x.fit ? `<span class="pill good" style="margin-top:6px">Fills their need</span>` : ""}</div></div>`).join("")
            || `<div class="muted">No one- or two-asset package on your roster matches this value. Try the <a href="#trade/${target.id}" style="color:var(--accent)">trade calculator</a> for bigger deals.</div>`}</div>
          <p class="small muted" style="margin:10px 0 0">Packages are worth 97–112% of the target after the consolidation premium, so the other manager comes out even or slightly ahead.</p></section>`;
      }
      tab.innerHTML = html;
      tab.querySelector("#me").onchange = (e) => { st.team = +e.target.value; views.finder(); };
      tab.querySelector("#target").onchange = (e) => { st.target = e.target.value; views.finder(); };
    },
  };
  views[st.tab]();
  root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => {
    st.tab = b.dataset.tab;
    root.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
    views[st.tab]();
  }));
  L.onSeg(root, { lfmt: (v) => { st.fmt = v; render(root, [id]); } });
}
