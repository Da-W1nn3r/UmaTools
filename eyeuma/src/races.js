// Career Info race history. Each race card has: grade badge + name, a course line, and a
// "Strategy <x>  Race Time <Year, half, month>" line, with the finishing medal on the right.
// Cards are located through those text lines (not pixel colours), so any scroll offset works.
import { toCanvas } from "./ocr.js";
import { textCanvas } from "./skills.js";
import { editDistance } from "./match.js";

const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const YEAR = { junior: 0, classic: 1, senior: 2 };

// "Classic Year Late Nov" -> {year:1, half:2, month:11};  "Late Jan TS Climax" -> {year:null,...}
export function parseRaceDate(text) {
  const t = String(text ?? "").replace(/[|~]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = t.split(" ");
  // OCR slips ("Earlv", "Clasic") are tolerated by edit distance against the closed vocabularies.
  const near = (tok, words, max) => {
    let best = null;
    for (const w of words) { const d = editDistance(tok.toLowerCase(), w); if (d <= max && (!best || d < best.d)) best = { w, d }; }
    return best?.w ?? null;
  };
  let year = null, half = null, month = null;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/[^A-Za-z]/g, "");
    if (!tok) continue;
    if (year == null && tok.length >= 5) { const y = near(tok, Object.keys(YEAR), 2); if (y) { year = YEAR[y]; continue; } }
    if (half == null && tok.length >= 4) {
      const h = near(tok, ["early", "late"], 1);
      if (h) { half = h === "early" ? 1 : 2; const nxt = (tokens[i + 1] ?? "").replace(/[^A-Za-z]/g, ""); const mo = near(nxt, Object.keys(MONTH), nxt.length === 3 ? 0 : 1); if (mo) month = MONTH[mo]; continue; }
    }
    if (half == null && tok.length === 4) { const h = near(tok, ["late"], 1); if (h) { half = 2; const nxt = (tokens[i + 1] ?? "").replace(/[^A-Za-z]/g, ""); const mo = near(nxt, Object.keys(MONTH), 0); if (mo) month = MONTH[mo]; } }
  }
  if (half == null || month == null) return null;
  return { year, half, month };
}

// Ordinal text -> number. Accepts "1st", "2nd", "3rd", "6th", "18th" and common OCR slips.
export function parseOrdinal(text) {
  const m = String(text ?? "").replace(/\s+/g, "").match(/^(\d{1,2})(?:st|nd|rd|th|ih|tn|h)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 30 ? n : null;
}

// The name line carries a grade badge on the left (G1, EX, DEBUT ... or an icon that OCR reads as "@Z®" / "ED")
// and a few stray marks on the right (medal edge, "|", "Ni,", "Jy,"). Keep the longest run of words that
// look like a name: the badge is a leading token of <=3 chars, junk is a trailing token of <=3 chars.
export function cleanRaceName(text) {
  let toks = String(text ?? "").replace(/[|~]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  // A lone digit is a race number ("Twinkle Star Climax Race 2"), never junk.
  const junk = (t) => !/^\d$/.test(t) && t.replace(/[^A-Za-z0-9]/g, "").length <= 3 && !/^(of|the|ii|iii|s\.|jc|jcc|c\.|cup|sho|hai|jbc)$/i.test(t.replace(/[^A-Za-z.0-9]/g, ""));
  while (toks.length > 1 && /^(?:G[123]|EX|DEBUT|OP|PRE-?OP|L)$/i.test(toks[0])) toks.shift();
  while (toks.length > 1 && !/[A-Za-z]{3}/.test(toks[0])) toks.shift();            // "@Z®", "ED", "="
  while (toks.length > 1 && junk(toks[toks.length - 1]) && !/[)\]]$/.test(toks[toks.length - 1])) toks.pop(); // "Ni,", "Jy,"
  return toks.join(" ").trim();
}

