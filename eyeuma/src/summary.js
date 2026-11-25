// Career Info summary block: Races / Wins, Fans Earned, Major Wins, Career Scenario, Rating, Date Acquired.
// The list scrolls, so the block may be absent, partly visible, or at any vertical offset: lines are
// found by their labels, never by position.
import { toCanvas } from "./ocr.js";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "Nov 10, 2026" -> "2026-11-10"; also accepts the stored form and dd/mm/yyyy-like text is NOT guessed.
export function parseDate(text) {
  const t = String(text ?? "").replace(/[|~]/g, " ").trim();
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*,?\s*(\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
  }
  return null;
}

const num = (s) => { const d = String(s ?? "").replace(/[^0-9]/g, ""); return d ? Number(d) : null; };

// lines: [{ text, y }] in reading order. Returns what was found; absent fields are null.
export function parseSummary(lines) {
  const out = { races: null, wins: null, fans: null, majorWins: null, scenario: null, rating: null, date: null, found: [] };
  const txt = lines.map((l) => l.text.replace(/\s+/g, " ").trim());
  const idx = (re) => txt.findIndex((l) => re.test(l));
  const after = (re) => { const l = txt[idx(re)]; return l == null ? null : l.replace(re, "").replace(/^[\s~|:-]+/, "").trim(); };

  const rec = idx(/career\s*record/i);
  if (rec >= 0) {
    const m = txt[rec].match(/races\D{0,3}(\d+).*?wins\D{0,3}(\d+)/i);
    if (m) { out.races = Number(m[1]); out.wins = Number(m[2]); out.found.push("record"); }
  }
  if (idx(/fans\s*earned/i) >= 0) { out.fans = num(after(/^.*?fans\s*earned/i)); if (out.fans != null) out.found.push("fans"); }
  if (idx(/major\s*wins/i) >= 0) { out.majorWins = after(/^.*?major\s*wins/i) || null; }
  const sc = idx(/career\s*scenario/i);
  if (sc >= 0) {
    const parts = [after(/^.*?career\s*scenario/i)];
    // Continuation lines (long names wrap). OCR can interleave a line from the neighbouring label, so
    // lines that carry another label are skipped instead of being appended.
    const OTHER = /(career\s*record|fans\s*earned|major\s*wins|date\s*acquired|race\s*history)/i;
    for (let i = sc + 1; i < txt.length && !/^(rating|date\s*acquired|race\s*history)/i.test(txt[i]); i++) {
      if (!OTHER.test(txt[i])) parts.push(txt[i]);
    }
    out.scenario = parts.filter(Boolean).join(" ").replace(/[|~]/g, " ").replace(/\s+/g, " ").trim() || null;
    if (out.scenario) out.found.push("scenario");
  }
  if (idx(/^.{0,12}rating/i) >= 0) { out.rating = num(after(/^.*?rating/i)); if (out.rating != null) out.found.push("rating"); }
  if (idx(/date\s*acquired/i) >= 0) { out.date = parseDate(after(/^.*?date\s*acquired/i)); if (out.date) out.found.push("date"); }
  return out;
}

export async function readSummary(env, worker, source, ctx) {
  const img = toCanvas(env, source);
  const { tabs, closeY } = ctx;
  const tabY = (tabs.career ?? tabs.inspiration ?? tabs.skills).y;
  const bottom = closeY ? closeY - 90 : img.height - 230;
  const box = { x: 0, y: Math.round(tabY + 40), w: img.width, h: Math.round(bottom - tabY - 40) };
  const c = env.createCanvas(box.w, box.h);
  c.getContext("2d").drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "6" });
  const { data } = await worker.recognize(env.toInput(c), {}, { blocks: true });
  const lines = data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)).map((l) => ({ text: l.text.trim(), y: l.bbox.y0 }));
  lines.sort((a, b) => a.y - b.y);
  return { summary: parseSummary(lines), lines, box };
}

// Combines readings from several Career Info captures: the first non-null value for each field wins.
export function mergeSummaries(list) {
  const out = { races: null, wins: null, fans: null, majorWins: null, scenario: null, rating: null, date: null };
  for (const s of list) for (const k of Object.keys(out)) if (out[k] == null && s[k] != null) out[k] = s[k];
  if (Object.values(out).every((v) => v == null)) return null;
  // Keep the crop of the capture that saw the scenario, for the review panel.
  const src = list.find((s) => s.scenario != null) ?? list[0];
  if (src?.shot) out.shot = src.shot;
  if (src?.box) out.box = src.box;
  return out;
}
