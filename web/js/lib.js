// Shared helpers: settings, API, formatting, player cells, sortable tables, SVG charts, player picker.

// ---------------------------------------------------------------- settings
const DEFAULTS = { fmt: "dynasty", qb: "1", scoring: "ppr", username: "", leagues: [] };
export const settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("huddle.settings") || "{}") }; }
  catch { return { ...DEFAULTS }; }
})();
const listeners = new Set();
export function setSetting(patch, { silent = false } = {}) {
  Object.assign(settings, patch);
  try { localStorage.setItem("huddle.settings", JSON.stringify(settings)); } catch {}
  if (!silent) listeners.forEach((f) => f(patch));
}
export const onSettings = (f) => listeners.add(f);
export const scoringLabel = (s = settings.scoring) => {
  if (s === "ppr") return "PPR";
  if (s === "half") return "Half PPR";
  if (s === "std") return "Standard";
  const lg = settings.leagues.find((l) => `league:${l.id}` === s);
  return lg ? `${lg.name} scoring` : "League scoring";
};

// ---------------------------------------------------------------- api
export async function api(path, params = {}, body) {
  const q = new URLSearchParams();
  const all = { scoring: settings.scoring, fmt: settings.fmt, qb: settings.qb, ...params };
  for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== null && v !== "") q.set(k, v);
  const res = await fetch(`/api/${path}?${q}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
  if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

// ---------------------------------------------------------------- formatting
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
export const n = (v, d = 1) => (v == null || Number.isNaN(+v) ? "–" : Number(v).toFixed(d));
export const int = (v) => (v == null ? "–" : Math.round(v).toLocaleString());
export const pct = (v, d = 0) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);
export const signed = (v, d = 0) => (v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
export const trendCls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "muted");
export const ordinal = (k) => `${k}${k % 100 >= 11 && k % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[k % 10] || "th"}`;
export function timeAgo(ts) {
  if (!ts) return "never";
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

// ---------------------------------------------------------------- player bits
const INJ_SHORT = { Questionable: "Q", Doubtful: "D", Out: "OUT", IR: "IR", PUP: "PUP", Sus: "SUS", NA: "NA", DNR: "DNR" };
export const posTag = (p) => (p ? `<span class="pos ${esc(p)}">${esc(p)}</span>` : "");
export const injTag = (s) => (s ? `<span class="inj ${esc(s)}" title="${esc(s)}">${esc(INJ_SHORT[s] || s)}</span>` : "");
const initials = (name) => esc(String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase());
function imgSrc(id) {
  if (/^\d+$/.test(id)) return `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`;
  if (/^[A-Z]{2,3}$/.test(id)) return `https://sleepercdn.com/images/team_logos/nfl/${id.toLowerCase()}.png`;
  return null;
}
export function avatar(id, name, cls = "") {
  const src = imgSrc(String(id || ""));
  const ini = initials(name);
  return src
    ? `<span class="avatar ${cls}" data-ini="${ini}"><img src="${src}" alt="" loading="lazy" onerror="this.parentNode.textContent=this.parentNode.dataset.ini"></span>`
    : `<span class="avatar ${cls}">${ini}</span>`;
}
export function playerCell(r, { link = true, meta } = {}) {
  const isPick = r.pos === "PICK" || String(r.id).startsWith("FP_");
  const m = meta ?? [posTag(r.pos), isPick ? "Draft pick" : esc(r.team || "FA"), r.age ? `${n(r.age)} yrs` : ""].filter(Boolean).join(" ");
  const nm = link && !isPick ? `<a href="#player/${esc(r.id)}">${esc(r.name)}</a>` : esc(r.name);
  return `<div class="pcell">${avatar(r.id, r.name)}<div style="min-width:0"><div class="nm">${nm} ${injTag(r.inj)}</div><div class="meta">${m}</div></div></div>`;
}
export function valueBar(v, max) {
  return `<div class="vbar"><span class="num">${int(v)}</span><div class="bar"><i style="width:${Math.max(2, Math.min(100, (100 * (v || 0)) / (max || 1)))}%"></i></div></div>`;
}

