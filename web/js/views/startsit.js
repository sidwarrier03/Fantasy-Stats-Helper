import * as L from "../lib.js";

const st = { ids: [], slots: 1, example: false, init: false };

export async function render(root) {
  const idx = await L.loadIndex();
  if (!st.init && !st.ids.length) {
    const wrs = idx.filter((p) => p.pos === "WR").sort((a, b) => b.redraft_1qb - a.redraft_1qb);
    st.ids = [wrs[20], wrs[22], wrs[25]].filter(Boolean).map((p) => p.id);
    st.example = true;
  }
  st.init = true;
  const d = st.ids.length ? await L.api("startsit", { ids: st.ids.join(",") }) : { players: [], week: "" };
  const top = d.players[0]?.score || 1;

  root.innerHTML = `
    ${L.pageHead("Start / Sit", `Week ${d.week} lineup decisions in ${L.esc(L.scoringLabel())}. Blends this week's projection with recent form and how the opponent defends the position, then adjusts for injury status.`)}
    ${st.example ? `<div class="note">Example comparison. Remove these and add the players you are deciding between.</div>` : ""}
    <section class="card">
      <div class="toolbar">
        <div class="picker" id="add" style="width:300px"><input type="search" placeholder="Add a player you're deciding on…"></div>
        <label class="check">Starting spots <input type="number" id="slots" min="1" max="6" value="${st.slots}" style="width:58px"></label>
        <span class="grow"></span>
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

  L.attachPicker(root.querySelector("#add"), {
    filter: (p) => p.pos !== "PICK" && !st.ids.includes(p.id),
    onPick: (p) => { if (st.example) { st.ids = []; st.example = false; } st.ids.push(p.id); render(root); },
  });
  root.querySelector("#slots").onchange = (e) => { st.slots = Math.max(1, +e.target.value || 1); render(root); };
  root.querySelector("#clear")?.addEventListener("click", () => { st.ids = []; st.example = false; render(root); });
  root.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { st.ids = st.ids.filter((x) => x !== b.dataset.rm); st.example = false; render(root); }));
}
