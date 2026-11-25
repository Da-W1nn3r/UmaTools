/* Umamusume DB Wiki — vanilla JS SPA (hash routing).
 * Data comes from MasterWiki (wiki.js): a client-side engine running on the
 * user's own master.mdb via sql.js. No server, no uploads. */
"use strict";

const content = document.getElementById("content");

/* ---------------- utilities ---------------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const enc = encodeURIComponent;

async function api(path) {
  return MasterWiki.api(path);
}
const cache = {};
function clearCache() { for (const k of Object.keys(cache)) delete cache[k]; }
async function cached(path) {
  if (!(path in cache)) cache[path] = await api(path);
  return cache[path];
}

const KIND_META = {
  trainee: { label: "Trainees", icon: "🎀", route: "trainee" },
  character: { label: "Characters", icon: "👤", route: "character" },
  support: { label: "Support Cards", icon: "🃏", route: "support-card" },
  skill: { label: "Skills", icon: "✨", route: "skill" },
  race: { label: "Races", icon: "🏁", route: "race" },
  item: { label: "Items", icon: "🎒", route: "item" },
  npc: { label: "NPC Racers", icon: "🏇", route: "npc" },
  tt_build: { label: "Team Trials Builds", icon: "🤖", route: "tt-build" },
};
const entityLink = (kind, id) => `#/${KIND_META[kind].route}/${id}`;
const resultLink = (r) => r.kind === "generic" ? `#/g/${r.key}/${r.id}` : r.kind === "npc" ? `#/npc/${r.id}` : entityLink(r.kind, r.id);

const stars = (n) => "★".repeat(n || 0);
const APT_ORDER = [["turf", "Turf"], ["dirt", "Dirt"], ["sprint", "Sprint"], ["mile", "Mile"], ["medium", "Medium"], ["long", "Long"], ["front", "Front"], ["pace", "Pace"], ["late", "Late"], ["end", "End"]];
const APT_RANK = { G: 1, F: 2, E: 3, D: 4, C: 5, B: 6, A: 7, S: 8 };
const aptAtLeast = (r, key, letter) => r.aptitudes && (APT_RANK[r.aptitudes[key]] || 0) >= APT_RANK[letter];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const skillType = (r) => r.id >= 900000 ? "Evolution" : r.skill_category === 5 ? "Unique" : r.rarity >= 2 ? "Rare" : "Normal";
const distCategory = (d) => d == null ? null : d <= 1400 ? "Sprint" : d <= 1800 ? "Mile" : d <= 2400 ? "Medium" : "Long";
// chara_data.height / bust are 3D-model size class IDs, NOT cm measurements.
const HEIGHT_CLASS = { 0: "Petite", 1: "Standard", 2: "Tall" };
const BUST_CLASS = { 0: "XS", 1: "S", 2: "M", 3: "L", 4: "XL" };
const MODEL_CLASS_TIP = "3D model size class ID — not a cm measurement";
const heightLabel = (v) => v == null ? "—" : `<span title="${MODEL_CLASS_TIP}">${esc(HEIGHT_CLASS[v] ?? "?")} <span class="muted small">(class ${v})</span></span>`;
const bustLabel = (v) => v == null ? "—" : `<span title="${MODEL_CLASS_TIP}">${esc(BUST_CLASS[v] ?? "?")} <span class="muted small">(class ${v})</span></span>`;

function aptBadge(letter) { return `<span class="badge apt-${esc(letter)}">${esc(letter)}</span>`; }
function aptGrid(apt) {
  if (!apt) return "";
  return `<div class="apt-grid">${APT_ORDER.map(([k, label]) =>
    `<div class="apt-cell"><span class="apt-label">${label}</span>${aptBadge(apt[k])}</div>`).join("")}</div>`;
}
function statBars(stats) {
  const names = { speed: "Speed", stamina: "Stamina", pow: "Power", guts: "Guts", wiz: "Wit" };
  return Object.entries(names).map(([k, label]) => {
    const v = stats[k] ?? 0;
    const pct = Math.min(100, (v / 200) * 100);
    return `<div class="stat-row"><span class="stat-name">${label}</span>
      <div class="stat-bar"><div class="stat-fill fill-${k === "pow" ? "power" : k === "wiz" ? "wit" : k}" style="width:${pct}%"></div></div>
      <span class="stat-val">${v}</span></div>`;
  }).join("");
}
function skillChip(s, suffix = "") {
  const cls = s.is_unique || s.skill_category === 5 ? "unique" : (s.is_evolution || s.id >= 900000 ? "evo" : "");
  return `<a class="chip ${cls}" href="#/skill/${s.id}" title="${esc(s.description || "")}">${esc(s.name || "Skill " + s.id)}${suffix}</a>`;
}
function cardChip(c) {
  return `<a class="chip" href="#/trainee/${c.id}">${esc(c.title || "Card " + c.id)}</a>`;
}
function supportChip(s) {
  return `<a class="chip" href="#/support-card/${s.id}"><span class="badge type-${esc(s.type_label)}">${esc(s.type_label)}</span>${esc(s.title || "Support " + s.id)}</a>`;
}
function typeBadge(t) { return `<span class="badge type-${esc(t)}">${esc(t)}</span>`; }
function rarityBadge(r) { return `<span class="badge rar-${r}">${["", "R", "SR", "SSR"][r] || r}</span>`; }
function gradePill(g) { return `<span class="pill grade-${esc(g)}">${esc(g)}</span>`; }
function cardGrid(cards, kind) {
  if (!cards || !cards.length) return `<div class="muted">None</div>`;
  return `<div class="card-grid">${cards.map((c) => kind === "support"
    ? `<a class="entity-card panel" href="#/support-card/${c.id}"><div class="ec-title">${esc(c.title)}</div><div class="ec-sub">${typeBadge(c.type_label)} ${rarityBadge(c.rarity)}</div></a>`
    : `<a class="entity-card panel" href="#/trainee/${c.id}"><div class="ec-title">${esc(c.title)}</div><div class="ec-sub">${stars(c.default_rarity)} · ${esc(c.chara_name || "")}</div></a>`).join("")}</div>`;
}
function breadcrumb(items) {
  return `<div class="breadcrumb">${items.map(([label, href], i) =>
    href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`).join(" › ")}</div>`;
}
function infobox(name, sub, rows) {
  return `<aside class="infobox panel"><div class="ib-header"><div class="ib-name">${name}</div>${sub ? `<div class="ib-sub">${sub}</div>` : ""}</div>
    <table>${rows.filter(Boolean).map(([k, v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join("")}</table></aside>`;
}
function section(title, body) { return `<div class="section"><h2>${title}</h2>${body}</div>`; }
function eventsTable(events) {
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>Event</th><th>Source</th><th>Chain</th></tr></thead>
    <tbody>${events.map((ev) => `<tr><td>${esc(ev.title)}</td><td><span class="pill">${esc(ev.source)}</span></td><td>${ev.chain_total > 1 ? `${ev.chain_step} / ${ev.chain_total}` : "—"}</td></tr>`).join("")}</tbody>
    </table></div>`;
}
function showError(e) { content.innerHTML = `<div class="error">Failed to load: ${esc(e.message)}</div>`; }

/* ---------------- generic list page ---------------- */
function listPage({ title, sub, crumb, rows, columns, filters = [], searchKeys }) {
  filters = filters.filter((f) => f.options.length);
  content.innerHTML = `
    ${breadcrumb([[crumb, null]])}
    <h1 class="page-title">${title}</h1><p class="page-sub">${sub || ""}</p>
    <div class="toolbar">
      <input type="search" id="list-filter" placeholder="Filter ${esc(title.toLowerCase())}…">
      ${filters.map((f, i) => `<select data-fi="${i}"><option value="">${esc(f.label)}: All</option>${f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`).join("")}
      <span class="result-count" id="list-count"></span>
    </div>
    <div class="table-wrap"><table class="data" id="list-table">
      <thead><tr>${columns.map((c, i) => `<th data-ci="${i}">${esc(c.label)} <span class="arrow"></span></th>`).join("")}</tr></thead>
      <tbody></tbody></table></div>`;

  let sortCol = -1, sortDir = 1;
  const tbody = content.querySelector("tbody");
  const filterInput = content.querySelector("#list-filter");
  const selects = [...content.querySelectorAll("select[data-fi]")];

  function apply() {
    const q = filterInput.value.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (q && !searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(q))) return false;
      return filters.every((f, i) => !selects[i].value || f.match(r, selects[i].value));
    });
    if (sortCol >= 0) {
      const col = columns[sortCol];
      out = [...out].sort((a, b) => {
        const va = col.sortVal ? col.sortVal(a) : a[col.key];
        const vb = col.sortVal ? col.sortVal(b) : b[col.key];
        if (va == null) return 1; if (vb == null) return -1;
        return (typeof va === "number" ? va - vb : String(va).localeCompare(String(vb))) * sortDir;
      });
    }
    tbody.innerHTML = out.length
      ? out.map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? "num" : ""}">${c.render(r)}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${columns.length}" class="empty">No matches</td></tr>`;
    content.querySelector("#list-count").textContent = `${out.length} of ${rows.length}`;
    content.querySelectorAll("th").forEach((th, i) => {
      th.querySelector(".arrow").textContent = i === sortCol ? (sortDir > 0 ? "▲" : "▼") : "";
    });
  }
  filterInput.addEventListener("input", apply);
  selects.forEach((s) => s.addEventListener("change", apply));
  content.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const i = +th.dataset.ci;
    if (sortCol === i) sortDir = -sortDir; else { sortCol = i; sortDir = 1; }
    apply();
  }));
  apply();
}

/* ---------------- pages ---------------- */
async function homePage() {
  const stats = await cached("/wiki/stats");
  content.innerHTML = `
    <div class="hero"><h1>🗄️ Master Browser</h1>
      <p>Look up anything in your game — trainees, support cards, skills, races, items and more, all linked together. Your file stays on your device; nothing is uploaded.</p>
      <form class="home-search" id="home-search-form">
        <input id="home-search" type="search" placeholder="Try “Rice Shower”, “Corner Adept”, “February Stakes”, “Umapyoi”…">
        <button type="submit">Search</button>
      </form>
    </div>
    <div class="tile-grid">
      ${[["trainees", "trainee", "🎀", "Trainees"], ["characters", "character", "👤", "Characters"],
         ["support_cards", "support-card", "🃏", "Support Cards"], ["skills", "skill", "✨", "Skills"],
         ["races", "race", "🏁", "Races"], ["items", "item", "🎒", "Items"]].map(([key, , icon, label]) =>
        `<a class="tile panel" href="#/${key.replace(/_/g, "-")}"><div class="tile-icon">${icon}</div>
          <div class="tile-name">${label}</div><div class="tile-count">${stats[key]} entries</div></a>`).join("")}
    </div>
    <div class="section"><h2>More Content</h2>
      <div class="tile-grid">
        ${[["racecourses", "🏟️", "Racecourses"], ["npcs", "🏇", "NPC Racers"], ["tt-builds", "🤖", "Team Trials Builds"], ["scenarios", "📖", "Scenarios"], ["succession-factors", "🧬", "Succession Factors"],
           ["gacha", "🎰", "Gacha Banners"], ["songs", "🎵", "Songs"], ["lives", "🎤", "Lives"], ["dresses", "👗", "Costumes"],
           ["mobs", "👥", "Mob Characters"], ["story-events", "🎪", "Story Events"], ["main-story", "📚", "Main Story"],
           ["chara-stories", "💬", "Character Stories"], ["missions", "📋", "Missions"], ["trainings", "🏋️", "Training"],
           ["nicknames", "🏷️", "Titles"], ["honors", "🎖️", "Honors"], ["item-exchanges", "🛒", "Shop Exchanges"]].map(([key, icon, label]) =>
          `<a class="tile panel" href="${key === "npcs" ? "#/npcs" : key === "tt-builds" ? "#/tt-builds" : "#/g/" + key}"><div class="tile-icon">${icon}</div><div class="tile-name">${label}</div></a>`).join("")}
      </div>
    </div>
    <div class="section"><h2>Explore the Whole Database</h2>
      <div class="chip-row">
        <a class="chip" href="#/catalog">🗂️ Table Catalog — all 415 tables classified &amp; documented</a>
        <a class="chip" href="#/tables">🗄 Raw Table Browser</a>
      </div>
    </div>`;
  const form = content.querySelector("#home-search-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = content.querySelector("#home-search").value.trim();
    if (q) location.hash = `#/search?q=${enc(q)}`;
  });
}

