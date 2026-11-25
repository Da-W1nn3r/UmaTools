/* Data (multi-file import, owned roster, backup/prune), Loops, Projects,
   Run Planner (simulator + post-career chances + borrow rec), History,
   Lineage Tree and Borrows. */

/* ---------- Data management ---------- */
let pruneLimit = 120, storeLimit = 400;   // "show more" caps for the two big tables
ROUTES.manage = function () {
  const vets = Object.values(DB.veterans).sort((a, b) => (b.register_time || "").localeCompare(a.register_time || ""));
  const missing = vets.filter(v => v.missing);
  pruneLimit = 120; storeLimit = 400;
  $("#main").innerHTML = `
    <h1>Data — Import, Backup &amp; Prune</h1>
    <div class="panel">
      <h3 style="margin-top:0">Import — drop ALL extractor files at once</h3>
      <p class="small muted">Drop the files <a href="https://werseter.github.io/umadump/" target="_blank" rel="noopener">UmaDump ↗</a> produced.
      Recognised automatically: <code>trained_chara_data.json</code> → veterans · <code>card_data.json</code> → your owned umas (target picker) ·
      an Uma Tree backup → full restore. Other files are reported and skipped. Everything is parsed in your browser
      and stored locally (IndexedDB) — nothing is uploaded.</p>
      ${gameFilesHelp()}
      <details class="small muted"><summary>How re-imports merge</summary>
        <p>Re-importing merges by stable identity (card + registration time); veterans absent from a new import are
        flagged <span class="badge archived">missing</span> and kept until you prune them.
        Lineage links and borrowed parents are re-derived on every import.</p></details>
      <div id="dropzone" class="dropzone">
        <input type="file" id="fileinp" accept=".json,application/json" multiple style="display:none">
        <button class="primary" onclick="document.getElementById('fileinp').click()">📥 Choose JSON file(s)</button>
        <span class="muted">or drop them here</span>
      </div>
      <div id="importreport">${S.importReport || ""}</div>
    </div>
    <div class="panel">
      <div class="section-title"><h3 style="margin:0">Owned umas <span class="small muted">${DB.user.owned_cards?.length || ownedCardIds().size} cards · source: ${ownedSourceLabel()}</span></h3>
        <div class="row">
          ${DB.user.owned_cards?.length ? `<button class="small" id="ownedclear">↩ Reset to fallback</button>` : ""}
          <button class="small" id="ownededit">✎ Edit owned list</button>
        </div></div>
      <div class="small muted">Loop targets should be umas you actually own. Import <code>card_data.json</code> to set this list —
      <b>please confirm it is your roster</b>; if it is a borrow/other list, mark it as such and it feeds the <a href="#/borrows">Borrows</a> section instead.
      Fallback: cards that appear in your veterans. You can also toggle cards manually.</div>
      ${DB.user.owned_cards?.length ? `<div class="row" style="margin-top:6px">
        <button class="small" id="ownedisborrow">🤝 This is a borrow list, not my roster</button></div>` : ""}
    </div>
    <div class="panel">
      <div class="section-title"><h3 style="margin:0">Backup &amp; restore <span class="small muted">veterans + loops + objectives + presets + history + owned list</span></h3>
        <div class="row">
          <button class="small primary" id="backupbtn" ${vets.length ? "" : "disabled"}>⬇ Full backup</button>
          <button class="small" id="restorebtn">⬆ Restore backup</button>
          <input type="file" id="restoreinp" accept=".json,application/json" style="display:none">
        </div></div>
      <div class="small muted">The raw-veteran export below does NOT include loops/objectives/history — those live only in this browser.
      Take a full backup before clearing browser data or switching devices. Restore by dropping the backup file above.</div>
      <div class="small muted" style="margin-top:6px">Optional manual breeding records (lineage is auto-derived): <a href="#/history">History</a> · advanced scoring: <a href="#/objectives">⚙ Objectives</a></div>
    </div>
    <div class="panel">
      <div class="section-title">
        <h3 style="margin:0">Prune advisor <span class="small muted">least useful first · best role value + project/parent bonuses + lendable-asset bonus (others borrowing it)</span></h3>
        <div class="row">
          <label class="row small" style="margin:0"><input type="checkbox" id="showkept"> show omitted</label>
          <button class="small" id="selbottom10">Select bottom 10</button>
          <button class="small" id="selbottom25">Select bottom 25</button>
          <button class="small danger" id="prunesel2">🗑 Prune advisor selection</button>
        </div>
      </div>
      <div class="small muted" style="margin-bottom:6px">“Omit” marks a veteran as kept — it disappears from this list (flag survives re-imports). Weaknesses explain the ranking.</div>
      <div id="prunetable"></div>
    </div>
    <div class="panel">
      <div class="section-title">
        <h3 style="margin:0">Browser store: ${vets.length} veterans ${missing.length ? `· <span style="color:var(--gold)">${missing.length} missing from latest import</span>` : ""}</h3>
        <div class="row">
          <button class="small" id="expbtn" ${vets.length ? "" : "disabled"}>⬇ Export raw veterans only</button>
          <button class="small" id="prunemissing" ${missing.length ? "" : "disabled"}>🧹 Prune missing (${missing.length})</button>
          <button class="small danger" id="prunesel">🗑 Prune store selection</button>
          <button class="small danger" id="wipe">⚠ Delete ALL veterans</button>
          <button class="small danger" id="resetall" title="Deletes veterans AND loops, objectives, presets, history, owned list — true first-run state">⚠ Reset everything</button>
        </div>
      </div>
      <div class="row small muted" style="margin-bottom:6px">
        <input id="mq" placeholder="filter…" style="width:200px">
        <label class="row" style="margin:0"><input type="checkbox" id="monlymissing"> only missing</label>
        <span>Projects/breedings referencing pruned veterans keep name snapshots; membership rows show a warning.</span>
      </div>
      <div id="mtable"></div>
    </div>`;
  const doImport = async files => {
    const reports = [];
    let reload = false;
    $("#importreport").innerHTML = `<div class="loading">Parsing &amp; merging…</div>`;
    for (const file of [...files]) {
      try {
        const raw = JSON.parse(await file.text());
        if (raw && raw.format === "uma_tree_backup") {
          await DB.restoreBackup(raw);
          reports.push(`<div class="alert">🔄 Full backup restored (${raw.veterans.length} veterans + all settings) — reloading…</div>`);
          setTimeout(() => location.reload(), 1000);
          reload = true;
          break;
        } else if (Array.isArray(raw) && raw[0]?.factor_info_array) {
          const rep = await importVeterans(raw, S.cat);
          refreshRoster();
          reports.push(`<div class="alert"><b>${esc(file.name)}</b> → veterans: <b>${rep.added}</b> added · <b>${rep.updated}</b> updated ·
            ${rep.unchanged} unchanged · ${rep.missing} flagged missing · ${rep.invalid} invalid (of ${rep.total}).
            Lineage: ${rep.lineage ? `${rep.lineage.linked} ancestor slots auto-linked · ${rep.lineage.borrowed} borrowed · ${rep.lineage.deleted} deleted-veteran snapshots` : "—"}</div>`);
          toast(`Imported ${rep.added + rep.updated} veterans`);
        } else if (Array.isArray(raw) && raw[0]?.card_id && raw[0]?.skill_data_array) {
          DB.user.owned_cards = [...new Set(raw.map(c => c.card_id))];
          DB.user.owned_source = "card_data";
          await DB.saveUser();
          reports.push(`<div class="alert"><b>${esc(file.name)}</b> → owned umas: ${DB.user.owned_cards.length} cards (all 5★).
            <b>Confirm this is your roster</b> — if it is a borrow list, use the button in the Owned umas panel.</div>`);
        } else {
          reports.push(`<div class="alert"><b>${esc(file.name)}</b> — recognised extractor file, not used by the app yet (skipped).</div>`);
        }
      } catch (e) {
        reports.push(`<div class="alert high"><b>${esc(file.name)}</b> — import failed: ${esc(e.message)}</div>`);
      }
    }
    // the report PERSISTS (it used to vanish after 1.6s) — dismiss it explicitly
    S.importReport = `<div class="row spread" style="margin-top:8px"><b class="small">Import report</b>
      <button class="small" id="reportdismiss">✕ dismiss</button></div>` + reports.join("");
    if (!reload) rerender(route);
  };
  const rd = $("#reportdismiss");
  if (rd) rd.onclick = () => { S.importReport = null; $("#importreport").innerHTML = ""; };
  $("#fileinp").onchange = e => { if (e.target.files.length) doImport(e.target.files); };
  const dz = $("#dropzone");
  dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer.files.length) doImport(e.dataTransfer.files); };
  /* owned roster controls */
  const oc = $("#ownedclear");
  if (oc) oc.onclick = async () => {
    DB.user.owned_cards = null; DB.user.owned_source = null;
    await DB.saveUser(); toast("Owned list reset to fallback"); ROUTES.manage();
  };
  const ob = $("#ownedisborrow");
  if (ob) ob.onclick = async () => {
    DB.user.borrow_cards = DB.user.owned_cards;
    DB.user.owned_cards = null; DB.user.owned_source = null;
    await DB.saveUser(); toast("Marked as borrow list — see Borrows"); ROUTES.manage();
  };
  $("#ownededit").onclick = () => {
    const owned = new Set(ownedCardIds());
    const cards = Object.keys(S.cat.card_aptitudes).map(id => +id)
      .sort((a, b) => (S.cat.chara_names[S.cat.card_chara[a]] || "").localeCompare(S.cat.chara_names[S.cat.card_chara[b]] || ""));
    showModal(`<h2>Owned umas</h2>
      <div class="small muted">Click to toggle. Saving switches the source to “manual selection”.</div>
      <div class="owned-grid">${cards.map(id => `<label class="owned-chip ${owned.has(id) ? "on" : ""}">
        <input type="checkbox" class="ownchk" value="${id}" ${owned.has(id) ? "checked" : ""}>
        ${portrait(id, "sm")}<span>${esc(S.cat.chara_names[S.cat.card_chara[id]] || id)}</span></label>`).join("")}</div>
      <div class="row" style="margin-top:10px"><button class="primary" id="ownsave">💾 Save owned list</button>
        <button onclick="closeModal()">Cancel</button></div>`);
    $$(".ownchk").forEach(c => c.onchange = () => c.closest(".owned-chip").classList.toggle("on", c.checked));
    $("#ownsave").onclick = async () => {
      DB.user.owned_cards = $$(".ownchk:checked").map(c => +c.value);
      DB.user.owned_source = "manual";
      await DB.saveUser(); closeModal(); toast("Owned list saved"); ROUTES.manage();
    };
  };
  /* full backup / restore */
  const bb = $("#backupbtn");
  if (bb) bb.onclick = () => {
    const blob = new Blob([JSON.stringify(DB.fullBackup())], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `uma_tree_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  $("#restorebtn").onclick = () => $("#restoreinp").click();
  $("#restoreinp").onchange = e => { if (e.target.files[0]) doImport(e.target.files); };
  $("#expbtn").onclick = () => {
    const blob = new Blob([JSON.stringify(exportVeterans())], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "trained_chara_export.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $("#prunemissing").onclick = async () => {
    if (!confirm(`Prune ${missing.length} veterans missing from the latest import? Their project memberships will show warnings. You can Undo for 10 seconds.`)) return;
    await pruneWithUndo(missing.map(v => v.uid), "Pruned missing veterans");
  };
  $("#prunesel").onclick = async () => {
    const uids = $$(".mchk:checked").map(c => c.dataset.uid);
    if (!uids.length) { toast("Tick veterans in the store table below first"); return; }
    if (!confirm(`Prune ${uids.length} selected veterans from the browser store? You can Undo for 10 seconds.`)) return;
    await pruneWithUndo(uids, "Pruned store selection");
  };
  $("#wipe").onclick = async () => {
    if (!confirm("Delete ALL veterans from the browser store? Objectives/projects/history are kept. You can Undo for 10 seconds.")) return;
    await pruneWithUndo(Object.keys(DB.veterans), "Deleted ALL veterans");
  };
  $("#resetall").onclick = () => {
    if (!confirm("Reset EVERYTHING? This deletes all veterans, loops, objectives, presets, history and the owned list from this browser and restarts the app as a fresh install.\n\nTake a Full backup first if you might want any of it back — this cannot be undone.")) return;
    DB.db.close();   // deleteDatabase is blocked while a connection is open
    const req = indexedDB.deleteDatabase("uma_tree");
    req.onsuccess = req.onerror = () => location.reload();
    req.onblocked = () => alert("Another Uma Tree tab is holding the database open — close it and try again.");
  };
  const renderPrune = () => {
    const rows = Engine.pruneRank($("#showkept").checked);
    $("#prunetable").innerHTML = `
      <table class="cardtable"><tr><th></th><th></th><th>Veteran</th><th>White</th><th>Affinity</th><th>G1</th>
        <th>Core</th><th>Branch</th><th>Leaf</th><th>Usefulness</th><th>Weaknesses</th><th></th></tr>
      ${rows.slice(0, pruneLimit).map(r => `<tr>
        <td><input type="checkbox" class="pchk" data-uid="${r.veteran.uid}"></td>
        <td class="clickable" onclick="showChar('${r.veteran.uid}')">${portrait(r.veteran.card_id, "sm")}</td>
        <td class="clickable" onclick="showChar('${r.veteran.uid}')"><b>${esc(r.veteran.name)}</b> ${missingBadge(r.veteran)}
          <div class="small muted">${esc(r.veteran.memo || "")}</div></td>
        <td class="small">${r.veteran.summary.white_count} (${r.veteran.summary.white_stars}★)</td>
        <td class="small">${Engine.parentAffinity(r.veteran).total}</td>
        <td class="small">${r.veteran.g1_wins.length}</td>
        <td class="small">${r.core}</td><td class="small">${r.branch}</td><td class="small">${r.leaf}</td>
        <td><span class="score-num">${r.total}</span> <span class="tag">${r.best_role}</span>
          ${r.in_project ? `<span class="tag" title="tracked in a project">+proj</span>` : ""}
          ${r.used_parent ? `<span class="tag" title="used as a parent in your lineage">+parent</span>` : ""}
          ${r.lent_out ? `<span class="tag" title="borrowed by other players ${r.lent_out}× (succession_num minus own uses) — lendable asset, kept out of prune suggestions">+lent×${r.lent_out}</span>` : ""}</td>
        <td class="small muted">${r.weaknesses.map(esc).join(" · ") || "—"}</td>
        <td><button class="small" data-keep="${r.veteran.uid}">${r.veteran.keep ? "↩ un-omit" : "omit"}</button></td>
      </tr>`).join("") || `<tr><td colspan="12" class="muted">Nothing to show.</td></tr>`}</table>
      ${rows.length > pruneLimit ? `<div class="row small muted" style="margin-top:6px">Showing ${pruneLimit} of ${rows.length}
        <button class="small" id="prunemore">show ${Math.min(120, rows.length - pruneLimit)} more</button></div>` : ""}`;
    const pm = $("#prunemore");
    if (pm) pm.onclick = () => { pruneLimit += 120; renderPrune(); };
    $$("[data-keep]").forEach(b => b.onclick = async () => {
      const v = DB.veterans[b.dataset.keep];
      v.keep = !v.keep;
      await DB.saveVeterans([v]);
      toast(v.keep ? `${v.name} omitted from prune list` : `${v.name} back in prune list`);
      renderPrune();
    });
  };
  $("#showkept").onchange = renderPrune;
  const selectBottom = n => {
    const boxes = $$(".pchk");
    boxes.forEach((c, i) => c.checked = i < n);
  };
  $("#selbottom10").onclick = () => selectBottom(10);
  $("#selbottom25").onclick = () => selectBottom(25);
  $("#prunesel2").onclick = async () => {
    const uids = $$(".pchk:checked").map(c => c.dataset.uid);
    if (!uids.length) { toast("Tick veterans in the advisor table above first"); return; }
    if (!confirm(`Prune ${uids.length} least-useful veterans? You can Undo for 10 seconds.`)) return;
    await pruneWithUndo(uids, "Pruned advisor selection");
  };
  renderPrune();
  const renderTable = () => {
    const q = $("#mq").value.toLowerCase().trim();
    const onlyM = $("#monlymissing").checked;
    const rows = vets.filter(v =>
      (!onlyM || v.missing) &&
      (!q || v.name.toLowerCase().includes(q) || (v.memo || "").toLowerCase().includes(q) || String(v.id) === q));
    $("#mtable").innerHTML = `
      <table class="cardtable"><tr><th><input type="checkbox" id="mchkall"></th><th></th><th>Character</th><th>Memo</th><th>Import id</th>
      <th>Registered</th><th>Sparks</th><th>Projects</th><th>Status</th></tr>
      ${rows.slice(0, storeLimit).map(v => `<tr>
        <td><input type="checkbox" class="mchk" data-uid="${v.uid}"></td>
        <td class="clickable" onclick="showChar('${v.uid}')">${portrait(v.card_id, "sm")}</td>
        <td class="clickable" onclick="showChar('${v.uid}')"><b>${esc(v.name)}</b></td>
        <td class="small">${esc(v.memo || "")}</td><td class="small muted">${v.id}</td>
        <td class="small muted">${esc(v.register_time)}</td>
        <td>${summaryChips(v.summary)}</td>
        <td class="small">${Store.characterProjects(v.uid).length}</td>
        <td>${v.missing ? `<span class="badge archived">missing</span>` : `<span class="badge leaf">current</span>`}</td>
      </tr>`).join("") || `<tr><td colspan="9" class="muted">Store is empty — import a file above.</td></tr>`}</table>
      ${rows.length > storeLimit ? `<div class="row small muted" style="margin-top:6px">Showing ${storeLimit} of ${rows.length}
        <button class="small" id="storemore">show ${Math.min(400, rows.length - storeLimit)} more</button></div>` : ""}`;
    const sm = $("#storemore");
    if (sm) sm.onclick = () => { storeLimit += 400; renderTable(); };
    const all = $("#mchkall");
    if (all) all.onchange = () => $$(".mchk").forEach(c => c.checked = all.checked);
  };
  $("#mq").oninput = renderTable;
  $("#monlymissing").onchange = renderTable;
  renderTable();
};

/* ---------- card picker (target umas — OWNED roster first) ----------
   Combobox with keyboard navigation; empty query on focus browses the roster. */
function mountCardPicker(el, key, onPick) {
  PICKS[key] = null;
  el.classList.add("picker");
  const owned = ownedCardIds();
  el.innerHTML = `<input type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="pl-${key}"
      placeholder="Search target uma by name / title…" style="width:100%">
    <div class="picker-list" id="pl-${key}" role="listbox" style="display:none"></div>
    <label class="row small" style="margin:4px 0 0"><input type="checkbox" class="ownedonly" checked> owned only (${owned.size}) — <span class="muted">${ownedSourceLabel()}</span></label>`;
  const inp = $("input[type=text]", el), list = $(".picker-list", el), ownChk = $(".ownedonly", el);
  let active = -1;
  const cards = Object.keys(S.cat.card_aptitudes).map(cardId => ({
    card_id: +cardId, name: S.cat.chara_names[S.cat.card_chara[cardId]] || cardId,
    title: S.cat.card_titles[cardId] || "", base: S.cat.card_aptitudes[cardId],
  }));
  const opts = () => $$(".opt[data-card]", list);
  const hide = () => { list.style.display = "none"; inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); };
  const pick = cardId => {
    PICKS[key] = cardId; hide();
    const c = cards.find(x => x.card_id === cardId);
    inp.value = `${c.name} ${c.title}`;
    if (onPick) onPick(cardId);
  };
  const setActive = i => {
    const os = opts();
    active = Math.max(-1, Math.min(i, os.length - 1));
    os.forEach((o, j) => { o.classList.toggle("active", j === active); o.setAttribute("aria-selected", j === active); });
    if (active >= 0) { inp.setAttribute("aria-activedescendant", os[active].id); os[active].scrollIntoView({ block: "nearest" }); }
    else inp.removeAttribute("aria-activedescendant");
  };
  const update = q => {
    const matches = cards.filter(c => (!ownChk.checked || owned.has(c.card_id)) &&
      (!q || c.name.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))).slice(0, 20);
    list.innerHTML = matches.map((c, i) =>
      `<div class="opt" role="option" id="pl-${key}-${i}" data-card="${c.card_id}">${portrait(c.card_id, "sm")}<span>${esc(c.name)}</span>
       <span class="small muted">${esc(c.title)}</span>
       <span class="small">${APTS.map(a => `${a.slice(0, 2)}${GL[c.base[a]]}`).join(" ")}</span></div>`).join("")
      || `<div class="opt muted">no match${ownChk.checked ? " among owned umas — untick “owned only” to search all cards" : ""}</div>`;
    list.style.display = "block";
    inp.setAttribute("aria-expanded", "true");
    active = -1;
    opts().forEach(o => o.onclick = () => pick(+o.dataset.card));
  };
  inp.addEventListener("input", () => { PICKS[key] = null; update(inp.value.toLowerCase().trim()); });
  inp.addEventListener("focus", () => { if (!inp.value.trim()) update(""); });
  ownChk.onchange = () => { if (list.style.display !== "none") update(inp.value.toLowerCase().trim()); };
  inp.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.style.display === "none") update(inp.value.toLowerCase().trim()); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter") {
      const os = opts();
      if (list.style.display !== "none" && os.length) { e.preventDefault(); e.stopPropagation(); pick(+os[Math.max(0, active)].dataset.card); }
    }
    else if (e.key === "Escape" && list.style.display !== "none") { e.stopPropagation(); hide(); }
  });
  inp.addEventListener("blur", () => setTimeout(hide, 200));
}

/* ---------- CORE LOOPS ---------- */
ROUTES.loops = function (pid) {
  if (pid) return renderLoopDetail(+pid);
  const loops = Store.projects().filter(p => p.kind === "core");
  const card = p => {
    const an = Engine.loopAnalysis(p.id);
    const issues = Object.values(an.maintenance).filter(m => m.needs_fix && m.status !== "ok");
    return `<div class="tree-node">
      <div class="row spread">
        <a href="#/loops/${p.id}"><b>${esc(p.name)}</b></a> ${roleBadge("core")} ${p.status === "archived" ? roleBadge("archived") : ""}
        <span class="muted small">${(p.targets || []).length} targets · ${Store.members(p.id).length} veterans</span>
      </div>
      <div class="small muted">targets: ${(p.targets || []).map(c => esc(S.cat.chara_names[S.cat.card_chara[c]] || c)).join(", ") || "none yet"}</div>
      <div class="small">run: ${(p.run_aptitudes || []).map(a => `<span class="tag">${a} ≥${GL[p.apt_min_grade ?? 5]}</span>`).join(" ") || `<span class="muted">no aptitudes selected</span>`}
        ${issues.length ? `<span style="color:var(--red)" class="small">⚠ ${issues.length} maintenance issue(s)</span>` : ""}</div>
    </div>`;
  };
  $("#main").innerHTML = `
    <div class="section-title"><h1>Core Loops</h1>
      <button class="primary" onclick="newLoopPrompt()">＋ New core loop</button></div>
    <p class="small muted">A core loop rotates 3+ <b>target umas you own</b> (their BASE aptitudes; picker defaults to your owned roster — set it in <a href="#/manage">Data</a>).
    Veterans are the product of the loop — their aptitudes don't matter for looping. Select the aptitudes you will run;
    pink sparks only matter for aptitudes your targets can't cover at base.
    <a href="#/projects">Branch projects (advanced) →</a></p>
    <div class="grid cols2">
      <div class="panel"><h2 style="margin-top:0">Active</h2>${loops.filter(p => p.status === "active").map(card).join("") || `<div class="muted">None yet.</div>`}</div>
      <div class="panel"><h2 style="margin-top:0">Archived</h2>${loops.filter(p => p.status === "archived").map(card).join("") || `<div class="muted">None.</div>`}</div>
    </div>`;
};

function renderLoopDetail(pid) {
  const p = Store.project(pid);
  if (!p) { location.hash = "#/loops"; return; }
  const an = Engine.loopAnalysis(pid);
  const runApts = p.run_aptitudes || [];
  const shownApts = runApts.length ? runApts : APTS;
  const minGrade = p.apt_min_grade ?? 5;
  // targets table: base grades + stars needed per shown aptitude
  const targetRows = an.targets.map(t => `<tr>
    <td>${portrait(t.card_id, "sm")}</td>
    <td><b>${esc(t.name)}</b><div class="small muted">${esc(t.title)}</div></td>
    ${shownApts.map(a => {
      const b = t.base ? t.base[a] : 1;
      const steps = Math.max(0, minGrade - b);
      const cls = b >= 8 ? "g8" : b >= 7 ? "g7" : b >= 6 ? "g6" : b >= 5 ? "g5" : "glow";
      return `<td class="apt-cell ${cls}" title="base ${GL[b]}${steps ? `, needs +${steps} (${stepsToStars(steps)}★ pink)` : ", no fix needed"}">${GL[b]}${steps ? `<div class="small" style="color:var(--red)">+${stepsToStars(steps)}★</div>` : ""}</td>`;
    }).join("")}
    <td><button class="small danger" onclick="removeLoopTarget(${pid},${t.card_id})">✕</button></td></tr>`).join("");
  // maintenance panel
  const maintRows = Object.entries(an.maintenance).map(([a, m]) => {
    if (!m.needs_fix) return `<div class="list-item"><span>${cap(a)}</span><span class="badge leaf">covered at base — pink irrelevant</span></div>`;
    const col = m.status === "ok" ? "var(--green)" : m.status === "low" ? "var(--gold)" : "var(--red)";
    return `<div class="list-item"><span>${cap(a)} <span class="muted small">needs ${m.required_stars}★ for ${GL[minGrade]} on weakest target</span></span>
      <span style="color:${col}"><b>${m.best ?? 0}★</b> best lineage${m.best_veteran ? ` (${esc(m.best_veteran.name)})` : ""} ${m.status === "ok" ? "✓" : m.status === "low" ? "⚠ low" : "✕ NONE"}</span></div>`;
  }).join("");
  const memberRows = an.rows.map(r => {
    const bd = r.evaluation.breakdown;
    const cov = bd.pink.data.coverage || {};
    const sup = r.superseded;
    const supNote = sup ? `<div class="small superseded" title="${sup.strong
        ? "dominates on loop criteria: higher score, covers all target whites, pink maintenance and G1 wins"
        : "newer run of the same uma with a higher loop score — check the trade-offs before retiring"}">
        ⚠ may be superseded by <a tabindex="0" onclick="event.stopPropagation();showSupersedeCompare(${pid},'${r.character.uid}','${sup.by_uid}')">${esc(sup.by_name)}</a>
        (${sup.by_score} vs ${sup.score}${sup.same_card ? ", same uma" : ""}${sup.newer ? ", newer" : ""}${sup.in_loop ? ", in this loop" : ""})
        ${sup.lost_whites.length ? `<span class="muted">· loses: ${sup.lost_whites.map(esc).join(", ")}</span>` : ""}
        ${sup.lent_out ? `<span class="muted">· still lent ×${sup.lent_out}</span>` : ""}
        <a tabindex="0" onclick="event.stopPropagation();ignoreSupersede(${pid},'${r.character.uid}','${sup.by_uid}')" title="ignore this suggestion" style="cursor:pointer">✕</a></div>` : "";
    return `<tr class="clickable" tabindex="0" onclick="showChar('${r.character.uid}')">
      <td>${portrait(r.character.card_id, "sm")}</td>
      <td><b>${esc(r.character.name)}</b> ${missingBadge(r.character)}<div class="small muted">${esc(r.character.memo || "")}</div>${supNote}</td>
      <td>${r.member.generation}</td>
      <td class="small">${r.character.summary.white_count} (${r.character.summary.white_stars}★)${bd.white.data.targets_hit || bd.white.data.targets_missing ? `
        <div title="${(bd.white.data.targets_missing || []).map(m => "✕ " + m.name).join("\n")}">${(bd.white.data.targets_hit || []).length}/${(bd.white.data.targets_hit || []).length + (bd.white.data.targets_missing || []).length} 🎯</div>` : ""}</td>
      <td class="small">${r.character.g1_wins.length} G1 · ${bd.compatibility.data.relation_potential} rel pts</td>
      <td>${Object.entries(cov).map(([a, c]) => `<span class="sparkchip pink" style="${c.ok ? "" : "border-color:var(--red)"}">${a} ${c.stars}/${c.required}★</span>`).join("") || `<span class="muted small">n/a</span>`}</td>
      <td><span class="score-num">${r.evaluation.total}</span>${scoreBar(bd)}</td>
      <td onclick="event.stopPropagation()">
        <button class="small" onclick="gotoSim('${r.character.uid}')">⚗</button>
        <button class="small danger" onclick="removeLoopMember(${pid},'${r.character.uid}')">✕</button></td>
    </tr>`;
  }).join("");
  $("#main").innerHTML = `
    <div class="section-title">
      <h1>${esc(p.name)} ${roleBadge("core")}</h1>
      <div class="row">
        <a href="#/loops">← all loops</a>
        <button class="small" onclick="renameLoop(${pid})">✎ Rename</button>
        ${p.status === "active" ? `<button class="small" onclick="archiveLoop(${pid})">📦 Archive</button>` : `<button class="small" onclick="unarchiveLoop(${pid})">♻ Restore</button>`}
        <button class="small danger" onclick="deleteLoop(${pid})">🗑 Delete</button>
      </div></div>
    ${an.alerts.length ? `<div class="panel">${an.alerts.map(a => `<div class="alert ${a.level}">${esc(a.name)}: ${esc(a.text)}</div>`).join("")}</div>` : ""}
    <div class="panel">
      <div class="section-title"><h3 style="margin:0">Run aptitudes <span class="small muted">race types this loop will run · targets should reach the min grade</span></h3>
        <label class="row small" style="margin:0">min grade
          <select id="loopmingrade">${[4, 5, 6, 7].map(g => `<option value="${g}" ${minGrade === g ? "selected" : ""}>${GL[g]}</option>`).join("")}</select></label></div>
      <div class="row">${APTS.map(a => `<label class="row small" style="margin:0;border:1px solid var(--line);border-radius:8px;padding:4px 8px">
        <input type="checkbox" class="loopapt" value="${a}" ${runApts.includes(a) ? "checked" : ""}> ${a}</label>`).join("")}</div>
      <div class="row" style="margin-top:8px">
        <label class="row small" style="margin:0">White spark targets
          <select id="loopwhitepreset">
            <option value="">from objectives (default)</option>
            ${Store.whitePresets().map(wp => `<option value="${wp.id}" ${p.white_preset_id === wp.id ? "selected" : ""}>${esc(wp.name)} (${wp.targets.length})</option>`).join("")}
          </select></label>
        <span class="small muted">${an.white_target_count ? `${an.white_target_count} targets active — white weight 50 (dominant)` : "no targets configured — generic white breadth scoring"}</span>
      </div>
    </div>
    ${loopSchedulePanel(an, pid)}
    <div class="panel">
      <div class="section-title"><h3 style="margin:0">Target umas <span class="small muted">(${an.targets.length}/3+ from your owned roster · base grades shown, red = pink★ needed)</span></h3></div>
      <table><tr><th></th><th>Target</th>${shownApts.map(a => `<th>${a.slice(0, 4)}</th>`).join("")}<th></th></tr>
      ${targetRows || `<tr><td colspan="${shownApts.length + 3}" class="muted">Add at least 3 target umas below.</td></tr>`}</table>
      <div style="margin-top:8px;max-width:480px"><div id="looptargetpick"></div></div>
    </div>
    <div class="grid cols2">
      <div class="panel"><h3 style="margin-top:0">Pink maintenance <span class="small muted">only aptitudes that need fixing</span></h3>
        ${maintRows || `<div class="muted small">Select run aptitudes above.</div>`}</div>
      <div class="panel"><h3 style="margin-top:0">Loop health</h3>
        <div class="small">${an.generation_trend.length ? `Generation trend: ${an.generation_trend.map(t => `gen ${t.generation}: <b>${t.avg_score}</b> (${t.count})`).join(" → ")} ${an.improving ? "📈" : an.generation_trend.length > 1 ? "📉" : ""}` : "No veterans tracked yet."}</div>
        <div style="margin-top:6px">${scoreLegend()}</div>
        <details class="small muted" style="margin-top:6px"><summary>How the loop score works</summary>
        Loop score = ${an.white_target_count ? "<b>target white sparks 50</b> · race wins/relations 20 · pink maintenance 25 (only if needed) · green 5" : "OWN white sparks 35 · OWN race wins/relations 30 · pink maintenance 25 (only if needed) · green 10"}.
        The veteran's parents are ignored everywhere except the pink maintenance pool (veteran + parents),
        which is what fixes the next uma's aptitudes. Veteran aptitudes are ignored — new umas start from base.</details></div>
    </div>
    <div class="panel">
      <div class="section-title"><h3 style="margin:0">Produced veterans <span class="small muted">the product of this loop · ⚠ = possibly superseded by a better replacement (dominates loop criteria, or a newer same-uma run)</span></h3>
        <button class="primary small" onclick="addLoopMemberPrompt(${pid})">＋ Track veteran</button></div>
      <table class="cardtable"><tr><th></th><th>Veteran</th><th>Gen</th><th>White</th><th>Races / relations</th><th>Pink maintenance</th><th>Loop score</th><th></th></tr>
      ${memberRows || `<tr><td colspan="8" class="muted">None tracked yet.</td></tr>`}</table>
    </div>
    ${an.suggestions.length ? `<div class="panel">
      <h3 style="margin-top:0">Suggested additions <span class="small muted">untracked veterans that look like products of this loop — target-card matches first, then loop score</span></h3>
      ${an.suggestions.map(s => `<div class="list-item">
        <span class="charcell">${portrait(s.veteran.card_id, "sm")}
          <span><b>${esc(s.veteran.name)}</b> ${s.target_match ? `<span class="badge core">target match</span>` : ""} ${missingBadge(s.veteran)}
            <span class="muted small">${esc(s.veteran.memo || "")} · ${s.reasons.map(esc).join(" · ")}</span></span></span>
        <span><span class="score-num">${s.total}</span>
          <button class="small" onclick="showChar('${s.veteran.uid}')">view</button>
          <button class="small primary" onclick="addSuggested(${pid},'${s.veteran.uid}')">＋ track</button></span>
      </div>`).join("")}
    </div>` : ""}`;
  mountCardPicker($("#looptargetpick"), "loopTarget", async cardId => {
    const targets = [...(Store.project(pid).targets || [])];
    if (!targets.includes(cardId)) targets.push(cardId);
    await Store.updateProject(pid, { targets });
    rerender(() => renderLoopDetail(pid));
  });
  const saveApts = async () => {
    await Store.updateProject(pid, {
      run_aptitudes: $$(".loopapt:checked").map(c => c.value),
      apt_min_grade: +$("#loopmingrade").value,
    });
    rerender(() => renderLoopDetail(pid));
  };
  $$(".loopapt").forEach(c => c.onchange = saveApts);
  $("#loopmingrade").onchange = saveApts;
  $("#loopwhitepreset").onchange = async () => {
    await Store.updateProject(pid, { white_preset_id: +$("#loopwhitepreset").value || null });
    rerender(() => renderLoopDetail(pid));
  };
  const rps = $("#loopracepreset");
  if (rps) rps.onchange = async () => {
    await Store.updateProject(pid, { race_preset_id: +rps.value || null });
    rerender(() => renderLoopDetail(pid));
  };
  const rpe = $("#loopraceedit");
  if (rpe) rpe.onclick = () => editRacePreset(+rps.value || null, pid);
  $("#loopracenew").onclick = () => editRacePreset(null, pid);
}

/* ---------- supersession comparison: compare, then add to the loop or ignore ---------- */
async function ignoreSupersede(pid, oldUid, byUid) {
  await Store.ignoreSupersede(oldUid, byUid);
  closeModal();
  route();   // re-render through the router: errors surface instead of leaving a stale page
  // pair-level ignore: a next-best candidate may surface — say so, so the update is visible
  const still = $(`tr[onclick*="${oldUid}"] .superseded`);
  toast(still ? "Suggestion ignored — next-best replacement shown" : "Suggestion ignored — it won't reappear for this pairing");
}

function showSupersedeCompare(pid, oldUid, newUid) {
  const p = Store.project(pid);
  const o = DB.veterans[oldUid], n = DB.veterans[newUid];
  if (!p || !o || !n) { toast("Veteran not in browser store"); return; }
  const { needs } = Engine.loopNeeds(p);
  const whiteCfg = Engine.loopWhiteCfg(p);
  const evO = Engine.loopVeteranScore(o, needs, whiteCfg);
  const evN = Engine.loopVeteranScore(n, needs, whiteCfg);
  const targets = Engine.whiteTargets(whiteCfg);
  const fixApts = Object.entries(needs).filter(([, x]) => x.needs_fix);
  const pinkO = Engine.rawStarDist(o, "pink"), pinkN = Engine.rawStarDist(n, "pink");
  const sched = p.race_preset_id ? Store.racePreset(p.race_preset_id) : null;
  const schedWins = v => sched ? sched.races.filter(id => v.g1_wins.some(w => w.race_id === id)).length : null;
  const lent = v => Math.max(0, (v.succession_num || 0) - Engine.childrenOf(v.uid).length);
  const inLoop = Store.members(pid).some(m => m.character_id === newUid);
  const oldGen = Store.members(pid).find(m => m.character_id === oldUid)?.generation ?? 0;
  // what the replacement would lose / gain (own whites + G1 record, group level)
  const groups = v => new Set([...v.sparks.white, ...(v.sparks.scenario || [])].map(w => Math.floor(w.id / 100)));
  const gName = g => S.cat.factors[g * 100 + 1]?.name || String(g);
  const gO = groups(o), gN = groups(n);
  const lostWhites = [...gO].filter(g => !gN.has(g)).map(gName);
  const gainedWhites = [...gN].filter(g => !gO.has(g)).map(gName);
  const winsO = new Set(o.g1_wins.map(w => w.race_id));
  const winsN = new Set(n.g1_wins.map(w => w.race_id));
  const lostWins = o.g1_wins.filter(w => !winsN.has(w.race_id)).map(w => w.name);
  const hitStr = ev => {
    const d = ev.breakdown.white.data;
    return d.targets_hit || d.targets_missing ? `${(d.targets_hit || []).length}/${(d.targets_hit || []).length + (d.targets_missing || []).length} 🎯` : null;
  };
  const win = (a, b) => a > b ? "color:var(--green);font-weight:700" : a < b ? "color:var(--dim)" : "";
  const row = (label, a, b, sa = "", sb = "") =>
    `<tr><td class="small muted">${label}</td><td style="${sa}">${a}</td><td style="${sb}">${b}</td></tr>`;
  const header = (v, ev, tag) => `
    <div class="panel" style="margin:0">
      <div class="charcell">${portrait(v.card_id, "lg")}
        <div><b>${esc(v.name)}</b> ${tag}<div class="small muted">${esc(v.memo || "")} · #${v.id}</div>
          <div class="small muted">${esc(v.register_time)}</div></div>
        <div style="margin-left:auto" class="score-num">${ev.total}</div></div>
      <div style="margin-top:6px">${summaryChips(v.summary)}</div>
    </div>`;
  const newer = (n.register_time || "") > (o.register_time || "");
  showModal(`
    <h2>Supersede check — ${esc(p.name)}</h2>
    <div class="small muted" style="margin-bottom:8px">Current loop veteran vs the suggested replacement.
      Adding tracks the replacement in this loop; ignoring dismisses this suggestion (pair-level).</div>
    <div class="grid cols2">
      ${header(o, evO, `<span class="badge archived">current</span>`)}
      ${header(n, evN, `<span class="badge leaf">suggested</span>${newer ? ` <span class="tag">newer</span>` : ""}${inLoop ? ` <span class="tag">already in loop</span>` : ""}`)}
    </div>
    <table style="margin:10px 0">
      <tr><th></th><th>${esc(o.name)} (current)</th><th>${esc(n.name)} (suggested)</th></tr>
      ${row("Loop score", evO.total, evN.total, win(evO.total, evN.total), win(evN.total, evO.total))}
      ${targets.length ? row("Target whites", hitStr(evO) || "—", hitStr(evN) || "—") : ""}
      ${row("White sparks (own)", `${o.summary.white_count} (${Engine.whiteSelfValue(o).value}★ val)`, `${n.summary.white_count} (${Engine.whiteSelfValue(n).value}★ val)`, win(o.summary.white_count, n.summary.white_count), win(n.summary.white_count, o.summary.white_count))}
      ${fixApts.map(([a, x]) => row(`${cap(a)} maintenance (needs ${x.required_stars}★)`,
        `${pinkO[a] || 0}★ ${(pinkO[a] || 0) >= x.required_stars ? "✓" : "✕"}`, `${pinkN[a] || 0}★ ${(pinkN[a] || 0) >= x.required_stars ? "✓" : "✕"}`,
        (pinkO[a] || 0) >= x.required_stars ? "color:var(--green)" : "color:var(--red)",
        (pinkN[a] || 0) >= x.required_stars ? "color:var(--green)" : "color:var(--red)")).join("")}
      ${row("G1 wins", o.g1_wins.length, n.g1_wins.length, win(o.g1_wins.length, n.g1_wins.length), win(n.g1_wins.length, o.g1_wins.length))}
      ${sched ? row(`Schedule wins (${esc(sched.name)})`, `${schedWins(o)}/${sched.races.length}`, `${schedWins(n)}/${sched.races.length}`, win(schedWins(o), schedWins(n)), win(schedWins(n), schedWins(o))) : ""}
      ${row("Relation potential", Engine.relationPotential(o), Engine.relationPotential(n), win(Engine.relationPotential(o), Engine.relationPotential(n)), win(Engine.relationPotential(n), Engine.relationPotential(o)))}
      ${row("Lent to others", `×${lent(o)}`, `×${lent(n)}`)}
    </table>
    ${lostWhites.length || lostWins.length ? `<div class="panel" style="border-color:#ffc85755">
      <b class="small" style="color:var(--gold)">What you'd lose by replacing:</b>
      <div class="small">${lostWhites.length ? `Whites: ${lostWhites.map(esc).join(", ")}` : ""}
        ${lostWins.length ? `${lostWhites.length ? "<br>" : ""}G1 wins: ${lostWins.map(esc).join(", ")}` : ""}</div>
      ${gainedWhites.length ? `<div class="small muted" style="margin-top:4px">Gained whites: ${gainedWhites.slice(0, 8).map(esc).join(", ")}${gainedWhites.length > 8 ? ` +${gainedWhites.length - 8} more` : ""}</div>` : ""}
    </div>` : `<div class="small" style="color:var(--green)">No white or G1 losses — the replacement covers everything the current veteran passes.</div>`}
    <div class="row" style="margin-top:12px">
      ${inLoop ? "" : `<label class="row small" style="margin:0">gen <input id="supgen" type="number" value="${oldGen + 1}" style="width:56px"></label>
      <label class="row small" style="margin:0"><input type="checkbox" id="supremove"> also remove ${esc(o.name)} from the loop</label>`}
      <button class="primary" id="supadd">${inLoop ? `🗑 Remove ${esc(o.name)} from loop` : `＋ Add ${esc(n.name)} to loop`}</button>
      <button id="supignore">Ignore suggestion</button>
      <button onclick="closeModal()">Cancel</button>
    </div>`);
  $("#supadd").onclick = async () => {
    if (inLoop) {
      await Store.removeMember(pid, oldUid);
      toast(`${o.name} removed from the loop (veteran kept in store)`);
    } else {
      await Store.addMember(pid, newUid, "core", +$("#supgen").value || 0, "");
      if ($("#supremove").checked) await Store.removeMember(pid, oldUid);
      toast(`${n.name} added to ${p.name}${$("#supremove").checked ? ` — ${o.name} removed` : ""}`);
    }
    closeModal();
    route();   // error-surfacing re-render
    const row = $(`tr[onclick*="${inLoop ? oldUid : newUid}"]`);
    if (!inLoop && row) { row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 2000); }
  };
  $("#supignore").onclick = () => ignoreSupersede(pid, oldUid, newUid);
}

/* race schedule panel: target G1s + per-veteran ran/won coverage + shared-win affinity */
function loopSchedulePanel(an, pid) {
  const sc = an.schedule;
  const selector = `
    <div class="row">
      <select id="loopracepreset">
        <option value="">none</option>
        ${Store.racePresets().map(rp => `<option value="${rp.id}" ${an.project.race_preset_id === rp.id ? "selected" : ""}>${esc(rp.name)} (${rp.races.length} G1s)</option>`).join("")}
      </select>
      <button class="small" id="loopraceedit">✎ edit</button>
      <button class="small" id="loopracenew">＋ new</button>
    </div>`;
  let body = `<div class="muted small">Pick a schedule (default: All G1s) — the G1s veterans of this loop should have run.
    Every race won by BOTH veterans in a pairing adds +3 affinity; a shared schedule maximises that.</div>`;
  if (sc) {
    const demand = sc.demand.map(d => {
      const cls = d.weakest >= 7 ? "g7" : d.weakest >= 6 ? "g6" : d.weakest >= 5 ? "g5" : "glow";
      return `<span class="sparkchip ${d.apt === "turf" || d.apt === "dirt" ? "green" : "blue"}" title="weakest loop target base grade: ${GL[d.weakest]}">${d.apt} <b class="${cls}" style="padding:0 3px;border-radius:4px">${GL[d.weakest]}</b></span>`;
    }).join("");
    const memHead = sc.members.map(m => `<th title="${esc(m.name)}">${esc(m.name.slice(0, 8))}</th>`).join("");
    const raceRows = sc.per_race.map(({ race, won_by, ran_by }) => `<tr>
      <td class="small"><b>${esc(race.name)}</b>
        <span class="muted"> · ${race.ground} ${race.dist}</span></td>
      <td class="small muted">${raceTurnLabel(race)}<br>${race.years.join("/")}</td>
      ${sc.members.map(m => m.wonIds.has(race.id)
        ? `<td style="color:var(--green)" title="won" aria-label="${esc(m.name)}: won">✓</td>`
        : m.ranIds.has(race.id) ? `<td style="color:var(--gold)" title="ran, did not win" aria-label="${esc(m.name)}: ran, did not win">·</td>`
        : `<td style="color:var(--red)" title="not run" aria-label="${esc(m.name)}: not run">✕</td>`).join("")}
      <td class="small muted">${won_by.length}/${sc.members.length} won</td></tr>`).join("");
    body = `
      <div class="row small" style="margin:6px 0">Schedule aptitudes (weakest target base): ${demand}</div>
      ${sc.members.length ? `
        <div class="small" style="margin:4px 0">${sc.members.map(m => `<span class="tag">${esc(m.name)}: ran ${m.ran}/${sc.races.length} · won ${m.won}/${sc.races.length}</span>`).join(" ")}</div>
        <div class="small" style="margin:4px 0"><b>${sc.shared_wins}</b> race(s) won by ALL ${sc.members.length} veterans → <b>+${3 * sc.shared_wins}</b> affinity per pairing from shared schedule wins
          <span class="muted">(<span style="color:var(--green)">✓</span> won · <span style="color:var(--gold)">·</span> ran, no win · <span style="color:var(--red)">✕</span> not run)</span></div>
        <table class="small"><tr><th>Race</th><th>Turn</th>${memHead}<th></th></tr>${raceRows}</table>`
        : `<div class="muted small">Track veterans below to see schedule coverage. ${sc.races.length} target G1s: ${sc.races.map(r => esc(r.name)).join(" · ")}</div>`}`;
  }
  return `<div class="panel">
    <div class="section-title"><h3 style="margin:0">Race schedule <span class="small muted">target G1s for this loop's veterans — shared wins maximise affinity</span></h3>
      ${selector}</div>
    ${body}</div>`;
}

async function removeLoopTarget(pid, cardId) {
  await Store.updateProject(pid, { targets: (Store.project(pid).targets || []).filter(c => c !== cardId) });
  rerender(() => renderLoopDetail(pid));
}
async function removeLoopMember(pid, uid) {
  await Store.removeMember(pid, uid);
  rerender(() => renderLoopDetail(pid));
}
async function renameLoop(pid) {
  formModal("Rename loop", `<div class="field"><label>Loop name</label>
    <input id="rlname" value="${esc(Store.project(pid).name)}" style="width:260px"></div>`, "Save", async () => {
    const name = $("#rlname").value.trim();
    if (!name) { toast("Enter a name"); return false; }
    await Store.updateProject(pid, { name });
    rerender(() => renderLoopDetail(pid));
  });
}
async function archiveLoop(pid) { await Store.updateProject(pid, { status: "archived" }); rerender(() => renderLoopDetail(pid)); }
async function unarchiveLoop(pid) { await Store.updateProject(pid, { status: "active" }); rerender(() => renderLoopDetail(pid)); }
async function deleteLoop(pid) {
  if (!confirm("Delete this loop and its tracked veterans? (breeding history kept)")) return;
  await Store.deleteProject(pid);
  location.hash = "#/loops";
}
async function newLoopPrompt() {
  formModal("New core loop", `<div class="field"><label>Loop name</label>
    <input id="nlname" value="Core Loop A" style="width:260px"></div>`, "Create loop", async () => {
    const name = $("#nlname").value.trim();
    if (!name) { toast("Enter a name"); return false; }
    const p = await Store.createProject({ name, kind: "core" });
    location.hash = `#/loops/${p.id}`;
  });
}
async function addSuggested(pid, uid) {
  formModal(`Track ${esc(DB.veterans[uid]?.name || "veteran")}`, `<div class="field"><label>Generation</label>
    <input id="asgen" type="number" value="0" style="width:70px"></div>`, "＋ Track", async () => {
    await Store.addMember(pid, uid, "core", +$("#asgen").value || 0, "");
    toast("Veteran tracked");
    rerender(() => renderLoopDetail(pid));
  });
}
function addLoopMemberPrompt(pid) {
  showModal(`<h2>Track a produced veteran</h2>
    <div id="loopvpick"></div>
    <div class="row" style="margin-top:10px">
      <div><label>Generation</label><input id="loopgen" type="number" value="0" style="width:70px"></div>
      <button class="primary" id="loopaddgo" style="align-self:flex-end">Add</button>
    </div>`);
  mountPicker($("#loopvpick"), "loopV");
  $("#loopaddgo").onclick = async () => {
    if (!PICKS.loopV) { toast("Pick a veteran"); return; }
    await Store.addMember(pid, PICKS.loopV, "core", +$("#loopgen").value || 0, "");
    closeModal(); toast("Veteran tracked");
    rerender(() => renderLoopDetail(pid));
  };
}