// lines: [{ text, y0, y1 }] sorted by y. Groups into race cards; returns { cards, partial } where a card is
// complete only if both its name line and its strategy line were captured.
export function groupRaceLines(lines, k = 1) {
  const isStrategy = (t) => /race\s*time/i.test(t) || /^\W{0,3}strateg/i.test(t);
  const isCourse = (t) => /\d{3,4}\s*m\b/i.test(t) || /\((?:sprint|mile|medium|long)\)/i.test(t);
  const cards = [];
  let partial = 0;
  lines.forEach((l, i) => {
    if (!isStrategy(l.text)) return;
    // course line = nearest course-looking line above; name line = nearest non-course line above that
    let course = null, name = null;
    for (let j = i - 1; j >= 0 && l.y0 - lines[j].y0 < 230 * k; j--) {
      if (!course && isCourse(lines[j].text)) { course = lines[j]; continue; }
      if (course && !isStrategy(lines[j].text) && !isCourse(lines[j].text) && course.y0 - lines[j].y0 < 130 * k) { name = lines[j]; break; }
    }
    if (!course || !name) { partial++; return; }
    cards.push({ name, course, strategy: l });
  });
  // a name line with no strategy line below it is a card cut off at the bottom
  lines.forEach((l, i) => {
    if (isStrategy(l.text) || isCourse(l.text)) return;
    const hasStrategy = lines.slice(i + 1).some((m) => isStrategy(m.text) && m.y0 - l.y0 < 260 * k);
    const hasCourse = lines.slice(i + 1).some((m) => isCourse(m.text) && m.y0 - l.y0 < 150 * k);
    if (hasCourse && !hasStrategy && /[A-Za-z]{3}/.test(l.text) && !/^(race\s*history|career)/i.test(l.text)) partial++;
  });
  return { cards, partial };
}

export async function readRaceHistory(env, worker, source, ctx) {
  const img = toCanvas(env, source);
  const { anchors, tabs, closeY } = ctx;
  const k = (anchors.wit.x - anchors.speed.x) / 906, sx = anchors.speed.x;
  const tabY = (tabs.career ?? tabs.inspiration ?? tabs.skills).y;
  const top = Math.round(tabY + 40 * k), bottom = Math.round(closeY ? closeY - 90 * k : img.height - 230 * k);
  const list = env.createCanvas(img.width, bottom - top);
  list.getContext("2d").drawImage(img, 0, top, img.width, bottom - top, 0, 0, img.width, bottom - top);
  await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "6" });
  const { data } = await worker.recognize(env.toInput(list), {}, { blocks: true });
  const lines = data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
    .map((l) => ({ text: l.text.trim(), y0: l.bbox.y0 + top, y1: l.bbox.y1 + top, x0: l.bbox.x0 }))
    .sort((a, b) => a.y0 - b.y0);
  const { cards, partial } = groupRaceLines(lines, k);

  const races = [];
  for (const c of cards) {
    const h = c.name.y1 - c.name.y0;
    // name: the first-pass line, with the badge and trailing marks stripped
    const name = cleanRaceName(c.name.text);
    // date: text after "Race Time" on the strategy line; if it does not parse, re-read just that line
    let dm = c.strategy.text.match(/race\s*time(.*)$/i);
    let date = parseRaceDate(dm ? dm[1] : c.strategy.text);
    if (!date) {
      const lineBox = { x: sx + 10 * k, y: c.strategy.y0 - 6 * k, w: 765 * k, h: c.strategy.y1 - c.strategy.y0 + 12 * k };
      for (const th of [150, 175, 125]) {
        await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "7" });
        const re = await worker.recognize(env.toInput(textCanvas(env, img, lineBox, 2, 12, th)));
        const m2 = re.data.text.match(/race\s*time(.*)$/i);
        const d2 = parseRaceDate(m2 ? m2[1] : re.data.text);
        if (d2) { date = d2; dm = m2; c.strategy.text = re.data.text; break; }
      }
    }
    const strat = c.strategy.text.match(/strateg\w*\s+(front|pace|late|end)/i);
    // rank medal: 1st/2nd/3rd are coloured medals (read by colour); 4th and below are brown numerals (OCR)
    const rankBox = { x: sx + 790 * k, y: c.name.y0 - 10 * k, w: 170 * k, h: 150 * k };
    const medal = medalFromColour(img, rankBox);
    let rank = medal.rank, rankText = medal.kind;
    if (rank == null && medal.kind === "numeral") {
      const digits = await readNumeral(env, worker, img, rankBox);
      rank = digits.rank; rankText = digits.text;
    }
    races.push({
      name, year: date?.year ?? null, month: date?.month ?? null, half: date?.half ?? null,
      strategy: strat ? strat[1].toLowerCase() : null,
      rank, rankText, dateText: dm ? dm[1].trim() : null,
      y: c.name.y0, raw: { name: c.name.text, strategy: c.strategy.text },
      box: { x: Math.round(sx), y: Math.round(c.name.y0 - 12 * k), w: Math.round(960 * k), h: Math.round(c.strategy.y1 - c.name.y0 + 24 * k) },
    });
  }
  return { races, partial, lines };
}