async function searchPage(q) {
  content.innerHTML = `<div class="loading">Searching for “${esc(q)}”…</div>`;
  const data = await api(`/wiki/search?q=${enc(q)}`);
  const order = ["trainee", "character", "support", "skill", "race", "item", "npc", "tt_build", "generic"];
  const groups = order.filter((k) => data.groups[k]?.length);
  const groupTitle = (k) => k === "generic" ? "🗂️ More Content" : `${KIND_META[k].icon} ${KIND_META[k].label}`;
  let activeKind = "";

  function renderResults() {
    const shown = groups.filter((k) => !activeKind || k === activeKind);
    const total = shown.reduce((n, k) => n + data.groups[k].length, 0);
    content.innerHTML = `
      ${breadcrumb([["Search", null]])}
      <h1 class="page-title">Search results</h1>
      <p class="page-sub">${total} result(s) for “${esc(q)}”</p>
      ${groups.length > 1 ? `<div class="tabs" id="search-kind-tabs">
        <button class="tab ${!activeKind ? "active" : ""}" data-kind="">All (${data.total})</button>
        ${groups.map((k) => `<button class="tab ${activeKind === k ? "active" : ""}" data-kind="${k}">${groupTitle(k)} (${data.groups[k].length})</button>`).join("")}
      </div>` : ""}
      ${shown.length ? shown.map((k) => `
        <div class="search-group"><h2>${groupTitle(k)} (${data.groups[k].length})</h2>
          <div class="linklist">${data.groups[k].map((r) =>
            `<a class="entity-card panel" href="${resultLink(r)}">
              <div class="ec-title">${esc(r.name)}</div>
              <div class="ec-sub">${esc(r.sub || "")}${r.field === "description" ? ` · matched description: “${esc(r.matched)}”` : ""}</div>
            </a>`).join("")}</div></div>`).join("")
        : `<div class="empty">Nothing found. Try a different spelling or a shorter term.</div>`}`;
    content.querySelectorAll("#search-kind-tabs .tab").forEach((b) =>
      b.addEventListener("click", () => { activeKind = b.dataset.kind; renderResults(); }));
  }
  renderResults();
}

async function traineesPage() {
  const rows = await cached("/wiki/trainees");
  listPage({
    title: "Trainees", crumb: "Trainees", sub: `${rows.length} trainable cards (card_data), grouped by character.`,
    rows, searchKeys: ["title", "chara_name"],
    filters: [
      { label: "Style", options: ["Front", "Pace", "Late", "End"], match: (r, v) => r.style_label === v },
      { label: "Rarity", options: ["★", "★★", "★★★"], match: (r, v) => r.default_rarity === v.length },
      { label: "Surface ≥A", options: ["Turf", "Dirt"], match: (r, v) => aptAtLeast(r, v.toLowerCase(), "A") },
      { label: "Distance ≥A", options: ["Sprint", "Mile", "Medium", "Long"], match: (r, v) => aptAtLeast(r, v.toLowerCase(), "A") },
    ],
    columns: [
      { key: "title", label: "Card", render: (r) => `<a href="#/trainee/${r.id}">${esc(r.title || r.id)}</a>` },
      { key: "chara_name", label: "Character", render: (r) => `<a href="#/character/${r.chara_id}">${esc(r.chara_name)}</a>` },
      { key: "default_rarity", label: "Rarity", num: true, render: (r) => stars(r.default_rarity) },
      { key: "style_label", label: "Style", render: (r) => esc(r.style_label) },
      { key: "apt", label: "Turf / Dirt", render: (r) => r.aptitudes ? `${aptBadge(r.aptitudes.turf)} ${aptBadge(r.aptitudes.dirt)}` : "" },
      { key: "dist", label: "Sprint / Mile / Med / Long", render: (r) => r.aptitudes ? ["sprint", "mile", "medium", "long"].map((k) => aptBadge(r.aptitudes[k])).join(" ") : "" },
    ],
  });
}

