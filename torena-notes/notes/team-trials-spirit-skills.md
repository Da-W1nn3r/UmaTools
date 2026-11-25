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

### NPC pools (6 NPCs drawn from a race-type pool of 8 builds)

| Race type | Pool | Sympathy builds | Lone Wolf builds |
| :--- | :--- | :--- | :--- |
| Sprint | group 1 (200001–200008) | 3/8 | **0** |
| Mile / Dirt (shared) | group 2 (200009–200016) | 3/8 | **0** |
| Medium | group 3 (200017–200024) | 3/8 | **3/8** |
| Long | group 4 (200025–200032) | 3/8 | **2/8** |

NPC style layout: exactly 2 builds per style (Front/Pace/Late/End) in each pool
of 8. Draw modeled as 6 distinct builds uniformly from the 8 (hypergeometric).

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
| Medium | **0%** — only 5 non-LW builds exist, so a 6-draw always includes ≥1 LW NPC |
| Long | C(6,6)/C(8,6) = 1/28 = **3.6%** |

### Considering the opponent

- The only remaining failure mode in Sprint/Mile/Dirt is the opponent mirroring
  Lone Wolf. At current (near-zero) adoption this is negligible → **Lone Wolf is
  effectively a guaranteed +40 Speed green for 129 pt in Sprint, Mile and Dirt.**
- If a second player holder appears, the skill dies for *both* — it is a
  mutual-denial trap in a mirror matchup, but you can't be denied by NPCs there.
- In **Medium/Long it is a trap regardless of the opponent**: NPCs alone kill it
  100% / 96.4% of the time. In Medium it can *never* activate.

**Verdict:** strong, cheap, near-unconditional green in Sprint/Mile/Dirt;
dead weight in Medium/Long (literally 0% in Medium). Its risk scales with future
popularity, not with NPC randomness, in the short/mile/dirt pools.

## 4. Sympathy

Needs ≥5 holders total. NPC maximum is 3 in every pool, so **NPCs alone can never
activate it** — player copies are mandatory. And because only 5 builds in each
pool lack Sympathy, a 6-draw **always includes at least one** Sympathy NPC.

NPC Sympathy count distribution (6 drawn from pool of 8, identical for every
race type):

| NPC holders | 0 | 1 | 2 | 3 |
| :--- | :--- | :--- | :--- | :--- |
| All race types (3 in pool) | **0%** | 10.7% | 53.6% | 35.7% |

### Independent of the opponent (opponent runs 0 — current meta)

| Your copies | Activation (all race types) |
| :--- | :--- |
| 1 | **0%** (needs 4 NPCs, max 3) |
| 2 | 35.7% |
| 3 (whole team) | **89.3%** |

### Considering the opponent

- Sympathy has **positive cross-team externality**: opponent copies count toward
  your threshold too. If the opponent also commits 3 copies, 3+3 = 6 ≥ 5 →
  **100% activation for both teams, every race, NPC-independent**.
- Even **one** opponent copy completes a full-team commit: your 3 + their 1 = 4,
  and the draw guarantees ≥1 Sympathy NPC → **100% activation**.
- Mixed adoption helps too: your 2 + opponent 1 already reaches the same 89.3%
  as a full solo commit; your 1 + opponent 2 likewise.
- There is no denial scenario — more adopters strictly improves everyone's
  activation. It is the opposite of Lone Wolf.

**Verdict:** a 387 pt team-wide investment that pays +40 Speed to all three umas
in ~89% of races today — equally in every race type — and becomes guaranteed if
the opponent runs even a single copy. One lone copy is useless (0%).

## 5. Competitive Spirit

Needs ≥5 of 12 in your style (holder included). NPC style census per fixed style
(exactly 2 builds of each style in the pool of 8), 6 drawn:

| NPC count of your style | 0 | 1 | 2 |
| :--- | :--- | :--- | :--- |
| Probability | 3.6% | 42.9% | 53.6% |

NPCs contribute on average only **1.5** runners of your style — and can never
contribute more than 2.

### Activation probability by team composition

Opponent modeled as style-diverse (3 distinct styles ⇒ 75% chance one matches yours):

| Your team's copies of the style | Independent of opponent (need 5 from your 3 + 6 NPCs) | With style-diverse opponent |
| :--- | :--- | :--- |
| 1 (fully diverse team — the meta) | **0%** | **0%** (needs ≥3 NPC matches; max 2) |
| 2 (partial stack) | 0% | 40.2% |
| 3 (full stack) | 53.6% | 85.7% |

### Reading

- Under the point-maximising meta (both teams style-diverse), Competitive Spirit
  is **literally dead**: 0% even crediting the opponent's likely single style
  match — the census can't reach 5 when NPCs cap at 2 of your style. The
  129/174 pt buys +40/+60 **Power** (not Speed) that never turns on.
- Making it work requires **style stacking**, which directly fights the
  style-diversity scoring the meta is built around — you'd sacrifice reliable
  score bonuses for a coin-flip green. Only a full 3-stack + opponent match
  (~86%) approaches reliability, and that composition is self-defeating in TT.
- Ironically the NPC templates themselves carry Competitive Spirit ○
  (sets 200004, 200013, 200020, 200029) — it rarely activates for them either.

