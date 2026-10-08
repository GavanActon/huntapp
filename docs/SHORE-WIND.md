# Plan: the wind where water meets the trees

Status: 2026-10-07, under way (Gavan: "let's start on what we can right
now"). Built so far, uncommitted: the replay harness (`app/scripts/replay.py`,
`scripts/scent_test.py`, `vite.quiet.config.ts`), rules 1, 2 and 4 in
`model.ts` and `scent.ts` (MICRO-WIND.md §4 and §7), rule 3 in
`build_microclimate.py` with the Sault test area rebaked; Pickle Lake's
micro rebake needs `--overwrite-published`, which the session's safety
check blocks, so Gavan runs it:
`py -3.14 pipeline/bake_area.py --area pickle-lake --only micro --only coverage --overwrite-published`.
The ScentCard says how much of the scent went over the trees when it is
15% or more. Gavan is at Sault Ste. Marie for a
while and can gather checks on a shore there. The windward shore is the
one he sees with his own eyes; the plan covers every shoreline issue the
model has, not that one alone.

Why it is ours to fix and not WindNinja's: the momentum solve runs on the
30 m MRDEM with one roughness class, trees, everywhere. A lake is trees to
it. Shorelines reach the model only through the rules in
`weather/micro/model.ts` and `scent.ts` and the roughness ratio in
`build_microclimate.py`. So every fix below is a browser rule or a 10 s
micro rebake, and none touches the published packs' other files.

## What is wrong at a shoreline today

| | What the model does | What happens | Where |
| --- | --- | --- | --- |
| 1. Windward shore: wind off the water into the trees | Nothing. The head-height share steps from 0.77 to about 0.05 in one cell. | The wind slows over the last 100–200 m of water, lifts over the canopy, and the low air that cannot get in turns to run along the shore. | `model.ts` canopy and edges |
| 2. Inside the windward edge | The stand's own share from the first cell in. | The first 5–10 tree heights inside a windward edge carry far more wind than the interior, and gust more. | `model.ts` canopyAt |
| 3. Lee shore and fetch: wind off the trees onto the water | The tree-line shelter (0.25 inside 3 h, recovered by 10 h), then the lake's full speed-up at once. | Right near the shore; past 10 h the wind over water keeps gaining with fetch for about a kilometre. | `build_microclimate.py` roughness; `model.ts` shelter |
| 4. Scent along a shore | Particles move in 2D, so a 20× slowdown at the tree line stacks them 20× deeper; the cone "goes far". A warm lake mixes scent down by rule, untested. | Most of that scent goes up and over the canopy. | `scent.ts` |

Field evidence so far: the 2026-09-29 slot evening 80 m off Pickle Lake
(toward 306° under a southerly forecast), the five bog mornings and
evenings where a southerly came as a NE–E drift, and the Sault WindNinja
run with trees as raised ground (`C:/tmp/windninja/sault`, fields.npz):
along the flow at 170°, the 10 m wind over the water ran 0.91 at 190 m
out, 0.76 at 100 m, 0.64 at 70 m, then 1.2 over the canopy edge.

## The field data: a shore transect at the Sault

The point of being there is to measure issues 1 and 2 directly, with the
check card as it is. No app change is needed to collect this.

**The place.** A stretch of natural shore with at least 1 km of open water
upwind and an unbroken tree wall of 15 m or more behind it. Not the cottage
strip: lawns and buildings add their own wakes, which the model has none
of (the granular-edges note). Note the wall's height from the Bush view or
by eye.

**The transect,** at right angles to the shore, points at least 45 m apart
(puffs inside 40 m and 6 min fold into one check):

| Point | Where | What it measures |
| --- | --- | --- |
| W | the water's edge, or a dock's end | the approach flow and its slowdown (issue 1) |
| E | the first trunks | the edge itself: speed, the turn along the shore, swirl |
| 2h, 5h, 10h, 20h | inside the stand, 2, 5, 10 and 20 wall heights in (for a 20 m wall: 50, 100, 200, 400 m) | the adjustment inside the edge (issue 2) |
| S, if there is one | an open strip along the shore, a wall height from the trees | the along-shore flow (the bog case) |

At each point two or three puffs (they fold into one check with every
direction kept), the strength chip, **aloft** (are the treetops moving?),
the swing arc if it swings, and a note naming the transect and the point
("ssm-A E"). The check keeps the model's call and the forecast by itself.

**When.** Onshore wind of 10 km/h or more at the forecast's 10 m, by day
(neutral or unstable air), three to five times over the week at different
speeds. Once on a settled evening (stable air). Once with the wind offshore,
for issue 3 and as the control. About 20 minutes a transect.

**If an anemometer is to hand** (a Kestrel), put the reading in the note:
"7 km/h kestrel". A single measured transect is worth ten felt ones for
fitting the constants.

**One puff watched over the water** (issue 4): from the dock in an offshore
wind, does the scent lie on the water or hold up? One look decides the
warm-lake rule's shape.

