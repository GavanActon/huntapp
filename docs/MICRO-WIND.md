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

- **First guess** `u0 = s(x)·U`. The speed ratio `s` is the log law through
  a 60 m blending height, from the local roughness length to the mosaic's
  (`z0_ref = 0.5 m`). ln z0 is smoothed over ~90 m because roughness takes
  fetch to take hold. Water z0 is 0.0002 m, open bog 0.03 m, shrub 0.2 m,
  forest 0.1·h (0.3–2.5 m). s runs from 0.7 (forest) to 1.37 (open lake).
- **Layer**: the air between the ground and a lid of depth
  `H = lid + (large-scale terrain − terrain)`.
  - NEUTRAL: 250 m over the ~3 km terrain. The air goes over hills,
    ±10° turning, 0.8–1.3× speed.
  - STABLE: 50 m over the ~1 km terrain. The air goes round and channels.
    Exposed ridge tops catch the wind aloft (up to ~2×), valleys go slack,
    ±20° turning.
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

### 5. Direction spread and the scent cone

- **Spread (1-sigma)**, clamped 8–110°: 12° + 70°·exp(−U/0.6 m/s) for low
  wind meander (Mahrt 2007), plus
  - stable meander,
  - convective swings,
  - canopy +8°,
  - swirl +40°,
  - the ensemble spread for the regional share.

  A nearby wind check narrows it by a quarter.
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
  - The bands are relative strength, not a deer detection threshold:
    no published data maps these ratios to detection.
  - 2026-09-26 check at camp, 4.4 km/h daytime breeze: the old picture
    ran to the 700 m grid edge; now it's noticeable to 150 m, with a
    trace to 350 m. Each redraw takes 100–220 ms.
  - Because particles sample the field where they are, the cone bends
    along drainage, stalls in a settled bog and turns at a tree line.

### 6. Wind checks

- **The check**: a puff of powder, two taps (which way it goes, how hard).
  The model's own call for that spot and minute is saved first.
- **Blending**: within 2 h and 800 m, weight
  `exp(−Δt/40 min)·exp(−d/300 m)`, averaged into the model vector.
- **Scoring**: agree within 45° (or both calm), close within 90°. The
  Weather tab shows the running tally.
- A camp station can later post checks with `source: 'station'`.
- The phone's barometer is not available to a web app.

## Limits

- **Not validated in the field yet.** The constants are from the literature
  and one evening's check. The wind checks exist to measure and correct
  it; keep logging them.
- 2D mass consistency is a diagnostic model, not a flow solver. It gets
  speed-up, channelling and blocking. It does not get separation in the lee
  of steep ridges, which this low-relief shield mostly lacks.
- Drainage speeds are potentials, not measurements. Timing (when the
  inversion forms or breaks) comes from HRDPS's 2 m and 80 m temperatures,
  and HRDPS itself is weakest in exactly those stable hours.
- Layering is one point for the whole region.
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
- Sandu, I., Beljaars, A., Bechtold, P., Mauritsen, T., Balsamo, G. 2013.
  Why is it so difficult to represent stably stratified conditions in
  numerical weather prediction (NWP) models? J. Adv. Model. Earth Syst.
  5:117–133.
- Sherman, C.A. 1978. A mass-consistent model for wind fields over complex
  terrain. J. Appl. Meteor. 17:312–319.
- Stull, R.B. 1988. An Introduction to Boundary Layer Meteorology. Kluwer.
- Whiteman, C.D. 2000. Mountain Meteorology: Fundamentals and
  Applications. Oxford University Press.
