/* Objective-based evaluation engine (browser port, with corrected leaf scoring).

   Key principles:
   - MATCHED (concentrated) sparks >> mismatched (scattered) sparks. With no explicit
     targets, blue/pink score = (total/9) x concentration, so 6★ Medium beats 3+3+2 scatter.
   - Affinity uses the breeding formula:
     Aff_P1 = base(T,P1)+base(P1,P2)+base(P1,GP1_L)+base(P1,GP1_R)
              + 3×(shared_G1(P1,P2)+shared_G1(P1,GP1_L)+shared_G1(P1,GP1_R)).
     For leaf display the veteran is treated as P1 and only its knowable own-parent
     terms are counted (trainee/partner terms excluded).
   - "Lineage ★" (9★ convention) = raw stars of the veteran + its two parents.
   - Grandparent BLUE counts fully (each lineage uma rolled separately); pink only
     raises aptitudes at career start (cap A). Estimates are labelled. */
const APTS = ["turf", "dirt", "front", "pace", "late", "end", "sprint", "mile", "medium", "long"];
const STATS = ["speed", "stamina", "power", "guts", "wit"];

/* ---------- spark value model (spark_table.md) ----------
   Expected stats per inheritance event E = proc% × value:
     blue:         1★ 0.70×5=3.5   2★ 0.80×12=9.6   3★ 0.90×21=18.9  → 3★ ≈ 5.4× 1★ (NOT 3×)
     white skill/scenario: 1★ 0.03×10=0.3  2★ 0.06×20=1.2  3★ 0.09×30=2.7
     white race:   1★ 0.01×3=0.03  2★ 0.02×6=0.12   3★ 0.03×9=0.27   → 10× less stat value
     pink proc:    2/3/5%  (rare — aptitude steps themselves are deterministic, mechanics unchanged)
     green proc:   5/10/15% (linear in stars — existing stars/3 scoring already proportional)
   Affinity multiplies every proc: P = base × (1 + affinity/100). */
const SPARK_TABLE = {
  blue: { proc: { 1: 0.70, 2: 0.80, 3: 0.90 }, value: { 1: 5, 2: 12, 3: 21 } },
  pink: { proc: { 1: 0.02, 2: 0.03, 3: 0.05 } },
  green: { proc: { 1: 0.05, 2: 0.10, 3: 0.15 } },
  white_race: { proc: { 1: 0.01, 2: 0.02, 3: 0.03 }, value: { 1: 3, 2: 6, 3: 9 } },
  white_skill: { proc: { 1: 0.03, 2: 0.06, 3: 0.09 }, value: { 1: 10, 2: 20, 3: 30 } },
};
const BLUE_EV = { 1: 3.5, 2: 9.6, 3: 18.9 };

/* ---------- POST-CAREER spark creation chances (uma.guide / Prydwen) ----------
   These are the odds a FINISHED run creates a spark on the new veteran — separate
   from the in-run Inspiration procs in SPARK_TABLE above.
   White skill spark: only if the run learned the skill. Base 20% (○) / 25% (◎) /
   40% (gold), ×1.1 per lineage uma (2 parents + 4 grandparents) carrying the same
   white spark. The ×1.1 rule is best-supported, not confirmed.
   Race white: ~20–30% per G1 won. Scenario: ~20–30% on finishing the scenario.
   No published lineage-count rule for race/scenario → shown as ranges. */
const WHITE_CREATE_BASE = { skill: 0.20, skill_double: 0.25, gold: 0.40 };
function whiteCreationChance(base, carriers) {
  return Math.min(1, base * Math.pow(1.1, Math.max(0, Math.min(6, carriers))));
}
const RACE_CREATE_RANGE = [0.20, 0.30];      // per G1 won, if the run wins that race
const SCENARIO_CREATE_RANGE = [0.20, 0.30];  // on finishing the scenario

/* ---------- race schedules (target G1s for loop veterans) ----------
   Timing comes from the catalog (single_mode_program): each race has a turn
   (month + half) and the career years it is available in, shown for reference.
   Races are NOT treated as mutually exclusive — same-turn races have in-game
   exceptions, and no G1 is restricted by character. */
const RACE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const raceTurnLabel = r => `${RACE_MONTHS[(r.month || 1) - 1]} ${r.half === 1 ? "early" : "late"}`;

/* The default schedule: every G1, in calendar order. */
function defaultRacePresets(cat) {
  const g1 = cat.races.filter(r => r.grade === "G1")
    .sort((a, b) => (a.month * 2 + a.half) - (b.month * 2 + b.half) || a.id - b.id);
  return [{ name: "All G1s", races: g1.map(r => r.id) }];
}
const WHITE_EV = { race: { 1: 0.03, 2: 0.12, 3: 0.27 }, skill: { 1: 0.3, 2: 1.2, 3: 2.7 }, scenario: { 1: 0.3, 2: 1.2, 3: 2.7 } };
const BLUE_EV_PER_STAR = 6.3; // 18.9/3 — best value density, used to scale penalties

/* star total → expected value, assuming the best composition (greedy 3★, then 2★/1★).
   Superlinear: 3★=18.9 > 2★+1★=13.1 > 1★+1★+1★=10.5, so high-star sparks are premium. */
function starsToBlueEV(stars) {
  const n3 = Math.floor(stars / 3), r = stars % 3;
  return n3 * BLUE_EV[3] + (r === 2 ? BLUE_EV[2] : r === 1 ? BLUE_EV[1] : 0);
}
/* per-stat expected value from actual spark lists (composition-aware, unlike star sums) */
function blueEvDist(sparkLists) {
  const d = {};
  for (const list of sparkLists)
    for (const b of list || []) d[b.stat] = (d[b.stat] || 0) + (BLUE_EV[b.stars] || 0);
  for (const k of Object.keys(d)) d[k] = Math.round(d[k] * 10) / 10;
  return d;
}
function blueLists(char, ownOnly) {
  return ownOnly ? [char.sparks.blue]
    : [char.sparks.blue, ...char.ancestors.filter(a => a.role === "parent_a" || a.role === "parent_b").map(a => a.sparks.blue)];
}
const GL = { 1: "G", 2: "F", 3: "E", 4: "D", 5: "C", 6: "B", 7: "A", 8: "S" };
/* Scored categories. Aptitude is NOT scored (veteran aptitudes are fixed and irrelevant
   to breeding value); race access is NOT scored separately (race wins feed compatibility). */
const CATS = ["white", "compatibility", "blue", "pink", "green"];

function aptitudeStep(stars) { // pink spark inheritance: 1★→+1, 4★→+2, 7★→+3, 10★→+4 (cap A)
  return stars >= 10 ? 4 : stars >= 7 ? 3 : stars >= 4 ? 2 : stars >= 1 ? 1 : 0;
}
function stepsToStars(steps) { // minimum lineage pink★ needed for N grade steps
  return steps >= 4 ? 10 : steps === 3 ? 7 : steps === 2 ? 4 : steps === 1 ? 1 : 0;
}

