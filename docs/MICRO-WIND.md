# Ground wind: the air at head height

The forecast wind is HRDPS at 10 m on a 2.5 km grid, which really resolves
features of about 10 km. It cannot see a ridge, a bog, a spruce stand or a
lake's lee. The ground-wind model turns it into the air a hunter feels at
2 m, at 30 m resolution, for any minute of the forecast, offline.

Code: `pipeline/build_microclimate.py` (the static part, baked to
`micro-<region>.hab`) and `app/src/weather/micro/` plus
`app/src/weather/boundaryLayer.ts` (the part that changes by the hour).

Why it exists (Gavan, 2026-09-25): in a bog at dusk the wind "wasn't in the
direction of the forecast, it had calmed down, felt the down draft was the
cause". HRDPS for camp that evening: the sky cleared at 20:00; by 22:00 the
air at 2 m was 1.3° colder than at 80 m and by midnight 2.2° colder, the
10 m wind 5 km/h against 13 km/h at 80 m. The ground air had decoupled from
the wind above and the cold air off the slopes was settling into the low
ground. The model now reproduces that: the bogs go from 7 km/h at 19:00 to
under 2 km/h at 21:30, labelled as settled cold air with the drift turned
off the forecast direction.

## The layers

### 1. Regional wind and the air's layering

- **Wind**: HRDPS 10 m at the point (`windGrid.ts`, a 5×5 lattice over the
  region, yesterday included so wind checks can be scored).
- **Layering** (`boundaryLayer.ts`, one point at camp; layering varies over
  tens of km): HRDPS temperature and wind at 2 m and 80 m, shortwave
  radiation and cloud, with the 7-day blend beyond the HRDPS horizon.
  - Potential temperature difference `dθ = T80 − T2 + 0.0098·78` K.
  - Bulk Richardson number over 2–80 m, `Ri = (g/T)·dθ·78 / ΔU²`, with
    ΔU at least 0.6 m/s. Above about 0.25 turbulence dies and the surface
    layer decouples (Stull 1988 §5.6).
  - `stable` (0–1) ramps from Ri 0.1 to 1, and only counts with a real
    inversion (`dθ ≥ 0.8 K` for full weight): in near-calm air Ri is noise.
  - `convective` (0–1): a superadiabatic layer on a sunny day.
  - Without a profile: a Pasquill-style guess from the sky, the sun and the
    wind, labelled as an estimate.
- **Ensemble spread**: the GEPS 21-member standard deviation of wind
  direction, from members over 3 km/h. It widens the scent cone in
  proportion to how much of the local wind comes from the regional wind.

### 2. Terrain and roughness: mass-consistent downscaling

Sherman (1978) and WindNinja's conservation-of-mass solver (Forthofer et al.
2014), in two dimensions.

- **First guess** `u0 = U`, uniform: the solve sees the terrain only.
- **Roughness**, applied after the solve: `u = s(x)·u_terrain`. The speed
  ratio `s` is the log law through a 60 m blending height, from the local
  roughness length to the mosaic's (`z0_ref = 0.5 m`). ln z0 is smoothed
  over ~90 m because roughness takes fetch to take hold. Water z0 is
  0.0002 m, open bog 0.03 m, shrub 0.2 m, forest 0.1·h (0.3–2.5 m). Where
  the LiDAR point cloud measured the cell (phase 3 of
  [MICRO-WIND-LIDAR.md](MICRO-WIND-LIDAR.md)) z0 is its own, from the
  height h and closure c it measured: h·(0.05 + 0.10·c) from 3 m up
  (0.05–2.5 m), so a closed stand stays near 0.1·h and an open one goes to
  about half, and 0.03 + 0.05·h under 3 m; water keeps its own. In trees
  that makes the 10 m wind 4–6% slower; on measured ground the class calls
  open, 5% at Lac Bailey and 18% at Pickle Lake, where much of the open
  wetland is treed (§4). s runs from 0.7 (forest) to 1.37 (open lake).
  Until 2026-10-01 the ratio was in the first guess, so a lake's speed-up
  had to be fed by air pulled in sideways across the shore, and the wind
  bent toward the upwind shore and off the downwind one; in the real air
  it comes down from above (an internal boundary layer) that a layer this
  thin cannot carry. Three quarters of the neutral turning was that
  artefact.
- **Layer**: the air between the ground and a lid of depth
  `H = lid + (large-scale terrain − terrain)`.
  - NEUTRAL: 250 m over the ~3 km terrain. The air goes over hills, and on
    this low shield hardly turns: measured over the whole grid (2026-10-01)
    the turn is 0.8° at the median, 2° at the 90th percentile, 18° at most.
    0.8–1.4× speed with the roughness.
  - STABLE: 50 m over the ~1 km terrain. The air goes round and channels.
    Exposed ridge tops catch the wind aloft (up to ~2.3×), valleys go
    slack; the turn is 3° at the median, 11° at the 90th percentile, up to
    60° on the flanks of the biggest hills. The browser blends toward this
    by `stable`, so by day, with any wind, the terrain steers the air very
    little; what turns the head-height wind in the bush is the trees (§4
    and §5).
- **Solve**: find the field closest to u0 that conserves mass in the layer,
  `u = u0 + ∇λ`, `∇·(H∇λ) = −∇·(H u0)`, with λ = 0 on the edges. It uses
  finite volumes on face fluxes, one sparse LU per lid, and residual
  divergence around 1e-13.
- **Linearity**: the operator is linear in u0, so a unit wind toward the east
  and one toward the north are the only solves. Any wind is
  `Ue·B_east + Un·B_north`, eight int8 bands per cell. The browser blends
  the neutral and stable basis by `stable`.
- **Night corrections**:
  - NWP models overmix stable nights, so their 10 m wind runs high then
    (Sandu et al. 2013): × (1 − 0.3·stable).
  - Low ground (a closed hollow, or ground more than a few metres below the
    ~500 m around it) keeps its cold layer while the wind slides over:
    × (1 − 0.7·stable·lowness).

#### The momentum solve (by day, since 2026-10-04)

The neutral layer above is a 2D diagnostic. On 2026-10-04 it was checked
against WindNinja 4.0.0 (US Forest Service; Forthofer et al. 2014) on 10 km
tiles at both areas, for 8 directions:

- **Against WindNinja's mass solver** (3D, the same family) the neutral layer
  turned the wind in the wrong places. Turn r was 0.54 at Lac Bailey and 0.59
  at Pickle. It under-turned at the foot of walls and over-turned on flats.
- **Against the momentum solver** (OpenFOAM, RNG k-ε), no lid or smoothing of
  the 2D layer came near. Across lids of 30–250 m and smoothing of 0.2–3 km,
  turn r topped out at 0.55 (rmse 15–17°) and speed r at 0.75. WindNinja's own
  mass solver scored only r = 0.62 against it. The momentum field has lee
  wakes, separation (2% of cells turn more than 45°) and air pushed round the
  hills. Mass conservation alone cannot make them.
- **The momentum field is safe to bake once:**
  - converged at 300 iterations (600 changed nothing; 150 drifted 0.8°);
  - the same pattern at 8 km/h as at 22, so one speed covers all;
  - directions 45° apart interpolate to 2.5° (median).
  - At 85 m it lost a wall at Lac Bailey, so it is solved at 31 m.

So `pipeline/build_windcfd.py` solves each area once:
- 16 directions, every 22.5°, at 22 km/h and 10 m, with WindNinja's `trees`
  roughness;
- over the core and 2.5 km round it, with 31 m cells at the ground;
- about 30 min a direction on a 24-core machine, 65 on a laptop.

Its kit runs on any number of machines (windcfd/run.ps1), with a progress
page (windcfd/status.py). `build_microclimate.py` writes the result as
`mU`/`mV<ddd.d>` int8 bands with the roughness ratio on, the same as the
neutral basis. That is 32 bands, about +5 MB a grid.

In the browser (`model.ts momentumAt`):
- The day wind is the two baked directions either side of the regional
  wind. Each is turned to the wind's own direction and weighted by nearness.
  At 165° that came within 1.7° (median) of WindNinja's own 165° run, against
  3.7° for the neutral layer.
- It blends toward the stable lid by `stable` as before: the momentum solve
  is neutral air only.
- A grid without the bands reads the neutral layer.

The stable lid stays. Against WindNinja's stable mode (α 0.2) it scored
r = 0.89, with the right median turn.

#### The solve's turbulence (since 2026-10-05)

The first bake kept only u and v. In the lee of a bare summit the mean flow
broke away and circled back, as it should, but it drew smooth and narrow:
only trees (§4, §5) made the air swirl. Gavan noticed it at Highland Lake,
on the north face of a 1700 m summit on a south wind. WindNinja's k-ε solve
knows the turbulence. Every area was rerun to keep it:

- **What WindNinja writes.** `turbulence_output_flag` (it needs
  `write_goog_output`) adds a GeoTIFF, in EPSG:4326 at the Google Earth
  resolution (30 m here). It holds the column's most velocity fluctuation,
  in km/h, over `COLMAX_HEIGHT_AGL` (an environment variable; WindNinja's
  default is 457 m). run.ps1 sets it to 10 m. A 0 in the grid is outside
  the domain.
- **As a spread.** `build_microclimate.py` turns it into a direction
  spread, atan(σ / local speed). Both are WindNinja's own and unscaled, so
  the ratio comes from one solve. It writes `mT<ddd.d>` uint8 bands
  (0.5°) and the area's median as `model.momentum.spreadRef`.
  - On a coarse test at 202.5°, flat ground came out at ±14°, matching
    the browser's 12° base.
  - In the summit's eddy it came out at ±60–80°.
- **In the browser** (`model.ts`), the tumble is the spread past the
  median, × (1 − stable), × a ramp from 3 to 9 km/h of regional wind. In
  a near calm the slopes' own flows run the place.
  - It adds to the spread's 12°.
  - At 25° or more it draws swirling, like a tree-line eddy.
  - At 12° or more the reasons say "The air tumbles in the lee of the high
    ground". They add "runs back the way it came" where the mean turns
    120° or more.
  - A grid without the bands keeps the old spread.

- **Fetch over water** (2026-10-07, [SHORE-WIND.md](SHORE-WIND.md) rule
  3): a lake's speed-up takes about a kilometre of open water to build,
  as an internal boundary layer grows off the upwind shore. The water's
  speed ratio runs from 0.9 at the shore to its full value by 1,000 m of
  fetch (`build_microclimate.py` FETCH_SHORE, FETCH_FULL_M; the habitat
  grid's fetch bands by the direction the wind blows from): the 2D basis
  bands by the mean fetch over the eight directions, each momentum band
  by the fetch upwind of its own direction. The micro grid also carries
  a `water` band for the browser's shoreline rules. At the Sault the
  water's ratio is 0.92 within 100 m of a shore on average, 1.12 at
  300–600 m, 1.37 past a kilometre.

### 3. Thermals

- **Cold-air drainage** (baked):
  - Cold air follows the terrain smoothed to ~100 m.
  - Potential speed `3.0·√(sin slope)·(0.6–1.0 by upslope contributing
    area)` m/s. Shallow drainage on 1–5° slopes runs ~0.3–1.5 m/s
    (Mahrt 1982; Whiteman 2000).
  - Flat ground (bogs, pools, lake surfaces) takes the smoothed inflow from
    the slopes round it (strong at the edges, cancelling in the middle),
    plus a slow creep toward the outlet along the D8 route of the filled
    surface.
  - Closed depressions are found by priority-flood filling (Barnes et al.
    2014).
  - In the browser: × strength = max(inversion·stable, 0.6·clear-sky
    cooling after the sun is under 10°), × a mixing cut-off above ~5 km/h
    of local wind, × 0.7 under trees.
- **Settled cold air**: on a settling night, low flat ground (a hollow or a
  bog) is labelled "cold air settled" rather than calm. It is a frost
  pocket, and scent sits in it and creeps toward the outlet.
- **Upslope flow**: the sun's radiation on the smoothed slope (incidence from
  the sun's elevation and azimuth against the slope's aspect).
  `1.4·√(sin slope)·(heating/600 W m⁻²)` m/s, × (1 − stable), × 0.5 under
  trees.
- **Lake and land breezes**:
  - Driven by the land–lake temperature difference. The lake is the Spots
    estimate from recent air temperatures, or seasonal.
  - Lake breeze onshore on sunny afternoons, decaying over ~500 m inland.
    Land breeze offshore at night at 40% strength, over ~300 m.
  - The strongest breeze scales with lake area, ~1 m/s off a pond to
    ~2.5 m/s off a 10 km² lake (Crosman & Horel 2010). Only lakes over
    20 ha count.
  - Cut to 15–100% on peninsulas and islands, where the breezes from each
    side meet and rise.

### 4. Canopy and edges

- **Stand height and closure** (the micro grid's `treeH` and the canopy
  below) are the point cloud's where it measured the cell (phase 2 of
  [MICRO-WIND-LIDAR.md](MICRO-WIND-LIDAR.md): the p95 of its returns over
  2 m and their share, 45% of Pickle Lake's core land and all of Lac
  Bailey's), the forest map's elsewhere (FRI 2010, the carte
  écoforestière). So growth and cuts since the inventory show, where they
  fill a good part of a 30 m cell; a narrow cutline mostly does not. A
  stand it finds open (under 3 m, under 0.2 of its returns over 2 m) is
  young regen, open to the wind, and a treed wetland it measures at 0 m is
  open ground, not the 6 m the class table puts in where the map gives no
  height. The cover class stays the map's: ground the map calls open is
  open here even where the point cloud finds trees, as it does in most of
  Pickle Lake's measured open wetland (10 m at about half cover), and only
  the roughness (§2) sees them. Lac Bailey's grids carry phases 2 and 3
  since 2026-10-04; Pickle Lake's published ones wait for their rebake.
  The closure is leaf-on, the point clouds' and the forest maps' alike:
  after leaf drop the canopy is the leaves-down fraction below (Gavan's
  call on the leaf-on closure, 2026-10-04: MICRO-WIND-LIDAR.md, Phase 2,
  As built).
- **Head-height fraction** of the local 10 m wind (the micro grid's
  `canopy`, and `canopyBare` with the leaves down):
  - Open ground: log law 2 m over 10 m (~0.7), thinned by up to 45% in a
    stable surface layer (Monin–Obukhov). It takes the cover class's z0,
    not the measured one: the law needs 2 m well above the roughness, and
    over a treed bog the measured z0 near 1 m more than halved the wind it
    gives.
  - In a stand: log law to the canopy top (displacement 0.67 h), then
    exponential decay inside, `exp(−a(1 − z/h))` (Cionco 1965; Finnigan
    2000). The coefficient a runs 1–3.8 with crown closure and conifer
    share. Dense spruce leaves ~5–15% of the wind at 2 m.
  - **Leaves down** (`canopyBare`, 2026-10-04): both point clouds were
    flown in leaf and both forest maps read off summer photos, and a fall
    hunt runs past leaf drop, when a hardwood stand lets far more of the
    wind through. So the bake gives the fraction twice: `canopy` in leaf,
    and `canopyBare`, the same formula on the closure with the leaves
    down, which the browser blends toward as they come down (mid-October
    by default).
    - The deciduous share of a stand is its hardwood %, plus the larch in
      a larch-led stand: tamarack drops its needles, and the habitat knows
      only the lead species, so a larch-led stand counts as 60% larch
      (both forest maps' larch-led stands, median 60%). Larch further down
      a stand's list stays in leaf. A stand the 2020 land cover alone
      names (no forest-map polygon, about half of Pickle Lake's
      mixedwood) takes its class's middle: needleleaf 0.1, mixed 0.5,
      broadleaf 0.9.
    - That share of the closure thins to 0.35 of itself (`BARE`), the
      cover bare branches and stems keep: leafless, a stand's plant area
      index is its wood's, 0.9–1.2 in a silver birch stand against 3.6–5.8
      in leaf (Lang & Pisek 2019) and 0.5 against about 5.6 in an Ontario
      maple–aspen forest (Neumann et al. 1989), which seen from above is
      0.2–0.5 of the cover in leaf. The larch's share also leaves the
      conifer term. Open ground, water and a treed wetland of no known
      make-up keep their fraction.
    - Measured hardwood goes from 0.053 to 0.119 at Pickle Lake and from
      0.056 to 0.130 at Lac Bailey (an open stand of the same heights:
      0.174 and 0.167), measured mixedwood from 0.053 to 0.082 and 0.064
      to 0.086 (0.153 and 0.131 open), dense conifer from 0.053 to 0.059
      and 0.069 to 0.072. So with the
      leaves down the head-height wind in hardwood is ×2.3–2.5 (the
      median), in mixedwood ×1.3–1.6, in dense conifer under ×1.1.
      Roughness stays leaf-on (Limits).
    - In the browser (`weather/micro/leaves.ts`) the head-height fraction
      is `canopy + (canopyBare − canopy) × leafOff`. leafOff goes by the
      local date:
      - full leaf until 20 September;
      - falling to bare by 15 October and bare through the winter;
      - the leaves come back from 10 May to 5 June.
      An area file may set its own four days (`leaves`). The ground wind,
      the scent cone, the wind flow, the routes' wind and Spots all read
      through it. The Wind flow button's hold drawer has **Leaves: Auto ·
      On · Down** for a fall that runs early or late. In trees, the reason
      says "leaves down" once more than half are down and the bare crowns
      let noticeably more wind through. A micro grid without `canopyBare`
      reads in leaf, as before.
- **Tree-line shelter** (browser): looking upwind from an open cell for the
  first stand over 6 m:
  - Within 3 h: shelter 0.25 and swirl.
  - 3–10 h: a linear recovery, swirl inside 5 h.
  - Windbreak and edge studies put recirculation at a few tree heights and
    recovery by ~10 h (Cleugh 1998; Dupont & Brunet 2008).
- **Small openings**: trees within 45 m on three sides or more means the
  air swirls.
- **A tree line ahead** (2026-10-07, [SHORE-WIND.md](SHORE-WIND.md) rule
  1; the windward shore): from an open cell with wind, looking downwind
  for the first stand over 6 m within 10 tree heights. The wind slows
  over the approach, 1 at 10 h to 0.55 at 1 h (the Sault WindNinja run
  with the trees as raised ground gave 0.9 at 10 h, 0.76 at 5 h, 0.64 at
  3.5 h at 10 m), and the part of it square onto the wall's line (the
  nearest of the wall within 60° either side of downwind) is held off,
  × 0.4 inside 2 h recovering to 1 by 5 h, so at head height the wind
  turns to run along the wall; inside 1 h it eddies against it. Only on a
  clean approach: a cell already sheltered by a wall upwind, or in a
  small opening, is a clearing between walls, and a slot keeps its own
  rule. First-guess constants; the Sault transects fit them. Scent that
  slows on the approach goes over by the cone's edge rule (§7).
