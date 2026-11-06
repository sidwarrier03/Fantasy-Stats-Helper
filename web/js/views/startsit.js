import * as L from "../lib.js";

const st = { mode: null, league: null, roster: null, ids: [], slots: 1, example: false, init: false };
const SLOT_LABEL = { FLEX: "FLEX", SUPER_FLEX: "SFLEX", WRRB_FLEX: "W/R", REC_FLEX: "W/T" };

export async function render(root) {
  const connected = L.settings.leagues.length > 0;
  st.mode ??= connected ? "team" : "compare";
  root.innerHTML = `
    ${L.pageHead("Start / Sit", st.mode === "team"
      ? "Imports your roster from Sleeper, scores every player with your league's exact settings, and builds your best lineup for the week."
      : `Head-to-head lineup calls in ${L.esc(L.scoringLabel())}.`,
      L.seg("ssmode", [["team", "My Sleeper team"], ["compare", "Compare players"]], st.mode))}
    <div id="ss-body" style="display:grid;gap:16px">${L.loading()}</div>`;
  L.onSeg(root, { ssmode: (v) => { st.mode = v; render(root); } });
  const body = root.querySelector("#ss-body");
  if (st.mode === "team") await renderTeam(body, root);
  else await renderCompare(body);
}

// ------------------------------------------------------------------ my Sleeper team
async function renderTeam(body, root) {
  const leagues = L.settings.leagues;
  if (!leagues.length) {
    body.innerHTML = `<section class="card empty">
      <h2>Import your team from Sleeper</h2>
      <p>Enter your Sleeper username. Huddle reads your leagues (it never changes anything in Sleeper).</p>
      <form id="connect" class="toolbar" style="justify-content:center">
        <input type="text" id="ss-username" placeholder="your_sleeper_name" autocomplete="off" value="${L.esc(L.settings.username)}" style="width:220px">
        <button class="btn primary" type="submit">Import my team</button>
      </form><div id="connect-msg"></div></section>`;
    body.querySelector("#connect").onsubmit = async (e) => {
      e.preventDefault();
      const name = body.querySelector("#ss-username").value.trim();
      if (!name) return;
      body.querySelector("#connect-msg").innerHTML = L.loading("Finding your leagues");
      try {
        const d = await L.api("sleeper/leagues", { username: name });
        if (!d.leagues.length) throw new Error(`No ${d.season} leagues found for ${name}.`);
        L.setSetting({ username: name, userId: d.user.id, leagues: d.leagues.map((l) => ({ id: l.id, name: l.name, type: l.type, sf: l.sf })) }, { silent: true });
        window.dispatchEvent(new Event("huddle:leagues"));
        render(root);
      } catch (err) { body.querySelector("#connect-msg").innerHTML = L.errorBox(err); }
    };
    return;
  }

  if (!leagues.some((l) => l.id === st.league)) st.league = L.settings.ssLeague && leagues.some((l) => l.id === L.settings.ssLeague) ? L.settings.ssLeague : leagues[0].id;
  const d = await L.api("startsit/team", { league: st.league, roster: st.roster || "", owner: L.settings.userId || "", username: L.settings.username || "", scoring: "", fmt: "", qb: "" });
  const P = Object.fromEntries(d.players.map((p) => [p.id, p]));
  const recIds = new Set(d.rows.map((r) => r.rec).filter(Boolean));
  const gain = d.totals.rec_proj - d.totals.cur_proj;

  // Turn slot changes into readable swaps: "Start X over Y".
  const swaps = [];
  const benched = new Set(d.changes.bench);
  d.rows.filter((r) => r.state === "start").forEach((r) => {
    const out = r.cur && !recIds.has(r.cur) ? r.cur : [...benched].find((b) => P[b] && slotFits(r.slot, P[b].pos)) || null;
    if (out) benched.delete(out);
    swaps.push({ in: r.rec, out, slot: r.slot });
  });
  benched.forEach((b) => swaps.push({ in: null, out: b }));
  const scoring = `${d.league.ppr === 1 ? "PPR" : d.league.ppr === 0.5 ? "Half PPR" : d.league.ppr ? `${d.league.ppr} PPR` : "Standard"}${d.league.te_prem ? `, TE +${d.league.te_prem}` : ""}${d.league.pass_td && d.league.pass_td !== 4 ? `, ${d.league.pass_td}-pt pass TD` : ""}`;

  body.innerHTML = `
    <section class="card">
      <div class="toolbar">
        <label class="check">League <select id="ss-league">${leagues.map((l) => `<option value="${L.esc(l.id)}" ${l.id === st.league ? "selected" : ""}>${L.esc(l.name)}</option>`).join("")}</select></label>
        <label class="check">Team <select id="ss-roster">${d.teams.map((t) => `<option value="${t.roster_id}" ${t.roster_id === d.team.roster_id ? "selected" : ""}>${L.esc(t.name)}${t.mine ? " (you)" : ""}</option>`).join("")}</select></label>
        <span class="grow"></span>
        <span class="small muted">Week ${d.week} · ${L.esc(scoring)} scoring from this league</span>
        <button class="btn sm" id="ss-refresh" title="Reload your lineup from Sleeper">Reload</button>
      </div>
      ${!d.found_me && !st.roster ? `<div class="note" style="margin-top:12px">Couldn't find your team in this league, so this shows ${L.esc(d.team.name)}. Pick a team above.</div>` : ""}
    </section>

    <section class="card">
      <div class="card-head">
        <div><div class="eyebrow">${d.team.mine ? "Your lineup" : `${L.esc(d.team.owner)}'s lineup`} · week ${d.week}</div>
          <h2 style="font-size:1.35rem;margin-top:4px">${swaps.length ? `${swaps.length} change${swaps.length === 1 ? "" : "s"} recommended` : "Your lineup is already set right"}</h2></div>
        <div class="toolbar">
          <div class="stat-tile"><span class="l">Huddle lineup</span><span class="v">${L.n(d.totals.rec_proj)}</span><span class="small muted">projected</span></div>
          <div class="stat-tile"><span class="l">Set in Sleeper</span><span class="v">${L.n(d.totals.cur_proj)}</span><span class="small ${gain > 0.05 ? "up" : "muted"}">${gain > 0.05 ? `${L.signed(gain, 1)} with changes` : "projected"}</span></div>
        </div>
      </div>
      ${swaps.length ? `<div class="list">${swaps.map((s) => `<div class="li swap">
          ${s.in ? `<span class="pill good">Start</span>${miniPlayer(P[s.in])}` : ""}
          ${s.in && s.out ? `<span class="muted small">over</span>` : ""}
          ${s.out ? `${!s.in ? `<span class="pill bad">Bench</span>` : ""}${miniPlayer(P[s.out], true)}` : `${s.in ? `<span class="muted small">in your empty ${L.esc(SLOT_LABEL[s.slot] || s.slot)} spot</span>` : ""}`}
          <span class="grow"></span>
          ${s.in && s.out ? `<span class="small up" title="Difference in Huddle score (projection blended with recent form and matchup)">${L.signed(P[s.in].score - P[s.out].score, 1)} score</span>` : ""}
        </div>`).join("")}</div>
        <p class="small muted" style="margin:8px 0 0">Make these swaps in the Sleeper app; Huddle can only read your league.</p>` : ""}
      ${d.changes.empty ? `<div class="error-box" style="margin-top:10px">You have ${d.changes.empty} empty starting spot${d.changes.empty === 1 ? "" : "s"} in Sleeper.</div>` : ""}
    </section>

    <section class="card">
      <div class="card-head"><h2>Best lineup</h2><span class="sub">Starters chosen by Huddle score</span></div>
      <div class="table-wrap"><table class="data ss-table"><thead><tr>
        <th>Slot</th><th>Huddle lineup</th><th>Matchup</th><th class="n">Proj</th><th class="n">Last 3</th><th class="n">Score</th><th>Set in Sleeper now</th><th></th></tr></thead>
        <tbody>${d.rows.map((r) => lineupRow(r, P)).join("")}</tbody></table></div>
      ${d.unsupported.length ? `<p class="small muted" style="margin:10px 0 0">${L.esc(d.unsupported.join(", "))} spot${d.unsupported.length === 1 ? " isn't" : "s aren't"} scored by Huddle (individual defensive players), so set ${d.unsupported.length === 1 ? "it" : "them"} in Sleeper yourself.</p>` : ""}
    </section>

    <section class="card">
      <div class="card-head"><h2>Bench</h2><span class="sub">Everyone else who can play this week, best first</span></div>
      <div class="table-wrap"><table class="data ss-table"><thead><tr>
        <th>Player</th><th>Matchup</th><th class="n">Proj</th><th class="n">Last 3</th><th class="n">Score</th><th></th></tr></thead>
        <tbody>${d.players.filter((p) => !recIds.has(p.id)).map((p) => `<tr>
          <td>${playerBlock(p)}</td><td>${matchup(p)}</td><td class="n">${L.n(p.proj)}</td><td class="n">${L.n(p.l3)}</td><td class="n"><b>${L.n(p.score)}</b></td>
          <td>${p.locked ? `<span class="pill">Game started</span>` : p.starting ? `<span class="pill bad">Starting now · bench him</span>` : ""}</td></tr>`).join("")
          || `<tr><td colspan="6" class="muted">No bench players.</td></tr>`}</tbody></table></div>
      <p class="small muted" style="margin:10px 0 0">Huddle score ≈ 60% projection, 25% last-3-game average, 15% season average, nudged by the opponent's points allowed to the position, then discounted for injuries (Questionable −10%, Doubtful −75%, Out/IR to zero). Players whose game has kicked off are locked where they are.</p>
    </section>`;

  body.querySelector("#ss-league").onchange = (e) => {
    st.league = e.target.value; st.roster = null;
    L.setSetting({ ssLeague: st.league }, { silent: true });
    render(root);
  };
  body.querySelector("#ss-roster").onchange = (e) => {
    const t = d.teams.find((x) => String(x.roster_id) === e.target.value);
    st.roster = t && !t.mine ? e.target.value : null;
    render(root);
  };
  body.querySelector("#ss-refresh").onclick = () => render(root);
}

const slotFits = (slot, pos) => ({ FLEX: ["RB", "WR", "TE"], WRRB_FLEX: ["RB", "WR"], REC_FLEX: ["WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"] }[slot] || [slot]).includes(pos);

function miniPlayer(p, muted = false) {
  if (!p) return "";
  return `<span class="pcell" style="gap:7px">${L.avatar(p.id, p.name)}<span style="${muted ? "color:var(--muted)" : ""}"><a href="#player/${L.esc(p.id)}">${L.esc(p.name)}</a> <span class="small muted">${L.esc(p.pos)} · ${L.n(p.proj)}</span></span></span>`;
}

function playerBlock(p) {
  if (!p) return `<span class="muted">Nobody available</span>`;
  return `<div class="pcell">${L.avatar(p.id, p.name)}<div style="min-width:0">
    <div class="nm"><a href="#player/${L.esc(p.id)}">${L.esc(p.name)}</a> ${L.injTag(p.inj)}</div>
    <details class="why"><summary>${L.posTag(p.pos)} ${L.esc(p.team || "FA")} · why</summary><ul>${p.reasons.map((r) => `<li>${L.esc(r)}</li>`).join("")}</ul></details>
  </div></div>`;
}

function matchup(p) {
  if (!p) return "";
  if (!p.opp) return `<span class="pill bad">Bye</span>`;
  const line = `${p.home === false ? "@" : "vs"} ${L.esc(p.opp)}`;
  return `${line} ${p.opp_rank ? L.matchupPill(p.opp_rank) : ""}${p.actual != null ? `<div class="small muted">scored ${L.n(p.actual)}</div>` : ""}`;
}

function lineupRow(r, P) {
  const p = P[r.rec];
  const cur = r.cur ? P[r.cur] : null;
  const pill = {
    keep: `<span class="pill">No change</span>`,
    locked: `<span class="pill" title="This player's game has started, so his spot is locked in Sleeper">Locked</span>`,
    start: `<span class="pill good">Start</span>`,
    move: `<span class="pill accent" title="Already starting, but in a different spot">Move here</span>`,
    empty: `<span class="pill bad">Empty</span>`,
  }[r.state];
  return `<tr>
    <td><span class="slot-tag">${L.esc(SLOT_LABEL[r.slot] || r.slot)}</span></td>
    <td>${playerBlock(p)}</td>
    <td>${matchup(p)}</td>
    <td class="n">${L.n(p?.proj)}</td><td class="n">${L.n(p?.l3)}</td><td class="n"><b>${L.n(p?.score)}</b></td>
    <td>${r.cur === r.rec ? `<span class="muted small">Same</span>` : cur ? `<span class="small">${L.esc(cur.name)} <span class="muted">${L.n(cur.score)}</span></span>` : r.cur ? `<span class="small muted">Player not on active roster</span>` : `<span class="small" style="color:var(--bad)">Empty</span>`}</td>
    <td>${pill}</td></tr>`;
}

// ------------------------------------------------------------------ compare players
async function renderCompare(body) {
  const idx = await L.loadIndex();
  if (!st.init && !st.ids.length) {
    const wrs = idx.filter((p) => p.pos === "WR").sort((a, b) => b.redraft_1qb - a.redraft_1qb);
    st.ids = [wrs[20], wrs[22], wrs[25]].filter(Boolean).map((p) => p.id);
    st.example = true;
  }
  st.init = true;
  const d = st.ids.length ? await L.api("startsit", { ids: st.ids.join(",") }) : { players: [], week: "" };
  const top = d.players[0]?.score || 1;

  body.innerHTML = `
    ${st.example ? `<div class="note" style="margin-bottom:14px">Example comparison. Remove these and add the players you are deciding between.</div>` : ""}
    <section class="card" style="margin-bottom:14px">
      <div class="toolbar">
        <div class="picker" id="add" style="width:300px"><input type="search" placeholder="Add a player you're deciding on…"></div>
        <label class="check">Starting spots <input type="number" id="slots" min="1" max="6" value="${st.slots}" style="width:58px"></label>
        <span class="grow"></span>
        <span class="small muted">Week ${d.week}</span>
        ${st.ids.length ? `<button class="btn" id="clear">Clear</button>` : ""}
      </div>
    </section>
    <div style="display:grid;gap:10px">
      ${d.players.map((p, i) => {
        const start = i < st.slots && p.score > 0;
        return `<div class="ss-card ${start ? "start" : ""}">
          <div style="display:grid;gap:8px;justify-items:center">${L.avatar(p.id, p.name, "")}<span class="pill ${start ? "good" : "bad"}">${start ? "Start" : "Sit"}</span></div>
          <div style="min-width:0">
            <div style="font-weight:600;font-size:1.02rem"><a href="#player/${p.id}">${L.esc(p.name)}</a> ${L.injTag(p.inj)}</div>
            <div class="small muted">${L.posTag(p.pos)} ${L.esc(p.team || "FA")} ${p.opp ? `${p.home === false ? "@" : "vs"} ${L.esc(p.opp)}` : "· no game"} ${p.opp_rank ? `· matchup ${L.matchupPill(p.opp_rank)}` : ""}</div>
            <ul>${p.reasons.map((r) => `<li>${L.esc(r)}</li>`).join("")}</ul>
          </div>
          <div class="ss-score"><div class="v">${L.n(p.score)}</div><div class="small muted">Huddle score</div>
            <div class="bar" style="width:110px;margin:6px 0 0 auto"><i style="width:${(100 * p.score) / top}%;background:${start ? "var(--good)" : "var(--muted)"}"></i></div>
            ${p.actual != null ? `<div class="small" style="margin-top:6px">Scored <b>${L.n(p.actual)}</b></div>` : ""}
            <button class="btn ghost sm" data-rm="${p.id}" style="margin-top:6px">Remove</button></div>
        </div>`;
      }).join("") || `<div class="card empty">Add two or more players to compare this week's options.</div>`}
    </div>
    ${d.players.length > 1 ? `<p class="small muted">Huddle score ≈ 60% projection, 25% last-3-game average, 15% season average, nudged by the opponent's points allowed to the position. Questionable players are discounted 10%, Doubtful 75%, Out/IR to zero.</p>` : ""}`;

  L.attachPicker(body.querySelector("#add"), {
    filter: (p) => p.pos !== "PICK" && !st.ids.includes(p.id),
    onPick: (p) => { if (st.example) { st.ids = []; st.example = false; } st.ids.push(p.id); renderCompare(body); },
  });
  body.querySelector("#slots").onchange = (e) => { st.slots = Math.max(1, +e.target.value || 1); renderCompare(body); };
  body.querySelector("#clear")?.addEventListener("click", () => { st.ids = []; st.example = false; renderCompare(body); });
  body.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { st.ids = st.ids.filter((x) => x !== b.dataset.rm); st.example = false; renderCompare(body); }));
}
