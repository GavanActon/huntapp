# Routes: the best ways there on foot

Route mode finds the three best ways from you (or camp) to a point, on
foot, through the bush. **Easiest** is the quickest walk. **Hunt** still
walks well, but bends toward good ground for the animal picked in Spots,
skirts the best of it rather than walking into it, and keeps your scent
off it and off the spot you are heading for.

Everything here is a model built from walking studies and the 2021 LiDAR.
It has not yet been checked against a walk at Pickle Lake. See
[Checking it](#checking-it).

## Using it

- **Open**: the route button on the map (the path with a flag), or
  **Route** in a tapped point's popup. It starts from you when the GPS
  has a fix within 50 m inside the grid, otherwise from Camp.
- **Pick where**: while the card is up, the map's tap belongs to routes. A
  tap moves where you are going, a tap on a place goes there, and a tap
  on a route line picks that route. Both ends drag. ⇄ swaps the ends,
  which gives the way back.
- **Read it**: one line per route with the time, distance and climb, and
  what sets it apart ("+4 min · driest", "+1 min · east of A"). Under the
  rows, the picked route's going (wet, thick bush, creeks, road) and how
  the wind sits for the last 150 m ("Wind in your face coming in", or a
  warning when it is at your back).
- **why ▸**: where the time goes (the flat-ground time, then the minutes
  bush, wet ground, climbing, creeks and rough ground add), how much of
  the bush was measured by LiDAR, and the knobs: pace on the flat (shared
  with the ruler) and **Stay dry**.
- **Close** (×): the picked route stays on the map, and through a reload,
  so it can be planned at camp and walked later, out hunting. **Clear**
  takes it off.

## The going grid

`pipeline/build_going.py` → `app/public/data/going-pickle-lake.hab`
(1.5 MB, in the offline bundle). It is 867 × 801 cells of 9.8 × 10.0 m
over the CORE box, the habitat grid's 30 m lattice cut 3 × 3 and aligned
to it, so a hunt route reads the Spots scores with no resampling.

| band | source |
|---|---|
| `elev` | HRDEM 1 m LiDAR DTM, area-averaged to 10 m. MRDEM 30 m where the LiDAR stops. |
| `bush` | LiDAR NRD, returns 0.5–3 m over returns 0–3 m (`build_vegstructure.py`). Where the point cloud is not fetched, the habitat bake's stand-type estimate is mapped onto the LiDAR scale. |
| `rough` | mean \|DTM − its 5 m focal mean\| per cell, from the 1 m DTM |
| `ground` | water (the LiDAR's flattened water, else OHN), marsh, open fen or bog (OHN Fen and Bog, FRI OMS), swamp (OHN Swamp, FRI TMS), road (MNRF roads, over water and creeks: culverts and bridges), creek (OHN "Stream" lines, all-touched) |

**Measured and estimated bush.** The 26 point-cloud tiles fetched so far
cover 33% of the grid; the rest is estimated from the forest map. That
estimate predicts the LiDAR poorly. Binned by the estimate, the median LiDAR
NRD barely moves: 0.15 → 0.44, 0.45 → 0.31, 0.65 → 0.59, 0.95 → 0.45
(`bake-going-summary.json`). Once mapped, the estimate spans only 0.44–0.59,
so outside the LiDAR the routes follow slope, wet ground and roads, and
treat the bush as middling everywhere. The card says so: "Bush measured by
LiDAR along N% of it". Fetching more tiles (`fetch_pointcloud.py`, about
270 MB each) and rerunning `build_vegstructure.py` then `build_going.py` is
the biggest improvement available.

## The walking model

`app/src/routes/walkModel.ts`. Speed is the pace set in the app (flat,
firm, open ground; 4 km/h by default) times one factor for each thing that
slows you. Every factor is at most 1, apart from a 2% gain on a gentle
downhill.

**Slope**: the Lorentz slope-rate curve that Campbell et al. (2019) fitted
to 421,247 GPS-tracked walks, hikes and runs, with the terms Sullivan,
Campbell et al. (2020) fitted to loaded Type 1 fire crews on trails
(moderate tertile: a −2.8292, b 20.9482, c 77.6346, d 0.2228, e −0.0004).
It is divided by its value on the flat. Uphill and downhill differ, so the
best way out and the best way back are not the same line (Campbell et al.
2017 saw this too).

| slope | −15° | −10° | 0° | +10° | +15° | +30° |
|---|---|---|---|---|---|---|
| factor | 0.80 | 0.93 | 1 | 0.78 | 0.65 | 0.40 |

Past 38° a 10 m step is a rock face or a cut bank, and its factor is cut
to a quarter.

**Bush**: Campbell, Dennison & Butler (2017) timed people walking 100 m
transects and regressed their pace on LiDAR metrics:
rate = 1.662 − 1.076 × NRD(0.15–2.75 m) − 9.011 × roughness − slope terms
(m/s; R²m 0.59, R²c 0.82). Density was the strongest effect. Our NRD band
(0.5–3 m) is close to their best one. Each unit of density costs
1.076 / 1.662 = 65% of the open rate, with a floor of 0.3:

| NRD | 0.1 open | 0.3 light | 0.47 upland median | 0.6 thick | 0.8 | 1.0 wall |
|---|---|---|---|---|---|---|
| factor | 0.94 | 0.81 | 0.70 | 0.61 | 0.48 | 0.35 |

Their study area was grass, sagebrush and juniper, not boreal alder and
fir. The slope is theirs; how it carries over to this bush is untested.

**Rough ground**: the same study, 9.011 / 1.662 = 5.4 per metre of
roughness, counted above the land's median (0.03 m) so ordinary ground
texture costs nothing, with a floor of 0.6. On a 1 m DTM this reads
lower than their 0.25 m one did, so it errs low. Roads read rough (the
window takes in the ditch), so a road cell gets the median.

**Wet ground**: open fen and bog at 1 / 1.8 = 0.56, from Soule & Goldman's
(1972) "swampy bog" terrain coefficient, as used in the Pandolf equation.
Marsh is set at 0.45 (standing water, tussocks), swamp at 0.8 (its bush is
already counted in the bush factor), and a creek cell at 0.5. Crossing a
creek adds 90 s. **Stay dry** squares the wet factors and makes a crossing
4 min. The marsh, swamp, creek and crossing numbers are judgement, not
measurement.

Roads are fast because their tread is open and smooth. No trails are
mapped here. An old skid trail that shows in the LiDAR as a low-NRD line
through thicker bush is cheaper to walk, so a route going that way will
take it. That has not been checked against a known trail yet.

## The search

`app/src/routes/router.ts` runs in a Web Worker (`routeWorker.ts`). It is
A* over the 10 m cells with sixteen moves (the eight neighbours plus the
eight knight's moves), so a path can hold 27° or 63° instead of zigzagging.
A step's time is its length times the mean seconds per metre of the cells
it crosses, divided by the slope factor of its grade, plus a crossing if it
steps onto a creek. It never crosses water, and a diagonal can't squeeze
past a lake's corner. The heuristic (straight line at the fastest possible
pace) never overestimates, so each route is optimal for its costs.

**Three routes**: the quickest, then the quickest that keeps off the
first one's corridor, and so on. Cells within about 70 m of a found route
cost 1.7 times as much on the next search, except within 120 m of the two
ends, which every route must share. An alternative counts only if less
than half of it is within 40 m of an earlier route, and it is no slower
than 1.6 × the first plus 3 minutes. If it fails the overlap test the
corridor is pushed harder and the search runs again, up to seven times.
When no third route passes, the card says "Only two real ways through
here". Three routes over 2–4 km took 75–180 ms in Node; expect a few
times that on a phone.

## Hunt routes

The Spots scores for the picked animal, at the planning time, are ranked
against the other scores under the grid. Below the 70th percentile counts
as nothing, the top 3% as the best, and nothing below a fair 0.35 counts
at all. The ranking is relative because on a quiet evening the best moose
ground may only score 0.6 ("good"), and a route still wants the best of
what is there. A step's cost is then multiplied by:

- **good ground in sight**: × (1 − 0.35 × best nearby), within one
  habitat cell (30–45 m), or two where the bush is open;
- **walking into it**: × (1 + 0.5 × this cell's value). Big game skirts
  the good ground rather than walking into it, since that is how you bump
  what is bedded there. Grouse get −0.15: you walk the cover to flush
  birds;
- **your scent on it**: × (1 + 1.6 × the best ground downwind), checked
  along three rays through the ground wind's spread, 25–200 m downwind,
  full weight to 100 m and half at 200 m. The spot you are walking to
  counts as top ground within 60 m of it, except in the last 50 m, so the
  route comes in with the wind in your face or across it. Grouse: no scent
  term.

The reported times, distances and facts are always the walk's own, not the
weighted cost. In a synthetic test (flat open ground, a good patch 150 m
beside a straight line, a steady 3 m/s wind), the moose route ran along
the patch's downwind edge whichever side the wind came from and put no
scent on it. The grouse route walked into it. At Pickle Lake on a calm
evening, the hunt route to a point 1.9 km north-west of camp ran 100–250 m
west of the easiest line, along a band of better moose ground, for 3
minutes more.

**The way in** (both modes): for the last 150 m, not counting the final
20, it measures whether the ground wind carries your scent ahead of you,
across, or behind. That is the "Wind in your face coming in" line.

## Limits

- Not field-checked. The speeds come from sagebrush transects, trails and
  Strava, not boreal bush with a pack and a bow.
- Things the data can't see: deadfall and blowdown, beaver dams and
  flooding since 2021, water levels, snow, how deep a bog is, and trails
  nobody mapped.
- Bush outside the fetched LiDAR tiles is barely more than a constant (see
  above).
- The ends are clamped to the CORE box (about 4 km round camp). Outside
  it, the card says so.
- Hunt routes rest on the Spots scores, which need a forecast (cached at
  camp), and on the ground-wind model (docs/MICRO-WIND.md), which isn't
  field-checked either.

## Checking it

The track recorder already logs every walk. The check is to walk a route
with the track on and compare the real time with the prediction. Pace
alone should close most of the gap on open ground; a consistent error in
thick bush or in bogs points to the bush slope or the wet factors. The
next step would be a "route check" that does this comparison on a
recorded track by itself, and fits the pace and the bush slope to your
own walking.

## Files

- `pipeline/build_going.py`: the bake
- `app/src/routes/walkModel.ts`: the speed model and hunt constants
- `app/src/routes/router.ts`: A*, the alternatives, the stats
- `app/src/routes/routeWorker.ts`: the worker
- `app/src/routes/goingGrid.ts`: loads the grid
- `app/src/routes/routeStore.ts`: state, the ends, the wind and hunt fields, requests
- `app/src/routes/routeLayer.ts`: the lines, the ends, the tap
- `app/src/routes/routeText.ts`: times, tags, facts
- `app/src/ui/RouteCard.tsx`, `app/src/ui/routes.css`: the card

## Sources

- Campbell, M. J., Dennison, P. E., & Butler, B. W. (2017). A LiDAR-based
  analysis of the effects of slope, vegetation density, and ground surface
  roughness on travel rates for wildland firefighter escape route mapping.
  *International Journal of Wildland Fire* 26, 884–895.
- Campbell, M. J., Dennison, P. E., Butler, B. W., & Page, W. G. (2019).
  Using crowdsourced fitness tracker data to model the relationship
  between slope and travel rates. *Applied Geography* 106, 93–107.
- Sullivan, P. R., Campbell, M. J., Dennison, P. E., Brewer, S. C., &
  Butler, B. W. (2020). Modeling wildland firefighter travel rates by
  terrain slope: results from GPS-tracking of Type 1 crew movement.
  *Fire* 3, 52.
- Soule, R. G., & Goldman, R. F. (1972). Terrain coefficients for energy
  cost prediction. *Journal of Applied Physiology* 32, 706–708; as used in
  Pandolf, K. B., Givoni, B., & Goldman, R. F. (1977), *Journal of Applied
  Physiology* 43, 577–581.
