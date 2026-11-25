// Header reader. Environment-agnostic: the caller supplies canvas helpers and a tesseract worker
// (browser: OffscreenCanvas/HTMLCanvasElement + tesseract.js; node: @napi-rs/canvas).
import { regions, clampBox } from "./layout.js";

// Draw a crop, upscale, convert to high-contrast grayscale.
export function prepare(env, img, box, scale = 2, { ink = false, white = false, pad = 0 } = {}) {
  const b = clampBox(box, img.width, img.height);
  const c = env.createCanvas(Math.round(b.w * scale), Math.round(b.h * scale));
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    let v = ink ? Math.min(px[i], px[i + 1], px[i + 2]) : 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (white) { v = Math.min(px[i], px[i + 1], px[i + 2]) > 225 ? 0 : 255; px[i] = px[i + 1] = px[i + 2] = v; continue; }
    if (ink) { v = v < 205 ? 0 : 255; px[i] = px[i + 1] = px[i + 2] = v; continue; }
    // Brown UI numerals: push everything bright to white, keep dark strokes.
    v = v > 150 ? 255 : v * 0.5;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  if (!pad) return c;
  const o = env.createCanvas(c.width + pad * 2, c.height + pad * 2), og = o.getContext("2d");
  og.fillStyle = "#fff"; og.fillRect(0, 0, o.width, o.height); og.drawImage(c, pad, pad);
  return o;
}

async function ocrWords(env, worker, img) {
  await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "3" });
  const { data } = await worker.recognize(env.toInput(img), {}, { blocks: true });
  return data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
}

// Loaded images (Image / @napi-rs Image) cannot be encoded or sampled directly: always work on a canvas.
export function toCanvas(env, source) {
  if (typeof source.toBuffer === "function" || (source.getContext && !source.src)) return source;
  const c = env.createCanvas(source.width, source.height);
  c.getContext("2d").drawImage(source, 0, 0);
  return c;
}

export async function findAnchors(env, worker, source) {
  const img = toCanvas(env, source);
  const words = await ocrWords(env, worker, img);
  const find = (re) => { const w = words.find((x) => re.test(x.text)); return w && { x: (w.bbox.x0 + w.bbox.x1) / 2, y: (w.bbox.y0 + w.bbox.y1) / 2 }; };
  const anchors = { speed: find(/^speed/i), wit: find(/^wit/i) };
  const tabs = { skills: find(/^skills/i), inspiration: find(/^inspiration/i), career: find(/^career/i) };
  anchors.derived = false;
  if (!anchors.speed || !anchors.wit) {
    // White-on-green stat labels are sometimes missed. Track/Distance/Style are reliable, and the
    // dialog has had the same pixel scale in every capture seen (Track->Style = 141px).
    const track = find(/^track/i), style = find(/^style/i);
    if (track && style && style.y > track.y) {
      const k = (style.y - track.y) / 141;
      anchors.speed = { x: track.x + 6 * k, y: track.y - 164 * k };
      anchors.wit = { x: anchors.speed.x + 906 * k, y: anchors.speed.y };
      anchors.derived = true;
    }
  }
  const close = words.find((x) => /^close$/i.test(x.text));
  const closeY = close ? (close.bbox.y0 + close.bbox.y1) / 2 : null;
  return { anchors, tabs, words, closeY };
}

// Rows (within a box) that contain dark digit ink, used to trim crops to the digits themselves.
export function inkRows(img, box) {
  const b = clampBox(box, img.width, img.height);
  const d = img.getContext("2d").getImageData(b.x, b.y, b.w, b.h).data;
  const rows = [];
  for (let y = 0; y < b.h; y++) {
    let n = 0;
    for (let x = 0; x < b.w; x++) {
      const p = (y * b.w + x) * 4;
      const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
      if (lum < 130 && d[p] > d[p + 2] + 15) n++; // dark and brownish
    }
    rows.push(n);
  }
  return { top: b.y, rows };
}

export function trimToDigits(img, box) {
  const { top, rows } = inkRows(img, box);
  // Largest cluster of ink rows (gaps up to 3 rows allowed): ignores stray ink from neighbouring art.
  let best = null, cur = null;
  rows.forEach((n, i) => {
    if (n >= 3) { if (cur && i - cur.end <= 4) cur.end = i; else { cur = { start: i, end: i, count: 0 }; } cur.count++; if (!best || cur.count > best.count) best = cur; }
  });
  if (!best || best.count < 8) return box;
  const y0 = top + best.start - 4, y1 = top + best.end + 6;
  return { x: box.x, y: y0, w: box.w, h: y1 - y0 };
}