- **Inside the windward edge** (rule 2): a stand cell looking upwind for
  open ground within 10 of its own heights (two cells of it, not a
  one-cell gap). The head-height share runs from half the open cell's
  share at the edge to the stand's own by 5 h, linearly, and from 3 h to
  8 h in the gusts are × 1.3, where the flow coming over the canopy
  reaches down (Dupont & Brunet 2008; Cassiani, Katul & Albertson 2008).
  On the 60 Pickle checks replayed on the same air (scripts/replay.py,
  rules off then on): the bog's 24 checks, 30 m inside a stand's edge,
  went from 42% to 53% within 45° and from 32% to 53% within 2× in
  speed (median ×0.26 to ×0.53 of felt); stands overall 31% to 44% in
  speed; open ground, slots and the rest unchanged; the one open check
  the approach rule touched was a forecast miss (HRDPS 8 km/h, felt
  windy). Over all 60: direction within 45° 36% to 40%, speed within 2×
  32% to 40%.

### 5. Slots and gaps

A long narrow opening with trees down both sides — a bog corridor, an old
cutline, a creek run — does not take the wind the way a plain open cell
does. The cross-slot component is blocked by the wall it comes from and its
return eddy is weak; the along-slot component runs the length of it. So the
slot, not the forecast, sets the direction at head height. This is forced
channelling, the same mechanism as in a valley (Whiteman & Doran 1993), with
the geometry of gap and street-canyon flow (Oke 1988).

- **Finding the slot** (once per cell, kept for as long as the grid is
  loaded): for an open cell (`treeH == 0`), the fetch to the first stand
  over 6 m in 24 bearings, 15 m steps to 300 m — water and open ground count
  as open, and so does the edge of the grid. The axis is the opposite pair
  with the longest combined fetch L; W is the combined fetch across it; the
  walls are the two cells across (13 m if neither is a stand). It is a slot
  when `L ≥ 2.5 W` and `W < 6·wall + 30 m`. The open end is the end of the
  axis with the longer fetch.
- **Along**: the along-axis part of the local 10 m wind, times the tree-line
  ramp for the fetch to the end it comes from, but never under 0.6. The
  along flow gathers down the whole length of the slot rather than starting
  again behind one edge.
- **Across**: within 3 tree heights of the wall it comes from, a weak return
  eddy the other way (−0.1); beyond that the usual 0.25 → 1 ramp. Still cut
  to 0.5 in a small opening.
- **The pump**: 30% of the blocked cross flow leaves by the open end and
  adds to the along flow.
- **Unsteady** when `W < 5·wall` and the cross part is the bigger one: the
  direction is the residue of two flows, so +25° of spread on top of the
  swirl.

This replaces the plain shelter product for a slot cell; every other cell
keeps the tree-line rule above.

**The case it came from** (2026-09-29, about 18:06 EDT, 48.95406,
−85.55121). HRDPS: from 191° at 17 km/h, gusts 38–44, 80% cloud, neutral.
The ground: open wetland, `treeH` 0, canopy 0.72, 80 m off Pickle Lake, and
a slot — axis 120/300, 60 m wide, 14 m walls, 300 m of fetch to the NW and
90 m to the SE, 15–45 m every other way. Gavan: the wind was "lots of, to
the 306", breezy to windy and swinging. The old rule said 2 km/h toward the
N, "15 m downwind of a 13 m tree line: sheltered" — about 65° out. The slot
rule says 4.8 km/h toward 288°, 18° out, and in the right part of the
compass for the first time. **One evening, one cell**: that is all the
validation there is.

On the calm decoupled evening the model was built on the rule changes
nothing that matters: at that cell the mechanical part stays under
0.6 km/h either way and drainage still decides the regime.

### 6. Gusts

- **Gust factor** `gf`: the hour's 10 m gust over its 10 m mean, clamped
  1–3, and 1 when the forecast has no gust to give.
- **Spread**: +12°·clamp(gf − 1.5, 0, 1), times the mechanical share.
  Wieringa (1973) writes the gust factor as 1 + g·σu/U, with g ≈ 2.5 for a
  3-second gust in ten minutes, so gf 2.5 means σu ≈ 0.6 U.
- **Gusty** when gf ≥ 1.8 and the local 10 m wind is 8 km/h or more. The
  head-height gust is the head-height mean × gf: gusts come through the
  shelter that thins the mean.
- **The scent plume runs in bursts**: a two-state chain over the sit's
  steps, bursts of about 15 s, a gust share `f = clamp((gf − 1)/3, 0,
  0.35)`, which sets the lull length. In a burst the mean wind is × gf and
  the turbulence × 1.5; in the lulls the mean is × (1 − f·gf)/(1 − f), not
  below 0.3, so the sit's mean speed is about what it was. Nothing changes
  below gf 1.1. Scent goes out in pushes and reaches further: at that cell,
  noticeable to 70 m at gf 1, 90 m at gf 2.1, 100 m at gf 2.5.

### 7. Direction spread and the scent cone

- **Spread (1-sigma)**, clamped 8–110°: 12° + 70°·exp(−U/0.6 m/s) for low
  wind meander (Mahrt 2007), plus
  - stable meander,
  - convective swings,
  - canopy +8°,
  - swirl +40°, and +25° more in an unsteady slot,
  - the tumble in the lee of the high ground, from the momentum solve's
    turbulence (§2),
  - gusts,
  - the ensemble spread for the regional share.

  A nearby wind check narrows it by a quarter, unless it was logged as
  swinging.
