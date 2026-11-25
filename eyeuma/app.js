// Client-side pipeline: screenshots -> readHeader/readSkillsTab/readSummary/readRaceHistory -> assemble().
// OCR runs in a tesseract.js worker in this tab; nothing is uploaded.
import Tesseract from "./vendor/tesseract/tesseract.esm.min.js";
import { findAnchors, findTabs, activeTab, readHeader, toCanvas } from "./src/ocr.js";
import { readSkillsTab, mergeSkills } from "./src/skills.js";
import { readSummary, mergeSummaries } from "./src/summary.js";
import { readRaceHistory, mergeRaces } from "./src/races.js";
import { readInspirationTab, makeFactorResolver, resolveFactor, mergeFactorIds, readParentFactors } from "./src/inspiration.js";
import { assemble, makeResolver, nativeUniqueSkill, pickProgram, rankFromRating, resolveSkill } from "./src/assemble.js";
import { lookup, wordMatch, similarity } from "./src/match.js";
import { loadTables } from "./src/tables.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileInput = $("files");
const fileList = $("file-list");
const runButton = $("run");
const clearButton = $("clear");
const copyButton = $("copy");
const downloadButton = $("download");
const resetButton = $("reset");
const runHint = $("run-hint");
const engine = $("engine");
const logEl = $("log");
const warningsEl = $("warnings");
const reviewsEl = $("reviews");
const reviewModal = $("review-modal");
const reviewOpen = $("review-open");
const reviewClose = $("review-close");
const reviewCount = $("review-count");
const jsonEl = $("json");
const readableEl = $("readable");
const viewReadable = $("view-readable");
const viewJson = $("view-json");

const KINDS = [
  ["auto", "Auto-detect"],
  ["header", "Header only"],
  ["skills", "Skills tab"],
  ["career", "Career Info"],
  ["inspiration", "Inspiration"],
  ["parent-json", "Parent JSON"],
  ["ignore", "Ignore"],
];

// The OCR library and the readers take an environment so the same code runs in Node tests.
const env = {
  createCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
  },
  toInput(canvas) {
    return canvas;
  },
};

const items = [];
let running = false;
let worker = null;
let tables = null;
let resolver = null;
let factorRes = null;
let lastVeteran = null;
let lastParsed = null;
let lastNotes = [];
let ocrParsed = null;
let ocrNotes = [];
let applyTimer = null;

