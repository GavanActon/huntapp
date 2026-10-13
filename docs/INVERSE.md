# The backwards solve: classes of what the air is doing

Status: built offline in Python on 2026-10-12 (`pipeline/inverse/`). Nothing
is in the app yet. This is layers 3 and 4 of
[WIND-LEARNING.md](WIND-LEARNING.md) as a replayable model, scored on every
check we hold. Three versions, all from the same day:
- **v1** was the hand rules.
- **v2** calibrates the floor under a canopy from SMEAR II, and takes
  stability from the air above the trees.
- **v3** replaces SMEAR II with NEON's median forested tower: a stable
  floor on flat ground goes calm, and on a slope or valley bottom it
  drains.

v3 is what the scripts run now. SMEAR II stays as the bound for a
sheltered stand. The replay section gives all three.

## What it is

Gavan's framing:
- A hunter's wind check says "this is happening".
- The model holds a small set of **classes**: the kinds of thing the air can
  be doing at a spot (coupled to the wind above, channelled, cut off,
  draining, running upslope, a lake breeze, a rotor).
- The check's parameters set how likely each class is before the check. The
  check then weighs them, and each further check refines the answer.

The hunter never sees the classes. The phone shows three things:
- **the wind it believes**;
- **"check again"**, when the two leading classes can't be told apart and
  would show different winds;
- **Sharpen**, naming the one cheap observation that would split them (one
  more puff here, or a look at the treetops).

The reasons go to the devlog, and to Dig in at most.

## The state and the model

**The state** is joint:
- the **ambient** direction θa: the air above the trees, the fast state. It is
  on a 10° grid (36 values).
- the **class**: what this spot does with that air (7 values).

That makes 252 numbers per spot.