- **Scent cone**: a Lagrangian particle plume on the ground-wind field.
  - 720 particles released over 10 minutes and followed for 15, each
    moving with the local ground wind plus Langevin gusts (time scale
    20 s, size growing with speed and spread).
  - The mean direction meanders with the source's sigma on a 2.5 minute
    time scale, in six independent realisations.
  - Each particle is also a puff that mixes upward as it travels
    (particle–puff hybrid, as HYSPLIT does): σz from the Briggs (1973)
    rural curves along the distance travelled, neutral D blended toward
    stable F by the decoupling or toward unstable B by the convection,
    plus 1 m for the body's wake. A particle counts only for the share
    of its puff left at a deer's nose (1 m, released at 1.5 m,
    reflected at the ground). Without this, a flat 2D plume never
    dilutes upward and the far tail runs 5–10× too strong.
  - **How often, not how much** (2026-10-09; `scent.ts` oftenGrid). The
    picture is the share of the sit's minutes in which a nose there gets
    noticeable scent, in three bands: most minutes (≥ 50%), some (≥ 15%,
    the edge and the reach), now and then (≥ 3%, a faint wash). A minute
    is noticeable at a cell when its nose-height scent is at least
    `NOSE` (5.5%) of what a steady minute gives the plume core 20–40 m
    out (not the spike on the source cell). The card gives the share by
    sector and how far it stays noticeable, or "past 700 m" when it runs
    off the grid, says so on a stable night when scent hugs the ground,
    and has a dim line on what the shading means.
    - **Why**: animals answer a plume's peaks, not its average. Caged
      gypsy moths 20–80 m downwind in a deciduous forest fanned their
      wings where time-averaged Gaussian models put the pheromone orders
      of magnitude below their threshold, and the predicted dose did not
      relate to the response at all (Elkinton, Cardé & Mason 1984, J Chem
      Ecol 10: 1081). An ion tracer 10–20 m from its source, in a field and
      in a forest, was there about a fifth of the time, in bursts (Murlis,
      Willis & Cardé 2000). SF6 at 1 m under pine went in filaments a
      metre or so wide and, in slow canopy air, round all 360° within a
      release (Strand, Lamb & Thistle). Until then the cone was the sit's
      average exposure, which ranks "here a tenth of the time at full
      strength" below "here all the time, faint"; a moose in the first
      busts the sit. Within a minute the peaks run some four times the
      minute's level (CSIRO's peak-to-mean, (60 s / 1 s)^0.35 for a point
      source), at the core as much as anywhere, so a share of the core's
      minute is a share of its peaks.
    - **How**: each step a particle takes is kept with what it laid down
      at the noses and its age. After the run, each realisation's
      particles go down a minute at a time, each step as a puff laid along
      the way it came (a Gaussian footprint of σ = √(7.7² + (0.05 ×
      distance come)²) m: the average's own 3×3 blur, widening by about
      half a 10-minute plume's near-ground width, Pasquill–Gifford D, the
      rest being the meander the realisations carry), so a fast step does
      not skip cells and 30 particles a realisation read as a plume rather
      than 30 threads. The meander, the gusts and the lulls are what tell
      the minutes apart. A cell counts only the minutes a sit going on for
      hours would give it scent in, from the typical age of the scent that
      lands there to that age past the end of the release; without it the
      far field lost the minutes before its scent first arrived (the old
      average under-counted it too) and the near field those after the
      release stopped.
    - **Calibrated**: `NOSE` was 0.04 on the average; 0.055 keeps the
      steadiest air on the archive (the bog south of camp at 10–16 km/h,
      45% of the scent one way) within a tenth of the length it was tuned
      to, so only wandering air reaches farther. Over 25 spot-hours at
      Pickle (five spots, five archived hours, both changes of 2026-10-09
      against the cones before them) the reach came out a median 1.25×
      (1.09–1.67×) and the ground noticeable 1.37× (1.07–2.41×); an hour
      whose scent smeared every way (the lake strip, 18% one way) got
      shorter, 135 → 125 m. The reach is the farthest noticeable cell and
      jumps run to run on a thin tail; the ground is the steadier measure.
      The minute grid costs about 20 ms of a 55–65 ms plume on a desktop.
      None of it is checked against a moose; the bands are how often, the
      threshold is a guess.
  - **Edges** (2026-10-07, [SHORE-WIND.md](SHORE-WIND.md) rule 4): a
    particle moves in 2D, so where the head-height wind drops 20× at a
    tree line it would slow and stack up 20× deeper, and the cone read
    as running 400–600 m off a lake when the plume had in fact gone over
    the trees. Now, where the mean head-height wind along a particle's
    path falls to 0.6 of the fastest it has had since it last lost scent
    (`EDGE_DROP`), and that reference was real moving air (1 m/s,
    `EDGE_MIN`), the particle keeps only that share of its scent at nose
    height; the rest went over with the air that did not get in. A
    stand's own patchiness (10–30% from cell to cell) never counts. In
    the slow air past an edge the puff keeps mixing upward at half the
    fastest wind it met (`MIX_FROM_ABOVE`), since the air above drives it.
    The card's `over` share says how much went over the trees. On the
    archived 30 September afternoon (15 km/h over Pickle Lake toward the
    north-east shore) the cone's reach fell from about 400 m to 95 m and
    the 4–9% plateau along the shore went; cones released inside a stand
    did not change (scripts/scent_test.py, before and after on the same
    air). Not yet checked against a puff watched over the water. The card
    says how much went over when it is 15% or more.
  - **The column** (2026-10-08, "use bush type, terrain, 2D to 3D": steps
    1–5 of that pass; `scent.ts` Column, `setScentColumn` for the harness).
    Each puff has a centre height and its σz, and moves at the wind of the
    layers it spans, their shares from the reflected Gaussian: below 2 m
    the head-height wind, thinned by the bush at nose height (the going
    grid's 10 m LiDAR understory, else the habitat's `thick`; nothing to
    0.2, 0.4× at a wall); from 2 m to the slow layer's top, the wind at
    the puff's own mean height (its centre, or 0.8 σz once that is more):
    in a stand the canopy's own profile, the bake's curve read back from
    the head-height fraction and the stand height (never past the 10 m
    wind); where air drains or pools the cold layer moving as one, to its
    depth (2–15 m, growing with the drainage accumulation: a few per cent
    of the drop, Manins & Sawford); over open ground a log-like ramp from
    the head wind at 2 m to 0.85 of the 10 m wind at the top, along the
    head wind's way (the shore and tree-wall rules). On a stable night the
    slow layer is the settled air's depth, 5 m as it begins to settle to
    30 m fully decoupled, whatever the cover: the first column put a bog's
    cold pool at 2.6 m under a 4 km/h 10 m wind and the cone ran 221 m
    where the flat one sat at 135 (Gavan, 2026-10-09, "feels like a lot";
    the bog south of camp, 48.9197, −85.5877). Above the slow layer the
    local 10 m wind. So scent released under a
    canopy mixes up to the top within tens of metres and goes on at the
    wind there; a ground sit at dusk rides the drainage while a stand
    above the cold layer does not; and at a tree line the puff keeps its
    pace instead of stacking up. At a windward edge the air that does not
    get in at head height rides up over the canopy and the puff's centre
    with it, toward the stand's displacement height (0.67 h) by the share
    of the flow lost, settling again in faster air: the flat model's edge
    rule threw that share away, here it goes over and comes back down as
    the canopy's turbulence mixes it (Dupont & Brunet 2008). That retires
    the edge rule (kept for the flat model). The sampler hands the plume the 10 m vector, the stand
    height, the head-height fraction, the drainage accumulation and the
    cell (`SAMPLE_N`); the habitat grid shares the lattice, so closure,
    make-up and bush come by the same index.
    - **Mixing by cover**: σz grows (1 + c(z)·closure)(1 + 0.3·bush) times
      faster than the open rural curve, and by day 1 + 0.5·convective over
      open ground, 1 − 0.5·convective·closure under trees (the floor stays
      cool). The Langevin gusts scale with it too. The canopy's share c
      goes by the puff's mean height in the stand (2026-10-09,
      `canopyMixAt`): 1.4 at the canopy top (`canopyMix`), a quarter of
      that in the trunk space (`trunkMix`), a smooth step between a third
      and nine tenths of the stand height; a still night halves the top's
      and takes the trunk space's to nothing. Until then the stand mixed at
      0.8 everywhere, the floor as fast as the top. Vertical turbulence in
      a canopy falls from about 1.1 u* at the top to 0.3–0.5 u* near the
      floor of a dense stand (Raupach, Finnigan & Brunet 1996; Kaimal &
      Finnigan 1994); in the Forest Service's prescribed burns under New
      Jersey pitch pine smoke mixed harder near the canopy top than near
      the ground, and that set how much left the canopy (Heilman, Bian et
      al.); tracer at 1 m under pine went in threads a metre wide (Strand,
      Lamb & Thistle); night drainage under a subalpine canopy hardly
      spread upward (Yi et al. 2005). Scent released low under a closed
      canopy now stays lower and more concentrated, and deposits more on
      the way, since a shallow puff loses more to the needles: the stands'
      average reach on the archive went up 0–15% (the hardwood's 28 m
      stand 107 → 121 m by day, 119 → 137 m at night).
    - **Deposition**: each step keeps exp(−v_d·Δt / max(2 m, 2.5 σz)) of
      its scent, v_d = 0.002 + closure·(0.006·conifer + (1 − conifer)·
      (0.001 + 0.003·leaf-on)) + 0.003·bush m/s, the range of dry
      deposition velocities for odorant VOCs over vegetation; `DEPOSITION`
      scales it (1), a knob, not a number.
    - **Separation by day**: past a slope of 0.3 (17°, Wood 1995) a lee
      face in the open separates the flow in neutral air too, so the puff
      keeps the drop as it does on a still night and the hollow is passed
      over. The slope is the drop over the ground grid's own 10 m cell,
      never over the particle's step: measured over a step of a metre or
      two, every 1 m step down between cells read as a lee face. Under a
      canopy the trunk space follows its floor: no separation there.
    - **A bank upwind of the sit**, in the open: ground rising 5 m or more
      past that slope, within four rises of the sit up the 10 m wind,
      makes a cavity; while the puff is within three rises of the sit and
      below the bank's top, its low layers run back toward the bank at a
      quarter of the wind, until it has mixed up over it. Any 3 m hummock
      within 150 m counted at first, and at Lac Bailey (rough LiDAR
      ground, 2026-10-09) the near field ran backward at some source
      cells and not others: cones five metres apart "totally different".
    - **Draws**: 24 realisations of 30 particles in antithetic pairs, each
      odd one the even one's wander mirrored, seeded by the micro cell and
      the minute. Six of 120 seeded to 11 m left the cone's shape to six
      draws of the meander and re-rolled it with a few metres' move; the
      pairs make the wander average to nothing by construction, and the
      cone is the same anywhere in a cell.
    - **The body's lift**: in cold calm air (under 0.6 m/s, under 15 °C,
      both ramped) a ground sit's scent starts up to 2 m higher, the
      body's thermal plume, so a frosty dawn's cone is thinner near the
      noses.
    - **Checked on the archived air** (scripts/scent_test.py and the
      scratchpad's scent_spot.py; flat with the edge rule against the
      column, as shipped 2026-10-09): the 2 October dusk, camp 142 →
      105 m, the bog's 11 m stand 139 → 107, the lake strip at 6 km/h
      into the trees 105 → 96 (12% over the canopy), the hardwood 165 →
      127; the bog south of camp on the live air, a cold pool at 1 km/h
      187 → 185 (the strong band a third of the cells), by day at 6 km/h
      96 → 116, a 5 km/h night 203 → 225. Before the edge lift and the
      stable depth the column ran 1.5–2× the flat cones at the open
      spots (Gavan: "overall it feels like the plume is too much"). A
      6 m stand in 28 m hardwood came out shorter than the flat's, not
      longer: faster at mid-canopy, but it mixes down and deposits
      sooner. 30–180 ms a plume on a desktop. None of it is checked
      against a puff watched in the field.
  - **The sit's own checks** (2026-10-09, Gavan: "each check should
    sharpen the scent cone, that's the intent"; `scent.ts` sitAir). The
    felt checks within 600 m of the sit and 4 h of the minute, weighted
    `exp(−Δt/2 h)·exp(−d/300 m)` (4 h for one that said the wind had
    held), are the measurement of what the cone has to guess at its
    source. Every puff counts (a series keeps each; a calm one is a lull).
    Their weight W gives the checks' share of the cone, W/(1 + W): one
    fresh check at the sit is half, ten nine tenths. Each of the six
    realisations, by that share, draws its drift from a puff's way (seven
    of ten toward NE, two toward E: so goes the plume) and wanders round
    it only 15° plus half of any swing seen, instead of the model's
    meander; and the air stalls to 0.15 of its speed as often as the
    puffs hung, in lulls about a minute long. The model's spread and gust
    chain carry only the rest. Ten puffs at camp (seven toward NE, two
    toward E, one hung) took the cone from a blob with its main sector
    south at 22% to NE 33% and E 27%. The card says "Your N checks here
    drive X% of this cone". The checks already set the speed and the
    way at the spot through the ground model's blend; this is the wander
    and the lulls, which the blend threw away. Not yet: the spread per
    regime learned for later sits from the puffs' steadiness.
  - **Scent tuning** (2026-10-09, Settings → Scent tuning; `scentTune.ts`,
    `ScentTuneSheet.tsx`): every constant above on a slider with its
    modelled value marked, 25 knobs in five groups (release, spread,
    mixing upward, vegetation, terrain and edges), kept on the phone and
    read once per plume, so a change redraws the cone at once. The
    spread's knobs (near-calm, swirl, under trees, how far a fresh puff
    tightens it) are the ground model's, read per context. For tuning in
    the field against what the moose do: Gavan's father closes to 30 ft
    downwind of bulls in tight cover in all winds, which the near-calm
    blob contradicts.
  - **Tree stand**: release at 4 or 6 m instead of 1.5 m, through the same
    reflected Gaussian; with the column, at the mid-canopy wind. The grid is scaled to the same sit on the ground,
    so a stand reads as thinner near the tree, touching down farther out.
    The card gives "reaches noses from X m". It still uses the head-height
    wind: the wind at stand height is stronger, not yet modelled.
  - **Off a drop in still air** (2026-10-04, phase 1 of
    [MICRO-WIND-LIDAR.md](MICRO-WIND-LIDAR.md)): on a decoupled night,
    air that is not draining keeps its level where the ground falls away,
    so scent passes over a hollow instead of sinking into it. Each
    particle carries its height above the ground, read at every step from
    the going grid's `elev` (the 1 m LiDAR DTM averaged to 10 m, MRDEM
    where the LiDAR stops; the core only). Where the ground falls it keeps
    a share of the drop: none below `stable` 0.3, all of it from 0.8, and
    none in a cell whose regime is drainage, settled cold air or a land
    breeze (the land's cold air running down the bank and out over the
    water), which hug the ground. Rising ground takes back what it gained,
    never below the release height; 60 m at most. Over open water more
    than 1° warmer than the air (a fall night; the land breeze's own test)
    the water heats the air from below and the scent is back at its
    release height. A held-up step counts for the reflected Gaussian at
    the height it has now. The grid is still scaled to a ground sit over
    flat ground, so off a drop a cone can only thin: its reach never
    grows, and where the scent comes back down it is no stronger than it
    was.
    - A bank 1.1 km ENE of camp, 7 m down in 20 m and 20 m down to the
      lake about 200 m out, a 1.5 m/s wind off it at `stable` 1.0: over
      the falling ground the noticeable cells go from 364 to 3, and over
      the warm lake the scent is back (286, 276 now), so the cone still
      reaches 477 m.
    - A swamp 90 m across, 8 m under its lip, its far side steep (1.1 km
      E of camp): the strong band leaves the hollow (189 noticeable cells
      to none) and comes back on the far rise 170–200 m out, about 0.11 of
      the core there against 0.12–0.14 before. From a 4 m stand on the lip
      the scent first reaches noses at 186 m, not 65 m. At Lac Bailey a
      10 m bank straight onto the lake keeps its cone (417 m) on a night
      the lake is the warmer, and across a lake 200 m wide the water keeps
      its scent (303 noticeable cells, 297 now) while the land beyond
      thins: 505 m to 363 m.
    - By day, in drainage, and before the going grid has loaded (the first
      cone is drawn without it, then again when it lands) the cone is the
      old one to the cell. On the real wind, both banks were draining at
      the stablest hour of the next two days, so nothing changed; a calm
      night at the swamp's lip took the cone from 106 m to 65 m. A lake
      sit at Lac Bailey in a land breeze all night keeps the old cone, or
      comes within a few dozen cells of it where it crosses plain wind.
    - The scent card says "Off the drop the scent holds its height over
      the low ground" under its reasons once 15% of the scent is held more
      than 2 m up (each step counted for what it would have laid down at
      its release height), and "and comes down where the ground rises"
      only when the scent that came back down is noticeable on its own,
      four cells or more, 50 m out or further.
    - The walk adds 4–23% to a still night's plume on the real wind, up
      to 3.5 ms on a desktop (up to 29%, and 42% for the first plume of a
      minute, before the review's trims), and nothing by day or before the
      going grid loads (the dev log has it once a run, each way, under
      `scent`). Over the 20% budget at worst, and kept: MICRO-WIND-LIDAR.md,
      Phase 1, As built.
    - **How to check it**: a puff of chalk or unscented talc at the lip of
      a bank at dusk under a clear sky, watched to the far side, with a
      wind check logged at the lip and one in the hollow. The model says
      the hollow stays clear; the puff says whether it does.
  - **Particle view** (an option on the card): every particle replayed
    along its own path, 15 minutes in 12 s on a loop. Each is a soft puff
    whose width grows with the distance it has travelled (σ ≈ 3 m +
    0.08 × travel, a drawing aid, not the model's σy), as warm and as
    opaque as the nose-height band where it is, and gone below a trace;
    the puffs are drawn at half resolution and scaled up. A dashed line
    traces the noticeable edge (marching squares at NOTICE on the grid,
    blurred once more, specks dropped, corners cut twice) with the reach
    at its far tip, so a stand's plume shows where it touches down rather
    than a ring round the tree. It is a still frame with reduced motion.
  - What a nose notices (`NOSE`) is relative strength, not a deer or
    moose detection threshold: no published data maps these ratios to
    detection. The bands on top of it are how often.
  - **Cone size, smaller … bigger** (2026-10-01, named conservative …
    aggressive until 2026-10-03, which read either way): a slider on the
    scent card and in the Scent button's hold menu, kept across sits.
    Bigger is the conservative end below, smaller the aggressive one. The
    middle is the model as above. Toward conservative what a nose notices
    slides down, to a third at the end (1.8% of the core's minute), and
    the meander is 30% wider: the cone of a hunter who assumes scent
    counts sooner and the wind wanders more than modelled. Toward
    aggressive it slides up to three times (16.5%) and the meander is 30%
    tighter. The bands (most minutes, some, now and then) stay; the
    plume is run again, since the threshold is applied a minute at a
    time. The cone's reach, its edge, the party's overlap and where a
    moose has your wind (the swing) all follow the slider; the regional
    and ground wind do not.
  - 2026-09-26 check at camp, 4.4 km/h daytime breeze: the old picture
    ran to the 700 m grid edge; now it's noticeable to 150 m, with a
    trace to 350 m.
  - **Speed**: the ground wind is one value per 30 m micro cell, so a
    plume's ~90 000 samples are evaluated once per cell (at its centre)
    and kept, and σz with the nose-height share is a 1 m table along the
    path. Same cones (sector shares and reach unchanged, grid within
    0.2%), 40–60 ms a plume on a desktop instead of 150–220.
  - **Several people** (2026-09-27; sitting only, numbered 1, 2, 3 …):
    each person's plume is run as above, at their own height, and laid
    into one frame (each placed to the nearest 10 m cell). A cell's
    minutes with someone's scent are those with anyone's, 1 − Π(1 − share)
    with the cones taken as wandering apart (until 2026-10-09 the average
    exposures were added): a cone alone looks as it would by itself, and
    where two overlap two "now and then"s can make a "some". The card
    gives the ground noticeable at nose height
    everyone together (ha, or acres in imperial), how much of it only the
    overlap makes, and whose scent is noticeable where another person
    sits ("1's scent drifts over 3"). Views: the combined cloud; the
    combined particles inside one edge; or "By person", each person's own
    noticeable edge in their colour over the combined cloud. People drag
    about on the map and only the one moved is run again. Not yet: a
    score for the setup against where animals come in (the Spots heat map
    and each stand's feeding side), saving a setup to Places, and people
    walking a push.
  - Because particles sample the field where they are, the cone bends
    along drainage, stalls in a settled bog and turns at a tree line.

### 8. Wind checks

- **The check**: the Sharpen button on the map ("Sharpen the wind": the
  name says the model gets better where you are), a puff of powder, two
  taps (which way it goes, how hard). The model's own call for that spot
  and minute is saved first. With no usable fix the next tap on the map is
  the spot.
- **Which way, three ways, one direction** (reworked 2026-10-08, Gavan:
  "no swinging, just a single direction"; later that day "default to
  ahead: someone clicks breezy, assume it's in the direction they're
  pointed", so tapping how hard with no way given takes ahead, no more
  taps, and the card's title no longer names the place): "ahead", the
  way the phone points, saved as the direction (it used to arm a map tap
  and then still ask for an arrow: the bug Gavan hit 2026-10-08): the way
  you look at a spot seen from afar, else the compass's heading, else the
  track's course while walking (0.6 kn and a fix under 90 s old); or an
  arrow on the rose. The last
  given wins and the lit arrow again keeps it (for an hour a second tap
  cleared it, which read as the tap not taking); the lit arrow is solid
  like a chip picked; the middle shows the way as a word and a tap on it
  clears, so ahead can be backed out of; there is no
  second arrow, and with nothing to read ahead from Save asks for an
  arrow. The rose is the map's compass, turned only as the map is (its
  arrows used to turn with the live heading and slid out from under taps,
  which went missing: Gavan, 2026-10-08). A tap on the map closes the card (for an
  hour that day it was the way the powder went; Gavan: "I should be able
  to tap the map to exit"), and while the card is up the weather strip
  and the live card are off the screen. A wind that swings is read off a
  series of puffs (below), not asked.
- **The air above the trees, fitted to the sit** (2026-10-08,
  `micro/ambientFit.ts`; Gavan: "what's the wind doing here, this is the
  most likely reason"). Until then each check was a patch (below), and a
  model saying south under a hunter feeling northeast came out east, a
  direction the air never took, forgotten in 40 min. Now the checks are
  read the other way round: the forecast wind the model starts from is
  the unknown, a turn and a speed ratio on it, one for the whole sit.
  - A **sit** is this area's felt checks in order, split where more than
    2 h passes or a check is 3 km from the sit's centre. A sit's fit uses
    its newest 16 checks, each weighted `exp(−age/2 h)` against the newest
    (4 h for a check that said the wind had held, 0.7× for a swing).
  - Each candidate (turn every 15° round the circle × ratio ×0.4–×3, then
    5° and 10% steps round the best) is pushed through the ground model
    at every check's own cell and minute, with no checks blended in (the
    probe): a check in a slot is judged against what the slot would do
    under that air, a check on the bog against the bog's. The forecast is
    the prior (40° and ×1.6 at one sigma).
  - A check's direction is a Gaussian of 30° about the probe's call (plus
    half the arc of a swing; 90° when the call is near calm), on a floor
    of a tenth so one wild check cannot carry it. Its **speed is a range**
    (`STRENGTH_RANGE`: calm under 1, drift 1–2.5, light 2.5–6, breezy
    6–13, windy 13 and up km/h): the term is the probability the model's
    speed, with a ×2 log-normal error, falls inside, so a check at the top
    of the scale pulls the ratio up but never pins it. Under a canopy the
    speed counts half: it says as much about the trees' share as the air.
  - The fit is applied in `evaluate` before the land and the trees bring
    the wind down, so every cell near the checks moves together, ground
    never checked included, and a slot or a lee swings with it. Full among
    the checks, a Gaussian of 2.5 km (the forecast's own grid: one air)
    off their centre, and it **holds for hours**: an e-folding of 3 h after
    the last check (6 h held), since the forecast's error at a place
    changes on the forecast's time scale. It is an offset, not a
    direction: when the forecast veers the field veers with it.
  - It applies only when it matters (8° or ×1.2) and the checks prefer it
    to the forecast as it stands by e to one per check (`gain`). `sure` is
    the posterior's share within ±20° of the best turn.
  - The reasons say "Sharpened by your 10 checks this sit: the air above
    the trees runs 50° left of the forecast at about half its speed ·
    holds till ~2:30 unless the forecast shifts"; the map draws a faint
    1.5 km halo round the sit while the fit is in effect.
- **The place's own, blended in** (`checkWeight`): what the fit did not
  account for at a check is that place's. Each felt check is averaged into
  the model vector at weight `9·exp(−Δt/60 min)·exp(−d/100 m)`, nothing
  past 3 h or 400 m (2 h and 4.5 h for a wind that had held; 150 m and
  800 m until 2026-10-09, when Gavan found the checks "a huge circle": a
  puff speaks for the air round it, the sit's fit carries the rest), **scaled by
  likeness**: a check made under the trees corrects cells under the trees
  in full and open ground at a third, a check in a slot the slots, one with
  no call saved sits between (0.6). So a check leads the ground wind 90%
  where and when it was made (it used to be half, which left a model that
  missed by 90° still a quarter in charge), 55% at 200 m on like ground,
  and a place effect lasts as long as the regime does. On the map each
  check is its arrow and a dashed ring, no wash, out to where it has half
  the say (220 m fresh), and the sit's fit draws nothing of its own: its
  1.5 km halo read as the checks claiming the whole map. Every check counts
  the same otherwise, so where two people's checks disagree the side with
  more of them nearby carries the direction, and the reasons say so.
  Checks add up (Gavan, 2026-10-08: "multiple data points are additive"):
  from 2026-09-29 a new check within 100 m retired the ones before it
  (`until`), so a second check threw the first away; now none retires
  another, and an older one weighs less only by its age. The old `until`
  stamps stay in the log (replaced_at) and are no longer read.
- **The sit's score** (`sitScore`, the "Wind sharpened" card): each check
  of the sit judged by the fit made from the others (leave one out),
  beside the raw model and the forecast the check carried: "forecast 2/10
  · map before your checks 4/10 · map now 8/10". It cannot be gamed by
  fitting a check to itself, and it is the number that climbs as the
  checks teach. The card also says what the map read there before the
  check and what it reads now, the sit's fit in a sentence, and the puff
  that would teach the most next: one in the open when every check so far
  was under the canopy (the speed splits between the air above and the
  trees' share only with one), one under the trees when every check was
  in the open, one more where you will sit when the checks disagree.
- **Several checks that disagree** (2026-09-30): the average of two
  checks 90° apart would read as a steady wind down the middle, and of two
  opposite ones as a calm. So the checks' own circular spread (the
  resultant length R of their weighted unit vectors, σ = √(−2 ln R), the
  standard measure for wind directions) is held as a floor on sigma,
  scaled by the checks' share of the answer. Checks that agree (spread
  under 25°) tighten sigma by a quarter as before; checks that disagree
  open it, and the headline says "disagree by about ±N°".
- **A party's checks**: a check carries `by` (the initials in Settings) so
  the tally reads per person. The branch of 2026-09-30 shared each phone's
  checks as a JSON file (the share sheet: AirDrop, a message, a cable) and
  took a partner's in, from a panel the one-screen app no longer has; that
  transport is still to be put back (2026-10-01). No server: the file is
  the transport, which works at camp with no signal. Later: the same file
  over the satellite messenger.
- **Swinging**: a check can carry the arc the wind swung through while it
  was watched (45–180°), from its puffs in a series (below; until
  2026-10-08 a second arrow on the rose could say it). It holds the spread open — sigma at least
  `w·arc/2` for each blended check — and the quarter tightening a nearby
  check usually brings is skipped: a check that says "it swings" is not
  evidence of a steady wind.
- **Puffs in a series** (2026-10-02): a second puff within 40 m and
  6 min of the last check folds into it instead of replacing it. The
  folded check weighs more for it, by the square root of its puffs up to
  four, in the local blend and the sit's fit alike (2026-10-09, Gavan:
  checks at one spot "don't seem to be additive"; until then a series
  weighed as one), the cone counts every puff, and the arrow on the map
  carries the count, "×3". The
  folded check keeps every puff's direction (`dirs`, null for a puff that
  hung), and from those the arc (the spread about the mean, at least 45°
  once it is 20° or more) and how steady the air was: `steady`,
  `wavering` (arc 45° or a lull) or `swirly` (arc 90° or lulls half the
  time). Swirl is read off the puffs, no question asked; the two-arrow
  swing on the rose stays for a single puff that saw it. The model call
  saved is the first puff's, the verdict is judged on the arc.
- **Optional answers** (2026-10-02), two chips under the strength: "treetops
  moving, calm here" is the ground air decoupled from the wind above, the
  one direct test of layer 1 (saved as `aloft`, scored against the model's
  `decoupled`; the tally reads "the layering called right N of M"); "same
  as a while ago" (`held`) doubles the check's time scale (80 min, 3 h) so
  a wind that has held is trusted longer. Where you stand (open, trees,
  edge) is not asked: the habitat grid knows.
- **Lessons** (2026-10-02, `micro/bias.ts`): a check used to be a patch
  and the model believed what it had before. Now each check is also a
  lesson. Its residual against the model's RAW call (before any correction
  that call already carried, kept as `model.bias`) is charged to the layer
  that decided the call: the regime (wind, drainage, pooled, upslope,
  breezes, calm), or the slot rule where the cell was a slot
  (`model.slot`). Per lesson the weighted residuals give a turn and a
  speed ratio, applied to the model's own vector in every cell of that
  regime before the nearby checks blend in, so one check in a slot turns
  every slot. Priors and forgetting keep a puff from swinging it: four
  pseudo-checks of zero bias in the mean, a 14-day e-folding on each
  check's weight, a swinging check at half weight, the turn capped at
  ±45° and the ratio within 0.5–2. Below 5° and 15% nothing is applied.
  **Wind under the trees** (2026-10-07) is its own lesson: plain wind in
  a stand (`model.woods`) teaches the canopy decay rather than the
  regime, with the ratio allowed 0.25–4, since the 60 checks of Sep–Oct
  2026 felt breezy where the floor was called at 3 km/h. A calm check
  under moving treetops (`aloft`) counts there at calm's 0.3 km/h, the
  clearest case of the canopy holding the wind off; elsewhere a calm
  check still teaches no ratio. Checks made before the flag stay in the
  plain-wind lesson.
  The reasons say "Turned 18° clockwise by 6 wind checks in plain wind
  this season"; the hunt log's "How the map is doing" tallies hits by
  lesson and shows what each has learned.
- **Scoring**: agree within 45° (or both calm), close within 90°. The
  Weather tab shows the running tally.
- **Reading a puff** (2026-10-08, Gavan: "out of reach within a second,
  10 ft out within a second"): the powder shows the first second of
  travel and no more. It thins faster the harder it blows, so how far it
  goes before it fades says little and how far it gets in a one-count
  says nearly everything. The chips are set to that: an arm's reach
  (0.75 m) in a one-count is about 3 km/h (light), a stride or two 5–6
  (breezy's floor), 10 ft (3 m) 11, and past 10 ft in a second it is gone
  (windy, 13 and anything above). Each chip says three things, short:
  how far in a second, what the powder looks like, what you feel (the
  line under "How hard?" that explained the first-second rule was cut
  the same day: Gavan, "cut the text under that"). Old checks keep their
  words and fall in the same ranges.
- **How many, how often** (Gavan's question, 2026-10-02; the numbers
  since 2026-10-08): a check leads the ground wind where it was made 90%,
  77% an hour on, 55% at two, nothing past 3 h, and from the second check
  of a sit the air above is fitted and holds for hours, so a sit wants one
  at the start, a second 50 m or more away to fit rather than patch, one
  at any shift, and one in the open if the rest were under the trees;
  puffs within 6 min and 40 m fold into one check (the swing). A lesson has PRIOR_N = 4
  phantom checks of zero bias, so n checks apply n/(n+4) of the mean
  residual (1 → 20%, 4 → 50%, 12 → 75%), with a 14-day e-folding: four or
  five checks per regime per week teaches it, then maintenance. The
  "Wind sharpened" card says the verdict, the pull, the lesson's tally and
  when to check next; the live card asks for a check when the last one has
  faded below a quarter, when it missed and 20 min have passed, or when a
  sit has none. How we hunt here (§3) says the same for the hunter.
- **Felt by default** (2026-10-09): a check opened on a spot away from
  you is a puff there unless "treetops seen from afar" is tapped. Until
  then any tap more than 60 m from the fix made a seen check without
  asking, so a day's puffs went in as looks at the treetops, with a reach
  of kilometres and no say in the sit's fit, the local blend or the cone
  (Gavan: "still looks like 1.75 km from the wind check to the edge of
  the ring"). A seen check's popup can make it felt after the fact, and
  its ring is drawn at the half like a felt one's.
- **Seen from afar** (2026-10-08, Gavan: "I'm ranging, I see trees moving
  out in the distance"): the map popup's Wind on a spot away from you
  (over 60 m from a good fix) opens the check as `seen`. The rose faces
  the spot (the line from your fix to it, so the arrow to tap is the way
  the treetops lean as you see them; north up with no fix, and then the
  card asks "seen from afar" or "felt there"), and how hard is Beaufort's
  signs read at a distance: still (3 km/h at 10 m), leaves and ripples
  (12), small branches and the first whitecaps (24), small trees swaying
  (33), big branches and whole trees (45). That is the wind above the
  trees, about the forecast's 10 m wind, not the head-height air, so it
  never blends in as the floor's air (that would call the wind under the
  canopy 5–20× too hard). Instead it turns and scales the forecast wind
  the cell starts from, before layer 2: the turn and the speed ratio
  (0.2–3) against the forecast where and when it was seen, kept so the
  forecast's own change over the hour carries on under it (against a
  forecast under 3 km/h, or none saved, its own wind is held instead).
  Weight `2·exp(−Δt/40 min)·exp(−d/2.5 km)`, nothing past 2 h or 8 km:
  two thirds of the turn where and when it was seen, the forecast the
  rest. Because it enters before the momentum field, the slots, the lees
  and the shelter all swing with it, and the reasons say "Treetops seen
  660 m away, 0 min before this time: the wind above is from the SW (the
  forecast had W), 31% stronger". It keeps no model call, so `verdict` and
  the lessons skip it; it is scored against the forecast (calm under
  6 km/h), carries `strength` as the nearest felt word for older readers
  (the Worker's check, an older phone in the party, which would read it
  as felt), `seenFrom` the fix, and it never folds puffs. On the map its
  arrow has a ring, and two rings of reach: the inner, washed, as far as it
  makes up half the wind above (1.7 km when made, gone after ~28 min), the
  outer a faint dashed edge as far as a tenth (7.2 km when made). Not field-checked: how well treetop lean reads at 300–800 m, and
  whether two thirds is the right trust against HRDPS, want a season of
  seen checks beside powder ones.
- A camp station can later post checks with `source: 'station'`.
- The phone's barometer is not available to a web app.

## Limits

- **Not validated in the field yet.** The constants are from the literature
  and one evening's check. The wind checks exist to measure and correct
  it; keep logging them.
- The fit of the air above and the 90% local blend (§8) are scored only
  by replay so far (`scripts/replay.py --loo`, each of the 60 checks of
  Sep–Oct 2026 judged by the others of its day), not by a sit in the
  field. Over all 60: direction within 45° 40% raw, 42% with the local
  blend, 43% with the fit as well (the median miss 68° → 53° → 48°); speed
  within 2× 38% → 55% → 55% (median ×0.32 → ×0.57); calm agreed 100% →
  86%. The fit reached 10 of the 60 (sits of two or more checks in air
  the forecast wind could move): there, direction 30% → 50% → 60% and
  speed 10% → 80%. On the ten breezy-or-windy checks direction went 40%
  → 60% → 70%. The bog's dawn and dusk checks (24) sit in drainage and
  pooled air the ambient cannot move: 53% → 58% from the blend alone. The
  midday drifts that pointed every way got worse under any blend (38% →
  25% by day): a drift's direction is weak evidence, hence its half
  weight, and swirling air scores as a coin toss whatever is drawn. So
  most of the gain so far is the blend's; the fit's is direction in real
  wind. Its reach (2.5 km) and hold (3 h) are first guesses at the
  forecast's own scales, and one sit of one check moving the air cost a
  hit, hence the two-check rule. With the local reach cut to 100 m and
  400 m (2026-10-09) the same replay gives 38% → 40% → 42% on direction
  and 40% → 51% → 53% on speed: a point or two given up for checks that
  stay where they were made.
- The slot rule too is one evening at one cell (2026-09-29), and it is the
  biggest single change to a head-height direction the model makes. About a
  fifth of the open ground in the core reads as a slot, so it wants checks
  in a few of them before it is trusted.
- By day the terrain is now WindNinja's momentum solve (§2), which does
  separate in the lee and push air round the hills.
  - It is RANS, a steady mean flow. It is not the gusting eddy below a bank;
    that comes from the gust and swirl rules.
  - Its roughness is one class (`trees`) everywhere, with ours put on after,
    as for the neutral layer.
  - It is neutral air only. Stable air still has the 2D stable lid, and that
    lid gets channelling and blocking but no separation.
  - It is not checked in the field yet. The wind checks are the test.
- Ground the cover class calls open where the point cloud finds trees
  (much of Pickle Lake's open wetland: wetland on the wetland map with no
  FRI stand) is open at head height: `treeH` 0, the open-ground fraction,
  the slot and tree-line rules. Only the speed ratio sees the trees.
  Reading those cells as treed would change the slots and the shelter as
  well, the 2026-09-29 slot among them, and wants checks there first.
- Leaves down (§4) is the literature's, not a check: `BARE` and the larch
  share are first guesses, and larch further down a stand's list stays in
  leaf. The roughness (z0 and the 10 m speed ratio, §2) stays leaf-on, a
  known simplification. Thinning it by the phase 3 formula on the bare
  closure would put the 10 m wind in measured hardwood up 4–7% (the
  median; mixedwood 3%), small next to ×2.3–2.5 at head height, and
  whether a stand is smoother bare is not settled: its displacement
  height falls with the leaves, its roughness length not simply (Nakai et
  al. 2008).
- Scent off a drop (§7) is a rule, not a solve: the share of a drop a
  particle keeps and the floor at its release height are first guesses
  with no check behind them yet. So is the water's part: over open water
  more than 1° warmer than the air the scent is put straight back at its
  release height, as if the water mixed it down at once and all the way,
  and a lake the estimate calls no warmer holds it up. A puff watched out
  over the water would say.
- Drainage speeds are potentials, not measurements. Timing (when the
  inversion forms or breaks) comes from HRDPS's 2 m and 80 m temperatures,
  and HRDPS itself is weakest in exactly those stable hours.
- Layering is one point for the whole region.
- A lesson is one turn and one ratio per regime for the whole region. A
  bias that is really one stand's (a slot the rule misreads) is spread over
  every cell of its regime until checks elsewhere pull it back. Per-place
  lessons want more checks than a season gives.
- The lake temperature is an estimate. The breeze strength is only as good
  as that.

## Next steps, if we go further

1. ~~Cross-check the stable and neutral fields against WindNinja runs~~:
   done 2026-10-04, and the day layer is now WindNinja's momentum solve
   (§2). Next for it:
   - score it against the wind checks, old and new side by side;
   - feed WindNinja the habitat grid's roughness (an .lcp of stand height and
     cover) in place of one class.
2. One or two stations (a Tempest or an ESP32 with a sonic anemometer over
   LoRa) at camp and a stand. Bias-correct HRDPS and fit the thermal
   constants.
3. Use the ground wind in the Spots site score (scent geometry per cell)
   instead of the regional direction.
5. Lessons that fit a knob, not a turn: the slot gain, the inversion's
   timing, the canopy factor, each from the residuals of the checks that
   layer decided. The per-regime turn is the first step toward it. The
   canopy factor's first knob is `BARE`, the share of its closure a bare
   crown keeps (§4, Leaves down): the leaf-on closure of both point clouds
   is now thinned after leaf drop by a literature value, and checks in
   hardwood and mixedwood after the leaves are down would fit it (the
   habitat's `canopySrc` note points here; MICRO-WIND-LIDAR.md, Phase 2,
   As built).
6. The model asking: when two regimes are close in a cell (drainage against
   the regional wind at dusk) a nudge to check the wind there, since those
   transition checks are the ones that fit timing.
4. Large-eddy simulation (PALM, Leibniz Universität Hannover) of the
   top stands for typical dawn and dusk cases, baked like the rest.

## Sources

- Barnes, R., Lehman, C., Mulla, D. 2014. Priority-flood: an optimal
  depression-filling and watershed-labeling algorithm. Computers &
  Geosciences 62:117–127.
- Cionco, R.M. 1965. A mathematical model for air flow in a vegetative
  canopy. J. Appl. Meteor. 4:517–522.
- Cleugh, H.A. 1998. Effects of windbreaks on airflow, microclimates and
  crop yields. Agroforestry Systems 41:55–84.
- Crosman, E.T., Horel, J.D. 2010. Sea and lake breezes: a review of
  numerical studies. Boundary-Layer Meteorol. 137:1–29.
- Dupont, S., Brunet, Y. 2008. Edge flow and canopy structure: a
  large-eddy simulation study. Boundary-Layer Meteorol. 126:51–71.
- Finnigan, J. 2000. Turbulence in plant canopies. Annu. Rev. Fluid Mech.
  32:519–571.
- Forthofer, J.M., Butler, B.W., Wagenbrenner, N.S. 2014. A comparison of
  three approaches for simulating fine-scale surface winds in support of
  wildland fire management. Part I. Int. J. Wildland Fire 23:969–981.
- Lang, M., Pisek, J. 2019. Tracking the long-term structure changes of a
  mature deciduous broadleaf forest stand using digital hemispherical
  photography. Forestry Studies 70:80–87.
- Mahrt, L. 1982. Momentum balance of gravity flows. J. Atmos. Sci.
  39:2701–2711.
- Mahrt, L. 2007. Weak-wind mesoscale meandering in the nocturnal boundary
  layer. Environ. Fluid Mech. 7:331–347.
- Nakai, T., et al. 2008. Parameterisation of aerodynamic roughness over
  boreal, cool- and warm-temperate forests. Agric. For. Meteorol.
  148:1916–1925.
- Neumann, H.H., den Hartog, G., Shaw, R.H. 1989. Leaf area measurements
  based on hemispheric photographs and leaf-litter collection in a
  deciduous forest during autumn leaf-fall. Agric. For. Meteorol.
  45:325–345.
- Oke, T.R. 1988. Street design and urban canopy layer climate. Energy and
  Buildings 11:103–113.
- Sandu, I., Beljaars, A., Bechtold, P., Mauritsen, T., Balsamo, G. 2013.
  Why is it so difficult to represent stably stratified conditions in
  numerical weather prediction (NWP) models? J. Adv. Model. Earth Syst.
  5:117–133.
- Sherman, C.A. 1978. A mass-consistent model for wind fields over complex
  terrain. J. Appl. Meteor. 17:312–319.
- Stull, R.B. 1988. An Introduction to Boundary Layer Meteorology. Kluwer.
- Whiteman, C.D. 2000. Mountain Meteorology: Fundamentals and
  Applications. Oxford University Press.
- Whiteman, C.D., Doran, J.C. 1993. The relationship between overlying
  synoptic-scale flows and winds within a valley. J. Appl. Meteor.
  32:1669–1682.
- Wieringa, J. 1973. Gust factors over open water and built-up country.
  Boundary-Layer Meteorol. 3:424–441.
