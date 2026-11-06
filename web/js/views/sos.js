import * as L from "../lib.js";

let pos = "WR";
let span = "next4";

export async function render(root) {
  const d = await L.api("sos");
  const n = d.dvp.n || 32;
  const heat = (rank) => (rank == null ? "" : `heat-${Math.min(4, Math.floor(((rank - 1) / n) * 5))}`);

  root.innerHTML = `
    ${L.pageHead("Strength of Schedule", `How many ${L.esc(L.scoringLabel())} points each defense gives up per game, by position, from ${d.season} results, and what that means for every team's remaining schedule.`)}
    <div class="toolbar">${L.seg("pos", ["QB", "RB", "WR", "TE", "K", "DEF"].map((p) => [p, p]), pos)}
      <span class="legend"><span><i class="heat-0" style="background:color-mix(in srgb,var(--good) 42%,transparent)"></i>Soft matchup</span><span><i style="background:color-mix(in srgb,var(--bad) 40%,transparent)"></i>Tough matchup</span></span></div>
    <div class="grid g3">
      <section class="card">
        <div class="card-head"><h2>Points allowed to ${pos}</h2><span class="sub">League avg ${L.n(d.dvp.avg[pos])}/game</span></div>
        <div id="dvp"></div>
      </section>
      <section class="card span2">
        <div class="card-head"><h2>Remaining schedule for ${pos}s</h2>${L.seg("span", [["next4", "Next 4 weeks"], ["playoffs", "Weeks 15–17"], ["ros", "Rest of season"]], span)}</div>
        <div id="sched"></div>
        <p class="small muted" style="margin:8px 0 0">Each cell is the opponent, shaded by how soft that defense has been against ${pos}s. Sort by the average column to find the friendliest runs.</p>
      </section>
    </div>`;

  const dvpRows = Object.entries(d.dvp.teams).map(([team, v]) => ({ team, ...(v[pos] || {}) })).filter((r) => r.avg != null);
  L.dataTable(root.querySelector("#dvp"), {
    rows: dvpRows, sort: "rank", dir: 1, page: 40,
    columns: [
      { key: "rank", label: "Rk", num: true, d: 0, asc: true },
      { key: "team", label: "Defense", asc: true, render: (r) => `<div class="pcell">${L.avatar(r.team, r.team)}<span>${r.team}</span></div>` },
      { key: "avg", label: "Pts/G", num: true, cls: (r) => heat(r.rank) },
      { key: "diff", label: "vs avg", num: true, render: (r) => `<span class="${r.diff > 0 ? "up" : "down"}">${L.signed(r.diff, 1)}</span>` },
      { key: "g", label: "G", num: true, d: 0 },
    ],
  });

  const weeksFor = () => (span === "next4" ? d.weeks.slice(0, 4) : span === "playoffs" ? d.weeks.filter((w) => w >= 15 && w <= 17) : d.weeks);
  const drawSched = () => {
    const weeks = weeksFor();
    const rows = Object.entries(d.schedule).map(([team, s]) => {
      const cells = weeks.map((w) => {
        const opp = s[w];
        if (!opp) return { w, opp: "BYE" };
        const o = opp.replace("@", "");
        return { w, opp, rank: d.dvp.teams[o]?.[pos]?.rank, avg: d.dvp.teams[o]?.[pos]?.avg };
      });
      const real = cells.filter((c) => c.avg != null);
      return { team, cells, avg: real.length ? real.reduce((a, c) => a + c.avg, 0) / real.length : null };
    });
    rows.forEach((r) => (r.ease = r.avg));
    L.dataTable(root.querySelector("#sched"), {
      rows, sort: "ease", page: 40,
      columns: [
        { key: "team", label: "Team", asc: true, render: (r) => `<div class="pcell">${L.avatar(r.team, r.team)}<span>${r.team}</span></div>` },
        { key: "ease", label: "Avg allowed", num: true, title: "Average points these opponents allow to the position (higher = easier)" },
        ...weeks.map((w, i) => ({ key: `w${w}`, label: `W${w}`, sort: false, cls: (r) => `heat ${heat(r.cells[i].rank)}`,
          render: (r) => `<span title="${r.cells[i].avg != null ? `${L.n(r.cells[i].avg)} pts/g allowed` : ""}">${L.esc(r.cells[i].opp)}</span>` })),
      ],
    });
  };
  drawSched();
  L.onSeg(root, { pos: (v) => { pos = v; render(root); }, span: (v) => { span = v; drawSched(); } });
}
