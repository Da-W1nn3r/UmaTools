/* IndexedDB persistence. Veterans keyed by stable uid (card_id + register_time),
   NOT trained_chara_id (which may change between extractions).
   User data (objectives/projects/members/breedings) stored as one kv record. */
const DB = {
  db: null,
  veterans: {},          // uid -> parsed veteran (includes .raw)
  user: null,            // {objectives, projects, members, breedings, seq}

  open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open("uma_tree", 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("veterans")) d.createObjectStore("veterans", { keyPath: "uid" });
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      };
      req.onsuccess = () => { this.db = req.result; res(); };
      req.onerror = () => rej(req.error);
    });
  },

  tx(store, mode) { return this.db.transaction(store, mode).objectStore(store); },

  async load() {
    await this.open();
    this.veterans = {};
    await new Promise((res, rej) => {
      const cur = this.tx("veterans", "readonly").openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) { this.veterans[c.value.uid] = c.value; c.continue(); } else res();
      };
      cur.onerror = () => rej(cur.error);
    });
    this.user = await new Promise((res, rej) => {
      const r = this.tx("kv", "readonly").get("userdata");
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
    if (!this.user) {
      this.user = { objectives: [], projects: [], members: [], breedings: [], seq: 1, version: 3 };
      seedObjectives(this.user);
      await this.saveUser();
    }
    this.user.white_presets ||= [];
    if ((this.user.version || 1) < 2) {
      // migrate seeded objectives to the loop-centric model
      for (const o of this.user.objectives) {
        if (o.name === "Branch Default") o.config.weights = { ...DEFAULT_WEIGHTS.branch };
        if (o.name === "Leaf Default") o.config.weights = { ...DEFAULT_WEIGHTS.leaf };
      }
      this.user.version = 2;
      await this.saveUser();
    }
    // owned roster: null = not configured (fall back to cards behind your veterans)
    this.user.owned_cards ||= null;         // [card_id] — target picker restricts to these
    this.user.owned_source ||= null;        // 'card_data' | 'manual'
    this.user.borrow_cards ||= null;        // [card_id] — if card_data.json was a borrow list
    if ((this.user.version || 1) < 3) {
      // drop aptitude/race weights from every objective; fall back to role defaults if empty
      for (const o of this.user.objectives) {
        delete o.config.weights.aptitude;
        delete o.config.weights.race;
        const sum = Object.values(o.config.weights).reduce((a, b) => a + (b || 0), 0);
        if (!sum) o.config.weights = { ...DEFAULT_WEIGHTS[o.role] || DEFAULT_WEIGHTS.core };
      }
      this.user.version = 3;
      await this.saveUser();
    }
    if ((this.user.version || 1) < 4) {
      // lineage is now auto-derived from ancestor snapshots (linkLineage in parse.js);
      // manual breeding records are kept as optional cross-references.
      this.user.version = 4;
      await this.saveUser();
    }
    this.user.race_presets ||= [];
    this.user.supersede_ignored ||= [];   // [{old, by}] — dismissed supersession suggestions
    if ((this.user.version || 1) < 5) { this.user.version = 5; await this.saveUser(); }
    // seed the default race schedule (All G1s). Flag-based, NOT version-gated:
    // if an earlier load ran with a stale cached catalog (no race timing), seeding was
    // impossible then — retry on every load until the catalog actually carries timing.
    if (!this.user.race_defaults_seeded && typeof S !== "undefined" && S.cat?.races?.[0]?.years) {
      if (!this.user.race_presets.length)
        for (const d of defaultRacePresets(S.cat))
          this.user.race_presets.push({ id: this.user.seq++, ...d });
      this.user.race_defaults_seeded = true;
      await this.saveUser();
    }
    // legacy cleanup: the filly-only flag was retired (G1s are not restricted by
    // character and same-turn races have exceptions) — strip it from saved schedules.
    if (this.user.race_presets.some(p => "filly_only" in p)) {
      for (const p of this.user.race_presets) delete p.filly_only;
      await this.saveUser();
    }
  },

  saveUser() {
    return new Promise((res, rej) => {
      const r = this.tx("kv", "readwrite").put(this.user, "userdata");
      r.onsuccess = res; r.onerror = () => rej(r.error);
    });
  },

  saveVeterans(list) {
    return new Promise((res, rej) => {
      const t = this.db.transaction("veterans", "readwrite");
      const s = t.objectStore("veterans");
      list.forEach(v => { s.put(v); this.veterans[v.uid] = v; });
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  },

  deleteVeterans(uids) {
    return new Promise((res, rej) => {
      const t = this.db.transaction("veterans", "readwrite");
      const s = t.objectStore("veterans");
      uids.forEach(u => { s.delete(u); delete this.veterans[u]; });
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  },

  nextId() { return this.user.seq++; },

  /* ---------- full backup / restore ----------
     Raw veterans + ALL user data (loops, objectives, presets, history, owned roster).
     Without this, clearing browser data loses everything except the source JSON. */
  fullBackup() {
    return { format: "uma_tree_backup", version: 1, exported_at: new Date().toISOString(),
      veterans: Object.values(this.veterans).map(v => v.raw), user: this.user };
  },
  async restoreBackup(obj) {
    if (!obj || obj.format !== "uma_tree_backup" || !Array.isArray(obj.veterans) || !obj.user)
      throw new Error("Not an UmaTree backup file");
    await importVeterans(obj.veterans, S.cat);
    this.user = obj.user;
    this.user.white_presets ||= [];
    await this.saveUser();
  },
};

/* Effective owned-card set: explicit roster > cards behind your veterans (fallback). */
function ownedCardIds() {
  if (DB.user?.owned_cards?.length) return new Set(DB.user.owned_cards);
  return new Set(Object.values(DB.veterans).map(v => v.card_id));
}
function ownedSourceLabel() {
  if (DB.user?.owned_cards?.length)
    return DB.user.owned_source === "card_data" ? "imported card_data.json" : "manual selection";
  return "fallback: cards behind your veterans";
}

/* ---------- default objectives (role-specific) ---------- */
/* aptitude & race are NOT scored categories: veteran aptitudes are fixed/irrelevant,
   and race wins already feed compatibility. */
const DEFAULT_WEIGHTS = {
  core:   { white: 55, compatibility: 35, blue: 0, pink: 0, green: 10 },
  branch: { white: 25, compatibility: 25, blue: 25, pink: 25, green: 0 },
  leaf:   { white: 25, compatibility: 15, blue: 25, pink: 30, green: 5 },
};
function defaultConfig(role) {
  return {
    weights: { ...(DEFAULT_WEIGHTS[role] || DEFAULT_WEIGHTS.core) },
    white_targets: [], blue_targets: [], pink_targets: [], pink_min: {},
    green_targets: [], aptitude_goals: {},
    race_min_grade: 5, gp_blue_weight: 0.5, gp_white_weight: 0.35,
  };
}
function seedObjectives(user) {
  for (const [role, name] of [["core", "Core Loop Default"], ["branch", "Branch Default"], ["leaf", "Leaf Default"]]) {
    user.objectives.push({ id: user.seq++, name, role, config: defaultConfig(role) });
  }
}

/* ---------- user-data CRUD (mirrors the old server API, local) ---------- */
const Store = {
  get u() { return DB.user; },
  save() { return DB.saveUser(); },

  objectives() { return this.u.objectives; },
  objective(id) { return this.u.objectives.find(o => o.id === +id); },
  async createObjective(name, role, config) {
    const o = { id: DB.nextId(), name, role, config: { ...defaultConfig(role), ...config } };
    this.u.objectives.push(o); await this.save(); return o;
  },
  async updateObjective(id, patch) {
    const o = this.objective(id); if (!o) return null;
    Object.assign(o, patch); await this.save(); return o;
  },
  async deleteObjective(id) {
    this.u.objectives = this.u.objectives.filter(o => o.id !== +id);
    this.u.projects.forEach(p => { if (p.objective_id === +id) p.objective_id = null; });
    await this.save();
  },

  projects() { return this.u.projects; },
  project(id) { return this.u.projects.find(p => p.id === +id); },
  async createProject(d) {
    const p = { id: DB.nextId(), name: d.name || "Untitled", kind: d.kind || "core", status: "active",
      parent_project_id: d.parent_project_id || null, origin_character_id: d.origin_character_id || null,
      objective_id: d.objective_id || null, notes: d.notes || "", created_at: new Date().toISOString(),
      // core-loop model: target umas from the master DB (card ids), aptitudes to run, min grade
      targets: d.targets || [], run_aptitudes: d.run_aptitudes || [], apt_min_grade: d.apt_min_grade ?? 5,
      race_preset_id: d.race_preset_id || null };
    this.u.projects.push(p); await this.save(); return p;
  },
  async updateProject(id, patch) {
    const p = this.project(id); if (!p) return null;
    Object.assign(p, patch); await this.save(); return p;
  },
  async deleteProject(id) {
    this.u.projects = this.u.projects.filter(p => p.id !== +id);
    this.u.members = this.u.members.filter(m => m.project_id !== +id);
    this.u.breedings.forEach(b => { if (b.project_id === +id) b.project_id = null; });
    await this.save();
  },

  members(pid) { return this.u.members.filter(m => m.project_id === +pid); },
  allMembers() { return this.u.members; },
  characterProjects(uid) {
    return this.u.members.filter(m => m.character_id === uid).map(m => ({
      ...m, project_name: this.project(m.project_id)?.name, project_kind: this.project(m.project_id)?.kind }));
  },
  async addMember(pid, uid, role, generation, notes) {
    const v = DB.veterans[uid];
    const ex = this.u.members.find(m => m.project_id === +pid && m.character_id === uid);
    if (ex) Object.assign(ex, { role, generation, notes: notes || ex.notes });
    else this.u.members.push({ project_id: +pid, character_id: uid, role: role || "core",
      generation: generation || 0, notes: notes || "", name: v ? v.name : uid, added_at: new Date().toISOString() });
    await this.save();
  },
  async removeMember(pid, uid) {
    this.u.members = this.u.members.filter(m => !(m.project_id === +pid && m.character_id === uid));
    await this.save();
  },

  /* ---- shared white spark presets (referenced by objectives across roles) ---- */
  whitePresets() { return this.u.white_presets; },
  whitePreset(id) { return this.u.white_presets.find(p => p.id === +id); },
  async createWhitePreset(name, targets) {
    const p = { id: DB.nextId(), name: name || "Preset", targets: targets || [] };
    this.u.white_presets.push(p); await this.save(); return p;
  },
  async updateWhitePreset(id, patch) {
    const p = this.whitePreset(id); if (!p) return null;
    Object.assign(p, patch); await this.save(); return p;
  },
  async deleteWhitePreset(id) {
    this.u.white_presets = this.u.white_presets.filter(p => p.id !== +id);
    this.u.objectives.forEach(o => { if (o.config.white_preset_id === +id) delete o.config.white_preset_id; });
    await this.save();
  },

  /* ---- race schedule presets (target G1s for loop veterans; shared wins = affinity) ---- */
  racePresets() { return this.u.race_presets; },
  racePreset(id) { return this.u.race_presets.find(p => p.id === +id); },
  async createRacePreset(name, races) {
    const p = { id: DB.nextId(), name: name || "Schedule", races: races || [] };
    this.u.race_presets.push(p); await this.save(); return p;
  },
  async updateRacePreset(id, patch) {
    const p = this.racePreset(id); if (!p) return null;
    Object.assign(p, patch); await this.save(); return p;
  },
  async deleteRacePreset(id) {
    this.u.race_presets = this.u.race_presets.filter(p => p.id !== +id);
    this.u.projects.forEach(p => { if (p.race_preset_id === +id) p.race_preset_id = null; });
    await this.save();
  },

  /* dismissed supersession suggestions (pair-level: ignoring one candidate lets the
     next-best surface, if any) */
  async ignoreSupersede(oldUid, byUid) {
    this.u.supersede_ignored ||= [];
    if (!this.u.supersede_ignored.some(x => x.old === oldUid && x.by === byUid))
      this.u.supersede_ignored.push({ old: oldUid, by: byUid });
    await this.save();
  },

  breedings() { return [...this.u.breedings].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id); },
  async addBreeding(d) {
    // snapshot names so history survives pruning / re-import with changed ids
    const nm = uid => DB.veterans[uid]?.name || uid;
    const b = { id: DB.nextId(), parent_a_id: d.parent_a_id, parent_b_id: d.parent_b_id,
      offspring_id: d.offspring_id || null, project_id: d.project_id || null,
      generation: d.generation || 0, date: d.date || new Date().toISOString().slice(0, 10),
      notes: d.notes || "", parent_a_name: nm(d.parent_a_id), parent_b_name: nm(d.parent_b_id),
      offspring_name: d.offspring_id ? nm(d.offspring_id) : null };
    this.u.breedings.push(b); await this.save(); return b;
  },
  async deleteBreeding(id) {
    this.u.breedings = this.u.breedings.filter(b => b.id !== +id); await this.save();
  },
};
