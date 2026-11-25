/* Core: state, router, helpers, Today (action queue), Roster (preset table), character detail.
   Fully static: catalog.json + browser-imported veterans (IndexedDB).
   Flow: Today → Roster → Loops → Plan a run → Borrows → Data (see views.js). */
const S = { cat: null, objectiveId: null, simPreselect: null };

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function copyText(text) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
    .then(() => toast(`Copied: ${text}`))
    .catch(() => { prompt("Copy:", text); });
}

/* In-game cross-reference memo, following the player's shorthand (e.g. 03303w0):
   blue★ per stat in Speed/Stamina/Power/Guts/Wit order + w + white-spark count. */
function suggestedMemo(c) {
  return STATS.map(s => c.summary.blue[s] || 0).join("") + "w" + c.summary.white_count;
}

function toast(msg, action, onAction) {
  const d = document.createElement("div");
  d.className = "msg";
  d.appendChild(document.createTextNode(msg));
  if (action) {
    const b = document.createElement("button");
    b.textContent = action;
    b.onclick = () => { d.remove(); onAction(); };
    d.appendChild(b);
  }
  $("#toast").appendChild(d);
  setTimeout(() => d.remove(), action ? 10000 : 3200);
}

/* re-render in place without losing the user's scroll position */
function rerender(fn) { const y = window.scrollY; fn(); window.scrollTo(0, y); }

/* prune/delete with a 10s Undo — the browser store is the only copy of this data */
async function pruneWithUndo(uids, label) {
  const backup = uids.map(u => DB.veterans[u]).filter(Boolean);
  if (!backup.length) { toast("Nothing selected"); return; }
  await DB.deleteVeterans(backup.map(v => v.uid));
  refreshRoster();
  rerender(route);
  toast(`${label} (${backup.length})`, "Undo", async () => {
    await DB.saveVeterans(backup);
    await linkLineage();
    refreshRoster();
    rerender(route);
    toast(`Restored ${backup.length} veteran(s)`);
  });
}

/* small form modal — replaces native prompt() chains.
   onOk returns false to keep the dialog open (validation). */
function formModal(title, bodyHtml, okLabel, onOk) {
  showModal(`<h2>${title}</h2>${bodyHtml}
    <div class="row" style="margin-top:12px">
      <button class="primary" id="fmok">${okLabel}</button>
      <button onclick="closeModal()">Cancel</button>
    </div>`);
  $("#fmok").onclick = async () => { if (await onOk() !== false) closeModal(); };
  $(".modal").addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox") {
      e.preventDefault(); $("#fmok").click();
    }
  });
  const first = $(".modal input, .modal select");
  if (first) first.focus();
}

async function boot() {
  try {
    const r = await fetch("data/catalog.json?v=11");   // cache-bust: stale catalogs break race schedules
    if (!r.ok) throw new Error("catalog.json missing — run: python etl/build_catalog.py");
    S.cat = await r.json();
    await DB.load();
    // re-parse veterans stored before base aptitudes / borrow flags existed
    const backfill = Object.values(DB.veterans).filter(v => v.raw &&
      (!v.base_aptitudes || v.ancestors.some(a => a.borrowed === undefined)));
    if (backfill.length) {
      const reparsed = backfill.map(v => {
        const p = parseVeteran(v.raw, S.cat, v.uid);
        if (v.keep) p.keep = true;
        return p;
      });
      await DB.saveVeterans(reparsed);
    }
    // auto-derive lineage: match ancestor snapshots to your own veterans
    await linkLineage();
    Engine.init(S.cat);
    S.objectiveId = Store.objectives()[0]?.id;
    window.addEventListener("hashchange", route);
    if (!Engine.roster.length && !location.hash) location.hash = "#/manage";
    route();
  } catch (e) {
    $("#main").innerHTML = `<div class="panel">Failed to load: ${esc(e.message)}</div>`;
  }
}

function refreshRoster() { Engine.setRoster(Object.values(DB.veterans)); }

const ROUTES = {};
function route() {
  const hash = location.hash || "#/dashboard";
  const [path, arg] = hash.slice(2).split("/");
  if (path !== "char") {
    $("#modal-root").innerHTML = "";   // navigating away closes any open modal
    $$("#nav a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#/" + path));
  }
  if (!Engine.roster.length && path !== "manage" && path !== "objectives") {
    $("#main").innerHTML = `<div class="panel"><h2>Welcome to Uma Tree 🌳</h2>
      <p>Import your <code>trained_chara_data.json</code> to get started. It is parsed and stored in your browser only — nothing is uploaded.</p>
      <ol class="small muted">
        <li>Extract your game data with <a href="https://werseter.github.io/umadump/" target="_blank" rel="noopener">UmaDump ↗</a>
          — it reads your local game database and produces <code>trained_chara_data.json</code>, <code>card_data.json</code>, …</li>
        <li>Open the <b>Data</b> tab and drop <b>all the extractor's files at once</b> — veterans and your owned-card list are recognised automatically.</li>
        <li>Lineage links, borrows and the tree are derived automatically. Then: Today → Roster → Loops → Plan a run.</li>
      </ol>
      ${gameFilesHelp()}
      <button class="primary" onclick="location.hash='#/manage'">📥 Import data</button></div>`;
    return;
  }
  if (path === "char") {
    // shareable character link: open the modal over the current page
    if (!$("#main").dataset.loaded) { ROUTES.dashboard(); $("#main").dataset.loaded = "1"; }
    showChar(arg);
    return;
  }
  try { (ROUTES[path] || ROUTES.dashboard)(arg); $("#main").dataset.loaded = "1"; }
  catch (e) { $("#main").innerHTML = `<div class="panel">Error: ${esc(e.message)}</div>`; console.error(e); }
}