export async function readNumber(env, worker, img, box, { commas = false } = {}) {
  await worker.setParameters({ tessedit_char_whitelist: commas ? "0123456789," : "0123456789", tessedit_pageseg_mode: "7" });
  const { data } = await worker.recognize(env.toInput(prepare(env, img, trimToDigits(img, box), 2, { pad: 16 })));
  const txt = data.text.replace(/[^0-9]/g, "");
  return { value: txt ? Number(txt) : null, confidence: data.confidence };
}

export async function readInfo(env, worker, img, box) {
  await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "6" });
  const lines = (t) => t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const plain = await worker.recognize(env.toInput(prepare(env, img, box, 2)));
  const white = await worker.recognize(env.toInput(prepare(env, img, box, 2, { white: true })));
  return { plain: lines(plain.data.text), white: lines(white.data.text) };
}

const clean = (l) => l.replace(/\s+/g, " ").trim();
const dropLeadingJunk = (l) => clean(l).replace(/^(?:\S{1,2}\s+)+(?=\S{3,})/, "");

// info = { plain, white } line lists. The plain pass reads dark text ([Title], Name, memo, Trainer);
// the white pass reads white-on-banner text (the epithet). Stray icon/button tokens are common, so
// epithet candidates are returned for table matching instead of guessing a single line here.
export function parseInfo(info) {
  const { plain, white } = info;
  const out = { title: null, name: null, epithetCandidates: [], memo: null, trainer: null, info };
  const t = plain.findIndex((l) => /[\[\]]/.test(l));
  if (t >= 0) {
    const m = plain[t].match(/\[?([^\[\]]+)\]/);
    out.title = clean((m ? m[1] : plain[t]).replace(/[^A-Za-z0-9 '!?.,:-]/g, " "));
    out.name = dropLeadingJunk(plain[t + 1] ?? "").replace(/[^A-Za-z0-9 '.-]/g, " ").replace(/\s+/g, " ").trim() || null;
  }
  const strip = (l) => clean(l).replace(/\s*Change$/i, "").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9!?.)]+$/g, "");
  const cands = [...white, ...plain.slice(Math.max(t + 2, 0))].map(strip).filter((l) => l.length >= 4);
  out.epithetCandidates = [...new Set(cands)];
  const tr = plain.findIndex((l) => /[^a-z]rainer[^a-z]|^rainer[^a-z]/i.test(l));
  if (tr >= 0) out.trainer = clean(plain[tr].replace(/^.*?rainer[ ]*/i, "")) || null;
  else {
    const last = plain[plain.length - 1];
    if (plain.length > t + 3 && last) out.memo = strip(last.replace(/\s+\S{1,2}$/, "")) || null;
  }
  return out;
}

// Aptitude grade letters are stylized glyphs that OCR reads poorly, but each grade has its own ink
// colour. Mean ink colour (non-background pixels) of the cell is matched to the nearest reference.
// References were measured on a handful of screenshots, so a weak margin is reported as a warning.
export const GRADE_COLORS = {
  A: [230, 147, 89], B: [230, 130, 161], C: [132, 203, 109], D: [124, 194, 235],
  E: [200, 124, 223], F: [148, 141, 213], G: [138, 136, 138], S: [217, 173, 73],
};

export function inkColor(env, img, box) {
  const b = clampBox(box, img.width, img.height);
  const d = img.getContext("2d").getImageData(b.x, b.y, b.w, b.h).data;
  let r = 0, g = 0, bl = 0, n = 0;
  for (let p = 0; p < d.length; p += 4) {
    const mn = Math.min(d[p], d[p + 1], d[p + 2]), mx = Math.max(d[p], d[p + 1], d[p + 2]);
    if (mn < 190 && !(mx > 235 && mn > 200)) { r += d[p]; g += d[p + 1]; bl += d[p + 2]; n++; }
  }
  return n < 150 ? null : [r / n, g / n, bl / n];
}

export function nearestGrade(rgb) {
  const ranked = Object.entries(GRADE_COLORS)
    .map(([k, c]) => [k, Math.hypot(rgb[0] - c[0], rgb[1] - c[1], rgb[2] - c[2])])
    .sort((a, b) => a[1] - b[1]);
  return { letter: ranked[0][0], distance: ranked[0][1], margin: ranked[1][1] - ranked[0][1] };
}

export async function readAptitudes(env, worker, img, boxes) {
  const out = {}, conf = {};
  for (const [name, box] of Object.entries(boxes)) {
    const rgb = inkColor(env, img, box);
    if (!rgb) { out[name] = null; conf[name] = 0; continue; }
    const g = nearestGrade(rgb);
    out[name] = g.letter;
    // confidence: 100 when very close to its reference and well separated from the runner-up
    conf[name] = Math.max(0, Math.min(100, 100 - g.distance * 2 + Math.min(g.margin, 30)));
  }
  return { letters: out, conf };
}

export async function readHeader(env, worker, source, pre = null) {
  const warnings = [];
  const img = toCanvas(env, source);
  const { anchors, tabs } = pre ?? await findAnchors(env, worker, img);
  if (!anchors.speed || !anchors.wit) {
    return { header: null, tabs, warnings: ["Could not locate the stat row: is this the Umamusume Details dialog?"] };
  }
  const R = regions(anchors);
  const stats = {}, conf = {};
  for (const [k, box] of Object.entries(R.stats)) {
    const r = await readNumber(env, worker, img, box);
    stats[k === "wit" ? "wiz" : k] = r.value; conf[k] = r.confidence;
    if (r.value == null || r.confidence < 60) warnings.push(`Low confidence reading ${k} (${r.value ?? "?"})`);
  }
  const rating = await readNumber(env, worker, img, R.rating, { commas: true });
  if (rating.value == null) warnings.push("Rating not read");
  const info = parseInfo(await readInfo(env, worker, img, R.info));
  const apt = await readAptitudes(env, worker, img, R.aptitudes);
  for (const [k, c] of Object.entries(apt.conf)) if (!apt.letters[k] || c < 50) warnings.push(`Low confidence reading aptitude ${k} (${apt.letters[k] ?? "?"})`);
  return { header: { title: info.title, name: info.name, epithetCandidates: info.epithetCandidates, memo: info.memo, rating: rating.value, stats, aptitudes: apt.letters, trainer: info.trainer }, tabs, info, confidence: conf, warnings, regions: R };
}

// Locate the Skills / Inspiration / Career Info tab row. The active tab is white on green and the
// others dark on white, so the band below the aptitude rows is read in both polarities.
export async function findTabs(env, worker, img, anchors) {
  const k = (anchors.wit.x - anchors.speed.x) / 906;
  const y0 = Math.round(anchors.speed.y + 300 * k), y1 = Math.min(img.height, Math.round(anchors.speed.y + 760 * k));
  const box = { x: 0, y: y0, w: img.width, h: y1 - y0 };
  const found = {};
  await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "11" });
  for (const opts of [{ scale: 1 }, { scale: 1, white: true }]) {
    const c = prepare(env, img, box, opts.scale, { white: opts.white, pad: 8 });
    const { data } = await worker.recognize(env.toInput(c), {}, { blocks: true });
    const words = data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
    for (const w of words) {
      const key = /^skills?$/i.test(w.text) ? "skills" : /^inspirat/i.test(w.text) ? "inspiration" : /^career/i.test(w.text) ? "career" : null;
      if (!key) continue;
      const x = (w.bbox.x0 + w.bbox.x1) / 2 - 8;
      // The "Career" section heading on the Career Info page also matches: the tab is in the right third.
      if (key === "career" && x < anchors.speed.x + 560 * k) continue;
      if (!found[key]) found[key] = { x, y: y0 + (w.bbox.y0 + w.bbox.y1) / 2 - 8 };
    }
  }
  return found;
}

// The active tab is filled green; the inactive ones are white/grey. Sample just beside each label.
export function activeTab(img, tabs, anchors) {
  const k = (anchors.wit.x - anchors.speed.x) / 906;
  const g = img.getContext("2d");
  let best = null;
  for (const [name, t] of Object.entries(tabs)) {
    if (!t) continue;
    const x0 = Math.max(0, Math.round(t.x - 90 * k)), w = Math.round(180 * k), y = Math.round(t.y + 14 * k);
    const d = g.getImageData(x0, y, Math.min(w, img.width - x0), 6).data;
    let green = 0, n = 0;
    for (let p = 0; p < d.length; p += 4) { n++; if (d[p + 1] > 150 && d[p] < 160 && d[p + 2] < 90 && d[p + 1] - d[p + 2] > 90) green++; }
    const frac = green / n;
    if (!best || frac > best.frac) best = { name, frac };
  }
  return best && best.frac > 0.3 ? best.name : null;
}
