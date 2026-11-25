// Assembles a umadump-shaped trained_chara_data entry from values read off screenshots.
// Pure logic: OCR/UI produce `parsed`, this turns it into JSON plus warnings.
import { buildIndex, lookup, normalize, wordMatch, rankMatches, isConfident } from "./match.js";
import { splitTier } from "./skills.js";

export const APTITUDE = { G: 1, F: 2, E: 3, D: 4, C: 5, B: 6, A: 7, S: 8 };
export const STRATEGY = { front: 1, pace: 2, late: 3, end: 4 }; // 1 nige, 2 senko, 3 sashi, 4 oikomi
const YEAR = { junior: 0, classic: 1, senior: 2 };
// race_permission -> years (0-based) in which that program can occur
const PERMISSION_YEARS = { 1: [0], 2: [1], 3: [1, 2], 4: [2], 5: [3] };
const FINALE_ORDER = [/qualifier|race 1$/i, /semifinal|race 2$/i, /finals|race 3$/i];

// Key order and placeholder values follow umadump's trained_chara_data entry.
export function template() {
  return {
    viewer_id: 0, trained_chara_id: 0, owner_viewer_id: 0, owner_trained_chara_id: 0,
    single_mode_chara_id: 0, chara_seed: 0, card_id: 0,
    succession_trained_chara_id_1: 0, succession_trained_chara_id_2: 0, use_type: 0,
    speed: 0, stamina: 0, power: 0, wiz: 0, guts: 0, fans: 0, rank_score: 0, rank: 0,
    scenario_id: 0, route_id: 0, arrive_route_race_id: 0,
    proper_ground_turf: 0, proper_ground_dirt: 0,
    proper_running_style_nige: 0, proper_running_style_senko: 0,
    proper_running_style_sashi: 0, proper_running_style_oikomi: 0,
    proper_distance_short: 0, proper_distance_mile: 0, proper_distance_middle: 0, proper_distance_long: 0,
    succession_num: 0, rarity: 3, is_saved: 1, is_locked: 0, talent_level: 0, race_cloth_id: 0,
    chara_grade: 0, running_style: 0, nickname_id: 0, wins: 0,
    register_time: "1970-01-01 00:00:00", create_time: "1970-01-01 00:00:00",
    skill_array: [], support_card_list: [], race_result_list: [],
    win_saddle_id_array: [], nickname_id_array: [], factor_info_array: [], factor_extend_array: [],
    succession_chara_array: [], icon_type: 0, memo: "",
  };
}

export function rankFromRating(score, ranks) {
  let rank = 0;
  ranks.forEach((r, i) => { if (r.min <= score) rank = i + 1; });
  return rank;
}

// The trainee's own unique skill id, derived from card_id (verified on 414 dumped skills).
export function nativeUniqueSkill(cardId) {
  const chara = Math.floor(cardId / 100), variant = cardId % 100;
  return 100000 + (variant - 1) * 10000 + (chara - 1000) * 10 + 1;
}

export function makeResolver(tables) {
  return {
    tables,
    cards: buildIndex(Object.entries(tables.cards)),
    nicknames: buildIndex(Object.entries(tables.nicknames)),
    skills: buildIndex(Object.entries(tables.skills).map(([id, s]) => [id, s.name])),
    // Older builds stored two-line scenario names with a literal "\n"; treat it as a line break.
    scenarios: buildIndex(Object.entries(tables.scenarios)
      .map(([id, name]) => [id, String(name ?? "").replaceAll("\\n", "\n")])),
    programsByName: buildIndex(Object.entries(tables.programs).map(([id, p]) => [id, p.name])),
    raceNames: [...new Set(Object.values(tables.programs).map((p) => p.name).filter(Boolean))],
    skillNames: [...new Set(Object.values(tables.skills).map((s) => s.name).filter(Boolean))],
    cardNames: [...new Set(Object.values(tables.cards).filter(Boolean))],
    nicknameNames: [...new Set(Object.values(tables.nicknames).filter(Boolean))],
  };
}

// Flattens ranked index hits into per-id review candidates (best first, deduped).
function reviewCandidates(ranked, nameOf, limit = 6) {
  const out = [], seen = new Set();
  for (const r of ranked) for (const id of r.ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: nameOf(id) ?? `#${id}`, score: r.score });
    if (out.length >= limit) return out;
  }
  return out;
}