The checks stay on the phone and go out with the GPX or CSV export (the
hunt log's ⋯). Sault is Gavan's home ground: the area and anything baked
for it stay uncommitted unless he says.

## The harness: replaying checks through the model

Today's scorer (`pipeline/towers/score.py`) scales the model's logged
speed by a new grid's canopy share, which is right for the tower work and
useless here: the shoreline rules act on open cells and edges, where the
share is unchanged. The shelter and slot rules run only in the browser.

So: a replay. The app in headless Playwright (the screenshot script's
pattern), the forecast seeded from the archived HRDPS for the check's hour
(open-meteo's historical-forecast API, as the 2026-10-06 reading did), and
a dev hook `window.__groundWindAt(lon, lat, ms)` that returns the ground
wind the model would have shown. One run writes a CSV of every check with
the model's old call, the new call and the felt wind; the score is
direction within 45° and speed within 2×, by place and by regime.

This serves the Pickle checks (60, 26 at the bog), the Sault transects,
and the still-open scoring of the canopy curve (SCALE-PLAN phase 1, step
6). About a day.

**Built 2026-10-07.** `scripts/replay.py` does the above with no app
change: the app on the quiet dev server (`vite.quiet.config.ts`: hot
reload and watching off, so a module imported from `page.evaluate` is the
app's own instance), the clock set to the check's day, every
api.open-meteo.com call rerouted to the archive with matching dates and
retried on its "too many concurrent requests", the ensemble left to miss,
and `groundWind` called straight from `model.ts`. Readiness waits for the
wind grid, the micro grid and a profile with HRDPS's own hours. A day's
checks take under 10 s once the page is up. `scripts/scent_test.py` runs
`simulatePlume` the same way at named spots or "lon;lat", with the edge
rule on, off or both (`setScentEdgeRule`), for a before/after on the same
air. Outputs go to field-data/, outside the repo.

Baseline, the raw rules with no lessons, 60 checks: direction within 45°
36%, speed within 2× 30–32%, median speed ×0.31 of felt, calm agreed on
all 7. The 10 m wind the model computes is ×2.3 of felt, so the miss is
the floor share. `setShoreRules(on)` in model.ts lets one run score the
shoreline rules off and on from the same air, and the summary sets aside
the checks felt harder than the model's own 10 m wind (8 of 60): forecast
misses no floor rule reaches. CSVs in field-data/.

## The rules

First-guess constants, named where they live, to be fitted to the
transects. The literature behind them: flow at a forest edge decelerates
upwind over a few canopy heights, lifts over the edge, and adjusts inside
the canopy over 8–10 heights with a gusty zone 3–8 heights in (Dupont &
Brunet 2008; Belcher, Harman & Finnigan 2012; Cassiani, Katul & Albertson
2008); near a barrier the flow turns toward the barrier's line (Raupach
et al. 2001).

1. **Windward edge** (`model.ts`, beside the lee-side scan). **Built
   2026-10-07** as below, with 0.55 at 1 h, the normal part × 0.4 inside
   2 h recovering by 5 h, and only on a clean approach (no wall upwind
   within 10 h, no small opening, no slot). It touched one Pickle check,
   a forecast miss; the Sault transects are its test. For an open
   cell with wind, scan downwind for the first stand over 6 m within 10 h
   (the `EDGE_STEPS` scan the other way). With a wall at x:
   - speed factor 1 at 10 h falling to 0.6 at 1 h, the Sault run's shape;
   - the component normal to the wall × 0.4 inside 2 h, × 0.7 to 5 h; the
     tangential component kept. The head-height direction turns toward
     the wall's line, more the closer in, which is the bog's drift;
   - swirl inside 1 h; the reason: "a 20 m tree line 60 m ahead: the wind
     slows and runs along it";
   - for scent, the blocked normal part is lift: a particle crossing the
     edge gains height at the rate the normal component loses speed, and
     `scent.ts` already carries height.
   Coming off water the factors are the same; the difference is the fetch,
   which the roughness already has.
2. **Inside the windward edge** (`canopyAt`). **Built 2026-10-07** as
   written. On the same air, rules off then on, the bog's 24 checks (30 m
   inside a stand's edge) went from 42% to 53% within 45° and 32% to 53%
   within 2× (median ×0.26 to ×0.53 of felt); all 60: 36% to 40% and 32%
   to 40%; nothing else moved. For a stand cell, scan upwind
   for open ground within 10 h of its own height. With the edge at x in:
   the head-height share runs from 0.5 × the open share at the edge to the
   stand's share at 5 h, linearly; the gust factor is × 1.3 from 3 h to
   8 h. Beyond 10 h, as now.
3. **Lee shore and fetch** (`build_microclimate.py`, the roughness step).
   **Built 2026-10-07** (`FETCH_SHORE` 0.9, `FETCH_FULL_M` 1000, the
   habitat's fetch bands; a `water` band in the micro grid; header
   `model.fetchRamp`). At the Sault the water's ratio runs 0.92 within
   100 m of a shore on average, 1.12 at 300–600 m, 1.27 at 600–1000 m and
   1.37 beyond; the westerly momentum band 0.98 → 1.50 by its own upwind
   fetch. The water's speed ratio ramps with the mean upwind fetch: 0.9 at the
   shore to the full 1.37 at 1 km, on the 2D basis bands (SD and HD alike)
   and, per direction, on the momentum bands where the kit has them. The
   browser's tree-line shelter stays as it is for the first 10 h. A micro
   rebake, 10 s an area.
4. **Scent at an edge** (`scent.ts`). **Built 2026-10-07** (MICRO-WIND.md
   §7, Edges): where the mean head-height wind along a particle's path
   falls to 0.6 of the fastest it has had since it last lost scent, and
   that was real moving air (1 m/s or more), the particle keeps only that
   share at nose height; past an edge the puff keeps mixing upward at half
   the fastest wind it met. A stand's patchiness never counts. On the
   archived 30 September afternoon the lake cones' reach fell from about
   400 m to 95 m and the shore plateau went; stand cones did not change.
   The warm-lake rule keeps its shape or changes it on the dock puff.
5. **The slot rule** stays. Rule 1 is its generalisation to a single wall;
   where both apply the slot wins, as it does over the plain shelter now.

Rules 1, 2, 4 and 5 are browser rules: no rebake, no download for any
phone. Rule 3 is the one bake-side change.

## The bake: one band, and the rebake already in hand

The loading session has rebaked every area's grids into the range-readable
v2 file (`pipeline/habfile.py`, `habitatGrid.ts`), uncommitted, and will
deploy them. Every rebake deployed is a download of 5–9 MB an area for
every phone that keeps the maps, so the shoreline work should ride that
rebake rather than cause a second one. Two things to put in before it
ships:

- a `water` band in the micro grid (int8, 0/1, about 40 KB gzipped): the
  windward rule and the fetch scan need to know water from open ground,
  and the micro grid has no cover band (`canopy` is 0.768 on water and
  0.724 on open land, which is nothing to lean on);
- rule 3's fetch ramp on the water's speed ratio.

Both went in on 2026-10-07 once the loading session was done; the Sault
grid carries them, Pickle Lake's waits on Gavan's rebake (above), Lac
Bailey's and Highland Lake's on theirs (`--only micro --only coverage`).

Both sessions share the working tree, and `build_microclimate.py` is open
in the loading session's diff. So one session makes these edits, and it
should be the one that owns the file now. If that session cannot take them
in the next day or two, the v2 grids ship as they are and the shoreline
rebake comes later as a micro-only one.

Everything else in this plan touches `model.ts` and `scent.ts`, which the
loading session also has open (`model.ts` for the staged reads). The rules
go in after its commit, not beside it.

## The 16 directions

The momentum bake runs WindNinja once per direction, 16 of them, because
the solve is nonlinear: the mass solve needs only two basis fields, which
is why SD is cheap. What is already exploited: one speed per direction
(the pattern is the same at 8 and 22 km/h), and the two neighbours each
rotated to the actual direction before blending. What is not:

- **Fewer directions costs accuracy where it matters.** Interpolating
  165° from 135° and 180°, 45° apart, missed by a median of 2.5° and a
  p90 of 8.5°, and the p90 is the lee wakes. Eight directions halve the
  bill and blur the one thing the solve is for.
- **Screen before solving.** At Pickle no cell turns more than 20°; at
  Highland 3% do. A per-tile, per-direction screen on the terrain (the
  steepest lee slope facing away from that wind, and shores under a rise)
  would skip most tile-directions in the flat boreal. That is the cost
  cut for the cloud, not fewer directions.
- **Order by the forecast.** The next three days' HRDPS directions first,
  so an HD area's coming weekend is the full model within an hour of the
  bake starting (AREAS.md, Forecast first).
- **Stability** is the missing axis, not direction: dawn and dusk are the
  hunter's hours and the solve is neutral only. That is the GPU engine's
  job in SCALE-PLAN, where directions become minutes each.

None of this touches the shoreline rules: a lake is trees to the solve, so
the 16 directions carry no shoreline at all. Feeding our layers in (the
DEM raised by 0.7 × canopy height) is the HD check for rule 1, run at
Sault only, 16 directions in about an hour on both PCs.

## Effort and order

| Step | Dev | Field |
| --- | --- | --- |
| Transect protocol in Gavan's hands (above) | 0 | 3–5 transects over the week |
| The replay harness and the Pickle baseline | 1 day | |
| Rules 1 and 2, scored on the Pickle checks and the first transects | 1 day | |
| `water` band and rule 3 in the v2 rebake | half a day, in the loading session | |
| Rule 4 and the dock puff | half a day | one look |
| Fit the constants to the transects; write MICRO-WIND.md §4 | 1 day | |
| WindNinja with raised canopy at Sault, as the 3D check | half a day + 1 h compute | |

About four days of sessions over the week the transects take. The
harness comes first because every later step is scored on it.

## Gates

- A rule ships when direction within 45° and speed within 2× both improve
  on the bog checks and on the transects, and nothing elsewhere gets
  worse. A rule that only moves the Sault numbers waits for Pickle's
  November checks.
- The constants are fitted once, to the transects; after that the
  per-place lessons do the local work, as for every other rule.
- Sault stays uncommitted and undeployed unless Gavan says.