function gotoSimPair(a, b) {
  S.simPreselect = a; S.simPreselectB = b;
  location.hash = "#/simulator";
}

/* ---------- Projects ---------- */
ROUTES.projects = function (pid) {
  if (pid) return renderProjectDetail(+pid);
  const projects = Store.projects();
  const cores = projects.filter(p => p.kind === "core" && p.status === "active");
  const branches = projects.filter(p => p.kind === "branch" && p.status === "active");
  const archived = projects.filter(p => p.status === "archived");
  const card = p => {
    const parent = Store.project(p.parent_project_id);
    const origin = p.origin_character_id ? DB.veterans[p.origin_character_id] : null;
    return `<div class="tree-node">
      <div class="row spread">
        <a href="#/projects/${p.id}"><b>${esc(p.name)}</b></a> ${roleBadge(p.kind)}
        <span class="muted small">${Store.members(p.id).length} members</span>
      </div>
      ${parent || origin ? `<div class="small muted">from ${parent ? esc(parent.name) : ""}${origin ? ` · ${esc(origin.name)}` : ""}</div>` : ""}
      ${p.notes ? `<div class="small muted">${esc(p.notes)}</div>` : ""}
    </div>`;
  };
  const byParent = {};
  branches.forEach(b => (byParent[b.parent_project_id || 0] ||= []).push(b));
  const render = (list, depth) => list.map(b =>
    `<div class="${depth ? "tree-children" : ""}">${card(b)}${render(byParent[b.id] || [], depth + 1)}</div>`).join("");
  const tops = branches.filter(b => {
    const par = Store.project(b.parent_project_id);
    return !par || par.kind !== "branch";
  });
  $("#main").innerHTML = `
    <div class="section-title"><h1>Loops &amp; Branches</h1>
      <div class="row">
        <button class="primary" onclick="newProjectPrompt('core')">＋ Core loop</button>
        <button onclick="newProjectPrompt('branch')">＋ Branch</button>
      </div></div>
    <div class="grid cols2">
      <div class="panel"><h2 style="margin-top:0">Core loops <span class="badge core">core</span></h2>
        ${cores.map(card).join("") || `<div class="muted">None yet.</div>`}</div>
      <div class="panel"><h2 style="margin-top:0">Branch tree <span class="badge branch">branch</span></h2>
        ${render(tops, 0) || `<div class="muted">None yet. Branches retain a reference to their origin loop/branch.</div>`}</div>
    </div>
    ${archived.length ? `<div class="panel"><h2 style="margin-top:0">Archived</h2>${archived.map(card).join("")}</div>` : ""}`;
};