// Scores OCR text against a table and decides whether it can be accepted without asking the user.
// Exact matches and near-matches that clearly beat every other entry are confident ("Louder| Tracen
// Cheer!" -> "Louder! Tracen Cheer!"). Ties ("Mile Corners" -> ◎ or ○) and garbage ("eee-----") are
// not: a best guess is still returned for the output, plus a review describing the alternatives.
// `confirmed` means the user already resolved this reading, so no review is raised.
function matchWithReview(index, text, names, nameOf, { confirmed = false, raw = null } = {}) {
  const exact = lookup(index, text);
  if (exact?.exact) return { hit: exact, review: null, uncertain: false };
  const ranked = rankMatches(index, text);
  let best = ranked[0] ?? null;
  // Word-level recovery for badly mangled lines; wordMatch enforces its own margin.
  if (!best || best.score < 0.8) {
    const wm = wordMatch(names, raw ?? text) ?? (raw ? wordMatch(names, text) : null);
    if (wm && wm.score > (best?.score ?? 0)) {
      const ids = lookup(index, wm.name)?.ids ?? [];
      if (ids.length) best = { key: normalize(wm.name), ids, score: wm.score, exact: false, viaWords: true };
    }
  }
  const distance = best ? Math.round((1 - best.score) * Math.max(normalize(text).length, best.key.length)) : 0;
  if (isConfident(best, best?.viaWords ? ranked.filter((r) => r.key !== best.key) : ranked)) {
    return { hit: { ids: best.ids, exact: best.exact, distance }, review: null, uncertain: false };
  }
  const guess = best && best.score >= 0.6 ? best : null;
  const reason = best && best.score >= 0.75 ? "ambiguous" : "unrecognised";
  const pool = ranked.filter((r) => (reason === "ambiguous" ? r.score >= 0.75 : r.score >= 0.25)).slice(0, reason === "ambiguous" ? 8 : 4);
  const review = confirmed ? null : {
    reason,
    candidates: reviewCandidates(guess && !pool.includes(guess) ? [guess, ...pool] : pool, nameOf),
  };
  return { hit: guess ? { ids: guess.ids, exact: false, distance } : null, review, uncertain: true };
}

export function turnFor(program, year, name) {
  if (program.permission === 5) {
    const i = FINALE_ORDER.findIndex((re) => re.test(name));
    return 74 + 2 * Math.max(i, 0);
  }
  return year * 24 + (program.month - 1) * 2 + program.half;
}

export function pickProgram(R, race, chara, warnings = [], reviews = null) {
  let hit = lookup(R.programsByName, race.name);
  let review = null;
  if (hit && !hit.exact) hit = null;
  if (!hit) {
    const m = matchWithReview(R.programsByName, race.name, R.raceNames, (id) => R.tables.programs[id]?.name,
      { confirmed: race.confirmed, raw: race.raw?.name });
    hit = m.hit; review = m.review;
  }
  if (!hit) {
    warnings.push(`Race not recognised: "${race.name}"`);
    if (review && reviews) reviews.push({ kind: "race", raw: race.raw?.name ?? race.name, shot: race.shot, box: race.box, current: null, ...review });
    return null;
  }
  const groups = new Set(R.tables.chara_program_groups[String(chara)] ?? []);
  const years = race.year == null ? null : race.year;
  let cands = hit.ids.map((id) => ({ id, p: R.tables.programs[id] }))
    .filter(({ p }) => p.month === race.month && p.half === race.half || p.permission === 5)
    .filter(({ p }) => years == null || p.permission === 5 || PERMISSION_YEARS[p.permission].includes(years))
    .filter(({ p }) => p.group === 0 || groups.size === 0 || groups.has(p.group));
  if (!cands.length) { warnings.push(`No program for "${race.name}" (${race.month}/${race.half})`); return null; }
  // Prefer this trainee's own program group, then the general one; ties go to the lowest id.
  const own = cands.filter(({ p }) => p.group !== 0);
  const pool = (own.length ? own : cands).sort((a, b) => a.id - b.id);
  if (review && reviews) reviews.push({ kind: "race", raw: race.raw?.name ?? race.name, shot: race.shot, box: race.box, current: pool[0].id, ...review });
  return pool[0];
}