**The prior** is P(class | θa, the check's parameters) × P(θa | forecast).
- **P(θa)** is 85% a wrapped normal about the forecast (σ 17°) and 15% spread
  round the compass. That mix reproduces the station scoreboard in
  WIND-LEARNING.md: HRDPS within 45° on 88% of station-hours, median miss
  14°. Below 8 km/h the core widens (to 32°) and the tail grows (to 30%):
  the stations were only scored from 5 km/h up.
- **The class weights** are hand rules (table below), and every class keeps
  a floor of 0.03.

**A felt check's likelihood**, per (class, θa), has up to four parts.
- **Its direction:** a wrapped normal about the class's centre, plus a
  uniform share. The spread adds, in quadrature:
  - the class's own σ;
  - the puff's reading error (the app's `DIR_SIGMA` by strength word, plus
    half the swing, plus 13° for the GPX's 8-point directions);
  - the meander: **half the model's own check-free spread** at the spot.

  The meander is the per-check weighting idea from the wind-learning
  thread. Where the model said ±88°, a puff moves the classes little; where
  it said ±25°, a puff counts.
- **Its strength word:** a lognormal head-height speed per class, cut into
  the five bands (`STRENGTH_RANGE`), with 10% spread evenly for a misread.
- **The swing**, when the puffs swung 90° or more.
- **The "treetops moving while it's calm here" flag**, when given.

**Under a canopy (v2, v3).** At a cell under stands of 8 m or more, the
coupled/decoupled split (and in v3 drainage on slopes), the coupled floor's
speed and the decoupled floor's calm share come from the tower sets: SMEAR
II in v2, NEON's median in v3 (the tables after the classes). They replace
the hand rules for those two classes there.

**A seen check** speaks to θa only: the treetops' direction ±30°
(`SEEN_DIR_SIGMA`).

**The wind it believes** is the mode of the classes' mean flows, weighted by
the belief. The meander widens the cone but does not move its centre.

### The classes

| Class | What the air is doing | Prior weight (before the 0.03 floor) | Direction felt (FROM) | σ, uniform share | Head-height speed (median, log-σ) | P(swing ≥ 90°), P(aloft) |
|---|---|---|---|---|---|---|
| **C** coupled | the wind above comes down, turned by the terrain | 1.0 × (1 − 0.6·S·low) | the terrain call for θa: the micro grid's momentum solve (the stable lid by `stable`), as `model.ts momentumAt` | 15°, 0.05 | forecast speed × the cell's momentum ratio × 0.45 open / 0.25 under trees × the app's stable damping; 0.8. **v2/v3 under stands of 8 m+:** U10 × the tower set's floor/top ratio | 0.20, 0.30 |
| **CH** channelled | a slot in the trees or a valley floor runs the air along its axis | 1.5 × chan × (1 − 0.3·S). chan = 1 in a slot (the app's `slotAt` rule), else the valley's depth (cross rise − along rise within 1.5 km, 30 → 100 m) × floor | along the axis, toward the end θa pushes: logistic on cos(θa − axis), slope 4 | 25° (+25° in an unsteady slot), 0.05 | forecast × 0.45; 0.7 | 0.15, 0.40 |
| **D** decoupled | the floor is cut off from the air above: calm, wandering, a few local gusts | 2.5 × S × max(low, 0.7·floor, 0.4 under trees of 8 m+) × mixN, + 1.0 × clamp((5 − F)/4). **v2/v3 under stands of 8 m+:** coupled + decoupled (+ drainage on slopes, v3) = 1, split by the tower set's shares | half round the compass, half ±70° about the drainage line (else the terrain call) | 70°, 0.50 | 0.8 km/h; 0.9. **v2/v3 under stands of 8 m+:** 0.4 km/h (85% calm) | 0.50, 0.80 |
| **K** drainage | cold air running downhill | 2.0 × S × slope × (a drainage line) × mixN | from uphill: `katDir` + 180 | 30°, 0.10 | max(1.2, 0.5 × `katSpd`) km/h; 0.7 | 0.10, 0.60 |
| **A** upslope | sun-warmed slope pulling air up | 1.5 × heat × (1 − stable) × mixD × slope | from downhill: `thAspect` | 30°, 0.10 | 2.5 km/h; 0.7 | 0.25, 0.40 |
| **B** breeze | lake breeze by day, land breeze off a cold shore | lake: 1.5 × e^(−shore/500) × clamp((dT − 1)/6) × clamp(sw/500) × [sun > 10°] × e^(−max(0, U10 − 10)/10). Land: 1.0 × e^(−shore/300) × clamp((−dT − 1)/6) × clear sky × mixN | lake: from the water (`onshore` + 180); land: `onshore` | 35°, 0.10 | max(2, 0.5 × `breezeMax`) km/h; 0.7 | 0.15, 0.40 |
| **R** rotor | in the lee of rising ground the floor air runs back | 2.0 × lee(θa) × clamp((F − 6)/6) × (0.4 + 0.6·S) × (1 − 0.7·Cv). lee = clamp((upwind horizon − 3°)/7°) | the terrain call + 180 | 45°, 0.25 | forecast × 0.3; 1.0 | 0.60, 0.60 |

The drivers:
- **F, the forecast.** The 10 m forecast the check saved. For the GPX, which
  saved none, the archived HRDPS at the point and minute (within 2.3° of the
  forecast in the app's own replay).
- **S, cooling and stability:** max(`stable`, 0.6 × `cool`).
  - `stable` and `convective` (Cv) follow the app's rule (MICRO-WIND §1,
    `boundaryLayer.ts layeringAt`). Its inputs are the archived HRDPS 2 m and
    80 m temperature and wind at the check's point and minute (Open-Meteo
    historical-forecast, `gem_hrdps_continental`).
  - `cool` is `model.ts`'s clear-sky cooling, once the sun is under 10°.
- **low** is `model.ts`'s lowness: the pool depth or the height under the
  surroundings (`rel`).
- **floor** is 1 on low ground, and 0.8 on a flat or valley cell under 3°.
- **mixN and mixD** are `model.ts`'s mixing cut-offs on the 10 m terrain wind
  (U10).
- **slope** = clamp((`thSlope` − 0.5)/3).
- **heat** is `model.ts`'s sun on the face over 600 W/m².
- **dT** is the 2 m air minus the lake (`conditions.ts estimateWaterTemp`).
- **The upwind horizon** is the highest angle to the ground toward θa, out to
  1.5 km, on the 30 m habitat elevation. At the Searchmont dusk spot it is
  5.9° toward 152°. That spot's valley axis comes out at 45°/225°, 104 m
  deep, the Goulais valley.

All the numbers are in `pipeline/inverse/classes.py` (`TABLE`,
`prior_weights`, `SMEAR`, `CONFIG`). None is fitted to our checks. They come
from:
- the physics in MICRO-WIND.md and the regimes in `model.ts`;
- since v2, SMEAR II's floor under a canopy.

### The floor under a canopy: SMEAR II (v2)

**The source.** SMEAR II, Hyytiälä, Finland: boreal Scots pine about 18–20 m
tall, flat ground.
- **Floor:** the 3 m subcanopy sonic.
- **Top:** the 33.6 m sonic, about 14 m over the crowns.
- **Stability:** z/L from the 27 m eddy covariance, **above** the canopy.
- **The sample:** Sep–Nov 2019–2022, 13,073 half-hours with the top at
  1.5 m/s or more.
- **Definitions:**
  - calm floor: under 0.25 m/s;
  - decoupled: calm, or the floor more than 90° off the top.
- docs/research/wind-regime-datasets.md §3;
  `pipeline/raw/regimes/smear-ii/first_look.py`.

| stability above the canopy | P(decoupled) → the D share | floor within 45° of the top | calm floor | floor/top speed |
|---|---|---|---|---|
| unstable (day) | 0.11 | 74% | 10% | 0.22 |
| neutral (day 85/5/0.19, night 83/7/0.18) | 0.07 | 84% | 6% | 0.19 |
| stable, 0.1 < z/L < 1 (night) | 0.27 | 54% | 24% | 0.14 |
| very stable, z/L > 1 (night) | 0.74 | 18% | 60% | 0.10 |
| top over 5 m/s (night, any stability): overrides | 0.01 | 99% | 0% | 0.17 |

How the classes use it, under stands of 8 m or more:
- **Prior:** coupled 1 − P(decoupled) and decoupled P(decoupled). These
  replace the two hand weights; the other classes keep theirs.
- **Coupled speed:** the terrain wind 10 m over the canopy (U10, the
  analogue of SMEAR's top) × the floor/top ratio for the row.
- **Decoupled speed:** a lognormal at 0.4 km/h (log-σ 0.9), so 85% of it is
  "calm". SMEAR's calm share within its decoupled is 0.86, 0.89 and 0.81 by
  stability.
- **Coupled direction.** The table implies the coupled floor follows the top
  within 45° in 90% (neutral), 74% (stable) and 69% (very stable) of cases.
  That is a spread of about 27°, 40° and 44°. The likelihood's coupled
  spread (15° in quadrature with the meander, 35–50° at the Pickle bog) is
  of that size, and was left as it was.
- **Stability measured at the floor predicted nothing at SMEAR II.** The
  trunk space reads unstable under a cooling crown. So the input is the air
  above the trees:
  - **The aloft wind** is the HRDPS 80 m wind. Where treetops were seen
    within 30 min and 1 km, it is held inside that word's band: still 0–7.5,
    leaves 7.5–18, branches 18–28.5, sway 28.5–39, bend 39+ km/h (the
    midpoints of `SEEN_KMH`).
  - **The layering:** the bulk Ri over 2–80 m with that wind in the shear
    (`layeringAt`'s formula).
  - **The class:** z/L from Businger–Dyer (z/L = Ri/(1 − 5Ri), so z/L 0.1 is
    Ri 0.067 and z/L 1 is Ri 0.167). Neutral when dθ < 0.2 K; unstable when
    convective ≥ 0.3.
  - **The 5 m/s rule** reads the aloft wind.
  - **It is the HRDPS cell's profile** (2.5 km), not the valley's or the
    hollow's.
- **The heights don't match.** HRDPS 80 m runs stronger than SMEAR's top
  (about 14 m over the crowns), most of all in stable air. Reading 80 m
  makes the 5 m/s rule fire more often than SMEAR's own would. A sensitivity
  row reads it on the HRDPS 10 m instead.

**One change before the scored run.** The first run blurred the shown wind
with the meander. The broad classes then pulled the mixture's mode about,
so the meander was taken out of the shown wind (it stays in the
likelihood). The sensitivity table carries the first run's display.

## The data

**76 checks** in all: 75 felt (66 with a direction, 9 calm) and 1 seen. All
come from one hunter (Gavan), at three places, on 11 days between
2026-09-27 and 2026-10-11.
- **D1 `checks`, pulled 2026-10-12: 16 checks.**
  - 12 at Searchmont: the dusk floor of 10-10, and the floor and the climb of
    10-11.
  - 4 at the Sault test area.
  - 1 of the 16 is the seen treetops of 10-10 18:24.
  - The coordinator's copy (`pipeline/raw/replay/checks-d1-2026-10-11.json`)
    holds the same 16.
- **Gavan's hunt-log GPX of 2026-10-06: 60 Pickle Lake checks**, 09-27 to
  10-03.
  - 24 are within 120 m of the bog spot.
  - It is not in the repo's `field-data/`, which holds only photos now. It
    is in `~/.claude/projects/c--dev-huntapp/field-data/`, beside the app's
    replays of it (`replay-2026-10-07-baseline.csv`,
    `replay-2026-10-09-loo-local.csv`).
  - The GPX keeps 8-point directions and no forecast.
- **The app's own replay** of each check comes from `app/scripts/replay.py
  --loo`:
  - D1: `pipeline/raw/replay/replay-new4-*.csv`, today's model;
  - GPX: the 2026-10-09 run, that day's model.
  - Columns: raw rules, the local blend (the others of the day, both ways),
    and fit + blend.
- **The air.** HRDPS put 9 of the 66 directional checks in stable air
  (S ≥ 0.4: Pickle dawns and dusks), 18 in convective air (middays) and 39
  in neutral air.
  - **The Searchmont dusk floor (17:33) was neutral by HRDPS:** dθ −0.10 K
    over 2–80 m, `stable` 0, with the sun still 13° up. A 2.5 km cell can't
    see the valley's own layering.

Everything lands in `pipeline/raw/inverse/` (git-ignored; it holds
positions):
- `checks.raw.json` and `checks.json`: the D1 pull;
- `params.json`: each check with its parameters;
- `profiles/`: the archived HRDPS;
- `replay.csv` and `replay.md`: per check;
- `summary.json`.

## The replay

Each felt check is scored five ways:
- **check-free:** the prior alone, plus the treetops when a seen check is
  within 30 min and 1 km. This is the wind before any felt check.
- **causal sit:** the earlier felt checks of the sit update it. Within
  400 m they speak for the class and the ambient, weighted
  e^(−dt/60 min)·e^(−d/150 m). From 400 m to 2.5 km they speak for the
  ambient alone. Nothing older than 90 min counts.
- **hour both ways:** the same with later checks too, like the app's
  `--loo` blend. This is the like-for-like comparison with the app.
- **causal + memory:** other days' checks at the spot, in the same
  situation (below).
- **after the check:** the posterior, the class it picks, "check again"
  and Sharpen.

### The floor under a canopy: NEON (v3, the default)

**The source.** 27 NEON towers, 25 of them forested (canopy 5 m or more),
Sep–Nov 2017–2025, half-hours with the top at 1.5 m/s or more.
- **Stability above the canopy:** gradient z/L from the temperature pair,
  scaled to match eddy covariance. At BONA and DEJU it agrees with eddy
  covariance on the class 76–83% of the time.
- **Calm floor:** under 0.3 m/s.
- `pipeline/raw/regimes/neon/first_look.md`, written by
  `pipeline/towers/neon_look.py`.

| stability above (median of the forested towers) | floor follows the top (≤ 45°, of non-calm) | calm floor, all towers | calm floor, the 12 flat towers (< 2°) → the D share | floor/top speed |
|---|---|---|---|---|
| unstable | 88% | 1% | 1% | 0.32 |
| neutral | 94% | 1% | 1% | 0.28 |
| stable | 83% | 10% | 29% | 0.24 |
| very stable | 83% | 25% | 46% (read off the per-tower table) | 0.22 |
| night, top over 5 m/s (overrides) | 91–100% at all but RMNP (48%: the whole layer drains) and WREF | 0% | 0% | 0.28 |

**Under stable air, flat floors go calm and sloped floors drain.**
- The median calm share is 29% at the flat towers, against 5% at the 11
  sloped or valley towers.
- The share of stable nights the floor runs downslope (the top's share in
  brackets):
  - BONA (3.2°, valley) 80% (1%);
  - BART (3.1°) 82% (54%);
  - GRSM (5.1°, valley) 66% (92%);
  - RMNP (3.9°) 94% (86%): the whole layer drains;
  - ORNL (4.0°) 58% (32%);
  - UKFS (4.5°) 51% (26%);
  - TALL (7.5°) 58% (53%);
  - SCBI (9.6°) 22% (2%): no drainage signal.
- The median is 62%. Flat towers run downslope 3–24% of the time, against
  25% by chance.

**SMEAR II through the same method** reads 92 / 75 / 64% follow and
9 / 31 / 66% calm (neutral / stable / very stable). Its pine stand is at
the sheltered end, so it stays as the bound for a sheltered stand.

How v3 uses it, under stands of 8 m or more:
- **Flat ground** (the ~100 m slope under 2°, or no drainage line):
  - decoupled takes the flat towers' calm share, and coupled the rest;
  - neutral and unstable: 0.01;
  - stable: 0.29; very stable: 0.46.
- **Sloped or valley-bottom ground**, under stable or very stable air:
  - **drainage 0.62** (the median above), coming from uphill (`katDir` +
    180), whatever the top does;
  - decoupled 0.05, coupled the rest.
  - "Sloped or valley" means a slope of 3° or more (ramped from 2°), or
    20 m or more under the ground round it (`rel`, about NEON's TPI500 below
    −20 m), and it needs a drainage line.
- **The 5 m/s rule** still overrides: coupled 0.99.
- **Coupled speed:** U10 × NEON's floor/top ratio.
  - **The caveat:** only 9 of NEON's 27 floors are at 1.4–3.1 m; many sit
    in the trunk space at 4–11 m. So these likelihoods are for the floor
    layer, not head height exactly.
  - The 8 forested towers with the floor at 1.1–2.8 m read 0.30 / 0.25 /
    0.19 (neutral / stable / very stable), close to the median, so the speed
    ratio holds at head height.
  - Their calm and follow shares weren't split out that way.

### v3: NEON, against v1 and v2

| within 45° (median miss) | v1 hand rules | v2 SMEAR II | v3 NEON |
|---|---|---|---|
| all 66, check-free | 42% (62°) | 39% (63°) | 41% (66°) |
| all, causal sit | 41% | 41% | 42% (68°) |
| all, hour both ways (like the blend) | 45% | 45% | **47%** (60°) |
| all, causal + memory | 42% | 42% | 44% |
| Pickle low sun (22), check-free | 45% | 36% | 41% (70°) |
| Pickle low sun, causal sit | 41% | 41% | 45% |
| Searchmont 9, check-free | 67% | 67% | 67% |
| "check again" raised | 19 of 75 | 14 | 16 |
| speed: exact band, check-free / causal | 41% / 45% | 47% / 48% | 43% / 44% |

- **The app on the same checks:** forecast 38%, logged 42%, raw rules 42%,
  blend 44%, fit + blend 45%. On Pickle at low sun, fit + blend is 55%.
- **Head to head under v3** (classes only / app only / both / neither):
  - hour both ways against the blend: 10 / 8 / 21 / 27;
  - against fit + blend: 10 / 9 / 21 / 26;
  - causal against the app as logged: 10 / 10 / 18 / 28.

**The Pickle dusk checks v2 lost** (09-28, the bog, sun 3–11° up, very
stable by the cell's profile):
- **19:05 (felt 315°) and 19:06 (felt 270°) are back.** Under NEON's very
  stable row the bog's prior splits 0.54 coupled to 0.46 decoupled (SMEAR:
  0.26 to 0.74), so the shown wind is 281° again, not the drainage line.
- **18:12 (felt 0°) is now missed.** The shown wind is 193°: with the
  forecast at 2.4 km/h, the ambient prior is wide and nothing pins it.
  v1 and v2 had it right by way of the drainage line.
- **18:46 (felt 90°)** stays missed by all three.
- **The calm dawns (09-27 06:29, 06:58)** keep their decoupled call (0.67
  and 0.80 after the calm), with no "check again".

**The slope rule touched no check.** Every check under a canopy in stable
air is on the flat bog (slope 0.6–1.3°, `rel` −0.5 to +0.5). "v3 without the
slope drainage rule" reads the same in every column. It waits for checks on
sloped, wooded ground at dusk.

**The Searchmont dusk didn't move:**
- **17:33:** still 165° against 308° felt.
- **18:24 calm:** D 0.44, K 0.27, as in v2.
- The floor there is open ground (treeH 0), and neither tower set speaks for
  an open valley floor. That needs a valley-floor set (SPLASH) or the
  Searchmont stations.

**What v3 settles.** Against v2 it wins back two checks and loses one. On
the hour both ways it is the best of the three, 47% against the app's 45%.
That is one check, inside the noise; the order of v1, v2 and v3 is not
settled by these data.

### v2: SMEAR II under the canopy, against v1

| within 45° (median miss) | v1 hand rules | v2 SMEAR II |
|---|---|---|
| all 66, check-free | 42% (62°) | 39% (63°) |
| all, causal sit | 41% (66°) | 41% (66°) |
| all, hour both ways (like the blend) | 45% (60°) | 45% (60°) |
| Pickle low sun (under 12°, 22), check-free | 45% | 36% (63°) |
| Pickle low sun, causal sit | 41% | 41% (68°) |
| Searchmont 9, check-free | 67% | 67% |
| "check again" raised | 19 of 75 | 14 of 75 |
| speed: exact band, check-free / causal | 41% / 45% | 47% / 48% |

The app on the same checks: forecast 38%, logged 42%, raw rules 42%, blend
44%, fit + blend 45%. On Pickle at low sun: forecast 41%, raw rules 36%,
fit + blend 55%.

The head-to-heads under v2 (classes only / app only / both / neither):
- check-free against the raw rules: 5 / 7 / 21 / 33;
- causal against the app as logged: 9 / 10 / 18 / 29;
- hour both ways against the blend: 9 / 8 / 21 / 28.

The SMEAR row each check under a canopy took: top over 5 m/s 18, very
stable 11, neutral 11, unstable 2. 33 checks were in the open.

**How the Pickle dawn and dusk checks moved** (bog, under 11–21 m stands):
- **The calm dawns (09-27 06:29, 06:58; 09-28 19:41).**
  - The cell's profile was very stable (Ri 0.9–2.8) with 80 m at
    11–17 km/h, under the 5 m/s rule.
  - Decoupled went from 0.46 to 0.61 before the check, and to 0.73–0.77
    after it.
  - "Check again" stopped firing at all three: the calm now has a cause.
  - That is the gain.
- **The 09-28 dusk (18:12–19:06; sun still 3–11° up, 80 m 5–11 km/h,
  Ri 2–3, very stable).**
  - Decoupled and drainage now lead, so the shown wind moved to the drainage
    line (from 2–27°).
  - Gavan felt 0°, 90°, 315° and 270°.
  - Two that v1 had within 45° (315°, 270°: the forecast's line) are now
    missed. That is the loss: 45% → 36% at low sun.
  - SMEAR's stable rows are night rows. Holding them to after sunset gives
    41% at low sun and 41% overall. That rule came after seeing this replay
    (post hoc), so it is judged on new checks, not these.
- **The 10-02 dusk (18:43–19:14; 80 m 18.7–20 km/h).**
  - The 5 m/s rule made them coupled 0.88–0.95.
  - Their direction was already right and stays right.
  - Their speed band moved from light to drift, which is what was felt.
- **09-29 08:16** (80 m 19.7 km/h, over the rule): after the check it is
  now coupled 0.48 (v1: decoupled 0.38). It is still missed (felt 315°
  under a 167° forecast).

**The Searchmont dusk didn't move** (the floor is open: treeH 0, so the
SMEAR split does not reach it).
- **17:33:** HRDPS neutral, 80 m at 30 km/h; unchanged at 165° (felt 308°).
- **18:24 calm:** the seen treetops ("leaves") hold the aloft wind at
  18 km/h, not 30.
  - Ri rises to 1.6 and S from 0 to 0.68.
  - The prior moves from CH 0.40 / C 0.38 to C 0.36 / CH 0.33 / D 0.12.
  - After the calm: D 0.44, K 0.27 (v1: D 0.35, K 0.23).
- **The treetop rule is the one way stability above reached that valley.**
  An open valley floor at dusk wants its own numbers: SPLASH on a valley
  floor, the Searchmont stations.

**What v2 settles:** the SMEAR calibration is no worse than the hand rules
in direction overall (39–45% against 41–45%, within a check or two). It is
better on calm dawns, speed and "check again", and worse on the bog's
pre-sunset dusk. 22 low-sun checks can't say more.

The tables below are **v1** (the hand rules), kept as the baseline.

### Agreement with the felt direction (within 45°, median miss)

| | all (66) | Pickle (53, 8-point) | Searchmont (9) | its ridge (7) | Sault test (4) |
|---|---|---|---|---|---|
| forecast alone | 38% · 72° | 34% · 75° | 56% · 45° | 71% · 11° | 50% · 80° |
| terrain call (the grid, forecast in) | 39% · 72° | 34% · 77° | 67% · 39° | 71% · 9° | 50% · 80° |
| app, logged at the time | 42% · 90° | 43% · 90° | 56% · 33° | 57% · 28° | 0% · 96° |
| app raw rules (replay) | 42% · 65° | 38% · 69° | 67% · 37° | 71% · 16° | 50% · 80° |
| app blend (replay, the day both ways) | 44% · 52° | 40% · 61° | 78% · 34° | 86% · 29° | 25% · 96° |
| app fit + blend (replay) | 45% · 50° | 42% · 51° | 78% · 34° | 86% · 29° | 25% · 96° |
| **classes, check-free** | 42% · 62° | 38% · 72° | 67% · 39° | 71% · 10° | 50% · 80° |
| **classes, causal sit** | 41% · 66° | 36% · 70° | 67% · 39° | 71% · 10° | 50% · 81° |
| **classes, hour both ways** | 45% · 60° | 40% · 69° | 78% · 38° | 86% · 13° | 50% · 81° |
| classes, causal + memory | 42% · 66° | 38% · 70° | 67% · 39° | 71% · 10° | 50% · 81° |

By the air (directional checks):

| | stable (9) | convective (18) | neutral (39) |
|---|---|---|---|
| forecast | 33% | 56% | 31% |
| app raw rules | 22% | 67% | 36% |
| app fit + blend | 33% | 56% | 44% |
| classes, check-free | 44% | 61% | 33% |
| classes, hour both ways | 22% | 67% | 41% |

**Head to head** (within 45°: classes only / app only / both / neither):
- check-free against the app's raw rules: 6 / 6 / 22 / 32;
- check-free against the forecast: 3 / 0 / 25 / 38;
- causal sit against the app as logged: 9 / 10 / 18 / 29;
- hour both ways against the blend: 9 / 8 / 21 / 28;
- hour both ways against fit + blend: 9 / 9 / 21 / 27.

**The noise floor.** Two felt readings at one spot within 5 minutes, or two
puffs of one check, agree within 45° in **6 of 12 pairs (50%)**, median 60°.
No model can beat the next puff by much more than the puffs beat each
other.

That median implies about 63° of noise per puff in this light bush air. The
app's `DIR_SIGMA` takes 35–50° for light and drift (12 pairs; ±15° on that
figure).

**Speed** (the felt word against each call's band, within one band /
exact):

| | within one band | exact |
|---|---|---|
| forecast (10 m) | 49% | 12% |
| app raw rules | 88% | 32% |
| app logged | 92% | 47% |
| classes, check-free | 84% | 41% |
| classes, causal | 85% | 45% |

### Check again and Sharpen

- **"Check again" would have been raised after 19 of the 75 felt checks
  (25%).** On the margin alone (second class at half the first's posterior
  or more) it would be 28 (37%). It asks only when the two classes would
  show the wind 45° or more apart, or two speed bands apart.
- **Five of the 19 had another check within 20 min and 150 m, and all five
  resolved** (the next posterior was no longer within the margin). The other
  14 had no next check.
- **Sharpen, by expected bits about the class:** another puff here 45 times,
  the treetops once.
  - The treetops pay only when the alternatives need a different ambient.
    That happened once: Sault, 2026-10-09 14:24, felt 180° under a 320°
    forecast.
  - Elsewhere the forecast's core already pins the ambient well enough.

### What the posterior picked

- **The prior's top class:** coupled 55, channelled 12, decoupled 8.
- **After the check:** coupled 48, channelled 13, decoupled 9, breeze 4,
  drainage 1.
- **Against the regime the app's raw rules called:**
  - the app's "wind" checks became coupled 40, channelled 13, decoupled 2,
    breeze 1;
  - its "calm" checks became coupled 8, decoupled 7, breeze 2, drainage 1.

Felt-direction agreement by the class picked after the check (checks with a
direction):

| class picked (n) | forecast | app logged | app raw | app blend | classes check-free | classes causal | classes hour both ways |
|---|---|---|---|---|---|---|---|
| coupled (43) | 49% | 47% | 49% | 51% | 51% | 53% | 56% |
| channelled (13) | 15% | 38% | 31% | 23% | 23% | 23% | 31% |
| decoupled (5) | 20% | 0% | 0% | 20% | 40% | 20% | 20% |
| breeze (4) | 0% | 75% | 50% | 50% | 0% | 0% | 25% |
| drainage (1) | 100% | 0% | 100% | 100% | 100% | 0% | 0% |

**Coupled** is where the classes earn a little: 56% against the blend's 51%.

**Channelled** is where they lose.
- These are the Pickle lake strip and a narrow lake arm. The forecast there
  is 15%, so the class is right that the forecast is wrong.
- But the mixture's mode follows the sharp coupled peak over the broad,
  unsteady slot (σ 50°), so the shown wind sits between the two.
- The app's slot rule was built on the lake strip's own evening (MICRO-WIND
  §5), so its 31–38% there is in-sample.

**Breeze** loses outright: the class's direction is wrong at those spots.

### The Searchmont dusk, and what PALM adds

The checks: the floor at 17:33 felt 308° (light; Gavan later said near calm
with gusts from 308°), and at 18:24 felt calm, with the treetops 500 m SE
seen from 180°. The forecast was 152° at 15 km/h. The question is what the
classes believe without PALM's stable run in the prior, and with it (its
floor reversed 62% of the time, at 0.3 km/h).

| | 17:33 (felt 308°) | 18:24 (felt calm) |
|---|---|---|
| prior, rules alone | CH 0.46, C 0.38, R 0.07 | CH 0.40, C 0.38, R 0.09 |
| prior with PALM | D 0.33, R 0.25, CH 0.21 | R 0.30, D 0.28, CH 0.25 |
| after the check, rules alone | CH 0.68, C 0.18, R 0.09 | D 0.35, K 0.23, CH 0.15 |
| after the check, with PALM | CH 0.38, R 0.35, D 0.16: would say "check again" | D 0.77, R 0.12, K 0.04 |
| the shown wind, rules alone | 165° (143° off) | 223° |
| the shown wind, with PALM | 228° (80° off) | 226° |

- **PALM moves the explanation to the right family** (reversed and cut off)
  **and halves the miss, but it doesn't bring 308° within 45°.**
  - Its own floor direction is wrong: 36° mean, gusts from 60°.
  - The classes' rotor centre (the terrain call + 180 = 340°) carries the
    308°, but a rotor class at 0.25–0.35 can't outvote the rest.
- **The treetops** (seen from 180°, 51 min after the 17:33 check) fall
  outside the 30-minute window. Within 60 min they move the 17:33 call only
  from 165° to 172°. They confirm the ambient, so the floor's miss is the
  place, as WIND-LEARNING's rule says.
- **The drainage line at the floor runs from 311°**, off the NW wall: the
  centre of the decoupled class. But HRDPS called the air neutral at 17:33,
  so neither drainage nor decoupling has prior weight.
  - A valley floor goes into its own cooling before a 2.5 km model sees it,
    and slopes start draining as they go into shadow, before sunset
    (Whiteman 2000).
  - A shadow-onset rule is the obvious next physics, but the replay's two
    dusk checks would grade it. It wants new evenings.

### The memory and its situation key

The memory reaches checks from other days within 400 m (100 m e-folding),
in the same situation. Each such check brings its posterior class mix, as
a Dirichlet with pseudo-count 0.5 multiplied into the prior.
- **Under the class key** (the same stability class, the forecast within
  45°, the same speed band) it touched 28 checks.
- **Under the app's key of today** it touched 38.
- **It moved the shown wind by more than 5° at none of them.**
  - The remembered classes were mostly coupled, so the memory confirmed what
    the prior already said.
  - There is no repeated non-coupled situation in the data. Pickle's
    "southerly forecast → NE–E drift at the bog" has five occasions, but
    across mornings and an evening, in different stability.

### Sensitivity

Each row changes one thing from v3, as the scripts run now. Rows marked
"post hoc" were thought of after seeing the replay and must be judged on new
checks.

| variant | check-free | causal sit | hour both ways | check again | Pickle check-free | Pickle low sun check-free | Pickle low sun causal | Searchmont check-free |
|---|---|---|---|---|---|---|---|---|
| v3: NEON median under canopy, slopes drain (as run) | 41% | 42% | 47% | 16 | 36% | 41% | 45% | 67% |
| v2: SMEAR II under canopy (the sheltered bound) | 39% | 41% | 45% | 14 | 34% | 36% | 41% | 67% |
| v1: the hand rules | 42% | 41% | 45% | 19 | 38% | 45% | 41% | 67% |
| v3 without the slope drainage rule | 41% | 42% | 47% | 16 | 36% | 41% | 45% | 67% |
| v3, the 5 m/s rule on HRDPS 10 m, not 80 m | 41% | 42% | 47% | 18 | 36% | 41% | 45% | 67% |
| v3, post hoc: the stable rows only after sunset | 41% | 42% | 47% | 13 | 36% | 41% | 45% | 67% |
| no meander noise (every check speaks fully) | 41% | 45% | 50% | 13 | 36% | 41% | 45% | 67% |
| meander = the model's full spread | 41% | 41% | 44% | 19 | 36% | 41% | 41% | 67% |
| ambient prior without the station tail | 41% | 42% | 45% | 16 | 36% | 41% | 45% | 67% |
| post hoc: canopy shelters the floor's thermal flows | 41% | 42% | 47% | 15 | 36% | 41% | 45% | 67% |
| the shown wind blurred by the meander (the first run's display) | 41% | 44% | 48% | 15 | 36% | 41% | 45% | 67% |
| post hoc: the shown wind is the most likely class's own | 47% | 50% | 50% | 16 | 43% | 45% | 55% | 67% |

On v1 the last row read 47% / 48% / 48%; on v2, 45% / 48% / 48%.

### The D1 checks, one table

Directions FROM, degrees. Columns:
- fc: the forecast;
- logged: the app's call at the time;
- raw, blend and fit: the app's replay;
- free, causal and hour: the classes;
- prior and post: the top three classes;
- again: "check again".

| local | place | felt | fc | logged | raw | blend | fit | free | causal | hour | prior | post | again | sharpen |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10-08 12:51 | Sault | 180 light | 300 | 298 | 298 | 298 | 298 | 298 | 298 | 298 | C .84 A .03 D .02 | C .42 A .37 R .12 | y | puff |
| 10-08 17:13 | Sault | 270 breezy | 301 | 320 | 297 | 276 | 276 | 299 | 299 | 299 | C .85 A .03 D .02 | C .96 CH .02 B .01 | | |
| 10-09 14:24 | Sault | 180 light | 320 | 295 | 317 | 294 | 294 | 320 | 320 | 323 | C .83 A .05 D .02 | C .53 A .33 R .08 | y | treetops |
| 10-09 14:26 | Sault | 0 light | 319 | 282 | 317 | 281 | 281 | 318 | 316 | 316 | C .85 CH .02 D .02 | C .90 B .03 A .02 | | |
| 10-10 17:33 | Searchmont floor | 308 light | 152 | 156 | 154 | 166 | 166 | 165 | 165 | 163 | CH .46 C .38 R .07 | CH .68 C .18 R .09 | | |
| 10-10 18:24 | Searchmont floor | calm | 152 | 302 | 159 | 283 | 283 | 173 | 223 | 223 | CH .40 C .38 R .09 | D .35 K .23 CH .15 | | puff |
| 10-11 10:58 | Searchmont floor | 249 light | 190 | 216 | 207 | 215 | 215 | 210 | 210 | 211 | C .44 CH .41 R .10 | C .47 CH .36 R .14 | | puff |
| 10-11 11:30 | Searchmont top | 236 breezy | 191 | 214 | 199 | 198 | 198 | 193 | 193 | 195 | C .42 CH .26 A .21 | C .56 CH .26 A .10 | | puff |
| 10-11 11:33 | Searchmont top | 180 breezy | 191 | 234 | 196 | 209 | 209 | 188 | 189 | 190 | C .57 A .29 R .07 | C .96 CH .02 R .01 | | |
| 10-11 11:34 | Searchmont top | calm | 191 | 198 | 196 | 192 | 192 | 186 | 186 | 187 | C .59 A .28 R .06 | C .76 A .09 R .06 | | puff |
| 10-11 11:37 | Searchmont top | 180 breezy | 191 | 201 | 190 | 200 | 200 | 190 | 190 | 193 | C .57 A .27 R .10 | C .96 CH .02 R .01 | | |
| 10-11 11:41 | Searchmont top | 237 light | 191 | 185 | 189 | 200 | 200 | 190 | 190 | 195 | C .56 A .29 R .08 | C .81 A .13 CH .03 | | puff |
| 10-11 11:44 | Searchmont top | 199 breezy | 191 | 211 | 189 | 224 | 224 | 191 | 194 | 200 | C .61 A .28 R .04 | C .96 CH .03 A .01 | | |
| 10-11 11:50 | Searchmont top | 299 light | 192 | 201 | 188 | 201 | 201 | 191 | 193 | 193 | C .59 A .29 R .05 | C .68 A .27 CH .03 | | puff |
| 10-11 11:57 | Searchmont top | 185 light | 192 | 213 | 181 | 202 | 202 | 181 | 184 | 184 | C .61 A .31 D .02 | C .89 A .05 CH .04 | | puff |

(The 10-10 18:24 seen treetops, 180°, are an input, not scored.) The 60
Pickle rows are in `pipeline/raw/inverse/replay.md`.

On the ridge, the classes give what the forecast gives: the climb's air was
coupled. The puffs' 180–299° spread is meander, not a class change, and
the classes don't chase it. The app's logged calls did: 57%, 28°.

### The speed-fix pair (speed only, offline)

**The variant.** The station thread's corrected speed above the canopy goes
into the tower floor model. Direction is untouched.
- **The inputs:**
  - `pipeline/raw/inverse/pair-speed.csv`: per check, `wsTop`, the
    station-corrected open 10 m speed carried to just above the canopy by
    the bake's roughness ratio;
  - `wsTopAlt` = corrected10Kmh / 3.6, a lower bound;
  - `clsGrad`, the stability class.
- **The floor model:** the LightGBM SD floor model (`floor-models/sd_calm.txt`
  for p_calm, `sd_logratio.txt` for log(floor/top)), trained in
  `pipeline/towers/floor.py` on SMEAR II, NEON and AmeriFlux.
- **Head-height speed** = wsTop × exp(logratio) × 3.6 km/h. The band is
  calm where p_calm ≥ 0.5, else the speed's band (`STRENGTH_RANGE`).
- **The features:**
  - zeta_grad NaN, sd_ztop_rel 1.3, sd_zfloor_rel 2/sd_h;
  - sun and hours since sunrise and sunset from the almanac;
  - slope and wind-against-downslope from the micro grid (`thSlope`,
    `thAspect`, with the SD wind's direction);
  - decid = hardwood / (hardwood + conifer) from the habitat grid (FRI);
  - the canopy as `floor.py`'s SD grade: ETH Global Canopy Height 2020
    (10 m) and Hansen GFC-2024 cover after loss (30 m), read per check with
    `canopy_sites.py`'s readers and cached in
    `pipeline/raw/inverse/sd-canopy.json`.
- **Run:** `replay_inverse.py`'s `pair_speed()`.
- **Checks:** 74 felt checks with a pair row. The 2026-09-28 19:41 bog calm
  has none.

**Within one band / exact band** (felt word against each call's band):

| | all (74) | under stands, treeH 8 m+ (41) | open (33) | Pickle (59) | Searchmont + Sault (15) |
|---|---|---|---|---|---|
| app, logged at the time | 92% / 47% | 93% / 54% | 91% / 39% | 93% / 49% | 87% / 40% |
| app fit + blend (replay) | 89% / 34% | 90% / 22% | 88% / 48% | 92% / 32% | 80% / 40% |
| classes v3, check-free | 84% / 42% | 83% / 39% | 85% / 45% | 85% / 41% | 80% / 47% |
| classes v3, causal | 85% / 43% | 85% / 39% | 85% / 48% | 86% / 42% | 80% / 47% |
| **pair, wsTop** | 89% / 38% | **93%** / 34% | 85% / 42% | 90% / 39% | 87% / 33% |
| pair, wsTopAlt | 84% / 35% | 88% / 39% | 79% / 30% | 81% / 31% | **93% / 53%** |

**What it shows:**
- **No call reaches the app's logged speed** (92% / 47%).
  - The GPX's logged speeds are whole km/h, mostly "1 km/h" = drift, and
    drift is the commonest felt word (26 of 74). So that column is flattered.
- **With wsTop the pair matches fit + blend overall** (89%) and leads under
  stands (93% within one band). It never calls calm: p_calm stays under 0.5
  at every check, so it gets none of the 8 felt calms.
  - It calls light 52 times against 25 felt. It runs a band high on
    drift-heavy Pickle.
- **wsTopAlt is the reverse.** It calls calm 18 times (2 of the 8 felt calms
  right) and runs a band low at Pickle. It is the best on the Searchmont and
  Sault checks (93% / 53%), where wsTop calls the ridge's breezy puffs
  light-to-breezy.
- **The truth sits between them:** wsTop over-calls, wsTopAlt under-calls.
- **One caveat on reading the 74 checks.** The ETH p90 within 100 m is 5 m
  or more at every check, because the trees round an opening count. The
  "under stands" split uses the area grid's `treeH` instead.

## What the data can and cannot settle

**It can settle:**
- **No method separates from another.** Every one sits between 38% and 48%
  within 45° on 66 directional checks.
  - One standard error there is about 6 points.
  - The head-to-heads are 6:6, 9:10, 9:8 and 9:9.
  - **The classes tie the app: they neither beat it nor lose to it.**
- **The ceiling is low at these spots.** Two puffs a few minutes apart agree
  only half the time. Pickle's checks are mostly drift and light, in woods
  and bogs.
- **The forecast alone is 38%,** the app's raw rules 42%, and the best
  replay 45–48%. The checks that matter (the misses) are where the floor
  does its own thing.
- **A light puff carries more direction noise than the app assumes:** about
  63° per puff, against `DIR_SIGMA`'s 35–50°.
- **The app's speed calls are closer than the classes'** (92% within a band
  against 85%). The classes' head-height medians want the app's numbers.
- **HRDPS's 2–80 m stability misses the valley floor at dusk** (neutral at
  17:33). The classes can't call the Searchmont floor from the forecast's
  layering.

**It cannot settle:**
- Any class's numbers: no class has more than 13 checks, and drainage,
  upslope and rotor have one or none.
- Which mechanism ran the dusk floor (rotor, drainage off the NW wall, or a
  decoupled floor with local gusts): one check, no instrument on the floor.
- Whether the memory helps: no situation repeats with a non-coupled class.
- Whether the post hoc display (the top class's own direction, +5–7 points)
  is real.

**What would make it thick enough:**
- **About 150 directional checks.** The head-to-heads swing on discordant
  checks (about a quarter of them here). A 2:1 win rate needs about 35
  discordant ones at p 0.05, so about 150 checks in all.
  - They should come from 20+ spots and all three kinds of air. Two hundred
    more ridge-top middays won't do it.
- **About 20 checks where each non-coupled class is the likely one:** stable
  dusks on floors and in hollows, slots, sunny slopes, shores in the
  afternoon, lee floors under 10–25 km/h.
- **Checks paired with an instrument** (the WS90 on the floor and the ridge,
  WIND-LEARNING step 5). They give each check a truth for the class, and the
  puff noise per strength word.
- **Gavan's other checks.** The ~500 in another install would be the single
  biggest step.

The 60 Pickle checks the coordinator thought missing were on disk, and they
are in this replay. They settled the noise floor and the tie. They could
not settle any class, because they are 8-point and drift-heavy, a third of
them at one bog, in flat country where the rotor and valley classes can't
arise.

## What each class needs to be calibrated

What data, not where to get it:

- **Coupled:**
  - head-height wind and direction under canopies of known height and
    closure, paired with the 10 m wind above, by stability. This is the
    canopy fraction and the turning.
  - the forecast's direction error by speed, region and time of day, to set
    the ambient prior's core and tail.
- **Channelled:**
  - wind along cutlines, bog corridors and valley floors, with a reference
    above.
  - the along share and which end it runs to, as a function of the angle of
    attack and the corridor's width over its wall height.
- **Decoupled:**
  - floor and above-canopy (or ridge) wind at the same moment, with a near-
    ground temperature difference, through dusk and night.
  - the onset against sunset, shadow and cloud.
  - where the few gusts come from.
- **Drainage:**
  - night slope flows on slopes of known angle and length: speed, depth,
    direction against the fall line, and onset after the slope goes into
    shadow.
  - a canyon or valley network with many sensors at night.
- **Upslope:** daytime slope winds against the sun on the face, in the open
  and under trees.
- **Breeze:** shore and inland wind with the land–lake temperature
  difference, by lake size and distance inland, with onset and decay times.
- **Rotor:**
  - lee floor and crest wind at the same moment, with the upwind wind and
    temperature profile (for a Froude number).
  - how often the floor reverses, against the upwind horizon angle, speed
    and stability.
- **All classes:**
  - repeated puffs at one spot beside a 2 m sonic, to set the per-word
    direction noise and the strength words' speed ranges;
  - checks that matched, logged as well as the misses.

## The situation key under the classes

Today's place memory (MICRO-WIND §8, 2026-10-11) files a check's turn by
three things:
- the forecast within 45°;
- its speed within ×2.5;
- one of four parts of the day.

Under the classes it becomes:
- **The place:** the cell and the ground like it (the same landform and
  shelter, per WIND-LEARNING layer 4).
- **The ambient's relation to the place,** not its compass sector: its
  sector of 8 as now, plus the two terrain numbers the classes read for that
  sector.
  - the upwind horizon angle, in bins (under 3°, 3–7°, over 7°);
  - the angle to the slot or valley axis (along, oblique, across).
- **The stability class:** stable (S ≥ 0.4, cooling included), neutral or
  convective, from the profile. This replaces the part of the day.
  - The part of the day was standing in for it, and badly: Searchmont's
    floor reversed at dusk and channelled at midday.
  - Shadow onset belongs in S once it is built.
- **The speed band:** under 8, 8–20, over 20 km/h. The mixing cut-offs
  change across these.

What is kept per key:
- **a class mix:** the posterior class mass of each check, as Dirichlet
  counts;
- **per class, a residual turn and speed ratio** (mean, spread, count): the
  felt wind against the class's own centre, so a rotor here may run 330°,
  not 340°.

On a new visit the class mix multiplies the prior, and the class's centre
takes its residual turn. Today's single turn off the forecast is the
special case where one class (coupled) holds all the mass.

## The phone-side port

- **The per-sit state:**
  - 252 numbers (36 ambients × 7 classes) per spot: the checks within
    400 m.
  - one 36-number ambient marginal per 2.5 km, which carries a check's word
    on the air above to the spots round it.
  - It fades as e^(−dt/60 min).
  - This replaces the local blend's 90%-at-a-check and `ambientFit.ts`'s
    single turn and ratio.
- **What it reads per cell.** It has almost everything already: the micro
  grid's momentum bands, stable lid, `katDir`, `katSpd`, `thSlope`,
  `thAspect`, `onshore`, `shoreDist`, `breezeMax`, `rel`, `pool`, `canopy`
  and `treeH`, plus the slot rule, the profile and the sun. It needs two new
  baked bands:
  - the upwind horizon angle for 16 directions (16 bytes a cell; the same
    bake as WIND-LEARNING step 3's shelter by direction);
  - the valley axis and depth (2 bytes).
- **What it computes per check:**
  - the class centres for 36 ambients;
  - the 252-number likelihood;
  - the mixture's mode on a 1° grid (about 90,000 multiply-adds);
  - the expected bits for two observations (puff, treetops; about 50,000).

  That is a few milliseconds at most on a phone; no worker is needed.
- **What it shows:**
  - the wind (the mode) and the cone (the mixture's spread);
  - "check again" when the top two classes are within half and would show
    the wind 45° or two bands apart;
  - Sharpen, naming the observation with the most expected bits. Today that
    is nearly always "one more puff here". "Look at the treetops" comes up
    when the alternatives need a different ambient.
- **What it keeps per place:** the memory above.
  - Per key: 7 class counts, plus 7 × (turn mean, turn variance, ratio mean,
    count). That is about 35 numbers.
  - A few hundred keys per area: kilobytes.
  - It uploads with the checks. Only learned class mixes and turns come
    down to other phones, never raw checks (decided 2026-10-06).
- **What goes to the devlog:** the classes, the prior and the posterior.
  The card never names them.

## Running it

```
py -3.14 pipeline/inverse/build_params.py --pull   # D1 again, the GPX, the archived HRDPS, the grids, PALM
py -3.14 pipeline/inverse/replay_inverse.py         # the replay, the sensitivity runs
```

- **The GPX path:** set `GW_FIELD_DATA` to the folder holding the GPX and
  the app's replays of it. The default is the memory folder's
  `field-data/`.
- **Speed:** the archive fetch is cached, and the replay (seven runs)
  takes under a minute.

## Next

1. Get the ~500 checks off Gavan's other install (WIND-LEARNING step 0),
   and rerun.
2. Set the puff noise from the noise floor (about 60° for light and drift),
   and the open-ground speed medians from the app's own calls. Under a
   canopy NEON now sets them. Both are calibrations, not new physics.
3. The tower rows by time from sunset as well as stability, and the calm
   and follow shares from the towers with the floor at 1.4–3.1 m only:
   SMEAR II in full (2003–2022), NEON's low floors. The pre-sunset dusk is
   where v2 lost.
4. A shadow-onset term in S (the slope or floor in terrain shadow), once
   there are new dusk checks to judge it.
5. Port the state and the two outputs behind a devlog flag. Log the
   posterior with every check, so the next replay scores what the phone
   believed.
6. Stations on the Searchmont floor and ridge, to give the dusk classes a
   truth.
