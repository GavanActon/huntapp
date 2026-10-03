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
  0.0002 m, open bog 0.03 m, shrub 0.2 m, forest 0.1·h (0.3–2.5 m). s runs
  from 0.7 (forest) to 1.37 (open lake). Until 2026-10-01 the ratio was in
  the first guess, so a lake's speed-up had to be fed by air pulled in
  sideways across the shore, and the wind bent toward the upwind shore and
  off the downwind one; in the real air it comes down from above (an
  internal boundary layer) that a layer this thin cannot carry. Three
  quarters of the neutral turning was that artefact.
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

- **Head-height fraction** of the local 10 m wind:
  - Open ground: log law 2 m over 10 m (~0.7), thinned by up to 45% in a
    stable surface layer (Monin–Obukhov).
  - In a stand: log law to the canopy top (displacement 0.67 h), then
    exponential decay inside, `exp(−a(1 − z/h))` (Cionco 1965; Finnigan
    2000). The coefficient a runs 1–3.8 with crown closure and conifer
    share. Dense spruce leaves ~5–15% of the wind at 2 m.
- **Tree-line shelter** (browser): looking upwind from an open cell for the
  first stand over 6 m:
  - Within 3 h: shelter 0.25 and swirl.
  - 3–10 h: a linear recovery, swirl inside 5 h.
  - Windbreak and edge studies put recirculation at a few tree heights and
    recovery by ~10 h (Cleugh 1998; Dupont & Brunet 2008).
- **Small openings**: trees within 45 m on three sides or more means the
  air swirls.

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
  - The picture is time-integrated nose-height exposure, scaled to the
    plume core 20–40 m out (not the spike on the source cell), in three
    bands: strong ≥ 20%, noticeable ≥ 4%, a faint trace wash ≥ 1%. The
    card gives the share by sector and how far it stays noticeable, or
    "past 700 m" when it runs off the grid, and says so on a stable
    night when scent hugs the ground.
  - **Tree stand**: release at 4 or 6 m instead of 1.5 m, through the same
    reflected Gaussian. The grid is scaled to the same sit on the ground,
    so a stand reads as thinner near the tree, touching down farther out.
    The card gives "reaches noses from X m". It still uses the head-height
    wind: the wind at stand height is stronger, not yet modelled.
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
  - The bands are relative strength, not a deer detection threshold:
    no published data maps these ratios to detection.
  - **Conservative … aggressive** (2026-10-01): a slider on the scent
    card, kept across sits. The middle is the model as above. Toward
    conservative the three bands slide down together, to a third at the
    end (noticeable from 1.3% of the core), and the meander is 30% wider:
    the cone of a hunter who assumes scent counts sooner and the wind
    wanders more than modelled. Toward aggressive they slide up to three
    times (noticeable from 12%) and the meander is 30% tighter. The
    cone's reach, its edge, the party's overlap and where a moose has
    your wind (the swing) all follow the slider; the regional and ground
    wind do not.
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
    into one frame (each placed to the nearest 10 m cell). Exposure from
    a passive tracer adds, so the frame is the sum of each person's grid
    as scaled to their own ground sit: a cone alone looks as it would by
    itself, and where two overlap a pair of traces can add up to
    noticeable. The card gives the ground noticeable at nose height
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
- **Which way, without the compass**: the rose of arrows turns with the
  phone's compass only while the reading is steady (held up to point, an
  iPhone's heading whirls: `compass.ts` holds it), and stops turning at
  the first pick. Gavan (2026-09-29) could not use the phone's orientation
  at all in the field, so the map is the reference instead: "ahead" then
  a tap on the map in front of you turns the rose to face that way; or a
  tap on the map where the powder went is the direction itself, no rose
  needed. A second map tap or arrow is the swing.
- **Blending**: within 2 h and 800 m, weight
  `exp(−Δt/40 min)·exp(−d/300 m)`, averaged into the model vector. Every
  check counts the same, so where two people's checks disagree the side
  with more of them nearby carries the direction, and the reasons say so.
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
  was watched (45–180°). It holds the spread open — sigma at least
  `w·arc/2` for each blended check — and the quarter tightening a nearby
  check usually brings is skipped: a check that says "it swings" is not
  evidence of a steady wind.
- **Puffs in a series** (2026-10-02): a second puff within 40 m and
  6 min of the last check folds into it instead of replacing it. The
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
  The reasons say "Turned 18° clockwise by 6 wind checks in plain wind
  this season"; the hunt log's "How the map is doing" tallies hits by
  lesson and shows what each has learned.
- **Scoring**: agree within 45° (or both calm), close within 90°. The
  Weather tab shows the running tally.
- **How many, how often** (Gavan's question, 2026-10-02): a check leads
  the ground wind where it was made for ~40 min (pull 50% at the spot and
  minute, 27% at 40 min, 10% at ~90 min, nothing past 2 h), so a sit wants
  one at the start, one ~40 min on and one at any shift; puffs within
  6 min and 40 m fold into one check (the swing). A lesson has PRIOR_N = 4
  phantom checks of zero bias, so n checks apply n/(n+4) of the mean
  residual (1 → 20%, 4 → 50%, 12 → 75%), with a 14-day e-folding: four or
  five checks per regime per week teaches it, then maintenance. The
  "Wind sharpened" card says the verdict, the pull, the lesson's tally and
  when to check next; the live card asks for a check when the last one has
  faded below a quarter, when it missed and 20 min have passed, or when a
  sit has none. HuntOS §3 says the same for the hunter.
- A camp station can later post checks with `source: 'station'`.
- The phone's barometer is not available to a web app.

## Limits

- **Not validated in the field yet.** The constants are from the literature
  and one evening's check. The wind checks exist to measure and correct
  it; keep logging them.
- The slot rule too is one evening at one cell (2026-09-29), and it is the
  biggest single change to a head-height direction the model makes. About a
  fifth of the open ground in the core reads as a slot, so it wants checks
  in a few of them before it is trusted.
- 2D mass consistency is a diagnostic model, not a flow solver. It gets
  speed-up, channelling and blocking. It does not get separation in the lee
  of steep ridges, which this low-relief shield mostly lacks.
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

1. Cross-check the stable and neutral fields against WindNinja runs (US
   Forest Service, open source) for a few cases at camp.
2. One or two stations (a Tempest or an ESP32 with a sonic anemometer over
   LoRa) at camp and a stand. Bias-correct HRDPS and fit the thermal
   constants.
3. Use the ground wind in the Spots site score (scent geometry per cell)
   instead of the regional direction.
5. Lessons that fit a knob, not a turn: the slot gain, the inversion's
   timing, the canopy factor, each from the residuals of the checks that
   layer decided. The per-regime turn is the first step toward it.
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
- Mahrt, L. 1982. Momentum balance of gravity flows. J. Atmos. Sci.
  39:2701–2711.
- Mahrt, L. 2007. Weak-wind mesoscale meandering in the nocturnal boundary
  layer. Environ. Fluid Mech. 7:331–347.
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
