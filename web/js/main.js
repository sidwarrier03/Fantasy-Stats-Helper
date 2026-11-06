import * as L from "./lib.js";

const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ROUTES = {
  dashboard: { label: "Dashboard", icon: I('<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>'), load: () => import("./views/dashboard.js") },
  stats: { label: "Stats Database", icon: I('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'), load: () => import("./views/stats.js") },
  rankings: { label: "Rankings", icon: I('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'), load: () => import("./views/rankings.js") },
  compare: { label: "Compare Players", icon: I('<path d="M16 3h5v5M8 21H3v-5M21 3l-7 7M3 21l7-7"/>'), load: () => import("./views/compare.js") },
  sos: { label: "Strength of Schedule", icon: I('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>'), load: () => import("./views/sos.js") },
  trade: { label: "Trade Calculator", icon: I('<path d="M7 7h13l-4-4M17 17H4l4 4"/>'), load: () => import("./views/trade.js") },
  "start-sit": { label: "Start / Sit", icon: I('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'), load: () => import("./views/startsit.js") },
  waivers: { label: "Waiver Wire", icon: I('<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>'), load: () => import("./views/waivers.js") },
  leagues: { label: "My Leagues", icon: I('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'), load: () => import("./views/leagues.js") },
  portfolio: { label: "Portfolio", icon: I('<path d="M21 12a9 9 0 1 1-9-9v9z"/><path d="M12 3a9 9 0 0 1 9 9h-9z"/>'), load: () => import("./views/portfolio.js") },
  sql: { label: "SQL Console", icon: I('<path d="M4 17l6-6-6-6M12 19h8"/>'), load: () => import("./views/sql.js") },
  player: { hidden: true, load: () => import("./views/player.js"), nav: "stats" },
  league: { hidden: true, load: () => import("./views/league.js"), nav: "leagues" },
};
const GROUPS = [
  ["Overview", ["dashboard"]],
  ["Research", ["stats", "rankings", "compare", "sos"]],
  ["Tools", ["trade", "start-sit", "waivers"]],
  ["My teams", ["leagues", "portfolio"]],
  ["Data", ["sql"]],
];

const view = document.getElementById("view");
let lastVersion = null;
let renderSeq = 0;

function renderNav(active) {
  document.getElementById("nav").innerHTML = GROUPS.map(([g, keys]) => `<div class="nav-group"><div class="eyebrow">${g}</div>${
    keys.map((k) => `<a href="#${k}" class="${k === active ? "active" : ""}">${ROUTES[k].icon}${ROUTES[k].label}</a>`).join("")}</div>`).join("");
}

function renderSettings() {
  const s = L.settings;
  const leagueOpts = s.leagues.map((l) => `<option value="league:${L.esc(l.id)}" ${s.scoring === `league:${l.id}` ? "selected" : ""}>${L.esc(l.name)}</option>`).join("");
  const el = document.getElementById("settings");
  el.innerHTML = `${L.seg("fmt", [["dynasty", "Dynasty"], ["redraft", "Redraft"]], s.fmt)}
    ${L.seg("qb", [["1", "1QB"], ["2", "Superflex"]], s.qb)}
    <select id="scoring-select" aria-label="Scoring" title="Scoring used for every fantasy point on the site">
      <option value="ppr" ${s.scoring === "ppr" ? "selected" : ""}>PPR</option>
      <option value="half" ${s.scoring === "half" ? "selected" : ""}>Half PPR</option>
      <option value="std" ${s.scoring === "std" ? "selected" : ""}>Standard</option>
      ${leagueOpts ? `<optgroup label="My league scoring">${leagueOpts}</optgroup>` : ""}
    </select>
    <button class="btn ghost" id="theme-btn" title="Switch light / dark" aria-label="Switch theme">${I('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>')}</button>`;
  L.onSeg(el, { fmt: (v) => L.setSetting({ fmt: v }), qb: (v) => L.setSetting({ qb: v }) });
  el.querySelector("#scoring-select").onchange = (e) => L.setSetting({ scoring: e.target.value });
  el.querySelector("#theme-btn").onclick = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("huddle.theme", next); } catch {}
  };
}

async function route() {
  const seq = ++renderSeq;
  const [name, ...args] = decodeURIComponent(location.hash.slice(1) || "dashboard").split("/");
  const r = ROUTES[name] || ROUTES.dashboard;
  renderNav(r.nav || (ROUTES[name] ? name : "dashboard"));
  document.body.classList.remove("nav-open");
  document.title = `${r.label || ROUTES[r.nav]?.label || "Huddle"} · Huddle`;
  view.innerHTML = L.loading();
  try {
    const mod = await r.load();
    if (seq !== renderSeq) return;
    await mod.render(view, args, () => seq === renderSeq);
  } catch (e) {
    console.error(e);
    if (seq === renderSeq) view.innerHTML = L.errorBox(e);
  }
}

function renderSync(st) {
  const u = st.updater || {};
  const wk = st.week || {};
  const err = u.last_error;
  const label = u.running ? (u.step || "Updating") : err ? "Last update had errors" : `Updated ${L.timeAgo(st.last_sync)}`;
  document.getElementById("sync-card").innerHTML = `
    <div class="eyebrow">${wk.season || ""} season · Week ${wk.week || "–"}</div>
    <div class="sync-row"><span class="dot ${u.running ? "busy" : err ? "err" : ""}"></span><span title="${L.esc(err || "")}">${L.esc(label)}</span></div>
    <div class="small muted">${L.int(st.counts?.stat_rows)} player-games · ${L.int(st.counts?.players)} players</div>
    <button class="btn sm" id="sync-btn" ${u.running ? "disabled" : ""}>${I('<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/>')}Update now</button>`;
  document.getElementById("sync-btn").onclick = async () => {
    await L.api("update", {}, { force: false });
    L.toast("Checking for new stats…");
    setTimeout(poll, 800);
  };
}

let pollTimer;
async function poll() {
  clearTimeout(pollTimer);
  let delay = 30000;
  try {
    const st = await L.api("status");
    renderSync(st);
    if (lastVersion === null) lastVersion = st.version;
    else if (st.version !== lastVersion && !st.updater?.running) {
      lastVersion = st.version;
      L.loadIndex(true);
      L.toast("New data loaded");
      route();
    }
    if (st.updater?.running) delay = 2500;
    if (!st.counts?.stat_rows && st.updater?.running && !view.dataset.firstRun) {
      view.dataset.firstRun = "1";
      view.innerHTML = `<div class="empty"><h2>Building your database</h2><p>Downloading players, three seasons of weekly stats, projections and trade values. This takes under a minute the first time.</p></div>`;
    }
  } catch {
    document.getElementById("sync-card").innerHTML = `<div class="sync-row"><span class="dot err"></span>Can't reach the Huddle server. Is it still running?</div>`;
  }
  pollTimer = setTimeout(poll, delay);
}

L.attachPicker(document.getElementById("global-search"), {
  filter: (p) => p.pos !== "PICK",
  onPick: (p) => { location.hash = `#player/${p.id}`; },
});
document.getElementById("menu-btn").onclick = () => document.body.classList.toggle("nav-open");
document.getElementById("scrim").onclick = () => document.body.classList.remove("nav-open");
L.onSettings(() => { renderSettings(); route(); });
window.addEventListener("hashchange", route);
window.addEventListener("huddle:leagues", renderSettings);
renderSettings();
poll().then(route);
