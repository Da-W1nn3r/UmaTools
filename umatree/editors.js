/* Objectives view + editor, project prompts (local browser store). */

ROUTES.objectives = function (oid) {
  if (oid) return renderObjectiveEditor(+oid);
  $("#main").innerHTML = `
    <div class="section-title"><h1>Objectives</h1>
      <button class="primary" onclick="newObjective()">＋ New objective</button></div>
    <div class="panel">
      <table class="cardtable"><tr><th>Name</th><th>Role</th><th>Weights (W/C/B/P/G)</th><th>Targets</th><th></th></tr>
      ${Store.objectives().map(o => {
        const c = o.config, w = c.weights;
        return `<tr>
        <td><a href="#/objectives/${o.id}"><b>${esc(o.name)}</b></a></td>
        <td>${roleBadge(o.role)}</td>
        <td class="small">${CATS.map(k => w[k]).join(" / ")}</td>
        <td class="small muted">${c.white_preset_id ? `preset “${esc(Store.whitePreset(c.white_preset_id)?.name || "?")}”` : `${c.white_targets.length} white`} · ${c.blue_targets.length} blue · ${c.pink_targets.length} pink · ${c.green_targets.length} green</td>
        <td><button class="small" onclick="duplicateObjective(${o.id})">⧉ copy</button>
            <button class="small danger" onclick="deleteObjective(${o.id})">🗑</button></td></tr>`;
      }).join("")}</table>
      <div class="small muted" style="margin-top:8px">Same character ranks differently under different objectives — that is the point. Core loops ignore blue/pink by default; leaves demand matched distributions.</div>
    </div>
    <div class="panel">
      <div class="section-title"><h2 style="margin:0">White spark presets <span class="small muted">shared across core / branch / leaf objectives — edit once, applies everywhere</span></h2>
        <button class="primary small" onclick="editWhitePreset(null)">＋ New preset</button></div>
      ${Store.whitePresets().map(p => {
        const used = Store.objectives().filter(o => o.config.white_preset_id === p.id);
        return `<div class="list-item">
          <span><b>${esc(p.name)}</b> <span class="muted small">${p.targets.length} targets</span>
            ${used.map(o => `<span class="tag">${esc(o.name)} ${roleBadge(o.role)}</span>`).join(" ") || `<span class="muted small">not linked yet</span>`}</span>
          <span><button class="small" onclick="editWhitePreset(${p.id})">✎ edit</button>
            <button class="small danger" onclick="deleteWhitePreset(${p.id})">🗑</button></span>
        </div>`;
      }).join("") || `<div class="muted">No presets yet. Create one, then link it from any objective's white-spark section.</div>`}
    </div>
    <div class="panel">
      <div class="section-title"><h2 style="margin:0">Race schedule presets <span class="small muted">target G1s a loop's veterans should have run — shared wins = +3 affinity each</span></h2>
        <div class="row">
          <button class="small" onclick="restoreRaceDefaults()">↩ Restore defaults</button>
          <button class="primary small" onclick="editRacePreset(null)">＋ New schedule</button>
        </div></div>
      ${Store.racePresets().map(p => {
        const used = Store.projects().filter(x => x.race_preset_id === p.id);
        return `<div class="list-item">
          <span><b>${esc(p.name)}</b>
            <span class="muted small">${p.races.length} G1s</span>
            ${used.map(x => `<span class="tag">${esc(x.name)}</span>`).join(" ") || `<span class="muted small">not linked yet</span>`}</span>
          <span><button class="small" onclick="editRacePreset(${p.id})">✎ edit</button>
            <button class="small danger" onclick="deleteRacePreset(${p.id})">🗑</button></span>
        </div>`;
      }).join("") || `<div class="muted">No schedules yet — restore the All-G1s default or create your own.</div>`}
    </div>`;
};

/* ---------- race schedule preset editor ----------
   Check aptitudes to filter the G1 list. Turn / year info is shown for
   reference only — races are not treated as mutually exclusive. */
let RPE = null;
function editRacePreset(id, attachPid) {
  const p = id ? Store.racePreset(id) : null;
  RPE = p ? JSON.parse(JSON.stringify(p)) : { id: null, name: "New schedule", races: [] };
  RPE.attachPid = attachPid || null;
  RPE.filter = { turf: true, dirt: false, sprint: true, mile: true, medium: true, long: true };
  drawRPE();
}
function drawRPE() {
  if (!S.cat.races?.[0]?.years) {
    toast("Race calendar missing from catalog — hard-refresh the page (Ctrl+F5)");
    return;
  }
  // preserve typed name, list scroll and checkbox focus across full redraws
  if ($("#rpename")) RPE.name = $("#rpename").value;
  const listScroll = $("#rpelist")?.scrollTop || 0;
  const ae = document.activeElement;
  const refocus = ae?.classList?.contains("rpechk") ? `.rpechk[value="${ae.value}"]`
    : ae?.classList?.contains("rpeapt") ? `.rpeapt[value="${ae.value}"]` : null;
  const all = S.cat.races.filter(r => r.grade === "G1");
  const byId = id => all.find(r => r.id === id);
  const selected = RPE.races.map(byId).filter(Boolean);
  const shown = all.filter(r => RPE.filter[r.ground] && RPE.filter[r.dist])
    .sort((a, b) => (a.month * 2 + a.half) - (b.month * 2 + b.half) || a.id - b.id);
  const aptChk = (k, label) => `<label class="row small" style="margin:0;border:1px solid var(--line);border-radius:8px;padding:3px 8px">
    <input type="checkbox" class="rpeapt" value="${k}" ${RPE.filter[k] ? "checked" : ""}> ${label}</label>`;
  const rows = shown.map(r => {
    const on = RPE.races.includes(r.id);
    return `<label class="list-item small rpe-row ${on ? "on" : ""}" style="cursor:pointer">
      <span class="row" style="margin:0;flex:1">
        <input type="checkbox" class="rpechk" value="${r.id}" ${on ? "checked" : ""}>
        <b>${esc(r.name)}</b>
        <span class="sparkchip ${r.ground === "turf" ? "green" : "scenario"}">${r.ground}</span>
        <span class="sparkchip blue">${r.dist} ${r.distance}m</span>
        <span class="muted">${raceTurnLabel(r)} · ${r.years.join("/")}</span>
      </span></label>`;
  }).join("");
  showModal(`<h2>${RPE.id ? "Edit" : "New"} race schedule</h2>
    <div class="row">
      <div class="field" style="margin:0"><label>Name</label><input id="rpename" value="${esc(RPE.name)}" style="width:260px"></div>
      <span class="small muted">${selected.length} G1s selected</span>
    </div>
    <div class="row" style="margin:8px 0">
      <span class="small muted">Show aptitudes:</span>
      ${aptChk("turf", "turf")}${aptChk("dirt", "dirt")}${aptChk("sprint", "sprint")}${aptChk("mile", "mile")}${aptChk("medium", "medium")}${aptChk("long", "long")}
      <button class="small" id="rpeauto" title="add all shown races">⚡ Auto-fill shown</button>
      <button class="small" id="rpeclear">Clear</button>
    </div>
    <div id="rpelist" style="max-height:46vh;overflow-y:auto">${rows || `<div class="muted small">No races match the aptitude filters.</div>`}</div>
    <div class="row" style="margin-top:12px"><button class="primary" id="rpesave">💾 Save schedule</button>
      <button onclick="closeModal()">Cancel</button></div>`);
  $$(".rpeapt").forEach(c => c.onchange = () => { RPE.filter[c.value] = c.checked; drawRPE(); });
  $$(".rpechk").forEach(c => c.onchange = () => {
    const id = +c.value;
    if (c.checked) { if (!RPE.races.includes(id)) RPE.races.push(id); }
    else RPE.races = RPE.races.filter(x => x !== id);
    drawRPE();
  });
  $("#rpeauto").onclick = () => {
    RPE.races = [...new Set([...RPE.races, ...shown.map(r => r.id)])];
    drawRPE();
  };
  $("#rpeclear").onclick = () => { RPE.races = []; drawRPE(); };
  $("#rpelist").scrollTop = listScroll;
  if (refocus) $(refocus)?.focus();
  $("#rpesave").onclick = async () => {
    RPE.name = $("#rpename").value || "Schedule";
    let p;
    if (RPE.id) p = await Store.updateRacePreset(RPE.id, { name: RPE.name, races: RPE.races });
    else p = await Store.createRacePreset(RPE.name, RPE.races);
    if (RPE.attachPid && p) await Store.updateProject(RPE.attachPid, { race_preset_id: p.id });
    closeModal(); toast("Schedule saved");
    route();
  };
}
async function deleteRacePreset(id) {
  if (!confirm("Delete this schedule? Loops using it fall back to none.")) return;
  await Store.deleteRacePreset(id);
  ROUTES.objectives();
}
async function restoreRaceDefaults() {
  if (!S.cat.races?.[0]?.years) {
    toast("Race calendar missing from catalog — hard-refresh the page (Ctrl+F5)");
    return;
  }
  // upsert by name: also refreshes defaults left stale by an earlier catalog load
  let added = 0, repaired = 0;
  for (const d of defaultRacePresets(S.cat)) {
    const ex = Store.racePresets().find(p => p.name === d.name);
    if (ex) {
      if (ex.races.length !== d.races.length) {
        await Store.updateRacePreset(ex.id, { races: d.races });
        repaired++;
      }
    } else { await Store.createRacePreset(d.name, d.races); added++; }
  }
  toast(added || repaired ? `Defaults restored (${added} added, ${repaired} repaired)` : "Defaults already up to date");
  ROUTES.objectives();
}

/* ---------- white preset editor (modal) ---------- */
let WPE = null;
function editWhitePreset(id) {
  const p = id ? Store.whitePreset(id) : null;
  WPE = p ? JSON.parse(JSON.stringify(p)) : { id: null, name: "Core whites", targets: [] };
  drawWPE();
}
function drawWPE() {
  if ($("#wpname")) WPE.name = $("#wpname").value;   // keep typed name across redraws
  const wq = $("#wpsearch")?.value || "";
  const chips = WPE.targets.map((t, i) => {
    const f = S.cat.factors[t.factor_id];
    return `<span class="sparkchip white">${esc(f?.name || t.factor_id)}
      <input type="number" step="0.5" min="0.5" max="5" value="${t.weight}" style="width:48px" data-pw="${i}">
      <a tabindex="0" data-rmpw="${i}" style="cursor:pointer">✕</a></span>`;
  }).join("") || `<span class="muted small">none — search below to add</span>`;
  showModal(`<h2>${WPE.id ? "Edit" : "New"} white spark preset</h2>
    <div class="field"><label>Name</label><input id="wpname" value="${esc(WPE.name)}" style="width:280px"></div>
    <div>${chips}</div>
    <div class="row" style="margin-top:8px"><input id="wpsearch" placeholder="Search race / skill factor…" style="flex:1"></div>
    <div id="wpresults"></div>
    <div class="row" style="margin-top:12px"><button class="primary" id="wpsave">💾 Save preset</button>
      <button onclick="closeModal()">Cancel</button></div>`);
  $$("[data-pw]").forEach(inp => inp.onchange = () => WPE.targets[+inp.dataset.pw].weight = +inp.value);
  $$("[data-rmpw]").forEach(a => a.onclick = () => { WPE.targets.splice(+a.dataset.rmpw, 1); drawWPE(); });
  const ws = $("#wpsearch");
  ws.oninput = () => {
    const q = ws.value.toLowerCase().trim();
    if (!q) { $("#wpresults").innerHTML = ""; return; }
    const seen = new Set();
    const matches = Object.values(S.cat.factors).filter(f => {
      if (![4, 5].includes(f.type) || f.stars !== 1) return false;
      if (seen.has(f.group)) return false;
      seen.add(f.group);
      return f.name.toLowerCase().includes(q);
    }).slice(0, 12);
    $("#wpresults").innerHTML = matches.map(f =>
      `<div class="list-item small"><span>${esc(f.name)} <span class="tag">${f.type === 5 ? "race" : "skill"}</span></span>
       <button class="small" data-addpw="${f.id}">＋</button></div>`).join("");
    $$("[data-addpw]").forEach(b => b.onclick = () => {
      const fid = +b.dataset.addpw;
      if (!WPE.targets.some(t => Math.floor(t.factor_id / 100) === Math.floor(fid / 100)))
        WPE.targets.push({ factor_id: fid, weight: 1 });
      drawWPE();
    });
  };
  if (wq) { $("#wpsearch").value = wq; $("#wpsearch").dispatchEvent(new Event("input")); }
  $("#wpsave").onclick = async () => {
    WPE.name = $("#wpname").value || "Preset";
    if (WPE.id) await Store.updateWhitePreset(WPE.id, { name: WPE.name, targets: WPE.targets });
    else await Store.createWhitePreset(WPE.name, WPE.targets);
    closeModal(); toast("Preset saved — linked objectives updated");
    route();
  };
}
async function deleteWhitePreset(id) {
  if (!confirm("Delete this preset? Linked objectives fall back to their own white targets.")) return;
  await Store.deleteWhitePreset(id);
  ROUTES.objectives();
}

async function newObjective() {
  formModal("New objective", `
    <div class="field"><label>Name</label><input id="noname" value="New Objective" style="width:260px"></div>
    <div class="field"><label>Role</label><select id="norole">
      ${["core", "branch", "leaf"].map(r => `<option ${r === "branch" ? "selected" : ""}>${r}</option>`).join("")}
    </select></div>`, "Create objective", async () => {
    const name = $("#noname").value.trim();
    if (!name) { toast("Enter a name"); return false; }
    const o = await Store.createObjective(name, $("#norole").value, {});
    location.hash = `#/objectives/${o.id}`;
  });
}
async function duplicateObjective(id) {
  const o = Store.objective(id);
  const n = await Store.createObjective(o.name + " (copy)", o.role, JSON.parse(JSON.stringify(o.config)));
  location.hash = `#/objectives/${n.id}`;
}
async function deleteObjective(id) {
  if (!confirm("Delete this objective?")) return;
  await Store.deleteObjective(id);
  ROUTES.objectives();
}