async function traineePage(id) {
  const t = await api(`/wiki/trainees/${id}`);
  const rarities = t.rarities || [];
  let active = rarities.findIndex((r) => r.rarity === t.default_rarity);
  if (active < 0) active = 0;

  content.innerHTML = `
    ${breadcrumb([["Trainees", "#/trainees"], [t.chara_name, `#/character/${t.chara_id}`], [t.title_only || t.title, null]])}
    <h1 class="page-title">${esc(t.title || "Trainee " + t.id)}</h1>
    <p class="page-sub">${stars(t.default_rarity)} ${esc(t.style_label)} · <a href="#/character/${t.chara_id}">${esc(t.chara_name)}</a>${t.limited ? ' · <span class="pill">Limited</span>' : ""}</p>
    <div class="detail-grid"><div class="detail-main">
      ${section("Aptitudes & Base Stats", `
        <div class="tabs" id="rarity-tabs">${rarities.map((r, i) => `<button class="tab ${i === active ? "active" : ""}" data-i="${i}">${stars(r.rarity)}</button>`).join("")}</div>
        <div id="rarity-body"></div>`)}
      ${section("Learnable Skills", t.learnable_skills.length
        ? `<div class="chip-row">${t.learnable_skills.map((s) => skillChip(s, s.need_rank ? ` <span class="pill">★${s.need_rank}</span>` : "")).join("")}</div>
           <p class="small muted mt">★N = unlocks at talent (star) rank N.</p>`
        : `<div class="muted">None</div>`)}
      ${t.events && t.events.length ? section(`Training Events (${t.events.length})`, eventsTable(t.events)
        + `<p class="small muted mt">Card events are unique to this trainee card; character events can trigger for any of the character's trainee cards. Per-choice rewards (stats / energy / skill points) are stored in story scripts, not the database.</p>`) : ""}
      ${t.variants.length ? section("Other Versions of " + esc(t.chara_name), cardGrid(t.variants)) : ""}
      ${t.support_cards.length ? section("Support Cards featuring " + esc(t.chara_name), cardGrid(t.support_cards, "support")) : ""}
    </div>
    ${infobox(esc(t.title_only || t.title), esc(t.chara_name), [
      ["Character", `<a href="#/character/${t.chara_id}">${esc(t.chara_name)}</a>`],
      ["Base rarity", stars(t.default_rarity)],
      ["Running style", esc(t.style_label)],
      t.birthday && ["Birthday", esc(t.birthday)],
      t.height != null && ["Height class", heightLabel(t.height)],
      t.voice_actor && ["Voice actor", esc(t.voice_actor)],
      ["Stat growth", Object.entries(t.growth).filter(([, v]) => v).map(([k, v]) => `${k} +${v}%`).join(", ") || "None"],
      ["Card ID", `<code>${t.id}</code>`],
    ])}</div>`;

  function renderRarity(i) {
    const r = rarities[i];
    if (!r) return;
    content.querySelector("#rarity-body").innerHTML = `
      <div class="two-col"><div>${aptGrid(r.aptitudes)}</div><div>${statBars(r.stats)}</div></div>
      <h3>Innate skills at ${stars(r.rarity)}</h3>
      <div class="chip-row">${r.innate_skills.length ? r.innate_skills.map((s) => skillChip(s)).join("") : '<span class="muted">None</span>'}</div>`;
    content.querySelectorAll("#rarity-tabs .tab").forEach((b, j) => b.classList.toggle("active", j === i));
  }
  content.querySelectorAll("#rarity-tabs .tab").forEach((b) => b.addEventListener("click", () => renderRarity(+b.dataset.i)));
  renderRarity(active);
}

async function charactersPage() {
  const rows = await cached("/wiki/characters");
  const dorms = [...new Set(rows.map((r) => r.dorm).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const months = [...new Set(rows.map((r) => r.birth_month).filter(Boolean))].sort((a, b) => a - b);
  listPage({
    title: "Characters", crumb: "Characters", sub: `${rows.length} characters (chara_data).`,
    rows, searchKeys: ["name", "voice_actor"],
    filters: [
      { label: "Dorm", options: dorms, match: (r, v) => r.dorm === v },
      { label: "Birth month", options: months.map((m) => MONTHS[m - 1]), match: (r, v) => r.birth_month === MONTHS.indexOf(v) + 1 },
    ],
    columns: [
      { key: "name", label: "Name", render: (r) => `<a href="#/character/${r.id}">${r.image_color_main ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#${esc(r.image_color_main)};margin-right:6px"></span>` : ""}${esc(r.name)}</a>` },
      { key: "voice_actor", label: "Voice Actor", render: (r) => esc(r.voice_actor || "—") },
      { key: "birth", label: "Birthday", render: (r) => r.birth_month ? `${r.birth_month}/${r.birth_day}` : "—", sortVal: (r) => r.birth_month * 100 + r.birth_day },
      { key: "height", label: "Height class", num: true, render: (r) => r.height == null ? "—" : `<span title="${MODEL_CLASS_TIP}">${esc(HEIGHT_CLASS[r.height] ?? r.height)}</span>` },
      { key: "trainee_count", label: "Trainees", num: true, render: (r) => r.trainee_count },
      { key: "support_count", label: "Supports", num: true, render: (r) => r.support_count },
    ],
  });
}

