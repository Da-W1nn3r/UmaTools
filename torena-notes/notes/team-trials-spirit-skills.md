# Team Trials report: Competitive Spirit, Lone Wolf & Sympathy

Scope: Team Trials (Team Stadium) races — **12 runners = 3 of your team + 3 opponent
+ 6 NPC bots**. Source: the game's `master.mdb` (`skill_data`, `skill_set`
200001–200032); NPC pool structure verified in-game.

## 1. Skill mechanics (from `skill_data`)

| Skill | ID | Condition (verbatim) | Meaning in a 12-runner race | Effect (whole race) | Cost |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Competitive Spirit ○ | 200282 | `running_style_count_same_rate>=40` | ≥40% of the field runs your style → **5 of 12** (4/12 = 33% fails, 5/12 = 41.7% passes; count includes the holder) | **+40 Power** | 129 |
| Competitive Spirit ◎ | 200281 | same | same | **+60 Power** | 174 |
| Lone Wolf | 201641 | `same_skill_horse_count==1` | You are the **only** runner in the entire field with Lone Wolf | **+40 Speed** | 129 |
| Sympathy | 201631 | `same_skill_horse_count>=5` | **≥5 runners** in the field have Sympathy (any team, NPCs included) | **+40 Speed** | 129 |

All are green (passive) skills, active for the whole race (`float_ability_time = -1`).
Note the asymmetry: Lone Wolf is a *denial* skill (any second holder kills it for
**everyone**), Sympathy is a *coop* skill (any holder — including the opponent's —
helps **everyone**), Competitive Spirit depends on style census, not skill census.

## 2. What the field looks like

### NPC pools (6 NPCs drawn from a race-type pool of 10 builds)

| Race type | Pool | Sympathy builds | Lone Wolf builds |
| :--- | :--- | :--- | :--- |
| Sprint | group 1 + 2 borrowed | 3/10 | **0** |
| Mile / Dirt (shared) | group 2 + 2 borrowed | 3/10 | **0** |
| Medium | group 3 + 2 borrowed | 4/10 | **3/10** |
| Long | group 4 + 2 borrowed | 4/10 | **2/10** |

NPC style layout: 2 builds per style (Front/Pace/Late/End) in each core group of 8;
the 2 borrowed builds' styles are not pinned down, modeled here as uniform over the
4 styles. Draw modeled as 6 distinct builds uniformly from the 10 (hypergeometric).

### Player meta (per user)

- Both teams spread their 3 umas across **different running styles** to maximise
  style-coverage points → at most 1–2 of any given style per player team.
- **Almost no players currently run these three skills** → opponent contribution
  ≈ 0 in the baseline case.

## 3. Lone Wolf

### Independent of the opponent (your 3 + 6 NPCs)

| Race type | P(no NPC has Lone Wolf) = activation |
| :--- | :--- |
| Sprint, Mile, Dirt | **100%** — zero LW builds exist in these pools |
| Medium | C(7,6)/C(10,6) = **3.3%** |
| Long | C(8,6)/C(10,6) = **13.3%** |

### Considering the opponent

- The only remaining failure mode in Sprint/Mile/Dirt is the opponent mirroring
  Lone Wolf. At current (near-zero) adoption this is negligible → **Lone Wolf is
  effectively a guaranteed +40 Speed green for 129 pt in Sprint, Mile and Dirt.**
- If a second player holder appears, the skill dies for *both* — it is a
  mutual-denial trap in a mirror matchup, but you can't be denied by NPCs there.
- In **Medium/Long it is a trap regardless of the opponent**: NPCs alone kill it
  96.7% / 86.7% of the time. Even one LW NPC in the field invalidates your 129 pt.

**Verdict:** strong, cheap, near-unconditional green in Sprint/Mile/Dirt;
near-dead weight in Medium/Long. Its risk scales with future popularity, not with
NPC randomness, in the short/mile/dirt pools.

## 4. Sympathy

Needs ≥5 holders total. NPC maximum is 3 (Sprint/Mile/Dirt) or 4 (Medium/Long),
so **NPCs alone can never activate it** — player copies are mandatory.

NPC Sympathy count distribution (6 drawn from pool):

| NPC holders | 0 | 1 | 2 | 3 | 4 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Sprint/Mile/Dirt (3 in pool) | 3.3% | 30.0% | 50.0% | 16.7% | — |
| Medium/Long (4 in pool) | 0.5% | 11.4% | 42.9% | 38.1% | 7.1% |

### Independent of the opponent (opponent runs 0 — current meta)