function renderProjectDetail(pid) {
  const p = Store.project(pid);
  if (!p) { location.hash = "#/projects"; return; }
  const an = Engine.projectAnalysis(pid);
  const o = an.objective;
  const rows = an.rows;
  const cfg = o.config;
  const whiteTargets = Engine.whiteTargets(cfg);
  const goals = Object.keys(cfg.aptitude_goals || {});
  const heat = rows.length ? `
    <table class="heatmap"><tr><th style="text-align:left">Member</th>${APTS.map(a => `<th>${a.slice(0, 4)}</th>`).join("")}</tr>
    ${rows.map(r => `<tr><td style="text-align:left"><a tabindex="0" onclick="showChar('${r.character.uid}')" style="cursor:pointer">${esc(r.character.name)}</a></td>
      ${APTS.map(a => {
        const base = (r.character.base_aptitudes || r.character.aptitudes)[a];
        const achieved = r.character.aptitudes[a];
        const st = r.evaluation.lineage_pink[a] || 0;
        const projV = Engine.projectedAptitudes(r.character)[a];
        const cls = base >= 8 ? "g8" : base >= 7 ? "g7" : base >= 6 ? "g6" : base >= 5 ? "g5" : "glow";
        const goal = goals.includes(a);
        return `<td class="apt-cell ${cls}" title="${a}: base ${GL[base]} → projected ${GL[projV]} (cap A), veteran achieved ${GL[achieved]}, lineage ${st}★${goal ? " (goal)" : ""}">${GL[base]}${projV > base ? `<span class="small">→${GL[projV]}</span>` : ""}${st ? `<div class="small">${st}★</div>` : ""}${goal ? "🎯" : ""}</td>`;
      }).join("")}</tr>`).join("")}</table>` : "";
  const whiteRetention = whiteTargets.length && rows.length ? `
    <table><tr><th>Target white spark</th>${rows.map(r => `<th>${esc(r.character.name.slice(0, 10))}</th>`).join("")}</tr>
    ${whiteTargets.map(t => {
      const f = S.cat.factors[t.factor_id];
      return `<tr><td class="small">${esc(f?.name || t.factor_id)}</td>
        ${rows.map(r => {
          const hit = (r.evaluation.breakdown.white.data.targets_hit || []).find(h => h.factor_id === t.factor_id);
          return `<td style="text-align:center">${hit ? `<span title="coverage ${hit.coverage}">✓</span>` : `<span style="color:var(--red)">✕</span>`}</td>`;
        }).join("")}</tr>`;
    }).join("")}</table>` : `<div class="muted small">Set white spark targets on the objective to track retention.</div>`;
  const trend = an.generation_trend;
  const memberRows = rows.map(r => `
    <tr class="clickable" tabindex="0" onclick="showChar('${r.character.uid}')">
      <td>${portrait(r.character.card_id, "sm")}</td>
      <td><b>${esc(r.character.name)}</b> ${missingBadge(r.character)}<div class="small muted">${esc(r.character.memo || "")}</div></td>
      <td>${roleBadge(r.member.role)}</td><td>${r.member.generation}</td>
      <td>${summaryChips(r.character.summary)}</td>
      <td class="small">${r.race_coverage.G1} G1</td>
      <td><span class="score-num">${r.evaluation.total}</span>${scoreBar(r.evaluation.breakdown)}</td>
      <td onclick="event.stopPropagation()">
        <button class="small" onclick="createBranchPrompt('${r.character.uid}',${pid})">🌿 branch</button>
        <button class="small danger" onclick="removeMember(${pid},'${r.character.uid}')">✕</button></td>
    </tr>`).join("");
  const parent = Store.project(p.parent_project_id);
  const origin = p.origin_character_id ? DB.veterans[p.origin_character_id] : null;
  const children = Store.projects().filter(x => x.parent_project_id === pid);
  $("#main").innerHTML = `
    <div class="section-title">
      <h1>${esc(p.name)} ${roleBadge(p.kind)} ${p.status === "archived" ? roleBadge("archived") : ""}</h1>
      <div class="row">
        <a href="#/projects">← all projects</a>
        <button class="small" onclick="editProjectPrompt(${pid})">✎ Edit</button>
        ${p.kind === "branch" && p.status === "active" ? `<button class="small" onclick="promoteProject(${pid})">⬆ Promote to core loop</button>` : ""}
        ${p.status === "active" ? `<button class="small" onclick="archiveProject(${pid})">📦 Archive</button>` : `<button class="small" onclick="unarchiveProject(${pid})">♻ Restore</button>`}
        <button class="small danger" onclick="deleteProject(${pid})">🗑 Delete</button>
      </div></div>
    <div class="panel">
      <div class="row">
        <span>Objective: <b>${esc(o?.name || "none")}</b></span>
        <span class="muted small">${p.notes ? esc(p.notes) : ""}</span>
        ${parent ? `<span class="tag">origin project: <a href="#/projects/${parent.id}">${esc(parent.name)}</a></span>` : ""}
        ${origin ? `<span class="tag">origin character: <a tabindex="0" onclick="showChar('${origin.uid}')" style="cursor:pointer">${esc(origin.name)}</a></span>` : ""}
        ${children.map(ch => `<span class="tag">branch: <a href="#/projects/${ch.id}">${esc(ch.name)}</a></span>`).join("")}
        <span class="tag">${an.improving ? "📈 improving across generations" : trend.length > 1 ? "📉 not improving" : "single generation"}</span>
      </div>
      ${trend.length ? `<div class="row small muted" style="margin-top:6px">Generation trend: ${trend.map(t => `gen ${t.generation}: <b>${t.avg_score}</b> (${t.count})`).join(" → ")}</div>` : ""}
    </div>
    ${an.alerts.length ? `<div class="panel"><h3 style="margin-top:0">Alerts</h3>${an.alerts.map(a => `<div class="alert ${a.level}">${DB.veterans[a.character_id] ? `<a tabindex="0" onclick="showChar('${a.character_id}')" style="cursor:pointer">${esc(a.name)}</a>` : esc(a.name)}: ${esc(a.text)}</div>`).join("")}</div>` : ""}
    <div class="panel">
      <div class="section-title"><h2 style="margin:0">Members</h2>
        <button class="primary small" onclick="addToProjectPrompt(null,${pid})">＋ Add character</button></div>
      <table class="cardtable"><tr><th></th><th>Character</th><th>Role</th><th>Gen</th><th>Own sparks</th><th>Races</th><th>Score</th><th></th></tr>
      ${memberRows || `<tr><td colspan="8" class="muted">No members yet.</td></tr>`}</table>
    </div>
    <div class="grid cols2">
      <div class="panel"><h3 style="margin-top:0">Aptitude heatmap <span class="small muted">BASE grade → projected (cap A) + lineage pink★ · 🎯 = goal</span></h3>${heat || `<div class="muted">No members.</div>`}</div>
      <div class="panel"><h3 style="margin-top:0">White spark retention</h3>${whiteRetention}</div>
    </div>`;
}

