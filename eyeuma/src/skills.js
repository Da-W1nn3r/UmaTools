// Skills tab reader. Finds each skill card by its background, then OCRs name (and level) per card.
import { clampBox } from "./layout.js";
import { toCanvas } from "./ocr.js";

// Geometry in units of k (k = stat-row width / 906), measured from the Speed label centre.
const COL_LEFT = [-128, 436];   // card left edge relative to Speed label x, per column
const CARD_W = 543;
const TEXT_X0 = 78, TEXT_X1 = 440; // name area inside a card (icon on the left, level on the right)
const LEVEL_X0 = 400;

const isPanel = (r, g, b) => {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 232 && Math.max(r, g, b) - Math.min(r, g, b) < 14;
};

// Vertical runs of "card" pixels in one column. Returns [{y0, y1}] in image pixels.
export function findCardRuns(img, left, width, top, bottom, k) {
  const g = img.getContext("2d");
  const h = Math.max(1, Math.round(bottom - top));
  const x0 = Math.round(left), w = Math.round(width);
  const data = g.getImageData(Math.max(0, x0), Math.max(0, Math.round(top)), Math.min(w, img.width - x0), Math.min(h, img.height - Math.round(top))).data;
  const cw = Math.min(w, img.width - x0);
  const xs = [0.3, 0.4, 0.5, 0.62, 0.8, 0.92, 0.97].map((f) => Math.min(cw - 1, Math.round(f * cw)));
  const rows = [];
  for (let y = 0; y < h; y++) {
    let hits = 0;
    for (const x of xs) {
      const p = (y * cw + x) * 4;
      if (!isPanel(data[p], data[p + 1], data[p + 2])) hits++;
    }
    rows.push(hits >= 5);
  }
  const runs = [];
  let start = -1;
  for (let y = 0; y <= h; y++) {
    if (y < h && rows[y]) { if (start < 0) start = y; }
    else if (start >= 0) { runs.push({ y0: Math.round(top) + start, y1: Math.round(top) + y }); start = -1; }
  }
  // Light interior rows (highlights, glyph outlines) split a card into pieces: join pieces whose gap is
  // smaller than the real gap between cards (~25px).
  const merged = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev && r.y0 - prev.y1 <= 12 * k) prev.y1 = r.y1; else merged.push({ ...r });
  }
  const minH = 60 * k;
  return merged.filter((r) => r.y1 - r.y0 >= minH);
}

export function skillGeometry(anchors, tabs, closeY, img) {
  const k = (anchors.wit.x - anchors.speed.x) / 906;
  const tabY = tabs.inspiration?.y ?? tabs.career?.y ?? tabs.skills?.y;
  const top = tabY + 48 * k;
  const bottom = Math.min(img.height - 4, closeY ? closeY - 95 * k : img.height - 230 * k);
  return { k, top, bottom, sx: anchors.speed.x };
}

// Binarise brown text on any card colour: text is much darker than every card background.
export function textCanvas(env, img, box, scale = 3, pad = 14, threshold = 125) {
  const b = clampBox(box, img.width, img.height);
  const c = env.createCanvas(Math.round(b.w * scale), Math.round(b.h * scale));
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = lum < threshold ? 0 : 255;
  }
  g.putImageData(d, 0, 0);
  const o = env.createCanvas(c.width + pad * 2, c.height + pad * 2), og = o.getContext("2d");
  og.fillStyle = "#fff"; og.fillRect(0, 0, o.width, o.height); og.drawImage(c, pad, pad);
  return o;
}

export async function readSkillsTab(env, worker, source, ctx) {
  const { anchors, tabs, closeY } = ctx;
  const img = toCanvas(env, source);
  const { k, top, bottom, sx } = skillGeometry(anchors, tabs, closeY, img);
  const cards = [];
  for (const [ci, off] of COL_LEFT.entries()) {
    const left = sx + off * k, width = CARD_W * k;
    for (const run of findCardRuns(img, left, width, top, bottom, k)) cards.push({ col: ci, left, width, ...run });
  }
  const heights = cards.map((c) => c.y1 - c.y0).sort((a, b) => a - b);
  const typical = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const out = [], notes = [];
  let partial = 0;
  for (const c of cards) {
    const hgt = c.y1 - c.y0;
    if (hgt < typical * 0.8) { partial++; continue; } // cut off by the scroll area
    const nameBox = { x: c.left + TEXT_X0 * k, y: c.y0 + 4 * k, w: (TEXT_X1 - TEXT_X0) * k, h: hgt - 12 * k };
    await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "6" });
    const canvas = textCanvas(env, img, nameBox);
    const { data } = await worker.recognize(env.toInput(canvas), {}, { blocks: true });
    let text = data.text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join(" ");
    // Tier glyph (○ / ◎): found from pixels, not OCR ("©" is often a plain ○, and some glyphs read as "«").
    // Rings are lighter than the lettering, so use a more permissive threshold than for the name.
    const glyph = findTierGlyph(textCanvas(env, img, nameBox, 3, 14, 150));
    if (glyph) {
      const toks = text.split(" ");
      const lastTok = toks[toks.length - 1];
      if (toks.length > 1 && lastTok.length <= 3 && !/[a-z]{2}/i.test(lastTok.replace(/[OoC]/g, ""))) toks.pop();
      text = toks.join(" ") + " " + (glyph.inner > 0.05 ? "◎" : "○");
    }
    text = text.replace(/^[|!l](?=s+[A-Z])/, "I"); // a leading "I" is often read as a bar
    const levelBox = { x: c.left + LEVEL_X0 * k, y: c.y0 + 8 * k, w: (CARD_W - LEVEL_X0 - 2) * k, h: hgt - 16 * k };
    await worker.setParameters({ tessedit_char_whitelist: "Lvl0123456789 ", tessedit_pageseg_mode: "7" });
    const lv = await worker.recognize(env.toInput(textCanvas(env, img, levelBox, 3, 10)));
    const m = lv.data.text.match(/(?:Lv[l1I]?|l)\s*([0-9])/i);
    out.push({ name: text, level: m ? Number(m[1]) : null, col: c.col, y: c.y0, confidence: data.confidence,
      box: { x: Math.round(c.left), y: c.y0, w: Math.round(c.width), h: Math.round(hgt) } });
  }
  if (partial) notes.push(`${partial} skill card(s) cut off at the edge of the list were skipped; scroll and capture again to include them.`);
  out.sort((a, b) => a.y - b.y || a.col - b.col);
  return { skills: out, notes, geometry: { k, top, bottom } };
}

