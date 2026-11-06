import * as L from "../lib.js";

// Consolidation premium: package value = (Σ vᵢ^P)^(1/P). One elite asset beats two good ones with the same raw total.
const P = 1.3;
const adjusted = (vals) => (vals.length ? Math.pow(vals.reduce((a, v) => a + Math.pow(Math.max(0, v), P), 0), 1 / P) : 0);
const FAIR = 0.05;

const st = { give: [], get: [], example: false, init: false };

export async function render(root, args) {
  const idx = await L.loadIndex();
  const byId = Object.fromEntries(idx.map((p) => [p.id, p]));
  if (args[0] && byId[args[0]] && !st.get.includes(args[0]) && !st.give.includes(args[0])) {
    if (st.example) { st.give = []; st.get = []; st.example = false; }
    st.get.push(args[0]);
    history.replaceState(null, "", "#trade");
  }
  if (!st.init && !st.give.length && !st.get.length) {
    const ranked = idx.filter((p) => p.pos !== "PICK").sort((a, b) => L.valueOf(b) - L.valueOf(a));
    const pick = idx.find((p) => p.pos === "PICK" && /1st$/.test(p.name));
    st.give = [ranked[9]?.id].filter(Boolean);
    st.get = [ranked[18]?.id, pick?.id].filter(Boolean);
    st.example = true;
  }
  st.init = true;
  const dyn = L.settings.fmt === "dynasty";
  const val = (id) => L.valueOf(byId[id]);
  const sideVals = (side) => side.map(val);
  const giveAdj = adjusted(sideVals(st.give)), getAdj = adjusted(sideVals(st.get));
  const giveRaw = sideVals(st.give).reduce((a, b) => a + b, 0), getRaw = sideVals(st.get).reduce((a, b) => a + b, 0);
  const big = Math.max(giveAdj, getAdj) || 1;
  const diff = (getAdj - giveAdj) / big;
  const any = st.give.length && st.get.length;
  let verdict = "Add players or picks to both sides";
  let tone = "";
  if (any) {
    if (Math.abs(diff) <= FAIR) { verdict = "Fair trade"; tone = "accent"; }
    else if (diff > 0) { verdict = `You win this trade by ${L.int(getAdj - giveAdj)}`; tone = "good"; }
    else { verdict = `You overpay by ${L.int(giveAdj - getAdj)}`; tone = "bad"; }
  }

  // Suggestions that would even the trade out, added to the lighter side.
  let suggestions = [];
  let lightSide = null;
  if (any && Math.abs(diff) > FAIR) {
    lightSide = getAdj < giveAdj ? "get" : "give";
    const target = Math.max(giveAdj, getAdj);
    const cur = sideVals(st[lightSide]);
    const used = new Set([...st.give, ...st.get]);
    suggestions = idx.filter((p) => !used.has(p.id) && L.valueOf(p) > 0 && (dyn || p.pos !== "PICK"))
      .map((p) => ({ p, after: adjusted([...cur, L.valueOf(p)]) }))
      .filter((x) => Math.abs(x.after - target) / target <= 0.04)
      .sort((a, b) => Math.abs(a.after - target) - Math.abs(b.after - target))
      .slice(0, 8).map((x) => x.p);
  }

  const assetList = (side) => st[side].map((id) => {
    const p = byId[id];
    const isPick = p.pos === "PICK";
    return `<div class="asset">${L.avatar(p.id, p.name)}<div class="grow">
        <div>${isPick ? L.esc(p.name) : `<a href="#player/${L.esc(p.id)}">${L.esc(p.name)}</a>`}</div>
        <div class="small muted">${L.posTag(p.pos)} ${isPick ? "Draft pick" : `${L.esc(p.team || "FA")}${p.age ? ` · ${L.n(p.age)} yrs` : ""}`}</div></div>
      <span class="num">${L.int(val(id))}</span><button class="x" data-rm="${side}:${id}" aria-label="Remove">✕</button></div>`;
  }).join("") || `<div class="muted small" style="padding:10px 2px">Nothing added yet.</div>`;

  const share = giveAdj + getAdj ? (giveAdj / (giveAdj + getAdj)) * 100 : 50;
  root.innerHTML = `
    ${L.pageHead("Trade Calculator", `${dyn ? "Dynasty" : "Redraft"} ${L.settings.qb === "2" ? "Superflex" : "1QB"} values. Change the format in the top bar.`,
      `<button class="btn" id="swap">Swap sides</button><button class="btn" id="clear">Clear</button>`)}
    ${st.example ? `<div class="note">This is an example trade so you can see how it works. Clear it and add your own players.</div>` : ""}
    <div class="trade-grid">
      ${["give", "get"].map((side) => `
      <section class="card">
        <div class="card-head"><h2>${side === "give" ? "You give" : "You get"}</h2>
          <span class="sub">Total ${L.int(side === "give" ? giveRaw : getRaw)} · adjusted <b class="num" style="color:var(--text)">${L.int(side === "give" ? giveAdj : getAdj)}</b></span></div>
        <div class="picker" data-side="${side}" style="margin-bottom:10px"><input type="search" placeholder="Add player${dyn ? " or pick" : ""}…"></div>
        <div style="display:grid;gap:8px">${assetList(side)}</div>
      </section>`).join("")}
    </div>
    <section class="card">
      <div class="card-head"><div class="verdict ${tone ? `pill ${tone}` : ""}" style="${tone ? "font-size:1rem;padding:6px 14px" : ""}">${verdict}</div>
        ${any ? `<span class="sub">${L.pct(Math.abs(diff), 1)} difference in adjusted value</span>` : ""}</div>
      <div class="tug"><div class="a" style="width:${share}%"></div><div class="b" style="width:${100 - share}%"></div></div>
      <div style="display:flex;justify-content:space-between" class="small muted"><span>You give</span><span>You get</span></div>
      ${suggestions.length ? `<h3 style="margin-top:16px">To even it out, ${lightSide === "get" ? "ask for" : "add"} one of these</h3>
        <div class="grid g4" style="margin-top:10px">${suggestions.map((p) => `<button class="asset" style="border:0;cursor:pointer;text-align:left" data-add="${lightSide}:${p.id}">${L.avatar(p.id, p.name)}<div class="grow"><div>${L.esc(p.name)}</div><div class="small muted">${L.posTag(p.pos)} ${L.esc(p.pos === "PICK" ? "Pick" : p.team || "FA")}</div></div><span class="num small">${L.int(L.valueOf(p))}</span></button>`).join("")}</div>` : ""}
      <p class="small muted" style="margin:14px 0 0">Adjusted value adds a consolidation premium: in a real trade one elite asset is worth more than several good ones with the same raw total, because the side getting the best player also frees a roster spot. Values come from FantasyCalc and refresh every few hours.</p>
    </section>`;

  root.querySelectorAll(".picker[data-side]").forEach((w) => L.attachPicker(w, {
    filter: (p) => (dyn || p.pos !== "PICK") && !st.give.includes(p.id) && !st.get.includes(p.id),
    onPick: (p) => { clearExample(); st[w.dataset.side].push(p.id); render(root, []); },
  }));
  root.onclick = (e) => {
    const rm = e.target.closest("[data-rm]");
    const add = e.target.closest("[data-add]");
    if (rm) { const [side, id] = rm.dataset.rm.split(":"); st[side] = st[side].filter((x) => x !== id); st.example = false; render(root, []); }
    if (add) { const [side, id] = add.dataset.add.split(":"); st[side].push(id); st.example = false; render(root, []); }
  };
  root.querySelector("#swap").onclick = () => { [st.give, st.get] = [st.get, st.give]; render(root, []); };
  root.querySelector("#clear").onclick = () => { st.give = []; st.get = []; st.example = false; render(root, []); };
}

function clearExample() {
  if (st.example) { st.give = []; st.get = []; st.example = false; }
}