async function removeMember(pid, uid) {
  await Store.removeMember(pid, uid);
  toast("Removed from project");
  renderProjectDetail(pid);
}
async function promoteProject(pid) {
  await Store.updateProject(pid, { kind: "core" });
  toast("Branch promoted to core loop");
  renderProjectDetail(pid);
}
async function archiveProject(pid) {
  await Store.updateProject(pid, { status: "archived" });
  toast("Archived"); renderProjectDetail(pid);
}
async function unarchiveProject(pid) {
  await Store.updateProject(pid, { status: "active" });
  renderProjectDetail(pid);
}
async function deleteProject(pid) {
  if (!confirm("Delete this project and its memberships? (breeding history is kept)")) return;
  await Store.deleteProject(pid);
  toast("Deleted");
  location.hash = "#/projects";
}

/* ---------- Run Planner (the Simulator, evolved) ---------- */
ROUTES.simulator = function () {
  $("#main").innerHTML = `
    <h1>Plan a Run</h1>
    <p class="small muted">Pick two parents, see the offspring's inheritance pool, post-career spark chances, and what to look for in a borrow.</p>
    <div class="panel">
      <div class="grid cols3">
        <div><label>Parent A</label><div id="pickA"></div></div>
        <div><label>Parent B</label><div id="pickB"></div></div>
        <div><label>Objective</label>${objectiveSelect("sobj")}
          <label style="margin-top:6px">Intended trainee (optional, adds base(T,P) terms)</label>
          <select id="strainee" style="width:100%"><option value="">unknown</option></select>
          <button class="primary" id="sgo" style="margin-top:6px;width:100%">⚗ Plan this run</button></div>
      </div>
    </div>
    <div id="sresult"></div>`;
  mountPicker($("#pickA"), "simA", null, S.simPreselect);
  mountPicker($("#pickB"), "simB", null, S.simPreselectB);
  S.simPreselect = null; S.simPreselectB = null;
  $("#sobj").value = S.objectiveId;
  $("#strainee").innerHTML = `<option value="">unknown</option>` +
    Object.entries(S.cat.chara_names).sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join("");
  $("#sgo").onclick = () => {
    if (!PICKS.simA || !PICKS.simB) { toast("Pick two parents first"); return; }
    const a = DB.veterans[PICKS.simA], b = DB.veterans[PICKS.simB];
    if (!a || !b) { toast("Veteran missing from store"); return; }
    renderSimResult(Engine.simulate(a, b, Store.objective(+$("#sobj").value), +$("#strainee").value || null));
  };
};

