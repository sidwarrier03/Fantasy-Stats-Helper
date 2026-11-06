import * as L from "../lib.js";

export async function render(root) {
  const username = L.settings.username;
  root.innerHTML = `
    ${L.pageHead("My Leagues", "Connect your Sleeper account to get power rankings, rosters with values, weekly matchups and a trade finder for each league. Nothing is posted to Sleeper; Huddle only reads public league data.")}
    <section class="card">
      <form id="form" class="toolbar">
        <label class="check" for="username">Sleeper username</label>
        <input type="text" id="username" value="${L.esc(username)}" placeholder="your_sleeper_name" autocomplete="off" style="width:220px">
        <button class="btn primary" type="submit">${username ? "Refresh leagues" : "Connect"}</button>
        ${username ? `<button class="btn ghost" type="button" id="forget">Disconnect</button>` : ""}
      </form>
    </section>
    <div id="out">${username ? L.loading("Loading your leagues") : ""}</div>`;

  const form = root.querySelector("#form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = root.querySelector("#username").value.trim();
    if (!name) return;
    L.setSetting({ username: name }, { silent: true });
    await load(root, name);
  };
  root.querySelector("#forget")?.addEventListener("click", () => {
    L.setSetting({ username: "", userId: "", leagues: [], scoring: L.settings.scoring.startsWith("league:") ? "ppr" : L.settings.scoring });
  });
  if (username) await load(root, username);
}

async function load(root, name) {
  const out = root.querySelector("#out");
  out.innerHTML = L.loading("Loading your leagues");
  try {
    const d = await L.api("sleeper/leagues", { username: name });
    const changed = JSON.stringify(L.settings.leagues.map((l) => l.id)) !== JSON.stringify(d.leagues.map((l) => l.id));
    L.setSetting({ userId: d.user.id, leagues: d.leagues.map((l) => ({ id: l.id, name: l.name, type: l.type, sf: l.sf })) }, { silent: true });
    if (changed) window.dispatchEvent(new Event("huddle:leagues"));
    out.innerHTML = `
      <div class="toolbar" style="margin-bottom:12px">${d.user.avatar ? `<img class="avatar" src="https://sleepercdn.com/avatars/thumbs/${L.esc(d.user.avatar)}" alt="" onerror="this.remove()">` : ""}
        <h2>${L.esc(d.user.name)}'s ${d.season} leagues</h2><span class="muted small">${d.leagues.length} league${d.leagues.length === 1 ? "" : "s"}</span>
        <span class="grow"></span><a class="btn" href="#portfolio">Player exposure across leagues →</a></div>
      <div class="grid g3">${d.leagues.map((l) => `
        <a class="card league-card" href="#league/${L.esc(l.id)}">
          <div class="pcell">${L.avatar("", l.name).replace("</span>", l.avatar ? `<img src="https://sleepercdn.com/avatars/thumbs/${L.esc(l.avatar)}" alt="" style="position:absolute;inset:0" onerror="this.remove()"></span>` : "</span>")}
            <div style="min-width:0"><div class="nm" style="font-weight:600">${L.esc(l.name)}</div><div class="small muted">${l.teams} teams · ${L.esc(l.status.replace("_", " "))}</div></div></div>
          <div class="chips">
            <span class="pill ${l.type === "dynasty" ? "accent" : ""}">${l.type[0].toUpperCase() + l.type.slice(1)}</span>
            <span class="pill">${l.sf ? "Superflex" : "1QB"}</span>
            <span class="pill">${l.ppr === 1 ? "PPR" : l.ppr === 0.5 ? "Half PPR" : l.ppr ? `${l.ppr} PPR` : "Standard"}</span>
            ${l.te_prem ? `<span class="pill">TE +${l.te_prem}</span>` : ""}
          </div></a>`).join("") || `<div class="card empty">No leagues found for ${L.esc(d.season)}.</div>`}</div>
      <p class="small muted">Tip: the scoring menu in the top bar now lists these leagues, so every stat on the site can be scored with a league's exact settings.</p>`;
  } catch (e) {
    out.innerHTML = L.errorBox(e);
  }
}
