// Inspiration tab reader. The tab shows the trainee's own sparks ("Sparks") and, below the
// "Legacy Origin" header, the two parents stacked vertically, each with its own 2-column spark grid.
// Every spark cell has a name line on top and three star slots below; the star count is the number of
// YELLOW (filled) slots — empty slots are grey. Factor ids are resolved from the name + star count.
import { toCanvas, prepare } from "./ocr.js";
import { textCanvas } from "./skills.js";
import { buildIndex, lookup, normalize } from "./match.js";

// Geometry in units of k (k = stat-row width / 906), measured from the Speed label centre.
const COL_DX = [54, 521];          // cell left edge per column
const CELL_W = 454;                // cell width (col1 54-508, col2 521-975)
const STAR_DX = [[243, 281, 320], [709, 748, 786]]; // three star-slot centres per column
const NAME_DY = -45;               // name band sits ~45k above the star centre

const isYellow = (r, g, b) => r > 200 && g > 170 && b < 130 && r - b > 90;

export function inspirationGeometry(anchors, tabs, closeY, img) {
  const k = (anchors.wit.x - anchors.speed.x) / 906;
  const tabY = tabs.inspiration?.y ?? tabs.skills?.y ?? tabs.career?.y;
  const top = tabY + 30 * k;
  const bottom = Math.min(img.height - 4, closeY ? closeY - 60 * k : img.height - 190 * k);
  return { k, top, bottom, sx: anchors.speed.x, sy: anchors.speed.y };
}

// Mean colour of the saturated (non-grey, non-white) pixels in a cell's icon area, used to tell the
// blue stat / red aptitude / green unique icons apart when their names OCR poorly.
function iconColor(img, left, cy, k) {
  const g = img.getContext("2d");
  const x = Math.max(0, Math.round(left + 6 * k)), y = Math.max(0, Math.round(cy - 72 * k));
  const w = Math.round(72 * k), h = Math.round(84 * k);
  const d = g.getImageData(x, y, Math.min(w, img.width - x), Math.min(h, img.height - y)).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let p = 0; p < d.length; p += 4) {
    const mx = Math.max(d[p], d[p + 1], d[p + 2]), mn = Math.min(d[p], d[p + 1], d[p + 2]);
    if (mx - mn > 35 && mn < 200) { r += d[p]; gg += d[p + 1]; b += d[p + 2]; n++; }
  }
  return n < 40 ? null : [r / n, gg / n, b / n];
}

function kindOf(rgb) {
  if (!rgb) return "unknown";
  const [r, g, b] = rgb;
  if (g > r + 15 && g > b + 15) return "green";
  if (b > r + 15 && b >= g) return "blue";
  if (r > g + 25 && r > b + 25) return "red";
  return "unknown";
}

// Vertical bands that contain yellow star pixels at the slot centres. Returns star-centre y values.
function starRows(img, sx, top, bottom, k) {
  const g = img.getContext("2d");
  const y0 = Math.max(0, Math.round(top)), h = Math.max(1, Math.min(Math.round(bottom - top), img.height - y0));
  const W = img.width;
  const data = g.getImageData(0, y0, W, h).data;
  const slots = STAR_DX.flat().map((dx) => Math.round(sx + dx * k));
  const slotYellow = (x, y) => {
    let hit = 0, n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= W || yy < 0 || yy >= h) continue;
      const p = (yy * W + xx) * 4; n++;
      if (isYellow(data[p], data[p + 1], data[p + 2])) hit++;
    }
    return n && hit / n > 0.4;
  };
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(slots.some((x) => slotYellow(x, y)));
  const runs = [];
  let start = -1;
  for (let y = 0; y <= h; y++) {
    if (y < h && rows[y]) { if (start < 0) start = y; }
    else if (start >= 0) { runs.push({ y0: start, y1: y }); start = -1; }
  }
  const merged = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev && r.y0 - prev.y1 <= 8 * k) prev.y1 = r.y1; else merged.push({ ...r });
  }
  const out = [];
  for (const r of merged) {
    if (r.y1 - r.y0 < 14 * k) continue;
    const cy = y0 + (r.y0 + r.y1) / 2;
    // A solid gold banner is yellow across the whole cell; real stars fill only ~a quarter of it.
    let banner = false;
    for (const dx of COL_DX) {
      const x0 = Math.round(sx + dx * k), w = Math.round(CELL_W * k);
      let hit = 0, n = 0;
      const yy = Math.round(cy) - y0;
      for (let x = x0; x < x0 + w && x < W; x += 2) {
        if (yy < 0 || yy >= h) continue;
        const p = (yy * W + x) * 4; n++;
        if (isYellow(data[p], data[p + 1], data[p + 2])) hit++;
      }
      if (n && hit / n > 0.6) banner = true;
    }
    if (!banner) out.push(cy);
  }
  return out;
}