async function characterPage(id) {
  const c = await api(`/wiki/characters/${id}`);
  content.innerHTML = `
    ${breadcrumb([["Characters", "#/characters"], [c.name, null]])}
    <h1 class="page-title">${esc(c.name)}</h1>
    <p class="page-sub">Character profile</p>
    <div class="detail-grid"><div class="detail-main">
      ${section(`Trainee Cards (${c.trainees.length})`, cardGrid(c.trainees))}
      ${section(`Support Cards (${c.support_cards.length})`, cardGrid(c.support_cards, "support"))}
      ${c.stories?.length ? section(`Story Episodes (${c.stories.length})`, `<div class="chip-row">${c.stories.map((s) => `<a class="chip" href="#/g/chara-stories/${s.id}">${esc(s.name)}</a>`).join("")}</div>`) : ""}
      ${c.dresses?.length ? section(`Costumes (${c.dresses.length})`, `<div class="chip-row">${c.dresses.map((d) => `<a class="chip" href="#/g/dresses/${d.id}">👗 ${esc(d.name)}</a>`).join("")}</div>`) : ""}
    </div>
    ${infobox(esc(c.name), c.image_color ? `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${esc(c.image_color)}"></span> Image color` : "", [
      c.voice_actor && ["Voice actor", esc(c.voice_actor)],
      c.dorm && ["Dormitory", esc(c.dorm)],
      c.birthday && ["Birthday", esc(c.birthday)],
      c.height != null && ["Height class", heightLabel(c.height)],
      c.bust != null && ["Bust size", bustLabel(c.bust)],
      ["Character ID", `<code>${c.id}</code>`],
    ])}</div>`;
}

async function supportCardsPage() {
  const rows = await cached("/wiki/support-cards");
  listPage({
    title: "Support Cards", crumb: "Support Cards", sub: `${rows.length} support cards.`,
    rows, searchKeys: ["title", "chara_name", "type_label"],
    filters: [
      { label: "Type", options: ["Speed", "Stamina", "Power", "Guts", "Wit", "Friend", "Group"], match: (r, v) => r.type_label === v },
      { label: "Rarity", options: ["R", "SR", "SSR"], match: (r, v) => r.rarity_label === v },
    ],
    columns: [
      { key: "title", label: "Card", render: (r) => `<a href="#/support-card/${r.id}">${esc(r.title || r.id)}</a>` },
      { key: "type_label", label: "Type", render: (r) => typeBadge(r.type_label) },
      { key: "rarity", label: "Rarity", render: (r) => rarityBadge(r.rarity) },
      { key: "chara_name", label: "Character", render: (r) => r.chara_id ? `<a href="#/character/${r.chara_id}">${esc(r.chara_name)}</a>` : "—" },
    ],
  });
}

function effectStepsText(steps, unit) {
  return steps.map((s, i) => i === 0 ? `<b>${s.value}${unit}</b>` : `${s.value}${unit} <span class="muted small">(Lv${s.lv})</span>`).join(" → ");
}

async function supportCardPage(id) {
  const s = await api(`/wiki/support-cards/${id}`);
  content.innerHTML = `
    ${breadcrumb([["Support Cards", "#/support-cards"], [s.title_only || s.title, null]])}
    <h1 class="page-title">${esc(s.title || "Support " + s.id)}</h1>
    <p class="page-sub">${typeBadge(s.type_label)} ${rarityBadge(s.rarity)}${s.chara_id ? ` · <a href="#/character/${s.chara_id}">${esc(s.chara_name)}</a>` : ""}</p>
    <div class="detail-grid"><div class="detail-main">
      ${s.description ? section("Card Story", `<div class="skill-desc pre-line">${esc(s.description)}</div>`) : ""}
      ${section("Effects", s.effects.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Effect</th><th>Progression (level thresholds)</th></tr></thead>
        <tbody>${s.effects.map((e) => `<tr><td>${esc(e.label)}</td><td>${effectStepsText(e.steps, e.unit)}</td></tr>`).join("")}</tbody>
        </table></div><p class="small muted mt">Values apply when the card reaches the given level (limit breaks raise the level cap).</p>
        ${s.specialty ? `<p class="small mt">Specialty Priority at max level: (${s.specialty.base} base + ${s.specialty.card_bonus} from card)${s.specialty.unique_percent ? ` × ${(1 + s.specialty.unique_percent / 100).toFixed(2)} unique` : ""} = <b>${s.specialty.total}</b> → displayed as <b>+${s.specialty.above_base}</b> above base${s.specialty.condition ? ` <span class="muted">(unique active when: ${esc(s.specialty.condition)})</span>` : ""}</p>` : ""}` : `<div class="muted">No effects</div>`)}
      ${s.unique_effects.length ? section("Unique Effect",
        (s.unique_effect_description ? `<div class="skill-desc">${esc(s.unique_effect_description)}</div>` : "")
        + s.unique_effects.map((u) =>
        `<div class="ability-item"><div class="ab-val">Unlocks at Lv ${u.lv}</div>
          <div class="ab-meta">${u.effects.map((e) => `${esc(e.label)}${e.value != null ? ` +${e.value}${e.unit}` : ""}${e.condition ? ` <span class=\"muted\">(${esc(e.condition)})</span>` : ""}`).join(" · ")}</div></div>`).join("")) : ""}
      ${section("Hint Skills", s.hint_skills.length ? `<div class="chip-row">${s.hint_skills.map((k) => skillChip(k)).join("")}</div>` : `<div class="muted">None</div>`)
        + (s.hint_stats && s.hint_stats.length ? `<p class="small muted mt">Stat hints: ${s.hint_stats.map((h) => `${esc(h.label)} +${h.value}`).join(" · ")}</p>` : "")}
      ${s.events && s.events.length ? section(`Training Events (${s.events.length})`, eventsTable(s.events)
        + `<p class="small muted mt">Card events are unique to this card; character events can trigger from any of the character's support cards. Per-choice rewards (stats / energy / skill points) are stored in story scripts, not the database.</p>`) : ""}
      ${s.trainees.length ? section("Trainee Cards featuring " + esc(s.chara_name), cardGrid(s.trainees)) : ""}
    </div>
    ${infobox(esc(s.title_only || s.title), esc(s.chara_name || s.kind), [
      ["Type", typeBadge(s.type_label)],
      ["Rarity", rarityBadge(s.rarity)],
      ["Kind", esc(s.kind)],
      ["Max level", s.max_level],
      s.chara_id && ["Character", `<a href="#/character/${s.chara_id}">${esc(s.chara_name)}</a>`],
      ["Card ID", `<code>${s.id}</code>`],
    ])}</div>`;
}

async function skillsPage() {
  const rows = await cached("/wiki/skills");
  const cats = [...new Set(rows.map((r) => r.category_label))];
  listPage({
    title: "Skills", crumb: "Skills", sub: `${rows.length} skills. Click a name for full mechanics and sources.`,
    rows, searchKeys: ["name", "description"],
    filters: [
      { label: "Category", options: cats, match: (r, v) => r.category_label === v },
      { label: "Type", options: ["Normal", "Rare", "Unique", "Evolution"], match: (r, v) => skillType(r) === v },
    ],
    columns: [
      { key: "name", label: "Skill", render: (r) => `<a href="#/skill/${r.id}">${esc(r.name || r.id)}</a>` },
      { key: "category_label", label: "Category", render: (r) => `<span class="pill">${esc(r.category_label)}</span>` },
      { key: "grade_value", label: "Skill Pts", num: true, render: (r) => r.grade_value },
      { key: "description", label: "Description", render: (r) => `<span class="small">${esc(r.description || "")}</span>` },
    ],
  });
}

async function skillPage(id) {
  const s = await api(`/wiki/skills/${id}`);
  const rarityName = { 1: "Normal", 2: "Rare (◎)", 3: "Unique", 4: "Unique", 5: "Unique" }[s.rarity] || s.rarity;
  content.innerHTML = `
    ${breadcrumb([["Skills", "#/skills"], [s.name || s.id, null]])}
    <h1 class="page-title">${esc(s.name || "Skill " + s.id)} ${s.is_unique ? '<span class="pill grade-EX">Unique</span>' : ""} ${s.is_evolution ? '<span class="pill">Evolution</span>' : ""}</h1>
    <p class="page-sub">${esc(s.category_label)}</p>
    <div class="detail-grid"><div class="detail-main">
      ${s.description ? `<div class="skill-desc">${esc(s.description)}</div>` : ""}
      ${s.conditions.length ? section("Activation Conditions", s.conditions.map((c) =>
        `<p>${esc(c.text)}</p><div class="condition-box">${esc(c.raw)}</div>`).join("")) : ""}
      ${s.abilities.length ? section("Effects", s.abilities.map((a) =>
        `<div class="ability-item"><div class="ab-val">${esc(a.value)}</div>
          <div class="ab-meta">${a.duration ? `Duration: ${esc(a.duration)} · ` : ""}${a.condition_text ? esc(a.condition_text) : ""}</div></div>`).join("")) : ""}
      ${section("Obtained From", `
        <h3>Innate on trainees (${s.innate_trainees.length})</h3>
        <div class="chip-row">${s.innate_trainees.length ? s.innate_trainees.map(cardChip).join("") : '<span class="muted">None</span>'}</div>
        <h3>Learnable by trainees (${s.learnable_trainees.length})</h3>
        <div class="chip-row">${s.learnable_trainees.length ? s.learnable_trainees.map((c) => cardChip(c)).join("") : '<span class="muted">None</span>'}</div>
        <h3>Hint from support cards (${s.hint_supports.length})</h3>
        <div class="chip-row">${s.hint_supports.length ? s.hint_supports.map(supportChip).join("") : '<span class="muted">None</span>'}</div>`)}
      ${s.family.length ? section("Related Skills (same family)", `<div class="chip-row">${s.family.map((f) => skillChip(f)).join("")}</div>`) : ""}
    </div>
    ${infobox(esc(s.name || s.id), esc(s.category_label), [
      ["Category", esc(s.category_label)],
      ["Rarity", esc(rarityName)],
      ["Skill point cost", s.grade_value],
      s.activate_lot ? ["Activation", "Chance-based"] : ["Activation", "Guaranteed (if conditions met)"],
      ["Skill ID", `<code>${s.id}</code>`],
      ["Icon ID", `<code>${s.icon_id}</code>`],
    ])}</div>`;
}

async function racesPage() {
  const rows = await cached("/wiki/races");
  const grades = [...new Set(rows.map((r) => r.grade_label))];
  const purposeOpts = ["Career Race", "Objective: URA Finale", "Objective: Unity Cup", "Objective: Grand Concert", "Objective: TS Climax", "Legend Race", "Daily Race", "Daily Legend Race"];
  const tracks = [...new Set(rows.map((r) => r.track).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  listPage({
    title: "Races", crumb: "Races", sub: `${rows.length} race definitions, with fan requirements and race purpose.`,
    rows, searchKeys: ["name", "track"],
    filters: [
      { label: "Grade", options: grades, match: (r, v) => r.grade_label === v },
      { label: "Surface", options: ["Turf", "Dirt"], match: (r, v) => r.ground_label === v },
      { label: "Purpose", options: purposeOpts, match: (r, v) => (r.purposes || []).includes(v) },
      { label: "Distance", options: ["Sprint", "Mile", "Medium", "Long"], match: (r, v) => distCategory(r.distance) === v },
      { label: "Track", options: tracks, match: (r, v) => r.track === v },
    ],
    columns: [
      { key: "name", label: "Race", render: (r) => `<a href="#/race/${r.id}">${esc(r.name)}</a>` },
      { key: "grade_label", label: "Grade", render: (r) => gradePill(r.grade_label) },
      { key: "track", label: "Track", render: (r) => esc(r.track || "—") },
      { key: "distance", label: "Distance", num: true, render: (r) => r.distance ? `${r.distance} m` : "—" },
      { key: "ground_label", label: "Surface", render: (r) => esc(r.ground_label) },
      { key: "need_fan", label: "Fans to enter", num: true, render: (r) => r.need_fan != null ? r.need_fan.toLocaleString() : "—" },
      { key: "purposes", label: "Purpose", render: (r) => (r.purposes || []).filter((p) => p !== "Career Race").slice(0, 3).map((p) => `<span class="pill">${esc(p.replace("Objective: ", ""))}</span>`).join(" ") || (r.purposes?.length ? '<span class="pill">Career</span>' : "—") },
    ],
  });
}

async function racePage(id) {
  const r = await api(`/wiki/races/${id}`);
  const purposePills = (r.purposes || []).map((p) => `<span class="pill">${esc(p)}</span>`).join(" ") || '<span class="muted">None</span>';
  const fanRewards = r.fan_rewards?.length ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>Finish</th><th>Fans earned</th></tr></thead>
      <tbody>${r.fan_rewards.map((f) => `<tr><td>${ordinal(f.place)}</td><td class="num">${f.fan_count.toLocaleString()}</td></tr>`).join("")}</tbody>
    </table></div>` : '<div class="muted">No fan reward data (not a career race).</div>';
  const trophies = r.trophies?.length ? `<div class="chip-row">${r.trophies.map((t) => `<a class="chip" href="#/item/${t.trophy_id}">🏆 ${esc(t.name || "Trophy " + t.trophy_id)}</a>`).join("")}</div>` : '<div class="muted">None</div>';
  content.innerHTML = `
    ${breadcrumb([["Races", "#/races"], [r.name, null]])}
    <h1 class="page-title">${esc(r.name)} ${gradePill(r.grade_label)}</h1>
    <p class="page-sub">${esc(r.track || "")} · ${r.distance ? r.distance + " m" : ""} · ${esc(r.ground_label)}</p>
    <div class="detail-grid"><div class="detail-main">
      ${section("Race Purpose", `<div class="chip-row">${purposePills}</div>`)}
      ${section("Fan Rewards", `<p class="muted small">Entry requirement: <b>${r.need_fan != null ? r.need_fan.toLocaleString() + " fans" : "—"}</b>. Fans earned by finishing position:</p>${fanRewards}`)}
      ${section("Trophies", trophies)}
      ${r.legend?.length ? section("Legend Race Appearances", `<div class="table-wrap"><table class="data"><thead><tr><th>Legend ID</th><th>Difficulty</th><th>Season</th><th>Weather</th></tr></thead><tbody>${r.legend.map((l) => `<tr><td>${l.id}</td><td>${["", "Normal", "Hard", "Very Hard"][l.difficulty] || l.difficulty}</td><td>${l.season || "—"}</td><td>${l.weather || "—"}</td></tr>`).join("")}</tbody></table></div>`) : ""}
      ${r.daily?.length ? section("Daily Race Appearances", `<div class="chip-row">${r.daily.map((d) => `<span class="chip">Daily #${d.id} · ${["", "Easy", "Normal", "Hard", "Very Hard"][d.difficulty] || d.difficulty}</span>`).join("")}</div>`) : ""}
      ${section(`Scheduled Instances (${r.instances.length})`, r.instances.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Instance</th><th>Name</th><th>Date</th><th>Race #</th></tr></thead>
        <tbody>${r.instances.map((i) => `<tr><td><code>${i.id}</code></td><td>${esc(i.name || "—")}</td><td>${esc(i.date_text)}</td><td>${i.race_number}</td></tr>`).join("")}</tbody>
        </table></div>` : `<div class="muted">None</div>`)}
    </div>
    ${infobox(esc(r.name), gradePill(r.grade_label), [
      ["Grade", esc(r.grade_label)],
      ["Track", r.race_track_id ? `<a href="#/g/racecourses/${r.race_track_id}">${esc(r.track || "—")}</a>` : esc(r.track || "—")],
      ["Distance", r.distance ? `${r.distance} m` : "—"],
      ["Surface", esc(r.ground_label)],
      ["Direction", esc(r.turn_label)],
      ["Max runners", r.entry_num],
      ["Fans to enter", r.need_fan != null ? r.need_fan.toLocaleString() : "—"],
      ["Race ID", `<code>${r.id}</code>`],
    ])}</div>`;
}
function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

async function itemsPage() {
  const rows = await cached("/wiki/items");
  listPage({
    title: "Items", crumb: "Items", sub: `${rows.length} named items.`,
    rows, searchKeys: ["name", "description"],
    columns: [
      { key: "name", label: "Item", render: (r) => `<a href="#/item/${r.id}">${esc(r.name)}</a>` },
      { key: "description", label: "Description", render: (r) => `<span class="small">${esc(r.description || "")}</span>` },
      { key: "limit_num", label: "Max Hold", num: true, render: (r) => r.limit_num },
    ],
  });
}

async function itemPage(id) {
  const i = await api(`/wiki/items/${id}`);
  content.innerHTML = `
    ${breadcrumb([["Items", "#/items"], [i.name, null]])}
    <h1 class="page-title">${esc(i.name)}</h1>
    <div class="detail-grid"><div class="detail-main">
      ${i.description ? `<div class="skill-desc">${esc(i.description)}</div>` : ""}
      ${i.how_to_get ? section("How to Obtain", `<p>${esc(i.how_to_get)}</p>`) : ""}
    </div>
    ${infobox(esc(i.name), "Item", [
      ["Category", `<code>${i.category}</code>`],
      ["Max hold", i.limit_num],
      i.sell_price ? ["Sell price", i.sell_price] : null,
      ["Item ID", `<code>${i.id}</code>`],
    ])}</div>`;
}

/* ---------------- raw table browser ---------------- */
async function tablesPage() {
  const tables = await cached("/tables/");
  content.innerHTML = `
    ${breadcrumb([["Raw Tables", null]])}
    <h1 class="page-title">Raw Tables</h1>
    <p class="page-sub">${tables.length} tables in master.mdb — direct access for advanced exploration.</p>
    <div class="toolbar"><input type="search" id="tbl-filter" placeholder="Filter tables…"></div>
    <div class="chip-row" id="tbl-list"></div>`;
  const render = () => {
    const q = content.querySelector("#tbl-filter").value.trim().toLowerCase();
    content.querySelector("#tbl-list").innerHTML = tables.filter((t) => t.includes(q))
      .map((t) => `<a class="chip" href="#/table/${enc(t)}">${esc(t)}</a>`).join("");
  };
  content.querySelector("#tbl-filter").addEventListener("input", render);
  render();
}

async function tablePage(name) {
  const schema = await api(`/tables/${enc(name)}/schema`);
  let offset = 0, sortBy = null, order = "ASC";
  const limit = 50;
  async function load() {
    const rows = await api(`/tables/${enc(name)}/rows?limit=${limit}&offset=${offset}${sortBy ? `&sort_by=${enc(sortBy)}&order=${order}` : ""}`);
    content.querySelector("#raw-body").innerHTML = rows.length
      ? rows.map((r) => `<tr>${schema.map((c) => `<td>${esc(r[c.name])}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${schema.length}" class="empty">No rows</td></tr>`;
    content.querySelector("#raw-range").textContent = `${offset + 1}–${offset + rows.length}`;
    content.querySelector("#raw-prev").disabled = offset === 0;
    content.querySelector("#raw-next").disabled = rows.length < limit;
  }
  content.innerHTML = `
    ${breadcrumb([["Raw Tables", "#/tables"], [name, null]])}
    <h1 class="page-title">${esc(name)}</h1>
    <p class="page-sub">${schema.length} columns · click a column header to sort</p>
    <div class="toolbar">
      <button class="tab" id="raw-prev">← Prev</button><button class="tab" id="raw-next">Next →</button>
      <span class="result-count" id="raw-range"></span>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr>${schema.map((c) => `<th data-col="${esc(c.name)}">${esc(c.name)}${c.is_pk ? " 🔑" : ""}<br><span class="small muted">${esc(c.type)}</span></th>`).join("")}</tr></thead>
      <tbody id="raw-body"></tbody></table></div>`;
  content.querySelector("#raw-prev").addEventListener("click", () => { offset = Math.max(0, offset - limit); load(); });
  content.querySelector("#raw-next").addEventListener("click", () => { offset += limit; load(); });
  content.querySelectorAll("th[data-col]").forEach((th) => th.addEventListener("click", () => {
    const col = th.dataset.col;
    if (sortBy === col) order = order === "ASC" ? "DESC" : "ASC"; else { sortBy = col; order = "ASC"; }
    offset = 0; load();
  }));
  await load();
}

/* ---------------- NPC racers ---------------- */
async function npcsPage() {
  const rows = await cached("/wiki/npcs");
  listPage({
    title: "🏇 NPC Racers", crumb: "NPC Racers",
    sub: `${rows.length} scripted mob / rival racers with stats, aptitudes and skills (career, legend, daily and team-building).`,
    rows, searchKeys: ["name", "chara_name", "mob_name"],
    filters: [
      { label: "Source", options: ["Career", "Legend Race", "Daily Race", "Team Building"], match: (r, v) => r.source_label === v },
      { label: "Style", options: ["Front", "Pace", "Late", "End"], match: (r, v) => r.style === v },
      { label: "Identity", options: ["Named character", "Mob"], match: (r, v) => (v === "Named character") === !!r.chara_id },
    ],
    columns: [
      { key: "name", label: "Name", render: (r) => `<a href="#/npc/${r.uid}">${esc(r.name)}</a> ${r.chara_id ? `<a class="pill link" href="#/character/${r.chara_id}" title="View character: ${esc(r.chara_name)}">Character</a>` : (r.mob_id ? `<a class="pill link" href="#/g/mobs/${r.mob_id}" title="View mob: ${esc(r.mob_name || r.mob_id)}">Mob</a>` : "")}` },
      { key: "source_label", label: "Source", render: (r) => `<span class="pill">${esc(r.source_label)}</span>` },
      { key: "style", label: "Style", render: (r) => esc(r.style) },
      { key: "apt", label: "Turf / Dirt", render: (r) => `${aptBadge(r.aptitudes.turf)} ${aptBadge(r.aptitudes.dirt)}` },
      { key: "stats", label: "Spd / Sta / Pow / Gut / Wit", render: (r) => `<span class="small num">${r.stats.speed} / ${r.stats.stamina} / ${r.stats.power} / ${r.stats.guts} / ${r.stats.wit}</span>` },
    ],
  });
}

async function npcPage(uid) {
  const n = await api(`/wiki/npcs/${enc(uid)}`);
  const s = n.stats;
  const identity = n.chara_id ? `<a href="#/character/${n.chara_id}">${esc(n.chara_name)}</a>`
    : (n.mob_id ? `<a href="#/g/mobs/${n.mob_id}">${esc(n.mob_name || "Mob " + n.mob_id)}</a>` : "—");
  content.innerHTML = `
    ${breadcrumb([["NPC Racers", "#/npcs"], [n.name, null]])}
    <h1 class="page-title">${esc(n.name)}</h1>
    <p class="page-sub"><span class="pill">${esc(n.source_label)}</span> · ${esc(n.style)} runner · ${identity}</p>
    <div class="detail-grid"><div class="detail-main">
      ${section("Base Stats", statBars({ speed: s.speed, stamina: s.stamina, pow: s.power, guts: s.guts, wiz: s.wit }))}
      ${section("Aptitudes", aptGrid(n.aptitudes))}
      ${section(`Skills (${n.skills.length})`, n.skills.length ? `<div class="chip-row">${n.skills.map((k) => skillChip(k)).join("")}</div>` : `<div class="muted">None</div>`)}
    </div>
    ${infobox(esc(n.name), esc(n.source_label) + " NPC", [
      ["Source", esc(n.source_label)],
      ["Identity", identity],
      ["Best style", esc(n.style)],
      n.race_dress_id ? ["Costume", `<a href="#/g/dresses/${n.race_dress_id}">👗 #${n.race_dress_id}</a>`] : null,
      n.npc_group_id ? ["NPC group", `<code>${n.npc_group_id}</code>`] : null,
      ["NPC ID", `<code>${n.id}</code>`],
    ])}</div>`;
}

/* ---------------- Team Trials NPC builds ---------------- */
async function ttBuildsPage() {
  const rows = await cached("/wiki/tt-builds");
  listPage({
    title: "🤖 Team Trials Builds", crumb: "Team Trials Builds",
    sub: `${rows.length} fixed 10-skill NPC builds (<code>skill_set</code> 200001–200032) used by Team Trials bot opponents. Each race fields 6 NPCs picked from its race-type pool; stats, aptitudes and names are randomized server-side.`,
    rows, searchKeys: ["name", "race_type", "style"],
    filters: [
      { label: "Race type", options: ["Sprint", "Mile / Dirt", "Medium", "Long"], match: (r, v) => r.race_type === v },
      { label: "Style", options: ["Front", "Pace", "Late", "End"], match: (r, v) => r.style === v },
      { label: "Skill", options: ["Sympathy", "Lone Wolf"], match: (r, v) => v === "Sympathy" ? r.has_sympathy : r.has_lone_wolf },
    ],
    columns: [
      { key: "name", label: "Build", render: (r) => `<a href="#/tt-build/${r.id}">${esc(r.name)}</a>` },
      { key: "race_type", label: "Race type", render: (r) => `<span class="pill">${esc(r.race_type)}</span>` },
      { key: "style", label: "Style", render: (r) => esc(r.style) },
      { key: "flags", label: "Sympathy / Lone Wolf", render: (r) => `${r.has_sympathy ? '<span class="pill">Sympathy</span>' : ""}${r.has_lone_wolf ? '<span class="pill">Lone Wolf</span>' : ""}` || "—" },
    ],
  });
}

async function ttBuildPage(id) {
  const b = await api(`/wiki/tt-builds/${id}`);
  const actives = b.skills.filter((s) => s.skill_category !== 0);
  const greens = b.skills.filter((s) => s.skill_category === 0);
  content.innerHTML = `
    ${breadcrumb([["Team Trials Builds", "#/tt-builds"], [b.name, null]])}
    <h1 class="page-title">${esc(b.name)}</h1>
    <p class="page-sub"><span class="pill">${esc(b.race_type)}</span> · ${esc(b.style)} runner · Team Trials NPC template</p>
    <div class="detail-grid"><div class="detail-main">
      ${section(`Active Skills (${actives.length})`, `<div class="chip-row">${actives.map((k) => skillChip(k)).join("")}</div>`)}
      ${section(`Passive Skills (${greens.length})`, `<div class="chip-row">${greens.map((k) => skillChip(k)).join("")}</div>`)}
      ${section("About this build", `<p class="small">Team Trials bot opponents use this fixed skill set (all skills level 1). Stats, aptitudes and names are generated server-side; names are drawn randomly from the shared mob name pool, so the same build can appear under any name. There are 4 race-type pools of 10 builds (8 core templates + 2 borrowed): Sprint, Mile / Dirt (shared), Medium and Long. Each race fields 6 NPCs randomly selected from its pool.</p>`)}
      <p class="mt"><a href="#/table/skill_set">🗄 View raw table skill_set</a></p>
    </div>
    ${infobox(esc(b.name), "Team Trials build", [
      ["Race type", esc(b.race_type)],
      ["Style", esc(b.style)],
      ["Template group", `${b.group} of 4`],
      ["Sympathy", b.has_sympathy ? "Yes" : "No"],
      ["Lone Wolf", b.has_lone_wolf ? "Yes" : "No"],
      ["skill_set ID", `<code>${b.id}</code>`],
    ])}</div>`;
}

/* ---------------- generic entity pages ---------------- */
async function genericListPage(key) {
  const data = await api(`/wiki/g/${enc(key)}`);
  const cfg = data.config;
  const rows = data.rows;
  const extraCols = (cfg.list_cols || []).slice(0, 4);
  const columns = [
    { key: "_name", label: cfg.label.replace(/s$/, ""), render: (r) => `<a href="#/g/${key}/${r[cfg.pk]}">${esc(r._name)}</a>` },
    ...extraCols.map((c) => ({ key: c, label: c, render: (r) => `<span class="small">${esc(r[c])}</span>` })),
  ];
  if (rows.some((r) => r._desc)) columns.push({ key: "_desc", label: "Description", render: (r) => `<span class="small">${esc(r._desc || "")}</span>` });
  const filters = (data.filters || []).map((f) => ({ label: f.label, options: f.options, match: (r, v) => String(r[f.key]) === v }));
  listPage({
    title: `${cfg.icon} ${cfg.label}`, crumb: cfg.label, sub: `${cfg.blurb || ""} <span class="muted">(${rows.length} rows · table <code>${cfg.table}</code>)</span>`,
    rows, searchKeys: ["_name", "_desc", cfg.pk], columns, filters,
  });
}

async function genericDetailPage(key, id) {
  const d = await api(`/wiki/g/${enc(key)}/${id}`);
  const cfg = d.config;
  const links = (d.links || []).map((l) => `<a class="chip" href="${entityLink(l.kind, l.id)}">${esc(l.label)}: ${esc(l.name)}</a>`).join("");
  content.innerHTML = `
    ${breadcrumb([[cfg.label, `#/g/${key}`], [d.name, null]])}
    <h1 class="page-title">${esc(d.name)}</h1>
    <p class="page-sub">${cfg.icon} ${esc(cfg.label)} · <code>${cfg.table}.${cfg.pk} = ${id}</code></p>
    <div class="detail-grid"><div class="detail-main">
      ${d.description ? `<div class="skill-desc">${esc(d.description)}</div>` : ""}
      ${links ? section("Related", `<div class="chip-row">${links}</div>`) : ""}
      ${section("All Fields", `<div class="table-wrap"><table class="data">
        <thead><tr><th>Column</th><th>Value</th></tr></thead>
        <tbody>${d.fields.map((f) => `<tr><td><code>${esc(f.column)}</code></td><td>${f.link ? `<a href="${entityLink(f.link.kind, f.link.id)}">${esc(f.link.name)}</a> <span class="muted small">(${esc(f.value)})</span>` : esc(f.display)}${!f.link && f.display !== f.value ? ` <span class="muted small">(raw ${esc(f.value)})</span>` : ""}</td></tr>`).join("")}</tbody>
      </table></div>`)}
      <p class="mt"><a href="#/table/${enc(cfg.table)}">🗄 View raw table ${esc(cfg.table)}</a></p>
    </div>
    ${infobox(esc(d.name), esc(cfg.label), [
      ["Category", `${cfg.icon} ${esc(cfg.label)}`],
      ["Table", `<code>${esc(cfg.table)}</code>`],
      ["ID", `<code>${id}</code>`],
    ])}</div>`;
}

/* ---------------- catalog page ---------------- */
async function catalogPage() {
  const [cat, registry] = await Promise.all([cached("/wiki/catalog"), cached("/wiki/registry")]);
  const tableToKey = {};
  registry.forEach((r) => { tableToKey[r.table] = r.key; });
  const statusBadge = (s) => ({ rich: '<span class="pill grade-G1">rich</span>', generic: '<span class="pill grade-G3">generic</span>', raw: '<span class="pill">raw</span>' }[s] || s);
  const viewLink = (t) => tableToKey[t.table] ? `#/g/${tableToKey[t.table]}` : `#/table/${enc(t.table)}`;
  const allTables = cat.groups.flatMap((g) => g.tables.map((t) => ({ ...t, domain: g.domain })));
  content.innerHTML = `
    ${breadcrumb([["Table Catalog", null]])}
    <h1 class="page-title">🗂️ Database Table Catalog</h1>
    <p class="page-sub">${cat.total} tables · <b>${cat.counts.rich}</b> rich entity pages · <b>${cat.counts.generic}</b> generic browse categories · <b>${cat.counts.raw}</b> raw-browsable. Every table is accessible; unclear ones are documented below.</p>
    <div class="toolbar">
      <input type="search" id="cat-filter" placeholder="Filter tables…">
      <select id="cat-status"><option value="">Status: All</option><option value="rich">rich</option><option value="generic">generic</option><option value="raw">raw</option></select>
      <select id="cat-domain"><option value="">Domain: All</option>${cat.groups.map((g) => `<option>${esc(g.domain)}</option>`).join("")}</select>
      <span class="result-count" id="cat-count"></span>
    </div>
    <div id="cat-body"></div>`;
  const body = content.querySelector("#cat-body");
  function apply() {
    const q = content.querySelector("#cat-filter").value.trim().toLowerCase();
    const st = content.querySelector("#cat-status").value;
    const dom = content.querySelector("#cat-domain").value;
    let shown = 0;
    body.innerHTML = cat.groups.map((g) => {
      const tabs = g.tables.filter((t) => (!q || t.table.includes(q) || (t.purpose || "").toLowerCase().includes(q)) && (!st || t.status === st) && (!dom || g.domain === dom));
      if (!tabs.length) return "";
      shown += tabs.length;
      return `<div class="section"><h2>${esc(g.domain)} <span class="muted small">(${tabs.length})</span></h2>
        <div class="table-wrap"><table class="data"><thead><tr><th>Table</th><th>Rows</th><th>Cols</th><th>Status</th><th>Purpose / note</th></tr></thead>
        <tbody>${tabs.map((t) => `<tr><td><a href="${viewLink(t)}">${esc(t.table)}</a></td><td class="num">${t.rows}</td><td class="num">${t.cols}</td><td>${statusBadge(t.status)}</td><td class="small">${esc(t.purpose || t.note || "")}</td></tr>`).join("")}</tbody></table></div></div>`;
    }).join("");
    content.querySelector("#cat-count").textContent = `${shown} of ${cat.total}`;
  }
  content.querySelector("#cat-filter").addEventListener("input", apply);
  content.querySelector("#cat-status").addEventListener("change", apply);
  content.querySelector("#cat-domain").addEventListener("change", apply);
  apply();
}

