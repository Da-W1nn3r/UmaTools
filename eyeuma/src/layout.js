// Crop regions for the Umamusume Details header, derived from the stat labels so they survive
// different screenshot sizes/offsets and the extra rows on other players' veterans.
// All numbers were measured on 1179-1435px wide captures where Speed->Wit spans 906px.

export const STAT_KEYS = ["speed", "stamina", "power", "guts", "wit"];
const STAT_DX = [0, 226, 452, 676, 906];
const APT_DX = [277, 491, 704, 918];
const APT_DY = { track: 164, distance: 232, style: 299 };

export const APTITUDE_CELLS = [
  ["turf", "track", 0], ["dirt", "track", 1],
  ["sprint", "distance", 0], ["mile", "distance", 1], ["medium", "distance", 2], ["long", "distance", 3],
  ["front", "style", 0], ["pace", "style", 1], ["late", "style", 2], ["end", "style", 3],
];

// anchors: { speed: {x,y}, wit: {x,y} } label centres found by OCR.
export function scaleOf(anchors) {
  const dx = anchors.wit.x - anchors.speed.x;
  return dx > 0 ? dx / 906 : 1;
}

const box = (cx, cy, hw, hh) => ({ x: Math.round(cx - hw), y: Math.round(cy - hh), w: Math.round(hw * 2), h: Math.round(hh * 2) });

export function regions(anchors) {
  const k = scaleOf(anchors), { x: sx, y: sy } = anchors.speed;
  const out = { stats: {}, aptitudes: {} };
  STAT_KEYS.forEach((key, i) => { out.stats[key] = box(sx + STAT_DX[i] * k + 10 * k, sy + 65 * k, 60 * k, 27 * k); });
  out.rating = box(sx + 64 * k, sy - 62 * k, 72 * k, 26 * k);
  // Title / name / epithet / memo block: right of the portrait. Its vertical layout differs between own
  // and other players' veterans, so it is OCR'd as a whole and parsed by line.
  out.info = { x: Math.round(sx + 330 * k), y: Math.round(sy - 400 * k), w: Math.round(750 * k), h: Math.round(370 * k) };
  for (const [name, row, i] of APTITUDE_CELLS) {
    out.aptitudes[name] = box(sx + APT_DX[i] * k, sy + APT_DY[row] * k, 26 * k, 26 * k);
  }
  return out;
}

export function clampBox(b, width, height) {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  return { x, y, w: Math.max(1, Math.min(width - x, b.w)), h: Math.max(1, Math.min(height - y, b.h)) };
}
