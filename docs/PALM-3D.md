# Brief: the Pickle Lake narrows in 3D, for the site

Status: a brief for another agent, 2026-10-14. Nothing is built. Gavan asked for
"interesting 3D visualizations of this process to share on the site" (2026-10-13);
the PALM work itself stays with the teacher thread
([TEACHER.md](TEACHER.md), [pipeline/teacher/palm/README.md](../pipeline/teacher/palm/README.md)).
Publishing anything on groundwind.app is Gavan's call: build it, show him, deploy on his word.

## What it is for (Gavan, 2026-10-14)

To show that the wind does not do what you would guess. The air where you stand is often
not the forecast: the same forecast gives a different wind in a different place, and the
place decides it (the lake arm, the gap in the trees, the hill, the bank, the tree line).
So every scene should put **the forecast arrow beside what the air actually does**, and the
strongest pieces are pairs: the same spot under two winds, or the same wind at two spots.
The PALM thread adds runs as they land (TEACHER.md, "Funnelling, and the spots for rules");
the contrasts so far:

| contrast | the forecast says | the air at head height does | data |
|---|---|---|---|
| the narrows, wind from 186° | from the S, 11.5 km/h | turns up the lake arm and runs NE through the 30 m gap, never reversed | 2 m snapshots + mean (below) |
| the narrows, wind from 264° (nearly the same angle to the gap) | from the W | **no funnel**: the hill puts the gap in its lee, 1.6 km/h, drifting N, reversed half the time; the lake arm's air fans east instead | `pickle-slot_w270_4m` (4 m mean + 30 s samples) |
| the hill's lee slope, wind from 264° | from the W | **runs back up the hill**: the bottom 10–14 m (to the tree tops), from 90 m below the crest down to the water, 70–95% of the time at head height, while the air over the trees goes with the forecast | the same run; the side-on figure `pickle-slot_w270_4m-backflow.png` |
| a tree line, any wind | — | the air lifts 30–40 m before the trees; scent crossing a clearing goes over the first trees | 2 m mean, `pickle-slot_s186_2m-edgelift.png` |
| Lac Bailey's bank, wind from the N (Quebec) | from the N, off the land | at the shore and 60 m out over the water the air comes **off the lake, back toward the bank**, 70–80% of the time; 10 m over the trees it still goes with the forecast | `lacbailey-bank_n000_4m` (4 m) |
| Lac Bailey's bank, wind from the S | from the S, off the lake | never reversed: over the water it speeds up toward the shore and bends 20–35° left along the bank; in the trees up the bank head height is near calm (0.1–0.4× the wind) while 10 m over the trees it speeds up 1.4–1.7× up the slope | `lacbailey-bank_s180_4m` (4 m) |
| the narrows, wind from the N | from the N | funnels the other way, toward the SW, the fastest of all (1.37× the wind): the air reaches it across the open NE lake | `pickle-slot_n000_4m` |
| the narrows, wind from the NW | from the NW, square across the hill | the deepest lee: the narrows runs back toward the hill 87% of the time; the backflow up the slope is 20–25 m deep at its foot, above the trees | `pickle-slot_nw315_4m` |
| Lac Bailey's bank, wind from the W | from the W, along the shore | still a lee: a 25 m spur and tall trees just W of the shore point, so head height at the shore runs back west 67–78% of the time; 60 m out over the water it goes with the wind | `lacbailey-bank_w270_4m` (4 m) |
| Lac Bailey's bank, the N wind **at dusk** (same forecast direction, cooling air) | from the N, 8 km/h | the shore eddy is gone: cold air drains **down the bank and out over the water** (0.3–1 km/h toward the lake), then turns along the lake; at the shore the air flips from "off the lake" (daytime) to "off the land" (dusk) under the same forecast | `lacbailey-bank_dusk000_4m` (4 m, stable) |
| the hill's lee slope, the W wind **at dusk** (28 Sep 7 pm air) | from the WNW | the backflow at head height is gone: the cooling slope drains **downhill, with the wind** (0–17% reversed on the upper slope), and the lee eddy lifts off the ground to 14–30 m over the lower slope; the narrows at the bottom pools, near calm, drifting S and reversing half the time | `pickle-slot_dusk288_4m` (4 m, stable); compare `pickle-slot_w270_4m` |
| the hill's lee slope, the W wind **on a sunny morning**, and **scent** from the foot of the hill | from the W, 11.5 km/h | the backflow is back (as by day: the bottom 10 m runs up the slope 75–92% of the time). Scent from a hunter at the hill's foot by the narrows first runs **north along the foot** (toward 355–005 for 60 m, not east with the wind), rises (mean 9 m up at 10–30 m out, 27 m at 60–120 m) and only then turns east; in 15% of the minutes some reaches **120–220 m back up the hill** to the W and NW | `pickle-slot_am270_4m` (4 m, convective, with scent: `fields/pickle-slot_am270_4m_scent*`, the scent thread's output) |
| **scent** at Lac Bailey's bank, wind from the N | from the N, off the land | from a hunter **at the shore**, scent first runs NE along the shore (toward 049 for 30 m), stays near the ground longer (mean 8 → 15 m up) and in 15% of the minutes reaches 60–70 m back toward the bank or along the shore, as far as it goes out over the lake; only past 60 m does it turn out over the water (SSE). From **150 m up the bank**, where the air at head height also runs back uphill, the scent does not follow it: it lifts out of that thin layer (mean 8 → 22 → 40 m up) into the wind above and goes 470 m down over the lake, never back uphill. A reversed floor is not always reversed scent | `lacbailey-bank_n000_4m_scent` (4 m, absorbing edges) |
| **scent** at Lac Bailey's bank, the same N wind **at dusk** | from the N, 8 km/h | the opposite of the day: from 150 m up the bank the scent **creeps down the bank under the trees** toward the lake (toward 158–186), staying 2–5 m off the ground (97–100% under the canopy for 120 m), slowly (25 m in 15% of the minutes); by day the same spot's scent was 40 m up and 470 m away. From the shore it goes straight out over the lake, low, not along the shore. Same forecast, scent glued to the ground at dusk | `lacbailey-bank_dusk000_4m_scent` (4 m, stable); compare `lacbailey-bank_n000_4m_scent` |
| **scent** at the narrows, a W wind, **sunny morning vs dusk**, from the same spot (the hunter on the throat's west bank) | from the W | morning: north along the hill's foot, rising (9 → 27 m up), 440 m E and 530 m N, and 120 m back up the hill in 15% of the minutes. Dusk: the **opposite way, south down the narrows** toward the lake arm (toward 158–181), staying 6–8 m up, 90 m at most, never up the hill; 120 m up the slope the scent stays 2–3 m off the ground, 99% under the trees, and creeps 40 m. **Same forecast, opposite scent** | `pickle-slot_am270_4m` and `pickle-slot_dusk288_4m_scent` (4 m) |
| **scent** at the narrows, a **NW wind** (square across the hill, the deepest lee) | from the NW, toward the SE | scent from the hunter on the throat's west bank goes **back up the hill against the forecast** (toward 272–300 for its first 120 m, rising 11 → 33 m), reaching 190 m up the hill in 15% of the minutes against 270 m downwind; from the narrows' middle it goes up the hill (117 m) as far as downwind (108 m). The forecast's cone would point every bit of it SE | `pickle-slot_nw315_4m_scent` (4 m) |

Coming: the narrows from NW, N and along the gap both ways; the narrows from the W at dusk
(under an inversion) and on a sunny morning; Lac Bailey from the S, the W and at dusk; the
bogs SW of camp at dawn, when a southerly forecast came as a NE drift (Gavan's checks).

The 4 m runs have no 3D snapshots, only the 20-minute mean (`<run>_av_3d`, 256 × 256 at
4 m, under `pipeline/raw/windcfd/raw/teacher/palm/runs/` from xonix or
`pipeline/raw/teacher/palm/runs/` from XEVO) and the lowest four levels every 30 s
(`<run>_masked_M001`): steady streamlines and "how often it runs backwards" maps, not gusts.
Each run's ground and trees are the case's `grid-4m.npz`; Lac Bailey's are
`pipeline/teacher/palm/lacbailey-bank/` and `pipeline/raw/teacher/palm/lacbailey-bank-1m.npz`
(HRDEM QC-600023, flown 2024; UTM 19N). If a contrast needs gusts in 3D, ask the PALM
thread for a run with `viz` snapshots (README, The spot cases).

## The story it tells

At the Pickle Lake narrows (48.94641, -85.57629) a lake arm runs up from the SW into a
30 m channel through a strip of 8–15 m trees, with a 68 m hill on its west side, and
opens onto open water to the NE. On 29 Sep 2026 at about 13:00 the forecast (HRDPS) said
from 186° at 11.5 km/h; Gavan felt the wind funnel NE through the channel. PALM, a
large-eddy model with the trees in it, run at 2 m over a 1 km box, shows why:

- **The turn.** The lake arm swings the southerly onto its own line (toward 036–045°)
  before the trees do; the narrows locks it on the channel (toward 049–053° at head
  height, all of the throat running NE, almost never reversed).
- **The jet sits above head height.** In the throat, against the lake arm upwind: 0.88×
  at 2 m over the water, 1.26× at 5 m, 1.35× at 10 m, 1.56× at 20 m. The tree walls hold
  the bottom back; a stand at 5–6 m is in the jet.
- **The air lifts before a tree line.** At 215 windward tree lines in the box it starts
  rising 30–40 m out (3–4 tree heights), lifts at 10% of its speed by the edge and 15%
  just inside; at head height it slows mostly inside the trees (0.83 of the approach at
  the edge, 0.46 at 12 m in, 0.23 at 40 m in). Scent carried across a clearing goes over
  the first trees, not into them.
- **Under the trees** either side of the channel the air is slow (under 2 km/h) and
  drifts toward it.

The 2D figures Gavan has seen (copy their framing and words, not their looks):
`pipeline/raw/teacher/palm/fields/pickle-slot_s186_2m-narrows.png` (streamlines at head
height), `pickle-slot_s186_4m-narrows.png` (the same at 4 m) and
`pickle-slot_s186_2m-edgelift.png` (the side-on composite of the lift at a tree line).

## The data (on XEVO, all gitignored)

**The gusts, in 3D: the snapshots.**
`pipeline/raw/windcfd/raw/teacher/palm/runs/pickle-slot_s186_2m/OUTPUT/pickle-slot_s186_2m_masked_M002.000.nc`
(253 MB, NetCDF, PALM's masked output 2):
- `u`, `v`, `w` (m/s), dims `(time, zu_3d, y, x)` = 60 × 24 × 121 × 121, all on cell
  centres (the run interpolates to the centres). Values at or under −900 are inside the
  ground (29% of the box: the hill): treat as solid.
- `time` 3482–3600 s, every 1.97 s: the last 2 minutes of an hour of air.
- `x` 285–765 m and `y` 335–815 m every 4 m, metres from the domain's SW corner
  (`origin_x` 603720, `origin_y` 5421900, UTM 16N, EPSG:32616); `zu_3d` 1–47 m every 2 m
  over `origin_z` 337.32 m (the lake; the water plane sits at 337.3–337.5 m). Rows run south to north (row 0 is the south).
- These are instantaneous fields, so particles carried through them swirl and gust. Loop
  the 2 minutes with a fade, not a jump.

**The mean wind, finer and taller.** `.../pickle-slot_s186_2m_av_3d.000.nc` (294 MB): the
20-minute mean `u`, `v`, `w`, `e` over the whole 1 km box at 2 m, 70 levels stretching to 155 m, same
conventions (512 × 512, `zu_3d` from 0). Use it for the overview arrows or for steady
streamlines, the snapshots for motion.

**The ground and the trees.**
- `pipeline/raw/teacher/palm/pickle-slot-1m.npz`: `dtm` (1024 × 1024, m above sea level),
  `chm` (canopy height, uint16 in decimetres), `bounds` [603720, 5421900, 604744, 5422924],
  row 0 the north edge. From NRCan HRDEM 1 m LiDAR (White Lake 2021, OGL-Canada): credit it.
- `pipeline/teacher/palm/pickle-slot/grid-2m.npz`: the same box at 2 m as PALM saw it
  (`dem`, `dem_model` stepped to 2 m, `canopy_h`, `water`, `lai`), row 0 north.
- `pipeline/teacher/palm/pickle-slot/case-2m.json`: bounds, `gridConvergenceDeg` (+1.07:
  true north is 1.07° from the grid's north; turn by it when labelling compass bearings).
- The outer 160 m of the box is blended down to the lake's level (PALM's edges wrap
  around): crop to the middle 700 m, which the snapshots already sit inside.

## What to build

1. **Particle paths, worked out offline** (Python, py 3.14 has netCDF4, numpy, scipy):
   a few thousand particles released on the lake arm and across the open ground upwind of
   tree lines, at 1–20 m; carried through the 60 frames (trilinear in space, linear in
   time, RK2, steps of about 0.25 s); killed on entering the ground; positions per frame
   as int16 or float16 (a few MB) plus the speed for colour.
2. **A 3D page** (three.js from cdnjs or jsdelivr): ground mesh from the 1 m DTM thinned to
   2–4 m, trees from the CHM (a canopy surface, or instanced crowns at local maxima), a
   water plane at 337.5 m, the particles colour-coded by speed relative to the approach,
   the forecast as an arrow from 186°, a few labels (the lake arm, the narrows, the tree
   line). True scale or at most 1.5× vertical.
   Two camera moves worth having: from the SW looking up the arm into the narrows, and a
   low side view along a tree line showing the lift.
3. **A loop video** of it for the site, made the way the site's other loops were (one
   continuous 30 fps timeline; the app's loops are in `site/media/`).

## Be honest on the page

- It is a model: PALM at 2 m, 2 minutes of one afternoon, with the trees from LiDAR.
- PALM's speeds here run low (the box's wind came out at 5.6 km/h against the forecast's
  11.5, a known forcing problem in TEACHER.md), so show speed relative to the approach,
  not km/h.
- The directions and the shape of the flow are what the run is for, and they match what
  Gavan felt.

## Brand

The site's palette (forest, cream, sand, copper) and type are in `site/site.css`; the
app's wind is cyan. Keep it in the site's voice (`site/COPY.md`).

## Status 2026-10-14: built in `pipeline/teacher/palm/pickle-slot/viz/` (uncommitted)

- `scent.html` — **the showcase direction Gavan chose**: scent as smoke. A release at chest height from a hunter
  on the west bank of the throat, carried by the 60 gust snapshots (mean field outside the 480 m snapshot box),
  periodic releases so the two-minute loop is seamless, subgrid diffusion K = 0.4 m²/s, scent pools on the ground.
  Split screen against the forecast taken literally (uniform 186° at 11.5 km/h). The ground is stained where scent
  has arrived within 4 m of the surface (`arrive_*.png`, first-arrival seconds). `sim_smoke.py` makes `smoke.js`.
  Artifact: https://claude.ai/artifact/3mT5FpUKuhUnuAZexyYnUu
- `index.html` — three claims with charts (slot speed-up above head height, 43° turn at the exit vs forecast,
  lift 33 m before the shore), `export_mean.py` + `fetch_imagery.py` (Esri tiles warped to UTM). Gavan found the
  field-style views (ribbons, slices, arrows) not convincing; keep for the numbers. Artifact:
  https://claude.ai/artifact/PPofS7x799GisajYovm8Vp
- Result of the run worth stating plainly: after two minutes the ground-wind scent goes toward 041° and stains
  0.6 ha; the forecast's goes toward 008°, 0.3 ha, straight through the forest.

## Next, bigger than the viz: PALM as the scent model's teacher

Gavan's steer (2026-10-14): use the lessons from PALM to simulate how scent distributes, to help the app's model.
`sim_smoke.py` already produces, for one release point, a first-arrival footprint and a plume. Run it for a grid of
release points and heights per PALM case (slot, bog strip, bank, Searchmont dusk/midday) and the footprints become
training targets for the app's scent column (docs/MICRO-WIND.md, the puff/cone model): where scent actually goes vs
the cone, by situation (slot, shoreline, lee, canopy edge). Same two-part backwards-solve logic as WIND-LEARNING.md.
Not started.
