// Table loading. In the browser tables come from fetch(); in Node tests from disk.
export const TABLE_FILES = ["cards", "nicknames", "skills", "skill_icons", "programs", "scenarios",
  "saddles", "saddle_rules", "chara_program_groups", "umamusume_rating_ranks", "factors"];

export async function loadTables(base = "./data/") {
  const out = {};
  await Promise.all(TABLE_FILES.map(async (n) => { out[n] = await (await fetch(`${base}${n}.json`)).json(); }));
  return out;
}