const STATS = [["speed", "Speed"], ["stamina", "Stamina"], ["power", "Power"], ["guts", "Guts"], ["wiz", "Wit"]];
const APTITUDES = [
  ["turf", "Turf"], ["dirt", "Dirt"],
  ["sprint", "Sprint"], ["mile", "Mile"], ["medium", "Medium"], ["long", "Long"],
  ["front", "Front"], ["pace", "Pace"], ["late", "Late"], ["end", "End"],
];
const APTITUDE_LETTERS = ["", "G", "F", "E", "D", "C", "B", "A", "S"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------- UI helpers

function setEngine(state, text) {
  engine.dataset.state = state;
  engine.textContent = text;
}

function log(message, kind = "") {
  logEl.hidden = false;
  const line = document.createElement("div");
  line.textContent = message;
  if (kind === "error") line.style.color = "var(--danger)";
  logEl.appendChild(line);
  while (logEl.children.length > 80) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.replaceChildren();
  logEl.hidden = true;
}

function updateRunState() {
  const usable = items.filter((i) => i.kind !== "ignore" && i.kind !== "parent-json").length;
  const parents = items.filter((i) => i.kind === "parent-json").length;
  runButton.disabled = running || usable === 0;
  clearButton.disabled = running || items.length === 0;
  if (running) runHint.textContent = "Reading…";
  else if (!items.length) runHint.textContent = "Add at least one screenshot.";
  else {
    const bits = [`${usable} screenshot${usable === 1 ? "" : "s"}`];
    if (parents) bits.push(`${parents} parent JSON${parents === 1 ? "" : "s"}`);
    runHint.textContent = `${bits.join(" · ")} ready. Nothing is uploaded.`;
  }
  runButton.textContent = running ? "Reading…" : "Read screenshots";
}

function setStatus(item, text, isError = false) {
  item.status = text;
  if (!item.statusEl) return;
  item.statusEl.textContent = text;
  item.statusEl.title = text;
  item.statusEl.classList.toggle("error", isError);
}

function renderFiles() {
  fileList.replaceChildren();
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "file";

    const img = document.createElement("img");
    if (item.json) {
      img.className = "json-thumb";
      img.alt = "Parent JSON";
      img.src = "data:image/svg+xml," + encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><rect width='48' height='48' rx='6' fill='#2b3a55'/><text x='24' y='30' font-family='monospace' font-size='16' fill='#9fc1ff' text-anchor='middle'>{ }</text></svg>`);
    } else {
      img.src = item.url;
      img.alt = "";
    }

    const meta = document.createElement("div");
    meta.className = "file-meta";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = item.file.name;
    name.title = item.file.name;
    const status = document.createElement("span");
    status.className = "file-status";
    status.textContent = item.status;
    meta.append(name, status);

    let select = null;
    if (item.json) {
      select = document.createElement("span");
      select.className = "file-kind-static";
      select.textContent = `Parent · card ${item.json.card_id}`;
    } else {
      select = document.createElement("select");
      select.setAttribute("aria-label", `What is in ${item.file.name}?`);
      for (const [value, label] of KINDS) {
        if (value === "parent-json") continue;
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        select.appendChild(opt);
      }
      select.value = item.kind;
      select.disabled = running;
      select.addEventListener("change", () => {
        item.kind = select.value;
        updateRunState();
      });
    }

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.title = "Remove";
    remove.setAttribute("aria-label", `Remove ${item.file.name}`);
    remove.textContent = "×";
    remove.disabled = running;
    remove.addEventListener("click", () => removeItem(item));

    li.append(img, meta, select, remove);
    fileList.appendChild(li);
    item.statusEl = status;
    item.selectEl = select;
    item.removeEl = remove;
  }
}
function removeItem(item) {
  if (running) return;
  const i = items.indexOf(item);
  if (i >= 0) items.splice(i, 1);
  URL.revokeObjectURL(item.url);
  renderFiles();
  updateRunState();
}

async function addFiles(files) {
  if (running) return;
  const list = [...files];
  const images = list.filter((f) => f.type.startsWith("image/"));
  const jsons = list.filter((f) => f.type === "application/json" || /\.json$/i.test(f.name));
  if (!images.length && !jsons.length) return;
  for (const file of images) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      continue;
    }
    items.push({ file, url, img, kind: "auto", status: "Ready", detected: null, statusEl: null });
  }
  for (const file of jsons) {
    let entry;
    try {
      entry = JSON.parse(await file.text());
    } catch {
      log(`${file.name}: not valid JSON; ignored`, "error");
      continue;
    }
    if (!entry || typeof entry !== "object" || !Number.isFinite(entry.card_id)) {
      log(`${file.name}: not a trained-chara JSON (no card_id); ignored`, "error");
      continue;
    }
    items.push({ file, url: null, img: null, json: entry, kind: "parent-json", status: "Parent JSON ready", detected: null, statusEl: null });
  }
  // Timestamped screenshot names sort into capture order, which is the best default for the header.
  items.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
  renderFiles();
  updateRunState();
}

function showWarnings(warnings) {
  warningsEl.replaceChildren();
  warningsEl.hidden = false;
  const title = document.createElement("strong");
  title.textContent = warnings.length ? `Warnings (${warnings.length})` : "No warnings";
  warningsEl.appendChild(title);
  const ul = document.createElement("ul");
  if (!warnings.length) {
    const li = document.createElement("li");
    li.className = "ok";
    li.textContent = "Every field the readers looked for was found.";
    ul.appendChild(li);
  }
  for (const w of warnings) {
    const li = document.createElement("li");
    li.textContent = w;
    ul.appendChild(li);
  }
  warningsEl.appendChild(ul);
}

// ---------------------------------------------------------------- review panel
// Readings the matcher is not confident about (ambiguous tier, garbage OCR, unknown name) are
// collected here with a crop of the source screenshot so the user can resolve them in one click.

const REVIEW_LABEL = { skill: "Skill", race: "Race", spark: "Spark", card: "Card", epithet: "Epithet", scenario: "Scenario" };
const REVIEW_DL = { skill: "dl-skills", race: "dl-races", spark: "dl-factors", card: "dl-cards", epithet: "dl-nicknames", scenario: "dl-scenarios" };
let reviewSignature = null;

// Candidate factors for an unresolved spark: right star count and icon colour, ranked by name similarity.
function factorCandidates(cell) {
  const types = { blue: [1], red: [2], green: [3] }[cell.kind] ?? null;
  const out = [];
  for (const [id, f] of Object.entries(tables.factors)) {
    const n = Number(id);
    if (f.type === 7 ? cell.stars !== 1 : n % 10 !== cell.stars) continue;
    if (types && !types.includes(f.type)) continue;
    out.push({ id: n, name: f.name, score: similarity(cell.name, f.name) });
  }
  out.sort((a, b) => b.score - a.score || a.id - b.id);
  return out.slice(0, 8);
}

function sparkReviews() {
  // Group by uma (trainee first, then parents in slot order); within each group show blue, pink,
  // green, then white sparks. `index` keeps pointing at the original unresolved array.
  const parents = lastParsed?.inspiration?.parents ?? [];
  const group = (u) => {
    if (u.scope === "own") return -1;
    const i = parents.findIndex((p) => p.cardId === u.cardId);
    return i < 0 ? 99 : i;
  };
  const list = (lastParsed?.inspiration?.unresolved ?? []).map((u, i) => ({ u, i }));
  list.sort((a, b) => group(a.u) - group(b.u)
    || (FACTOR_KIND_ORDER[a.u.cell.kind] ?? 3) - (FACTOR_KIND_ORDER[b.u.cell.kind] ?? 3));
  return list.map(({ u, i }) => ({
    kind: "spark", index: i, scope: u.scope, cardId: u.cardId,
    raw: u.cell.name, stars: u.cell.stars, color: u.cell.kind,
    shot: u.cell.shot, box: u.cell.box, current: null,
    reason: "unrecognised", candidates: factorCandidates(u.cell),
  }));
}

function currentName(kind, id) {
  if (id == null) return null;
  const t = { skill: tables.skills, race: tables.programs, spark: tables.factors }[kind];
  if (t) return t[id]?.name ?? `#${id}`;
  if (kind === "card") return tables.cards[id] ?? `#${id}`;
  if (kind === "epithet") return tables.nicknames[id] ?? `#${id}`;
  if (kind === "scenario") return scenarioLabel(tables.scenarios[id]);
  return `#${id}`;
}

function manualLookup(rev, text) {
  if (!text || !resolver) return null;
  if (rev.kind === "spark") {
    const res = resolveFactor(factorRes, { name: text, stars: rev.stars, kind: rev.color }, rev.cardId, []);
    return res ? { id: res.factor_id, name: tables.factors[res.factor_id]?.name ?? text } : null;
  }
  const idx = { skill: resolver.skills, race: resolver.programsByName, card: resolver.cards, epithet: resolver.nicknames, scenario: resolver.scenarios }[rev.kind];
  const hit = lookup(idx, text);
  return hit ? { id: hit.ids[0], name: currentName(rev.kind, hit.ids[0]) } : null;
}

function openReviewModal() {
  if (!reviewModal.open) reviewModal.showModal();
}

function closeReviewModal() {
  if (reviewModal.open) reviewModal.close();
}

// Renders the review cards into the modal body and keeps the "Needs review (N)" trigger in sync.
// Returns the number of open reviews.
function renderReviews(result) {
  const all = [...(result?.reviews ?? []), ...sparkReviews()];
  reviewOpen.hidden = !all.length;
  reviewOpen.textContent = `Needs review (${all.length}) — click to resolve`;
  reviewCount.textContent = String(all.length);
  if (!all.length) closeReviewModal();
  const sig = JSON.stringify(all.map((r) => [r.kind, r.index, r.raw, r.current, r.reason, r.shot]));
  if (sig === reviewSignature) return all.length; // keep focus in a manual input while the user types elsewhere
  reviewSignature = sig;
  reviewsEl.replaceChildren();
  if (!all.length) return 0;
  const intro = document.createElement("p");
  intro.className = "review-intro";
  intro.textContent = "These readings are ambiguous or were not recognised. Compare with the screenshot, then pick the right entry, type its name, or remove the reading.";
  reviewsEl.append(intro);
  for (const rev of all) reviewsEl.appendChild(makeReviewCard(rev));
  return all.length;
}

function makeReviewCard(rev) {
  const card = document.createElement("div");
  card.className = "review-card";

  const head = document.createElement("div");
  head.className = "review-head";
  const label = document.createElement("span");
  label.className = "review-kind";
  let labelText = REVIEW_LABEL[rev.kind];
  if (rev.kind === "spark") {
    labelText += ` · ${rev.stars}★ ${FACTOR_KIND_LABEL[rev.color] ?? rev.color}`;
    if (rev.scope === "parent") labelText += ` · parent ${tables.cards[rev.cardId] ?? rev.cardId}`;
  }
  label.textContent = labelText;
  const reason = document.createElement("span");
  reason.className = "review-reason";
  reason.textContent = rev.reason === "ambiguous" ? "several entries match equally well" : "not recognised";
  const raw = document.createElement("code");
  raw.className = "review-raw";
  raw.textContent = `OCR: “${rev.raw || "(empty)"}”`;
  head.append(label, reason, raw);
  card.appendChild(head);

  const item = rev.shot ? items.find((i) => i.file.name === rev.shot) : null;
  if (item?.img) {
    const shots = document.createElement("div");
    shots.className = "review-shots";
    if (rev.box) {
      const b = rev.box;
      const c = document.createElement("canvas");
      c.className = "review-crop";
      c.width = Math.max(1, Math.round(b.w));
      c.height = Math.max(1, Math.round(b.h));
      c.getContext("2d").drawImage(item.img, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
      shots.appendChild(c);
    }
    const details = document.createElement("details");
    details.className = "review-original";
    const summary = document.createElement("summary");
    summary.textContent = `Original screenshot (${item.file.name})`;
    const img = document.createElement("img");
    img.alt = item.file.name;
    details.addEventListener("toggle", () => { if (details.open && !img.src) img.src = item.url; });
    details.append(summary, img);
    shots.appendChild(details);
    card.appendChild(shots);
  }

  if (rev.candidates?.length) {
    const list = document.createElement("div");
    list.className = "review-candidates";
    for (const cand of rev.candidates) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "review-cand";
      if (rev.kind === "skill" && tables.skill_icons) {
        const icon = tables.skill_icons[String(cand.id)];
        if (icon) {
          const im = document.createElement("img");
          im.src = `./assets/skills/${icon}.png`;
          im.alt = "";
          btn.appendChild(im);
        }
      }
      const nm = document.createElement("span");
      nm.textContent = cand.name;
      btn.appendChild(nm);
      const meta = document.createElement("small");
      meta.textContent = `${Math.round(cand.score * 100)}% match · #${cand.id}`;
      btn.appendChild(meta);
      if (rev.current === cand.id) btn.classList.add("current");
      btn.addEventListener("click", () => reviewAction(rev, { type: "pick", id: cand.id, name: cand.name }));
      list.appendChild(btn);
    }
    card.appendChild(list);
  }

  const manual = document.createElement("div");
  manual.className = "review-manual";
  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("list", REVIEW_DL[rev.kind]);
  input.autocomplete = "off";
  input.placeholder = `Type the correct ${REVIEW_LABEL[rev.kind].toLowerCase()} name…`;
  const use = document.createElement("button");
  use.type = "button";
  use.className = "ghost";
  use.textContent = "Use";
  const err = document.createElement("span");
  err.className = "review-err";
  const applyManual = () => {
    const hit = manualLookup(rev, input.value.trim());
    if (!hit) { err.textContent = "Not in the table — pick a name from the list."; return; }
    reviewAction(rev, { type: "pick", id: hit.id, name: hit.name });
  };
  use.addEventListener("click", applyManual);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyManual(); } });
  manual.append(input, use, err);
  card.appendChild(manual);

  const actions = document.createElement("div");
  actions.className = "review-actions";
  if (rev.current != null) {
    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "ghost";
    keep.textContent = `Keep “${currentName(rev.kind, rev.current)}”`;
    keep.addEventListener("click", () => reviewAction(rev, { type: "keep" }));
    actions.appendChild(keep);
  }
  if (["skill", "race", "spark"].includes(rev.kind)) {
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "ghost danger";
    drop.textContent = "Remove this reading";
    drop.addEventListener("click", () => reviewAction(rev, { type: "discard" }));
    actions.appendChild(drop);
  } else if (rev.current == null) {
    const ignore = document.createElement("button");
    ignore.type = "button";
    ignore.className = "ghost";
    ignore.textContent = "Ignore";
    ignore.addEventListener("click", () => reviewAction(rev, { type: "keep" }));
    actions.appendChild(ignore);
  }
  card.appendChild(actions);
  return card;
}