## 6. Summary

| Skill | Sprint | Mile / Dirt | Medium | Long | Opponent interaction |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Lone Wolf | ~100% | ~100% | **0%** | 3.6% | Mutual denial (mirror kills both) |
| Sympathy ×3 team | 89.3% | 89.3% | 89.3% | 89.3% | Mutual benefit (any co-adoption → 100%) |
| Competitive Spirit (diverse team) | **0%** | **0%** | **0%** | **0%** | Even an opponent style match can't save it |

- **Lone Wolf**: best-in-slot cheap green for Sprint/Mile/Dirt at current low
  adoption; avoid in Medium/Long entirely. Watch the meta — popularity is its
  only counter in short/mile/dirt.
- **Sympathy**: viable only as a full-team commit; a uniform ~89% in every race
  type, and it *improves* as more players adopt it. Never run a single copy.
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
| Lone Wolf ×1 | **500.0** | **0.0** | 17.9 |
| Lone Wolf ×2 or ×3 | **0** (self-denial: count ≥ 2 kills it for all holders) | 0 | 0 |
| Sympathy ×1 | 0.0 | 0.0 | 0.0 |
| Sympathy ×2 | 357.1 | 357.1 | 357.1 |
| Sympathy ×3 | **1339.3** | **1339.3** | **1339.3** |
| Competitive Spirit ×1 (diverse team) | 0.0 | 0.0 | 0.0 |
| Competitive Spirit ×3, diverse styles | 0.0 | 0.0 | 0.0 |
| Competitive Spirit ×3, stacked style | 803.6 (1285.7 w/ opp style match) | same | same |
| **Sympathy ×3 + Lone Wolf ×1** | **1839.3** | **1339.3** | **1357.1** |

### Why these are the optimal picks

1. **Lone Wolf: exactly one copy, never more.** A second copy on your own team
   sets `same_skill_horse_count = 2` and scores 0 for both. One copy in
   Sprint/Mile/Dirt is a near-constant **+500 pt every race** — the single most
   reliable activation of the three skills. In Medium its EV is exactly 0 and
   in Long only 17.9; don't bother.
2. **Sympathy is superlinear — always run 3 or 0.** The third copy doesn't just
   add its own 500 × P; it raises P for the other two copies as well. Marginal
   value of the 3rd copy: **982 pt** (357.1 → 1339.3, in every race type).
   A single copy is worth 0 pt: never run 1, and 2 is weak value too.
3. **The two skills stack.** They census different things (skill counts are
   independent), so one uma can carry both Sympathy and Lone Wolf and double-dip
   1000 pt when both fire. Best per-race loadout:
   - Sprint / Mile / Dirt: **Sympathy ×3 + LW ×1 → EV 1839 pt** (max possible 2000)
   - Medium: **Sympathy ×3 → EV 1339 pt** (LW can never fire — leave it off)
   - Long: **Sympathy ×3 (+ LW ×1) → EV 1357 pt**
   - Full 5-race TT round (Sprint, Mile, Medium, Long, Dirt): **≈ 8214 expected pt**
     from these skills alone, vs 0 for the current no-adoption meta.
4. **Competitive Spirit loses even when you cheat for it.** Its best case —
   all 3 umas stacked in one style with CS — yields 804 pt (1286 crediting the
   opponent's style match), still below Sympathy ×3's 1339, *and* it forfeits
   the style-diversity scoring that motivated spreading styles in the first
   place. Under the diverse-team meta it is worth exactly 0 pt: skip entirely.

### Consistency vs expectation

Sympathy is all-or-nothing per race (all 3 copies fire together): it pays
1500 pt in ~89% of races and 0 in ~11%, identically in every race type. Lone
Wolf is the opposite — a steady 500 in Sprint/Mile/Dirt, nothing in Medium.
If total points across many races is the goal, EV is the right metric and the
combo wins; no race type is a better or worse habitat for Sympathy than another.

### Meta dynamics (opponent adoption)

- **Sympathy is coordination-positive**: opponent copies count toward your 5.
  Opponent runs just 1 → your EV is a **guaranteed 1500 pt** (your 3 + their 1
  = 4, and the draw guarantees ≥1 Sympathy NPC). Adoption can only help you.
- **Lone Wolf is anti-coordination**: if the opponent mirrors it, both score 0.
  EV = 500 × (1 − P(opponent runs LW)). At today's near-zero adoption it's free
  money; if the meta catches on, expect this 500 to erode — it's the fragile
  half of the combo, while Sympathy is the robust half.
- Competitive Spirit gains nothing from opponent style matches under the
  diverse-team meta — the census still can't reach 5.

## Caveats / assumptions

1. `running_style_count_same_rate>=40` interpreted as holders-inclusive share of
   the full field (5/12). If the game excludes the holder, the threshold becomes
   6/12 and Competitive Spirit is even worse.
2. 6 NPCs modeled as distinct uniform draws from the 8-build pool; server-side
   generation is not in the master DB.
3. "Opponent ≈ 0 adoption" reflects the current meta per user observation;
   Lone Wolf and Sympathy probabilities move in opposite directions as adoption
   grows.