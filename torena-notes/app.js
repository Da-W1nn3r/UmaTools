/* Torena's Notes — insight index + markdown article viewer.
 * Notes are plain .md files under notes/; add an entry to NOTES to publish one.
 * Routing: index.html lists notes, index.html#<id> renders the article.
 */
"use strict";

const NOTES = [
  {
    id: "team-trials-spirit-skills",
    file: "notes/team-trials-spirit-skills.md",
    title: "Competitive Spirit, Lone Wolf & Sympathy: what actually activates in Team Trials",
    tags: ["Team Trials", "Competitive Spirit", "Lone Wolf", "Sympathy"],
    date: "2026-11-26",
    summary: "A data-driven look at three green skills in the 12-runner Team Trials field: " +
      "Lone Wolf is near-free points in Sprint/Mile/Dirt, Sympathy only works as a full-team " +
      "commit, and Competitive Spirit is structurally dead under the style-diversity meta.",
  },
];

/* ---------------- Minimal markdown renderer ----------------
 * Supports the constructs used by the notes: ATX headings, pipe
 * tables with alignment, ordered/unordered lists (with nesting
 * and continuation lines), horizontal rules, paragraphs, and
 * inline `code`, **bold**, *italic*. Everything is HTML-escaped
 * before inline markup is applied.
 */

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inlineMd(s) {
  let out = escapeHtml(s);
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (_, c) => {
    codes.push("<code>" + c + "</code>");
    return "\u0000" + (codes.length - 1) + "\u0000";
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
  return out;
}

const RE = {
  heading: /^(#{1,6})\s+(.*)$/,
  hr: /^\s*(-{3,}|\*{3,}|_{3,})\s*$/,
  listItem: /^(\s*)([-*+]|\d+\.)\s+(.*)$/,
  tableSep: /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/,
};

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
}

function renderBlocks(lines) {
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = line.match(RE.heading);
    if (h) {
      const lvl = h[1].length;
      html.push(`<h${lvl}>${inlineMd(h[2].trim())}</h${lvl}>`);
      i++; continue;
    }

    if (RE.hr.test(line)) { html.push("<hr>"); i++; continue; }

    // Table: header row + separator row
    if (line.includes("|") && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const headers = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(c =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left");
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i])); i++;
      }
      let t = '<div class="tbl-scroll"><table><thead><tr>';
      headers.forEach((c, k) => { t += `<th style="text-align:${aligns[k] || "left"}">${inlineMd(c)}</th>`; });
      t += "</tr></thead><tbody>";
      for (const r of rows) {
        t += "<tr>";
        headers.forEach((_, k) => { t += `<td style="text-align:${aligns[k] || "left"}">${inlineMd(r[k] || "")}</td>`; });
        t += "</tr>";
      }
      t += "</tbody></table></div>";
      html.push(t);
      continue;
    }

    // List block
    const li = line.match(RE.listItem);
    if (li && li[1].length === 0) {
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(RE.listItem);
        if (m && m[1].length === 0) {
          items.push([m[3]]);
          i++;
        } else if (lines[i].trim() && (/^\s{2,}/.test(lines[i]) || (items.length && !RE.heading.test(lines[i]) && !lines[i].includes("|")))) {
          // indented continuation / nested content, or lazy paragraph continuation
          items[items.length - 1].push(lines[i].replace(/^\s{1,4}/, ""));
          i++;
        } else break;
      }
      const tag = ordered ? "ol" : "ul";
      let l = `<${tag}>`;
      for (const item of items) {
        const [first, ...rest] = item;
        let body = inlineMd(first);
        // Render nested content (sub-lists etc.) through the block renderer;
        // merge any leading continuation paragraph into the item's own text.
        let nested = rest.length ? renderBlocks(rest) : "";
        const lead = nested.match(/^<p>([\s\S]*?)<\/p>\n?/);
        if (lead) { body += " " + lead[1]; nested = nested.slice(lead[0].length); }
        l += "<li>" + body + nested + "</li>";
      }
      l += `</${tag}>`;
      html.push(l);
      continue;
    }

    // Paragraph: consecutive plain lines. Keep gathering while a **bold**
    // span is still open, so wrapped lines starting with "+"/"-"/"*" or
    // containing "|" aren't misread as lists/tables.
    const para = [line];
    i++;
    const boldOpen = () => (para.join(" ").match(/\*\*/g) || []).length % 2 === 1;
    while (i < lines.length && lines[i].trim() &&
           (boldOpen() ||
            (!RE.heading.test(lines[i]) && !RE.hr.test(lines[i]) &&
             !RE.listItem.test(lines[i]) && !lines[i].includes("|")))) {
      para.push(lines[i]); i++;
    }
    html.push("<p>" + inlineMd(para.join(" ")) + "</p>");
  }
  return html.join("\n");
}

function renderMarkdown(md) {
  return renderBlocks(md.replace(/\r\n?/g, "\n").split("\n"));
}

/* ---------------- Views ---------------- */

const app = document.getElementById("app");
const hero = document.getElementById("hero");
const fmtDate = iso => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/* List-view filter state (kept across article visits) */
const filter = { q: "", tags: new Set(), allTags: false };
const COLLAPSED_TAGS = 8; // most-used chips shown before "Show all" (scales as notes grow)