| Your copies | Sprint / Mile / Dirt | Medium / Long |
| :--- | :--- | :--- |
| 1 | **0%** (needs 4 NPCs, max 3) | 7.1% |
| 2 | 16.7% | 45.2% |
| 3 (whole team) | **66.7%** | **88.1%** |

### Considering the opponent

- Sympathy has **positive cross-team externality**: opponent copies count toward
  your threshold too. If the opponent also commits 3 copies, 3+3 = 6 ≥ 5 →
  **100% activation for both teams, every race, NPC-independent**.
- Mixed adoption helps too: your 2 + opponent 1 already reaches the same
  66.7% / 88.1% as a full solo commit; your 1 + opponent 2 likewise.
- There is no denial scenario — more adopters strictly improves everyone's
  activation. It is the opposite of Lone Wolf.

**Verdict:** a 387 pt team-wide investment that pays +40 Speed to all three umas
~2/3 of the time (Sprint/Mile/Dirt) or ~88% (Medium/Long) today, and becomes
guaranteed if the meta co-adopts. One lone copy is essentially useless
(0–7%). Medium/Long is the best habitat thanks to the 4th Sympathy NPC build.

## 5. Competitive Spirit

Needs ≥5 of 12 in your style (holder included). NPC style census per fixed style
(2 core builds + 2 borrowed modeled uniform), 6 drawn:

| NPC count of your style | 0 | 1 | 2 | 3 | 4 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Probability | 8.8% | 42.0% | 40.2% | 8.6% | 0.45% |

NPCs contribute on average only **1.5** runners of your style; 4+ is a ~0.4% tail.

### Activation probability by team composition

Opponent modeled as style-diverse (3 distinct styles ⇒ 75% chance one matches yours):

| Your team's copies of the style | Independent of opponent (need 5 from your 3 + 6 NPCs) | With style-diverse opponent |
| :--- | :--- | :--- |
| 1 (fully diverse team — the meta) | **0.45%** | **6.9%** |
| 2 (partial stack) | 9.1% | 39.2% |
| 3 (full stack) | 49.3% | 80.7% |

### Reading

- Under the point-maximising meta (both teams style-diverse), Competitive Spirit
  is **effectively dead**: <1% ignoring the opponent, ~7% even crediting the
  opponent's likely single style match. The 129/174 pt buys +40/+60 **Power**
  (not Speed) that almost never turns on.
- Making it work requires **style stacking**, which directly fights the
  style-diversity scoring the meta is built around — you'd sacrifice reliable
  score bonuses for a coin-flip green. Only a full 3-stack + opponent match
  (~81%) approaches reliability, and that composition is self-defeating in TT.
- Ironically the NPC templates themselves carry Competitive Spirit ○
  (sets 200004, 200013, 200020, 200029) — it rarely activates for them either.

## 6. Summary

| Skill | Sprint | Mile / Dirt | Medium | Long | Opponent interaction |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Lone Wolf | ~100% | ~100% | 3.3% | 13.3% | Mutual denial (mirror kills both) |
| Sympathy ×3 team | 66.7% | 66.7% | 88.1% | 88.1% | Mutual benefit (co-adoption → 100%) |
| Competitive Spirit (diverse team) | ~0.4–7% | ~0.4–7% | ~0.4–7% | ~0.4–7% | Opponent style match adds a few % |

- **Lone Wolf**: best-in-slot cheap green for Sprint/Mile/Dirt at current low
  adoption; avoid in Medium/Long. Watch the meta — popularity is its only counter
  in short/mile/dirt.
- **Sympathy**: viable only as a full-team commit; solid in Medium/Long, decent
  elsewhere, and it *improves* as more players adopt it. Never run a single copy.
- **Competitive Spirit**: structurally incompatible with Team Trials'
  style-diversity incentives; skip it (and Maverick, its inverse, suffers the
  same census problem in reverse — with diverse teams and 6 style-spread NPCs,
  being alone in a style is also rare).

## 7. Expected points (500 pt per activation, 3 umas, activation-only objective)

Objective: maximise expected score from skill activations, ignoring stat value.
EV per uma = 500 × P(activation); team EV = sum over the 3 umas. All probabilities
below use the current meta (opponent ≈ 0 adoption) unless stated.

### Per-configuration EV table (team total, pt per race)