// Applies a review decision to the parsed data, then re-assembles and re-renders everything.
function reviewAction(rev, act) {
  if (!lastParsed || !tables) return;
  clearTimeout(applyTimer);
  applyTimer = null;
  readableToParsed(); // pull in any pending readable-view edits first
  const p = lastParsed;
  if (rev.kind === "spark") {
    const insp = p.inspiration;
    const u = insp?.unresolved?.[rev.index];
    if (!u) return;
    if (act.type === "pick") {
      if (u.scope === "own") insp.ownFactorIds = [...new Set([...insp.ownFactorIds, act.id])].sort((a, b) => a - b);
      else {
        const parent = insp.parents.find((x) => x.cardId === u.cardId);
        if (parent) parent.factorIds = [...new Set([...parent.factorIds, act.id])].sort((a, b) => a - b);
      }
    }
    insp.unresolved.splice(rev.index, 1);
  } else if (rev.kind === "skill" || rev.kind === "race") {
    const arr = rev.kind === "skill" ? p.skills : p.races;
    const entry = arr?.[rev.index];
    if (!entry) return;
    if (act.type === "discard") arr.splice(rev.index, 1);
    else {
      if (act.type === "pick") {
        entry.name = act.name;
        if (rev.kind === "race") delete entry.raw;
      }
      entry.confirmed = true;
    }
  } else {
    const h = p.header ?? (p.header = {});
    const sm = p.summary ?? (p.summary = {});
    if (rev.kind === "card") {
      if (act.type === "pick") { h.title = act.name; h.name = ""; }
      h.cardConfirmed = true;
    } else if (rev.kind === "epithet") {
      if (act.type === "pick") { h.epithet = act.name; delete h.epithetCandidates; }
      h.epithetConfirmed = true;
    } else if (rev.kind === "scenario") {
      if (act.type === "pick") sm.scenario = act.name;
      sm.scenarioConfirmed = true;
    }
  }
  const result = assemble(p, tables);
  showJson(result.veteran);
  buildReadable(p, result.veteran);
  showWarnings([...result.warnings, ...lastNotes]);
  reviewSignature = null; // indices may have shifted
  renderReviews(result);
  // Keep the flow going: focus the next review's first action while the window is still open.
  if (reviewModal.open) reviewsEl.querySelector(".review-cand, .review-manual input")?.focus();
}

function clearReviews() {
  reviewSignature = null;
  reviewsEl.replaceChildren();
  reviewOpen.hidden = true;
  closeReviewModal();
}

function highlightJson(value) {
  const text = JSON.stringify(value, null, 2)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (match, str, colon, literal) => {
      if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
      if (literal) return `<span class="b">${literal}</span>`;
      return `<span class="n">${match}</span>`;
    },
  );
}

function showJson(veteran) {
  lastVeteran = veteran;
  jsonEl.innerHTML = highlightJson(veteran);
  copyButton.disabled = false;
  downloadButton.disabled = false;
}

// ---------------------------------------------------------------- readable view

function setView(mode) {
  const json = mode === "json";
  viewReadable.setAttribute("aria-selected", String(!json));
  viewJson.setAttribute("aria-selected", String(json));
  viewReadable.tabIndex = json ? -1 : 0;
  viewJson.tabIndex = json ? 0 : -1;
  readableEl.hidden = json;
  jsonEl.hidden = !json;
  // Keep keyboard focus on the visible tab when the switch came from the tab strip.
  if (document.activeElement === viewReadable || document.activeElement === viewJson) {
    (json ? viewJson : viewReadable).focus();
  }
}

function showReadablePlaceholder(text) {
  const p = document.createElement("p");
  p.className = "placeholder";
  p.textContent = text;
  readableEl.replaceChildren(p);
}

