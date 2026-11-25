// Name matching against the master.mdb-derived tables. Pure functions, no I/O.

// Keep ○ ◎ ☆ because they distinguish otherwise identical skill names.
export function normalize(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[◯〇]/g, "○")
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z0-9○◎☆]/g, "");
}

export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Builds an index: normalized name -> [ids]. `entries` is [[id, name], ...].
export function buildIndex(entries) {
  const map = new Map();
  for (const [id, name] of entries) {
    if (name == null) continue;
    const k = normalize(name);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(Number(id));
  }
  return map;
}

// Returns { ids, exact, distance } or null. Fuzzy match allows ~15% edits.
export function lookup(index, text, maxRatio = 0.15) {
  const k = normalize(text);
  if (!k) return null;
  if (index.has(k)) return { ids: index.get(k).slice(), exact: true, distance: 0 };
  let best = null;
  for (const [key, ids] of index) {
    const d = editDistance(k, key);
    if (d <= Math.max(1, Math.floor(Math.max(k.length, key.length) * maxRatio)) && (!best || d < best.distance)) {
      best = { ids: ids.slice(), exact: false, distance: d };
    }
  }
  return best;
}

// Similarity of two strings after normalization: 1 = identical, 0 = nothing in common.
export function similarity(a, b) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return Math.max(0, 1 - editDistance(x, y) / Math.max(x.length, y.length));
}

// Ranks every index key against the OCR text, best first: [{ key, ids, score, exact }].
// Ties keep table order (stable sort), which matches lookup()'s historical first-wins behaviour.
export function rankMatches(index, text, limit = 8) {
  const k = normalize(text);
  if (!k) return [];
  const out = [];
  for (const [key, ids] of index) {
    const score = key === k ? 1 : Math.max(0, 1 - editDistance(k, key) / Math.max(k.length, key.length));
    out.push({ key, ids: ids.slice(), score, exact: key === k });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// A match may be accepted without asking the user when it is exact, or close enough AND clearly
// better than every competing entry. Entries that share an id with the best (the same name under
// several ids) are not competitors: that ambiguity cannot be resolved from the screenshot anyway.
export function isConfident(best, ranked, { min = 0.8, margin = 0.06 } = {}) {
  if (!best) return false;
  if (best.exact) return true;
  if (best.score < min) return false;
  const ids = new Set(best.ids);
  return !ranked.some((c) => c !== best && !c.ids.some((id) => ids.has(id)) && c.score > best.score - margin);
}

// Fallback for lines where OCR mangled or dropped words ("GD Japan Cop or,", "WLP >atsuki dho Dal").
// Scores every known name by how much of it is covered by OCR words (recall) and how much of the OCR text is
// explained by it (precision), and returns the best only if it clearly beats the runner-up.
export function wordMatch(names, raw, { minScore = 0.55, margin = 0.15 } = {}) {
  const toks = String(raw ?? "").replace(/[|~]/g, " ").split(/\s+/).map(normalize).filter((t) => t.length >= 2);
  if (!toks.length) return null;
  const tokTotal = toks.reduce((s, t) => s + t.length, 0);
  const scored = [];
  for (const n of names) {
    const nw = n.split(/\s+/).map(normalize).filter(Boolean);
    const used = new Set();
    let recall = 0, explained = 0, cost = 0;
    for (const w of nw) {
      let bd = 99, bi = -1;
      // tokens shorter than 3 letters are usually icon junk: they may only match exactly
      toks.forEach((t, i) => { const d = editDistance(w, t); if ((d === 0 || t.length >= 3) && d < bd) { bd = d; bi = i; } });
      // one edit for 3+ letter words ("cup" read as "cop"), one more for every further 3 letters
      if (bd <= (w.length >= 3 ? Math.max(1, Math.floor(w.length / 3)) : 0)) { recall += w.length; cost += bd; if (!used.has(bi)) { used.add(bi); explained += toks[bi].length; } }
    }
    const total = nw.reduce((s, w) => s + w.length, 0);
    // A single matched word cannot identify a multi-word name ("Stakes", "Cup", "Japan" fit many).
    if (nw.length > 1 && used.size < 2) continue;
    const r = recall / total, p = explained / tokTotal;
    scored.push({ name: n, score: r * (0.5 + 0.5 * p), cost });
  }
  scored.sort((a, b) => b.score - a.score || a.cost - b.cost);
  const [a, b] = scored;
  return a && a.score >= minScore && (!b || a.score - b.score >= margin) ? a : null;
}