/* Where the source files live — shown on first run and in the Data tab. */
function gameFilesHelp() {
  return `<details class="small muted" style="margin:8px 0">
    <summary>Where do I get these files?</summary>
    <ul class="reason-list">
      <li><b>Your veterans &amp; cards</b>: run <a href="https://werseter.github.io/umadump/" target="_blank" rel="noopener">UmaDump ↗</a>
        against your local game data — it produces <code>trained_chara_data.json</code> (veterans) and <code>card_data.json</code> (owned umas).</li>
      <li><b>master.mdb</b> (game catalog — only needed to rebuild <code>catalog.json</code> via <code>python etl/build_catalog.py</code>; the app ships with a prebuilt catalog):
        on Windows it is at <code>%USERPROFILE%\\AppData\\LocalLow\\cygames\\umamusume\\master\\master.mdb</code>
        (i.e. <code>~/AppData/LocalLow/cygames/umamusume/master/master.mdb</code>).
        On other devices the location varies — <a href="https://uma.moe/tools/master-data" target="_blank" rel="noopener">uma.moe hosts a copy ↗</a>.</li>
    </ul>
  </details>`;
}

/* ---------- shared render helpers ---------- */
const PORTRAIT_FALLBACK = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="#2a2620"/><text x="32" y="42" font-size="28" text-anchor="middle" fill="#9b9385" font-family="sans-serif">?</text></svg>`);
const portrait = (cardId, cls = "") => `<img class="portrait ${cls}" alt="" src="img/uma_portraits/${cardId}.png" loading="lazy" onerror="this.onerror=null;this.src='${PORTRAIT_FALLBACK}'">`;
const roleBadge = r => `<span class="badge ${r}">${r}</span>`;
const stars = n => "★".repeat(Math.max(0, Math.min(n, 9))) || "–";
const missingBadge = v => v && v.missing ? `<span class="badge archived" title="not in latest import">missing</span>` : "";
const ancBadge = a => a.borrowed
  ? `<span class="badge borrow" title="owner_viewer_id ${a.owner_viewer_id} — borrowed legacy">borrowed</span>`
  : a.matched_uid
    ? `<span class="badge leaf" title="matched to one of your veterans">yours</span>`
    : `<span class="badge archived" title="your veteran, since deleted — snapshot stored in the child">snapshot</span>`;

/* Outbound references — the app has no borrow-database access, so it recommends
   what to look for and links out to community borrow databases. */
const BORROW_LINKS = [
  ["uma.moe — friend & parent finder", "https://uma.moe/database"],
  ["Chronogenesis — borrow database", "https://chronogenesis.net/"],
];
const borrowLinksHtml = () => BORROW_LINKS.map(([n, u]) =>
  `<a href="${u}" target="_blank" rel="noopener">${esc(n)} ↗</a>`).join(" · ");

/* Plain-language \"what to look for in a borrow\" checklist from unmet targets. */
function borrowWishlist({ blueMissing = {}, pinkMissing = {}, whiteMissing = [], g1Name = null } = {}) {
  const out = [];
  for (const [k, v] of Object.entries(blueMissing)) if (v > 0) out.push(`${v}★+ ${cap(k)} blue`);
  for (const [k, v] of Object.entries(pinkMissing)) if (v > 0) out.push(`${v}★+ ${cap(k)} pink`);
  if (whiteMissing.length) out.push(`whites: ${whiteMissing.slice(0, 4).map(w => w.name || w).join(", ")}`);
  if (g1Name) out.push(`6+ shared G1 wins with ${g1Name}`);
  return out;
}

function sparkChips(s, max = 99) {
  const out = [];
  for (const b of s.blue || []) out.push(`<span class="sparkchip blue">${esc(b.name)} ${stars(b.stars)}</span>`);
  for (const p of s.pink || []) out.push(`<span class="sparkchip pink">${esc(p.name)} ${stars(p.stars)}</span>`);
  for (const g of s.green || []) out.push(`<span class="sparkchip green">${esc(g.name)} ${stars(g.stars)}</span>`);
  for (const w of (s.white || []).slice(0, max)) out.push(`<span class="sparkchip white">${esc(w.name)} ${stars(w.stars)}</span>`);
  if ((s.white || []).length > max) out.push(`<span class="sparkchip">+${s.white.length - max} white</span>`);
  for (const sc of s.scenario || []) out.push(`<span class="sparkchip scenario">${esc(sc.name)} ${stars(sc.stars)}</span>`);
  return out.join("");
}

/* Grouped white-spark display: skill / race / scenario, targets first & highlighted,
   long tails collapsed (the old flat chip wall was unreadable at 16+ whites). */
function groupedWhites(sparks, targetIds = new Set()) {
  const isT = w => targetIds.has(w.id);
  const byTarget = arr => [...arr].sort((a, b) => (isT(b) ? 1 : 0) - (isT(a) ? 1 : 0) || b.stars - a.stars);
  const chip = w => `<span class="sparkchip white${isT(w) ? " target" : ""}">${esc(w.name)} ${stars(w.stars)}${isT(w) ? " 🎯" : ""}</span>`;
  const block = (label, arr, show) => {
    if (!arr.length) return "";
    const rest = arr.slice(show);
    return `<div class="small muted" style="margin-top:5px">${label} (${arr.length})</div>` +
      arr.slice(0, show).map(chip).join("") +
      (rest.length ? `<details class="spark-more"><summary class="small muted">+${rest.length} more ${label.toLowerCase()}</summary>${rest.map(chip).join("")}</details>` : "");
  };
  return block("Skill", byTarget(sparks.white.filter(w => w.kind !== "race")), 8) +
    block("Race", byTarget(sparks.white.filter(w => w.kind === "race")), 6) +
    block("Scenario", sparks.scenario || [], 99);
}

const summaryChips = sm =>
  `<span class="sparkchip blue">B ${sm.blue_total}★</span>` +
  `<span class="sparkchip pink">P ${sm.pink_total}★</span>` +
  `<span class="sparkchip white">W ${sm.white_stars}★ (${sm.white_count})</span>` +
  `<span class="sparkchip green">G ${sm.green_stars}★</span>`;

function distChips(dist, cls, targets) {
  const keys = Object.keys(dist || {});
  if (!keys.length) return `<span class="muted small">none</span>`;
  return keys.map(k => {
    const t = targets && targets[k];
    const ok = t != null && dist[k] >= t;
    return `<span class="sparkchip ${cls}" ${t != null ? `title="target ${t}★"` : ""}>${k} ${dist[k]}★${t != null ? (ok ? " ✓" : ` / ${t}`) : ""}</span>`;
  }).join("");
}

/* legend for the score-bar segment colours (also shown near ranked tables) */
const CAT_LABELS = { white: "white", compatibility: "affinity", blue: "blue", pink: "pink", green: "green" };
const scoreLegend = () => `<span class="scorelegend">${CATS.map(k =>
  `<span class="key"><span class="sw cat-${k}"></span>${CAT_LABELS[k] || k}</span>`).join("")}</span>`;

function scoreBar(breakdown) {
  const segs = CATS.map(k => {
    const b = breakdown[k];
    return b && b.points > 0 ? `<div class="cat-${k}" style="width:${b.points}%" title="${k}: ${b.points} pts"></div>` : "";
  }).join("");
  return `<div class="scorebar">${segs}</div>`;
}

function aptGrid(aptitudes, projected) {
  return `<div class="apt-grid">` + APTS.map(a => {
    const v = aptitudes[a] ?? 1, p = projected ? projected[a] : null;
    const cls = v >= 8 ? "g8" : v >= 7 ? "g7" : v >= 6 ? "g6" : v >= 5 ? "g5" : "glow";
    return `<div class="apt-cell ${cls}" title="${a}${p ? ` → projected ${GL[p]}` : ""}"><b>${GL[v]}</b>${a.slice(0, 4)}${p && p > v ? `<div class="small">→${GL[p]}</div>` : ""}</div>`;
  }).join("") + `</div>`;
}

function objectiveSelect(id, roles) {
  const opts = Store.objectives().filter(o => !roles || roles.includes(o.role));
  return `<select id="${id}">` + opts.map(o =>
    `<option value="${o.id}">${esc(o.name)} (${o.role})</option>`).join("") + `</select>`;
}

/* character picker (uid-based) — combobox with keyboard navigation.
   Empty query on focus browses the roster, so you don't have to know a name. */
const PICKS = {};
function mountPicker(el, key, onPick, preselect) {
  PICKS[key] = preselect || null;
  el.classList.add("picker");
  el.innerHTML = `<input type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="pl-${key}"
      placeholder="Search character (name / memo / id)…" style="width:100%">
    <div class="picker-list" id="pl-${key}" role="listbox" style="display:none"></div>`;
  const inp = $("input", el), list = $(".picker-list", el);
  let active = -1;
  const render = () => {
    if (PICKS[key]) {
      const c = DB.veterans[PICKS[key]];
      if (c) inp.value = `${c.name}  #${c.id}  ${c.memo || ""}`;
    }
  };
  render();
  const opts = () => $$(".opt[data-uid]", list);
  const hide = () => { list.style.display = "none"; inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); };
  const pick = uid => { PICKS[key] = uid; hide(); render(); if (onPick) onPick(uid); };
  const setActive = i => {
    const os = opts();
    active = Math.max(-1, Math.min(i, os.length - 1));
    os.forEach((o, j) => { o.classList.toggle("active", j === active); o.setAttribute("aria-selected", j === active); });
    if (active >= 0) { inp.setAttribute("aria-activedescendant", os[active].id); os[active].scrollIntoView({ block: "nearest" }); }
    else inp.removeAttribute("aria-activedescendant");
  };
  const update = q => {
    const matches = (q ? Engine.roster.filter(c =>
      c.name.toLowerCase().includes(q) || (c.memo || "").toLowerCase().includes(q) || String(c.id) === q)
      : Engine.roster).slice(0, 30);
    list.innerHTML = matches.map((c, i) =>
      `<div class="opt" role="option" id="pl-${key}-${i}" data-uid="${c.uid}">${portrait(c.card_id, "sm")}<span>${esc(c.name)}</span><span class="small muted">#${c.id} ${esc(c.memo || "")}</span>${summaryChips(c.summary)}${missingBadge(c)}</div>`).join("")
      || `<div class="opt muted">no match</div>`;
    list.style.display = "block";
    inp.setAttribute("aria-expanded", "true");
    active = -1;
    opts().forEach(o => o.onclick = () => pick(o.dataset.uid));
  };
  inp.addEventListener("input", () => { PICKS[key] = null; update(inp.value.toLowerCase().trim()); });
  inp.addEventListener("focus", () => { if (!inp.value.trim()) update(""); });
  inp.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.style.display === "none") update(inp.value.toLowerCase().trim()); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter") {
      const os = opts();
      if (list.style.display !== "none" && os.length) { e.preventDefault(); e.stopPropagation(); pick(os[Math.max(0, active)].dataset.uid); }
    }
    else if (e.key === "Escape" && list.style.display !== "none") { e.stopPropagation(); hide(); }
  });
  inp.addEventListener("blur", () => setTimeout(hide, 200));
}