// Merges captures of the scrolling list. The same race can never appear twice in one veteran's history, so
// name + date identifies it. Order is not needed here: the assembler sorts by turn.
export function mergeRaces(readings) {
  const out = new Map();
  for (const list of readings) for (const r of list) {
    if (!r.name) continue;
    const key = `${r.name.toLowerCase().replace(/[^a-z0-9]/g, "")}|${r.year}|${r.month}|${r.half}`;
    const cur = out.get(key);
    if (!cur) out.set(key, { ...r });
    else for (const f of ["rank", "strategy"]) if (cur[f] == null && r[f] != null) cur[f] = r[f];
  }
  // A card whose date line was unreadable (blur at the list edge) is the same race as a dated card of the
  // same name from another capture: drop it rather than reporting a race with no date.
  const nameKey = (r) => r.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dated = new Set([...out.values()].filter((r) => r.month != null).map(nameKey));
  return [...out.values()].filter((r) => r.month != null || !dated.has(nameKey(r)));
}

// Share of medal-coloured pixels. Measured on 47 real medals: 1st is ~0.18-0.29 gold, 2nd ~0.22-0.30 silver-blue,
// 3rd has bronze ~0.08 with a little gold, and 4th+ is dark-brown digits with almost no gold.
export function medalFromColour(img, b) {
  const x = Math.max(0, Math.round(b.x)), y = Math.max(0, Math.round(b.y));
  const w = Math.min(img.width - x, Math.round(b.w)), h = Math.min(img.height - y, Math.round(b.h));
  if (w < 20 || h < 20) return { rank: null, kind: "cutoff" };
  const d = img.getContext("2d").getImageData(x, y, w, h).data;
  let n = 0, gold = 0, silver = 0, bronze = 0, brown = 0;
  for (let p = 0; p < d.length; p += 4) {
    const r = d[p], g = d[p + 1], bl = d[p + 2]; n++;
    if (r > 215 && g > 150 && g < 235 && bl < 110) gold++;
    else if (bl > r + 12 && bl > 150 && r < 215) silver++;
    else if (r > 200 && g > 110 && g < 190 && bl > 90 && bl < 170 && r - bl > 50) bronze++;
    else if (r < 140 && g < 110 && bl < 90 && r > bl + 15) brown++;
  }
  const f = (v) => v / n;
  if (f(gold) > 0.12) return { rank: 1, kind: "1st" };
  if (f(silver) > 0.12) return { rank: 2, kind: "2nd" };
  if (f(bronze) > 0.05 && f(gold) < 0.1) return { rank: 3, kind: "3rd" };
  if (f(brown) > 0.03) return { rank: null, kind: "numeral" };
  return { rank: null, kind: "unknown" };
}