// Skill names end in a tier glyph (○ / ◎ / ×) that OCR renders as O, ©, C, OO, O) and so on.
// Splits it off so the base name can be matched against the table; the tier is picked afterwards.
export function splitTier(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const m = t.match(/^(.*\S)\s+([OoC©0Q◎○◯()\]|]{1,3})$/);
  if (!m || !/[a-z]{3}/i.test(m[1])) return { base: t, tier: null, glyph: null };
  const glyph = m[2];
  const circles = (glyph.match(/[OoC©0Q◎○◯]/g) ?? []).length;
  return { base: m[1], tier: /◎/.test(glyph) || circles >= 2 ? "◎" : "○", glyph };
}

// Finds a tier glyph at the end of the name: the rightmost cluster of dark columns, roughly square,
// about one line high (60-80px at 3x) and hollow in the middle. Returns { inner } where inner is the
// fraction of dark pixels in the 0.2-0.75 radius zone: a single ring (○) leaves it empty (0.00 in all
// samples); a double ring (◎) has its inner ring there (0.13 in the one confirmed sample).
export function findTierGlyph(canvas) {
  const W = canvas.width, H = canvas.height;
  const d = canvas.getContext("2d").getImageData(0, 0, W, H).data;
  const dark = (x, y) => d[(y * W + x) * 4] < 128;
  const cols = new Array(W).fill(0);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (dark(x, y)) cols[x]++;
  let end = W - 1;
  while (end >= 0 && cols[end] === 0) end--;
  if (end < 0) return null;
  let start = end;
  while (start > 0 && (cols[start - 1] > 0 || (start > 3 && cols.slice(start - 4, start).some((c) => c > 0)))) start--;
  let prev = start - 1;
  while (prev >= 0 && cols[prev] === 0) prev--;
  const gap = prev < 0 ? start : start - prev - 1;
  if (prev >= 0 && gap < 22) return null; // a real tier glyph follows a word space; letters touch their neighbours
  let y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = start; x <= end; x++) if (dark(x, y)) { if (y < y0) y0 = y; if (y > y1) y1 = y; break; }
  const bw = end - start + 1, bh = y1 - y0 + 1;
  if (bw < 55 || bw > 90 || bh < 55 || bh > 90 || Math.abs(bw - bh) > 14) return null;
  const R = Math.min(bw, bh) / 2, cx = (start + end) / 2, cy = (y0 + y1) / 2;
  let total = 0, ink = 0, centre = 0, centreN = 0;
  for (let y = y0; y <= y1; y++) for (let x = start; x <= end; x++) {
    const r = Math.hypot(x - cx, y - cy) / R;
    if (r < 0.2) { centreN++; if (dark(x, y)) centre++; }
    if (r >= 0.2 && r < 0.75) { total++; if (dark(x, y)) ink++; }
  }
  if (!total || (centreN && centre / centreN > 0.15)) return null; // rings are hollow in the middle
  return { inner: ink / total, box: { x0: start, x1: end, y0, y1 } };
}

// Merges per-screenshot readings (the list scrolls, so captures overlap). A veteran cannot have the same
// skill twice, so duplicates collapse by name; a level seen in any capture wins over a missing one.
export function mergeSkills(readings) {
  const byName = new Map();
  for (const list of readings) for (const s of list) {
    const key = s.name.toLowerCase().replace(/[^a-z0-9○◎☆]/g, "");
    const cur = byName.get(key);
    if (!cur) byName.set(key, { ...s });
    else if (cur.level == null && s.level != null) cur.level = s.level;
  }
  return [...byName.values()];
}