function numOrNull(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function setInput(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value == null ? "" : value;
}

function setHint(el, info) {
  if (!el) return;
  el.textContent = info?.text ?? "";
  el.classList.toggle("bad", Boolean(info?.bad));
}

function compareLabel(hit) {
  if (!hit) return "";
  return hit.exact ? "" : " · approximate";
}

function scenarioLabel(value) {
  return String(value ?? "").replaceAll("\\n", "\n").replace(/\n/g, " ").trim();
}

function ensureDatalists() {
  if (!tables || document.getElementById("dl-cards")) return;
  const add = (id, values) => {
    const list = document.createElement("datalist");
    list.id = id;
    for (const value of new Set(values.filter(Boolean))) {
      const option = document.createElement("option");
      option.value = value;
      list.appendChild(option);
    }
    document.body.appendChild(list);
  };
  add("dl-cards", Object.values(tables.cards));
  add("dl-nicknames", Object.values(tables.nicknames));
  add("dl-skills", Object.values(tables.skills).map((s) => s.name));
  add("dl-races", resolver?.raceNames ?? []);
  add("dl-scenarios", Object.values(tables.scenarios).map(scenarioLabel));
  add("dl-factors", Object.values(tables.factors).map((f) => f.name));
}

function selectEl(className, options, value) {
  const select = document.createElement("select");
  select.className = className;
  for (const [optionValue, label] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = value == null ? "" : String(value);
  return select;
}

function makeSkillRow(skill = {}) {
  const li = document.createElement("li");
  li.className = "read-row skill-row";
  li._data = skill;

  const icon = document.createElement("span");
  icon.className = "skill-icon empty";
  icon.setAttribute("aria-hidden", "true");

  const main = document.createElement("div");
  main.className = "row-main";
  const name = document.createElement("input");
  name.className = "skill-name";
  name.type = "text";
  name.setAttribute("list", "dl-skills");
  name.autocomplete = "off";
  name.placeholder = "Skill name";
  name.value = skill.name ?? "";
  const hint = document.createElement("span");
  hint.className = "row-hint";
  main.append(name, hint);

  const level = document.createElement("label");
  level.className = "mini-field";
  const levelLabel = document.createElement("span");
  levelLabel.textContent = "Lvl";
  const levelInput = document.createElement("input");
  levelInput.className = "skill-level";
  levelInput.type = "number";
  levelInput.min = "1";
  levelInput.max = "10";
  levelInput.inputMode = "numeric";
  levelInput.value = skill.level ?? "";
  level.append(levelLabel, levelInput);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove remove-skill";
  remove.title = "Remove skill";
  remove.setAttribute("aria-label", "Remove skill");
  remove.textContent = "×";

  li.append(icon, main, level, remove);
  return li;
}

function makeRaceRow(race = {}) {
  const li = document.createElement("li");
  li.className = "read-row race-row";
  li._data = race;

  const main = document.createElement("div");
  main.className = "row-main";
  const name = document.createElement("input");
  name.className = "race-name";
  name.type = "text";
  name.setAttribute("list", "dl-races");
  name.autocomplete = "off";
  name.placeholder = "Race name";
  name.value = race.name ?? "";
  const hint = document.createElement("span");
  hint.className = "row-hint";
  main.append(name, hint);

  const year = document.createElement("label");
  year.className = "mini-field";
  const yearLabel = document.createElement("span");
  yearLabel.textContent = "Year";
  year.append(yearLabel, selectEl("race-year", [["", "—"], ["0", "Junior"], ["1", "Classic"], ["2", "Senior"]], race.year));

  const month = document.createElement("label");
  month.className = "mini-field";
  const monthLabel = document.createElement("span");
  monthLabel.textContent = "Month";
  month.append(monthLabel, selectEl("race-month", [["", "—"], ...MONTHS.map((m, i) => [String(i + 1), m])], race.month));

  const half = document.createElement("label");
  half.className = "mini-field";
  const halfLabel = document.createElement("span");
  halfLabel.textContent = "Half";
  half.append(halfLabel, selectEl("race-half", [["", "—"], ["1", "Early"], ["2", "Late"]], race.half));

  const style = document.createElement("label");
  style.className = "mini-field";
  const styleLabel = document.createElement("span");
  styleLabel.textContent = "Style";
  style.append(styleLabel, selectEl("race-strategy",
    [["", "—"], ["front", "Front"], ["pace", "Pace"], ["late", "Late"], ["end", "End"]], race.strategy));

  const rank = document.createElement("label");
  rank.className = "mini-field";
  const rankLabel = document.createElement("span");
  rankLabel.textContent = "Finish";
  const rankInput = document.createElement("input");
  rankInput.className = "race-rank";
  rankInput.type = "number";
  rankInput.min = "1";
  rankInput.max = "30";
  rankInput.inputMode = "numeric";
  rankInput.value = race.rank ?? "";
  rank.append(rankLabel, rankInput);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove remove-race";
  remove.title = "Remove race";
  remove.setAttribute("aria-label", "Remove race");
  remove.textContent = "×";

  li.append(main, year, month, half, style, rank, remove);
  return li;
}

// ---------------------------------------------------------------- inspiration (factors)

function starsOf(id) {
  const f = tables?.factors?.[id];
  if (!f) return 1;
  return f.type === 7 ? 1 : id % 10;
}

function factorKind(id) {
  const t = tables?.factors?.[id]?.type;
  if (t === 3) return "green";
  if (t === 1) return "blue";
  if (t === 2) return "red";
  return "unknown";
}

// Presentation order for sparks: blue (stats), pink (aptitudes), green (unique), then white
// (skill/race) sparks — repeated for the trainee and for each parent. ids stay sorted in the JSON.
const FACTOR_KIND_ORDER = { blue: 0, red: 1, green: 2, unknown: 3 };
const FACTOR_KIND_LABEL = { blue: "blue", red: "pink", green: "green", unknown: "white" };
function byFactorKind(a, b) {
  return (FACTOR_KIND_ORDER[factorKind(a)] ?? 3) - (FACTOR_KIND_ORDER[factorKind(b)] ?? 3) || a - b;
}

function traineeCardId() {
  const card = $("r-card")?.value.trim();
  if (card && resolver) {
    const hit = lookup(resolver.cards, card);
    if (hit) return hit.ids[0];
  }
  return lastVeteran?.card_id ?? 0;
}

function makeFactorRow(id, className) {
  const li = document.createElement("li");
  li.className = `read-row ${className}`;
  li._data = { id, kind: factorKind(id) };
  li.dataset.kind = li._data.kind;

  const main = document.createElement("div");
  main.className = "row-main";
  const name = document.createElement("input");
  name.className = "factor-name";
  name.type = "text";
  name.setAttribute("list", "dl-factors");
  name.autocomplete = "off";
  name.placeholder = "Factor name";
  name.value = tables?.factors?.[id]?.name ?? "";
  const hint = document.createElement("span");
  hint.className = "row-hint";
  main.append(name, hint);

  const stars = document.createElement("label");
  stars.className = "mini-field";
  const starsLabel = document.createElement("span");
  starsLabel.textContent = "★";
  stars.append(starsLabel, selectEl("factor-stars", [["1", "1"], ["2", "2"], ["3", "3"]], starsOf(id)));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove remove-factor";
  remove.title = "Remove factor";
  remove.setAttribute("aria-label", "Remove factor");
  remove.textContent = "×";

  li.append(main, stars, remove);
  return li;
}

// Resolve one editable factor row to an id, updating its hint. `cardId` owns the green unique spark.
function resolveFactorRow(row, cardId) {
  const hint = row.querySelector(".row-hint");
  const name = row.querySelector(".factor-name").value.trim();
  const stars = numOrNull(row.querySelector(".factor-stars").value) ?? 0;
  if (!name) {
    hint.textContent = "";
    hint.classList.remove("bad");
    return null;
  }
  const cell = { name, stars, kind: row._data?.kind ?? "unknown" };
  if (!factorRes && tables) factorRes = makeFactorResolver(tables);
  const res = factorRes ? resolveFactor(factorRes, cell, cardId, []) : null;
  if (!res) {
    hint.textContent = "Not recognised — pick a factor name and star count";
    hint.classList.add("bad");
    return null;
  }
  hint.textContent = `→ #${res.factor_id} ${tables.factors[res.factor_id]?.name ?? ""} · ${stars}★`;
  hint.classList.remove("bad");
  return res.factor_id;
}

function makeParentBlock(b) {
  const li = document.createElement("li");
  li.className = "parent-block";
  li._data = b;

  const head = document.createElement("div");
  head.className = "parent-head";
  const title = document.createElement("strong");
  const slot = b.positionId === 10 ? "Parent 1 (top)" : b.positionId === 20 ? "Parent 2 (bottom)" : "Parent";
  title.textContent = `${slot} — ${tables.cards[b.cardId] ?? `card ${b.cardId}`}`;
  const badge = document.createElement("span");
  badge.className = "parent-badge";
  head.append(title, badge);
  li.appendChild(head);

  if (b.dropped) {
    const e = b.dropped;
    const info = document.createElement("p");
    info.className = "section-note";
    info.textContent = `From JSON · rank ${e.rank ?? 0} · rarity ${e.rarity ?? 3} · talent ${e.talent_level ?? 0} · ${(e.win_saddle_id_array ?? []).length} saddles · ${(e.factor_info_array ?? []).length} factors`;
    li.appendChild(info);
    const ul = document.createElement("ul");
    ul.className = "read-list parent-factors readonly";
    for (const f of [...(e.factor_info_array ?? [])].sort((a, b) => byFactorKind(a.factor_id, b.factor_id))) {
      const row = document.createElement("li");
      row.className = "read-row factor-static";
      row.dataset.kind = factorKind(f.factor_id);
      row.textContent = `#${f.factor_id} ${tables.factors[f.factor_id]?.name ?? ""} · ${starsOf(f.factor_id)}★`;
      ul.appendChild(row);
    }
    li.appendChild(ul);
  } else {
    const ul = document.createElement("ul");
    ul.className = "read-list parent-factors";
    for (const id of [...(b.factorIds ?? [])].sort(byFactorKind)) ul.appendChild(makeFactorRow(id, "insp-factor-row"));
    li.appendChild(ul);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "ghost add-parent-factor";
    add.textContent = "+ Add factor";
    li.appendChild(add);
  }
  return li;
}

function renderInspiration(insp) {
  const ownList = $("insp-own-list");
  const parentList = $("parent-list");
  if (!ownList || !parentList) return;
  ownList.replaceChildren();
  parentList.replaceChildren();
  for (const id of [...(insp?.ownFactorIds ?? [])].sort(byFactorKind)) ownList.appendChild(makeFactorRow(id, "insp-own-row"));

  const dropped = insp?.dropped ?? [];
  const ocrParents = insp?.parents ?? [];
  const droppedByCard = new Map(dropped.map((d) => [d.entry.card_id, d]));
  const blocks = [];
  for (const d of dropped) {
    const ocr = ocrParents.find((p) => p.cardId === d.entry.card_id);
    blocks.push({ cardId: d.entry.card_id, positionId: d.position_id, greenStars: ocr?.greenStars, dropped: d.entry });
  }
  for (const p of ocrParents) if (!droppedByCard.has(p.cardId)) blocks.push({ ...p, dropped: null });
  blocks.sort((a, b) => (a.positionId || 99) - (b.positionId || 99));
  for (const b of blocks) parentList.appendChild(makeParentBlock(b));
  updateCounts();
}

function updateInspHints() {
  if (!tables || !$("insp-own-list")) return;
  const cardId = traineeCardId();
  for (const row of readableEl.querySelectorAll(".insp-own-row")) resolveFactorRow(row, cardId);
  for (const block of readableEl.querySelectorAll(".parent-block")) {
    const b = block._data;
    const badge = block.querySelector(".parent-badge");
    if (b.dropped) {
      if (b.greenStars == null) {
        badge.textContent = "green spark not seen";
        badge.classList.remove("ok", "bad");
      } else {
        const greenId = b.cardId * 100 + b.greenStars;
        const ok = (b.dropped.factor_info_array ?? []).some((f) => f.factor_id === greenId);
        badge.textContent = ok ? `✓ green ${b.greenStars}★ confirmed` : `⚠ green ${b.greenStars}★ not in JSON`;
        badge.classList.toggle("ok", ok);
        badge.classList.toggle("bad", !ok);
      }
    } else {
      for (const row of block.querySelectorAll(".insp-factor-row")) resolveFactorRow(row, b.cardId);
      badge.textContent = b.greenStars != null ? `green ${b.greenStars}★ · sparks only` : "unidentified";
      badge.classList.remove("ok", "bad");
    }
  }
}

function buildReadable(parsed, veteran) {
  if (!tables) return;
  ensureDatalists();
  const h = parsed.header ?? {};
  const sm = parsed.summary ?? {};
  const card = veteran?.card_id && tables.cards[veteran.card_id]
    ? tables.cards[veteran.card_id]
    : [h.title, h.name].filter(Boolean).join(" ");
  const epithet = veteran?.nickname_id && tables.nicknames[veteran.nickname_id]
    ? tables.nicknames[veteran.nickname_id]
    : (h.epithet ?? h.epithetCandidates?.[0] ?? "");
  const scenario = veteran?.scenario_id && tables.scenarios[veteran.scenario_id]
    ? scenarioLabel(tables.scenarios[veteran.scenario_id])
    : (sm.scenario ?? "");
  const rating = Number.isFinite(h.rating) ? h.rating
    : Number.isFinite(sm.rating) ? sm.rating : "";

  readableEl.innerHTML = `
    <p class="read-intro">Fix anything the OCR got wrong. Edits are applied to the JSON as you type.</p>
    <section class="read-section">
      <h3>Trainee</h3>
      <div class="field-grid">
        <label class="field wide"><span>Card</span><input id="r-card" list="dl-cards" autocomplete="off" placeholder="[Title] Name"><span id="r-card-hint" class="field-hint"></span></label>
        <label class="field wide"><span>Epithet</span><input id="r-epithet" list="dl-nicknames" autocomplete="off" placeholder="Epithet"><span id="r-epithet-hint" class="field-hint"></span></label>
        <label class="field"><span>Rating</span><input id="r-rating" type="number" min="0" step="1" inputmode="numeric"><span id="r-rank-hint" class="field-hint"></span></label>
        <label class="field wide"><span>Memo</span><input id="r-memo" autocomplete="off" placeholder="Memo"></label>
      </div>
      <div class="field-grid stat-grid">
        ${STATS.map(([key, label]) => `<label class="field"><span>${label}</span><input id="r-stat-${key}" type="number" min="0" step="1" inputmode="numeric"></label>`).join("")}
      </div>
      <div class="field-grid apt-grid">
        ${APTITUDES.map(([key, label]) => `<label class="field"><span>${label}</span><select id="r-apt-${key}">${APTITUDE_LETTERS.map((letter) => `<option value="${letter}">${letter || "—"}</option>`).join("")}</select></label>`).join("")}
      </div>
    </section>

    <section class="read-section">
      <div class="section-head">
        <h3>Skills <span id="skill-count" class="count"></span></h3>
        <button type="button" class="ghost add-skill">+ Add skill</button>
      </div>
      <ul id="skill-list" class="read-list"></ul>
    </section>

    <section class="read-section">
      <h3>Career summary</h3>
      <div class="field-grid">
        <label class="field"><span>Races</span><input id="r-races" type="number" min="0" step="1" inputmode="numeric"></label>
        <label class="field"><span>Wins</span><input id="r-wins" type="number" min="0" step="1" inputmode="numeric"></label>
        <label class="field"><span>Fans earned</span><input id="r-fans" type="number" min="0" step="1" inputmode="numeric"></label>
        <label class="field wide"><span>Scenario</span><input id="r-scenario" list="dl-scenarios" autocomplete="off" placeholder="Career scenario"><span id="r-scenario-hint" class="field-hint"></span></label>
        <label class="field"><span>Date acquired</span><input id="r-date" type="date"></label>
      </div>
    </section>

    <section class="read-section">
      <div class="section-head">
        <h3>Race history <span id="race-count" class="count"></span></h3>
        <button type="button" class="ghost add-race">+ Add race</button>
      </div>
      <p class="section-note">Year, month and half come from the “Race Time” line. They help pick the right program when a race name exists more than once.</p>
      <ul id="race-list" class="read-list"></ul>
    </section>

    <section class="read-section">
      <div class="section-head">
        <h3>Inspiration <span id="insp-count" class="count"></span></h3>
        <button type="button" class="ghost add-spark">+ Add spark</button>
      </div>
      <p class="section-note">Own sparks become factor_info_array. Parents fill the two succession slots; drop a previously generated parent JSON to supply its full data. A parent is confirmed by its green unique spark.</p>
      <h4 class="subhead">Own sparks</h4>
      <ul id="insp-own-list" class="read-list"></ul>
      <h4 class="subhead">Parents</h4>
      <ul id="parent-list" class="read-list parent-list"></ul>
    </section>`;

  setInput("r-card", card);
  setInput("r-epithet", epithet);
  setInput("r-rating", rating);
  setInput("r-memo", h.memo && !/^[-–]$/.test(h.memo.trim()) ? h.memo : "");
  for (const [key] of STATS) setInput(`r-stat-${key}`, Number.isFinite(h.stats?.[key]) ? h.stats[key] : "");
  for (const [key] of APTITUDES) setInput(`r-apt-${key}`, h.aptitudes?.[key] ?? "");
  setInput("r-races", Number.isFinite(sm.races) ? sm.races : "");
  setInput("r-wins", Number.isFinite(sm.wins) ? sm.wins : "");
  setInput("r-fans", Number.isFinite(sm.fans) ? sm.fans : "");
  setInput("r-scenario", scenario);
  setInput("r-date", sm.date ?? "");

  // Remember what the OCR produced so an edit to one field does not discard better data for another
  // (for example an epithet that assemble() picked from several OCR candidates).
  readableEl._initial = { card, epithet, memo: h.memo ?? "" };
  readableEl.dataset.skillsRead = parsed.skills ? "1" : "0";
  readableEl.dataset.racesRead = parsed.races ? "1" : "0";
  readableEl.dataset.inspRead = parsed.inspiration ? "1" : "0";

  renderSkillList(parsed.skills ?? []);
  renderRaceList(parsed.races ?? []);
  renderInspiration(parsed.inspiration);
  updateHints();
}

function renderSkillList(skills) {
  const list = $("skill-list");
  list.replaceChildren();
  for (const skill of skills) list.appendChild(makeSkillRow(skill));
  updateCounts();
}

function renderRaceList(races) {
  const list = $("race-list");
  list.replaceChildren();
  for (const race of races) list.appendChild(makeRaceRow(race));
  updateCounts();
}

function updateEmptyRow(list, rowSelector, text) {
  const empty = list.querySelector(".empty-row");
  if (list.querySelector(rowSelector)) {
    empty?.remove();
    return;
  }
  if (!empty) {
    const li = document.createElement("li");
    li.className = "empty-row";
    li.textContent = text;
    list.appendChild(li);
  }
}

function updateCounts() {
  const skillList = $("skill-list");
  const raceList = $("race-list");
  if (!skillList || !raceList) return;
  const skills = skillList.querySelectorAll(".skill-row").length;
  const races = raceList.querySelectorAll(".race-row").length;
  $("skill-count").textContent = String(skills);
  $("race-count").textContent = String(races);
  updateEmptyRow(skillList, ".skill-row", "No skills in the entry. Use “Add skill” to enter one.");
  updateEmptyRow(raceList, ".race-row", "No races in the entry. Use “Add race” to enter one.");
  const ownList = $("insp-own-list");
  const parentList = $("parent-list");
  if (ownList && parentList && $("insp-count")) {
    const own = ownList.querySelectorAll(".insp-own-row").length;
    const parents = parentList.querySelectorAll(".parent-block").length;
    $("insp-count").textContent = `${own} spark${own === 1 ? "" : "s"} · ${parents} parent${parents === 1 ? "" : "s"}`;
    updateEmptyRow(ownList, ".insp-own-row", "No own sparks read. Capture the Inspiration tab, or add one.");
    updateEmptyRow(parentList, ".parent-block", "No parents. Capture the Inspiration tab or drop a parent JSON.");
  }
}

function matchSkill(name) {
  if (!name || !resolver) return null;
  const native = lastVeteran?.card_id ? nativeUniqueSkill(lastVeteran.card_id) : null;
  return resolveSkill(resolver, { name, level: 1 }, native);
}

function iconForSkill(match) {
  if (!match || !tables?.skill_icons) return null;
  for (const id of [match.id, ...match.hit.ids]) {
    const icon = tables.skill_icons[String(id)];
    if (icon) return icon;
  }
  return null;
}

function updateSkillRow(row) {
  if (!row) return;
  const name = row.querySelector(".skill-name").value.trim();
  const match = matchSkill(name);
  const icon = iconForSkill(match);
  const holder = row.querySelector(".skill-icon");
  holder.replaceChildren();
  holder.classList.toggle("empty", !icon);
  if (icon) {
    const img = document.createElement("img");
    img.src = `./assets/skills/${icon}.png`;
    img.alt = "";
    holder.appendChild(img);
  }

  const hint = row.querySelector(".row-hint");
  if (!name) {
    hint.textContent = "";
    hint.classList.remove("bad");
    return;
  }
  if (!match) {
    hint.textContent = "Not recognised — choose a name from the list";
    hint.classList.add("bad");
    return;
  }
  const resolved = tables.skills[match.id]?.name ?? "";
  hint.textContent = `→ #${match.id} ${resolved}${compareLabel(match.hit)}${match.hit.ids.length > 1 ? ` · ${match.hit.ids.length} possible ids` : ""}${match.uncertain ? " · needs review" : ""}`;
  hint.classList.toggle("bad", Boolean(match.uncertain));
}

function matchRace(name) {
  if (!name || !resolver) return null;
  let hit = lookup(resolver.programsByName, name);
  if (!hit) {
    const wm = wordMatch(resolver.raceNames, name);
    hit = wm ? lookup(resolver.programsByName, wm.name) : null;
  }
  return hit;
}

function charaId() {
  return lastVeteran?.card_id ? Math.floor(lastVeteran.card_id / 100) : 0;
}

function updateRaceRow(row) {
  if (!row) return;
  const name = row.querySelector(".race-name").value.trim();
  const hint = row.querySelector(".row-hint");
  if (!name) {
    hint.textContent = "";
    hint.classList.remove("bad");
    return;
  }
  const match = matchRace(name);
  if (!match) {
    hint.textContent = "Not recognised — choose a name from the list";
    hint.classList.add("bad");
    return;
  }
  const year = numOrNull(row.querySelector(".race-year").value);
  const month = numOrNull(row.querySelector(".race-month").value);
  const half = numOrNull(row.querySelector(".race-half").value);
  const revs = [];
  const program = pickProgram(resolver, { name, year, month, half, confirmed: row._data?.confirmed }, charaId(), [], revs);
  if (!program) {
    hint.textContent = month && half
      ? `→ no program on ${MONTHS[month - 1]} ${half === 1 ? "Early" : "Late"} · ${match.ids.length} possible`
      : `→ ${match.ids.length} possible program${match.ids.length === 1 ? "" : "s"} · add the date to choose`;
    hint.classList.add("bad");
    return;
  }
  let text = `→ ${program.p.name} · ${MONTHS[program.p.month - 1] ?? "?"} ${program.p.half === 1 ? "Early" : "Late"}${compareLabel(match)}`;
  if (match.ids.length > 1) text += ` · ${match.ids.length} possible programs`;
  if (!month || !half) text += " · add the date to choose";
  else if (year == null) text += " · add the year to narrow";
  if (revs.length) text += " · needs review";
  hint.textContent = text;
  hint.classList.toggle("bad", revs.length > 0);
}

function updateHints() {
  if (!tables || !resolver || !$("r-card")) return;

  const card = $("r-card").value.trim();
  if (!card) setHint($("r-card-hint"), null);
  else {
    const hit = lookup(resolver.cards, card);
    setHint($("r-card-hint"), hit ? {
      text: `→ #${hit.ids[0]} ${tables.cards[hit.ids[0]]}${compareLabel(hit)}${hit.ids.length > 1 ? ` · ${hit.ids.length} cards` : ""}`,
    } : { text: "Not recognised — choose a card from the list", bad: true });
  }

  const epithet = $("r-epithet").value.trim();
  if (!epithet) setHint($("r-epithet-hint"), null);
  else {
    const hit = lookup(resolver.nicknames, epithet, 0.12);
    setHint($("r-epithet-hint"), hit ? {
      text: `→ #${hit.ids[0]} ${tables.nicknames[hit.ids[0]]}${compareLabel(hit)}`,
    } : { text: "Not recognised — choose an epithet from the list", bad: true });
  }

  const scenario = $("r-scenario").value.trim();
  if (!scenario) setHint($("r-scenario-hint"), null);
  else {
    const hit = lookup(resolver.scenarios, scenario);
    setHint($("r-scenario-hint"), hit ? {
      text: `→ #${hit.ids[0]} ${scenarioLabel(tables.scenarios[hit.ids[0]])}${compareLabel(hit)}`,
    } : { text: "Not recognised — choose a scenario from the list", bad: true });
  }

  const rating = numOrNull($("r-rating").value);
  if (rating == null) setHint($("r-rank-hint"), null);
  else {
    const rank = rankFromRating(rating, tables.umamusume_rating_ranks.ranks);
    setHint($("r-rank-hint"), rank ? { text: `Rank ${tables.umamusume_rating_ranks.ranks[rank - 1]?.rank ?? ""}` } : null);
  }

  for (const row of readableEl.querySelectorAll(".skill-row")) updateSkillRow(row);
  for (const row of readableEl.querySelectorAll(".race-row")) updateRaceRow(row);
  updateInspHints();
  updateCounts();
}

function readableToParsed() {
  if (!lastParsed || !$("r-card")) return;

  const h = lastParsed.header ?? (lastParsed.header = {});
  const initial = readableEl._initial ?? {};
  const card = $("r-card").value.trim();
  const epithet = $("r-epithet").value.trim();
  const rating = numOrNull($("r-rating").value);
  const ratingChanged = rating !== (h.rating ?? null);

  // Only overwrite the OCR fields the user actually touched. In particular, an untouched epithet may
  // still have several OCR candidates for assemble() to choose from.
  if (card !== initial.card) {
    h.title = card;
    h.name = "";
  }
  if (epithet !== initial.epithet) {
    h.epithet = epithet || null;
    delete h.epithetCandidates;
  }
  h.rating = rating;
  h.memo = $("r-memo").value.trim();
  h.stats = h.stats ?? {};
  for (const [key] of STATS) h.stats[key] = numOrNull($(`r-stat-${key}`).value);
  h.aptitudes = h.aptitudes ?? {};
  for (const [key] of APTITUDES) h.aptitudes[key] = $(`r-apt-${key}`).value || null;

  const hasHeader = card || h.epithet || Number.isFinite(h.rating) || h.memo
    || Object.values(h.stats).some((v) => Number.isFinite(v))
    || Object.values(h.aptitudes).some(Boolean);
  lastParsed.header = hasHeader ? h : null;

  const sm = lastParsed.summary ?? (lastParsed.summary = {});
  sm.races = numOrNull($("r-races").value);
  sm.wins = numOrNull($("r-wins").value);
  sm.fans = numOrNull($("r-fans").value);
  sm.scenario = $("r-scenario").value.trim() || null;
  sm.date = $("r-date").value || null;
  const hasSummary = [sm.races, sm.wins, sm.fans, sm.scenario, sm.date].some((v) => v != null);
  // Keep the OCR'd summary rating so the cross-check warning survives unrelated edits, but follow a
  // rating the user corrected in the header.
  if (hasSummary && (ratingChanged || sm.rating == null)) sm.rating = h.rating ?? null;
  lastParsed.summary = hasSummary ? sm : null;

  const skills = [];
  for (const row of readableEl.querySelectorAll(".skill-row")) {
    const name = row.querySelector(".skill-name").value.trim();
    if (!name) continue;
    const skill = row._data ? { ...row._data } : {};
    skill.name = name;
    skill.level = numOrNull(row.querySelector(".skill-level").value);
    skills.push(skill);
  }
  lastParsed.skills = skills.length ? skills : (readableEl.dataset.skillsRead === "1" ? [] : null);

  const races = [];
  for (const row of readableEl.querySelectorAll(".race-row")) {
    const name = row.querySelector(".race-name").value.trim();
    if (!name) continue;
    const race = row._data ? { ...row._data } : {};
    if (race.name !== name) delete race.raw;
    race.name = name;
    race.year = numOrNull(row.querySelector(".race-year").value);
    race.month = numOrNull(row.querySelector(".race-month").value);
    race.half = numOrNull(row.querySelector(".race-half").value);
    race.strategy = row.querySelector(".race-strategy").value || null;
    race.rank = numOrNull(row.querySelector(".race-rank").value);
    races.push(race);
  }
  lastParsed.races = races.length ? races : (readableEl.dataset.racesRead === "1" ? [] : null);

  if ($("insp-own-list")) {
    const dropped = lastParsed.inspiration?.dropped ?? [];
    const cardId = traineeCardId();
    const ownIds = [];
    for (const row of readableEl.querySelectorAll(".insp-own-row")) {
      const id = resolveFactorRow(row, cardId);
      if (id) ownIds.push(id);
    }
    const parents = [];
    for (const block of readableEl.querySelectorAll(".parent-block")) {
      const b = block._data;
      if (b.dropped) continue; // a dropped JSON is authoritative; its factors are not edited here
      const ids = [];
      for (const row of block.querySelectorAll(".insp-factor-row")) {
        const id = resolveFactorRow(row, b.cardId);
        if (id) ids.push(id);
      }
      parents.push({ positionId: b.positionId, cardId: b.cardId, greenStars: b.greenStars,
        greenName: b.greenName, factorIds: [...new Set(ids)].sort((a, b) => a - b) });
    }
    const ownFactorIds = [...new Set(ownIds)].sort((a, b) => a - b);
    const unresolved = lastParsed.inspiration?.unresolved ?? [];
    const hasInsp = ownFactorIds.length || parents.length || dropped.length || unresolved.length;
    lastParsed.inspiration = hasInsp
      ? { ownFactorIds, parents, dropped, unresolved }
      : (readableEl.dataset.inspRead === "1" ? { ownFactorIds: [], parents: [], dropped: [], unresolved: [] } : null);
  }
}

function applyEdits() {
  clearTimeout(applyTimer);
  applyTimer = null;
  if (!lastParsed || !tables || !resolver) return;
  readableToParsed();
  const result = assemble(lastParsed, tables);
  showJson(result.veteran);
  showWarnings([...result.warnings, ...lastNotes]);
  renderReviews(result);
  updateHints();
}

function resetEdits() {
  if (running || !ocrParsed || !tables || !resolver) return;
  clearTimeout(applyTimer);
  applyTimer = null;
  lastParsed = JSON.parse(JSON.stringify(ocrParsed));
  lastNotes = [...ocrNotes];
  const result = assemble(lastParsed, tables);
  showJson(result.veteran);
  buildReadable(lastParsed, result.veteran);
  showWarnings([...result.warnings, ...lastNotes]);
  reviewSignature = null;
  renderReviews(result);
  setView("readable");
}

function scheduleApply() {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(applyEdits, 250);
}

function addSkillRow() {
  const list = $("skill-list");
  if (!list) return;
  const row = makeSkillRow();
  list.appendChild(row);
  updateCounts();
  row.querySelector(".skill-name").focus();
  scheduleApply();
}

function addRaceRow() {
  const list = $("race-list");
  if (!list) return;
  const row = makeRaceRow();
  list.appendChild(row);
  updateCounts();
  row.querySelector(".race-name").focus();
  scheduleApply();
}

function addSparkRow() {
  const list = $("insp-own-list");
  if (!list) return;
  const row = makeFactorRow(null, "insp-own-row");
  list.appendChild(row);
  updateCounts();
  row.querySelector(".factor-name").focus();
  scheduleApply();
}

// ---------------------------------------------------------------- classification

// Words from the full-image OCR pass are a cheap way to pick the page when the tab strip is missed.
function inferKind(words = []) {
  const text = words.map((w) => w.text).join(" ");
  if (/race\s*time|strateg\w*\s+(front|pace|late|end)/i.test(text)) return "career";
  if (/career\s*(record|scenario)|fans\s*earned|date\s*acquired|major\s*wins/i.test(text)) return "career";
  if (/legacy\s*origin|\bsparks\b/i.test(text)) return "inspiration";
  if (/\blv[l1i]?\s*\d/i.test(text) || /\blv[l1i]\b/i.test(text)) return "skills";
  return null;
}

async function ensureWorker() {
  if (worker) return worker;
  const abs = (p) => new URL(p, import.meta.url).href;
  setEngine("busy", "Loading OCR engine…");
  worker = await Tesseract.createWorker("eng", 1, {
    workerPath: abs("./vendor/tesseract/worker.min.js"),
    corePath: abs("./vendor/tesseract-core"),
    langPath: abs("./tessdata"),
    logger: (m) => {
      if (!m || !m.status) return;
      const pct = Number.isFinite(m.progress) ? ` ${Math.round(m.progress * 100)}%` : "";
      setEngine("busy", `OCR: ${m.status}${pct}`);
    },
  });
  setEngine("ready", "OCR ready");
  return worker;
}

// ---------------------------------------------------------------- pipeline

async function readItem(item, state) {
  const canvas = toCanvas(env, item.img);
  const found = await findAnchors(env, worker, canvas);
  const anchorsOk = Boolean(found.anchors.speed && found.anchors.wit);

  // Header is fixed on every page, so the first readable screenshot supplies it.
  if (!state.header) {
    const h = await readHeader(env, worker, canvas, { anchors: found.anchors, tabs: found.tabs });
    if (h.header) {
      state.header = h.header;
      state.header.shot = item.file.name;
      state.header.infoBox = h.regions?.info ?? null;
      state.headerWarnings = h.warnings ?? [];
      log(`  header: ${h.header.title ?? "?"} ${h.header.name ?? ""} · ${h.header.rating ?? "?"} rating`);
    } else if (h.warnings?.length) {
      log(`  header not found: ${h.warnings[0]}`);
    }
  }

  let tabs = found.tabs ?? {};
  if (anchorsOk) {
    // The dedicated tab-strip pass is more reliable than the coordinates that fall out of the
    // full-image OCR; the tests use it in preference too.
    try {
      tabs = { ...tabs, ...(await findTabs(env, worker, canvas, found.anchors)) };
    } catch {
      // Tab row not readable; classification falls back to found.tabs / the OCR words below.
    }
  }

  let detected = null;
  if (anchorsOk) {
    try {
      detected = activeTab(canvas, tabs, found.anchors);
    } catch {
      detected = null;
    }
  }

  let kind = item.kind;
  if (kind === "auto") kind = detected ?? inferKind(found.words) ?? "header";
  item.detected = kind;

  if (kind === "header") {
    setStatus(item, anchorsOk ? "Header read" : "Header not found");
    return { item, kind, skills: null, summary: null, races: null };
  }

  const ctx = { anchors: found.anchors, tabs, closeY: found.closeY };
  const hasTab = Boolean(tabs.career ?? tabs.inspiration ?? tabs.skills);
  if ((kind === "skills" || kind === "career" || kind === "inspiration") && (!anchorsOk || !hasTab)) {
    const label = kind === "skills" ? "Skills" : kind === "career" ? "Career Info" : "Inspiration";
    setStatus(item, "Skipped (tab row not found)", true);
    return { item, kind, skills: null, summary: null, races: null, note: `${item.file.name}: the tab row or stat row was not found, so ${label} could not be read.` };
  }

  if (kind === "inspiration") {
    const r = await readInspirationTab(env, worker, canvas, { ...ctx, words: found.words });
    for (const cell of [...r.own, ...r.parents]) cell.shot = item.file.name;
    setStatus(item, `${r.own.length} own · ${r.parents.length} parent spark${r.parents.length === 1 ? "" : "s"}`);
    return { item, kind, inspiration: r, notes: r.notes };
  }

  if (kind === "skills") {
    const r = await readSkillsTab(env, worker, canvas, ctx);
    for (const skill of r.skills) skill.shot = item.file.name;
    setStatus(item, `${r.skills.length} skill${r.skills.length === 1 ? "" : "s"} read`);
    return { item, kind, skills: r.skills, summary: null, races: null, notes: r.notes };
  }

  // career
  const s = await readSummary(env, worker, canvas, ctx);
  s.summary.shot = item.file.name;
  s.summary.box = s.box;
  const r = await readRaceHistory(env, worker, canvas, ctx);
  for (const race of r.races) race.shot = item.file.name;
  const bits = [];
  if (s.summary.found.length) bits.push(`${s.summary.found.join(", ")}`);
  if (r.races.length) bits.push(`${r.races.length} race${r.races.length === 1 ? "" : "s"}`);
  setStatus(item, bits.length ? `Read ${bits.join(" · ")}` : "No Career Info text found");
  const notes = [];
  if (r.partial) notes.push(`${item.file.name}: ${r.partial} race card(s) were cut off by the list edge; capture that part again.`);
  return { item, kind, skills: null, summary: s.summary, races: r.races, notes };
}

// Turn raw Inspiration readings + dropped parent JSONs into the parsed.inspiration shape assemble()
// expects. Own sparks need the trainee's card_id (for the green unique); parents are identified by
// their own green spark and unioned across scrolling captures.
function resolveInspiration(inspReads, jsonItems, header, notes) {
  if (!inspReads.length && !jsonItems.length) return null;
  factorRes = factorRes ?? makeFactorResolver(tables);
  const warnings = [];

  let traineeCard = 0;
  if (header) {
    const hit = lookup(resolver.cards, `${header.title ?? ""} ${header.name ?? ""}`.trim());
    if (hit) traineeCard = hit.ids[0];
  }
  if (inspReads.length && !traineeCard) warnings.push("Inspiration read without a header: the trainee's green unique spark cannot be resolved.");

  const ownReadings = [];
  const unresolved = [];
  const seenCell = new Set();
  const addUnresolved = (cell, scope, cardId) => {
    const key = `${scope}|${cardId}|${cell.name.toLowerCase().replace(/[^a-z0-9]/g, "")}|${cell.stars}|${cell.kind}`;
    if (seenCell.has(key)) return;
    seenCell.add(key);
    unresolved.push({ cell, scope, cardId });
  };
  for (const r of inspReads) {
    const ids = [];
    for (const cell of r.own) {
      const res = resolveFactor(factorRes, cell, traineeCard, warnings);
      if (res) ids.push(res.factor_id);
      else addUnresolved(cell, "own", traineeCard);
    }
    ownReadings.push(ids);
  }
  const ownFactorIds = mergeFactorIds(ownReadings);

  const captures = inspReads.map((r) => ({ cells: r.parents, legacyY: r.legacyY, sy: r.geometry.sy, k: r.geometry.k }));
  const { parents } = readParentFactors(factorRes, captures, warnings);
  for (const p of parents) {
    for (const cell of p.unresolved ?? []) addUnresolved(cell, "parent", p.cardId);
    delete p.unresolved;
  }

  // A dropped JSON fills the slot its card occupies on screen (green-confirmed); otherwise drop order.
  const dropped = jsonItems.map((it) => ({ entry: it.json, position_id: 0 }));
  const taken = new Set();
  for (const d of dropped) {
    const ocr = parents.find((p) => p.cardId === d.entry.card_id);
    if (ocr?.positionId && !taken.has(ocr.positionId)) { d.position_id = ocr.positionId; taken.add(ocr.positionId); }
  }
  for (const d of dropped) {
    if (d.position_id) continue;
    const slot = [10, 20].find((s) => !taken.has(s));
    if (slot == null) { warnings.push(`Parent JSON (card ${d.entry.card_id}) has no free slot; only two parents are supported.`); continue; }
    d.position_id = slot;
    taken.add(slot);
  }

  notes.push(...warnings);
  return { ownFactorIds, parents, dropped: dropped.filter((d) => d.position_id), unresolved };
}

async function run() {
  if (running) return;
  const active = items.filter((i) => i.kind !== "ignore" && i.kind !== "parent-json");
  const jsonItems = items.filter((i) => i.kind === "parent-json");
  if (!active.length) return;

  running = true;
  for (const item of items) {
    if (item.selectEl) item.selectEl.disabled = true;
    if (item.removeEl) item.removeEl.disabled = true;
    if (item.kind !== "ignore" && item.kind !== "parent-json") setStatus(item, "Waiting…");
  }
  updateRunState();
  clearLog();
  warningsEl.hidden = true;
  clearReviews();
  copyButton.disabled = true;
  downloadButton.disabled = true;
  resetButton.disabled = true;
  lastVeteran = null;
  lastParsed = null;
  lastNotes = [];
  ocrParsed = null;
  ocrNotes = [];
  showReadablePlaceholder("Reading screenshots…");
  setView("readable");

  try {
    if (!tables) {
      log("Loading data tables…");
      tables = await loadTables("./data/");
      resolver = tables._resolver ?? (tables._resolver = makeResolver(tables));
      ensureDatalists();
    }
    await ensureWorker();

    const skillsReads = [];
    const summaries = [];
    const raceReads = [];
    const inspReads = [];
    const notes = [];
    const state = { header: null, headerWarnings: [] };

    for (let i = 0; i < active.length; i++) {
      const item = active[i];
      setStatus(item, "Reading…");
      log(`[${i + 1}/${active.length}] ${item.file.name}`);
      try {
        const r = await readItem(item, state);
        if (r.skills?.length) skillsReads.push(r.skills);
        if (r.summary) summaries.push(r.summary);
        if (r.races?.length) raceReads.push(r.races);
        if (r.inspiration) inspReads.push(r.inspiration);
        if (r.note) notes.push(r.note);
        if (r.notes) notes.push(...r.notes);
        if (item.kind === "auto" && item.detected) log(`  detected as ${item.detected}`);
      } catch (err) {
        console.error(err);
        setStatus(item, `Failed: ${err.message}`, true);
        notes.push(`${item.file.name}: ${err.message}`);
        log(`  error: ${err.message}`, "error");
      }
    }

    const header = state.header;
    const inspiration = resolveInspiration(inspReads, jsonItems, header, notes);

    log("Assembling the umadump-shaped entry…");
    const parsed = {
      header,
      skills: skillsReads.length ? mergeSkills(skillsReads) : null,
      summary: summaries.length ? mergeSummaries(summaries) : null,
      races: raceReads.length ? mergeRaces(raceReads) : null,
      inspiration,
    };
    const result = assemble(parsed, tables);

    jsonEl.innerHTML = "";
    lastParsed = parsed;
    lastNotes = [...notes, ...state.headerWarnings];
    ocrParsed = JSON.parse(JSON.stringify(parsed));
    ocrNotes = [...lastNotes];
    showJson(result.veteran);
    buildReadable(parsed, result.veteran);
    showWarnings([...result.warnings, ...lastNotes]);
    if (renderReviews(result)) openReviewModal();
    resetButton.disabled = false;
    setView("readable");
    setEngine("ready", "OCR ready");
    log(`Done: ${result.warnings.length} assembler warning(s).`);
  } catch (err) {
    console.error(err);
    setEngine("error", "OCR failed");
    log(`Failed to run: ${err.message}`, "error");
    showReadablePlaceholder("Could not read the screenshots. The error is shown in the JSON view.");
    setView("json");
    jsonEl.textContent = `Failed to run:\n${err.stack || err.message}`;
  } finally {
    running = false;
    for (const item of items) {
      if (item.selectEl) item.selectEl.disabled = false;
      if (item.removeEl) item.removeEl.disabled = false;
    }
    updateRunState();
  }
}

// ---------------------------------------------------------------- actions

function filenameFor(v) {
  const card = v?.card_id ? `card${v.card_id}` : "veteran";
  const rating = v?.rank_score ? `_${v.rank_score}` : "";
  return `${card}${rating}_trained_chara.json`;
}

async function copyJson() {
  if (applyTimer) applyEdits();
  if (!lastVeteran) return;
  const text = JSON.stringify(lastVeteran, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = "Copied";
    setTimeout(() => { copyButton.textContent = "Copy JSON"; }, 1200);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    copyButton.textContent = "Copied";
    setTimeout(() => { copyButton.textContent = "Copy JSON"; }, 1200);
  }
}

function downloadJson() {
  if (applyTimer) applyEdits();
  if (!lastVeteran) return;
  const blob = new Blob([JSON.stringify(lastVeteran, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFor(lastVeteran);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clearAll() {
  if (running) return;
  clearTimeout(applyTimer);
  applyTimer = null;
  for (const item of items) URL.revokeObjectURL(item.url);
  items.length = 0;
  renderFiles();
  updateRunState();
  lastVeteran = null;
  lastParsed = null;
  lastNotes = [];
  ocrParsed = null;
  ocrNotes = [];
  copyButton.disabled = true;
  downloadButton.disabled = true;
  resetButton.disabled = true;
  warningsEl.hidden = true;
  clearReviews();
  clearLog();
  showReadablePlaceholder("Nothing read yet. Add screenshots and press “Read screenshots”.");
  jsonEl.textContent = "Nothing read yet. Add screenshots and press “Read screenshots”.";
  setView("readable");
}

// ---------------------------------------------------------------- wiring

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

for (const event of ["dragenter", "dragover"]) {
  dropzone.addEventListener(event, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
}
for (const event of ["dragleave", "drop"]) {
  dropzone.addEventListener(event, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
}
dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});
// Dropping anywhere else should not navigate away from the app.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

reviewOpen.addEventListener("click", openReviewModal);
reviewClose.addEventListener("click", closeReviewModal);
// Clicking the backdrop (the dialog element itself) dismisses the window; Esc works natively.
reviewModal.addEventListener("click", (e) => { if (e.target === reviewModal) closeReviewModal(); });

runButton.addEventListener("click", run);
clearButton.addEventListener("click", clearAll);
copyButton.addEventListener("click", copyJson);
downloadButton.addEventListener("click", downloadJson);
resetButton.addEventListener("click", resetEdits);
viewReadable.addEventListener("click", () => setView("readable"));
viewJson.addEventListener("click", () => {
  if (applyTimer) applyEdits();
  setView("json");
});
for (const tab of [viewReadable, viewJson]) {
  tab.addEventListener("keydown", (e) => {
    const order = [viewReadable, viewJson];
    const i = order.indexOf(tab);
    let next = null;
    if (e.key === "ArrowRight") next = order[(i + 1) % order.length];
    else if (e.key === "ArrowLeft") next = order[(i + order.length - 1) % order.length];
    else if (e.key === "Home") next = order[0];
    else if (e.key === "End") next = order[order.length - 1];
    if (!next) return;
    e.preventDefault();
    if (next === viewJson && applyTimer) applyEdits();
    setView(next === viewJson ? "json" : "readable");
    next.focus();
  });
}

readableEl.addEventListener("input", () => {
  updateHints();
  scheduleApply();
});
readableEl.addEventListener("change", () => {
  updateHints();
  scheduleApply();
});
readableEl.addEventListener("click", (e) => {
  if (e.target.closest(".add-skill")) return addSkillRow();
  if (e.target.closest(".add-race")) return addRaceRow();
  if (e.target.closest(".add-spark")) return addSparkRow();
  if (e.target.closest(".add-parent-factor")) {
    const block = e.target.closest(".parent-block");
    const list = block?.querySelector(".parent-factors");
    if (!list) return;
    const row = makeFactorRow(null, "insp-factor-row");
    list.appendChild(row);
    updateCounts();
    row.querySelector(".factor-name").focus();
    return scheduleApply();
  }
  const skill = e.target.closest(".remove-skill");
  if (skill) {
    skill.closest(".skill-row").remove();
    updateCounts();
    return scheduleApply();
  }
  const race = e.target.closest(".remove-race");
  if (race) {
    race.closest(".race-row").remove();
    updateCounts();
    return scheduleApply();
  }
  const factor = e.target.closest(".remove-factor");
  if (factor) {
    factor.closest(".read-row").remove();
    updateCounts();
    return scheduleApply();
  }
});

window.addEventListener("pagehide", () => { if (worker) worker.terminate(); });

setView("readable");
updateRunState();