/* ---------- modal ---------- */
let MODAL_OPENER = null;
function showModal(html) {
  const root = $("#modal-root");
  const fresh = !root.firstChild;             // re-draws keep focus where it was
  if (fresh) MODAL_OPENER = document.activeElement;
  root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" tabindex="-1">
    <button class="close" onclick="closeModal()" aria-label="Close">✕</button>${html}</div></div>`;
  $(".modal-back", root).addEventListener("click", e => { if (e.target.classList.contains("modal-back")) closeModal(); });
  if (fresh) $(".modal", root).focus();
}
function closeModal() {
  $("#modal-root").innerHTML = "";
  if (MODAL_OPENER?.isConnected) MODAL_OPENER.focus();
  MODAL_OPENER = null;
  if (location.hash.startsWith("#/char/")) {   // modal opened via shareable link
    if (history.length > 1) history.back(); else location.hash = "#/roster";
  }
}

/* global keyboard: Escape closes the modal, Tab is trapped inside it,
   Enter/Space activates link-styled anchors and clickable table rows. */
document.addEventListener("keydown", e => {
  const modal = $(".modal");
  if (e.key === "Escape" && modal) { closeModal(); return; }
  if (e.key === "Tab" && modal) {
    const f = $$("a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex='-1'])", modal)
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("a[onclick], tr.clickable")) {
    e.preventDefault(); e.target.click();
  }
});

/* ---------- character detail ---------- */
function showChar(uid, objectiveId, catFocus) {
  const c = DB.veterans[uid];
  if (!c) { toast("Veteran not in browser store"); return; }
  const objs = Store.objectives();
  const leafObj = objs.find(x => x.role === "leaf") || objs[0];
  const pa = Engine.parentAffinity(c);
  let o, ev, headline, headLabel, barBd, bdRows, bestBlue, bestPink;
  if (catFocus && (catFocus.pink || catFocus.blue)) {
    // CATEGORY mode: exact same formula as Best by Category, so the score matches the list
    const lb = Engine.rawStarDist(c, "blue"), lp = Engine.rawStarDist(c, "pink");
    const pinkStars = catFocus.pink ? (lp[catFocus.pink] || 0) : Object.values(lp).reduce((a, b) => a + b, 0);
    const blueStars = catFocus.blue ? (lb[catFocus.blue] || 0) : Object.values(lb).reduce((a, b) => a + b, 0);
    // blue focus on expected value (proc×value: 3★ ≈ 5.4× 1★) — same as Engine.categoryRank
    const lev = blueEvDist(blueLists(c, false));
    const blueEV = catFocus.blue ? (lev[catFocus.blue] || 0) : Object.values(lev).reduce((a, b) => a + b, 0);
    const wsv = Engine.whiteSelfValue(c);
    const white = wsv.score;
    const aff = Math.min(1, pa.total / 180);
    const comps = { pink: [Math.min(1, pinkStars / 9), 35], blue: [Math.min(1, blueEV / starsToBlueEV(9)), 35],
      white: [white, 15], compatibility: [aff, 15] };
    barBd = {}; let total = 0;
    for (const [k, [sc, w]] of Object.entries(comps)) { const pts = sc * w; total += pts; barBd[k] = { points: pts }; }
    headline = +total.toFixed(1);
    headLabel = `Category: ${catFocus.pink || "any pink"} × ${catFocus.blue || "any blue"}`;
    o = leafObj;
    ev = Engine.evaluate(c, leafObj);   // issues & lineage distributions
    bdRows = `
      <tr><td><span class="sparkchip cat-pink" style="color:#0c1020">pink focus</span></td><td>${pinkStars}/9★</td><td>35</td><td><b>${(comps.pink[0] * 35).toFixed(1)}</b></td><td class="small muted">${esc(catFocus.pink || "any")}: ${fmtDist(lp)}</td></tr>
      <tr><td><span class="sparkchip cat-blue" style="color:#0c1020">blue focus</span></td><td>${blueStars}/9★</td><td>35</td><td><b>${(comps.blue[0] * 35).toFixed(1)}</b></td><td class="small muted">${esc(catFocus.blue || "any")}: ${fmtDist(lb)} → E +${blueEV.toFixed(1)} stats/inheritance</td></tr>
      <tr><td><span class="sparkchip cat-white" style="color:#0c1020">white</span></td><td>${(white * 100).toFixed(0)}%</td><td>15</td><td><b>${(white * 15).toFixed(1)}</b></td><td class="small muted">${wsv.count} sparks (${wsv.value} value-weighted ★; race ×0.5)</td></tr>
      <tr><td><span class="sparkchip cat-compatibility" style="color:#0c1020">affinity</span></td><td>${(aff * 100).toFixed(0)}%</td><td>15</td><td><b>${(aff * 15).toFixed(1)}</b></td><td class="small muted">${pa.total} pts (base ${pa.base} + races ${pa.race_points})</td></tr>`;
    bestBlue = catFocus.blue ? { target: { [catFocus.blue]: 9 }, missing: lb[catFocus.blue] >= 9 ? {} : { [catFocus.blue]: 9 - (lb[catFocus.blue] || 0) } } : null;
    bestPink = catFocus.pink ? { target: { [catFocus.pink]: 9 }, missing: lp[catFocus.pink] >= 9 ? {} : { [catFocus.pink]: 9 - (lp[catFocus.pink] || 0) } } : null;
  } else {
    o = Store.objective(objectiveId) || leafObj;
    ev = Engine.evaluate(c, o);
    headline = ev.total; headLabel = o.name;
    barBd = ev.breakdown;
    bdRows = CATS.map(k => {
      const b = ev.breakdown[k];
      return `<tr><td><span class="sparkchip cat-${k}" style="color:#0c1020">${k}</span></td>
        <td>${(b.score * 100).toFixed(0)}%</td><td>${b.weight}</td><td><b>${b.points}</b></td>
        <td class="small muted">${b.reasons.map(esc).join("<br>")}</td></tr>`;
    }).join("");
    bestBlue = ev.breakdown.blue.data.alternatives?.[0];
    bestPink = ev.breakdown.pink.data.alternatives?.[0];
  }
  ev.parent_value = Engine.parentValue(c, o);
  ev.grandparent_value = Engine.grandparentValue(c, o);
  const opp = Engine.objectiveScores(c);
  const wTargetIds = new Set(Engine.whiteTargets(o.config).flatMap(t => {
    const group = t.factor_id > 1000 ? Math.floor(t.factor_id / 100) : t.factor_id;
    return Engine.factorGroup[group] || [t.factor_id];
  }));
  const ancCard = (a, maxWhites) => `
    <div class="anc-card"><div class="role">${a.role.replace(/_/g, " ")} ${ancBadge(a)}</div>
      <div class="charcell">${portrait(a.card_id, "sm")}${a.matched_uid && DB.veterans[a.matched_uid]
        ? `<a tabindex="0" onclick="showChar('${a.matched_uid}')" style="cursor:pointer"><b>${esc(a.name)}</b></a>`
        : `<b>${esc(a.name)}</b>`}</div>
      <div>${sparkChips(a.sparks, maxWhites)}</div>
      <div class="small muted">${a.g1_wins.length} G1 wins</div></div>`;
  const parentCards = c.ancestors.filter(a => a.role === "parent_a" || a.role === "parent_b")
    .map(a => ancCard(a, 12)).join("");
  const gpCards = c.ancestors.filter(a => a.role.startsWith("gp_")).map(a => ancCard(a, 4)).join("");
  const projects = Store.characterProjects(uid).map(p =>
    `<span class="tag">${esc(p.project_name)} ${roleBadge(p.role)}</span>`).join(" ") || `<span class="muted small">not in any project</span>`;
  const breedings = Store.breedings();
  const asOff = breedings.filter(b => b.offspring_id === uid);
  const asPar = breedings.filter(b => b.parent_a_id === uid || b.parent_b_id === uid);
  const link = (id, name) => DB.veterans[id] ? `<a tabindex="0" onclick="showChar('${id}')" style="cursor:pointer">${esc(name)}</a>` : esc(name || "?");
  // auto-derived lineage: ancestor snapshots matched to your veterans (linkLineage)
  const ancLink = a => !a ? "?" : a.matched_uid && DB.veterans[a.matched_uid]
    ? link(a.matched_uid, a.name)
    : `${esc(a.name)} ${ancBadge(a)}`;
  const pA = c.ancestors.find(a => a.role === "parent_a"), pB = c.ancestors.find(a => a.role === "parent_b");
  const kids = Engine.childrenOf(uid);
  const breedLinks = [
    `<div class="small">⬆ parents (auto-linked): ${ancLink(pA)} × ${ancLink(pB)}</div>`,
    ...kids.map(k => `<div class="small">⬇ parent of ${link(k.uid, DB.veterans[k.uid].name)} <span class="muted">(${k.role.replace(/_/g, " ")})</span></div>`),
    ...asOff.map(b => `<div class="small">📝 recorded: offspring of ${link(b.parent_a_id, b.parent_a_name)} × ${link(b.parent_b_id, b.parent_b_name)} (${esc(b.date)})</div>`),
    ...asPar.map(b => `<div class="small">📝 recorded: parent of ${b.offspring_id ? link(b.offspring_id, b.offspring_name) : "unrecorded offspring"} (${esc(b.date)})</div>`)
  ].join("");
  showModal(`
    <div class="row" style="gap:14px">
      ${portrait(c.card_id, "lg")}
      <div><h1 style="margin:0">${esc(c.name)} ${missingBadge(c)} <span class="muted small">import #${c.id}</span></h1>
        <div class="muted">${esc(c.title)} ${c.memo ? `· memo: <b>${esc(c.memo)}</b>` : ""}</div>
        <div class="small muted">${esc(c.register_time)} · ${c.wins} wins · ${(c.fans || 0).toLocaleString()} fans · used ${c.succession_num}× as parent</div>
        <div>${projects}</div></div>
      <div style="margin-left:auto;text-align:right">
        <div class="score-num">${headline} <span class="muted small">/ 100 (${esc(headLabel)})</span></div>
        ${scoreBar(barBd)}
        <div class="small" style="margin:3px 0">score context:
          <select onchange="showChar('${c.uid}', +this.value)">
            ${catFocus && (catFocus.pink || catFocus.blue) ? `<option selected disabled>category focus</option>` : ""}
            ${objs.map(x => `<option value="${x.id}" ${!catFocus && x.id === o.id ? "selected" : ""}>${esc(x.name)} (${x.role})</option>`).join("")}
          </select></div>
        <div class="small muted" title="grandparent blue counts fully (rolled separately); white value weighted">parent value ${ev.parent_value.value}${ev.dist_scope === "own" ? "" : ` · grandparent value ${ev.grandparent_value.value}`}</div>
        <div class="small" title="base ${pa.base} + 3×shared G1 with own parents ${pa.race_points}; trainee/partner terms excluded">affinity (as leaf parent): <b>${pa.total}</b> <span class="muted">= base ${pa.base} + races ${pa.race_points}</span></div>
      </div>
    </div>
    <div class="row" style="margin:8px 0">
      <button class="small" onclick="addToProjectPrompt('${c.uid}')">＋ Add to project</button>
      <button class="small" onclick="createBranchPrompt('${c.uid}')">🌿 Create branch from this character</button>
      <button class="small" onclick="gotoSim('${c.uid}')">⚗ Plan a run with this parent</button>
      <button class="small" onclick="closeModal();location.hash='#/tree/${c.uid}'">🌳 Lineage tree</button>
      <button class="small" title="paste into the in-game memo to find this veteran (blue★ S/St/P/G/W + white count)" onclick="copyText('${suggestedMemo(c)}')">📋 memo ${suggestedMemo(c)}</button>
      <button class="small" title="import id — search helper" onclick="copyText('#${c.id}')">📋 #${c.id}</button>
    </div>
    <div class="panel" style="margin:8px 0"><b>Issues overview</b>
      <span class="small muted">— a veteran is fixed; these are its limitations at a glance</span>
      ${ev.issues.length ? `<ul class="reason-list">${ev.issues.map(h => `<li>${esc(h)}</li>`).join("")}</ul>`
        : `<div class="small" style="color:var(--green)">No significant issues ✓</div>`}</div>
    <div class="grid cols2">
      <div><h3>Own sparks (what it passes directly)</h3>
        <div>${sparkChips({ blue: c.sparks.blue, pink: c.sparks.pink, green: c.sparks.green, white: [], scenario: [] })}</div>
        ${groupedWhites(c.sparks, wTargetIds)}</div>
      <div><h3>${ev.dist_scope === "own" ? "Own distribution" : "Lineage distribution"} <span class="small muted">${ev.dist_scope === "own" ? "(veteran only — core/branch ignore parents)" : "(self + parents, the “9★” metric)"}</span></h3>
        <div>Blue: ${distChips(ev.lineage_blue, "blue", bestBlue?.target)}</div>
        <div>Pink: ${distChips(ev.lineage_pink, "pink", bestPink?.target)}</div>
        ${bestBlue?.missing && Object.keys(bestBlue.missing).length ? `<div class="small" style="color:var(--red)">Missing blue: ${Object.entries(bestBlue.missing).map(([k, v]) => `${k} +${v}★`).join(", ")}</div>` : ""}
        ${bestPink?.missing && Object.keys(bestPink.missing).length ? `<div class="small" style="color:var(--red)">Missing pink: ${Object.entries(bestPink.missing).map(([k, v]) => `${k} +${v}★`).join(", ")}</div>` : ""}
      </div>
    </div>
    <h3>Parent sparks <span class="small muted">(the veteran's two parents — they become grandparents when it is used)</span></h3>
    <div class="grid cols2">${parentCards || `<div class="muted small">no parent records</div>`}</div>
    <details class="gp-collapse">
      <summary>Grandparents (4) <span class="small muted">— their blue sparks also raise starting stats (each rolled separately); pink feeds start-of-run aptitudes</span></summary>
      <div class="anc-grid" style="grid-template-columns:repeat(4,1fr)">${gpCards || `<div class="muted small">none</div>`}</div>
    </details>
    <h3>Score breakdown — ${esc(headLabel)}</h3>
    <table><tr><th>Category</th><th>Score</th><th>Weight</th><th>Points</th><th>Why</th></tr>${bdRows}</table>
    <div class="grid cols2">
      <div><h3>Role suitability (score under each objective)</h3>
        <div class="small muted" style="margin-bottom:4px">Veterans are reusable — a high score elsewhere is an additional use, not a trade-off.</div>
        ${opp.map(r => `<div class="list-item"><span>${esc(r.name)} ${roleBadge(r.role)}</span><b>${r.total}</b></div>`).join("")}</div>
      <div><h3>Lineage <span class="small muted">auto-derived · 📝 = manually recorded</span></h3>${breedLinks}
        <h3>G1 wins (${c.g1_wins.length})</h3>
        <div class="small muted">${c.g1_wins.map(w => esc(w.name)).join(" · ") || "none"}</div></div>
    </div>`);
}

function gotoSim(uid) {
  S.simPreselect = uid;
  closeModal();
  location.hash = "#/simulator";
}

/* ---------- Today (dashboard as an action queue) ---------- */
ROUTES.dashboard = function () {
  const d = Engine.dashboard();
  const latest = [...Engine.roster].sort((a, b) => (b.register_time || "").localeCompare(a.register_time || "")).slice(0, 5);
  $("#main").innerHTML = `
    <h1>Today</h1>
    <div class="panel">
      <h2 style="margin-top:0">Next actions</h2>
      ${d.actions.map(a => `<div class="alert ${a.prio > 1 ? "high" : ""}">
        ${a.kind === "borrow" ? "🤝" : "🔧"} <a href="#/loops/${a.project_id}">${esc(a.text)}</a>
        ${a.kind === "borrow" ? `<a href="#/borrows" class="small">Borrows →</a>` : ""}</div>`).join("")
        || `<div class="muted">Nothing urgent. ${d.core_projects.length ? "Loops are covered — plan your next run." : "Create a core loop to get recommendations."}</div>`}
      ${d.alerts.map(a => `<div class="alert high">${a.character_id ? `<a tabindex="0" onclick="showChar('${a.character_id}')" style="cursor:pointer">${esc(a.name)}</a>` : esc(a.name)} · ${esc(a.project)}: ${esc(a.text)}</div>`).join("")}
      <div class="row small muted" style="margin-top:6px">
        <span>${d.counts.characters} veterans${d.counts.missing ? ` (${d.counts.missing} missing)` : ""}</span>·
        <span>${d.core_projects.length} active loops</span>·
        <span>${d.counts.objectives} objectives</span>·
        <a href="#/manage">Data →</a>
      </div>
    </div>
    <div class="grid cols2">
      <div class="panel"><div class="section-title"><h2 style="margin:0">Core loops</h2>
        <button class="small" onclick="newLoopPrompt()">＋ New core loop</button></div>
        ${d.core_projects.map(e => `<div class="list-item">
          <span><a href="#/loops/${e.project.id}">${esc(e.project.name)}</a> ${roleBadge("core")}</span>
          <span class="muted small">${e.target_count} targets · ${e.member_count} veterans${e.maintenance_issues ? ` · <span style="color:var(--red)">${e.maintenance_issues} maintenance issue(s)</span>` : ""}</span></div>`).join("")
          || `<div class="muted">No core loops yet. A loop = 3+ target umas you own + the veterans you produce from them.</div>`}
        <h2>Top branch candidates <span class="small muted">sparks first</span></h2>
        ${d.branch_candidates.map(r => `<div class="list-item small">
          <span class="charcell">${portrait(r.card_id, "sm")}<a tabindex="0" onclick="showChar('${r.id}', ${d.branch_objective?.id})" style="cursor:pointer">${esc(r.name)}</a> <span class="muted">${esc(r.memo || "")}</span></span>
          <span>${distChips(r.lineage_blue, "blue")}${distChips(r.lineage_pink, "pink")}</span></div>`).join("")
          || `<div class="muted">Import veterans to see candidates.</div>`}
        <div class="small muted" style="margin-top:6px"><a href="#/roster">Full roster + presets →</a></div></div>
      <div class="panel"><div class="section-title"><h2 style="margin:0">Best leaf candidates</h2>
        <span class="small muted">objective: ${esc(d.leaf_objective?.name || "")}</span></div>
        ${d.best_leaves.slice(0, 6).map(r => `<div class="list-item small">
          <span class="charcell">${portrait(r.card_id, "sm")}<a tabindex="0" onclick="showChar('${r.id}', ${d.leaf_objective?.id})" style="cursor:pointer">${esc(r.name)}</a> ${missingBadge(r)} <span class="muted">${esc(r.memo || "")}</span></span>
          <span>${distChips(r.lineage_blue, "blue")}${distChips(r.lineage_pink, "pink")} <b>${r.total}</b></span></div>`).join("")}
        <div class="small muted">Matched (concentrated) spark distributions and real roster affinity are rewarded; scattered stars are penalised.</div>
        <h2>Latest veterans</h2>
        ${latest.map(v => `<div class="list-item small">
          <span class="charcell">${portrait(v.card_id, "sm")}<a tabindex="0" onclick="showChar('${v.uid}')" style="cursor:pointer">${esc(v.name)}</a> <span class="muted">${esc(v.memo || "")}</span></span>
          <span class="muted">${esc(v.register_time)}</span></div>`).join("")
          || `<div class="muted">Import your veterans in Data.</div>`}
        <h2>Quick actions</h2>
        <div class="row">
          <button onclick="location.hash='#/roster'">📋 Roster</button>
          <button onclick="location.hash='#/simulator'">⚗ Plan a run</button>
          <button onclick="location.hash='#/tree'">🌳 Lineage tree</button>
          <button onclick="location.hash='#/borrows'">🤝 Borrows</button>
          <button onclick="location.hash='#/manage'">📥 Data</button>
        </div></div>
    </div>`;
};

/* ---------- Roster: one ranked table with presets ----------
   Replaces the old Branch Candidates / Leaf Candidates / Best by Category / Veterans
   tabs — they were the same table with different weights. Presets pick the lens;
   advanced objective editing lives under ⚙ Objectives. */
const PDB = { mode: "leaf", q: "", sort: "score", dir: -1, minB: 0, minP: 0, minW: 0, apt: "",
  rows: null, hideMissing: false, pink: "medium", blue: "stamina" };
const ROSTER_PRESETS = [["leaf", "Leaf (9★ lineage)"], ["branch", "Branch (own sparks)"], ["category", "Category focus"], ["objective", "Custom objective"]];

ROUTES.roster = function (preset) {
  if (preset && ROSTER_PRESETS.some(([k]) => k === preset)) PDB.mode = preset;
  const catPresets = [["medium", "stamina"], ["mile", "speed"], ["long", "stamina"], ["dirt", "power"], ["sprint", "speed"], ["medium", "power"]];
  $("#main").innerHTML = `
    <h1>Roster</h1>
    <div class="panel">
      <div class="row" style="margin-bottom:8px">
        ${ROSTER_PRESETS.map(([k, label]) => `<button class="${PDB.mode === k ? "primary" : ""}" data-mode="${k}">${label}</button>`).join("")}
        <a href="#/objectives" class="small muted" style="margin-left:auto">⚙ advanced: objectives &amp; weights</a>
      </div>
      <div class="row" id="pcatrow" style="display:${PDB.mode === "category" ? "flex" : "none"};margin-bottom:8px">
        <label class="row" style="margin:0">Pink focus <select id="catpink">${APTS.map(a => `<option ${PDB.pink === a ? "selected" : ""}>${a}</option>`).join("")}<option value="" ${!PDB.pink ? "selected" : ""}>any</option></select></label>
        <label class="row" style="margin:0">Blue focus <select id="catblue">${STATS.map(s => `<option ${PDB.blue === s ? "selected" : ""}>${s}</option>`).join("")}<option value="" ${!PDB.blue ? "selected" : ""}>any</option></select></label>
        ${catPresets.map(([a, s]) => `<button class="small" data-catpreset="${a}:${s}">${a} × ${s}</button>`).join("")}
      </div>
      <div class="row">
        <input id="pq" placeholder="Search name / memo / id…" value="${esc(PDB.q)}" style="width:200px">
        <label class="row" style="margin:0;display:${PDB.mode === "objective" ? "flex" : "none"}" id="pobjrow">Objective ${objectiveSelect("pobj")}</label>
        <label class="row" style="margin:0">min blue★ <input id="pminb" type="number" min="0" max="9" value="${PDB.minB}" style="width:52px"></label>
        <label class="row" style="margin:0">min pink★ <input id="pminp" type="number" min="0" max="9" value="${PDB.minP}" style="width:52px"></label>
        <label class="row" style="margin:0">min white★ <input id="pminw" type="number" min="0" value="${PDB.minW}" style="width:52px"></label>
        <label class="row" style="margin:0">base aptitude ≥A <select id="papt"><option value="">any</option>${APTS.map(a => `<option ${PDB.apt === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
        <label class="row small" style="margin:0"><input id="phidem" type="checkbox" ${PDB.hideMissing ? "checked" : ""}> hide missing</label>
        <span class="small muted">filters apply as you type</span>
      </div>
    </div>
    <div id="psuggest"></div>
    <div class="panel" id="ptable"></div>`;
  $("#pobj").value = S.objectiveId;
  const load = () => {
    PDB.q = $("#pq").value; PDB.minB = +$("#pminb").value; PDB.minP = +$("#pminp").value;
    PDB.minW = +$("#pminw").value; PDB.apt = $("#papt").value; PDB.hideMissing = $("#phidem").checked;
    if (PDB.mode === "category") {
      PDB.pink = $("#catpink").value; PDB.blue = $("#catblue").value;
      PDB.rows = Engine.categoryRank(PDB.pink || null, PDB.blue || null).map(r => ({ ...r, categories: {}, summary: DB.veterans[r.id].summary }));
      PDB.objective = null;
    } else {
      const objs = Store.objectives();
      const o = PDB.mode === "objective" ? Store.objective(+$("#pobj").value)
        : objs.find(x => x.role === PDB.mode) || objs[0];
      S.objectiveId = o.id;
      PDB.objective = o;
      PDB.rows = Engine.rank(o);
    }
    renderPSuggest();
    renderPTable();
  };
  $$("[data-mode]").forEach(b => b.onclick = () => { PDB.mode = b.dataset.mode; ROUTES.roster(); });
  $$("[data-catpreset]").forEach(b => b.onclick = () => {
    const [a, s] = b.dataset.catpreset.split(":");
    $("#catpink").value = a; $("#catblue").value = s; load();
  });
  if (PDB.mode === "category") { $("#catpink").onchange = load; $("#catblue").onchange = load; }
  // live filtering — no Apply button; only the results re-render, so focus is kept
  let deb = null;
  $("#pq").addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(load, 200); });
  $("#pq").addEventListener("keydown", e => { if (e.key === "Enter") load(); });
  ["#pminb", "#pminp", "#pminw", "#papt", "#phidem", "#pobj"].forEach(sel => { $(sel).onchange = load; });
  load();
};

/* partner suggestions for the Branch preset (kept from the old Branch tab) */
function renderPSuggest() {
  const el = $("#psuggest");
  if (PDB.mode !== "branch" || !PDB.rows?.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="panel"><h3 style="margin-top:0">Suggested pairings <span class="small muted">affinity + own-spark complementarity</span></h3>
    ${PDB.rows.slice(0, 6).map(r => {
      const v = DB.veterans[r.id];
      const sug = Engine.suggestPartners(v, 1)[0];
      if (!sug) return "";
      return `<div class="list-item">
        <span class="charcell">${portrait(v.card_id, "sm")}<b>${esc(v.name)}</b><span class="muted small">${esc(v.memo || "")}</span>
          <span class="muted">×</span>${portrait(sug.partner.card_id, "sm")}<b>${esc(sug.partner.name)}</b><span class="muted small">${esc(sug.partner.memo || "")}</span></span>
        <span class="small">${sug.reasons.map(esc).join(" · ")}
          <button class="small" onclick="event.stopPropagation();gotoSimPair('${v.uid}','${sug.partner.uid}')">⚗ plan</button></span>
      </div>`;
    }).join("")}</div>`;
}

/* legacy routes → consolidated roster */
ROUTES.parents = () => { PDB.mode = "objective"; location.hash = "#/roster"; };
ROUTES.branches = () => { PDB.mode = "branch"; location.hash = "#/roster"; };
ROUTES.leaves = () => { PDB.mode = "leaf"; location.hash = "#/roster"; };
ROUTES.category = () => { PDB.mode = "category"; location.hash = "#/roster"; };

function renderPTable() {
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  let rows = PDB.rows.filter(r => {
    const c = DB.veterans[r.id];
    const q = PDB.q.toLowerCase();
    if (q && !(c.name.toLowerCase().includes(q) || (c.memo || "").toLowerCase().includes(q) || String(c.id) === q)) return false;
    if (sum(r.lineage_blue) < PDB.minB || sum(r.lineage_pink) < PDB.minP || r.summary.white_stars < PDB.minW) return false;
    if (PDB.apt && (c.base_aptitudes || c.aptitudes)[PDB.apt] < 7) return false;
    if (PDB.hideMissing && r.missing) return false;
    return true;
  });
  const key = PDB.sort;
  const val = r => key === "score" ? r.total : key === "name" ? r.name : key === "blue" ? sum(r.lineage_blue)
    : key === "pink" ? sum(r.lineage_pink) : r.summary[key + "_stars"] ?? 0;
  rows.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * PDB.dir);
  const th = (k, label) => `<th data-sort="${k}">${label}${PDB.sort === k ? (PDB.dir < 0 ? " ▼" : " ▲") : ""}</th>`;
  const cat = PDB.mode === "category";
  const scope = PDB.objective && PDB.objective.role !== "leaf" ? "own" : "lineage";
  $("#ptable").innerHTML = `
    <div class="row spread" style="margin-bottom:6px">
      <span class="small muted">${rows.length} characters · ${cat ? `focus: ${PDB.pink || "any pink"} × ${PDB.blue || "any blue"} (lineage★)` : scope === "own" ? "own★ = the veteran's own sparks" : "lineage★ = self + parents (“9★” convention)"} · click a row for full evaluation</span>
      ${scoreLegend()}
    </div>
    <table class="cardtable"><tr><th></th>${th("name", "Character")}<th>Memo</th>${th("blue", "Blue " + (cat ? "lineage" : scope))}${th("pink", "Pink " + (cat ? "lineage" : scope))}${th("white", "White")}${th("green", "Green")}${th("score", "Score")}</tr>
    ${rows.map(r => `<tr class="clickable" tabindex="0" data-uid="${r.id}">
      <td>${portrait(r.card_id, "sm")}</td><td><a href="#/char/${r.id}" onclick="event.stopPropagation()"><b>${esc(r.name)}</b></a> ${missingBadge(r)} <span class="muted small">#${DB.veterans[r.id].id}</span></td>
      <td class="small">${esc(r.memo || "")}</td>
      <td>${distChips(r.lineage_blue, "blue")}</td><td>${distChips(r.lineage_pink, "pink")}</td>
      <td class="small">${r.summary.white_count} (${r.summary.white_stars}★)</td>
      <td class="small">${r.summary.green_stars}★</td>
      <td><span class="score-num">${r.total}</span>${Object.keys(r.categories).length ? scoreBar(Object.fromEntries(Object.entries(r.categories).map(([k, v]) => [k, { points: v }]))) : ""}</td>
    </tr>`).join("")}</table>`;
  $$("#ptable th[data-sort]").forEach(h => h.onclick = () => {
    const k = h.dataset.sort;
    if (PDB.sort === k) PDB.dir *= -1; else { PDB.sort = k; PDB.dir = -1; }
    renderPTable();
  });
  $$("#ptable tr.clickable").forEach(tr => tr.onclick = () =>
    cat ? showChar(tr.dataset.uid, null, { pink: PDB.pink, blue: PDB.blue })
        : showChar(tr.dataset.uid, S.objectiveId));
}