async function readCell(env, worker, img, sx, cy, col, k) {
  const g = img.getContext("2d");
  let stars = 0;
  const pattern = [];
  for (const dx of STAR_DX[col]) {
    const x = Math.round(sx + dx * k), y = Math.round(cy);
    const d = g.getImageData(Math.max(0, x - 9), Math.max(0, y - 9), 18, 18).data;
    let hit = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { n++; if (isYellow(d[i], d[i + 1], d[i + 2])) hit++; }
    const filled = n && hit / n > 0.15;
    pattern.push(filled ? "Y" : ".");
    if (filled) stars++;
  }
  if (!stars) return null;
  const left = sx + COL_DX[col] * k;
  const nameBox = { x: left + 6 * k, y: cy + (NAME_DY - 12) * k, w: (CELL_W - 12) * k, h: 52 * k };
  await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "6" });
  const ocr = async (canvas) => {
    const { data } = await worker.recognize(env.toInput(canvas), {}, { blocks: true });
    return { name: data.text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join(" "), confidence: data.confidence };
  };
  // Dark text (race / white-skill / green names) first. Stat & aptitude names are white on a coloured
  // pill, so the dark pass comes back empty — retry with white-on-colour polarity.
  let { name, confidence } = await ocr(textCanvas(env, img, nameBox, 3, 14, 140));
  if (!normalize(name)) ({ name, confidence } = await ocr(prepare(env, img, nameBox, 3, { white: true, pad: 14 })));
  const rgb = iconColor(img, left, cy, k);
  return { col, y: cy, stars, pattern: pattern.join(""), name, iconRGB: rgb, kind: kindOf(rgb), confidence,
    box: { x: Math.round(left), y: Math.round(cy - 84 * k), w: Math.round(CELL_W * k), h: Math.round(112 * k) } };
}

// Find the "Legacy Origin" header that separates own sparks from the parents.
function legacyHeaderY(words, k) {
  if (!words) return null;
  const w = words.find((x) => /legacy|origin/i.test(x.text));
  return w ? (w.bbox.y0 + w.bbox.y1) / 2 : null;
}

export async function readInspirationTab(env, worker, source, ctx) {
  const { anchors, tabs, closeY, words } = ctx;
  const img = toCanvas(env, source);
  const { k, top, bottom, sx, sy } = inspirationGeometry(anchors, tabs, closeY, img);
  const legacyY = legacyHeaderY(words, k);
  const own = [], parents = [], notes = [];
  for (const cy of starRows(img, sx, top, bottom, k)) {
    // The own grid always sits above "Legacy Origin". When that header has scrolled off-screen the
    // capture only shows parent sparks, so treat every cell as a parent rather than polluting own.
    const isParent = legacyY == null || cy > legacyY;
    for (const col of [0, 1]) {
      const cell = await readCell(env, worker, img, sx, cy, col, k);
      if (!cell) continue;
      (isParent ? parents : own).push(cell);
    }
  }
  if (legacyY == null) notes.push("No 'Legacy Origin' header in this capture: read as parent sparks.");
  return { own, parents, legacyY, notes, geometry: { k, top, bottom, sx, sy } };
}

// Name -> [factor ids]. The same name exists at 1/2/3 stars, so the star count picks the id.
export function makeFactorResolver(tables) {
  return { tables, byName: buildIndex(Object.entries(tables.factors).map(([id, f]) => [id, f.name])) };
}

const STAT_GROUP = { speed: 1, stamina: 2, power: 3, guts: 4, wit: 5 };

// Resolve one spark cell to a factor id. `cardId` is the owner of the green unique spark (the trainee
// for own sparks, the parent for a parent block). Returns { factor_id, via } or null.
export function resolveFactor(F, cell, cardId, warnings = []) {
  const stars = cell.stars;
  if (!stars) return null;
  // Green unique spark: its group is the owner's card_id, so no name OCR is needed.
  if (cell.kind === "green" && cardId) return { factor_id: cardId * 100 + stars, via: "green" };
  let hit = lookup(F.byName, cell.name);
  if (hit) {
    const ids = hit.ids.filter((id) => {
      const f = F.tables.factors[id];
      return f && (f.type === 7 ? stars === 1 : id % 10 === stars);
    });
    if (ids.length === 1) return { factor_id: ids[0], via: hit.exact ? "name" : "fuzzy" };
    if (ids.length > 1) {
      // Prefer the green unique belonging to this card, else the lowest id.
      const green = cardId && ids.find((id) => F.tables.factors[id].type === 3 && F.tables.factors[id].group === cardId);
      if (green) return { factor_id: green, via: "name" };
      return { factor_id: Math.min(...ids), via: "ambiguous" };
    }
  }
  // Blue stat names OCR poorly: fall back to the icon colour + a readable stat word.
  if (cell.kind === "blue") {
    const m = normalize(cell.name).match(/speed|stamina|power|guts|wit/);
    if (m) return { factor_id: STAT_GROUP[m[0]] * 100 + stars, via: "stat" };
  }
  if (cell.kind === "green" && !cardId) warnings.push(`Green spark "${cell.name}" seen but its parent is unidentified.`);
  else warnings.push(`Spark not recognised: "${cell.name}" (${stars}★, ${cell.kind})`);
  return null;
}

