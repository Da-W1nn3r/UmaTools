/* Umamusume DB Wiki — client-side port of the Python backend.
 * Runs entirely in the browser against a user-supplied master.mdb via sql.js.
 * The file is never uploaded anywhere; it lives only in this tab's memory.
 * Constants (REGISTRY, PURPOSE, decoders…) are auto-generated in data.js.
 */
(function (root) {
"use strict";

let SQL = null, db = null;
let raceCtxCache = null, catalogCache = null, tablesCache = null;

/* ---------------- sql helpers ---------------- */
function q(sql) {
  const res = db.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
}
function one(sql) { return q(sql)[0] || null; }
function idList(ids) {
  return [...new Set((ids || []).filter((x) => x != null && x !== "").map(Number).filter((x) => Number.isFinite(x) && x !== 0))];
}
function likePat(s) { return "'%" + String(s).replace(/'/g, "''") + "%'"; }
function texts(category, indices) {
  const ids = [...new Set((indices || []).filter((x) => x != null).map(Number))];
  if (!category || !ids.length) return {};
  const rows = q(`SELECT "index", text FROM text_data WHERE category = ${Number(category)} AND "index" IN (${ids.join(",")})`);
  return Object.fromEntries(rows.map((r) => [r.index, r.text]));
}
const g6 = (x) => String(parseFloat(Number(x).toPrecision(6)));
const dictGet = (d, k, fallback) => (d != null && k != null && String(k) in d) ? d[String(k)] : fallback;

/* ---------------- init / load ---------------- */
async function init() {
  if (!SQL) SQL = await root.initSqlJs({ locateFile: (f) => "vendor/" + f });
}
function load(bytes) {
  const next = new SQL.Database(bytes);
  const check = next.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('text_data','card_data','skill_data')");
  const found = check.length ? check[0].values.length : 0;
  if (found < 3) { next.close(); throw new Error("This file doesn't look like an Umamusume master.mdb (missing core tables)."); }
  if (db) db.close();
  db = next;
  raceCtxCache = catalogCache = tablesCache = null;
}
function loaded() { return !!db; }
function unload() { if (db) db.close(); db = null; raceCtxCache = catalogCache = tablesCache = null; }

/* ---------------- decoders ---------------- */
function humanizeCondition(cond) {
  if (!cond) return "";
  const groups = [];
  for (const group of String(cond).split("@")) {
    const clauses = [];
    for (const rawTok of group.split("&")) {
      const token = rawTok.trim();
      const m = token.match(/^([a-z_0-9]+)(==|!=|>=|<=|>|<)(-?\d+)/);
      if (!m) { if (token) clauses.push(token); continue; }
      const key = m[1], op = m[2], val = parseInt(m[3], 10);
      const ct = CONDITION_TOKENS[key] || [key, null];
      const label = ct[0], values = ct[1];
      const opstr = OPS[op] || op;
      const yesOnly = values && Object.keys(values).length === 1 && values["1"] === "yes";
      if (key === "always" && val === 1) clauses.push("Always");
      else if (key === "corner") {
        const onCorner = (op === "==" && val !== 0) || (op === "!=" && val === 0);
        clauses.push(onCorner ? "On a corner" : "On a straight");
      } else if (values && (op === "==" || op === "!=") && String(val) in values) {
        const txt = values[String(val)];
        if (yesOnly && op === "==") clauses.push(label);
        else if (yesOnly && op === "!=") clauses.push(`Not: ${label}`);
        else clauses.push(op === "==" ? `${label}: ${txt}` : `${label}: not ${txt}`);
      } else if (op === "==" && !values && (key.endsWith("is_overtake") || key.endsWith("blocked_front"))) {
        clauses.push(label);
      } else clauses.push(`${label} ${opstr} ${val}`);
    }
    groups.push(clauses.join(" AND "));
  }
  return groups.join("  — OR —  ");
}

function describeAbilities(row) {
  const out = [];
  for (const block of [1, 2]) {
    const cond = row[`condition_${block}`] || "";
    for (const n of [1, 2, 3]) {
      const atype = row[`ability_type_${block}_${n}`] || 0;
      if (!atype) continue;
      const raw = row[`float_ability_value_${block}_${n}`] || 0;
      const label = dictGet(ABILITY_LABELS, atype, `Effect type ${atype}`);
      let value;
      if ([1, 2, 3, 4, 5].includes(atype)) value = `+${g6(raw / 10000)} ${label}`;
      else if (atype === 9) value = `Recover ${g6(raw / 100)}% HP`;
      else if (atype === 10) value = `Drain ${g6(raw / 10000)}% HP`;
      else if (atype === 22 || atype === 27) value = `Velocity +${g6(raw / 10000)} m/s`;
      else if (atype === 31) value = `Acceleration +${g6(raw / 10000)} m/s²`;
      else if (atype === 28) value = `Lane movement +${g6(raw / 10000)}`;
      else if (atype === 21) value = `Field of view +${g6(raw / 10000)}`;
      else value = `${label}: ${raw}`;
      const duration = row[`float_ability_time_${block}`];
      let dur = "";
      if (duration == null) dur = "";
      else if (duration === -1) dur = "whole race";
      else if (duration === 0) dur = "instant";
      else dur = `${g6(duration / 10000)}s`;
      out.push({ block, condition: cond, condition_text: humanizeCondition(cond), type: atype, label, value, raw_value: raw, duration: dur });
    }
  }
  return out;
}

const UNIQUE_COMPLEX_LABELS = {
  104: "Training Effectiveness (scales with fans gained)",
  105: "Initial stats (scales with card types in deck)",
  107: "Friendship Bonus (scales with how low Energy is)",
  108: "Training Effectiveness (scales with max Energy)",
  109: "Training Effectiveness (scales with total Friendship in deck)",
  110: "Training Effectiveness (scales with number of cards trained with)",
  111: "Training Effectiveness (scales with Training Level)",
  114: "Training Effectiveness (scales with how high Energy is)",
  115: "Initial Friendship Gauge for selected Support Cards",
};

function decodeUniqueSlot(u, slot) {
  const t = u[`type_${slot}`] || 0;
  if (!t) return [];
  const v = u[`value_${slot}`] || 0;
  const [s1, s2, s3, s4] = [1, 2, 3, 4].map((n) => u[`value_${slot}_${n}`] || 0);
  const eff = (et) => {
    const lu = dictGet(EFFECT_LABELS, et, [`Effect type ${et}`, ""]);
    return [lu[0], dictGet(UNIQUE_UNIT_OVERRIDES, et, lu[1])];
  };
  if (t <= 31) { const [label, unit] = eff(t); return [{ type: t, label, unit, value: v }]; }
  if (t === 101) {
    const out = [];
    for (const [et, val] of [[s1, s2], [s3, s4]]) {
      if (!et) continue;
      const [label, unit] = eff(et);
      out.push({ type: et, label, unit, value: val, condition: `Friendship Gauge ${v}+` });
    }
    return out;
  }
  if (t === 102) return [{ label: "Training Effectiveness on non-specialty training", value: s1, unit: "%", condition: `Friendship Gauge ${v}+` }];
  if (t === 103) return [{ label: `Training Effectiveness with ${v}+ different card types in deck`, value: s1, unit: "%" }];
  if (t === 106) return [{ label: `Friendship Bonus per friendship training with this card (up to ${v} stacks)`, value: s2, unit: "%" }];
  if (t === 112) return [{ label: "Chance to reduce training failure rate to 0%", value: v, unit: "%" }];
  if (t === 113) { const [label, unit] = eff(v); return [{ label: `${label} when friendship training occurs`, value: s1, unit }]; }
  return [{ label: UNIQUE_COMPLEX_LABELS[t] || `Effect type ${t}`, value: null, unit: "" }];
}

function decodeInstanceDate(date) {
  if (!date) return "—";
  const year = Math.floor(date / 100), halfMonth = date % 100;
  const month = Math.floor((halfMonth + 1) / 2);
  const half = halfMonth % 2 === 1 ? "Early" : "Late";
  return `Year ${year}, ${half} ${String(month).padStart(2, "0")}`;
}

function supportTypeLabel(row) {
  const kind = row.support_card_type;
  if (kind === 2) return "Friend";
  if (kind === 3) return "Group";
  return dictGet(SUPPORT_COMMANDS, row.command_id, "Unknown");
}
function aptitudes(row) {
  const L = (v) => dictGet(APTITUDE_LETTERS, v, "?");
  return {
    turf: L(row.proper_ground_turf), dirt: L(row.proper_ground_dirt),
    sprint: L(row.proper_distance_short), mile: L(row.proper_distance_mile),
    medium: L(row.proper_distance_middle), long: L(row.proper_distance_long),
    front: L(row.proper_running_style_nige), pace: L(row.proper_running_style_senko),
    late: L(row.proper_running_style_sashi), end: L(row.proper_running_style_oikomi),
  };
}

/* ---------------- shared briefs ---------------- */
function skillBriefs(ids) {
  ids = idList(ids);
  if (!ids.length) return [];
  const rows = q(`
    SELECT s.id, s.rarity, s.skill_category, s.grade_value, s.group_id,
           n.text AS name, d.text AS description
    FROM skill_data s
    LEFT JOIN text_data n ON n.category = ${CATS.CAT_SKILL_NAME} AND n."index" = s.id
    LEFT JOIN text_data d ON d.category = ${CATS.CAT_SKILL_DESC} AND d."index" = s.id
    WHERE s.id IN (${ids.join(",")}) ORDER BY s.id`);
  for (const r of rows) {
    r.category_label = dictGet(SKILL_CATEGORIES, r.skill_category, String(r.skill_category));
    r.is_unique = r.skill_category === 5;
    r.is_evolution = r.id >= 900000;
  }
  return rows;
}
function skillSetSkills(setId) {
  if (!setId) return [];
  const row = one(`SELECT * FROM skill_set WHERE id = ${Number(setId)}`);
  if (!row) return [];
  const pairs = [];
  for (let n = 1; n <= 20; n++) {
    const sid = row[`skill_id${n}`];
    if (sid) pairs.push([sid, row[`skill_level${n}`]]);
  }
  const briefs = Object.fromEntries(skillBriefs(pairs.map((p) => p[0])).map((b) => [b.id, b]));
  return pairs.filter(([sid]) => briefs[sid]).map(([sid, lv]) => ({ ...briefs[sid], level: lv }));
}
function cardBriefs(ids) {
  ids = idList(ids);
  if (!ids.length) return [];
  return q(`
    SELECT c.id, c.chara_id, c.default_rarity, c.running_style,
           t.text AS title, n.text AS chara_name
    FROM card_data c
    LEFT JOIN text_data t ON t.category = ${CATS.CAT_CARD_FULL} AND t."index" = c.id
    LEFT JOIN text_data n ON n.category = ${CATS.CAT_CHARA_NAME} AND n."index" = c.chara_id
    WHERE c.id IN (${ids.join(",")}) ORDER BY c.id`);
}
function supportBriefs(ids) {
  ids = idList(ids);
  if (!ids.length) return [];
  const rows = q(`
    SELECT s.id, s.chara_id, s.rarity, s.command_id, s.support_card_type,
           t.text AS title, n.text AS chara_name
    FROM support_card_data s
    LEFT JOIN text_data t ON t.category = ${CATS.CAT_SUPPORT_FULL} AND t."index" = s.id
    LEFT JOIN text_data n ON n.category = ${CATS.CAT_CHARA_NAME} AND n."index" = s.chara_id
    WHERE s.id IN (${ids.join(",")}) ORDER BY s.id`);
  for (const r of rows) r.type_label = supportTypeLabel(r);
  return rows;
}

/* ---------------- home / search ---------------- */
function stats() {
  const out = {};
  for (const [key, table] of [["characters", "chara_data"], ["trainees", "card_data"],
    ["support_cards", "support_card_data"], ["skills", "skill_data"], ["races", "race"], ["items", "item_data"]]) {
    out[key] = one(`SELECT COUNT(*) AS n FROM ${table}`).n;
  }
  return out;
}

function search(query, limit = 60) {
  const pat = likePat(query);
  const cats = Object.keys(SEARCH_CATEGORIES).join(",");
  const nameCats = Object.entries(SEARCH_CATEGORIES).filter(([, v]) => v[1] === "name").map(([c]) => c).join(",");
  const rows = q(`
    SELECT category, "index", text FROM text_data
    WHERE category IN (${cats}) AND text LIKE ${pat} COLLATE NOCASE
    ORDER BY CASE WHEN category IN (${nameCats}) THEN 0 ELSE 1 END
    LIMIT 2000`);
  const qLower = query.toLowerCase();
  const found = new Map();
  const instanceIds = new Set();
  for (const r of rows) {
    const [kind, field] = SEARCH_CATEGORIES[String(r.category)];
    const idx = r.index;
    if (kind === "race_instance") { instanceIds.add(idx); continue; }
    let score = field === "name" ? 2 : 1;
    if (r.text.toLowerCase().startsWith(qLower)) score += 2;
    if (qLower === r.text.toLowerCase()) score += 3;
    const key = `${kind}:${idx}`;
    if (!found.has(key) || score > found.get(key).score) {
      found.set(key, { kind, id: idx, matched: r.text, field, score });
    }
  }
  if (instanceIds.size) {
    for (const r of q(`SELECT id, race_id FROM race_instance WHERE id IN (${[...instanceIds].join(",")})`)) {
      const key = `race:${r.race_id}`;
      if (!found.has(key)) found.set(key, { kind: "race", id: r.race_id, matched: "", field: "name", score: 2 });
    }
  }
  const byKind = {};
  for (const res of found.values()) (byKind[res.kind] ||= []).push(res);
  for (const items of Object.values(byKind)) items.sort((a, b) => b.score - a.score);

  for (const [kind, items] of Object.entries(byKind)) {
    const ids = items.map((i) => i.id);
    if (kind === "trainee") {
      const briefs = Object.fromEntries(cardBriefs(ids).map((b) => [b.id, b]));
      for (const i of items) {
        const b = briefs[i.id];
        if (!b) { i.dead = true; continue; }
        i.name = b.title || `Card ${i.id}`; i.sub = b.chara_name;
      }
    } else if (kind === "character") {
      const names = texts(CATS.CAT_CHARA_NAME, ids);
      const exist = new Set(q(`SELECT id FROM chara_data WHERE id IN (${ids.join(",")})`).map((r) => r.id));
      for (const i of items) {
        if (!exist.has(i.id)) { i.dead = true; continue; }
        i.name = names[i.id] || `Character ${i.id}`;
      }
    } else if (kind === "support") {
      const briefs = Object.fromEntries(supportBriefs(ids).map((b) => [b.id, b]));
      for (const i of items) {
        const b = briefs[i.id];
        if (!b) { i.dead = true; continue; }
        i.name = b.title || `Support ${i.id}`; i.sub = b.type_label;
      }
    } else if (kind === "skill") {
      const briefs = Object.fromEntries(skillBriefs(ids).map((b) => [b.id, b]));
      for (const i of items) {
        const b = briefs[i.id];
        if (!b) { i.dead = true; continue; }
        i.name = b.name || `Skill ${i.id}`; i.sub = b.category_label;
      }
    } else if (kind === "race") {
      const names = q(`
        SELECT r.id, COALESCE(t.text, ti.text) AS name
        FROM race r
        LEFT JOIN text_data t ON t.category = ${CATS.CAT_RACE_BASE_NAME} AND t."index" = r.id
        LEFT JOIN race_instance ri ON ri.id = (SELECT MIN(id) FROM race_instance WHERE race_id = r.id)
        LEFT JOIN text_data ti ON ti.category = ${CATS.CAT_RACE_NAME_LONG} AND ti."index" = ri.id
        WHERE r.id IN (${ids.join(",")})`);
      const nm = Object.fromEntries(names.map((r) => [r.id, r.name]));
      for (const i of items) {
        if (!(i.id in nm)) { i.dead = true; continue; }
        i.name = nm[i.id] || `Race ${i.id}`;
      }
    } else if (kind === "item") {
      const names = texts(CATS.CAT_ITEM_NAME, ids);
      const exist = new Set(q(`SELECT id FROM item_data WHERE id IN (${ids.join(",")})`).map((r) => r.id));
      for (const i of items) {
        if (!(i.id in names) || !exist.has(i.id)) { i.dead = true; continue; }
        i.name = names[i.id];
      }
    }
  }
  const perKind = Math.max(1, Math.floor(limit / 3));
  const grouped = {};
  let total = 0;
  for (const kind of ["trainee", "character", "support", "skill", "race", "item"]) {
    const items = (byKind[kind] || []).filter((r) => !r.dead).slice(0, perKind);
    if (items.length) { grouped[kind] = items; total += items.length; }
  }
  const generic = searchGeneric(query, perKind);
  if (generic.length) { grouped.generic = generic; total += generic.length; }
  const npcs = searchNpcs(query, perKind);
  if (npcs.length) { grouped.npc = npcs; total += npcs.length; }
  const tt = searchTtBuilds(query, perKind);
  if (tt.length) { grouped.tt_build = tt; total += tt.length; }
  return { query, total, groups: grouped };
}

function searchGeneric(query, limit) {
  const catToKey = {};
  for (const [key, cfg] of Object.entries(REGISTRY)) {
    if (cfg.name_cat && !(cfg.name_cat in catToKey)) catToKey[cfg.name_cat] = key;
  }
  const cats = Object.keys(catToKey);
  if (!cats.length) return [];
  const rows = q(`
    SELECT category, "index", text FROM text_data
    WHERE category IN (${cats.join(",")}) AND text LIKE ${likePat(query)} COLLATE NOCASE
    LIMIT 800`);
  const qLower = query.toLowerCase();
  const found = new Map();
  for (const r of rows) {
    const key = catToKey[r.category];
    const cfg = REGISTRY[key];
    const rid = r.index;
    const score = 2 + (r.text.toLowerCase().startsWith(qLower) ? 2 : 0) + (r.text.toLowerCase() === qLower ? 3 : 0);
    const k = `${key}:${rid}`;
    if (!found.has(k) || score > found.get(k).score) {
      found.set(k, { kind: "generic", key, id: rid, name: r.text, sub: cfg.label, score });
    }
  }
  const results = [...found.values()].sort((a, b) => b.score - a.score);
  const byKey = {};
  for (const res of results) (byKey[res.key] ||= []).push(res);
  const out = [];
  for (const [key, items] of Object.entries(byKey)) {
    const cfg = REGISTRY[key];
    const idxCol = cfg.name_index_col || cfg.pk;
    const pk = cfg.pk;
    const ids = items.map((i) => Number(i.id)).join(",");
    if (idxCol !== pk) {
      const mapping = Object.fromEntries(q(`SELECT "${idxCol}" AS v, "${pk}" AS p FROM "${cfg.table}" WHERE "${idxCol}" IN (${ids})`).map((r) => [r.v, r.p]));
      for (const i of items) if (i.id in mapping) { i.id = mapping[i.id]; out.push(i); }
    } else {
      const exist = new Set(q(`SELECT "${idxCol}" AS v FROM "${cfg.table}" WHERE "${idxCol}" IN (${ids})`).map((r) => r.v));
      for (const i of items) if (exist.has(i.id)) out.push(i);
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/* ---------------- trainees ---------------- */
function listTrainees() {
  const rows = q(`
    SELECT c.id, c.chara_id, c.default_rarity, c.running_style,
           t.text AS title, n.text AS chara_name,
           crd.proper_ground_turf, crd.proper_ground_dirt,
           crd.proper_distance_short, crd.proper_distance_mile,
           crd.proper_distance_middle, crd.proper_distance_long,
           crd.proper_running_style_nige, crd.proper_running_style_senko,
           crd.proper_running_style_sashi, crd.proper_running_style_oikomi
    FROM card_data c
    LEFT JOIN text_data t ON t.category = ${CATS.CAT_CARD_FULL} AND t."index" = c.id
    LEFT JOIN text_data n ON n.category = ${CATS.CAT_CHARA_NAME} AND n."index" = c.chara_id
    LEFT JOIN card_rarity_data crd ON crd.card_id = c.id AND crd.rarity = c.default_rarity
    ORDER BY c.chara_id, c.id`);
  for (const r of rows) {
    r.aptitudes = r.proper_ground_turf ? aptitudes(r) : null;
    r.style_label = dictGet(RUNNING_STYLES, r.running_style, "?");
    for (const k of Object.keys(r)) if (k.startsWith("proper_")) delete r[k];
  }
  return rows;
}

function trainingEvents({ cardId = 0, cardCharaId = 0, supportCardId = 0, supportCharaId = 0 } = {}) {
  const clauses = [];
  for (const [col, val] of [["card_id", cardId], ["card_chara_id", cardCharaId],
    ["support_card_id", supportCardId], ["support_chara_id", supportCharaId]]) {
    if (val) clauses.push(`${col} = ${Number(val)}`);
  }
  if (!clauses.length) return [];
  const rows = q(`
    SELECT id, story_id, card_id, support_card_id, show_progress_1, show_progress_2
    FROM single_mode_story_data WHERE ${clauses.join(" OR ")} ORDER BY story_id`);
  const titles = texts(CATS.CAT_EVENT_TITLE, rows.map((r) => r.story_id));
  return rows.map((r) => ({
    id: r.id, story_id: r.story_id,
    title: titles[r.story_id] || `Event ${r.story_id}`,
    source: (r.card_id || r.support_card_id) ? "Card" : "Character",
    chain_step: r.show_progress_1, chain_total: r.show_progress_2,
  }));
}

function getTrainee(cardId) {
  cardId = Number(cardId);
  const card = one(`
    SELECT c.*, t.text AS title, tt.text AS title_only, n.text AS chara_name
    FROM card_data c
    LEFT JOIN text_data t ON t.category = ${CATS.CAT_CARD_FULL} AND t."index" = c.id
    LEFT JOIN text_data tt ON tt.category = ${CATS.CAT_CARD_TITLE} AND tt."index" = c.id
    LEFT JOIN text_data n ON n.category = ${CATS.CAT_CHARA_NAME} AND n."index" = c.chara_id
    WHERE c.id = ${cardId}`);
  if (!card) return null;
  const chara = one(`SELECT * FROM chara_data WHERE id = ${Number(card.chara_id)}`);
  const va = texts(CATS.CAT_CHARA_VA, [card.chara_id])[card.chara_id];

  const rarities = q(`SELECT * FROM card_rarity_data WHERE card_id = ${cardId} ORDER BY rarity`);
  const rarityOut = rarities.map((r) => ({
    rarity: r.rarity,
    stats: Object.fromEntries(["speed", "stamina", "pow", "guts", "wiz"].map((k) => [k, r[k]])),
    max_stats: Object.fromEntries(["speed", "stamina", "pow", "guts", "wiz"].map((k) => [k, r[`max_${k}`]])),
    aptitudes: aptitudes(r),
    innate_skills: skillSetSkills(r.skill_set),
  }));

  const learnable = q(`
    SELECT skill_id, need_rank FROM available_skill_set
    WHERE available_skill_set_id = ${Number(card.available_skill_set_id)} ORDER BY need_rank, skill_id`);
  const briefs = Object.fromEntries(skillBriefs(learnable.map((r) => r.skill_id)).map((b) => [b.id, b]));
  const learnableOut = learnable.filter((r) => briefs[r.skill_id]).map((r) => ({ ...briefs[r.skill_id], need_rank: r.need_rank }));

  const variants = cardBriefs(q(`SELECT id FROM card_data WHERE chara_id = ${Number(card.chara_id)}`).map((r) => r.id))
    .filter((v) => v.id !== cardId);
  const supports = supportBriefs(q(`SELECT id FROM support_card_data WHERE chara_id = ${Number(card.chara_id)}`).map((r) => r.id));

  return {
    id: card.id, title: card.title, title_only: card.title_only,
    chara_id: card.chara_id, chara_name: card.chara_name,
    voice_actor: va,
    default_rarity: card.default_rarity,
    limited: !!card.limited_chara,
    style_label: dictGet(RUNNING_STYLES, card.running_style, "?"),
    growth: { speed: card.talent_speed, stamina: card.talent_stamina, power: card.talent_pow, guts: card.talent_guts, wit: card.talent_wiz },
    birthday: (chara && chara.birth_month) ? `${chara.birth_month}/${chara.birth_day}` : null,
    height: chara ? chara.height : null,
    rarities: rarityOut,
    learnable_skills: learnableOut,
    events: trainingEvents({ cardId, cardCharaId: card.chara_id }),
    variants, support_cards: supports,
  };
}

/* ---------------- characters ---------------- */
function listCharacters() {
  return q(`
    SELECT ch.id, ch.birth_month, ch.birth_day, ch.height, ch.image_color_main,
           n.text AS name, va.text AS voice_actor, dm.text AS dorm,
           (SELECT COUNT(*) FROM card_data c WHERE c.chara_id = ch.id) AS trainee_count,
           (SELECT COUNT(*) FROM support_card_data s WHERE s.chara_id = ch.id) AS support_count
    FROM chara_data ch
    LEFT JOIN text_data n ON n.category = ${CATS.CAT_CHARA_NAME} AND n."index" = ch.id
    LEFT JOIN text_data va ON va.category = ${CATS.CAT_CHARA_VA} AND va."index" = ch.id
    LEFT JOIN text_data dm ON dm.category = ${CATS.CAT_CHARA_DORM} AND dm."index" = ch.id
    ORDER BY ch.id`);
}

function getCharacter(charaId) {
  charaId = Number(charaId);
  const ch = one(`SELECT * FROM chara_data WHERE id = ${charaId}`);
  if (!ch) return null;
  const names = texts(CATS.CAT_CHARA_NAME, [charaId]);
  const va = texts(CATS.CAT_CHARA_VA, [charaId])[charaId];
  const dorm = texts(CATS.CAT_CHARA_DORM, [charaId])[charaId];
  const cards = cardBriefs(q(`SELECT id FROM card_data WHERE chara_id = ${charaId} ORDER BY id`).map((r) => r.id));
  const supports = supportBriefs(q(`SELECT id FROM support_card_data WHERE chara_id = ${charaId} ORDER BY id`).map((r) => r.id));
  const storyRows = q(`SELECT id, episode_index, story_id FROM chara_story_data WHERE chara_id = ${charaId} ORDER BY episode_index`);
  const storyNames = texts(92, storyRows.map((r) => r.story_id));
  const stories = storyRows.map((r) => ({ id: r.id, episode_index: r.episode_index, name: storyNames[r.story_id] || `Episode ${r.episode_index}` }));
  const dressRows = q(`SELECT id FROM dress_data WHERE chara_id = ${charaId} ORDER BY id`);
  const dressNames = texts(14, dressRows.map((r) => r.id));
  const dresses = dressRows.map((r) => ({ id: r.id, name: dressNames[r.id] || `Costume ${r.id}` }));
  return {
    id: charaId, name: names[charaId] || `Character ${charaId}`,
    voice_actor: va, dorm,
    birthday: ch.birth_month ? `${ch.birth_month}/${ch.birth_day}` : null,
    height: ch.height, bust: ch.bust,
    image_color: ch.image_color_main ? `#${ch.image_color_main}` : null,
    start_date: ch.start_date,
    trainees: cards, support_cards: supports, stories, dresses,
  };
}

/* ---------------- support cards ---------------- */
function listSupportCards() {
  const rows = q(`
    SELECT s.id, s.chara_id, s.rarity, s.command_id, s.support_card_type,
           t.text AS title, n.text AS chara_name
    FROM support_card_data s
    LEFT JOIN text_data t ON t.category = ${CATS.CAT_SUPPORT_FULL} AND t."index" = s.id
    LEFT JOIN text_data n ON n.category = ${CATS.CAT_CHARA_NAME} AND n."index" = s.chara_id
    ORDER BY s.id`);
  for (const r of rows) {
    r.type_label = supportTypeLabel(r);
    r.rarity_label = dictGet(RARITY_LABELS, r.rarity, "?");
  }
  return rows;
}

function getSupportCard(supportId) {
  supportId = Number(supportId);
  const s = one(`
    SELECT s.*, t.text AS title, tt.text AS title_only, n.text AS chara_name
    FROM support_card_data s
    LEFT JOIN text_data t ON t.category = ${CATS.CAT_SUPPORT_FULL} AND t."index" = s.id
    LEFT JOIN text_data tt ON tt.category = ${CATS.CAT_SUPPORT_TITLE} AND tt."index" = s.id
    LEFT JOIN text_data n ON n.category = ${CATS.CAT_CHARA_NAME} AND n."index" = s.chara_id
    WHERE s.id = ${supportId}`);
  if (!s) return null;

  const effects = [];
  for (const e of q(`SELECT * FROM support_card_effect_table WHERE id = ${Number(s.effect_table_id)} ORDER BY type`)) {
    const lu = dictGet(EFFECT_LABELS, e.type, [`Effect type ${e.type}`, ""]);
    const steps = [];
    if (e.init >= 0) steps.push({ lv: 1, value: e.init });
    for (let lv = 5; lv <= 50; lv += 5) {
      const v = e[`limit_lv${lv}`];
      if (v != null && v >= 0 && (!steps.length || steps[steps.length - 1].value !== v)) steps.push({ lv, value: v });
    }
    effects.push({ type: e.type, label: lu[0], unit: lu[1], steps });
  }

  const unique = [];
  for (const u of q(`SELECT * FROM support_card_unique_effect WHERE id = ${Number(s.unique_effect_id)} ORDER BY lv`)) {
    const parts = decodeUniqueSlot(u, 0).concat(decodeUniqueSlot(u, 1));
    if (parts.length) unique.push({ lv: u.lv, effects: parts });
  }
  const uniqueDesc = texts(CATS.CAT_UNIQUE_DESC, [supportId])[supportId];

  let flatBonus = 0;
  for (const e of effects) if (e.type === 19 && e.steps.length) flatBonus = e.steps[e.steps.length - 1].value;
  let pct = 0, pctCond = null;
  for (const u of unique) for (const p of u.effects) {
    if (p.type === 19) { pct += p.value || 0; pctCond = p.condition || pctCond; }
  }
  let specialty = null;
  if (flatBonus || pct) {
    const num = (x) => { x = Math.round(x * 10) / 10; return Number.isInteger(x) ? x : x; };
    const total = (SPECIALTY_BASE + flatBonus) * (1 + pct / 100);
    specialty = {
      base: SPECIALTY_BASE, card_bonus: flatBonus, unique_percent: pct,
      total: num(total), above_base: num(total - SPECIALTY_BASE), condition: pctCond,
    };
  }

  const hintRows = q(`
    SELECT * FROM single_mode_hint_gain
    WHERE hint_id = ${Number(s.skill_set_id)} AND support_card_id = ${supportId}
    ORDER BY hint_group, priority DESC, id`);
  const skillHintRows = hintRows.filter((r) => r.hint_gain_type === 0);
  const briefs = Object.fromEntries(skillBriefs(skillHintRows.map((r) => r.hint_value_1)).map((b) => [b.id, b]));
  const hints = skillHintRows.filter((r) => briefs[r.hint_value_1])
    .map((r) => ({ ...briefs[r.hint_value_1], level: r.hint_value_2, hint_group: r.hint_group }));
  const statHints = hintRows.filter((r) => r.hint_gain_type === 1)
    .map((r) => ({ label: dictGet(STAT_HINT_LABELS, r.hint_value_1, `Stat ${r.hint_value_1}`), value: r.hint_value_2, hint_group: r.hint_group }));

  const events = trainingEvents({ supportCardId: supportId, supportCharaId: s.chara_id || 0 });

  let story = texts(CATS.CAT_SUPPORT_STORY, [supportId])[supportId];
  if (story) story = story.split("\\n").join("\n");

  const charaCards = s.chara_id
    ? cardBriefs(q(`SELECT id FROM card_data WHERE chara_id = ${Number(s.chara_id)}`).map((r) => r.id))
    : [];

  return {
    id: s.id, title: s.title, title_only: s.title_only,
    chara_id: s.chara_id || null, chara_name: s.chara_name,
    rarity: s.rarity, rarity_label: dictGet(RARITY_LABELS, s.rarity, "?"),
    type_label: supportTypeLabel(s),
    kind: dictGet(SUPPORT_KINDS, s.support_card_type, "?"),
    max_level: dictGet(SUPPORT_MAX_LV, s.rarity, 50),
    effects, unique_effects: unique,
    unique_effect_description: uniqueDesc,
    specialty,
    description: story,
    hint_skills: hints, hint_stats: statHints,
    events, trainees: charaCards,
  };
}

/* ---------------- skills ---------------- */
function listSkills() {
  const rows = q(`
    SELECT s.id, s.rarity, s.skill_category, s.grade_value, s.group_id,
           n.text AS name, d.text AS description
    FROM skill_data s
    LEFT JOIN text_data n ON n.category = ${CATS.CAT_SKILL_NAME} AND n."index" = s.id
    LEFT JOIN text_data d ON d.category = ${CATS.CAT_SKILL_DESC} AND d."index" = s.id
    ORDER BY s.id`);
  for (const r of rows) r.category_label = dictGet(SKILL_CATEGORIES, r.skill_category, String(r.skill_category));
  return rows;
}

function getSkill(skillId) {
  skillId = Number(skillId);
  const s = one(`
    SELECT s.*, n.text AS name, d.text AS description
    FROM skill_data s
    LEFT JOIN text_data n ON n.category = ${CATS.CAT_SKILL_NAME} AND n."index" = s.id
    LEFT JOIN text_data d ON d.category = ${CATS.CAT_SKILL_DESC} AND d."index" = s.id
    WHERE s.id = ${skillId}`);
  if (!s) return null;

  const orClause = Array.from({ length: 20 }, (_, i) => `ss.skill_id${i + 1} = ${skillId}`).join(" OR ");
  const innateRows = q(`
    SELECT crd.card_id, MAX(crd.rarity) AS rarity
    FROM card_rarity_data crd JOIN skill_set ss ON ss.id = crd.skill_set
    WHERE ${orClause} GROUP BY crd.card_id`);
  const innate = cardBriefs(innateRows.map((r) => r.card_id));

  const learnRows = q(`
    SELECT c.id AS card_id, a.need_rank FROM available_skill_set a
    JOIN card_data c ON c.available_skill_set_id = a.available_skill_set_id
    WHERE a.skill_id = ${skillId}`);
  const learnMap = Object.fromEntries(learnRows.map((r) => [r.card_id, r.need_rank]));
  const learnable = cardBriefs(Object.keys(learnMap));
  for (const c of learnable) c.need_rank = learnMap[c.id];

  const hintRows = q(`
    SELECT DISTINCT s.id FROM support_card_data s
    JOIN single_mode_hint_gain h ON h.hint_id = s.skill_set_id
        AND h.support_card_id = s.id
    WHERE h.hint_gain_type = 0 AND h.hint_value_1 = ${skillId}`);
  const hints = supportBriefs(hintRows.map((r) => r.id));

  const family = s.group_id
    ? skillBriefs(q(`SELECT id FROM skill_data WHERE group_id = ${Number(s.group_id)} ORDER BY id`).map((r) => r.id)).filter((b) => b.id !== skillId)
    : [];

  return {
    id: s.id, name: s.name, description: s.description,
    rarity: s.rarity, skill_category: s.skill_category,
    category_label: dictGet(SKILL_CATEGORIES, s.skill_category, String(s.skill_category)),
    is_unique: s.skill_category === 5,
    is_evolution: s.id >= 900000,
    grade_value: s.grade_value,
    icon_id: s.icon_id,
    activate_lot: s.activate_lot,
    conditions: [1, 2].filter((b) => s[`condition_${b}`]).map((b) => ({ raw: s[`condition_${b}`], text: humanizeCondition(s[`condition_${b}`]) })),
    abilities: describeAbilities(s),
    innate_trainees: innate,
    learnable_trainees: learnable,
    hint_supports: hints,
    family,
  };
}

/* ---------------- races ---------------- */
function raceContext() {
  if (raceCtxCache) return raceCtxCache;
  const ctx = {};
  const entry = (raceId) => ctx[raceId] ||= { purposes: new Set(), need_fan: null, fan_set_id: null };
  const add = (raceId, tag) => entry(raceId).purposes.add(tag);

  const scenarioNames = texts(237, [1, 2, 3, 4, 5]);

  for (const r of q(`
    SELECT ri.race_id, MIN(p.need_fan_count) AS need_fan, p.fan_set_id
    FROM single_mode_program p
    JOIN race_instance ri ON ri.id = p.race_instance_id
    GROUP BY ri.race_id`)) {
    const e = entry(r.race_id);
    e.need_fan = r.need_fan; e.fan_set_id = r.fan_set_id;
    e.purposes.add("Career Race");
  }
  for (const r of q(`
    SELECT DISTINCT ri.race_id, sg.scenario_id
    FROM single_mode_route_race rr
    JOIN single_mode_program p ON p.id = rr.condition_id
    JOIN race_instance ri ON ri.id = p.race_instance_id
    JOIN single_mode_scenario_group sg ON sg.group_id = rr.scenario_group_id
    WHERE rr.condition_type = 1 AND rr.race_type = 0`)) {
    add(r.race_id, `Objective: ${scenarioNames[r.scenario_id] || `Scenario ${r.scenario_id}`}`);
  }
  const roundName = { 1: "URA Finale (Qualifiers)", 2: "URA Finale (Semifinal)", 3: "URA Finale (Final)" };
  for (const r of q(`
    SELECT DISTINCT ri.race_id, rr.race_type
    FROM single_mode_route_race rr
    JOIN single_mode_program p ON p.id = rr.condition_id
    JOIN race_instance ri ON ri.id = p.race_instance_id
    WHERE rr.condition_type = 1 AND rr.race_type IN (1, 2, 3)`)) {
    add(r.race_id, roundName[r.race_type] || "URA Finale");
  }
  for (const [tbl, tag] of [["legend_race", "Legend Race"], ["daily_race", "Daily Race"], ["daily_legend_race", "Daily Legend Race"]]) {
    for (const r of q(`SELECT DISTINCT ri.race_id FROM ${tbl} x JOIN race_instance ri ON ri.id = x.race_instance_id`)) add(r.race_id, tag);
  }
  for (const e of Object.values(ctx)) e.purposes = [...e.purposes].sort();
  raceCtxCache = ctx;
  return ctx;
}

function listRaces() {
  const rows = q(`
    SELECT r.id, r.grade, r.entry_num,
           rc.distance, rc.ground, rc.race_track_id,
           tr.text AS track,
           COALESCE(t.text, ti.text) AS name
    FROM race r
    LEFT JOIN race_course_set rc ON rc.id = r.course_set
    LEFT JOIN text_data tr ON tr.category = ${CATS.CAT_TRACK_SHORT} AND tr."index" = rc.race_track_id
    LEFT JOIN text_data t ON t.category = ${CATS.CAT_RACE_BASE_NAME} AND t."index" = r.id
    LEFT JOIN race_instance ri ON ri.id = (SELECT MIN(id) FROM race_instance WHERE race_id = r.id)
    LEFT JOIN text_data ti ON ti.category = ${CATS.CAT_RACE_NAME_LONG} AND ti."index" = ri.id
    ORDER BY r.id`);
  const ctx = raceContext();
  for (const r of rows) {
    r.grade_label = dictGet(RACE_GRADES, r.grade, String(r.grade));
    r.ground_label = dictGet({ 1: "Turf", 2: "Dirt" }, r.ground, "?");
    r.name = r.name || `Race ${r.id}`;
    const c = ctx[r.id] || {};
    r.purposes = c.purposes || [];
    r.need_fan = c.need_fan != null ? c.need_fan : null;
  }
  return rows;
}

function getRace(raceId) {
  raceId = Number(raceId);
  const r = one(`
    SELECT r.*, rc.distance, rc.ground, rc.turn, rc.race_track_id,
           tr.text AS track, trf.text AS track_full, t.text AS name
    FROM race r
    LEFT JOIN race_course_set rc ON rc.id = r.course_set
    LEFT JOIN text_data tr ON tr.category = ${CATS.CAT_TRACK_SHORT} AND tr."index" = rc.race_track_id
    LEFT JOIN text_data trf ON trf.category = ${CATS.CAT_TRACK_FULL} AND trf."index" = rc.race_track_id
    LEFT JOIN text_data t ON t.category = ${CATS.CAT_RACE_BASE_NAME} AND t."index" = r.id
    WHERE r.id = ${raceId}`);
  if (!r) return null;
  const instances = q(`
    SELECT ri.id, ri.date, ri.race_number, t.text AS name
    FROM race_instance ri
    LEFT JOIN text_data t ON t.category = ${CATS.CAT_RACE_NAME_LONG} AND t."index" = ri.id
    WHERE ri.race_id = ${raceId} ORDER BY ri.id`);
  for (const i of instances) i.date_text = decodeInstanceDate(i.date);
  const name = r.name || (instances[0] && instances[0].name) || `Race ${raceId}`;

  const ctx = raceContext()[raceId] || {};
  const purposes = ctx.purposes || [];
  const needFan = ctx.need_fan != null ? ctx.need_fan : null;

  let fanRewards = [];
  if (ctx.fan_set_id) {
    fanRewards = q(`SELECT [order] AS place, fan_count FROM single_mode_fan_count WHERE fan_set_id = ${Number(ctx.fan_set_id)} ORDER BY [order]`);
  }
  const trophies = q(`
    SELECT rt.trophy_id, rt.race_instance_id, t.text AS name
    FROM race_trophy rt
    LEFT JOIN text_data t ON t.category = 33 AND t."index" = rt.trophy_id
    WHERE rt.race_instance_id IN (SELECT id FROM race_instance WHERE race_id = ${raceId})
    ORDER BY rt.disp_order`);
  const legend = q(`
    SELECT l.id, l.difficulty, l.race_instance_id, l.season, l.weather, l.ground
    FROM legend_race l
    WHERE l.race_instance_id IN (SELECT id FROM race_instance WHERE race_id = ${raceId})`);
  const daily = q(`
    SELECT d.id, d.difficulty, d.race_instance_id, d.cost_num
    FROM daily_race d
    WHERE d.race_instance_id IN (SELECT id FROM race_instance WHERE race_id = ${raceId})`);

  return {
    id: raceId, name,
    grade: r.grade, grade_label: dictGet(RACE_GRADES, r.grade, String(r.grade)),
    track: r.track_full || r.track, race_track_id: r.race_track_id,
    distance: r.distance,
    ground_label: dictGet({ 1: "Turf", 2: "Dirt" }, r.ground, "?"),
    turn_label: dictGet({ 1: "Right-handed", 2: "Left-handed", 3: "Straight" }, r.turn, "?"),
    entry_num: r.entry_num,
    purposes, need_fan: needFan,
    fan_rewards: fanRewards, trophies, legend, daily, instances,
  };
}

/* ---------------- NPC racers ---------------- */
const NPC_SOURCES = {
  career: ["single_mode_npc", "Career"],
  legend: ["legend_race_npc", "Legend Race"],
  daily: ["daily_race_npc", "Daily Race"],
  team: ["team_building_race_npc", "Team Building"],
};

function npcNames(charaIds, mobIds, npcIds) {
  return [texts(CATS.CAT_CHARA_NAME, charaIds), texts(59, [...new Set([...mobIds, ...npcIds])])];
}
function npcDisplayName(row, charaNames, mobNames) {
  const cid = row.chara_id;
  if (cid && cid in charaNames) return [charaNames[cid], "character", cid];
  const nid = row.id;
  if (nid in mobNames) return [mobNames[nid], "npc", nid];
  const mid = row.mob_id;
  if (mid && mid in mobNames) return [mobNames[mid], "mob", mid];
  return [`NPC ${nid}`, "npc", nid];
}
function npcBestStyle(row) {
  const styles = { front: row.proper_running_style_nige, pace: row.proper_running_style_senko, late: row.proper_running_style_sashi, end: row.proper_running_style_oikomi };
  let best = "front";
  for (const k of Object.keys(styles)) if (styles[k] > styles[best]) best = k;
  return { front: "Front", pace: "Pace", late: "Late", end: "End" }[best];
}
const npcStats = (r) => ({ speed: r.speed, stamina: r.stamina, power: r.pow, guts: r.guts, wit: r.wiz });

function listNpcs() {
  const out = [];
  for (const [source, [table, label]] of Object.entries(NPC_SOURCES)) {
    const rows = q(`SELECT * FROM "${table}" ORDER BY id`);
    const [charaNames, mobNames] = npcNames(rows.map((r) => r.chara_id), rows.map((r) => r.mob_id), rows.map((r) => r.id));
    for (const r of rows) {
      const [name, nameKind] = npcDisplayName(r, charaNames, mobNames);
      out.push({
        uid: `${source}:${r.id}`, source, source_label: label,
        id: r.id, name, name_kind: nameKind,
        chara_id: r.chara_id in charaNames ? r.chara_id : null,
        chara_name: charaNames[r.chara_id] ?? null,
        mob_id: r.mob_id, mob_name: mobNames[r.mob_id] ?? null,
        stats: npcStats(r), aptitudes: aptitudes(r), style: npcBestStyle(r),
      });
    }
  }
  return out;
}

function getNpc(uid) {
  if (!uid.includes(":")) return null;
  const [source, sid] = uid.split(":");
  if (!NPC_SOURCES[source] || !/^\d+$/.test(sid)) return null;
  const [table, label] = NPC_SOURCES[source];
  const r = one(`SELECT * FROM "${table}" WHERE id = ${Number(sid)}`);
  if (!r) return null;
  const [charaNames, mobNames] = npcNames([r.chara_id], [r.mob_id], [r.id]);
  const [name, nameKind] = npcDisplayName(r, charaNames, mobNames);
  const skills = skillSetSkills(r.skill_set_id);
  return {
    uid, source, source_label: label, id: r.id,
    name, name_kind: nameKind,
    chara_id: r.chara_id in charaNames ? r.chara_id : null,
    chara_name: charaNames[r.chara_id] ?? null,
    mob_id: r.mob_id, mob_name: mobNames[r.mob_id] ?? null,
    race_dress_id: r.race_dress_id ?? null,
    npc_group_id: r.npc_group_id ?? null,
    race_instance_id: r.race_instance_id || null,
    stats: npcStats(r), aptitudes: aptitudes(r), style: npcBestStyle(r), skills,
  };
}

function searchNpcs(query, limit) {
  const rows = q(`SELECT "index", text FROM text_data WHERE category = 59 AND text LIKE ${likePat(query)} COLLATE NOCASE LIMIT 400`);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.index).join(",");
  const nameById = Object.fromEntries(rows.map((r) => [r.index, r.text]));
  const qLower = query.toLowerCase();
  const out = [];
  for (const [source, [table, label]] of Object.entries(NPC_SOURCES)) {
    const exist = q(`SELECT id FROM "${table}" WHERE id IN (${ids})`).map((r) => r.id);
    for (const nid of exist) {
      const txt = nameById[nid];
      const score = 2 + (txt.toLowerCase().startsWith(qLower) ? 2 : 0) + (txt.toLowerCase() === qLower ? 3 : 0);
      out.push({ kind: "npc", id: `${source}:${nid}`, name: txt, sub: `NPC · ${label}`, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/* ---------------- Team Trials NPC builds ---------------- */
const TT_LO = 200001, TT_HI = 200032;
const TT_STYLES = ["Front", "Front", "Pace", "Pace", "Late", "Late", "End", "End"];
const TT_GROUP_RACE = { 1: "Sprint", 2: "Mile / Dirt", 3: "Medium", 4: "Long" };
function ttBuildMeta(setId) {
  const pos = (setId - TT_LO) % 8;
  const group = Math.floor((setId - TT_LO) / 8) + 1;
  return { group, style: TT_STYLES[pos], race_type: TT_GROUP_RACE[group] };
}
function ttBuildRows(lo, hi) {
  const rows = q(`SELECT * FROM skill_set WHERE id BETWEEN ${Number(lo)} AND ${Number(hi)} ORDER BY id`);
  const pairs = {};
  for (const r of rows) {
    pairs[r.id] = [];
    for (let n = 1; n <= 20; n++) if (r[`skill_id${n}`]) pairs[r.id].push([r[`skill_id${n}`], r[`skill_level${n}`]]);
  }
  const briefs = Object.fromEntries(skillBriefs(Object.values(pairs).flat().map(([sid]) => sid)).map((b) => [b.id, b]));
  return rows.map((r) => {
    const skills = pairs[r.id].filter(([sid]) => briefs[sid]).map(([sid, lv]) => ({ ...briefs[sid], level: lv }));
    const meta = ttBuildMeta(r.id);
    const names = new Set(skills.map((s) => s.name));
    return {
      id: r.id, name: `${meta.style} Build ${r.id}`, ...meta,
      has_sympathy: names.has("Sympathy"), has_lone_wolf: names.has("Lone Wolf"), skills,
    };
  });
}
const listTtBuilds = () => ttBuildRows(TT_LO, TT_HI);
function getTtBuild(setId) {
  setId = Number(setId);
  if (!(TT_LO <= setId && setId <= TT_HI)) return null;
  return ttBuildRows(setId, setId)[0] || null;
}
function searchTtBuilds(query, limit) {
  const qs = query.toLowerCase().trim();
  const out = [];
  for (const b of listTtBuilds()) {
    let score = 0;
    if (["team trials", "team trial", "tt", "tt builds"].includes(qs)) score = 2;
    else if (qs === String(b.id)) score = 7;
    else if (qs === b.style.toLowerCase()) score = 3;
    else if (["sprint", "mile", "dirt", "medium", "long"].includes(qs) && b.race_type.toLowerCase().includes(qs)) score = 3;
    if (score) out.push({ kind: "tt_build", id: b.id, name: b.name, sub: `Team Trials · ${b.race_type}`, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/* ---------------- items ---------------- */
function listItems() {
  return q(`
    SELECT i.id, i.item_category, i.limit_num, i.sell_price,
           n.text AS name, d.text AS description
    FROM item_data i
    JOIN text_data n ON n.category = ${CATS.CAT_ITEM_NAME} AND n."index" = i.id
    LEFT JOIN text_data d ON d.category = ${CATS.CAT_ITEM_DESC} AND d."index" = i.id
    ORDER BY i.id`);
}
function getItem(itemId) {
  itemId = Number(itemId);
  const i = one(`
    SELECT i.*, n.text AS name, d.text AS description, h.text AS how_to_get
    FROM item_data i
    LEFT JOIN text_data n ON n.category = ${CATS.CAT_ITEM_NAME} AND n."index" = i.id
    LEFT JOIN text_data d ON d.category = ${CATS.CAT_ITEM_DESC} AND d."index" = i.id
    LEFT JOIN text_data h ON h.category = ${CATS.CAT_ITEM_HOW} AND h."index" = i.id
    WHERE i.id = ${itemId}`);
  if (!i) return null;
  return {
    id: i.id, name: i.name || `Item ${itemId}`,
    description: i.description, how_to_get: i.how_to_get,
    category: i.item_category, limit_num: i.limit_num, sell_price: i.sell_price,
  };
}

/* ---------------- generic browser ---------------- */
function namesFor(cfg, indices) {
  if (cfg.name_cats) {
    const out = {};
    for (const c of cfg.name_cats) {
      for (const [k, v] of Object.entries(texts(c, indices))) if (!(k in out)) out[k] = v;
    }
    return out;
  }
  return texts(cfg.name_cat, indices);
}
function deriveName(cfg, row) {
  if (cfg.name_derive === "training") {
    const cmd = row.base_command_id || row.command_id;
    const label = dictGet(SUPPORT_COMMANDS, cmd, `Command ${row.command_id}`);
    return `${label} Training Lv${row.command_level}`;
  }
  return null;
}
const publicCfg = (cfg) => Object.fromEntries(["label", "icon", "table", "pk", "blurb", "list_cols"].filter((k) => k in cfg).map((k) => [k, cfg[k]]));

function genericList(key) {
  const cfg = REGISTRY[key];
  if (!cfg) return null;
  const rows = q(`SELECT * FROM "${cfg.table}" ORDER BY "${cfg.pk}"`);
  const idxCol = cfg.name_index_col || cfg.pk;
  const names = namesFor(cfg, rows.map((r) => r[idxCol]));
  const descs = cfg.desc_cat ? texts(cfg.desc_cat, rows.map((r) => r[idxCol])) : {};
  for (const r of rows) {
    r._name = deriveName(cfg, r) || names[r[idxCol]] || `${cfg.label} ${r[cfg.pk]}`;
    if (cfg.desc_cat) r._desc = descs[r[idxCol]];
  }
  const filters = [];
  for (const f of cfg.filters || []) {
    const col = f.col;
    const dec = (cfg.decode || {})[col];
    const seen = new Map();
    for (const r of rows) {
      const v = r[col];
      let disp = (dec && Number.isInteger(v)) ? dictGet(dec, v, v) : v;
      disp = disp == null ? "—" : String(disp);
      r["_f_" + col] = disp;
      if (!seen.has(v)) seen.set(v, disp);
    }
    const keys = [...seen.keys()].sort((a, b) => {
      if (a == null) return 1; if (b == null) return -1;
      return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
    });
    const options = [...new Set(keys.map((k) => seen.get(k)))];
    filters.push({ key: "_f_" + col, label: f.label, options });
  }
  return { key, config: publicCfg(cfg), rows, filters };
}

function genericDetail(key, rid) {
  const cfg = REGISTRY[key];
  if (!cfg) return null;
  const row = one(`SELECT * FROM "${cfg.table}" WHERE "${cfg.pk}" = ${Number(rid)}`);
  if (!row) return null;
  const idxCol = cfg.name_index_col || cfg.pk;
  const names = namesFor(cfg, [row[idxCol]]);
  const descs = cfg.desc_cat ? texts(cfg.desc_cat, [row[idxCol]]) : {};
  const linkCat = { character: 6, item: 23, mob: 59, skill: 47, trainee: 4, support: 75, race: 36 };
  const cfgLinks = cfg.links || [];
  const linkCols = Object.fromEntries(cfgLinks.map((lk) => [lk.col, lk]));
  const linkNames = {};
  for (const [kind, cat] of Object.entries(linkCat)) {
    const ids = cfgLinks.filter((lk) => lk.kind === kind && row[lk.col]).map((lk) => row[lk.col]);
    if (ids.length) Object.assign(linkNames, texts(cat, ids));
  }
  const links = [];
  for (const lk of cfgLinks) {
    const v = row[lk.col];
    if (v) links.push({ kind: lk.kind, id: v, label: lk.label, name: linkNames[v] || `#${v}` });
  }
  const fields = [];
  for (const [col, val] of Object.entries(row)) {
    const decoder = (cfg.decode || {})[col];
    const display = (decoder && Number.isInteger(val)) ? dictGet(decoder, val, val) : val;
    const field = { column: col, value: val, display };
    if (col in linkCols && val) {
      const lk = linkCols[col];
      field.link = { kind: lk.kind, id: val, name: linkNames[val] || `#${val}` };
    }
    fields.push(field);
  }
  return {
    key, config: publicCfg(cfg), id: rid,
    name: deriveName(cfg, row) || names[row[idxCol]] || `${cfg.label} ${rid}`,
    description: descs[row[idxCol]],
    fields, links,
  };
}

const registryIndex = () => Object.entries(REGISTRY).map(([k, v]) => ({ key: k, label: v.label, icon: v.icon, table: v.table, blurb: v.blurb || "" }));

/* ---------------- catalog ---------------- */
const RICH_SET = new Set(RICH_TABLES);
const GENERIC_TABLES = new Set(Object.values(REGISTRY).map((c) => c.table));
function classify(t) { return RICH_SET.has(t) ? "rich" : GENERIC_TABLES.has(t) ? "generic" : "raw"; }
function domainOf(t) {
  if (t in PURPOSE) return PURPOSE[t][0];
  for (const [prefix, dom] of PREFIX_DOMAIN) if (t.startsWith(prefix)) return dom;
  return "Uncategorised";
}
function allTables() {
  if (!tablesCache) tablesCache = q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name).filter((t) => t !== "sqlite_stat1");
  return tablesCache;
}
function catalog() {
  if (catalogCache) return catalogCache;
  const entries = [];
  for (const t of allTables()) {
    const n = one(`SELECT COUNT(*) AS n FROM "${t}"`).n;
    const cols = q(`PRAGMA table_info("${t}")`).length;
    const status = classify(t);
    const purpose = t in PURPOSE ? PURPOSE[t][1] : "";
    const note = status === "raw" && !purpose ? "Structured data browsable raw; specific purpose not decoded." : "";
    entries.push({ table: t, rows: n, cols, domain: domainOf(t), status, purpose, note });
  }
  const groups = {};
  for (const e of entries) (groups[e.domain] ||= []).push(e);
  const ordered = [];
  for (const dom of DOMAIN_ORDER) if (dom in groups) { ordered.push({ domain: dom, tables: groups[dom] }); delete groups[dom]; }
  for (const [dom, tabs] of Object.entries(groups)) ordered.push({ domain: dom, tables: tabs });
  const counts = { rich: 0, generic: 0, raw: 0 };
  for (const e of entries) counts[e.status] += 1;
  catalogCache = { total: entries.length, counts, groups: ordered, generic_keys: Object.keys(REGISTRY) };
  return catalogCache;
}

/* ---------------- raw tables ---------------- */
function tableSchema(name) {
  if (!allTables().includes(name)) throw new Error(`Unknown table: ${name}`);
  return q(`PRAGMA table_info("${name}")`).map((r) => ({ name: r.name, type: r.type, is_pk: !!r.pk }));
}
function tableRows(name, { limit = 50, offset = 0, sortBy = null, order = "ASC" } = {}) {
  const schema = tableSchema(name);
  limit = Math.min(100, Math.max(1, Number(limit) || 50));
  offset = Math.max(0, Number(offset) || 0);
  let sql = `SELECT * FROM "${name}"`;
  if (sortBy) {
    if (!schema.some((c) => c.name === sortBy)) throw new Error(`Unknown column: ${sortBy}`);
    order = String(order).toUpperCase() === "DESC" ? "DESC" : "ASC";
    sql += ` ORDER BY "${sortBy}" ${order}`;
  }
  sql += ` LIMIT ${limit} OFFSET ${offset}`;
  return q(sql);
}

/* ---------------- API dispatcher (mirrors the old REST paths) ---------------- */
async function api(path) {
  if (!db) throw new Error("No master.mdb loaded");
  const [p, qs] = path.split("?");
  const params = new URLSearchParams(qs || "");
  const seg = p.split("/").filter(Boolean).map(decodeURIComponent);
  const notFound = (r, what) => { if (r == null) throw new Error(`${what} not found`); return r; };

  if (seg[0] === "tables") {
    if (seg.length === 1) return allTables();
    if (seg[2] === "schema") return tableSchema(seg[1]);
    if (seg[2] === "rows") return tableRows(seg[1], {
      limit: params.get("limit"), offset: params.get("offset"),
      sortBy: params.get("sort_by"), order: params.get("order"),
    });
  } else if (seg[0] === "wiki") {
    const k = seg[1];
    if (k === "stats") return stats();
    if (k === "search") return search(params.get("q") || "");
    if (k === "registry") return registryIndex();
    if (k === "catalog") return catalog();
    if (k === "trainees") return seg[2] ? notFound(getTrainee(seg[2]), "Trainee") : listTrainees();
    if (k === "characters") return seg[2] ? notFound(getCharacter(seg[2]), "Character") : listCharacters();
    if (k === "support-cards") return seg[2] ? notFound(getSupportCard(seg[2]), "Support card") : listSupportCards();
    if (k === "skills") return seg[2] ? notFound(getSkill(seg[2]), "Skill") : listSkills();
    if (k === "races") return seg[2] ? notFound(getRace(seg[2]), "Race") : listRaces();
    if (k === "items") return seg[2] ? notFound(getItem(seg[2]), "Item") : listItems();
    if (k === "npcs") return seg[2] ? notFound(getNpc(seg[2]), "NPC") : listNpcs();
    if (k === "tt-builds") return seg[2] ? notFound(getTtBuild(seg[2]), "Build") : listTtBuilds();
    if (k === "g") return seg[3] ? notFound(genericDetail(seg[2], seg[3]), "Entry") : notFound(genericList(seg[2]), "Category");
  }
  throw new Error(`Unknown API path: ${path}`);
}

root.MasterWiki = { init, load, loaded, unload, api, _internal: { q, humanizeCondition, describeAbilities } };
})(typeof window !== "undefined" ? window : globalThis);
