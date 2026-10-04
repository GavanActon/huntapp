# Spec: the 1 m LiDAR into the wind and the scent

Status: spec, 2026-10-03. Phase 1 built 2026-10-04 and tested in the
browser (Phase 1, As built: where it differs from this text and what the
tests gave), not yet checked in the field. Phases 2 and 3 built
2026-10-04 in the bake and tested on scratch bakes of both areas (their As
built sections). Lac Bailey's grids are rebaked with them, all but the
review's last two touches (Phase 3, As built); Pickle Lake's published
habitat and micro grids are not yet. The command is in Phase 3, As built,
and Phase 2, As built, says what the rebake does to Spots and how the
leaf-on closure is met: Gavan chose seasonal leaf-off (2026-10-04), the
micro grid's `canopyBare`. Decided with Gavan from
[MICRO-WIND.md](MICRO-WIND.md) Next steps 7 (scent that leaves the ground
at a drop-off, now built there as §7's "Off a drop in still air") and the
question whether the 1 m LiDAR can sharpen the wind and scent. Three phases, in order of value, each shippable on its own.
Build phase 1 first: it needs no new data and it is the one a field test
can decide.

| phase | what changes | data it needs | files touched |
|---|---|---|---|
| 1 | scent particles keep their altitude off a drop in stable air | the going grid's `elev` (already on the phone) | `app/src/weather/micro/scent.ts`, `model.ts`, new `relief.ts`, the scent card |
| 2 | stand height and closure from the point cloud where it is fetched | `pipeline/raw/vegstructure-<region>.npz` (already baked) | `pipeline/build_habitat.py`, rebake micro |
| 3 | roughness length per cell from LiDAR height and cover | phase 2's bands | `pipeline/build_microclimate.py` |

What is deliberately **not** in this spec: a finer wind lattice (the solves
look at terrain smoothed to 1–3 km and gain nothing under 30 m), lee
separation and rolls below a bank (a flow solver's job, see MICRO-WIND
Limits), and a 10 m slot finder (later, once phase 2 shows what the 30 m
`treeH` does to the slots).

## The grids this works on

- **Micro grid** (`micro-<region>.hab`, `app/src/weather/micro/model.ts`):
  the habitat lattice, 30 m, the whole region. The ground wind is one
  vector per cell. Its terrain is NRCan MRDEM at 30 m; its `treeH` and
  `canopy` bands come from the habitat file's `height` and `crown`, which
  `build_habitat.py` burns from FRI 2010 stand polygons.
- **Going grid** (`going-<region>.hab`, `app/src/routes/goingGrid.ts`):
  the same lattice cut 3 × 3, 10 m, the CORE box only. Band `elev` is the
  HRDEM 1 m LiDAR DTM area-averaged to 10 m, in 0.1 m steps, MRDEM where
  the LiDAR stops (`bake-going-summary.json` `elevation_from_lidar` says
  how much). Loaded once by `loadGoing()`; `going()` is the loaded grid or
  null. Index a point with `grid.index(lon, lat)` (−1 outside).
- **Vegetation structure** (`pipeline/raw/vegstructure-<region>.npz`,
  `build_vegstructure.py`): 10 m cells in the point cloud's UTM CRS, keys
  `canopy_height` (p95 of returns over 2 m, 0 when fewer than 10),
  `canopy_cover` (share of returns over 2 m, 0–1), `density`, `understory`,
  `water`, `transform` (6 affine terms), `crs`, `nodata`. Only the fetched
  tiles have values; at Pickle Lake that is 34 tiles, 43% of the core.
  `build_going.py` already maps this grid onto the lattice (`to_lattice`):
  copy that pattern.

## Phase 1: scent that keeps its altitude off a drop

### The physics, pinned

Today every particle sits at its release height above whatever ground it
is over (`noseAt[pm]` in `simulatePlume`, indexed by path length only).
That is right when the air is neutral or convective (it mixes down to the
surface within tens of metres) and right in cold-air drainage (the cold
layer hugs the slope). It is wrong in decoupled stable air when the air is
**not** draining and the ground falls away under it: the air keeps its
level, and the scent passes over the hollow.

Rules, per particle, per step, in this order:

1. **Ground under the particle**: `g1 = elevAt(lon, lat)` from the going
   grid, nearest cell. `g0` is the previous step's ground (the source
   cell's at release). If either is NaN (outside the going grid or no
   data) the step is ground-following: `zAgl` unchanged, skip to 4.