/* ---------- objective editor ---------- */
let OE = null;
function renderObjectiveEditor(oid) {
  const o = Store.objective(oid);
  if (!o) { location.hash = "#/objectives"; return; }
  OE = JSON.parse(JSON.stringify(o));
  drawOE();
}

function drawOE() {
  // keep typed name/role and the white search query across full redraws
  if ($("#oename")) { OE.name = $("#oename").value; OE.role = $("#oerole").value; }
  const owq = $("#oewsearch")?.value || "";
  const c = OE.config;
  const charaName = {};
  for (const [cardId, charaId] of Object.entries(S.cat.card_chara))
    charaName[cardId] = S.cat.chara_names[charaId] || cardId;
  const weightRow = k => `<div class="row field"><label style="width:110px;margin:0">${k}</label>
    <input type="range" min="0" max="50" value="${c.weights[k]}" data-w="${k}">
    <b data-wv="${k}">${c.weights[k]}</b></div>`;
  const distInputs = (t, kind, keys, idx) => keys.map(k =>
    `<label class="small" style="display:inline-block;margin-right:4px">${k}<br>
     <input type="number" min="0" max="9" value="${t.dist[k] || 0}" style="width:46px"
       data-dist="${kind}:${idx}:${k}"></label>`).join("");
  $("#main").innerHTML = `
    <div class="section-title"><h1>Edit Objective</h1><a href="#/objectives">← all objectives</a></div>
    <div class="panel">
      <div class="row">
        <div><label>Name</label><input id="oename" value="${esc(OE.name)}" style="width:260px"></div>
        <div><label>Role</label><select id="oerole">${["core", "branch", "leaf"].map(r => `<option ${OE.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
        <button class="primary" id="oesave" style="align-self:flex-end">💾 Save</button>
      </div>
    </div>
    <div class="grid cols2">
      <div class="panel"><h3 style="margin-top:0">Category weights</h3>
        <div class="weights-grid">${CATS.map(weightRow).join("")}</div>
        <div class="field row"><label style="width:200px;margin:0" title="Grandparent blue counts fully (rolled separately at both Inspiration events) — this weight now only scales the pink part">Grandparent pink weight</label>
          <input type="number" step="0.05" min="0" max="1" value="${c.gp_blue_weight}" id="oegpb" style="width:70px"></div>
        <div class="field row"><label style="width:200px;margin:0">Grandparent white/green weight <span class="est">(est.)</span></label>
          <input type="number" step="0.05" min="0" max="1" value="${c.gp_white_weight}" id="oegpw" style="width:70px"></div>
      </div>
      <div class="panel"><h3 style="margin-top:0">Scoring model</h3>
        <ul class="reason-list">
          <li><b>Aptitude is not scored</b> — a veteran's aptitudes are fixed and irrelevant to its breeding value.
            Aptitude maintenance is handled by core loops (run-aptitudes + pink pool), not objectives.</li>
          <li><b>Race access is not scored separately</b> — G1 wins already feed the compatibility category.</li>
          <li><b>Core &amp; branch</b> judge the veteran's own record only; <b>leaf</b> judges the veteran + its parents (9★ lineage).</li>
          <li>Matched (concentrated) spark distributions beat scattered ones; off-target stars are penalised.</li>
        </ul>
      </div>
    </div>
    <div class="grid cols2">
      <div class="panel"><h3 style="margin-top:0">Blue spark targets <span class="small muted">(alternative acceptable outcomes; self+parents, max 9★/stat)</span></h3>
        ${c.blue_targets.map((t, i) => `<div class="tree-node">
          ${distInputs(t, "blue", STATS, i)}
          <label class="small" style="display:inline-block">weight <input type="number" step="0.1" min="0" max="1" value="${t.weight}" style="width:56px" data-tw="blue:${i}"></label>
          <button class="small danger" data-rmt="blue:${i}">✕</button></div>`).join("")}
        <button class="small" id="addblue">＋ Add outcome (e.g. 9 Speed, or 6 Speed + 3 Power)</button>
      </div>
      <div class="panel"><h3 style="margin-top:0">Pink spark targets <span class="small muted">(per intended recipient)</span></h3>
        ${c.pink_targets.map((t, i) => `<div class="tree-node">
          ${distInputs(t, "pink", APTS, i)}
          <label class="small" style="display:inline-block">weight <input type="number" step="0.1" min="0" max="1" value="${t.weight}" style="width:56px" data-tw="pink:${i}"></label>
          <button class="small danger" data-rmt="pink:${i}">✕</button></div>`).join("")}
        <button class="small" id="addpink">＋ Add outcome (e.g. 9 Mile, or 6 Mile + 1 End)</button>
        <h3>Hard minimums (halves pink score if unmet)</h3>
        <div>${APTS.map(a => `<label class="small" style="display:inline-block;margin-right:4px">${a}<br>
          <input type="number" min="0" max="9" value="${c.pink_min[a] || 0}" style="width:46px" data-pmin="${a}"></label>`).join("")}</div>
      </div>
    </div>
    <div class="grid cols2">
      <div class="panel"><h3 style="margin-top:0">White spark targets</h3>
        <div class="field"><label>Shared preset (applies to every objective linked to it)</label>
          <select id="oewpreset">
            <option value="">custom (this objective only)</option>
            ${Store.whitePresets().map(p => `<option value="${p.id}" ${c.white_preset_id === p.id ? "selected" : ""}>${esc(p.name)} (${p.targets.length})</option>`).join("")}
          </select>
          ${c.white_preset_id ? `<button class="small" id="oeweditpreset">✎ edit preset</button>` : ""}</div>
        ${c.white_preset_id ? `
          <div>${(Store.whitePreset(c.white_preset_id)?.targets || []).map(t =>
            `<span class="sparkchip white">${esc(S.cat.factors[t.factor_id]?.name || t.factor_id)} w${t.weight}</span>`).join("") || `<span class="muted small">preset is empty</span>`}</div>
          <div class="small muted" style="margin-top:6px">Targets come from the shared preset. Switch to custom to detach.</div>
        ` : `
          <div id="oewhite">${c.white_targets.map((t, i) => {
            const f = S.cat.factors[t.factor_id];
            return `<span class="sparkchip white">${esc(f?.name || t.factor_id)}
              <input type="number" step="0.5" min="0.5" max="5" value="${t.weight}" style="width:48px" data-ww="${i}">
              <a tabindex="0" data-rmw="${i}" style="cursor:pointer">✕</a></span>`;
          }).join("") || `<span class="muted small">none</span>`}</div>
          <div class="row" style="margin-top:8px">
            <input id="oewsearch" placeholder="Search race / skill factor…" style="flex:1">
          </div>
          <div id="oewresults"></div>
        `}
      </div>
      <div class="panel"><h3 style="margin-top:0">Green spark targets (character uniques)</h3>
        <div>${c.green_targets.map((t, i) => `<span class="sparkchip green">${esc(charaName[t.card_id] || t.card_id)}
          <input type="number" step="0.5" min="0.5" max="5" value="${t.weight}" style="width:48px" data-gw="${i}">
          <a tabindex="0" data-rmg="${i}" style="cursor:pointer">✕</a></span>`).join("") || `<span class="muted small">none</span>`}</div>
        <div class="row" style="margin-top:8px"><select id="oegsel"></select>
          <button class="small" id="oegadd">＋ Add</button></div>
      </div>
    </div>`;

  /* bindings */
  $$("[data-w]").forEach(inp => inp.oninput = () => {
    c.weights[inp.dataset.w] = +inp.value;
    $(`[data-wv="${inp.dataset.w}"]`).textContent = inp.value;
  });
  $$("[data-dist]").forEach(inp => inp.onchange = () => {
    const [kind, i, k] = inp.dataset.dist.split(":");
    const t = c[kind + "_targets"][+i];
    const v = +inp.value;
    if (v > 0) t.dist[k] = v; else delete t.dist[k];
  });
  $$("[data-tw]").forEach(inp => inp.onchange = () => {
    const [kind, i] = inp.dataset.tw.split(":");
    c[kind + "_targets"][+i].weight = +inp.value;
  });
  $$("[data-rmt]").forEach(b => b.onclick = () => {
    const [kind, i] = b.dataset.rmt.split(":");
    c[kind + "_targets"].splice(+i, 1); drawOE();
  });
  $("#addblue").onclick = () => { c.blue_targets.push({ dist: { speed: 9 }, weight: 1 }); drawOE(); };
  $("#addpink").onclick = () => { c.pink_targets.push({ dist: { mile: 9 }, weight: 1 }); drawOE(); };
  $$("[data-pmin]").forEach(inp => inp.onchange = () => {
    const v = +inp.value;
    if (v > 0) c.pink_min[inp.dataset.pmin] = v; else delete c.pink_min[inp.dataset.pmin];
  });
  $$("[data-ww]").forEach(inp => inp.onchange = () => c.white_targets[+inp.dataset.ww].weight = +inp.value);
  $$("[data-rmw]").forEach(a => a.onclick = () => { c.white_targets.splice(+a.dataset.rmw, 1); drawOE(); });
  $$("[data-gw]").forEach(inp => inp.onchange = () => c.green_targets[+inp.dataset.gw].weight = +inp.value);
  $$("[data-rmg]").forEach(a => a.onclick = () => { c.green_targets.splice(+a.dataset.rmg, 1); drawOE(); });
  $("#oewpreset").onchange = () => {
    const v = +$("#oewpreset").value;
    if (v) c.white_preset_id = v; else delete c.white_preset_id;
    drawOE();
  };
  const ep = $("#oeweditpreset");
  if (ep) ep.onclick = () => editWhitePreset(c.white_preset_id);
  const wsearch = $("#oewsearch");
  if (wsearch) wsearch.oninput = () => {
    const q = wsearch.value.toLowerCase().trim();
    if (!q) { $("#oewresults").innerHTML = ""; return; }
    const seen = new Set();
    const matches = Object.values(S.cat.factors).filter(f => {
      if (![4, 5].includes(f.type) || f.stars !== 1) return false;
      if (seen.has(f.group)) return false;
      seen.add(f.group);
      return f.name.toLowerCase().includes(q);
    }).slice(0, 12);
    $("#oewresults").innerHTML = matches.map(f =>
      `<div class="list-item small"><span>${esc(f.name)} <span class="tag">${f.type === 5 ? "race" : "skill"}</span></span>
       <button class="small" data-addw="${f.id}">＋</button></div>`).join("");
    $$("[data-addw]").forEach(b => b.onclick = () => {
      c.white_targets.push({ factor_id: +b.dataset.addw, weight: 1 }); drawOE();
    });
  };
  const gsel = $("#oegsel");
  const greenGroups = [...new Set(Object.values(S.cat.factors).filter(f => f.type === 3).map(f => f.group))];
  gsel.innerHTML = greenGroups.map(cardId =>
    `<option value="${cardId}">${esc(charaName[cardId] || cardId)}</option>`).join("");
  $("#oegadd").onclick = () => {
    const cardId = +gsel.value;
    if (!c.green_targets.some(t => t.card_id === cardId)) c.green_targets.push({ card_id: cardId, weight: 1 });
    drawOE();
  };
  if (owq && $("#oewsearch")) { $("#oewsearch").value = owq; $("#oewsearch").dispatchEvent(new Event("input")); }
  $("#oesave").onclick = async () => {
    OE.name = $("#oename").value; OE.role = $("#oerole").value;
    c.gp_blue_weight = +$("#oegpb").value; c.gp_white_weight = +$("#oegpw").value;
    delete c.weights.aptitude; delete c.weights.race;
    await Store.updateObjective(OE.id, { name: OE.name, role: OE.role, config: c });
    toast("Objective saved");
  };
}

/* ---------- project prompts ---------- */
async function newProjectPrompt(kind) {
  formModal(kind === "core" ? "New core loop" : "New branch", `
    <div class="field"><label>Name</label>
    <input id="npname" value="${kind === "core" ? "Core Loop A" : "New Branch"}" style="width:260px"></div>`, "Create", async () => {
    const name = $("#npname").value.trim();
    if (!name) { toast("Enter a name"); return false; }
    const defObj = Store.objectives().find(o => o.role === (kind === "core" ? "core" : "branch"));
    const p = await Store.createProject({ name, kind, objective_id: defObj?.id });
    location.hash = `#/projects/${p.id}`;
  });
}