/* ---------------- router ---------------- */
const routes = [
  [/^#\/?$/, homePage, "home"],
  [/^#\/search\?q=(.+)$/, (m) => searchPage(decodeURIComponent(m[1])), "search"],
  [/^#\/trainees$/, traineesPage, "trainees"],
  [/^#\/trainee\/(\d+)$/, (m) => traineePage(+m[1]), "trainees"],
  [/^#\/characters$/, charactersPage, "characters"],
  [/^#\/character\/(\d+)$/, (m) => characterPage(+m[1]), "characters"],
  [/^#\/support-cards$/, supportCardsPage, "support-cards"],
  [/^#\/support-card\/(\d+)$/, (m) => supportCardPage(+m[1]), "support-cards"],
  [/^#\/skills$/, skillsPage, "skills"],
  [/^#\/skill\/(\d+)$/, (m) => skillPage(+m[1]), "skills"],
  [/^#\/races$/, racesPage, "races"],
  [/^#\/race\/(\d+)$/, (m) => racePage(+m[1]), "races"],
  [/^#\/items$/, itemsPage, "items"],
  [/^#\/item\/(\d+)$/, (m) => itemPage(+m[1]), "items"],
  [/^#\/npcs$/, npcsPage, "npcs"],
  [/^#\/npc\/([^/]+)$/, (m) => npcPage(decodeURIComponent(m[1])), "npcs"],
  [/^#\/tt-builds$/, ttBuildsPage, "tt-builds"],
  [/^#\/tt-build\/(\d+)$/, (m) => ttBuildPage(+m[1]), "tt-builds"],
  [/^#\/tables$/, tablesPage, "tables"],
  [/^#\/table\/([^/]+)$/, (m) => tablePage(decodeURIComponent(m[1])), "tables"],
  [/^#\/catalog$/, catalogPage, "catalog"],
  [/^#\/g\/([^/]+)\/(\d+)$/, (m) => genericDetailPage(decodeURIComponent(m[1]), +m[2]), "g:"],
  [/^#\/g\/([^/]+)$/, (m) => genericListPage(decodeURIComponent(m[1])), "g:"],
];

async function render() {
  const hash = location.hash || "#/";
  document.querySelectorAll("#sidebar a").forEach((a) => a.classList.remove("active"));
  for (const [re, handler, nav] of routes) {
    const m = hash.match(re);
    if (m) {
      const navKey = nav === "g:" ? "g-" + decodeURIComponent(m[1]) : nav;
      const navLink = document.querySelector(`#sidebar a[data-nav="${navKey}"]`);
      if (navLink) navLink.classList.add("active");
      content.innerHTML = `<div class="loading">Loading…</div>`;
      try { await handler(m); } catch (e) { showError(e); }
      window.scrollTo(0, 0);
      return;
    }
  }
  content.innerHTML = `<div class="empty">Page not found. <a href="#/">Go home</a></div>`;
}
window.addEventListener("hashchange", render);

/* ---------------- global search w/ suggestions ---------------- */
const gsInput = document.getElementById("global-search");
const gsBox = document.getElementById("search-suggest");
let gsTimer = null;

gsInput.addEventListener("input", () => {
  clearTimeout(gsTimer);
  const q = gsInput.value.trim();
  if (q.length < 2) { gsBox.classList.add("hidden"); return; }
  gsTimer = setTimeout(async () => {
    try {
      const data = await api(`/wiki/search?q=${enc(q)}`);
      const items = [];
      for (const kind of ["trainee", "character", "support", "skill", "race", "item", "npc", "tt_build", "generic"]) {
        for (const r of (data.groups[kind] || []).slice(0, 4)) items.push({ kind, ...r });
        if (items.length >= 14) break;
      }
      if (!items.length) { gsBox.innerHTML = `<div class="sg-group">No matches</div>`; }
      else {
        gsBox.innerHTML = items.map((r) =>
          `<a href="${resultLink(r)}"><span>${r.kind === "generic" ? "🗂️" : KIND_META[r.kind].icon} ${esc(r.name)}</span><span class="sg-sub">${esc(r.sub || (r.kind === "generic" ? "More" : KIND_META[r.kind].label))}</span></a>`).join("")
          + `<a href="#/search?q=${enc(q)}"><span>🔎 All results for “${esc(q)}”</span></a>`;
      }
      gsBox.classList.remove("hidden");
    } catch { /* ignore */ }
  }, 250);
});
gsInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const q = gsInput.value.trim();
    if (q) { location.hash = `#/search?q=${enc(q)}`; gsBox.classList.add("hidden"); gsInput.blur(); }
  } else if (e.key === "Escape") { gsBox.classList.add("hidden"); }
});
gsBox.addEventListener("click", () => { gsBox.classList.add("hidden"); gsInput.value = ""; });
document.addEventListener("click", (e) => {
  if (!e.target.closest(".global-search")) gsBox.classList.add("hidden");
});

/* ---------------- master.mdb load gate + local cache ---------------- */
const gate = document.getElementById("load-gate");
const gateDrop = document.getElementById("gate-drop");
const gateFile = document.getElementById("gate-file");
const gateStatus = document.getElementById("gate-status");
const gateError = document.getElementById("gate-error");
const layout = document.getElementById("layout");
const dbBar = document.getElementById("db-bar");

/* The uploaded file's bytes are cached in IndexedDB so the database survives
   closing the tab. Nothing ever leaves the device; "Forget cached copy" wipes it.
   "meta" and "bytes" are separate keys so the gate can show the cached file's
   date/version without reading the (large) blob. */
const MdbCache = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const req = indexedDB.open("master_browser", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
      };
      req.onsuccess = () => { this.db = req.result; res(this.db); };
      req.onerror = () => rej(req.error);
    });
  },
  async read(keys) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const s = d.transaction("kv", "readonly").objectStore("kv");
      const out = {};
      let pending = keys.length;
      for (const k of keys) {
        const r = s.get(k);
        r.onsuccess = () => { out[k] = r.result; if (!--pending) res(out); };
        r.onerror = () => rej(r.error);
      }
    });
  },
  async getMeta() { return (await this.read(["meta"])).meta || null; },
  async get() {
    const { meta, bytes } = await this.read(["meta", "bytes"]);
    return meta && bytes ? { ...meta, bytes } : null;
  },
  async put(rec) {
    const { bytes, ...meta } = rec;
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction("kv", "readwrite");
      const s = t.objectStore("kv");
      s.put(meta, "meta");
      s.put(bytes, "bytes");
      t.oncomplete = res;
      t.onerror = t.onabort = () => rej(t.error || new Error("cache write aborted"));
    });
  },
  async clear() {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction("kv", "readwrite");
      t.objectStore("kv").clear();
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  },
};

const fmtMB = (n) => (n / 1048576).toFixed(1);
const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null;
function cacheLabel(meta) {
  const bits = [`${fmtMB(meta.size)} MB`];
  if (meta.version) bits.push(`version ${meta.version}`);
  const fd = fmtDate(meta.fileModified);
  if (fd) bits.push(`file dated ${fd}`);
  bits.push(`cached ${fmtDate(meta.savedAt)}`);
  return bits.join(" · ");
}

/* Best-effort data version: some master.mdb builds carry a version table.
   Most don't — then the file's last-modified date is the version marker. */
async function detectVersion() {
  try {
    const tables = await MasterWiki.api("/tables/");
    const vt = tables.find((t) => t === "version") || tables.find((t) => /version/i.test(t));
    if (!vt) return null;
    const rows = await MasterWiki.api(`/tables/${enc(vt)}/rows?limit=3`);
    const vals = rows.flatMap((r) => Object.values(r)).filter((v) => v != null && v !== "");
    return vals.length ? vals.join(".") : null;
  } catch { return null; }
}

function enterApp(meta, note = "") {
  clearCache();
  document.getElementById("db-name").textContent = meta.name;
  const metaEl = document.getElementById("db-meta");
  metaEl.textContent = cacheLabel(meta) + (note ? ` · ${note}` : "");
  metaEl.title = "Cached locally in this browser (IndexedDB) — never uploaded";
  gate.hidden = true;
  layout.hidden = false;
  dbBar.hidden = false;
  gateStatus.textContent = "";
  gateError.textContent = "";
  render();
}

async function loadMasterFile(file) {
  gateError.textContent = "";
  gateStatus.textContent = `Reading ${file.name} (${fmtMB(file.size)} MB)…`;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    gateStatus.textContent = "Initialising SQLite engine…";
    await MasterWiki.init();
    gateStatus.textContent = "Opening database…";
    await new Promise((r) => setTimeout(r, 30)); // let the status paint
    MasterWiki.load(bytes);
    const meta = { name: file.name, size: file.size, fileModified: file.lastModified || null,
      savedAt: Date.now(), version: await detectVersion() };
    gateStatus.textContent = "Caching for next visit…";
    let note = "";
    try { await MdbCache.put({ ...meta, bytes }); }
    catch { note = "not cached (browser storage unavailable or full)"; }
    enterApp(meta, note);
  } catch (e) {
    gateStatus.textContent = "";
    gateError.textContent = "Failed to load: " + e.message;
  }
}

async function loadCached() {
  gateError.textContent = "";
  try {
    gateStatus.textContent = "Looking for a cached master.mdb…";
    const rec = await MdbCache.get();
    if (!rec) { gateStatus.textContent = ""; return false; }
    gateStatus.textContent = `Loading cached ${rec.name} (${cacheLabel(rec)})…`;
    await MasterWiki.init();
    await new Promise((r) => setTimeout(r, 30));
    MasterWiki.load(rec.bytes);
    enterApp(rec);
    return true;
  } catch (e) {
    // corrupt/incompatible cache — drop it and fall back to the file picker
    gateStatus.textContent = "";
    gateError.textContent = "Cached copy failed to load (" + e.message + "). Please select the file again.";
    MdbCache.clear().catch(() => {});
    refreshGateCached();
    return false;
  }
}

const gateCached = document.getElementById("gate-cached");
const gateCachedInfo = document.getElementById("gate-cached-info");
async function refreshGateCached() {
  try {
    const meta = await MdbCache.getMeta();
    gateCached.hidden = !meta;
    if (meta) gateCachedInfo.textContent = `📦 Cached copy: ${meta.name} — ${cacheLabel(meta)}`;
  } catch { gateCached.hidden = true; }
}
document.getElementById("gate-use-cached").addEventListener("click", () => loadCached());
document.getElementById("gate-forget").addEventListener("click", async () => {
  try { await MdbCache.clear(); } catch { /* ignore */ }
  gateCached.hidden = true;
});

gateDrop.addEventListener("click", () => gateFile.click());
gateDrop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") gateFile.click(); });
gateFile.addEventListener("change", () => { if (gateFile.files[0]) loadMasterFile(gateFile.files[0]); gateFile.value = ""; });
gateDrop.addEventListener("dragover", (e) => { e.preventDefault(); gateDrop.classList.add("dragover"); });
gateDrop.addEventListener("dragleave", () => gateDrop.classList.remove("dragover"));
gateDrop.addEventListener("drop", (e) => {
  e.preventDefault(); gateDrop.classList.remove("dragover");
  if (e.dataTransfer.files[0]) loadMasterFile(e.dataTransfer.files[0]);
});
document.getElementById("db-change").addEventListener("click", () => {
  layout.hidden = true;
  dbBar.hidden = true;
  gate.hidden = false;
  refreshGateCached();
});

// Boot: auto-load the cached master.mdb if there is one; otherwise show the gate.
// render() runs once a database is loaded (from cache or a fresh upload).
loadCached();