const Engine = {
  cat: null, chars: {}, roster: [], g1Races: [], factorGroup: {},
  _affCache: null, _affSig: "",

  init(catalog) {
    this.cat = catalog;
    this.g1Races = catalog.races.filter(r => r.grade === "G1");
    this.factorGroup = {};
    for (const f of Object.values(catalog.factors))
      (this.factorGroup[f.group] ||= []).push(f.id);
    this.setRoster(Object.values(DB.veterans));
  },

  setRoster(vets) {
    this.roster = vets;
    this.chars = {};
    vets.forEach(v => this.chars[v.uid] = v);
    this._affCache = null;
    this._paCache = {};
    // auto-derived lineage index (from linkLineage): uid -> children that use it
    this.children = {};
    for (const v of vets)
      for (const a of v.ancestors)
        if (a.matched_uid && this.chars[a.matched_uid])
          (this.children[a.matched_uid] ||= []).push({ uid: v.uid, role: a.role });
  },

  childrenOf(uid) { return this.children?.[uid] || []; },

  /* Post-career creation chances for the objective's white targets, given the six
     lineage umas of a planned run (2 parents + 4 grandparents). */
  postCareerChances(lineageSix, cfg) {
    return this.whiteTargets(cfg).map(t => {
      const group = t.factor_id > 1000 ? Math.floor(t.factor_id / 100) : t.factor_id;
      const ids = this.factorGroup[group] || [t.factor_id];
      let carriers = 0;
      for (const u of lineageSix)
        if ((u.sparks.white || []).some(w => ids.includes(w.id))) carriers++;
      const f = this.cat.factors[t.factor_id];
      const kind = f?.type === 5 ? "race" : "skill";
      // factor names carry ○ for single-circle skills; ◎ vs gold is not distinguishable
      // in the catalog, so those are shown as a 25–40% base range.
      const single = kind === "skill" && (f?.name || "").endsWith("○");
      const chance = kind === "race" ? RACE_CREATE_RANGE
        : single ? [whiteCreationChance(WHITE_CREATE_BASE.skill, carriers), whiteCreationChance(WHITE_CREATE_BASE.skill, carriers)]
        : [whiteCreationChance(WHITE_CREATE_BASE.skill_double, carriers), whiteCreationChance(WHITE_CREATE_BASE.gold, carriers)];
      return { factor_id: t.factor_id, name: f?.name || String(t.factor_id), kind, carriers,
        present: carriers > 0, single_circle: single, chance };
    });
  },

  /* ---------- affinity ----------
     Aff_P1 = base(T,P1) + base(P1,P2) + base(P1,GP1_L) + base(P1,GP1_R)
              + 3 * (shared_G1(P1,P2) + shared_G1(P1,GP1_L) + shared_G1(P1,GP1_R))
     base = shared succession-relation points; shared_G1 = count of G1 races both won.
     T = intended trainee (optional), P2 = the other parent, GP1_* = P1's own parents. */
  basePoints(charaA, charaB) {
    if (charaA == null || charaB == null || charaA === charaB) return 0;
    const ga = this.cat.chara_relations[charaA] || [], gb = new Set(this.cat.chara_relations[charaB] || []);
    let pts = 0;
    for (const g of ga) if (gb.has(g)) pts += this.cat.relation_points[g] || 1;
    return pts;
  },

  sharedG1Count(winsA, winsB) {
    const sb = new Set(winsB.map(w => w.race_id));
    return winsA.filter(w => sb.has(w.race_id)).length;
  },

  /* P1-side terms knowable from the veteran alone (its own parents become GP1_L/GP1_R).
     Trainee/partner-dependent terms — base(T,P1), base(P1,P2), 3*shared_G1(P1,P2) —
     are excluded here and shown separately in the simulator. */
  parentAffinity(v) {
    if (this._paCache && this._paCache[v.uid]) return this._paCache[v.uid];
    const gps = v.ancestors.filter(a => a.role === "parent_a" || a.role === "parent_b");
    let base = 0, races = 0;
    const details = gps.map(gp => {
      const b = this.basePoints(v.chara_id, gp.chara_id);
      const sh = this.sharedG1Count(v.g1_wins, gp.g1_wins);
      base += b; races += 3 * sh;
      return { name: gp.name, card_id: gp.card_id, base: b, shared_g1: sh, race_points: 3 * sh };
    });
    const out = { total: base + races, base, race_points: races, gps: details,
      partner_max: 3 * v.g1_wins.length,
      note: "base + 3×shared G1 with own parents; trainee/partner terms excluded" };
    (this._paCache ||= {})[v.uid] = out;
    return out;
  },

  /* Full per-parent affinity for a concrete pairing (optionally with intended trainee). */
  pairAffinity(a, b, traineeCharaId) {
    const side = (p1, p2) => {
      const pa = this.parentAffinity(p1);
      const basePP = this.basePoints(p1.chara_id, p2.chara_id);
      const baseT = traineeCharaId ? this.basePoints(traineeCharaId, p1.chara_id) : 0;
      const sharedPP = this.sharedG1Count(p1.g1_wins, p2.g1_wins);
      const points = pa.base + basePP + baseT + pa.race_points + 3 * sharedPP;
      const rank = points <= 50 ? "△" : points <= 150 ? "〇" : "◎";
      return { points, rank, label: { "△": "Low", "〇": "Good", "◎": "Excellent" }[rank],
        base_own_parents: pa.base, race_own_parents: pa.race_points,
        base_partner: basePP, base_trainee: baseT, shared_g1_partner: sharedPP,
        race_partner: 3 * sharedPP, gp_details: pa.gps };
    };
    const p1 = side(a, b), p2 = side(b, a);
    const sharedG1 = a.g1_wins.filter(w => b.g1_wins.some(x => x.race_id === w.race_id));
    return { p1, p2, total: p1.points + p2.points, shared_g1: sharedG1,
      same_chara: a.chara_id === b.chara_id,
      trainee: traineeCharaId || null,
      note: "Aff_P = base(T,P) + base(P,other) + base(P,GP_L) + base(P,GP_R) + 3×(shared G1 with other parent and own parents)" };
  },

  /* ---------- pools & distributions ---------- */
  lineage(char) {
    const anc = {};
    char.ancestors.forEach(a => anc[a.role] = a);
    return { self: { sparks: char.sparks, summary: char.summary }, parent_a: anc.parent_a, parent_b: anc.parent_b };
  },

  rawStarDist(char, kind) {
    const dist = {};
    const entries = [char.summary, ...char.ancestors.filter(a => a.role === "parent_a" || a.role === "parent_b").map(a => a.summary)];
    for (const s of entries) for (const [k, v] of Object.entries(s[kind])) dist[k] = (dist[k] || 0) + v;
    return dist;
  },

  weightedCoverage(slots, cfg) {
    const cov = {}, gw = cfg.gp_white_weight ?? 0.35;
    for (const [key, slot] of Object.entries(slots)) {
      if (!slot) continue;
      const w = key === "self" ? 1 : gw;
      // scenario sparks are whites too — highest stat value in the table (10/20/30 @ 3/6/9%)
      for (const sp of [...slot.sparks.white, ...slot.sparks.green, ...(slot.sparks.scenario || [])]) cov[sp.id] = (cov[sp.id] || 0) + w;
    }
    return cov;
  },

  raceCoverage(aptitudes, minGrade = 5) {
    const out = { G1: 0, G2: 0, G3: 0 };
    for (const r of this.cat.races)
      if ((aptitudes[r.ground] || 1) >= minGrade && (aptitudes[r.dist] || 1) >= minGrade) out[r.grade]++;
    return out;
  },

  /* Planning projection: BASE aptitudes of the character + pink inheritance steps.
     Inheritance raises aptitudes only up to A (7); S bases stay S. */
  projectedAptitudes(char) {
    const base = char.base_aptitudes || char.aptitudes;
    const pink = this.rawStarDist(char, "pink");
    const proj = {};
    for (const a of APTS) {
      const b = base[a] || 1;
      proj[a] = b >= 7 ? b : Math.min(7, b + aptitudeStep(pink[a] || 0));
    }
    return proj;
  },

  /* ---------- concentration-aware distribution matching ---------- */
  concentration(dist) {
    const vals = Object.values(dist);
    const total = vals.reduce((a, b) => a + b, 0);
    if (!total) return { total: 0, conc: 0 };
    return { total, conc: vals.reduce((a, b) => a + b * b, 0) / (total * total) };
  },

  /* maxTotal: 9 for lineage (self + 2 parents), 3 for a veteran's OWN factor.
     In own scope, target distributions are clamped to 3★/stat — a 9★ Speed target
     means "max Speed", and a 3★ own Speed factor fully satisfies its part.
     evCtx = { stars } → EXPECTED-VALUE mode (blue): `actual` is a per-stat EV dist,
     targets stay configured in ★ but are matched in EV space (3★ ≈ 5.4× 1★).
     Display fields (actual/target/missing) remain in stars for the UI. */
  distMatch(actual, targets, kindLabel, maxTotal = 9, evCtx = null) {
    const { total, conc } = this.concentration(actual);
    const starDist = evCtx ? evCtx.stars : actual;
    const evData = evCtx ? { actual_ev: actual, expected_stats: +total.toFixed(1) } : {};
    if (!targets || !targets.length) {
      // MATCHED >> mismatched: full credit only for concentrated distributions
      const score = Math.min(1, total / (evCtx ? starsToBlueEV(maxTotal) : maxTotal)) * conc;
      const best = Object.entries(starDist).sort((a, b) => b[1] - a[1])[0];
      return [score, { actual: starDist, note: `no explicit ${kindLabel} targets; matched-distribution fallback`,
        concentration: +conc.toFixed(2),
        focus: best ? { key: best[0], stars: best[1] } : null, ...evData }];
    }
    const perMax = maxTotal <= 3 ? 3 : maxTotal <= 6 ? 6 : 9;
    let best = 0; const details = [];
    for (const t of targets) {
      const distStars = {};
      for (const [k, v] of Object.entries(t.dist || {})) distStars[k] = Math.min(v, perMax);
      const dist = {};
      for (const [k, v] of Object.entries(distStars)) dist[k] = evCtx ? starsToBlueEV(v) : v;
      const need = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
      const matched = Object.entries(dist).reduce((s, [k, v]) => s + Math.min(actual[k] || 0, v), 0);
      const offTarget = Object.entries(actual).reduce((s, [k, v]) => s + (k in dist ? 0 : v), 0);
      // mismatched stars are actively undesirable (EV penalty scaled per star-equivalent)
      const wastePenalty = Math.min(0.4, (evCtx ? 0.05 / BLUE_EV_PER_STAR : 0.05) * offTarget);
      const match = Math.max(0, matched / need - wastePenalty) * (t.weight ?? 1);
      const missing = {};
      for (const [k, v] of Object.entries(distStars)) if ((starDist[k] || 0) < v) missing[k] = v - (starDist[k] || 0);
      const offStars = evCtx ? Object.entries(starDist).reduce((s, [k, v]) => s + (k in distStars ? 0 : v), 0) : offTarget;
      details.push({ target: distStars, weight: t.weight ?? 1, match: +match.toFixed(3), missing, off_target_stars: offStars });
      if (match > best) best = match;
    }
    details.sort((a, b) => b.match - a.match);
    return [Math.min(1, best), { actual: starDist, alternatives: details, ...evData }];
  },

  /* ---------- categories: each returns [score0..1, reasons[], data{}] ---------- */
  /* Resolve white targets: a shared preset (by reference) overrides per-objective targets,
     so one preset can be maintained across core / branch / leaf objectives. */
  whiteTargets(cfg) {
    if (cfg.white_preset_id) {
      const p = Store.whitePreset(cfg.white_preset_id);
      if (p) return p.targets || [];
    }
    return cfg.white_targets || [];
  },

  /* relation versatility: how many compatible partners this character could have */
  relationPotential(char) {
    return (char.relation_groups || []).reduce((s, g) => s + (this.cat.relation_points[g] || 1), 0);
  },

  /* fallback white value of the veteran's OWN sparks: value-weighted stars.
     Race whites count less (stat EV 10× lower at equal stars; their skill-hint value
     is real but unquantified in spark_table.md → configurable discount, default 0.5).
     Scenario sparks count full (highest stat value: 10/20/30 @ 3/6/9%). */
  whiteSelfValue(char, cfg = {}) {
    const raceW = cfg.race_white_weight ?? 0.5;
    let val = 0;
    for (const w of char.sparks.white) val += w.stars * (w.kind === "race" ? raceW : 1);
    for (const s of char.sparks.scenario || []) val += s.stars;
    const count = char.sparks.white.length + (char.sparks.scenario || []).length;
    return { value: +val.toFixed(1), count,
      score: Math.min(1, 0.5 * val / 20 + 0.5 * count / 12) };
  },

  /* own-record affinity potential: race wins + relation breadth (no parents involved) */
  ownAffinity(char) {
    const vers = this.relationPotential(char);
    return { score: 0.7 * Math.min(1, char.g1_wins.length / 20) + 0.3 * Math.min(1, vers / 60),
      g1_wins: char.g1_wins.length, relation_potential: vers, relation_groups: (char.relation_groups || []).length };
  },

  scoreWhite(char, cfg, slots) {
    const cov = this.weightedCoverage(slots, cfg);
    const targets = this.whiteTargets(cfg);
    if (targets.length) {
      const totalW = targets.reduce((s, t) => s + (t.weight ?? 1), 0) || 1;
      let got = 0; const hit = [], missing = [];
      for (const t of targets) {
        const group = t.factor_id > 1000 ? Math.floor(t.factor_id / 100) : t.factor_id;
        const ids = this.factorGroup[group] || [t.factor_id];
        const c = Math.max(0, ...ids.map(i => cov[i] || 0));
        got += Math.min(1, c) * (t.weight ?? 1);
        const name = this.cat.factors[t.factor_id]?.name || String(t.factor_id);
        (c > 0 ? hit : missing).push({ factor_id: t.factor_id, name, coverage: +c.toFixed(2), weight: t.weight ?? 1 });
      }
      const reasons = [];
      if (hit.length) reasons.push(`${hit.length}/${targets.length} target white sparks present`);
      if (missing.length) reasons.push(`Missing ${missing.length} target white spark(s): ${missing.slice(0, 5).map(m => m.name).join(", ")}`);
      return [got / totalW, reasons, { targets_hit: hit, targets_missing: missing }];
    }
    const gw = cfg.gp_white_weight ?? 0.35;
    const raceW = cfg.race_white_weight ?? 0.5;
    const hasParents = !!(slots.parent_a || slots.parent_b);
    const self = this.whiteSelfValue(char, cfg);
    const gpVal = hasParents ? char.ancestors.filter(a => a.role.startsWith("parent")).reduce((x, a) => x + this.whiteSelfValue(a, cfg).value, 0) : 0;
    const weighted = self.value + gw * gpVal;
    // breadth (distinct sparks) matters as much as value-weighted stars
    const score = Math.min(1, 0.5 * weighted / 20 + 0.5 * self.count / 12);
    return [score, [`${self.count} white sparks (${self.value} value-weighted ★ own; race whites ×${raceW})${hasParents ? `; ${weighted.toFixed(1)} weighted lineage value` : ""}`],
      { white_stars: char.summary.white_stars, white_count: self.count, white_value: self.value,
        race_white_weight: raceW, weighted_lineage_stars: +weighted.toFixed(1) }];
  },

  /* informational only (legacy project alerts) — aptitude is never scored */
  aptitudeGoalStatus(char, cfg) {
    const goals = cfg.aptitude_goals || {};
    const pink = this.rawStarDist(char, "pink");
    const proj = this.projectedAptitudes(char);
    const out = {};
    for (const [apt, g] of Object.entries(goals)) {
      const target = g.target_stars ?? 7, minGrade = g.min_grade ?? 7;
      const stars = pink[apt] || 0;
      out[apt] = { stars, target_stars: target, projected_grade: GL[proj[apt] || 1],
        min_grade: GL[minGrade], ok: (proj[apt] || 1) >= minGrade && stars >= target };
    }
    return out;
  },

  scoreCompatibility(char, cfg, contextUids, ownOnly) {
    if (ownOnly) {
      const oa = this.ownAffinity(char);
      return [oa.score,
        [`${oa.g1_wins} G1 wins (own race record — shared-race affinity source)`,
         `${oa.relation_groups} relation groups (~${oa.relation_potential} potential relation points)`],
        { g1_wins: oa.g1_wins, relation_potential: oa.relation_potential, relation_groups: oa.relation_groups }];
    }
    const pa = this.parentAffinity(char);
    const data = { parent_affinity: pa.total, affinity_base: pa.base, affinity_races: pa.race_points,
      partner_race_max: pa.partner_max, g1_wins: char.g1_wins.length, gp_details: pa.gps };
    const reasons = [`Parent-side affinity ${pa.total} (base ${pa.base} + matched races ${pa.race_points})`,
      `${char.g1_wins.length} G1 wins available for partner race-matching (up to +${pa.partner_max})`];
    if (contextUids && contextUids.length > 1) {
      const peers = contextUids.filter(u => u !== char.uid && this.chars[u]);
      const scores = peers.map(u => this.pairAffinity(char, this.chars[u]).p1.points);
      if (scores.length) {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        data.avg_project_affinity = +avg.toFixed(1);
        reasons.push(`Average affinity with project peers (as P1): ${avg.toFixed(1)}`);
        return [0.6 * Math.min(1, avg / 180) + 0.4 * Math.min(1, pa.total / 180), reasons, data];
      }
    }
    return [0.8 * Math.min(1, pa.total / 180) + 0.2 * Math.min(1, char.g1_wins.length / 20), reasons, data];
  },

  scoreBlue(char, cfg, ownOnly) {
    // expected-value scoring: E = proc% × value → 3★=18.9, 2★=9.6, 1★=3.5 stats/inheritance
    const ev = blueEvDist(blueLists(char, ownOnly));
    const stars = ownOnly ? { ...char.summary.blue } : this.rawStarDist(char, "blue");
    const [score, data] = this.distMatch(ev, cfg.blue_targets, "blue", ownOnly ? 3 : 9, { stars });
    const reasons = [`Blue ${ownOnly ? "(own)" : "lineage"}: ${fmtDist(stars)} → expected +${data.expected_stats} stats/inheritance (3★ ≈ 5.4× 1★)`];
    const top = data.alternatives?.[0];
    if (top && Object.keys(top.missing || {}).length)
      reasons.push(`Missing vs best target: ${Object.entries(top.missing).map(([k, v]) => `${k} +${v}★`).join(", ")}`);
    if (data.concentration != null && data.concentration < 0.6 && Object.values(stars).reduce((a, b) => a + b, 0) > 3)
      reasons.push(`Blue stars are scattered (concentration ${(data.concentration * 100).toFixed(0)}%) — matched stats are far more valuable`);
    return [score, reasons, data];
  },

  scorePink(char, cfg, ownOnly) {
    const actual = ownOnly ? { ...char.summary.pink } : this.rawStarDist(char, "pink");
    let [score, data] = this.distMatch(actual, cfg.pink_targets, "pink", ownOnly ? 3 : 9);
    // pink proc is rare (2/3/5% vs blue 70/80/90%) — stacks are hard to replace, but
    // aptitude steps are deterministic from star totals, so matching stays star-based
    data.proc_chance = SPARK_TABLE.pink.proc;
    const mins = cfg.pink_min || {};
    const gateFail = {};
    for (const [k, v] of Object.entries(mins)) if ((actual[k] || 0) < v) gateFail[k] = v;
    if (Object.keys(gateFail).length) { score *= 0.5; data.minimum_failures = gateFail; }
    const reasons = [`Pink ${ownOnly ? "(own)" : "lineage"}: ${fmtDist(actual)}`];
    if (Object.keys(gateFail).length)
      reasons.push(`BELOW minimum: ${Object.entries(gateFail).map(([k, v]) => `${k} needs ${v}★`).join(", ")}`);
    if (data.concentration != null && data.concentration < 0.6 && Object.values(actual).reduce((a, b) => a + b, 0) > 3)
      reasons.push(`Pink stars are scattered (concentration ${(data.concentration * 100).toFixed(0)}%) — a matched aptitude stack is far more valuable`);
    return [score, reasons, data];
  },

  scoreGreen(char, cfg, slots) {
    const cov = this.weightedCoverage(slots, cfg);
    const targets = cfg.green_targets || [];
    if (targets.length) {
      const totalW = targets.reduce((s, t) => s + (t.weight ?? 1), 0) || 1;
      let got = 0; const hit = [], missing = [];
      for (const t of targets) {
        const ids = Object.values(this.cat.factors).filter(f => f.type === 3 && f.group === t.card_id).map(f => f.id);
        const c = Math.max(0, ...ids.map(i => cov[i] || 0));
        got += Math.min(1, c) * (t.weight ?? 1);
        const name = DB.veterans && Object.values(DB.veterans).find(v => v.card_id === t.card_id)?.name
          || this.cat.chara_names[this.cat.card_chara[t.card_id]] || String(t.card_id);
        (c > 0 ? hit : missing).push({ card_id: t.card_id, name, coverage: +c.toFixed(2) });
      }
      return [got / totalW, [`${hit.length}/${targets.length} target green sparks present`], { hit, missing }];
    }
    const s = char.summary;
    // green proc 5/10/15% is linear in stars → stars/3 is already proc-proportional
    return [Math.min(1, s.green_stars / 3), [`Own green factor: ${s.green_stars}★ (proc ${["", "5", "10", "15"][s.green_stars] || "0"}%)`],
      { green_stars: s.green_stars, proc_chance: SPARK_TABLE.green.proc }];
  },

  /* ---------- public evaluation ---------- */
  evaluate(char, objective, contextUids) {
    const cfg = objective.config, w = cfg.weights;
    // CORE & BRANCH judge the veteran's OWN record only — parents are irrelevant
    // (except pink maintenance in loop context, handled by loopVeteranScore).
    // LEAF judges the veteran + its parents (the 9★ lineage it will pass on).
    const ownOnly = objective.role === "core" || objective.role === "branch";
    const slots = ownOnly ? { self: { sparks: char.sparks, summary: char.summary } } : this.lineage(char);
    const cats = {
      white: this.scoreWhite(char, cfg, slots),
      compatibility: this.scoreCompatibility(char, cfg, contextUids, ownOnly),
      blue: this.scoreBlue(char, cfg, ownOnly),
      pink: this.scorePink(char, cfg, ownOnly),
      green: this.scoreGreen(char, cfg, slots),
    };
    const totalW = CATS.reduce((a, k) => a + (w[k] || 0), 0) || 1;
    const breakdown = {}; let total = 0; const reasons = [];
    for (const k of CATS) {
      const [score, rs, data] = cats[k];
      const points = score * (w[k] || 0) / totalW * 100;
      total += points;
      breakdown[k] = { score: +score.toFixed(3), weight: w[k] || 0, points: +points.toFixed(1), reasons: rs, data };
      if (w[k] > 0) reasons.push(...rs);
    }
    const lb = ownOnly ? { ...char.summary.blue } : this.rawStarDist(char, "blue");
    const lp = ownOnly ? { ...char.summary.pink } : this.rawStarDist(char, "pink");
    return { character_id: char.uid, objective_id: objective.id, objective_name: objective.name,
      role: objective.role, dist_scope: ownOnly ? "own" : "lineage", total: +total.toFixed(1), breakdown, reasons,
      lineage_blue: lb, lineage_pink: lp, issues: this.issues(char, objective, lb, lp, breakdown) };
  },

  /* ISSUES OVERVIEW — a veteran is fixed; these are its limitations at a glance,
     not things the user can change. Role/scope aware. */
  issues(char, objective, lb, lp, bd) {
    const out = [];
    const own = objective.role === "core" || objective.role === "branch";
    // white
    const missW = bd.white.data.targets_missing || [];
    if (missW.length) out.push(`Missing target whites: ${missW.map(m => m.name).join(", ")}`);
    if (char.summary.white_count < 8) out.push(`Few white sparks (${char.summary.white_count})`);
    // blue / pink distributions
    const bStars = this.concentration(lb), p = this.concentration(lp);
    const b = this.concentration(blueEvDist(blueLists(char, own))); // scatter judged on VALUE, not raw stars
    if (own) {
      if (bStars.total < 3) out.push(`Weak own blue (${bStars.total}★/3)`);
      if (p.total < 3) out.push(`Weak own pink (${p.total}★/3)`);
    } else {
      if (!bStars.total) out.push("No blue factors in lineage");
      else if (b.conc < 0.6) out.push(`Scattered blue (${fmtDist(lb)}) — mismatched stats`);
      else if (bStars.total < 6) out.push(`Shallow blue stack (${bStars.total}★/9)`);
      if (!p.total) out.push("No pink factors in lineage");
      else if (p.conc < 0.6) out.push(`Scattered pink (${fmtDist(lp)}) — mismatched aptitudes`);
      else if (p.total < 6) out.push(`Shallow pink stack (${p.total}★/9)`);
    }
    // targets unmet
    const bt = bd.blue.data.alternatives?.[0];
    if (bt && Object.keys(bt.missing || {}).length)
      out.push(`Blue target unmet: ${Object.entries(bt.missing).map(([k, v]) => `${k} ${v}★ short`).join(", ")}`);
    const pt = bd.pink.data.alternatives?.[0];
    if (pt && Object.keys(pt.missing || {}).length)
      out.push(`Pink target unmet: ${Object.entries(pt.missing).map(([k, v]) => `${k} ${v}★ short`).join(", ")}`);
    if (bd.pink.data.minimum_failures)
      out.push(`Below pink minimum: ${Object.entries(bd.pink.data.minimum_failures).map(([k, v]) => `${k} needs ${v}★`).join(", ")}`);
    // affinity / race record
    if (own) {
      if (char.g1_wins.length < 10) out.push(`Few G1 wins (${char.g1_wins.length}) — weak race-affinity source`);
    } else {
      const aff = bd.compatibility.data.parent_affinity;
      if (aff != null && aff < 90) out.push(`Low parent-side affinity (${aff} pts, roster median ~92)`);
    }
    return out;
  },

  parentValue(char, objective) {
    const s = char.summary, w = objective.config.weights;
    const blueEV = Object.values(blueEvDist([char.sparks.blue])).reduce((a, b) => a + b, 0);
    const parts = { blue: Math.min(1, blueEV / BLUE_EV[3]), pink: Math.min(1, s.pink_total / 3),
      white: this.whiteSelfValue(char).score, green: Math.min(1, s.green_stars / 3) };
    const tw = CATS.reduce((a, k) => a + (k in parts ? w[k] || 0 : 0), 0) || 1;
    const val = Object.entries(parts).reduce((a, [k, v]) => a + v * (w[k] || 0), 0) / tw * 100;
    return { value: +val.toFixed(1), parts, summary: s };
  },

  grandparentValue(char, objective) {
    const cfg = objective.config;
    const parents = char.ancestors.filter(a => a.role === "parent_a" || a.role === "parent_b");
    const sum = k => parents.reduce((s, a) => s + a.summary[k], 0);
    const raw = { blue: sum("blue_total"), pink: sum("pink_total"), white: sum("white_stars"), green: sum("green_stars") };
    const blueEV = Object.values(blueEvDist(parents.map(a => a.sparks.blue))).reduce((a, b) => a + b, 0);
    const whiteVal = parents.reduce((x, a) => x + this.whiteSelfValue(a).value, 0);
    // grandparent BLUE counts fully: each grandparent is rolled separately at both
    // Inspiration events, same +5/+12/+21 values as direct parents (not an estimate).
    // Pink feeds start-of-run aptitudes only; its weight remains tunable.
    const parts = { blue: Math.min(1, blueEV / (2 * BLUE_EV[3])),
      pink: Math.min(1, raw.pink / 6) * (cfg.gp_blue_weight ?? 0.5),
      white: Math.min(1, whiteVal / 16), green: Math.min(1, raw.green / 4) };
    const w = cfg.weights;
    const tw = CATS.reduce((a, k) => a + (k in parts ? w[k] || 0 : 0), 0) || 1;
    const val = Object.entries(parts).reduce((a, [k, v]) => a + v * (w[k] || 0), 0) / tw * 100;
    return { value: +val.toFixed(1), raw, note: "grandparent blue counts fully (rolled separately); white value weighted" };
  },

  rank(objective, uids) {
    const chars = uids ? uids.map(u => this.chars[u]).filter(Boolean) : this.roster;
    const ctx = uids ? chars.map(c => c.uid) : null;
    const rows = chars.map(c => {
      const ev = this.evaluate(c, objective, ctx);
      return { id: c.uid, name: c.name, card_id: c.card_id, memo: c.memo, missing: c.missing,
        total: ev.total, categories: Object.fromEntries(Object.entries(ev.breakdown).map(([k, v]) => [k, v.points])),
        lineage_blue: ev.lineage_blue, lineage_pink: ev.lineage_pink, summary: c.summary, issues: ev.issues };
    });
    rows.sort((a, b) => b.total - a.total);
    return rows;
  },

  /* Role suitability: veterans are REUSABLE in parenting — a high score under another
     objective is an additional use, never a trade-off. */
  objectiveScores(char) {
    return Store.objectives().map(o => ({ objective_id: o.id, name: o.name, role: o.role, total: this.evaluate(char, o).total }))
      .sort((a, b) => b.total - a.total);
  },

  /* ---------- simulator ---------- */
  simulate(a, b, objective, traineeCharaId) {
    const cfg = objective.config;
    const gwW = cfg.gp_white_weight ?? 0.35;
    // CORE/BRANCH: the veterans' parents' sparks are DROPPED on the offspring — only the
    // two veterans' own sparks count. LEAF: parents' lineages count again, they shape the
    // offspring's ability and its future 9★ lineage.
    const ownOnly = objective.role === "core" || objective.role === "branch";
    const comp = this.pairAffinity(a, b, traineeCharaId);
    const side = parent => {
      const gps = ownOnly ? [] : parent.ancestors.filter(x => x.role === "parent_a" || x.role === "parent_b");
      const blue = {}, pink = {};
      for (const s of [parent.summary, ...gps.map(g => g.summary)]) {
        for (const [k, v] of Object.entries(s.blue)) blue[k] = (blue[k] || 0) + v;
        for (const [k, v] of Object.entries(s.pink)) pink[k] = (pink[k] || 0) + v;
      }
      return { parent: { id: parent.uid, name: parent.name, card_id: parent.card_id },
        grandparents: gps.map(g => ({ name: g.name, card_id: g.card_id })), blue, pink };
    };
    const sideA = side(a), sideB = side(b);
    const cov = {};
    for (const src of [a, b]) {
      for (const sp of [...src.sparks.white, ...src.sparks.green, ...(src.sparks.scenario || [])]) cov[sp.id] = (cov[sp.id] || 0) + 1;
      if (!ownOnly)
        for (const g of src.ancestors)
          if (g.role === "parent_a" || g.role === "parent_b")
            for (const sp of [...g.sparks.white, ...g.sparks.green, ...(g.sparks.scenario || [])]) cov[sp.id] = (cov[sp.id] || 0) + gwW;
    }
    const wtHit = [], wtMissing = [];
    for (const t of this.whiteTargets(cfg)) {
      const group = t.factor_id > 1000 ? Math.floor(t.factor_id / 100) : t.factor_id;
      const ids = this.factorGroup[group] || [t.factor_id];
      const c = Math.max(0, ...ids.map(i => cov[i] || 0));
      const name = this.cat.factors[t.factor_id]?.name || String(t.factor_id);
      (c > 0 ? wtHit : wtMissing).push({ factor_id: t.factor_id, name, coverage: +c.toFixed(2) });
    }
    const pinkPool = {};
    for (const s of [sideA, sideB]) for (const [k, v] of Object.entries(s.pink)) pinkPool[k] = (pinkPool[k] || 0) + v;
    // Aptitude projection ALWAYS includes grandparents: pink factors from all six ancestors
    // can raise the trainee's aptitudes during its run, regardless of core/branch/leaf scope.
    const aptPinkPool = {};
    for (const src of [a, b]) {
      const sums = [src.summary, ...src.ancestors.filter(g => g.role === "parent_a" || g.role === "parent_b").map(g => g.summary)];
      for (const s of sums) for (const [k, v] of Object.entries(s.pink)) aptPinkPool[k] = (aptPinkPool[k] || 0) + v;
    }
    const aptProjection = {};
    for (const [apt, stars] of Object.entries(aptPinkPool)) aptProjection[apt] = { stars, steps: aptitudeStep(stars) };
    const blueComb = {};
    for (const s of [sideA, sideB]) for (const [k, v] of Object.entries(s.blue)) blueComb[k] = (blueComb[k] || 0) + v;
    // combined own pool maxes at 6★/stat (two 3★ factors); leaf lineage pool uses the 9★ scale
    // blue matched in expected-value space (composition-aware: 3★ ≫ 2★+1★)
    const blueCombEv = {};
    for (const src of [a, b]) {
      const lists = ownOnly ? [src.sparks.blue]
        : [src.sparks.blue, ...src.ancestors.filter(g => g.role === "parent_a" || g.role === "parent_b").map(g => g.sparks.blue)];
      const ev = blueEvDist(lists);
      for (const [k, v] of Object.entries(ev)) blueCombEv[k] = Math.round(((blueCombEv[k] || 0) + v) * 10) / 10;
    }
    const [blueScore, blueData] = this.distMatch(blueCombEv, cfg.blue_targets, "blue", ownOnly ? 6 : 9, { stars: blueComb });
    const [pinkScore, pinkData] = this.distMatch(pinkPool, cfg.pink_targets, "pink", ownOnly ? 6 : 9);
    const warnings = [];
    if (a.chara_id === b.chara_id) warnings.push("Same character — pairing impossible.");
    if (traineeCharaId && (traineeCharaId === a.chara_id || traineeCharaId === b.chara_id))
      warnings.push("Trainee is the same character as a parent — not allowed in-game.");
    if (a.chara_id !== b.chara_id && (comp.p1.rank === "△" || comp.p2.rank === "△"))
      warnings.push(`Low affinity on one side (P1 ${comp.p1.points} ${comp.p1.rank} / P2 ${comp.p2.points} ${comp.p2.rank}).`);
    if (wtMissing.length) warnings.push(`Missing target white sparks: ${wtMissing.slice(0, 6).map(m => m.name).join(", ")}`);
    // expected stat gains per inheritance event: E = proc% × value × (1 + affinity/100).
    // Blue AND white procs come from parents AND grandparents — each of the six lineage
    // umas is rolled separately at both Inspiration events (+5/+12/+21 by star level).
    const expSide = (parent, compSide) => {
      const mult = 1 + compSide.points / 100;
      const blue = {};
      let white = 0;
      const sources = [parent, ...parent.ancestors.filter(g => g.role === "parent_a" || g.role === "parent_b")];
      for (const src of sources)
        for (const sp of src.sparks.blue) blue[sp.stat] = Math.round(((blue[sp.stat] || 0) + BLUE_EV[sp.stars] * mult) * 10) / 10;
      for (const src of sources) {
        for (const w of src.sparks.white) white += (WHITE_EV[w.kind]?.[w.stars] || 0) * mult;
        for (const s of src.sparks.scenario || []) white += WHITE_EV.scenario[s.stars] * mult;
      }
      const blueTotal = Object.values(blue).reduce((x, y) => x + y, 0);
      return { name: parent.name, affinity: compSide.points, multiplier: +mult.toFixed(2),
        blue_per_stat: blue, blue_total: +blueTotal.toFixed(1), white_stats: +white.toFixed(1),
        total: +(blueTotal + white).toFixed(1) };
    };
    const egA = expSide(a, comp.p1), egB = expSide(b, comp.p2);
    const expectedGains = { a: egA, b: egB, per_event: +(egA.total + egB.total).toFixed(1),
      per_run: +(2 * (egA.total + egB.total)).toFixed(1),
      note: "E[stats] = proc% × value × (1 + affinity/100), per inheritance event (2 events/run). Blue and whites: parents AND grandparents, each rolled separately. Skill-hint value of whites not included." };
    // post-career spark creation chances for the target whites (separate from in-run procs)
    const lineageSix = [];
    for (const src of [a, b])
      lineageSix.push(src, ...src.ancestors.filter(g => g.role === "parent_a" || g.role === "parent_b"));
    const postCareer = this.postCareerChances(lineageSix, cfg);
    const roleSuggestions = [];
    for (const p of [a, b]) {
      const scores = this.objectiveScores(p);
      const here = scores.find(s => s.objective_id === objective.id)?.total || 0;
      const best = scores[0];
      if (best && best.objective_id !== objective.id && best.total - here > 15)
        roleSuggestions.push(`${p.name} also excels under '${best.name}' (${best.total} vs ${here} here) — veterans are reusable, so consider it for that role too.`);
    }
    return { parents: [sideA, sideB], compatibility: comp, scope: ownOnly ? "own" : "lineage",
      white_coverage: { hit: wtHit, missing: wtMissing, total_distinct: new Set(Object.keys(cov).map(f => Math.floor(f / 100))).size },
      aptitude_projection: aptProjection,
      blue: { score: +blueScore.toFixed(3), ...blueData }, pink: { score: +pinkScore.toFixed(3), ...pinkData },
      expected_gains: expectedGains, post_career: postCareer,
      warnings, role_suggestions: roleSuggestions,
      parent_values: {
        a: { name: a.name, parent: this.parentValue(a, objective), grandparent: this.grandparentValue(a, objective) },
        b: { name: b.name, parent: this.parentValue(b, objective), grandparent: this.grandparentValue(b, objective) } },
      estimates: [...(ownOnly ? [] : ["grandparent white weighting"]), "aptitude step mapping", "spark proc/value table (spark_table.md)", "post-career ×1.1 lineage rule (best-supported, unconfirmed)"] };
  },

  /* ---------- CORE LOOP model ----------
     A loop is defined by 3+ TARGET umas from the master DB (base aptitudes).
     Veterans are the product; their own aptitudes don't matter for looping.
     Pink maintenance only matters for run-aptitudes the targets can't cover at base. */
  loopNeeds(project) {
    const targets = (project.targets || []).map(cardId => ({
      card_id: cardId,
      chara_id: this.cat.card_chara[cardId] || Math.floor(cardId / 100),
      name: this.cat.chara_names[this.cat.card_chara[cardId]] || String(cardId),
      title: this.cat.card_titles[cardId] || "",
      base: this.cat.card_aptitudes[cardId] || null,
    }));
    const minGrade = project.apt_min_grade ?? 5;
    const needs = {};
    for (const a of project.run_aptitudes || []) {
      const perTarget = targets.map(t => {
        const base = t.base ? (t.base[a] || 1) : 1;
        const steps = Math.max(0, minGrade - base);
        return { card_id: t.card_id, name: t.name, base, steps, stars: stepsToStars(steps) };
      });
      const needsFix = perTarget.some(t => t.steps > 0);
      needs[a] = { needs_fix: needsFix, required_stars: Math.max(0, ...perTarget.map(t => t.stars)),
        per_target: perTarget, min_grade: minGrade };
    }
    return { targets, needs, min_grade: minGrade };
  },

  /* Loop suitability of a PRODUCED veteran: OWN white sparks, OWN race wins/relations,
     and pink maintenance ONLY for aptitudes that need fixing.
     Parents are ignored everywhere EXCEPT pink maintenance: the lineage pink pool
     (veteran + its parents) is what fixes the next uma's aptitudes. */
  loopVeteranScore(v, needs, whiteCfg) {
    const cfg = { gp_white_weight: 0.35, ...(whiteCfg || {}) };
    const slots = { self: { sparks: v.sparks, summary: v.summary } };
    const [white, whiteR, whiteD] = this.scoreWhite(v, cfg, slots);
    const hasWhiteTargets = this.whiteTargets(cfg).length > 0;
    const oa = this.ownAffinity(v);
    const aff = oa.score;
    const affR = [`${oa.g1_wins} G1 wins (own race record)`, `${oa.relation_groups} relation groups (~${oa.relation_potential} pts potential)`];
    const pink = this.rawStarDist(v, "pink");
    const fixApts = Object.entries(needs).filter(([, n]) => n.needs_fix);
    let pinkScore = 1, pinkR = ["No aptitudes need fixing — pink sparks irrelevant for this loop"], pinkD = { coverage: {} };
    if (fixApts.length) {
      const parts = []; pinkR = []; pinkD = { coverage: {} };
      for (const [a, n] of fixApts) {
        const stars = pink[a] || 0;
        const cov = n.required_stars ? Math.min(1, stars / n.required_stars) : 1;
        parts.push(cov);
        pinkD.coverage[a] = { stars, required: n.required_stars, ok: stars >= n.required_stars };
        pinkR.push(`${cap(a)} maintenance: ${stars}/${n.required_stars}★ lineage pool (veteran + parents — fixes the next uma)${stars < n.required_stars ? (stars === 0 ? " — NONE, loop at risk" : " — below need") : " ✓"}`);
      }
      pinkScore = parts.reduce((x, y) => x + y, 0) / parts.length;
    }
    const green = Math.min(1, v.summary.green_stars / 3);
    // when target whites are configured they dominate the loop score
    const w = hasWhiteTargets
      ? { white: 50, compatibility: 20, pink: fixApts.length ? 25 : 0, green: 5 }
      : { white: 35, compatibility: 30, pink: fixApts.length ? 25 : 0, green: 10 };
    const tw = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    const cats = { white: [white, whiteR, whiteD], compatibility: [aff, affR, { g1_wins: oa.g1_wins, relation_potential: oa.relation_potential }],
      pink: [pinkScore, pinkR, pinkD], green: [green, [`Own green ${v.summary.green_stars}★`], {}] };
    const breakdown = {}; let total = 0;
    for (const k of CATS) {
      const c = cats[k];
      if (!c) { breakdown[k] = { score: 0, weight: 0, points: 0, reasons: [], data: {} }; continue; }
      const points = c[0] * (w[k] || 0) / tw * 100;
      total += points;
      breakdown[k] = { score: +c[0].toFixed(3), weight: w[k] || 0, points: +points.toFixed(1), reasons: c[1], data: c[2] };
    }
    return { total: +total.toFixed(1), breakdown, lineage_pink: pink };
  },

  /* white target config for a loop: explicit preset on the loop wins, else the loop's
     objective (or the default core objective) supplies preset/targets */
  loopWhiteCfg(p) {
    if (p.white_preset_id) return { white_preset_id: p.white_preset_id };
    const o = (p.objective_id && Store.objective(p.objective_id)) || Store.objectives().find(x => x.role === "core");
    if (!o) return {};
    return { white_preset_id: o.config.white_preset_id, white_targets: o.config.white_targets };
  },

  loopAnalysis(pid) {
    const p = Store.project(pid);
    if (!p) return null;
    const { targets, needs, min_grade } = this.loopNeeds(p);
    const whiteCfg = this.loopWhiteCfg(p);
    const whiteTargetCount = this.whiteTargets(whiteCfg).length;
    const members = Store.members(pid);
    const rows = [], alerts = [];
    for (const m of members) {
      const v = this.chars[m.character_id];
      if (!v) { alerts.push({ level: "high", name: m.name || m.character_id, text: "veteran not in browser store" }); continue; }
      const ev = this.loopVeteranScore(v, needs, whiteCfg);
      rows.push({ member: m, character: v, evaluation: ev });
      if (v.missing) alerts.push({ level: "medium", name: v.name, character_id: v.uid, text: "not present in latest import" });
    }
    // loop-level maintenance: can ANY produced veteran supply the needed pink?
    const maintenance = {};
    for (const [a, n] of Object.entries(needs)) {
      if (!n.needs_fix) { maintenance[a] = { ...n, best: null, status: "covered" }; continue; }
      let best = 0, bestV = null;
      for (const r of rows) {
        const s = r.evaluation.lineage_pink[a] || 0;
        if (s > best) { best = s; bestV = r.character; }
      }
      const status = best >= n.required_stars ? "ok" : best > 0 ? "low" : "none";
      maintenance[a] = { ...n, best, best_veteran: bestV ? { uid: bestV.uid, name: bestV.name } : null, status };
      if (status !== "ok")
        alerts.push({ level: status === "none" ? "high" : "medium", name: p.name,
          text: `${cap(a)} maintenance: loop needs ${n.required_stars}★ (to reach ${GL[min_grade]} on weakest target) but best veteran lineage has ${best}★` });
    }
    if ((p.targets || []).length < 3)
      alerts.push({ level: "medium", name: p.name, text: `Loop has ${(p.targets || []).length} target umas — add at least 3` });
    if (!(p.run_aptitudes || []).length)
      alerts.push({ level: "medium", name: p.name, text: "No run aptitudes selected — pick the race types this loop will run" });
    const gens = {};
    rows.forEach(r => (gens[r.member.generation] ||= []).push(r.evaluation.total));
    const trend = Object.entries(gens).sort((a, b) => a[0] - b[0])
      .map(([g, vals]) => ({ generation: +g, avg_score: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1), count: vals.length }));
    // shared evaluation pool: one loopVeteranScore pass over the roster, reused by
    // supersession checks AND suggested additions
    const memberIds = new Set(members.map(m => m.character_id));
    const evPool = {};
    rows.forEach(r => { evPool[r.character.uid] = r.evaluation; });
    for (const v of this.roster) if (!evPool[v.uid]) evPool[v.uid] = this.loopVeteranScore(v, needs, whiteCfg);
    // produced veterans that might be superseded by a better replacement
    rows.forEach(r => { r.superseded = this.supersession(r.character, needs, whiteCfg, evPool, memberIds); });
    // suggested additions: untracked veterans that look like loop products
    const targetCards = new Set(p.targets || []);
    const suggestions = this.roster.filter(v => !memberIds.has(v.uid)).map(v => {
      const ev = evPool[v.uid];
      const targetMatch = targetCards.has(v.card_id);
      const reasons = [];
      if (targetMatch) reasons.push("matches a loop target uma");
      const wd = ev.breakdown.white.data;
      if (wd.targets_hit || wd.targets_missing) {
        const hit = (wd.targets_hit || []).length, miss = (wd.targets_missing || []).length;
        reasons.push(`${hit}/${hit + miss} target whites${miss ? ` (missing: ${(wd.targets_missing || []).slice(0, 3).map(x => x.name).join(", ")})` : " ✓"}`);
      } else reasons.push(`${v.summary.white_count} white (${v.summary.white_stars}★)`);
      reasons.push(`${v.g1_wins.length} G1 wins`);
      for (const [a, n] of Object.entries(needs)) {
        if (!n.needs_fix) continue;
        const s = ev.lineage_pink[a] || 0;
        if (s > 0) reasons.push(`${s}★ ${a} pink${s >= n.required_stars ? " ✓ covers need" : ""}`);
      }
      return { veteran: v, total: ev.total, target_match: targetMatch, reasons,
        sort: (targetMatch ? 1000 : 0) + ev.total };
    }).sort((a, b) => b.sort - a.sort).slice(0, 6);
    // race schedule: target G1s the loop's veterans should have run (shared wins = affinity)
    const racePreset = p.race_preset_id ? Store.racePreset(p.race_preset_id) : null;
    let schedule = null;
    if (racePreset) {
      const races = racePreset.races.map(id => this.cat.races.find(r => r.id === id)).filter(Boolean);
      const members = rows.map(r => {
        const v = r.character;
        const wonIds = new Set(v.g1_wins.map(w => w.race_id));
        const ranIds = new Set(v.raced_g1);
        return { uid: v.uid, name: v.name, card_id: v.card_id,
          won: races.filter(x => wonIds.has(x.id)).length,
          ran: races.filter(x => ranIds.has(x.id)).length,
          wonIds, ranIds };
      });
      const perRace = races.map(x => ({ race: x,
        won_by: members.filter(m => m.wonIds.has(x.id)),
        ran_by: members.filter(m => m.ranIds.has(x.id)) }));
      const sharedWins = members.length ? perRace.filter(r => r.won_by.length === members.length).length : 0;
      // aptitudes the schedule demands vs the weakest loop target's base grade
      const apts = [...new Set(races.flatMap(x => [x.ground, x.dist]))];
      const demand = apts.map(a => ({ apt: a,
        weakest: targets.length ? Math.min(...targets.map(t => t.base ? (t.base[a] || 1) : 1)) : 1 }));
      schedule = { preset: racePreset, races, per_race: perRace, members, shared_wins: sharedWins, demand };
    }
    return { project: p, targets, needs, maintenance, min_grade, rows, alerts, generation_trend: trend,
      suggestions, white_cfg: whiteCfg, white_target_count: whiteTargetCount, schedule,
      improving: trend.length >= 2 && trend[trend.length - 1].avg_score > trend[0].avg_score };
  },

  /* ---------- supersession: might a produced veteran be redundant? ----------
     STRONG: another veteran scores higher AND covers everything this loop uses —
     target whites (or own white breadth when no targets), the pink maintenance
     pool for aptitudes that need fixing, and the G1 race record (shared-race
     affinity source). Cross-card replacements must ALSO be tracked in this loop,
     lead by ≥10 points and match relation breadth — otherwise every median
     veteran would be "dominated" by the roster's best battery.
     SOFT: a NEWER run of the SAME uma scores higher — the classic loop
     replacement; white losses are listed so the call stays with the player.
     Lendable assets (others borrow it) are noted, never auto-pruned. */
  supersession(v, needs, whiteCfg, evPool, memberIds) {
    if (v.keep) return null;
    const evV = evPool[v.uid];
    if (!evV) return null;
    const fixApts = Object.entries(needs).filter(([, n]) => n.needs_fix).map(([a]) => a);
    const pinkV = this.rawStarDist(v, "pink");
    const winsV = new Set(v.g1_wins.map(w => w.race_id));
    const hasTargets = this.whiteTargets(whiteCfg).length > 0;
    const groupsOf = ev => new Set((ev.breakdown.white.data.targets_hit || []).map(h => Math.floor(h.factor_id / 100)));
    const ownWhiteGroups = x => new Set([...x.sparks.white, ...(x.sparks.scenario || [])].map(w => Math.floor(w.id / 100)));
    const groupName = g => this.cat.factors[g * 100 + 1]?.name || String(g);
    const whiteV = hasTargets ? groupsOf(evV) : null;
    const wsvV = this.whiteSelfValue(v);
    const ignored = DB.user?.supersede_ignored || [];
    let best = null;
    for (const u of this.roster) {
      if (u.uid === v.uid) continue;
      if (ignored.some(x => x.old === v.uid && x.by === u.uid)) continue;
      const evU = evPool[u.uid];
      if (!evU || evU.total <= evV.total + 0.5) continue;
      const sameCard = u.card_id === v.card_id;
      const newer = (u.register_time || "") > (v.register_time || "");
      const pinkU = this.rawStarDist(u, "pink");
      const pinkOk = fixApts.every(a => (pinkU[a] || 0) >= (pinkV[a] || 0));
      const winsU = new Set(u.g1_wins.map(w => w.race_id));
      const winsOk = [...winsV].every(id => winsU.has(id));
      let whiteOk, lostWhites = [];
      if (hasTargets) {
        const whiteU = groupsOf(evU);
        whiteOk = [...whiteV].every(g => whiteU.has(g));
        lostWhites = (evV.breakdown.white.data.targets_hit || [])
          .filter(h => !whiteU.has(Math.floor(h.factor_id / 100))).map(h => h.name);
      } else {
        const wsvU = this.whiteSelfValue(u);
        whiteOk = wsvU.value >= wsvV.value && wsvU.count >= wsvV.count;
      }
      const inLoop = memberIds ? memberIds.has(u.uid) : false;
      const strong = pinkOk && winsOk && whiteOk &&
        (sameCard || (inLoop && evU.total >= evV.total + 10 && this.relationPotential(u) >= this.relationPotential(v)));
      const soft = sameCard && newer;
      if (!strong && !soft) continue;
      if (soft && !strong && !hasTargets) {
        // list own whites the replacement would lose (group level)
        const uG = ownWhiteGroups(u);
        lostWhites = [...ownWhiteGroups(v)].filter(g => !uG.has(g)).map(groupName);
      }
      const rank = (strong ? 2 : 0) + (sameCard ? 1 : 0);
      if (!best || rank > best.rank || (rank === best.rank && evU.total > best.by_score)) {
        best = { rank, by_uid: u.uid, by_name: u.name, by_card_id: u.card_id, by_score: evU.total,
          score: evV.total, same_card: sameCard, newer, strong, in_loop: inLoop,
          lost_whites: lostWhites.slice(0, 4),
          lent_out: Math.max(0, (v.succession_num || 0) - this.childrenOf(v.uid).length) };
      }
    }
    if (best) delete best.rank;
    return best;
  },

  /* ---------- branch candidates: suggest a complementary partner ---------- */
  suggestPartners(v, limit = 3) {
    // branch context: complementarity judged on OWN sparks (parents irrelevant)
    const lb = v.summary.blue, lp = v.summary.pink;
    const topStat = Object.entries(lb).sort((a, b) => b[1] - a[1])[0]?.[0];
    const topApt = Object.entries(lp).sort((a, b) => b[1] - a[1])[0]?.[0];
    const out = [];
    for (const p of this.roster) {
      if (p.uid === v.uid || p.chara_id === v.chara_id) continue;
      const pair = this.pairAffinity(v, p);
      const plb = p.summary.blue, plp = p.summary.pink;
      const blueFit = topStat ? Math.min(1, (plb[topStat] || 0) / 3) : 0;
      const pinkFit = topApt ? Math.min(1, (plp[topApt] || 0) / 3) : 0;
      const score = pair.total + 12 * blueFit + 12 * pinkFit;
      const reasons = [`affinity ${pair.p1.points}/${pair.p2.points}`];
      if (topStat && plb[topStat]) reasons.push(`+${plb[topStat]}★ ${topStat} blue`);
      if (topApt && plp[topApt]) reasons.push(`+${plp[topApt]}★ ${topApt} pink`);
      out.push({ partner: p, affinity: pair.total, p1: pair.p1.points, p2: pair.p2.points,
        blue_fit: +blueFit.toFixed(2), pink_fit: +pinkFit.toFixed(2), score: +score.toFixed(1), reasons });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  },

  /* ---------- prune advisor: least useful veterans first ----------
     Usefulness = best value in ANY role (core product / branch / leaf, default weights)
     + small bonuses for being tracked in a project or used as a parent.
     LENDABLE ASSET: succession_num counts OTHER players borrowing your veteran too
     (e.g. 2,039 total uses vs 291 own) — external uses keep a veteran OUT of prune
     suggestions even if its own scores are mediocre.
     Veterans flagged `keep` are omitted from the advisor list. */
  usefulness(v) {
    const coreVal = this.loopVeteranScore(v, {}).total;   // white + affinity + green, no pink needs
    const branchVal = this.evaluate(v, { id: 0, name: "branch", role: "branch", config: defaultConfig("branch") }).total;
    const leafVal = this.evaluate(v, { id: 0, name: "leaf", role: "leaf", config: defaultConfig("leaf") }).total;
    const inProject = Store.characterProjects(v.uid).length > 0;
    const ownUses = this.childrenOf(v.uid).length;
    const usedParent = ownUses > 0 || Store.breedings().some(b => b.parent_a_id === v.uid || b.parent_b_id === v.uid);
    const lentOut = Math.max(0, (v.succession_num || 0) - ownUses);   // borrowed by other players
    const best = Math.max(coreVal, branchVal, leafVal);
    const total = Math.min(100, best + (inProject ? 8 : 0) + (usedParent ? 4 : 0) + Math.min(15, lentOut * 0.5));
    const role = coreVal >= branchVal && coreVal >= leafVal ? "core" : branchVal >= leafVal ? "branch" : "leaf";
    const weak = [];
    if (v.summary.white_count < 6) weak.push(`only ${v.summary.white_count} white sparks`);
    if (this.parentAffinity(v).total < 90) weak.push(`low affinity ${this.parentAffinity(v).total}`);
    const lp = this.rawStarDist(v, "pink");
    if (this.concentration(blueEvDist(blueLists(v, false))).conc < 0.5) weak.push("scattered blue");
    if (this.concentration(lp).conc < 0.5) weak.push("scattered pink");
    if (v.g1_wins.length < 10) weak.push(`only ${v.g1_wins.length} G1 wins`);
    return { total: +total.toFixed(1), core: coreVal, branch: branchVal, leaf: leafVal,
      best_role: role, in_project: inProject, used_parent: usedParent, lent_out: lentOut, weaknesses: weak };
  },

  pruneRank(includeKept = false) {
    const rows = this.roster
      .filter(v => includeKept || !v.keep)
      .map(v => ({ veteran: v, ...this.usefulness(v) }));
    rows.sort((a, b) => a.total - b.total);
    return rows;
  },

  /* ---------- best leaf per category: prioritise one pink aptitude + one blue stat ---------- */
  categoryRank(pinkApt, blueStat) {
    const rows = this.roster.map(v => {
      const lb = this.rawStarDist(v, "blue"), lp = this.rawStarDist(v, "pink");
      const pa = this.parentAffinity(v);
      const pinkStars = pinkApt ? (lp[pinkApt] || 0) : Object.values(lp).reduce((a, b) => a + b, 0);
      const blueStars = blueStat ? (lb[blueStat] || 0) : Object.values(lb).reduce((a, b) => a + b, 0);
      // blue focus scored on expected value (3★ ≈ 5.4× 1★); pink stays star-threshold based
      const lev = blueEvDist(blueLists(v, false));
      const blueEV = blueStat ? (lev[blueStat] || 0) : Object.values(lev).reduce((a, b) => a + b, 0);
      const pinkScore = Math.min(1, pinkStars / 9), blueScore = Math.min(1, blueEV / starsToBlueEV(9));
      const white = this.whiteSelfValue(v).score;
      const aff = Math.min(1, pa.total / 180);
      const total = (0.35 * pinkScore + 0.35 * blueScore + 0.15 * white + 0.15 * aff) * 100;
      return { id: v.uid, name: v.name, card_id: v.card_id, memo: v.memo, missing: v.missing,
        total: +total.toFixed(1), pink_stars: pinkStars, blue_stars: blueStars,
        lineage_blue: lb, lineage_pink: lp, white_count: v.summary.white_count,
        white_stars: v.summary.white_stars, affinity: pa.total, g1_wins: v.g1_wins.length };
    });
    rows.sort((a, b) => b.total - a.total);
    return rows;
  },

  /* ---------- project analysis ---------- */
  projectAnalysis(pid) {
    const p = Store.project(pid);
    if (!p) return null;
    const members = Store.members(pid);
    const o = (p.objective_id && Store.objective(p.objective_id)) || Store.objectives()[0];
    const uids = members.map(m => m.character_id);
    const rows = [], alerts = [];
    for (const m of members) {
      const c = this.chars[m.character_id];
      if (!c) {
        alerts.push({ character_id: m.character_id, name: m.name || m.character_id, level: "high",
          text: "veteran no longer in browser store (pruned or never imported)" });
        continue;
      }
      const ev = this.evaluate(c, o, uids);
      rows.push({ member: m, character: c, evaluation: ev,
        race_coverage: this.raceCoverage(this.projectedAptitudes(c), o.config.race_min_grade ?? 5) });
      if (c.missing) alerts.push({ character_id: c.uid, name: c.name, level: "medium", text: "not present in latest import — may be retired in-game" });
      for (const [apt, g] of Object.entries(this.aptitudeGoalStatus(c, o.config))) {
        if (g.stars < 4) alerts.push({ character_id: c.uid, name: c.name, level: "high", text: `${cap(apt)} factor coverage critical: ${g.stars}★ (goal ${g.target_stars}★)` });
        else if (!g.ok) alerts.push({ character_id: c.uid, name: c.name, level: "medium", text: `${cap(apt)} below goal: ${g.stars}/${g.target_stars}★` });
      }
      const miss = ev.breakdown.white.data.targets_missing || [];
      if (miss.length) alerts.push({ character_id: c.uid, name: c.name, level: "medium", text: `Missing white targets: ${miss.slice(0, 4).map(m => m.name).join(", ")}` });
    }
    const gens = {};
    rows.forEach(r => (gens[r.member.generation] ||= []).push(r.evaluation.total));
    const trend = Object.entries(gens).sort((a, b) => a[0] - b[0])
      .map(([g, v]) => ({ generation: +g, avg_score: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), count: v.length }));
    return { project: p, objective: o, rows, alerts, generation_trend: trend,
      improving: trend.length >= 2 && trend[trend.length - 1].avg_score > trend[0].avg_score };
  },

  dashboard() {
    const projects = Store.projects().filter(p => p.status === "active");
    const objectives = Store.objectives();
    const leafObj = objectives.find(o => o.role === "leaf") || objectives[0];
    const coreProjects = [], alerts = [], actions = [];
    for (const p of projects.filter(x => x.kind === "core")) {
      const members = Store.members(p.id);
      const an = this.loopAnalysis(p.id);
      coreProjects.push({ project: p, member_count: members.length,
        target_count: (p.targets || []).length,
        maintenance_issues: Object.values(an.maintenance).filter(m => m.needs_fix && m.status !== "ok").length });
      an.alerts.filter(a => a.level === "high").forEach(a =>
        alerts.push({ project: p.name, name: a.name, character_id: a.character_id, text: a.text }));
      // action queue: what to DO next, phrased as borrow/run recommendations
      for (const [apt, m] of Object.entries(an.maintenance)) {
        if (!m.needs_fix || m.status === "ok") continue;
        const gap = m.required_stars - (m.best || 0);
        actions.push({ prio: m.status === "none" ? 2 : 1, project_id: p.id,
          text: `${p.name} needs ${cap(apt)} pink ${m.required_stars}★ — best veteran ${m.best_veteran ? m.best_veteran.name + " has" : "has"} ${m.best || 0}★. Look for a borrow with ${gap}★+ ${cap(apt)} pink.`,
          kind: "borrow" });
      }
      if ((p.targets || []).length < 3)
        actions.push({ prio: 1, project_id: p.id, text: `${p.name}: add ${3 - (p.targets || []).length} more target uma(s) from your owned roster.`, kind: "setup" });
      if (!(p.run_aptitudes || []).length)
        actions.push({ prio: 1, project_id: p.id, text: `${p.name}: select the run aptitudes so pink maintenance can be checked.`, kind: "setup" });
    }
    actions.sort((a, b) => b.prio - a.prio);
    const branchObj = objectives.find(o => o.role === "branch") || objectives[0];
    const bestLeaves = leafObj ? this.rank(leafObj).slice(0, 10) : [];
    const branchCandidates = branchObj ? this.rank(branchObj).slice(0, 5) : [];
    const recent = Store.breedings().slice(0, 8);
    return { core_projects: coreProjects, best_leaves: bestLeaves, leaf_objective: leafObj,
      branch_candidates: branchCandidates, branch_objective: branchObj,
      recent_breedings: recent, alerts: alerts.slice(0, 20), actions: actions.slice(0, 12),
      counts: { characters: this.roster.length, objectives: objectives.length,
        missing: this.roster.filter(v => v.missing).length } };
  },
};

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function fmtDist(d) {
  const e = Object.entries(d || {});
  return e.length ? e.map(([k, v]) => `${k} ${v}★`).join(", ") : "none";
}
