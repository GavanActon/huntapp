# Plan: a wind model that is right in the woods, and bakes anywhere fast

Status: plan, 2026-10-07. Decided with Gavan. Replaces the engine-first
framing of [GPU-SOLVER.md](GPU-SOLVER.md), which stays as the solver spec
for phase 4. Nothing here is built except phase 0.

## The two goals, kept apart

1. **Right at head height** where a hunter sits: under the trees, at
   edges, on shorelines and bog edges, at dawn and dusk.
2. **Any area in North America in under an hour**, SD tiles in bulk.

They have different tests and mostly different fixes. Goal 1 is a floor
layer question first and a solver question second. Goal 2 is a cloud and
packaging question first and a solver question only if WindNinja proves
too slow or too wrong.

## Phase 0: the cheap floor fixes (done 2026-10-07, uncommitted)

- Unclassed cells with LiDAR-measured trees are stands
  (`build_microclimate.py`, canopy step). Sault rebaked locally.
- A `woods` lesson: plain wind in a stand learns its own ratio, 0.25–4×;
  a calm check under moving treetops counts (`bias.ts`, `model.ts`).

## Phase 1: calibrate the floor from public towers (1 week)

Status 2026-10-07: steps 1–4 done for 8 AmeriFlux sites
(`pipeline/towers/fit.py`, data in `raw/towers/`, site notes in
[research/canopy-wind-sites.md](research/canopy-wind-sites.md)). Floor ÷
above-canopy, Sep–Nov medians: black spruce 0.21–0.33, 24 m mixedwood
0.20, aspen regrowth 0.43, lodgepole 0.22, closed hardwood 0.11; stable
air about 0.6× of unstable. `in_stand()` gives 0.04–0.07 for the same
stands: 4–6× low, which is the under-call the checks found. Steps 5–6
(new curve, rebake, score) are next.

The 3–4× under-call in the 2026 checks is almost certainly the canopy
decay (`in_stand()`: 0.03–0.05 under dense 20 m spruce). Public towers
measure exactly that ratio, for years, at stands like ours.

1. NEON API token. Pull DP1.00001.001 (2D wind, 30-min, all tower
   levels) and the sensor positions for BONA, DEJU, HEAL, UNDE, STEI,
   TREE, BART, HARV, Sep–Nov of every year available. Add the NEON
   canopy height and LAI per site.
2. AmeriFlux BASE for CA-Obs, CA-Oas, CA-Ojp, CA-SJ1/2/3, CA-Qfo with
   the Measurement Height product: the `WS_#` levels inside the canopy.
3. Harvard HF288 (2 m) against HF001/HF004 (above).
4. Compute, per site and 30-min: floor speed ÷ above-canopy speed,
   binned by above-canopy speed (calm, 1–3, 3–6, 6+ m/s), stability
   (from the tower's own temperature profile) and hour. Fit a coupling
   curve per stand type (closure, height, conifer share, leaf state).
5. Replace the Cionco constants with the fitted curve; keep the `woods`
   lesson on top for local correction. Rebake Pickle and Lac Bailey.
6. Score old vs new against the 60 Pickle checks. Gate: direction
   within 45° and speed within 2× both improve.

Output: `pipeline/towers/` (pull + fit scripts, the fitted table),
MICRO-WIND.md §4 rewritten with the numbers.

## Phase 2: the benchmark harness (3–4 days, in parallel with 1)

One script that scores any candidate wind field on a tile:

| tier | data | metric |
|---|---|---|
| terrain | Bolund Hill blind-test set; WindNinja's Big Southern Butte and Salmon River Canyon sets | speed-up error, direction RMSE against the published numbers |
| openings + canopy | ~50 RAWS stations in forested, rugged terrain (US) + ECCC stations in the boreal | % within 45°, speed r, by stability class |
| floor | Phase 1's tower ratios; Gavan's checks; later his stations | the same, at head height |

`pipeline/bench/`: fetch the sets once (cached), take u/v GeoTIFFs or
the kit's ASCII grids, write one scoreboard. Candidates are scored at
the sensor's own height (towers at 6 m are not the 10 m field).

## Phase 3: throughput, bought not built (1 week)

Find out whether speed needs a new engine at all.

1. Containerise the WindNinja 4.0.0 Linux momentum run (OpenFOAM 11).
   Run one 10 km tile, 16 directions in parallel, on a 64-core cloud
   spot box. Record wall time and dollars.
2. The bake pipeline already stages inputs per 11 km SD tile
   ([TILES.md](TILES.md)). Add a cloud runner that takes a tile, runs
   WindNinja, returns the bands. Target: an HD area on request in under
   an hour; SD tiles at a few hundred a day.
3. Cost the continent at that rate. If it is tens of thousands of
   dollars and weeks, that is acceptable for a one-off and the engine
   decision becomes an accuracy decision only.

## Phase 4: the engine bake-off (3–4 weeks, only after 1–3)

Each candidate gets the same budget (3–5 days) to put a Pickle core and
the Phase 2 sets on the scoreboard:

- A. WindNinja as is: the baseline.
- B. WindNinja with trees as raised ground (0.7 h on the DTM) and
  per-face z0 (water 0.0002, canopy top 1–2 m), with the roughness step
  in `build_microclimate.py` rewritten so the forest is counted once.
  Compare at consistent heights (canopy top + 10 m over forest).
- C. PALM with canopy drag: the physics reference, slow. Also the
  teacher if a surrogate is ever trained.
- D. The GPU LBM spike of GPU-SOLVER.md, neutral with canopy drag.

Decision rule, fixed now: adopt the cheapest candidate that beats A on
tier 2 by at least 10 points of "within 45°" and does not lose on tier 1.
B is tried first. D only if B falls short. If nothing beats A, the money
goes to stations and the floor layer.

## Phase 5: scale (after 4)

- SD: 11 km tiles across the huntable range, baked on the cloud runner
  with whichever engine won. Canopy from LiDAR where fetched, else
  ETH/GEDI height + SCANFI/LANDFIRE; terrain from HRDEM / 3DEP.
- HD: on request, core at 5 m (or 3 m on a GPU), the same pipeline.
- The floor layer, the `woods` lesson and the shared checks sit on top
  of every tile, so field learning keeps working whatever the engine.
- Shared checks come back down as per-area priors (not built; see
  the wind-learning notes).

## Stations (any time, small)

Two Kestrel 5500 + vane (stand under spruce, bog edge) and one Ecowitt
WS80 + GW3000 with SD logging at camp. They test edges and slots, which
no public tower does. They are not on the critical path for phases 1–4.

## Gates and what decides them

| after | the question | decided by |
|---|---|---|
| 1 | did the towers fix the under-call? | the 60-check score |
| 3 | is WindNinja fast enough on the cloud? | wall time and $ per tile |
| 4 | which engine? | the scoreboard rule above |
| season | does anyone want it? | shared checks and area requests |

Roughly: phases 1–3 in the next 2–3 weeks, phase 4 the month after if
the gates say so.