// Merge resolved own-spark readings across scrolling captures (the same spark resolves to the same id).
export function mergeFactorIds(readings) {
  const set = new Set();
  for (const ids of readings) for (const id of ids) set.add(id);
  return [...set].sort((a, b) => a - b);
}

// Split parent cells into per-parent blocks. Spark rows within a parent are ~99k apart; the character
// header panel between two parents leaves a noticeably larger gap, which marks the block boundary.
export function segmentParentBlocks(cells, k) {
  const sorted = [...cells].sort((a, b) => a.y - b.y || a.col - b.col);
  const rowYs = [];
  for (const c of sorted) if (!rowYs.length || c.y - rowYs[rowYs.length - 1] > 20 * k) rowYs.push(c.y);
  const gaps = rowYs.slice(1).map((y, i) => y - rowYs[i]);
  const med = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 99 * k;
  const thr = Math.max(140 * k, med * 1.5);
  const blocks = [];
  let cur = [], lastRow = -Infinity;
  for (const c of sorted) {
    const newRow = c.y - lastRow > 20 * k;
    if (newRow && cur.length && c.y - lastRow > thr) { blocks.push(cur); cur = []; }
    if (newRow) lastRow = c.y;
    cur.push(c);
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

// A parent's green unique spark names its card: the factor group is the card_id (stars aside).
export function parentCardId(F, cells) {
  for (const c of cells) {
    if (c.kind !== "green") continue;
    const hit = lookup(F.byName, c.name);
    const f = hit && F.tables.factors[hit.ids[0]];
    if (f && f.type === 3) return { cardId: f.group, stars: c.stars, name: c.name };
  }
  return null;
}

// Read the two parents across scrolling captures. `captures` is [{ cells, legacyY, sy, k }] in any
// order. Each capture's parent cells are split into per-parent blocks; a block is identified by its
// green unique spark and its sparks are unioned by card_id. Position (10 = left/top, 20 = right/bottom)
// follows on-screen order: the least-scrolled capture (Legacy header furthest down) is read first, so
// the first parent identified is position 10. Blocks whose green spark never appears stay unidentified
// (a dropped parent JSON can still fill them).
export function readParentFactors(F, captures, warnings = []) {
  const ordered = [...captures].sort((a, b) => {
    const ka = a.legacyY != null ? a.legacyY - a.sy : -Infinity;
    const kb = b.legacyY != null ? b.legacyY - b.sy : -Infinity;
    return kb - ka;
  });
  const byCard = new Map();
  const unidentified = [];
  for (const cap of ordered) {
    for (const block of segmentParentBlocks(cap.cells, cap.k)) {
      const green = parentCardId(F, block);
      const ids = [], unresolved = [];
      for (const c of block) {
        const res = resolveFactor(F, c, green?.cardId, warnings);
        if (res) ids.push(res.factor_id);
        else unresolved.push(c);
      }
      if (!green) { unidentified.push({ ids, cells: block }); continue; }
      const e = byCard.get(green.cardId) ?? { cardId: green.cardId, greenStars: green.stars, greenName: green.name, factorIds: new Set(), unresolved: [], order: byCard.size };
      for (const id of ids) e.factorIds.add(id);
      for (const c of unresolved) {
        const key = `${normalize(c.name)}|${c.stars}|${c.kind}`;
        if (!e.unresolved.some((u) => `${normalize(u.name)}|${u.stars}|${u.kind}` === key)) e.unresolved.push(c);
      }
      byCard.set(green.cardId, e);
    }
  }
  const parents = [...byCard.values()]
    .sort((a, b) => a.order - b.order)
    .map((e, i) => ({ positionId: i === 0 ? 10 : i === 1 ? 20 : 0, cardId: e.cardId, greenStars: e.greenStars, greenName: e.greenName, factorIds: [...e.factorIds].sort((a, b) => a - b), unresolved: e.unresolved }));
  return { parents, unidentified };
}
