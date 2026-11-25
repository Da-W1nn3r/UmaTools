/* Client-side import: parse trained_chara_data.json against the static catalog.
   Stable identity: uid = card_id + register_time (immutable in-game), so references
   survive re-extraction even if trained_chara_id values change. */
const PINK_GROUP_TO_APT = { 11: "turf", 12: "dirt", 21: "front", 22: "pace", 23: "late", 24: "end",
  31: "sprint", 32: "mile", 33: "medium", 34: "long" };
const BLUE_STAT = { 1: "speed", 2: "stamina", 3: "power", 4: "guts", 5: "wit" };
const APT_FIELDS = { turf: "proper_ground_turf", dirt: "proper_ground_dirt",
  front: "proper_running_style_nige", pace: "proper_running_style_senko",
  late: "proper_running_style_sashi", end: "proper_running_style_oikomi",
  sprint: "proper_distance_short", mile: "proper_distance_mile",
  medium: "proper_distance_middle", long: "proper_distance_long" };
const POSITION_LABEL = { 10: "parent_a", 20: "parent_b", 11: "gp_a1", 12: "gp_a2", 21: "gp_b1", 22: "gp_b2" };

function parseSparks(factorInfo, cat) {
  const out = { blue: [], pink: [], white: [], green: [], scenario: [], other: [] };
  for (const f of factorInfo || []) {
    const meta = cat.factors[f.factor_id];
    if (!meta) { out.other.push({ id: f.factor_id, name: String(f.factor_id), stars: f.factor_id % 100 }); continue; }
    const e = { id: meta.id, name: meta.name, stars: meta.stars };
    if (meta.type === 1) { e.stat = BLUE_STAT[meta.group]; out.blue.push(e); }
    else if (meta.type === 2) { e.apt = PINK_GROUP_TO_APT[meta.group]; out.pink.push(e); }
    else if (meta.type === 3) { e.card_id = meta.group; out.green.push(e); }
    else if (meta.type === 4) { e.kind = "skill"; out.white.push(e); }
    else if (meta.type === 5) { e.kind = "race"; out.white.push(e); }
    else if (meta.type === 6) out.scenario.push(e);
    else out.other.push(e);
  }
  return out;
}

function sparkSummary(sparks) {
  const blue = {}, pink = {};
  for (const b of sparks.blue) blue[b.stat] = (blue[b.stat] || 0) + b.stars;
  for (const p of sparks.pink) pink[p.apt] = (pink[p.apt] || 0) + p.stars;
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  return { blue, pink, blue_total: sum(blue), pink_total: sum(pink),
    white_count: sparks.white.length, white_stars: sum(sparks.white.map(w => w.stars)),
    green_count: sparks.green.length, green_stars: sum(sparks.green.map(g => g.stars)) };
}

function g1Wins(saddleIds, cat) {
  const seen = new Map();
  for (const sid of saddleIds || [])
    for (const w of cat.saddle_g1[sid] || []) seen.set(w.race_id, w.name);
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([race_id, name]) => ({ race_id, name }));
}

function veteranUid(c, taken) {
  const base = `${c.card_id}_${String(c.register_time || "").replace(/\D/g, "")}`;
  let uid = base, i = 2;
  // collision guard: same card + same second -> disambiguate with stats
  while (taken.has(uid)) uid = `${base}_${c.speed || 0}x${c.stamina || 0}_${i++}`;
  return uid;
}

function parseVeteran(c, cat, uid) {
  const cardId = c.card_id;
  const charaId = cat.card_chara[cardId] || Math.floor(cardId / 100);
  const sparks = parseSparks(c.factor_info_array, cat);
  const ancestors = (c.succession_chara_array || []).map(a => {
    const aChara = cat.card_chara[a.card_id] || Math.floor(a.card_id / 100);
    const sp = parseSparks(a.factor_info_array, cat);
    return { pos: a.position_id, role: POSITION_LABEL[a.position_id] || String(a.position_id),
      card_id: a.card_id, chara_id: aChara, name: cat.chara_names[aChara] || String(a.card_id),
      talent_level: a.talent_level, rarity: a.rarity, sparks: sp, summary: sparkSummary(sp),
      g1_wins: g1Wins(a.win_saddle_id_array, cat),
      // owner_viewer_id != 0 marks a BORROWED legacy (inferred from match patterns);
      // own ancestors carry 0 and can be auto-linked to your veterans (linkLineage).
      owner_viewer_id: a.owner_viewer_id || 0, borrowed: (a.owner_viewer_id || 0) !== 0,
      matched_uid: null };
  }).sort((x, y) => x.pos - y.pos);
  const aptitudes = {};           // achieved grades of THIS veteran (after its run's inheritance)
  for (const [k, f] of Object.entries(APT_FIELDS)) aptitudes[k] = c[f] ?? 1;
  // base aptitudes of the character/card — what a fresh trainee starts with (planning input)
  const baseAptitudes = cat.card_aptitudes?.[cardId] || { ...aptitudes };
  const racedG1 = [...new Set((c.race_result_list || []).map(r => cat.program_g1[r.program_id]).filter(Boolean))].sort();
  return {
    uid, id: c.trained_chara_id, card_id: cardId, chara_id: charaId,
    name: cat.chara_names[charaId] || String(charaId), title: cat.card_titles[cardId] || "",
    memo: c.memo || "", register_time: c.register_time || "", scenario_id: c.scenario_id,
    stats: { speed: c.speed, stamina: c.stamina, power: c.power, guts: c.guts, wit: c.wiz },
    fans: c.fans, rank_score: c.rank_score, wins: c.wins, succession_num: c.succession_num,
    talent_level: c.talent_level, rarity: c.rarity,
    aptitudes, base_aptitudes: baseAptitudes, sparks, summary: sparkSummary(sparks), ancestors,
    g1_wins: g1Wins(c.win_saddle_id_array, cat), raced_g1: racedG1,
    race_count: (c.race_result_list || []).length,
    skills: (c.skill_array || []).map(s => ({ id: s.skill_id, name: cat.skill_names[s.skill_id] || String(s.skill_id), level: s.level })),
    relation_groups: cat.chara_relations[charaId] || [],
    missing: false, imported_at: new Date().toISOString(),
    raw: c,
  };
}