2. **Falling ground** (`g1 < g0`): the particle keeps a share of its
   altitude: `zAgl += (g0 − g1) · keep`, where
   `keep = clamp((stable − 0.3) / 0.5, 0, 1) · (drain ? 0 : 1)`.
   `stable` is `groundStability(ms).stable` (one value for the sit).
   `drain` is 1 when the micro cell's regime is `drainage` or `pooled`
   (see the sampler change below). So below stable 0.3 nothing changes
   from today; from 0.8 up the particle keeps all of the drop. Cap
   `zAgl` at 60 m.
3. **Rising ground** (`g1 > g0`): the rise consumes altitude the particle
   gained and never takes it below its release height:
   `zAgl = max(hRel, zAgl − (g1 − g0))`. The stable lid solve already
   steers the horizontal wind round a rise; nothing lifts it here.
4. **Nose weight**: `w = noseShare(sz[pm], zAgl) / NOSE0` where `sz[pm]`
   is a 1 m table of `sigmaZ(path, stable, convective)` built once per
   plume. When `zAgl === hRel` this equals today's `noseAt[pm]` exactly
   (same σz, same release height), so a neutral day reproduces the
   current cone bit for bit.

Why these numbers: the 0.3–0.8 ramp on `stable` mirrors the ramp the
layering already uses (Ri 0.1 → 1 maps to `stable` 0 → 1, and the ground
model's own stable effects switch in from about 0.3). The hard floor at
the release height on rising ground is the conservative choice: the cone
can only get longer and thinner over low ground, never stronger anywhere
than today. Both are first guesses for the field check to move.

### Code changes

`app/src/weather/micro/relief.ts` (new, ~40 lines):

```ts
import { going, loadGoing } from '../../routes/goingGrid'
/** Ground elevation under a point from the going grid's 10 m LiDAR DTM, m; NaN outside it or before it is loaded. */
export function elevAt(lon: number, lat: number): number
/** Kick the going grid's load and call back when it lands (once). */
export function onRelief(cb: () => void): () => void
```

`elevAt` is `going()?.data.elev[idx]` with `idx = grid.index(lon, lat)`;
−1 → NaN. `onRelief` calls `loadGoing()` and runs the callback when the
promise resolves non-null. The going grid is already loaded for routes
and the Move layer, so this is usually a cache hit.

`app/src/weather/micro/model.ts`, `groundSampler`: write `out[4] = 1` when
`ev.regime` is `'drainage'` or `'pooled'`, else 0, guarded by
`out.length > 4` like `out[3]` is. `GroundSampler`'s doc comment gains the
line.

`app/src/weather/micro/scent.ts`:

- `cellSampler`: the memo holds 5 values, not 3 (`Float32Array.of(out[0..4])`)
  and copies all 5 back. The `out` passed in must be `Float32Array(5)`.
- `simulatePlume`:
  - `const out = new Float32Array(5)`.
  - Replace `noseAt`/`noseGround` with `const sz = sigmaTable(stable, convective)`
    (a `Float32Array(TABLE_M + 1)` of `sigmaZ(m, …)`), and keep `NOSE0`.
  - Per particle: `let zAgl = height`, `let zAglG = GROUND_H` (the
    ground-reference sit, which gains and loses altitude the same way),
    `let g0 = elevAt(lon, lat)`, `const keep0 = clamp((stable − 0.3) / 0.5, 0, 1)`.
  - Per step, after `x`, `y` are advanced and before the cell test: the
    rules above with `g1 = elevAt(lon + x / kx, lat + y / ky)` and
    `drain = out[4] > 0.5`. Then `g0 = g1` when `g1` is finite.
  - `const w = noseShare(sz[pm], zAgl) / NOSE0`; for `rawGround`,
    `noseShare(sz[pm], zAglG) / NOSE0`.
  - Count `lifted += w` when `zAgl > height + 2`, and `wTotal += w`.
- `Plume` gains `lifted: number` (0–1, the share of nose-height scent laid
  down by particles more than 2 m above their release height). The
  summary sets it from `lifted / wTotal` (0 when `wTotal` is 0).
- The init block that subscribes `airChanged` to `onMicro`, `onProfile`,
  `onWeatherGrid` and the wind checks (around line 1490) also subscribes
  `onRelief(airChanged)`, so cones drawn before the going grid landed are
  redrawn with it.

The scent card (where `plume.stable` already produces its line): when
`plume.stable && plume.lifted > 0.15`, add the reason
"Off the drop the scent holds its height and comes down past the low
ground" under the dig-in reasons, not up front (the app's progressive
disclosure rule: brief by default, reasons on tap). Find the card by
grepping for `plume.stable` in `app/src/ui`.

`docs/MICRO-WIND.md`: move step 7 from Next steps into the Scent section
as built behaviour (a paragraph in the same voice as "Tree stand" there),
and strike the OPEN comment in `scent.ts` at the `noseAt[pm]` line.