async function editProjectPrompt(pid) {
  const p = Store.project(pid);
  formModal("Edit project", `
    <div class="field"><label>Name</label><input id="epname" value="${esc(p.name)}" style="width:260px"></div>
    <div class="field"><label>Objective</label><select id="epobj">
      <option value="">none</option>
      ${Store.objectives().map(o => `<option value="${o.id}" ${p.objective_id === o.id ? "selected" : ""}>${esc(o.name)} (${o.role})</option>`).join("")}
    </select></div>
    <div class="field"><label>Notes</label><input id="epnotes" value="${esc(p.notes || "")}" style="width:100%"></div>`,
    "Save", async () => {
      const name = $("#epname").value.trim();
      if (!name) { toast("Enter a name"); return false; }
      await Store.updateProject(pid, { name, objective_id: +$("#epobj").value || null, notes: $("#epnotes").value });
      toast("Project updated");
      rerender(() => renderProjectDetail(pid));
    });
}

async function addToProjectPrompt(uid, pid) {
  if (!Store.projects().length) { toast("Create a project first"); return; }
  if (!uid) {
    showModal(`<h2>Add character to ${esc(Store.project(pid)?.name || "")}</h2>
      <div id="addpick"></div>
      <div class="row" style="margin-top:10px">
        <div><label>Role</label><select id="addrole">${["core", "branch", "leaf", "archived"].map(r => `<option>${r}</option>`).join("")}</select></div>
        <div><label>Generation</label><input id="addgen" type="number" value="0" style="width:70px"></div>
        <button class="primary" id="addgo" style="align-self:flex-end">Add</button>
      </div>`);
    mountPicker($("#addpick"), "addC");
    $("#addgo").onclick = async () => {
      if (!PICKS.addC) { toast("Pick a character"); return; }
      await Store.addMember(pid, PICKS.addC, $("#addrole").value, +$("#addgen").value || 0, "");
      closeModal(); toast("Added to project");
      renderProjectDetail(pid);
    };
    return;
  }
  formModal(`Add ${esc(DB.veterans[uid]?.name || "character")} to a project`, `
    <div class="field"><label>Project</label><select id="approj">
      ${Store.projects().map(p => `<option value="${p.id}">${esc(p.name)} (${p.kind})</option>`).join("")}
    </select></div>
    <div class="row">
      <div><label>Role</label><select id="aprole">${["core", "branch", "leaf", "archived"].map(r => `<option>${r}</option>`).join("")}</select></div>
      <div><label>Generation</label><input id="apgen" type="number" value="0" style="width:70px"></div>
    </div>`, "＋ Add", async () => {
      await Store.addMember(+$("#approj").value, uid, $("#aprole").value, +$("#apgen").value || 0, "");
      toast("Added to project");
    });
}

async function createBranchPrompt(uid, fromPid) {
  const c = DB.veterans[uid];
  formModal(`New branch from ${esc(c.name)}`, `
    <div class="field"><label>Branch name</label>
    <input id="cbname" value="${esc(c.name)} branch" style="width:260px"></div>`, "Create branch", async () => {
    const name = $("#cbname").value.trim();
    if (!name) { toast("Enter a name"); return false; }
    const defObj = Store.objectives().find(o => o.role === "branch");
    const p = await Store.createProject({
      name, kind: "branch", objective_id: defObj?.id,
      parent_project_id: fromPid || null, origin_character_id: uid,
    });
    await Store.addMember(p.id, uid, "branch", 0, "");
    toast("Branch created");
    location.hash = `#/projects/${p.id}`;
  });
}