function renderSimResult(r) {
  const own = r.scope === "own";
  const side = s => `
    <div class="panel"><div class="charcell">${portrait(s.parent.card_id)}<b>${esc(s.parent.name)}</b></div>
      ${own ? `<div class="small muted">own sparks only — its parents' sparks drop on the offspring</div>`
        : `<div class="small muted">grandparents: ${s.grandparents.map(g => esc(g.name)).join(", ")}</div>`}
      <h3>Blue ${own ? "(own, max 3★)" : "(parent side, max 9★)"}</h3>${distChips(s.blue, "blue")}
      <h3>Pink ${own ? "(own)" : "(parent side)"}</h3>${distChips(s.pink, "pink")}</div>`;
  const wc = r.white_coverage;
  $("#sresult").innerHTML = `
    <div class="alert">${own
      ? "Core/branch view: only the two veterans' <b>own sparks</b> count — their parents' sparks are dropped on the offspring."
      : "Leaf view: parents' lineages are included — they shape the offspring's ability and its future 9★ lineage."}</div>
    <div class="grid cols3">
      ${side(r.parents[0])}${side(r.parents[1])}
      <div class="panel"><h3 style="margin-top:0">Affinity ${r.compatibility.trainee ? "" : `<span class="small muted">(trainee unknown)</span>`}</h3>
        <div class="kpi">${r.compatibility.p1.rank} ${r.compatibility.p1.points} <span class="muted" style="font-size:14px">P1</span>
          · ${r.compatibility.p2.rank} ${r.compatibility.p2.points} <span class="muted" style="font-size:14px">P2</span></div>
        <table class="small"><tr><th>Term</th><th>P1</th><th>P2</th></tr>
          <tr><td>base with own parents</td><td>${r.compatibility.p1.base_own_parents}</td><td>${r.compatibility.p2.base_own_parents}</td></tr>
          <tr><td>3× shared G1 with own parents</td><td>${r.compatibility.p1.race_own_parents}</td><td>${r.compatibility.p2.race_own_parents}</td></tr>
          <tr><td>base with other parent</td><td>${r.compatibility.p1.base_partner}</td><td>${r.compatibility.p2.base_partner}</td></tr>
          <tr><td>3× shared G1 with other parent (${r.compatibility.shared_g1.length})</td><td>${r.compatibility.p1.race_partner}</td><td>${r.compatibility.p2.race_partner}</td></tr>
          <tr><td>base with trainee</td><td>${r.compatibility.p1.base_trainee}</td><td>${r.compatibility.p2.base_trainee}</td></tr>
          <tr><td><b>Total</b></td><td><b>${r.compatibility.p1.points}</b></td><td><b>${r.compatibility.p2.points}</b></td></tr></table>
        <div class="small muted" style="margin-top:4px">${esc(r.compatibility.note)}</div>
        <div class="small">${r.compatibility.shared_g1.map(g => esc(g.name)).join(" · ")}</div></div>
    </div>
    ${r.warnings.length || r.role_suggestions.length ? `<div class="panel">
      ${r.warnings.map(w => `<div class="alert high">⚠ ${esc(w)}</div>`).join("")}
      ${r.role_suggestions.map(w => `<div class="alert">💡 ${esc(w)}</div>`).join("")}</div>` : ""}
    <div class="grid cols2">
      <div class="panel"><h3 style="margin-top:0">${own ? "Combined parent sparks (own only, max 6★/stat)" : "Offspring inheritance pool"}</h3>
        <div>Combined blue: ${distChips(r.blue.actual, "blue", r.blue.alternatives?.[0]?.target)}</div>
        <div>Combined pink: ${distChips(r.pink.actual, "pink", r.pink.alternatives?.[0]?.target)}</div>
        <div class="small muted" style="margin:6px 0">Blue match ${(r.blue.score * 100).toFixed(0)}% (expected-value weighted: 3★ ≈ 5.4× 1★) · Pink match ${(r.pink.score * 100).toFixed(0)}% vs objective (matched ≫ scattered)</div>
        <h3>Aptitude factor projection <span class="small muted">(always includes grandparents — raises the trainee's BASE aptitudes, caps at A)</span></h3>
        ${Object.entries(r.aptitude_projection).map(([a, v]) => `<span class="sparkchip pink">${a} ${v.stars}★ → +${v.steps} grade</span>`).join("") || `<span class="muted small">no pink factors in pool</span>`}
        ${r.expected_gains ? `
        <h3>Expected stat gains <span class="small muted">(proc% × value × (1 + affinity/100), per inheritance event)</span></h3>
        <table class="small"><tr><th>Parent side</th><th>Affinity mult.</th><th>Blue (parent + grandparents)</th><th>Whites</th><th>Total</th></tr>
          ${[r.expected_gains.a, r.expected_gains.b].map(s => `<tr><td>${esc(s.name)}</td><td>×${s.multiplier.toFixed(2)}</td>
            <td>${Object.entries(s.blue_per_stat).map(([k, v]) => `${k} +${v.toFixed(1)}`).join(", ") || "—"}</td>
            <td>+${s.white_stats.toFixed(1)}</td><td><b>+${s.total.toFixed(1)}</b></td></tr>`).join("")}
          <tr><td colspan="4"><b>Per event / per run (2 events)</b></td><td><b>+${r.expected_gains.per_event} / +${r.expected_gains.per_run}</b></td></tr></table>
        <div class="small muted">${esc(r.expected_gains.note)}</div>` : ""}
      </div>
      <div class="panel"><h3 style="margin-top:0">Target whites — post-career creation chances</h3>
        <div class="small muted" style="margin-bottom:6px">Odds the FINISHED run creates each spark on the new veteran (separate from in-run Inspiration procs).
        Skill whites: only if the run learns the skill; base 20% (○) / 25% (◎) / 40% (gold), ×1.1 per lineage uma carrying it (best-supported rule, unconfirmed).
        Race whites: ~20–30% if the run wins that G1. Scenario sparks: ~20–30% on finishing the scenario.</div>
        ${(r.post_career || []).map(pc => `<div class="list-item small">
          <span>${pc.present ? "✓" : "✕"} ${esc(pc.name)} <span class="tag">${pc.kind}</span></span>
          <span>${pc.kind === "race"
            ? `<b>20–30%</b> <span class="muted">if the run wins this G1</span>`
            : `<b>${pc.chance[0] === pc.chance[1] ? (pc.chance[0] * 100).toFixed(1) + "%" : (pc.chance[0] * 100).toFixed(1) + "–" + (pc.chance[1] * 100).toFixed(1) + "%"}</b>
               <span class="muted">(${pc.carriers}/6 lineage carriers${pc.single_circle ? "" : " · ◎–gold range"})</span>`}</span></div>`).join("")
          || `<div class="muted small">No white targets configured on this objective.</div>`}
        <div class="small muted" style="margin-top:4px">${wc.total_distinct} distinct whites in the inheritance pool (in-run procs use the 3/6/9% table × affinity).</div>
        <h3>${own ? "Parent values (own record)" : "Parent &amp; grandparent values"}</h3>
        ${["a", "b"].map(k => `<div class="list-item small"><span>${esc(r.parent_values[k].name)}</span>
          <span>parent <b>${r.parent_values[k].parent.value}</b>${own ? "" : ` · grandparent <b>${r.parent_values[k].grandparent.value}</b>`}</span></div>`).join("")}
        <div class="small est" style="margin-top:6px">Estimates used: ${r.estimates.join(", ")}. Confirm against in-game results.</div>
      </div>
    </div>
    ${borrowRecPanel(r)}`;
}

/* Borrow recommendation: the app has no borrow-DB access, so it says what to look
   for and links out. Gaps come from the objective's unmet targets for this pairing. */
function borrowRecPanel(r) {
  const blueMissing = r.blue.alternatives?.[0]?.missing || {};
  const pinkMissing = r.pink.alternatives?.[0]?.missing || {};
  const whiteMissing = (r.post_career || []).filter(pc => !pc.present).map(pc => ({ name: pc.name }));
  const traineeName = r.compatibility.trainee ? S.cat.chara_names[r.compatibility.trainee] : null;
  const wishlist = borrowWishlist({ blueMissing, pinkMissing, whiteMissing, g1Name: traineeName });
  const lowAff = r.compatibility.p1.rank === "△" || r.compatibility.p2.rank === "△";
  if (!wishlist.length && !lowAff) return "";
  return `<div class="panel">
    <h3 style="margin-top:0">🤝 If you borrow one parent instead…</h3>
    <div class="small">Look for: ${wishlist.map(w => `<span class="sparkchip">${esc(w)}</span>`).join("") || "—"}
      ${lowAff ? `<span class="sparkchip missing">higher affinity (one side is △)</span>` : ""}</div>
    <div class="small muted" style="margin-top:6px">No borrow database is connected — search in-game (friend/legacy search) or a community borrow database:
      ${borrowLinksHtml()} · <a href="#/borrows">your past borrows →</a></div>
  </div>`;
}

/* ---------- History ---------- */
ROUTES.history = function () {
  const rows = Store.breedings();
  const link = (id, name) => DB.veterans[id]
    ? `<a tabindex="0" onclick="showChar('${id}')" style="cursor:pointer">${esc(name)}</a>`
    : `<span class="muted" title="pruned or not imported">${esc(name || "?")} ⚠</span>`;
  $("#main").innerHTML = `
    <h1>Breeding History</h1>
    <div class="panel">
      <h3 style="margin-top:0">Record a breeding</h3>
      <div class="grid cols3">
        <div><label>Parent A</label><div id="hpickA"></div></div>
        <div><label>Parent B</label><div id="hpickB"></div></div>
        <div><label>Offspring (optional, if in store)</label><div id="hpickO"></div></div>
      </div>
      <div class="row" style="margin-top:8px">
        <div><label>Project</label><select id="hproj"><option value="">none</option>${Store.projects().map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
        <div><label>Generation</label><input id="hgen" type="number" value="0" style="width:70px"></div>
        <div><label>Date</label><input id="hdate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div style="flex:1"><label>Notes</label><input id="hnotes" style="width:100%"></div>
        <button class="primary" id="hadd" style="align-self:flex-end">＋ Record</button>
      </div>
      <div class="small muted" style="margin-top:6px">Lineage is now <b>auto-derived</b> from ancestor snapshots (see the <a href="#/tree">Tree</a> view) — manual records here are an optional cross-reference. Names are snapshotted so history survives pruning.</div>
    </div>
    <div class="panel">
      <table class="cardtable"><tr><th>Date</th><th>Parent A</th><th>Parent B</th><th>Offspring</th><th>Project</th><th>Gen</th><th>Notes</th><th></th></tr>
      ${rows.map(b => `<tr>
        <td class="small">${esc(b.date)}</td>
        <td>${link(b.parent_a_id, b.parent_a_name)}</td>
        <td>${link(b.parent_b_id, b.parent_b_name)}</td>
        <td>${b.offspring_id ? link(b.offspring_id, b.offspring_name) : `<span class="muted">?</span>`}</td>
        <td class="small">${esc(Store.project(b.project_id)?.name || "")}</td>
        <td>${b.generation}</td><td class="small">${esc(b.notes || "")}</td>
        <td><button class="small danger" onclick="delBreeding(${b.id})">✕</button></td></tr>`).join("")
        || `<tr><td colspan="8" class="muted">No breedings recorded yet.</td></tr>`}</table>
    </div>`;
  mountPicker($("#hpickA"), "hA");
  mountPicker($("#hpickB"), "hB");
  mountPicker($("#hpickO"), "hO");
  $("#hadd").onclick = async () => {
    if (!PICKS.hA || !PICKS.hB) { toast("Pick both parents"); return; }
    await Store.addBreeding({
      parent_a_id: PICKS.hA, parent_b_id: PICKS.hB, offspring_id: PICKS.hO,
      project_id: +$("#hproj").value || null, generation: +$("#hgen").value || 0,
      date: $("#hdate").value, notes: $("#hnotes").value,
    });
    toast("Breeding recorded");
    ROUTES.history();
  };
};
async function delBreeding(id) {
  if (!confirm("Delete this breeding record?")) return;
  await Store.deleteBreeding(id);
  ROUTES.history();
}

/* ---------- Lineage Tree (auto-derived) ---------- */
ROUTES.tree = function (uid) {
  const vets = Object.values(DB.veterans);
  if (!vets.length) { location.hash = "#/manage"; return; }
  const root = uid && DB.veterans[uid] ? uid
    : [...vets].sort((a, b) => (b.register_time || "").localeCompare(a.register_time || ""))[0].uid;
  $("#main").innerHTML = `
    <h1>Lineage Tree</h1>
    <p class="small muted">Auto-derived by matching ancestor snapshots (card + sparks + G1 wins, registered before the child)
    to your veterans. <span class="badge leaf">yours</span> = matched veteran ·
    <span class="badge borrow">borrowed</span> = other player's legacy ·
    <span class="badge archived">snapshot</span> = your since-deleted veteran (data kept in the child). Up to 7 generations.</p>
    <div class="panel row"><label class="row" style="margin:0;flex:1;min-width:260px">Root veteran <div id="treepick" style="flex:1"></div></label>
      <span class="small muted">manual cross-references: <a href="#/history">History</a></span></div>
    <div class="grid cols2">
      <div class="panel"><h3 style="margin-top:0">Ancestors</h3><div id="treebody"></div></div>
      <div class="panel"><h3 style="margin-top:0">Offspring <span class="small muted">veterans that use this uma as an ancestor</span></h3><div id="treekids"></div></div>
    </div>`;
  mountPicker($("#treepick"), "treeRoot", u => { location.hash = "#/tree/" + u; }, root);
  const nodeHtml = (v, a, depth, role) => {
    // v = matched veteran (live) OR null; a = ancestor snapshot (null for root)
    const sparks = v ? v.sparks : a.sparks;
    const name = v ? v.name : a.name;
    const cardId = v ? v.card_id : a.card_id;
    const g1 = v ? v.g1_wins.length : a.g1_wins.length;
    const badge = v ? (a ? ancBadge(a) : `<span class="badge core">root</span>`) : ancBadge(a);
    const click = v ? `onclick="showChar('${v.uid}')" style="cursor:pointer"` : "";
    const focus = v && v.uid !== root ? `<button class="small" onclick="location.hash='#/tree/${v.uid}'">focus</button>` : "";
    let kids = "";
    if (v && depth < 7) {
      const pa = v.ancestors.find(x => x.role === "parent_a"), pb = v.ancestors.find(x => x.role === "parent_b");
      kids = [pa, pb].filter(Boolean).map(x =>
        nodeHtml(x.matched_uid ? DB.veterans[x.matched_uid] : null, x, depth + 1, x.role)).join("");
      if (kids) kids = `<div class="tree-children">${kids}</div>`;
    } else if (v && depth >= 7) kids = `<div class="small muted" style="margin-left:26px">… deeper generations truncated</div>`;
    return `<div class="tree-node">
      <div class="row spread">
        <span class="charcell" ${click}>${portrait(cardId, "sm")}<b>${esc(name)}</b> ${badge}
          <span class="muted small">${role ? role.replace(/_/g, " ") + " · " : ""}${g1} G1</span></span>
        ${focus}
      </div>
      <div>${sparkChips(sparks, 6)}</div>
    </div>${kids}`;
  };
  $("#treebody").innerHTML = nodeHtml(DB.veterans[root], null, 0, null);
  const kids = Engine.childrenOf(root);
  $("#treekids").innerHTML = kids.map(k => {
    const v = DB.veterans[k.uid];
    return `<div class="list-item small">
      <span class="charcell">${portrait(v.card_id, "sm")}<a tabindex="0" onclick="showChar('${v.uid}')" style="cursor:pointer">${esc(v.name)}</a>
        <span class="muted">${esc(v.memo || "")} · uses as ${k.role.replace(/_/g, " ")}</span></span>
      <button class="small" onclick="location.hash='#/tree/${v.uid}'">focus</button></div>`;
  }).join("") || `<div class="muted small">No veterans in your store use this uma as an ancestor.</div>`;
};

/* ---------- Borrows ---------- */
ROUTES.borrows = function () {
  // past borrows: borrowed direct-parent slots across your veterans, grouped by owner
  const byOwner = {};
  for (const v of Object.values(DB.veterans))
    for (const a of v.ancestors)
      if (a.borrowed && (a.role === "parent_a" || a.role === "parent_b")) {
        const o = (byOwner[a.owner_viewer_id] ||= { uses: 0, umas: {}, latest: "" });
        o.uses++;
        const key = a.card_id + "|" + a.sparks.white.map(w => w.id).sort().join(",");
        const u = (o.umas[key] ||= { name: a.name, card_id: a.card_id, sparks: a.sparks, count: 0 });
        u.count++;
        if ((v.register_time || "") > o.latest) o.latest = v.register_time || "";
      }
  const owners = Object.entries(byOwner).sort((a, b) => b[1].uses - a[1].uses);
  // recommendations from active loop needs
  const recs = [];
  for (const p of Store.projects().filter(x => x.kind === "core" && x.status === "active")) {
    const an = Engine.loopAnalysis(p.id);
    for (const [apt, m] of Object.entries(an.maintenance)) {
      if (!m.needs_fix || m.status === "ok") continue;
      recs.push(`<div class="alert ${m.status === "none" ? "high" : ""}">🤝 <a href="#/loops/${p.id}">${esc(p.name)}</a>:
        look for <b>${m.required_stars - (m.best || 0)}★+ ${cap(apt)} pink</b> (loop needs ${m.required_stars}★, best veteran has ${m.best || 0}★)
        ${an.white_target_count ? `· plus the loop's ${an.white_target_count} target whites` : ""}</div>`);
    }
  }
  const borrowCards = DB.user.borrow_cards || [];
  $("#main").innerHTML = `
    <h1>Borrows</h1>
    <div class="panel">
      <h3 style="margin-top:0">What to look for</h3>
      ${recs.join("") || `<div class="muted small">No unmet loop needs right now. Use <a href="#/simulator">Plan a run</a> for per-pairing borrow recommendations.</div>`}
      <div class="small muted" style="margin-top:6px">No borrow database is connected, so the app cannot search borrows for you.
      Search in-game (friend / legacy search) or a community borrow database: ${borrowLinksHtml()}</div>
    </div>
    ${borrowCards.length ? `<div class="panel">
      <h3 style="margin-top:0">Imported card list (${borrowCards.length}) <span class="small muted">marked as borrow list, not your roster</span></h3>
      <div>${borrowCards.map(id => `<span class="sparkchip">${portrait(id, "sm")} ${esc(S.cat.chara_names[S.cat.card_chara[id]] || id)}</span>`).join("")}</div>
    </div>` : ""}
    <div class="panel">
      <h3 style="margin-top:0">Past borrows <span class="small muted">from your lineage data — borrowed direct parents you actually used</span></h3>
      ${owners.map(([oid, o]) => `<div style="margin:12px 0">
        <div style="font-weight:600;margin-bottom:4px">Owner ${esc(oid)}
          <span class="muted small">— ${o.uses} uses · latest ${esc(o.latest.slice(0, 10))}</span></div>
        ${Object.values(o.umas).sort((a, b) => b.count - a.count).map(u => `<div class="list-item small">
          <span class="charcell">${portrait(u.card_id, "sm")}<b>${esc(u.name)}</b> <span class="muted">×${u.count}</span></span>
          <span>${sparkChips(u.sparks, 4)}</span></div>`).join("")}
      </div>`).join("") || `<div class="muted small">No borrowed parents found in your veterans' lineage.</div>`}
    </div>`;
};