### Constraints

- **Determinism**: the seed and the draw order are unchanged, so the same
  spot and minute still give the same cone. Do not consume `rnd()` in the
  new code.
- **Speed**: the plume is ~130 000 samples. The new work per sample is one
  `grid.index` (a couple of multiplies and a bounds check), one array read
  and two `Math.exp`. Measure `simulatePlume` with `performance.now()`
  around the call in `draw` (devlog it once per run under the `scent`
  tag) before and after; budget +20%. If over, memoise `elevAt` per
  10 m going cell the way `cellSampler` memoises the wind.
- **Fallbacks**: no going grid (an area without a core bake, or before
  the load), or an area whose going grid has no LiDAR (elev from MRDEM,
  which is still a DEM and still fine to use): the rules still run; with
  NaN they degrade to today's behaviour exactly.
- Particles' `tracks` are unchanged (x, y only). The particle view does
  not show height; that can come later.

### How to test it

1. **Flat ground, neutral day**: pick a bog spot on a sunny afternoon.
   The cone must be identical to the one before the change (same
   `reach`, `landing`, `sectors` to 3 decimals): `keep` is 0 and
   `noseShare(sz, hRel)` equals the old table.
2. **A bank in stable air**: find a shore bank in the core from the going
   grid, a cell whose `elev` is 5 m or more above a cell 20 m away toward
   the lake (a small script against the going `.hab`, or the contours on
   the map). Sit on the lip at an hour the card calls stable, wind off
   the land. Expect: the strong band no longer sits in the hollow below
   the lip; `landing` moves out; `reach` grows; the card shows the
   reason. On the same spot by day the cone matches the old one.
3. **Drainage**: a spot at the head of a drainage line at dusk (the ground
   wind card says drainage). The cone must match the old one: `drain`
   turns `keep` off.
4. **In the field** (the test that decides it): a puff of chalk or
   unscented talc at the lip of a bank at dusk under a clear sky, watched
   to the far side, with a wind check logged at the lip and one in the
   hollow. The model says the hollow stays clear; the puff says whether it
   does.

### As built (2026-10-04)

The rules above, in `relief.ts`, `scent.ts`, `model.ts` and
`ScentCard.tsx`, written up in MICRO-WIND §7 ("Off a drop in still air").
Where the code differs from this text, and why:

- **The scale stays flat.** The reference ground sit is not lifted (no
  `zAglG`): it adds up the release-height table. Lifted, a sit on a lip
  loses its own 20–40 m core, the scale collapses and every cell reads
  stronger; at the Pickle bank that ran the cone to the grid's edge. Flat,
  a cone off a drop can only thin. No cell came out stronger than before
  in any run, so `reach` cannot grow (test 2's "reach grows" does not
  happen); `landing` moves out from a stand.
- **`lifted` weighs each step by `noseAt[pm]`**, what it would lay down at
  its release height, not by `w`. A step held well up lays down next to
  nothing, so by `w` the share fell as the lift grew: a 4 m stand on a
  10 m Lac Bailey bank, its scent then held up over the lake (before the
  water rule below), read 0.147, under the card's 0.15, with its whole
  cone gone. By the flat weight it read 0.66.
- **The card line keys on `lifted` alone**, not on `plume.stable` too:
  `keep` starts at stable 0.3, and at 0.49 the noticeable cells on the
  Pickle bank's falling ground went from 302 to 29 with the card silent.
  The words hold whether or not the scent comes back inside the grid:
  "Off the drop the scent holds its height over the low ground", and "and
  comes down where the ground rises" only with `Plume.touchdown`, when
  scent that had been more than 2 m up and came back within 2 m of its
  release height is noticeable on its own over 4 cells or more, 50 m out
  or further. Without the 50 m, a 1 km/h land breeze at a Lac Bailey bank
  (before the land breeze rule below), scent meandering back over the
  lip, said it came down with the cone 40 m long.