// Brown-ink mask of a region: dark-ish and warmer than the white card.
function inkMask(img, b, lumMax, fill = false) {
  const x = Math.round(b.x), y = Math.round(b.y), W = Math.round(b.w), H = Math.round(b.h);
  const src = img.getContext("2d").getImageData(x, y, W, H).data;
  const m = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < src.length; p += 4, i++) {
    const lum = 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2];
    m[i] = lum < lumMax && src[p] - src[p + 2] > 10 ? 1 : 0;
  }
  if (!fill) return { m, W, H };
  // 4th-5th are drawn as a cream fill inside a brown outline (6th and below are solid brown). Fill every
  // region that is enclosed by outline, i.e. not connected to the border through non-ink pixels.
  const outside = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => { const i = y * W + x; if (!m[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i - x) / W;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  for (let i = 0; i < m.length; i++) if (!outside[i]) m[i] = 1;
  return { m, W, H };
}

// The tall glyphs of "16th" are the digits; "th" is much shorter. Returns the digits' bounding box.
function digitBox({ m, W, H }) {
  const cols = [];
  for (let x = 0; x < W; x++) {
    let t = -1, bt = -1;
    for (let y = 0; y < H; y++) if (m[y * W + x]) { if (t < 0) t = y; bt = y; }
    cols.push(t < 0 ? null : [t, bt]);
  }
  const groups = []; let cur = null, gap = 0;
  for (let x = 0; x < W; x++) {
    if (cols[x]) {
      gap = 0;
      if (!cur) cur = { x0: x, x1: x, t: cols[x][0], b: cols[x][1] };
      else { cur.x1 = x; cur.t = Math.min(cur.t, cols[x][0]); cur.b = Math.max(cur.b, cols[x][1]); }
    } else if (cur && ++gap > 3) { groups.push(cur); cur = null; gap = 0; }
  }
  if (cur) groups.push(cur);
  const g = groups.filter((q) => q.x1 - q.x0 >= 4);
  if (!g.length) return null;
  const maxH = Math.max(...g.map((q) => q.b - q.t + 1));
  const big = g.filter((q) => q.b - q.t + 1 >= maxH * 0.7);
  return { x0: Math.min(...big.map((q) => q.x0)), x1: Math.max(...big.map((q) => q.x1)), t: Math.min(...big.map((q) => q.t)), b: Math.max(...big.map((q) => q.b)) };
}

function renderMask(env, { m, W }, bx, scale, pad = 30) {
  const w = bx.x1 - bx.x0 + 1, h = bx.b - bx.t + 1;
  const t = env.createCanvas(w, h), tg = t.getContext("2d"), id = tg.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4, on = m[(bx.t + y) * W + bx.x0 + x];
    id.data[p] = id.data[p + 1] = id.data[p + 2] = on ? 0 : 255; id.data[p + 3] = 255;
  }
  tg.putImageData(id, 0, 0);
  const o = env.createCanvas(w * scale + pad * 2, h * scale + pad * 2), og = o.getContext("2d");
  og.fillStyle = "#fff"; og.fillRect(0, 0, o.width, o.height);
  og.imageSmoothingEnabled = false; og.drawImage(t, pad, pad, w * scale, h * scale);
  return o;
}

// "4th" and below: brown numerals. The digit glyphs are isolated from the mask and OCR'd under several
// thresholds / scales / modes; the most common answer wins. A tie or low agreement is reported, not guessed.
export async function readNumeral(env, worker, img, b) {
  const votes = {};
  let total = 0;
  // 4th-5th have a cream fill inside a brown outline, 6th+ are solid brown: both renderings are tried and
  // the votes pooled, because filling helps one style and hurts the other.
  for (const [lm, fill] of [[110, false], [140, false], [170, false], [110, true], [140, true], [170, true]]) {
    const mk = inkMask(img, b, lm, fill), bx = digitBox(mk);
    if (!bx) continue;
    for (const sc of [1, 2]) for (const psm of ["8", "7", "10"]) {
      await worker.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: psm });
      const { data } = await worker.recognize(env.toInput(renderMask(env, mk, bx, sc)));
      const t = data.text.replace(/[^0-9]/g, "");
      total++;
      if (t) votes[t] = (votes[t] ?? 0) + 1;
    }
  }
  const ranked = Object.entries(votes).sort((a, c) => c[1] - a[1]);
  if (!ranked.length) return { rank: null, text: "", agreement: 0 };
  const [text, n] = ranked[0];
  const rank = Number(text);
  const tie = ranked[1] && ranked[1][1] === n;
  return { rank: rank >= 1 && rank <= 30 && !tie ? rank : null, text, agreement: n / total, votes };
}