// ---------------------------------------------------------------- table
export function dataTable(el, opts) {
  const { columns, page = 100, onRow, rowClass, empty = "Nothing matches these filters.", breakBefore } = opts;
  let rows = opts.rows || [];
  const st = { sort: opts.sort, dir: opts.dir ?? -1, limit: page };
  let view = [];
  const cell = (c, r, i) => {
    if (c.render) return c.render(r, i);
    const v = r[c.key];
    if (c.fmt) return c.fmt(v, r);
    return c.num ? n(v, c.d ?? 1) : esc(v ?? "–");
  };
  function sorted() {
    const c = columns.find((x) => x.key === st.sort);
    if (!c) return rows;
    const get = c.sortVal || ((r) => r[c.key]);
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null && y == null) return 0;
      if (x == null || x === "") return 1;
      if (y == null || y === "") return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * st.dir;
    });
  }
  function draw() {
    view = sorted();
    const shown = view.slice(0, st.limit);
    let body = "";
    shown.forEach((r, i) => {
      const brk = breakBefore && breakBefore(r, shown[i - 1], st.sort);
      if (brk) body += `<tr class="tier-break"><td colspan="${columns.length}">${brk}</td></tr>`;
      body += `<tr class="${onRow ? "clickable" : ""} ${rowClass ? rowClass(r) : ""}" data-i="${i}">${columns
        .map((c) => `<td class="${c.num ? "n" : ""} ${c.cls ? (typeof c.cls === "function" ? c.cls(r) : c.cls) : ""}">${cell(c, r, i)}</td>`).join("")}</tr>`;
    });
    el.innerHTML = `<div class="table-wrap" style="${opts.maxHeight ? `max-height:${opts.maxHeight};overflow-y:auto` : ""}"><table class="data"><thead><tr>${columns
      .map((c) => `<th class="${c.num ? "n" : ""} ${c.sort === false ? "" : "sortable"} ${st.sort === c.key ? "sorted" : ""}" data-k="${c.key}" ${c.title ? `title="${esc(c.title)}"` : ""}>${c.label}${st.sort === c.key ? (st.dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead><tbody>${
      body || `<tr><td colspan="${columns.length}" class="muted" style="text-align:center;padding:30px">${empty}</td></tr>`}</tbody></table></div>${
      view.length > st.limit ? `<div class="table-more"><button class="btn sm" data-more>Show ${Math.min(page, view.length - st.limit)} more of ${view.length - st.limit}</button></div>` : ""}`;
  }
  el.onclick = (e) => {
    const th = e.target.closest("th.sortable");
    if (th) {
      const c = columns.find((x) => x.key === th.dataset.k);
      if (st.sort === c.key) st.dir *= -1; else { st.sort = c.key; st.dir = c.asc ? 1 : -1; }
      st.limit = page; draw(); return;
    }
    if (e.target.closest("[data-more]")) { st.limit += page; draw(); return; }
    const tr = e.target.closest("tr[data-i]");
    if (tr && onRow && !e.target.closest("a,button,input,select")) onRow(view[+tr.dataset.i], e);
  };
  draw();
  return { update(r) { rows = r; st.limit = page; draw(); }, rows: () => view, redraw: draw };
}

export function downloadCSV(name, columns, rows) {
  const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const text = [columns.map((c) => q(c.label ?? c)).join(","), ...rows.map((r) => columns.map((c) => q(typeof c === "string" ? r[c] : (c.csv ? c.csv(r) : r[c.key]))).join(","))].join("\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "text/csv" })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- charts (hand-drawn SVG)
const niceMax = (v) => { if (v <= 0) return 10; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p * 2) / 2 * p; };

/** points: [{label, value|null, color, title}] */
export function barChart(points, { height = 190, avg, avgLabel = "avg", yMax } = {}) {
  const W = 640, H = height, L = 34, R = 10, T = 12, B = 24;
  const max = yMax || niceMax(Math.max(1, ...points.map((p) => p.value || 0), avg || 0));
  const bw = (W - L - R) / Math.max(points.length, 1);
  const y = (v) => T + (H - T - B) * (1 - Math.max(0, v) / max);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"><g class="grid">`;
  for (let i = 0; i <= 4; i++) { const v = (max / 4) * i; s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`; }
  s += "</g>";
  points.forEach((p, i) => {
    const x = L + i * bw + bw * 0.16, w = bw * 0.68;
    if (p.value == null) s += `<text x="${x + w / 2}" y="${H - B - 4}" text-anchor="middle">–</text>`;
    else s += `<rect x="${x}" y="${y(p.value)}" width="${w}" height="${Math.max(1, H - B - y(p.value))}" rx="3" style="fill:${p.color || "var(--accent)"}"><title>${esc(p.title || `${p.label}: ${n(p.value)}`)}</title></rect>`;
    s += `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${esc(p.label)}</text>`;
  });
  if (avg != null) s += `<line x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}" style="stroke:var(--text);stroke-dasharray:5 4;opacity:.55"/><text x="${W - R}" y="${y(avg) - 5}" text-anchor="end" style="fill:var(--text-2)">${avgLabel} ${n(avg)}</text>`;
  return s + "</svg>";
}

/** series: [{name, color, values: [..]}]; labels: x labels */
export function lineChart(series, labels, { height = 200, yFmt = (v) => Math.round(v), yMax, area = false } = {}) {
  const W = 640, H = height, L = 38, R = 12, T = 12, B = 24;
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  const max = yMax || niceMax(Math.max(1, ...all));
  const x = (i) => L + (labels.length < 2 ? (W - L - R) / 2 : (i * (W - L - R)) / (labels.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"><g class="grid">`;
  for (let i = 0; i <= 4; i++) { const v = (max / 4) * i; s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${yFmt(v)}</text>`; }
  s += "</g>";
  const step = Math.ceil(labels.length / 12);
  labels.forEach((lb, i) => { if (i % step === 0 || i === labels.length - 1) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(lb)}</text>`; });
  series.forEach((se) => {
    const segs = []; let cur = [];
    se.values.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), y(v), v, i]); });
    if (cur.length) segs.push(cur);
    segs.forEach((seg) => {
      if (area && seg.length > 1) s += `<path d="M${seg[0][0]},${y(0)} ${seg.map((p) => `L${p[0]},${p[1]}`).join(" ")} L${seg[seg.length - 1][0]},${y(0)}Z" style="fill:${se.color};opacity:.12"/>`;
      s += `<polyline points="${seg.map((p) => `${p[0]},${p[1]}`).join(" ")}" style="fill:none;stroke:${se.color};stroke-width:2.2;stroke-linejoin:round"/>`;
      seg.forEach((p) => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="3.2" style="fill:${se.color}"><title>${esc(se.name)} · ${esc(labels[p[3]])}: ${yFmt(p[2])}</title></circle>`; });
    });
  });
  return s + "</svg>";
}

export function sparkline(values, { w = 92, h = 24, color = "var(--accent)" } = {}) {
  const vals = values.map((v) => (v == null ? null : +v));
  const real = vals.filter((v) => v != null);
  if (real.length < 2) return `<span class="muted small">–</span>`;
  const max = Math.max(...real), min = Math.min(0, ...real);
  const x = (i) => 2 + (i * (w - 4)) / (vals.length - 1);
  const y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
  const pts = vals.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
  const last = vals.length - 1 - [...vals].reverse().findIndex((v) => v != null);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block"><polyline points="${pts.join(" ")}" style="fill:none;stroke:${color};stroke-width:1.6;opacity:.85"/><circle cx="${x(last)}" cy="${y(vals[last])}" r="2.4" style="fill:${color}"/></svg>`;
}

export const POS_COLOR = { QB: "var(--qb)", RB: "var(--rb)", WR: "var(--wr)", TE: "var(--te)", K: "var(--k)", DEF: "var(--def)", PICK: "var(--pick)" };
export const SERIES = ["var(--accent)", "var(--wr)", "var(--rb)", "var(--k)"];

// ---------------------------------------------------------------- player index + picker
let INDEX = null, indexPromise = null;
export function loadIndex(force = false) {
  if (force) { INDEX = null; indexPromise = null; }
  if (INDEX) return Promise.resolve(INDEX);
  indexPromise ??= api("index").then((d) => {
    INDEX = d.rows.map((r) => Object.fromEntries(d.fields.map((k, i) => [k, r[i]])));
    INDEX.forEach((p) => { p.q = norm(p.name); });
    return INDEX;
  }).catch((e) => { indexPromise = null; throw e; });
  return indexPromise;
}
export const valueKey = (fmt = settings.fmt, qb = settings.qb) => `${fmt === "dynasty" ? "dynasty" : "redraft"}_${qb === "2" ? "sf" : "1qb"}`;
export const valueOf = (p, fmt, qb) => (p && p[valueKey(fmt, qb)]) || 0;

export function attachPicker(wrap, { onPick, filter, clearOnPick = true }) {
  const input = wrap.querySelector("input");
  let dd = null, items = [], hl = 0;
  const close = () => { dd?.remove(); dd = null; };
  const pick = (p) => { if (clearOnPick) input.value = ""; close(); onPick(p); };
  const render = () => {
    close();
    if (!items.length) return;
    dd = document.createElement("div");
    dd.className = "dropdown";
    dd.innerHTML = items.map((p, i) => `<div class="li ${i === hl ? "hl" : ""}" data-i="${i}">${avatar(p.id, p.name)}<div class="grow"><div>${esc(p.name)}</div><div class="small muted">${posTag(p.pos)} ${esc(p.pos === "PICK" ? "Draft pick" : p.team || "FA")}</div></div><div class="right small muted">${int(valueOf(p))}</div></div>`).join("");
    dd.addEventListener("mousedown", (e) => { const li = e.target.closest(".li"); if (li) { e.preventDefault(); pick(items[+li.dataset.i]); } });
    wrap.appendChild(dd);
  };
  input.addEventListener("input", async () => {
    const idx = await loadIndex();
    const q = norm(input.value);
    if (!q) { items = []; close(); return; }
    items = idx.filter((p) => p.q.includes(q) && (!filter || filter(p)))
      .sort((a, b) => (b.q.startsWith(q) - a.q.startsWith(q)) || (Math.max(b.dynasty_1qb, b.redraft_1qb) - Math.max(a.dynasty_1qb, a.redraft_1qb)))
      .slice(0, 8);
    hl = 0; render();
  });
  input.addEventListener("keydown", (e) => {
    if (!dd) return;
    if (e.key === "ArrowDown") { hl = Math.min(items.length - 1, hl + 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { hl = Math.max(0, hl - 1); render(); e.preventDefault(); }
    else if (e.key === "Enter") { pick(items[hl]); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
}

// ---------------------------------------------------------------- misc ui
export function toast(msg, ms = 2600) {
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
export const loading = (what = "Loading") => `<div class="loading">${esc(what)}…</div>`;
export const errorBox = (e) => `<div class="error-box">${esc(e.message || e)}</div>`;
export function seg(name, options, current) {
  return `<div class="seg" data-seg="${name}">${options.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${String(current) === String(v) ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
}
export function onSeg(root, handlers) {
  root.querySelectorAll("[data-seg]").forEach((s) => s.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b || !handlers[s.dataset.seg]) return;
    s.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    handlers[s.dataset.seg](b.dataset.v);
  }));
}
export function pageHead(title, sub, right = "") {
  return `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="toolbar">${right}</div></div>`;
}
export const matchupPill = (rank, total = 32) => {
  if (!rank) return `<span class="pill">–</span>`;
  const cls = rank <= 8 ? "good" : rank > total - 8 ? "bad" : "";
  return `<span class="pill ${cls}" title="Rank by fantasy points allowed to this position (1 = most allowed)">${ordinal(rank)}</span>`;
};