- **Open water warmer than the air mixes the scent down** (from the
  review). On a fall night a lake is warmer than the air over the land,
  heats the air over it from below and mixes it. So where the lake is
  more than 1° warmer than the 2 m air (`groundStability().warmWater`,
  the land breeze's own test in `model.ts`), a step over open water (the
  going grid's `ground` class) puts the particle back at its release
  height and no longer counts it as held up, so the card cannot say it
  "comes down where the ground rises" for scent the water brought down.
  Before this the biggest cuts in the tests came from scent held up
  across a lake, with the card reassuring the hunter: a Lac Bailey bank's
  cone went from 417 m to 16 m and a lake 200 m wide emptied (333
  noticeable cells to 3). A lake the estimate calls no warmer than the
  air (spring, a warm spell) still holds it up.
- **A land breeze hugs the ground** (from the review): the sampler's
  out[4] is 1 for `landBreeze` as for `drainage` and `pooled`. It is the
  land's cold air running down the bank and out over the water, and the
  scent goes down with it. At Lac Bailey's lake sit, in a land breeze from
  2026-10-03 23:00Z to 2026-10-04 12:00Z (stable 0.93–1.0), the cone held
  about 8% of its scent up before; now it is the old cone at 10 of the 14
  hours, and within 18–84 cells at the others, where the plume crosses
  cells of plain wind.
- **Off the going grid and back on, a particle starts afresh** (from the
  review): `g0` is cleared off the grid, as rule 1 has it (the previous
  step's ground), so the fall over the stretch it followed off the grid is
  not counted again as a drop when it comes back on.
- **The ground comes from `reliefNear`**: the going grid's numbers for
  the plume (where its source sits, the `elev` and `ground` bands), which
  the walk indexes from metres inline (the cell `elevAt` would find; a
  call a step cost about 0.8 ms a plume); null before the going grid
  loads, so then nothing runs at all.
- **`onRelief` does not start the load**; `ensureRelief`, called when
  cones are drawn, does, so a phone that never draws a cone never reads
  the grid (1.6 MB at Pickle Lake, 3.3 MB at Lac Bailey). A load that
  comes back empty (offline, no stored copy) is asked again by the next
  cone, and `onRelief` hears the grid land whoever loaded it
  (`goingGrid.onGoing`), so a cone drawn without it is redrawn when the
  routes or the Move layer load it.
- A held-up step skips the Gaussian once the noses are 5 σz under it; σz
  is worked out only for the steps held up, and a ground sit shares its
  reference grid until a particle is first held up. The run returns
  `relief` (the particles walked the going grid) for the dev log line:
  `scent · plume N ms · relief walked · P% held up off a drop`, or `no
  relief walked`, once an app run each way.

Tests (headless Chrome on the dev server, with the review's fixes; a
fixed 1.5 m/s wind with 20° spread unless "real"; `stable` 1.0 at
2026-10-05 23:00Z at Pickle Lake and 2026-10-04 08:00Z at Lac Bailey,
with the lakes warmer than the air at both):

| case | reach before → after | landing | lifted | comes down |
|---|---|---|---|---|
| Pickle bank (−85.5806, 48.93678), wind W | 477 → 477 m | 7 → 7 m | 0.56 | no |
| the same at stable 0.49 (`keep` 0.37) | 325 → 325 m | 7 → 7 m | 0.53 | no |
| swamp lip (−85.5774, 48.931285), wind ESE | 407 → 398 m | 7 → 7 m | 0.75 | yes |
| the same, 4 m stand | 359 → 227 m | 65 → 186 m | 0.74 | yes |
| ravine (−85.578867, 48.935335), wind S | 505 → 358 m | 7 → 7 m | 0.81 | yes |
| the same, 4 m stand | 436 → 275 m | 45 → 176 m | 0.82 | yes |
| Lac Bailey bank (−69.548267, 49.409495), wind S | 417 → 417 m | 7 → 7 m | 0.07 | no |
| the same, 4 m stand | 388 → 388 m | 45 → 45 m | 0.04 | no |
| Lac Bailey lake 200 m wide (−69.549333, 49.408505), wind E | 505 → 363 m | 7 → 7 m | 0.29 | no |

- Neutral (13 runs) and drainage (21 runs): 0 cells differ (tests 1 and
  3), before the review's fixes and after. No cell came out stronger in
  any run.
- In the hollow (ground 5 m or more under the sit), over land, the
  noticeable cells go 364 → 3 at the Pickle bank (its 200 m of ground
  falling to the lake), 189 → 0 at the swamp, 169 → 2 in the ravine; on
  the water below the banks they stay (Pickle 286 → 276, Lac Bailey
  510 → 510); on the swamp's far rise, 174 → 105. Across the lake 200 m
  wide the water keeps its scent (303 → 297) and the land beyond thins
  (256 → 120 on ground within 1 m of the sit's), with nothing coming
  down. The swamp and the ravine have no water in the way, and their
  cones are the same as before the review.
- Real wind (the forecast of 2026-10-04, 10:00Z): at the stablest hour of
  the next 48 h both banks were draining at the sit, so nothing changed
  (Pickle 197 m, Lac Bailey 302 m, no line on the card). The swamp's lip,
  in a calm at 2026-10-05 23:00Z: 106 → 65 m, and the card says the line.
- Speed: median ms a plume on the live forecast, a page without the going
  grid against one with it, alternated six times, warm sampler (the first
  plume of a minute within a point of it): the draining bank 15.6 → 17.7
  (+13%), the swamp's lip at 05:00Z 15.2 → 18.3 (+20%) and at 23:00Z
  14.5 → 17.8 (+23%), the ravine at 06:00Z 14.9 → 18.3 (+23%) and at
  23:00Z 15.8 → 18.5 (+17%), camp 15.5 → 16.1 (+4%). The review's run of
  the same check before its fixes gave up to +29%, and +42% for the first
  plume of a minute. What brought it down: the cell worked out inline
  rather than through a call (about 0.8 ms), σz and the ground sit's own
  reference grid only once a particle is held up, and fewer held-up steps
  over warm water. Memoising the ground per 10 m cell put the sit's ground
  5–7 m off the sit, so the walk reads each particle's own position.
  **Kept, though over the 20% budget at worst**: 2–3.5 ms a plume on a
  desktop, more on a phone during a drag, and only on a still night once
  the going grid has loaded (nothing by day, `keep` 0); in drainage the
  walk still runs (the draining bank's +13%) but holds nothing up.

## Phase 2: stand height and closure from the point cloud

### Why

The canopy layer (head-height fraction), the tree-line shelter, the
small-opening swirl and the slot finder all read `treeH` and `canopy`, which
are FRI 2010 stand polygons: one height to a polygon's edge, nothing for a
cutline, a skidder trail, a blowdown gap or fifteen years of growth and
harvest. The slot rule depends on wall height and a width found to 13 m,
which polygons cannot give and 10 m LiDAR can. `bake-vegstructure-summary.json`
already compares the two by stand class.

### Change: `pipeline/build_habitat.py`

After `f_ht` and `f_cc` are burnt from FRI (around line 330):

1. Load `vegstructure-<region>.npz` if it exists (else print "(no
   vegstructure: FRI heights)" and skip). Reproject `canopy_height` and
   `canopy_cover` onto the habitat lattice with `Resampling.average`,
   nodata-aware (NaN where the 10 m cell is nodata), and a third grid
   `valid` = the share of each 30 m cell covered by 10 m cells with data
   (reproject a 0/1 mask with `average`).
2. Where `valid ≥ 0.5`: `height = round(canopy_height)`,
   `crown = round(canopy_cover · 100)`. Elsewhere FRI stays.
3. Add band `("canopySrc", uint8, 1, "0 FRI stand, 1 LiDAR 2021 point cloud (leaf-on)")`.
4. Leave `cover` (the class) as FRI: species and wetland type come from
   it and the LiDAR cannot tell spruce from poplar. One exception: a cell
   whose cover is a forest class but whose LiDAR height is under 3 m and
   cover under 0.2 is a gap; set `cover` to `regen` (9) so Spots and the
   wind both read it as open. Count these and print them.
5. Print: cells with LiDAR source, the mean FRI and LiDAR height over
   those cells, and the same for closure. Expect LiDAR p95 height a little
   under FRI's for mature conifer and closure within ~10 points
   (`bake-vegstructure-summary.json`: mature closed conifer median 15.6 m,
   cover 0.71).

Then rerun `build_microclimate.py` unchanged: `roughness`, the canopy
part (`h`, `crown`) and `treeH` pick up the new bands. In the browser the
slot cache (`slotAxis`) is rebuilt when the micro grid loads, so nothing
there changes.

### Check who else reads `height` and `crown`

Grep `app/src/spots` and `app/src/routes` for the two band names. Units
are unchanged (m, %), so readers need no change, but confirm nothing
assumes a polygon-constant value (a per-stand mean, say).

### Notes

- The flight is leaf-on September 2021. Hardwood closure reads high for a
  November hunt, and nothing corrects it yet: a future canopy lesson would
  (MICRO-WIND, Next steps 5: a lesson that fits a knob, the canopy factor
  among them). Note it in the band's meaning string.
- Cells with LiDAR `height` 3–6 m now exist where FRI had 12 m stands
  (young regen, alder). The tree-line shelter and slot walls look for
  `treeH ≥ 6`, so these read as open, which is right for the wind at head
  height in alder but the slot finder may now find slots through alder
  flats. Leave the 6 m threshold; log how many open cells the core gains.
- Outside the fetched tiles nothing changes. The biggest win is fetching
  more tiles (`fetch_pointcloud.py`, ~270 MB each) and rebaking
  `build_vegstructure.py`, as ROUTES.md says.

### How to test it

- `bake-habitat-summary.json` gains the phase 2 counts.
- On the map, the wind card at a known cutline near camp (the logging
  trails the grey LiDAR shade shows) should now call the cell open, with
  a tree-line shelter note, where before it was inside a stand.
- Wind checks already logged (`windChecks`) rescore against the new grid:
  the bias per regime should not get worse. Read it off the HuntOS sheet.

### As built (2026-10-04)

`measured_canopy()` in `build_habitat.py`, run right after the cover
classes, as the steps above say. `canopySrc` names the area's own flight
(the npz's `source`) and carries the leaf-on note; with no npz the bake
prints "(no vegstructure: FRI heights)" and its bands are the old ones
exactly. `bake-habitat-summary.json` gains a `canopy` block, and the
coverage report's habitat line says how much of the core was measured.
Where the code settles what this text left open:

- **Gaps come only from the upland stands** (dense and open conifer,
  mixedwood, hardwood), judged on the unrounded averages. A treed wetland
  keeps its class: the going grid reads it as swamp and `distWetland`
  counts it.
- **The bush estimate keeps the map's classes.** Read as regen of no known
  age, Pickle Lake's two dozen gaps fell into a thin class of the going
  grid's bush calibration and moved the going bush on 27% of its cells. On
  the map's classes `thick`, `distThick`, the calibration and both going
  grids are unchanged.
- **Beyond the point cloud's grid is no value.** GDAL averages only the
  10 m cells a 30 m cell overlaps, so a cell half off the grid read as
  fully measured; a ring of empty cells round it counts the rest.

Scratch bakes of both areas, the forest map against the LiDAR:

| | Pickle Lake (34 tiles) | Lac Bailey (128 tiles) |
|---|---|---|
| cells measured | 35 591: 11% of the land, 45% of the core's | 138 004: 35% of the land, all of the core's |
| height, closure over them | 10.3 → 14.0 m, 45 → 67% | 7.8 → 9.8 m, 51 → 57% |
| the map's stands with a height | 14.8 → 15.7 m, 65 → 70% | 9.5 → 10.7 m, 62 → 65% |
| height per cell, p10/p50/p90 | −3/+1/+5 m | −3/+1/+5 m |
| gaps made young regen | 24, most in one block 1.1–1.4 km WSW of camp (FRI 13 m at 45%, LiDAR 0–3 m: likely cut since 2010) | 1 533 |
| core cells of `treeH` 6 m or more | 59 978 → 59 930 (96 fell under, 48 rose) | 65 689 → 86 575 (mostly the 1991 burn's regrowth, about 5 m on the carte) |

Hardwood closure reads high, as the note warns: 67 → 84% at Pickle Lake,
72 → 80% at Lac Bailey. The micro grid's `treeH` changed on 25 929 cells
at Pickle Lake and 103 634 at Lac Bailey, its `canopy` on 26 118 and
105 170; the going grids are band-identical. In the app the habitat's
`height` has no reader and its `crown` is loaded but not read; the gaps
reach Spots as young regen (browse 0.3, open cover) and move
`distBrowse`, `bearBrowse` and `distCover` round them. Still to do: the
cutline on the map and the rescored wind checks above, both on Pickle
Lake's rebaked grid.

**Spots moves mostly through the wind, not the gaps** (from the review).
In the app, Pickle Lake's published grids against the rebake's (a
scratch bake routed in), on the stand-in forecast at 2026-10-04 14:00
EDT (15 km/h from the west): 9 689 cells move by more than 0.01, 9 597 of
them measured and only about 440 within 300 m of a new gap. The path is
the micro grid's canopy: leaf-on closure (`crown`) cuts the head-height
fraction, the ground wind in many measured mixedwood and hardwood cells
falls under 0.8 km/h, and the scorer's calm rule takes over (`siteParts`
in `huntRules.ts`: under 0.8 km/h the site's scent part is 0.6). Measured
mixedwood goes 0.364 → 0.335 on average (2 260 cells down by more than
0.05, 377 up; closure 39 → 79%), measured hardwood 0.360 → 0.330 (537
down, 17 up; closure 56 → 83%); unmeasured cells barely move (mean
−1e-5). The published #1 spot (0.705, 2.2 km NW of camp) is mixedwood
with FRI closure 0, which the micro bake read as a near-open canopy; with
the LiDAR's 65% its canopy goes 0.168 → 0.076, its ground wind under
0.8 km/h and its score to 0.433 (×0.61), out of the top six. The sensible
part: the fresh cut WSW of camp opens to the wind (0.6 → 8.5 km/h in a
gap cell) and its edges light up (0.22 → 0.42). Nothing corrected leaf-on
closure then, so fall hardwood and mixedwood read low. **Gavan's call
before Pickle Lake is rebaked**: accept leaf-on closure in hardwood and
mixedwood for an October–November hunt, or discount it until a canopy
lesson exists (for example, scale the LiDAR's crown by the hardwood share
in `build_microclimate.py`'s canopy part).

**As built: seasonal leaf-off** (his call, 2026-10-04). The point cloud's
closure is used as measured, in leaf, and the micro grid carries the
head-height fraction a second time with the leaves down, `canopyBare`
(`build_microclimate.py`'s `leaves_down`, MICRO-WIND §4, Leaves down):
each stand's hardwood share of the closure, with the larch of a larch-led
stand and a land-cover stand's class share, thinned to 0.35 of itself,
the cover bare crowns keep. The app blends `canopy` toward it after leaf
drop (mid-October by default), and the ground wind, the scent cone and
Spots (through `groundForScoring`) follow. The forest maps' closure is
leaf-on too (summer photos), so unmeasured stands thin the same way. On
scratch bakes of the current habitat, measured hardwood goes from 0.053
to 0.119 at Pickle Lake and from 0.056 to 0.130 at Lac Bailey, measured
mixedwood from 0.053 to 0.082 and 0.064 to 0.086, dense conifer within
0.006; every band the micro grid had is byte-identical, `canopy` among
them. The roughness (phase 3's z0 and the speed ratio) stays leaf-on, a
known simplification: the phase 3 formula on the bare closure would put
the 10 m wind in measured hardwood up 4–7% (mixedwood 3%), against
×2.3–2.5 at head height, and a stand is not clearly smoother bare (Nakai
et al. 2008, MICRO-WIND Limits). A leaf-off laser would read more than
0.35 (0.57 cover against 0.88 in leaf over temperate deciduous plots at
bud-break: Wasser et al. 2013, PLoS ONE 8:e54776), but a footprint
counts every twig it clips, which is not the drag the twigs make; checks
after leaf drop are what will fit it (MICRO-WIND, Next steps 5).

## Phase 3: roughness length from LiDAR height and cover

`build_microclimate.py`, `roughness()`: take `canopySrc` too. Where it is 1:

```
h >= 3:          z0 = clip(h * (0.05 + 0.10 * cover), 0.05, 2.5)
h < 3, land:     z0 = clip(0.03 + 0.05 * h, 0.03, 0.2)
water:           unchanged (0.0002)
```

with `cover` the fraction 0–1. Dense tall conifer stays near 0.1 h as now;
an open stand gets about half that, which the class table could not say.
The 90 m ln-z0 smoothing in `speed_ratio` stays. Print the mean z0 of
LiDAR cells by cover class next to the table's values; expect them to
bracket the table. Nothing else changes. Rebake micro.

### As built (2026-10-04)

`roughness()` takes `crown` and `canopySrc` and uses the formulas above
where `canopySrc` is 1. Without the band (no point cloud) it is the class
table alone: both areas' habitats as published before phase 2 bake to the
old micro grids exactly. One thing the text left open, settled:

- **The head-height fraction keeps the class's z0.** Part 4's open-ground
  log law (2 m over 10 m) reads `z0` as well, so taken literally the change
  reaches the `canopy` band. The law holds only where the roughness is well
  under 2 m, and most of Pickle Lake's measured open wetland is not open:
  wetland on the wetland map, mostly with no FRI stand, that the LiDAR
  finds 6 m or taller in 92% of its cells (10 m at 48% on average). There
  the measured z0 near 1 m took the open-ground fraction from 0.72 to 0.31
  and the head-height wind on the measured open land to 0.37 of what it
  was (the median); at the cell of the 2026-09-29 check, which felt breezy
  to windy, to half (canopy 0.72 → 0.40). From z0 2 m up the law gives
  nothing and the floor (0.04) takes over: 168 cells at Pickle Lake, 492 at
  Lac Bailey (357 of them roads). So the measured z0 goes to the speed
  ratio only, and nothing else changes: `canopy` is as it was and the eight
  basis bands move.
- **A measured 0 m is open ground** (from the review). The class table
  and the canopy part read a height of 0 as "the forest map gave none" and
  put in 6 m for a treed wetland, 12 m for a stand. Where `canopySrc` is 1
  it is a measurement (`known_height`), so a treed wetland the point cloud
  finds open stays open. At Lac Bailey one cell (−69.4932, 49.3951, crown
  1%) was `treeH` 6 m with canopy 0.12, a wall for the tree-line, swirl
  and slot rules round it, among neighbours measured at 1–2 m that read
  open (0.54), and its z0 was already 0.03; now it is 0 m and 0.54 like
  them. Pickle Lake has no such cell. Without the band the bake is
  unchanged.

The z0 the bake prints (mean, p10–p90, against the table's over the same
cells). The stand classes bracket the table, a little above it on average
(a closure over 0.5 adds to 0.1 h): at Pickle Lake dense conifer 1.79
(1.15–2.43) against 1.51, open conifer 1.49 (0.82–2.22) against 1.35,
mixedwood 1.85 against 1.45, hardwood 2.13 against 1.72; at Lac Bailey
dense conifer 1.14 (0.47–1.74) against 1.04, open conifer 0.99 against
0.96, mixedwood 1.18 against 0.99, hardwood 1.73 against 1.32, treed
wetland 0.88 against 0.90. The open classes do not, because the point
cloud finds trees in them: at Pickle Lake open wetland 1.01 (0.46–1.62)
against 0.03, shrub 0.90 against 0.20, road 1.05 against 0.05 (a 30 m road
cell is mostly the trees beside the road); at Lac Bailey open wetland 0.34
(0.03–0.78), rock 0.40, shrub 0.39, road 1.19.

What moves, phase 2's grid against phases 2 and 3 together, over the
measured land (s the 10 m speed ratio, the head-height wind s × canopy,
its ratio as the median and p10):

| | Pickle Lake | Lac Bailey |
|---|---|---|
| in trees (`treeH` over 0) | z0 1.49 → 1.78 m, s 0.896 → 0.843, ×0.95 (0.88) | z0 1.06 → 1.25 m, s 0.957 → 0.919, ×0.96 (0.91) |
| open (`treeH` 0) | z0 0.07 → 0.99 m, s 1.117 → 0.922, ×0.82 (0.74) | z0 0.12 → 0.50 m, s 1.078 → 1.025, ×0.96 (0.87) |
| unmeasured cells nearby (the 90 m smoothing) | 14 879 on land, 4 416 on water: ×1.00 (0.98, 0.99) | 17 501 and 12 391: ×1.00 (0.99) |

By class, the median ratio: at Pickle Lake dense conifer 0.96, open conifer
0.97, mixedwood 0.93, hardwood 0.95, open wetland 0.80, shrub 0.87, road
0.85; at Lac Bailey dense conifer 0.97, open conifer 0.99, mixedwood 0.97,
hardwood 0.94, open wetland 0.95, rock 0.93, road 0.90.

In the app (headless Chrome, a stand-in forecast for a clear day and
night: 14.5 km/h from the west by day, 5.5 km/h under a strong inversion
by night), phase 2 against phases 2 and 3: by day the 2026-09-29 slot goes
from 7.8 to 7.4 km/h on the same bearing, the treed "open wetland" 1.2 km
NNW of camp from 12.2 to 9.5, a road under 11 m trees 2 km NW of camp from
6.2 to 5.0, and the stands stay under 1.5 km/h (the canopy decides there,
not the roughness); at Lac Bailey the road by the shared spot goes from
3.9 to 3.3, bare rock from 12.8 to 11.7, the stands within 0.1. At night
drainage or pooling decides every spot tried, and nothing moves by more
than 0.3 km/h.

Baked into Lac Bailey's habitat and micro grids with phase 2 (band for
band the scratch bakes; the coverage report updated), before the review:
its next habitat and micro bake (the command below for `lac-bailey`,
without `--overwrite-published`) brings the reworded `canopySrc` note,
the one cell above and the leaves-down band `canopyBare` (Phase 2, As
built), and nothing else. The micro bake still takes 5–7 s.
Pickle Lake's grids are not rebaked yet; this does it, and a scratch bake
of the current code is what it gives, band for band: in the habitat
`height` on 32 127 cells, `crown` on 34 931, `cover` on 24, `distBrowse`
on 290, `bearBrowse` on 305 and `canopySrc` new; in the micro grid
`canopy` on 26 118, `treeH` on 25 929, the eight basis bands and
`canopyBare` new; the going grid as it is. Weigh Phase 2's paragraphs on
Spots and leaf-off first:

```
py -3.14 pipeline/bake_area.py --area pickle-lake --only habitat --only micro --only coverage --overwrite-published
```

## Order and effort

1. Phase 1 code: half a day, one file of substance plus a 40-line helper.
   The subtle part is keeping the neutral-day result bit-identical; test 1
   catches a slip.
2. Phase 2: half a day in `build_habitat.py`; the reprojection pattern is
   in `build_going.py`. Then two rebakes (habitat ~1 min, micro ~2 min).
3. Phase 3: an hour.

Each phase ends with the devlog line, the doc updated, and a wind check
or two at the place it changes, before the next.