| Configuration | Sprint / Mile / Dirt | Medium | Long |
| :--- | :--- | :--- | :--- |
| Lone Wolf ×1 | **500.0** | 16.7 | 66.7 |
| Lone Wolf ×2 or ×3 | **0** (self-denial: count ≥ 2 kills it for all holders) | 0 | 0 |
| Sympathy ×1 | 0.0 | 35.7 | 35.7 |
| Sympathy ×2 | 166.7 | 452.4 | 452.4 |
| Sympathy ×3 | **1000.0** | **1321.4** | **1321.4** |
| Competitive Spirit ×1 (diverse team) | 2.2 (34.6 w/ opp style match) | same | same |
| Competitive Spirit ×3, diverse styles | 6.7 (103.8 w/ opp) | same | same |
| Competitive Spirit ×3, stacked style | 738.8 (1210.9 w/ opp) | same | same |
| **Sympathy ×3 + Lone Wolf ×1** | **1500.0** | **1338.1** | **1388.1** |

### Why these are the optimal picks

1. **Lone Wolf: exactly one copy, never more.** A second copy on your own team
   sets `same_skill_horse_count = 2` and scores 0 for both. One copy in
   Sprint/Mile/Dirt is a near-constant **+500 pt every race** — the single most
   reliable activation of the three skills. In Medium/Long its EV (16.7 / 66.7)
   is negligible; don't bother.
2. **Sympathy is superlinear — always run 3 or 0.** The third copy doesn't just
   add its own 500 × P; it raises P for the other two copies as well. Marginal
   value of the 3rd copy: **833 pt** (Sprint/Mile/Dirt, 166.7 → 1000) and
   **869 pt** (Medium/Long, 452.4 → 1321.4). A single copy is worth 0–36 pt:
   never run 1 or 2.
3. **The two skills stack.** They census different things (skill counts are
   independent), so one uma can carry both Sympathy and Lone Wolf and double-dip
   1000 pt when both fire. Best per-race loadout:
   - Sprint / Mile / Dirt: **Sympathy ×3 + LW ×1 → EV 1500 pt** (max possible 2000)
   - Medium: **Sympathy ×3 (+ LW ×1) → EV 1338 pt**
   - Long: **Sympathy ×3 (+ LW ×1) → EV 1388 pt**
   - Full 5-race TT round (Sprint, Mile, Medium, Long, Dirt): **≈ 7226 expected pt**
     from these skills alone, vs 0 for the current no-adoption meta.
4. **Competitive Spirit loses even when you cheat for it.** Its best case —
   all 3 umas stacked in one style with CS — yields 739 pt (1211 crediting the
   opponent's style match), still below Sympathy ×3's 1000–1321, *and* it
   forfeits the style-diversity scoring that motivated spreading styles in the
   first place. Under the diverse-team meta it is worth 2–35 pt: skip entirely.

### Consistency vs expectation

Sympathy is all-or-nothing per race (all 3 copies fire together): Sprint/Mile/Dirt
payes 1500 pt in 2/3 of races and 0 in 1/3; Medium/Long pays 1500 in 88% of races.
Lone Wolf is the opposite — a steady 500. If total points across many races is the
goal, EV is the right metric and the combo wins; Medium/Long is also the lowest-
variance place to commit Sympathy.

### Meta dynamics (opponent adoption)

- **Sympathy is coordination-positive**: opponent copies count toward your 5.
  Opponent runs 1 → your EV rises to 1450 (Sprint/Mile/Dirt, needs ≥1 NPC,
  96.7%) / 1493 (Medium/Long). Opponent runs 3 → **guaranteed 1500 pt**.
  Adoption can only help you.
- **Lone Wolf is anti-coordination**: if the opponent mirrors it, both score 0.
  EV = 500 × (1 − P(opponent runs LW)). At today's near-zero adoption it's free
  money; if the meta catches on, expect this 500 to erode — it's the fragile
  half of the combo, while Sympathy is the robust half.
- Competitive Spirit gains a little from opponent style matches but never
  enough to matter.

## Caveats / assumptions

1. `running_style_count_same_rate>=40` interpreted as holders-inclusive share of
   the full field (5/12). If the game excludes the holder, the threshold becomes
   6/12 and Competitive Spirit is even worse.
2. 6 NPCs modeled as distinct uniform draws from the 10-build pool; server-side
   generation is not in the master DB.
3. The 2 borrowed builds per pool have unknown styles; modeled uniform over the
   4 styles. Core-pool-only figures shift the CS numbers by only a few points.
4. "Opponent ≈ 0 adoption" reflects the current meta per user observation;
   Lone Wolf and Sympathy probabilities move in opposite directions as adoption
   grows.