function noteMatches(n) {
  if (filter.tags.size && !n.tags.some(t => filter.tags.has(t))) return false;
  const hay = (n.title + " " + n.summary + " " + n.tags.join(" ")).toLowerCase();
  return filter.q.toLowerCase().split(/\s+/).every(w => !w || hay.includes(w));
}

function noteCard(n) {
  return `
    <a class="note-card" href="#${n.id}">
      <div class="meta">${n.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}<span class="date">${fmtDate(n.date)}</span></div>
      <h2>${escapeHtml(n.title)}</h2>
      <p>${escapeHtml(n.summary)}</p>
      <div class="go">Read the note →</div>
    </a>`;
}

function showList() {
  hero.style.display = "";
  document.title = "Torena's Notes — Da_'s UmaTools";

  // Tag chips: every tag used by any note, most-used first (ties alphabetical).
  // With many tags, only the top COLLAPSED_TAGS (+ any active ones) show until
  // "Show all" is clicked; search also matches tags, so rare ones stay findable.
  const counts = new Map();
  for (const n of NOTES) for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
  const tags = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));

  app.innerHTML = `
    <div class="toolbar">
      <input type="search" id="note-search" placeholder="Search notes and tags…  ( / )" aria-label="Search notes">
      <div class="tag-chips" id="tag-chips" role="group" aria-label="Filter by tag"></div>
    </div>
    <div class="list-status" id="list-status"></div>
    <div class="notes-list" id="notes-list"></div>`;

  const input = app.querySelector("#note-search");
  const list = app.querySelector("#notes-list");
  const status = app.querySelector("#list-status");
  const chipBox = app.querySelector("#tag-chips");
  input.value = filter.q;

  function renderChips() {
    const top = new Set(tags.slice(0, COLLAPSED_TAGS));
    const visible = tags.filter(t => filter.allTags || top.has(t) || filter.tags.has(t));
    let html = visible.map(t => {
      const on = filter.tags.has(t);
      return `<button class="tag-chip${on ? " active" : ""}" data-tag="${escapeHtml(t)}" aria-pressed="${on}">${escapeHtml(t)} <span class="count">${counts.get(t)}</span></button>`;
    }).join("");
    if (tags.length > COLLAPSED_TAGS) {
      html += `<button class="tag-chip more" data-more="1">${filter.allTags ? "Show fewer ▴" : `Show all ${tags.length} tags ▾`}</button>`;
    }
    chipBox.innerHTML = html;
  }

  function update() {
    const shown = NOTES.filter(noteMatches);
    list.innerHTML = shown.length
      ? shown.map(noteCard).join("")
      : '<p class="status">No notes match. <a href="" id="clear-filters">Clear filters</a></p>';
    const filtered = filter.q || filter.tags.size;
    status.textContent = filtered ? `${shown.length} of ${NOTES.length} note${NOTES.length === 1 ? "" : "s"}` : "";
    renderChips();
    const clear = list.querySelector("#clear-filters");
    if (clear) clear.addEventListener("click", e => {
      e.preventDefault();
      filter.q = ""; filter.tags.clear(); input.value = "";
      update();
    });
  }

  input.addEventListener("input", () => { filter.q = input.value; update(); });
  chipBox.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.more) { filter.allTags = !filter.allTags; renderChips(); return; }
    const t = btn.dataset.tag;
    filter.tags.has(t) ? filter.tags.delete(t) : filter.tags.add(t);
    update();
  });
  update();
}

// "/" focuses the search box while the list is showing.
document.addEventListener("keydown", e => {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
  const input = document.getElementById("note-search");
  if (!input || /^(input|textarea|select)$/i.test(document.activeElement.tagName)) return;
  e.preventDefault();
  input.focus();
});

async function showNote(id) {
  const note = NOTES.find(n => n.id === id);
  if (!note) { showList(); return; }
  hero.style.display = "none";
  document.title = note.title + " — Torena's Notes";
  app.innerHTML = '<p class="status">Loading note…</p>';
  try {
    const res = await fetch(note.file);
    if (!res.ok) throw new Error(res.status);
    const md = await res.text();
    if (location.hash.slice(1) !== id) return; // navigated away while loading
    app.innerHTML = `
      <a class="back" href="#">← All notes</a>
      <div class="article-meta">${note.tags.map(t => `<a class="tag" href="#" data-tag="${escapeHtml(t)}" title="Show all notes tagged ${escapeHtml(t)}">${escapeHtml(t)}</a>`).join("")}<span>${fmtDate(note.date)}</span></div>
      <article class="note">${renderMarkdown(md)}</article>
      <a class="back" href="#">← All notes</a>`;
    app.querySelectorAll(".article-meta a.tag").forEach(a => a.addEventListener("click", () => {
      filter.q = ""; filter.tags = new Set([a.dataset.tag]); // hashchange → filtered list
    }));
    window.scrollTo(0, 0);
  } catch (e) {
    app.innerHTML = '<p class="status">Couldn\'t load this note. If you opened the file directly, try serving the site over HTTP.</p>';
  }
}

function route() {
  const id = location.hash.slice(1);
  if (id) showNote(id); else { showList(); window.scrollTo(0, 0); }
}

window.addEventListener("hashchange", route);
route();