// Same matching rules as assemble() so the editable view's hints always agree with the JSON.
export function resolveSkill(R, skill, native, warnings = [], reviews = null) {
  const { base, tier } = splitTier(skill.name);
  let hit = null, review = null, uncertain = false;
  if (tier) {
    const order = tier === "◎" ? ["◎", "○"] : ["○", "◎"];
    const found = order.map((t) => lookup(R.skills, `${base} ${t}`, 0.05)).map((x) => (x && x.exact ? x : null));
    hit = found[0] ?? found[1];
    if (hit && !found[0]) warnings.push(`Skill "${base}": read tier ${tier} but only ${order[1]} exists; using that`);
  }
  if (!hit) {
    const m = matchWithReview(R.skills, tier ? `${base} ${tier}` : skill.name, R.skillNames,
      (id) => R.tables.skills[id]?.name, { confirmed: skill.confirmed });
    hit = m.hit; review = m.review; uncertain = m.uncertain;
  }
  if (!hit) {
    warnings.push(`Skill not recognised: "${skill.name}"`);
    if (review && reviews) reviews.push({ kind: "skill", raw: skill.name, shot: skill.shot, box: skill.box, current: null, ...review });
    return null;
  }
  let id = hit.ids[0];
  if (hit.ids.length > 1) {
    const sorted = hit.ids.slice().sort((a, b) => a - b);
    if (sorted.includes(native)) id = native;
    else if (sorted.length === 2 && Math.floor(sorted[0] / 100000) === 1 && Math.floor(sorted[1] / 100000) === 9) id = sorted[1];
    else { id = sorted[0]; warnings.push(`Skill "${skill.name}" is ambiguous (${sorted.join(", ")}); using ${id}`); }
  }
  if (review && reviews) reviews.push({ kind: "skill", raw: skill.name, shot: skill.shot, box: skill.box, current: id, ...review });
  return { id, hit, uncertain };
}

// A dropped parent JSON is a previously generated veteran entry; lift the fields a parent needs.
function successionFromEntry(position_id, e) {
  return {
    position_id, card_id: e.card_id ?? 0, rank: e.rank ?? 0, rarity: e.rarity ?? 3,
    talent_level: e.talent_level ?? 0,
    factor_info_array: (e.factor_info_array ?? []).map((f) => ({ factor_id: f.factor_id, level: f.level ?? 0 })),
    win_saddle_id_array: e.win_saddle_id_array ?? [], owner_viewer_id: e.owner_viewer_id ?? 0,
  };
}

// Parents come from dropped JSONs (complete) and/or OCR'd sparks (best effort). A dropped JSON is
// confirmed against the screenshot by its green unique spark (card_id * 100 + stars).
function buildSuccession(insp, warnings) {
  const out = [];
  const ocrByCard = new Map((insp.parents ?? []).map((p) => [p.cardId, p]));
  const placed = new Set();
  for (const d of insp.dropped ?? []) {
    const e = d.entry ?? {};
    const card = e.card_id ?? 0;
    const p = successionFromEntry(d.position_id, e);
    const ocr = ocrByCard.get(card);
    if (!ocr) warnings.push(`Dropped parent (card ${card}, slot ${d.position_id}) was not seen in the Inspiration screenshot.`);
    else {
      placed.add(card);
      const greenId = card * 100 + ocr.greenStars;
      if (!p.factor_info_array.some((f) => f.factor_id === greenId)) {
        warnings.push(`Parent ${card}: the screenshot shows a ${ocr.greenStars}★ green spark, but the dropped JSON has no matching green factor (${greenId}).`);
      }
    }
    out.push(p);
  }
  const taken = new Set(out.map((p) => p.position_id));
  for (const p of insp.parents ?? []) {
    if (placed.has(p.cardId)) continue;
    const pos = p.positionId && !taken.has(p.positionId) ? p.positionId : [10, 20].find((s) => !taken.has(s));
    if (pos == null) { warnings.push(`Parent card ${p.cardId} has no free slot; ignored.`); continue; }
    taken.add(pos);
    out.push({ position_id: pos, card_id: p.cardId, rank: 0, rarity: 3, talent_level: 0,
      factor_info_array: p.factorIds.map((id) => ({ factor_id: id, level: 0 })),
      win_saddle_id_array: [], owner_viewer_id: 0 });
    warnings.push(`Parent card ${p.cardId} was read from sparks only: drop its JSON to fill rank, rarity, talent level and saddles.`);
  }
  return out.sort((a, b) => a.position_id - b.position_id);
}