/* Merge an import into the browser store. Match by stable uid; trained_chara_id is
   treated as a mutable display field. Veterans absent from the import are flagged
   `missing` (kept until the user prunes them). */
async function importVeterans(rawArray, cat) {
  if (!Array.isArray(rawArray)) throw new Error("Expected a JSON array of trained characters");
  const report = { added: 0, updated: 0, unchanged: 0, missing: 0, invalid: 0, total: rawArray.length };
  const taken = new Set(Object.keys(DB.veterans));
  const toSave = [];
  const seenUids = new Set();
  for (const c of rawArray) {
    if (!c || typeof c !== "object" || !c.card_id || !c.factor_info_array) { report.invalid++; continue; }
    // find existing by uid; fall back to card+register_time match
    let uid = veteranUid(c, new Set()); // canonical uid (no collision suffix)
    let existing = DB.veterans[uid];
    if (!existing) {
      // collision-suffixed veterans from a previous import: match on raw identity
      const rt = String(c.register_time || "");
      existing = Object.values(DB.veterans).find(v =>
        v.card_id === c.card_id && v.register_time === rt &&
        v.stats.speed === c.speed && v.stats.stamina === c.stamina);
      if (existing) uid = existing.uid;
      else uid = veteranUid(c, taken);
    }
    taken.add(uid); seenUids.add(uid);
    const parsed = parseVeteran(c, cat, uid);
    if (existing && existing.keep) parsed.keep = true;   // preserve omit-from-prune flag across imports
    if (!existing) report.added++;
    else {
      const changed = existing.id !== parsed.id || existing.memo !== parsed.memo ||
        existing.fans !== parsed.fans || existing.succession_num !== parsed.succession_num ||
        JSON.stringify(existing.sparks) !== JSON.stringify(parsed.sparks);
      report[changed ? "updated" : "unchanged"]++;
      parsed.imported_at = new Date().toISOString();
    }
    toSave.push(parsed);
  }
  // flag veterans not present in this import
  const missingList = [];
  for (const v of Object.values(DB.veterans)) {
    if (!seenUids.has(v.uid)) {
      if (!v.missing) { v.missing = true; missingList.push(v); }
      report.missing++;
    }
  }
  await DB.saveVeterans(toSave.concat(missingList));
  report.lineage = await linkLineage();
  return report;
}

/* ---------- automatic lineage reconstruction ----------
   An ancestor snapshot is matched to one of YOUR veterans when card, the exact spark
   (factor id) set and the G1 win set all agree, and the candidate was registered
   BEFORE the child. With real data this links 552/842 own slots uniquely, 0 timing
   contradictions; the rest point to since-deleted veterans (snapshot kept in child).
   Borrowed slots (owner_viewer_id != 0) are flagged, never matched. */
function sparkIdSig(sparks) {
  const ids = [];
  for (const k of ["blue", "pink", "white", "green", "scenario", "other"])
    for (const s of sparks[k] || []) ids.push(s.id);
  return ids.sort((a, b) => a - b).join(",");
}
function lineageSig(cardId, sparks, g1wins) {
  return cardId + "|" + sparkIdSig(sparks) + "|" + (g1wins || []).map(w => w.race_id).sort((a, b) => a - b).join(",");
}

async function linkLineage() {
  const bySig = {};
  for (const v of Object.values(DB.veterans))
    (bySig[lineageSig(v.card_id, v.sparks, v.g1_wins)] ||= []).push(v);
  const stats = { linked: 0, borrowed: 0, deleted: 0, ambiguous: 0 };
  const changed = [];
  for (const v of Object.values(DB.veterans)) {
    let dirty = false;
    for (const a of v.ancestors) {
      let match = null;
      if (a.borrowed) stats.borrowed++;
      else {
        const cand = (bySig[lineageSig(a.card_id, a.sparks, a.g1_wins)] || [])
          .filter(p => p.uid !== v.uid && (p.register_time || "") < (v.register_time || ""));
        if (cand.length === 1) { match = cand[0].uid; stats.linked++; }
        else if (cand.length > 1) { stats.ambiguous++; stats.deleted++; }
        else stats.deleted++;
      }
      if ((a.matched_uid || null) !== match) { a.matched_uid = match; dirty = true; }
    }
    if (dirty) changed.push(v);
  }
  if (changed.length) await DB.saveVeterans(changed);
  return stats;
}

function exportVeterans() {
  return Object.values(DB.veterans).map(v => v.raw);
}