// parsed = { header, skills, summary, races, inspiration }   (any part may be missing)
export function assemble(parsed, tables, ranks = tables.umamusume_rating_ranks.ranks) {
  const R = tables._resolver ?? (tables._resolver = makeResolver(tables));
  const v = template();
  const warnings = [];
  const reviews = [];
  const h = parsed.header;

  if (!h) warnings.push("No header read: card, stats and aptitudes unavailable.");
  else {
    const cardText = `${h.title ?? ""} ${h.name ?? ""}`.trim();
    const cm = matchWithReview(R.cards, cardText, R.cardNames, (id) => R.tables.cards[id], { confirmed: h.cardConfirmed });
    const card = cm.hit;
    if (!card) warnings.push(`Card not recognised: "${cardText}"`);
    else {
      v.card_id = card.ids[0];
      if (card.ids.length > 1) warnings.push(`Card name matches ${card.ids.length} cards; using ${v.card_id}`);
    }
    if (cm.review) reviews.push({ kind: "card", raw: cardText, shot: h.shot, box: h.infoBox, current: v.card_id || null, ...cm.review });
    for (const k of ["speed", "stamina", "power", "guts", "wiz"]) {
      if (Number.isFinite(h.stats?.[k])) v[k] = h.stats[k]; else warnings.push(`Stat not read: ${k}`);
    }
    if (Number.isFinite(h.rating)) { v.rank_score = h.rating; v.rank = rankFromRating(h.rating, ranks); }
    else warnings.push("Rating not read");
    const ap = h.aptitudes ?? {};
    const map = { turf: "proper_ground_turf", dirt: "proper_ground_dirt",
      front: "proper_running_style_nige", pace: "proper_running_style_senko",
      late: "proper_running_style_sashi", end: "proper_running_style_oikomi",
      sprint: "proper_distance_short", mile: "proper_distance_mile",
      medium: "proper_distance_middle", long: "proper_distance_long" };
    for (const [k, field] of Object.entries(map)) {
      const n = APTITUDE[ap[k]];
      if (n) v[field] = n; else warnings.push(`Aptitude not read: ${k}`);
    }
    const cands = h.epithetCandidates ?? (h.epithet ? [h.epithet] : []);
    let best = null;
    // Banner text picks up trailing button text ("... Change"), so also try leading word prefixes.
    const variants = [];
    for (const c of cands) {
      const w = c.split(" ");
      // Every contiguous word window: stray icon/button tokens can sit on either side of the epithet.
      for (let i = 0; i < w.length; i++) for (let j = w.length; j > i; j--) {
        const s = w.slice(i, j).join(" ");
        if (s.length >= 5) variants.push(s);
      }
    }
    let bestVariant = null;
    for (const c of variants) {
      const e = lookup(R.nicknames, c, 0.12);
      if (e && (!best || (e.exact && !best.exact) || (e.exact === best.exact && e.distance < best.distance))) { best = e; bestVariant = c; }
    }
    if (best) {
      v.nickname_id = best.ids[0];
      if (!best.exact && !h.epithetConfirmed) {
        const ranked = rankMatches(R.nicknames, bestVariant);
        if (!isConfident(ranked[0], ranked)) {
          reviews.push({ kind: "epithet", raw: bestVariant, shot: h.shot, box: h.infoBox, current: v.nickname_id,
            reason: "ambiguous", candidates: reviewCandidates(ranked, (id) => R.tables.nicknames[id]) });
        }
      }
    } else {
      warnings.push("Epithet not read");
      if (!h.epithetConfirmed && cands.length) {
        const ranked = rankMatches(R.nicknames, cands[0]);
        reviews.push({ kind: "epithet", raw: cands[0], shot: h.shot, box: h.infoBox, current: null,
          reason: "unrecognised", candidates: reviewCandidates(ranked, (id) => R.tables.nicknames[id]) });
      }
    }
    v.memo = (h.memo ?? "").trim() === "-" || (h.memo ?? "").trim() === "–" ? "" : (h.memo ?? "").trim();
  }

  // Skills
  if (!parsed.skills) warnings.push("Skills tab not seen: skill_array is empty.");
  else {
    const native = v.card_id ? nativeUniqueSkill(v.card_id) : null;
    for (const [i, s] of parsed.skills.entries()) {
      const mark = reviews.length;
      const resolved = resolveSkill(R, s, native, warnings, reviews);
      for (let j = mark; j < reviews.length; j++) reviews[j].index = i;
      if (resolved) v.skill_array.push({ skill_id: resolved.id, level: s.level ?? 1 });
    }
  }

  // Inspiration: own sparks -> factor_info_array; the two parents -> succession_chara_array.
  const insp = parsed.inspiration;
  if (!insp) warnings.push("Inspiration tab not seen: factor_info_array and parents are empty.");
  else {
    v.factor_info_array = (insp.ownFactorIds ?? []).map((id) => ({ factor_id: id, level: 0 }));
    if (!v.factor_info_array.length) warnings.push("No own sparks were read from the Inspiration tab.");
    v.succession_chara_array = buildSuccession(insp, warnings);
  }

  // Summary block
  const sm = parsed.summary;
  if (!sm) warnings.push("Career summary not seen: fans, wins, scenario and date unavailable.");
  else {
    if (Number.isFinite(sm.wins)) v.wins = sm.wins; else warnings.push("Wins not read");
    const block = [sm.fans, sm.scenario, sm.date].some((x) => x != null);
    if (!block) {
      warnings.push("The Career Info summary block (fans, scenario, date acquired) was not captured: scroll to the top of Career Info and take another screenshot.");
    } else {
      if (Number.isFinite(sm.fans)) v.fans = sm.fans; else warnings.push("Fans not read");
      if (sm.scenario) {
        let sc = lookup(R.scenarios, sm.scenario);
        let prefix = false;
        if (!sc) {
          // Two-line names can be cut off after the first line: accept a unique prefix of a known name.
          const key = normalize(sm.scenario);
          const hits = key.length >= 8 ? [...R.scenarios].filter(([k]) => k.startsWith(key)) : [];
          if (hits.length === 1) { sc = { ids: hits[0][1], exact: false }; prefix = true; warnings.push(`Scenario "${sm.scenario}" looks truncated; matched by prefix`); }
        }
        if (sc) {
          v.scenario_id = sc.ids[0];
          if (!sc.exact && !prefix && !sm.scenarioConfirmed) {
            const ranked = rankMatches(R.scenarios, sm.scenario);
            if (!isConfident(ranked[0], ranked)) {
              reviews.push({ kind: "scenario", raw: sm.scenario, shot: sm.shot, box: sm.box, current: v.scenario_id,
                reason: "ambiguous", candidates: reviewCandidates(ranked, (id) => String(R.tables.scenarios[id] ?? "").replaceAll("\\n", " ")) });
            }
          }
        } else {
          warnings.push(`Scenario not recognised: "${sm.scenario}"`);
          if (!sm.scenarioConfirmed) {
            const ranked = rankMatches(R.scenarios, sm.scenario);
            reviews.push({ kind: "scenario", raw: sm.scenario, shot: sm.shot, box: sm.box, current: null,
              reason: "unrecognised", candidates: reviewCandidates(ranked, (id) => String(R.tables.scenarios[id] ?? "").replaceAll("\\n", " ")) });
          }
        }
      } else warnings.push("Scenario not read");
      if (sm.date && /^\d{4}-\d{2}-\d{2}$/.test(sm.date)) {
        v.register_time = v.create_time = `${sm.date} 00:00:00`;
      } else warnings.push("Date acquired not read");
    }
    if (Number.isFinite(sm.rating) && v.rank_score && sm.rating !== v.rank_score) {
      warnings.push(`Rating differs between the header (${v.rank_score}) and the summary (${sm.rating}): one was misread.`);
    }
  }

  // Race history
  if (!parsed.races) warnings.push("Race history not seen.");
  else {
    const rows = [];
    const wonInstances = new Set();
    for (const [i, r] of parsed.races.entries()) {
      const mark = reviews.length;
      const c = pickProgram(R, r, Math.floor(v.card_id / 100), warnings, reviews);
      for (let j = mark; j < reviews.length; j++) reviews[j].index = i;
      if (!c) continue;
      const turn = turnFor(c.p, r.year, r.name);
      const style = STRATEGY[String(r.strategy ?? "").toLowerCase()] ?? 0;
      rows.push({ turn, program_id: c.id, weather: 0, ground_condition: 0, running_style: style,
        popularity: 0, result_rank: r.rank ?? 0, result_time: 0, prize_money: 0, instance: c.p.instance });
    }
    rows.sort((a, b) => a.turn - b.turn);
    // Best effort: the same race can exist as several programs, which a screenshot cannot tell apart.
    for (const r of rows) { if (r.result_rank === 1) wonInstances.add(r.instance); delete r.instance; }
    v.race_result_list = rows;
    v.running_style = rows.length ? rows[rows.length - 1].running_style : 0;
    for (const [id, need] of Object.entries(tables.saddle_rules)) {
      if (need.length && need.every((i) => wonInstances.has(i))) v.win_saddle_id_array.push(Number(id));
    }
    v.win_saddle_id_array.sort((a, b) => a - b);
    if (Number.isFinite(sm?.races) && sm.races !== rows.length) {
      warnings.push(`Race history has ${rows.length} entries but the summary says ${sm.races}: some races may be missing.`);
    }
    if (rows.length && !rows.some((r) => /debut/i.test(tables.programs[r.program_id].name))) {
      warnings.push("Race history does not include the debut race: the list may be cut off.");
    }
  }
  return { veteran: v, warnings, reviews };
}
