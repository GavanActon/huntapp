# Elk spot science

Would Groundwind work for elk, and what would adding elk take? This doc
turns the eight notes in `docs/research/elk-science/` into rules for the
app's model: `habitatScore`, `activityVerdict` and `siteFactor` in
`app/src/spots/huntRules.ts`, the keys in `weights.ts`, `Verdict.warnings`
and `notes` in `types.ts`, and the thermal code in
`app/src/weather/micro/model.ts` and `pipeline/build_microclimate.py`.
Compiled 2026-10-05. Evidence tags as in docs/HUNT-FISH-SCIENCE.md:
**[S]** peer-reviewed or agency science, **[G]** agency guidance or an
agency web page, **[H]** hunter press, guides and forums (lower weight),
plus **[I]** inference from the notes or this app's code, not measured.
**(unverified)** marks a number seen only in a search summary or not traced
to its source; **[summer]** marks summer telemetry applied to fall.

## 1. Bottom line

- **Yes, elk fit, and the wind and scent half carries the value.** No elk
  or western app models how terrain and thermals bend the wind:
  - goHUNT and Elk Finder have no wind layer;
  - onX, HuntWise, HuntStand and BaseMap draw forecast or station wind as
    straight cones.

  Elk hunters fight 90–180° thermal flips with powder bottles [H]. The one
  terrain-wind rival, Contors (Aug–Sept 2026), is whitetail only.
- **The market is ~3.4× today's.** There are 700,000–795,000 US elk
  hunters (2016 and 2006 surveys), against ~209,000 Ontario and Quebec
  moose licences and permits (2025). Alberta's 52,950 resident elk licences
  (2025) outnumber Ontario's 39,830 moose licence holders.
- **None of the four areas is elk country.** Sault test has elk at its edge
  but no season; the other three have no elk. Elk needs new areas, and the
  app needs a range gate first, for every target. Today nothing stops a
  habitat score anywhere, and `seasonOpen` applies FMZ 7's fish rules in
  every area.
- **Biggest wins:**
  1. Per-slope thermal timing. It is the hardest thing for hunters, and it
     also helps moose at Highland Lake (relief 920–1,684 m) and Lac Bailey
     (160–530 m).
  2. Hunting mode transfers whole, and elk bugle often enough to cross
     bearings (28,853 bugles on 7 recorders in one Tennessee season).
  3. A pressure layer: the strongest fall predictor, and already on the
     roadmap for moose.
- **Biggest work:**
  - curated range and season tables;
  - a US stand layer built from pixels;
  - the thermal rework;
  - elk habitat curves with a day/night switch;
  - the pressure layer;
  - licence traps.
- **First, a correction:** the moose thermal sit rule is reversed (section
  6).

| Part | Lands in | § |
|---|---|---|
| Range and season gate | a check before `activityVerdict`; `Verdict.warnings`; the `closed` grade; each area's `jurisdiction` and `zone` | 2 |
| Elk habitat | an elk branch of `habitatScore` taking the hour as input (today only `warm`, `lateFall`); keys `browse`, `edge`, `shore`, `funnel`, `heat` | 3 |
| Pressure, refuge | a baked layer and a new key (e.g. `pressure`), apart from `access` (your walk in) | 4 |
| Thermals | `micro/model.ts`, `build_microclimate.py`; the `scent` part of `siteFactor` | 5 |
| Rut, calling | elk `rutFactor`, `hourWeight` and temperature row; keys `rut`, `light`, `temp`, `wind` | 7 |
| Hunting mode | `hunting/swing.ts` costs, heard-sound types, hearing radius, bearing wedge | 7 |

## 2. Species range gate: presence first, then season, for every target

Today, opening the Sault test area with elk selected would draw elk habitat
28 km from the nearest elk record, in a WMU with no elk season.

| State | Meaning | The app [I] |
|---|---|---|
| Present and hunted | in range; general or draw season in the unit | score. Out of dates: habitat drawn for scouting, headline "Closed: opens 21 Sept" (`closed` grade) |
| Present, no season | animals here; no season in the unit | no heat map, no "good spot" words; one line why, and the nearest hunt |
| Edge or rare | outside official range but near records or a herd, or a season with near-zero harvest | score dimmed and capped; "rare here" |
| Absent | no range, no recent records within reach | target not offered, or greyed with the reason |

**Legal but no animals** (Yukon's exclusion area) is a flag and never
changes the state. Legality never implies presence; presence never implies
a season.

**Order of checks [I]:**

1. **Unit.** Read the area's `jurisdiction` and `zone`. Check per cell where
   an area straddles units (Bull River's box: 79% MU 4-22, 21% 4-03).
   Quebec zones have no open polygons, so the area file names the zone.
2. **Presence, before legality.** Work through:
   1. a curated species × jurisdiction default;
   2. the official range polygon;
   3. the distance to recent records or a herd.

   Absent stops here.
3. **Season.** A curated species × unit × year table (general,
   draw/permit, none), with the legal-but-no-animals flag kept separate.
4. **Date** against the weapon windows.
5. **Evidence only upgrades.** GBIF has 0 moose within 50 km of Lac Bailey,
   which lies inside Quebec's moose range.

**Edge threshold [I, tune]:** within ~50–60 km of a range edge, a herd, or
records from the last 5 years.

**The four areas** (checked 2026-10-05; GBIF is presence-only):

| | Sault test (ON WMU 36) | Pickle Lake (ON WMU 21B) | Lac Bailey (QC zone 18) | Highland Lake (YT GMS 4-09) |
|---|---|---|---|---|
| Elk | **present, no season**: North Shore herd fringe; nearest record 28 km, 67 within 50 km, 65 of 98 within 100 km in WMU 36; elk open only in WMUs 57–63A (~540 km) | **absent**: nearest 302 km | **absent**: extirpated (NatureServe SX), not in Quebec's range layer; one 2011 record at 146 km, probably farmed | **absent, legal**: nearest elk key area 169 km, record 202 km; inside the exclusion area (year-round with a Wildlife Act permit) |
| White-tailed deer (`deer`) | present and hunted: gun Nov 2–15; 247–400 a year (2025: 301 by 1,588 hunters) | edge, open (Oct 10–Dec 15): 0 most years, 17 in 2017; nearest record 60 km | edge: first season fall 2026, antlered only; range edge ~54 km; no harvest since 1982 | absent ("too few to support a season") |
| Mule deer | absent | absent | absent | edge: DE 604 permit hunt (6 permits, Aug 1–Nov 30); nearest record 107 km |
| Moose, bear, grouse | present | present | present | present (ruffed grouse only 1980 records) |

**What the app says instead [I]** (one line up front, evidence behind a
tap):
- **Sault, elk:** "Elk wander through from the North Shore herd, but WMU 36
  has no elk season. Ontario's only elk hunt is a draw in WMUs 57–63A."
- **Pickle Lake, elk:** "No elk within 300 km."
- **Highland Lake, elk:** "Elk hunting is legal here under the
  exclusion-area permit, which exists to remove strays; the nearest herd is
  170 km south."
- **Pickle Lake, deer** (dimmed): "Deer are scarce this far north: 0–17
  taken a year in 21B."

**Status.**
- **Canada:** hunted by unit in AB (~26,000), BC (~40,000), SK
  (10,000–15,000) and MB (~8,000) (Saskatchewan plan, Feb 2025). ON: a few
  hundred, 12 tags at Bancroft only. YT: Takhini ~270; Braeburn closed or
  0 permits for 2026. Absent in QC and the Maritimes; vagrant in the NWT.
- **US:** large hunted herds in CO, MT, OR, ID, WY, NM, UT, WA, AZ, NV, CA
  (~1.1 M, aggregator); small lotteries in KY, PA, MI, WI, TN, VA, AR, MO,
  MN, SD, ND, NE, OK, KS, AK; present with no season in NC (first hunt
  2027) and WV.

**Data and licences:**

| Need | Canada | US |
|---|---|---|
| Unit polygons | ON WMU (LIO), BC MU and LEH zones, AB WMU and draw boundaries, SK WMZ, MB GHA, YT GMA 250k: all open. Quebec zones: none open | public ArcGIS in every state |
| Seasons | not published as data anywhere: HTML (ON, AB), PDF (BC, SK, MB, QC), Yukon PHA sheet; MB's "Season Table" has no dates. Curate yearly | PDFs; partial structure in PA (licences per zone per year), UT `HUNT_INFO_MOBILE`, NM `HUNT_INFO`/`Licensing` |
| Range | QC 69-mammal ranges (CC-BY 4.0; no wapiti, no birds); YT Wildlife Key Areas (13 elk polygons, all Braeburn/Takhini); BC UWR (winter only; elk layers Access Only) | state seasonal range: CO (12 layers, "product and property of CPW"), WY, UT, NV, MT, OR (east winter), CA (CC BY 4.0); none for WA, ID, NM, AZ: use GAP and USGS migration layers (237 herds) |
| Hunted recently | ON harvest CSVs (deer by WMU, elk by area); QC harvest by zone since 1971 (CC-BY 4.0) | WY, CO, ID harvest; OR, CO, MT population per unit (better density proxy) |
| Coarse fallback | NatureServe S-ranks (CC BY): no ON elk entry despite a hunt, YT "SU" | GAP mELK1x HUC12: known (16,200) → present, possibly present or vagrant → edge, extirpated (40,777) → absent |

**Traps:**
1. **Yukon's exclusion area** makes elk legal year-round over nearly all of
   GMZ 4, to remove dispersers. A gate driven by regulations alone says
   "elk season open" 170 km from elk.
2. **GBIF is mostly non-commercial.** 5,384 of 6,551 Canadian elk records
   are CC BY-NC (iNaturalist), and 33,437 of 40,356 white-tailed deer
   records. Use CC0 and CC BY records, or derived counts once the terms are
   checked. Missing records mean nothing.
3. **IUCN ranges are out:** no commercial use or redistribution without
   written permission; third-party "CC-BY" relabels contradict IUCN.
4. **GAP is 2001 and coarse.** A HUC12 (~90–100 km²) is wider than a core.
   Post-2001 herds (Wisconsin's Black River, MO, VA, the SD and ND prairie)
   may be miscoded. State layers override.
5. **Eastern herds occupy a few counties.** Gate by elk zone (PA EHZ, KY
   elk units, MI EMUs, MN Kittson County), never by state.
6. **Sources disagree by 5–15%** (MT 135k or 150k; OR 133k or ~124k).

## 3. Elk habitat in fall: forage at night, cover by day

**Template [S].** Westside (Rowland et al. 2018), the validated PNW model,
has four covariates:
- digestible dietary energy (DDE, the food's energy) averaged within
  350 m;
- distance to an open road;
- distance to the cover-forage edge;
- % slope.

Cover is a 30 m cell with ≥40% canopy and >2 m height, in ≥3×3-cell
patches. Adequate forage is 2.75 kcal/g (Cook 2004). Coefficients weren't
retrieved, so the weights below are hand-set [I]: forage → `browse`, edge →
`edge`, slope and landform → `funnel`, heat and aspect → `heat`, water →
`shore`, times pressure (section 4) and a day/night switch.

### The day and night switch (the most replicated pattern)

- **Burns [S, summer]** (Spitz 2018, Starkey): avoided by day, selected at
  night.
  - Night selection peaks 5 yr after a prescribed burn and returns to
    baseline by ~15 yr.
  - By day, 6–12 yr burns lower use.
  - Flips are "steep crepuscular transitions"; the key foraging hours are
    nocturnal.
- **Cuts [S]** (Ruprecht 2023, Starkey, 30 yr): selected at night only.
  - Peak at 14 yr, still selected at 26–33 yr; avoided by day for up to
    28 yr.
  - Selection is 73% stronger at low elk density.
  - Grassland was selected day and night in October.
  - Alberta forage biomass peaks ~9 yr after logging.
- **Wildfire in fall [S]** (Snobl 2024, Montana, years 2–3): chance of
  selecting low-severity burn 0.99 before the hunt, in archery and in
  backcountry rifle; 0.0010 in the general rifle season.
- **Against [S]:**
  - Idaho summer range lost selection with area burned in the last 11 yr.
  - Older studies put burn benefit at 1–2 yr or up to 15 yr (unverified).
  - Manitoba elk avoided cut-blocks at the landscape scale (3.5 against
    5.25 random locations/ha at 100 m) but still used them.

**Forage value at night and twilight [I]** (the elk `disturbanceCurve`):

| Years since | 0–1 | 2–3 | 4–7 | 8–9 | 10–12 | 13–15 | 16–20 | 21–33 | older |
|---|---|---|---|---|---|---|---|---|---|
| Burn | 0.5 | 1.0 | 1.0 | 0.7 | 0.7 | 0.4 | 0.2 | 0.2 | 0.2 |
| Cut | 0.4 | 0.4 | 0.5 | 0.7 | 1.0 | 1.0 | 1.0 | 0.7 | 0.3 |
| Moose today | 0.2 | 0.2 | 0.2–0.7 | 0.7 | 1.0 | 1.0 | 1.0 | 0.6→0.3 | 0.3–0.2 |

- Cap cuts at 0.7 in boreal and Ontario areas.
- **By day, open forage cells** (burns, cuts, meadows, fields, mines):

  | Case | Weight |
  |---|---|
  | Default | 0.5 |
  | Burns 6–12 yr; cuts ≤28 yr | 0.3 |
  | October or cool days | 0.7 |
  | Burns in general rifle season | 0.1 |

  Ramp at civil dawn and dusk.

### Bedding, cover, edge [S unless marked]

- **Beds [summer]** (Millspaugh 1998, Black Hills, 131 beds):

  | | Beds | Random |
  |---|---|---|
  | Canopy | 54% | 29% |
  | Basal area (m²/ha) | 12.4 | 4.9 |
  | Grass | 15.4% | 35.7% |
  | Temperature (°C) | 24.8 | 30.3 (air) |

  North aspects were selected. Slope, elevation, and distance to roads and
  water didn't differ from random.
- **Fall in SW Montana:** mean slope 14° and mean canopy 20–28% (open
  country) (Ranglack 2017).
- **Duck Mountains:** 51% of locations were on mid-slopes.
- **Hunter rules [H]:** benches, heads of drainages and finger ridges. No
  fall study measured bed terrain. Collars lose up to 47% of fixes under
  conifer, so dense-cover beds are under-counted.
- **Bed rule [I]:**
  - Canopy value rises from 10–15% to full at 40–55% (70%+ on hot days).
  - Slope is best at 10–20° and falls above ~30°.
  - A north bonus grows with heat.
  - Mid-slopes beat bottoms (weak).
- **Cover** (Thomas 1979 [G]): hiding cover hides 90% of an elk at ≤61 m.
  Thermal cover is conifer ≥12 m tall with >70% closure.
  - **Cook et al. 1998 overturned thermal cover:** 12 pens over 4 winters
    and 2 summers showed no condition benefit, and dense cover cost the most
    energy in winter. Give no winter "thermal" bonus.
  - **Modern cover** is ≥40% canopy (Westside, DeVoe, Wisconsin). Ranglack
    found a 13% pseudothreshold in archery season. Idaho summer selection
    jumps at 33–42% and falls past 65%.
  - **[I]** In the app's light model (`exp(−d/sight)`), hiding cover needs
    sight ≤~27 m: thickness ≥~0.57, near the 0.7 thick-cover threshold. So
    `distThick` serves as elk hiding cover, and `crown` gives ≥40% canopy.
- **Edge:** foraging "often within 200 m of cover", and cover "no greater
  than 180 m" from forage (Thomas 1979; Smith 1985). Wisconsin elk select
  ≥40% cover nearby (β −0.12 to −0.20). "Most use within 1.6 km" of an edge
  (Westside) and "within 80 m" are unverified.

  **Rule [I]** (moose: 1.0 within 80 m), tightened a band by day and in
  season:

  | Distance from ≥40% cover | 0–200 m | 200–400 m | 400–800 m | beyond |
  |---|---|---|---|---|
  | Forage-cell value | 1.0 | 0.6 | 0.3 | 0.1 |

### Water, snow, heat, lore [S unless marked]

- **Water is neutral or weak.**
  - Black Hills beds showed no difference from random.
  - Starkey elk avoided streamsides (≤100 m) [summer].
  - Manitoba elk sat 400–900 m from water more often than random, yet
    >38% of travel paths were within 100 m.
  - Wallows: 20 of 39 were visited, "one or two times a season" (Conner
    2007).

  **Rule [I]:** `shore` ≈ 0 (moose +0.15); a small crossing bonus within
  100 m; seeps in cover as a rut-only bull-sign bonus, folklore-grade.
- **Snow and hunters move elk down, not the date.**
  - Greater Yellowstone arrival is ~50 days later than in 2001 (Rickbeil
    2019).
  - Montana elk left high-snowpack districts in backcountry rifle season
    (β −0.84) and avoided snowpack in general rifle (β −3.96) (Snobl 2024).
  - Mean elevation was 2,104 m in archery and 2,005 m in rifle season
    (Ranglack).
  - >40 cm of snow → south slopes (Irwin & Peek 1983).
  - Managers [H]: groups move at ~61 cm; ~100 cm is passable; "40 cm avoid
    / 70 cm stop" is unverified.

  **Rule [I]** (needs a snow input): neutral below 20–25 cm. From 40 cm,
  favour south, wind-scoured and lower ground; penalise from ~60 cm for
  herds and ~100 cm for all. In flat boreal country, snow acts through
  aspect and canopy only.
- **Heat.**
  - Beds run ~5 °C cooler than ~30 °C air.
  - Daytime use of forest rises with summer heat (Starkey).
  - Desert elk trade forage for shade; montane elk don't (Long 2014).
  - Penned elk lost no condition without cover (Cook 1998): heat changes
    behaviour, not need.
  - No fall upper critical temperature was found ("+20 °C" untraced).

  **Rule [I]** (`heat`): above the mid-teens °C, raise daytime canopy ≥50%
  and north aspects, and lower open cells. This matters on early-September
  archery days (20–30 °C), little in Nov–Dec. The onset is a modelling
  choice, not a threshold like the moose 14 °C.
- **Lore.** No elk evidence was found for pressure, moon, fronts or rain (a
  Starkey moon trial reported no result). Set `front` to 0 or label it lore;
  the moon stays display-only. Wind effects on elk weren't researched.
- **Slope works both ways:** a cost for daily use (gentle slopes chosen at
  Starkey and Westside; Appalachian roughness β −0.28 to −0.36) and a bonus
  for security in season (section 4). Keep both visible [I]. No fall study
  measured saddles or benches as corridors; keep `funnel` for saddles [I].

### Regional variants [S]

| Region | What drives fall use |
|---|---|
| Western mountains | snow and hunters move elk down; access, canopy, green-up; day/night commuting |
| PNW westside; arid West | forage energy; thermal relief beats forage |
| Alberta foothills | grass and meadows; more browse in boreal mixedwood; dawn peak ~2 h after civil twilight (Ensing 2014) |
| Manitoba (Duck Mtns) | deciduous forest at all scales; roads avoided in the rut (ratio 0.43); farmland → forest for rut and hunt; cut-blocks avoided |
| Wisconsin | fall canopy avoided (β −0.39) but near ≥40% cover; S/W aspects; early-successional openings |
| Appalachia (KY, VA, PA) | reclaimed mines the hub; conifer in, oak out; ridgetops |
| Ontario (Burwash) | aspen, birch, balsam poplar selected; open at night, forest by day all seasons (Popp 2013; McGeachy 2014) |

**For Bancroft and any Great Lakes or boreal elk [I]:** the analogues are
Wisconsin, Manitoba and Burwash, not Montana. Deciduous and mixedwood are
cover and browse (browse counts as forage); fields, old farms, regen and
wetland margins are night forage near ≥40% cover; no elevation migration;
burns and cuts get a night bonus only. No Ontario or Quebec elk habitat
model exists.

## 4. Roads, pressure and refuge: the strongest fall signal

Land closed to public hunting is the strongest fall predictor where it
exists; distance from motorized routes comes second. **In the model [I]:**
a baked pressure layer read by a new key (e.g. `pressure`). Keep `access`
as its own knob. `access` is your own walk in (0.85 within 150 m of a road,
1.0 to 2.5 km, 0.8 to 4 km, 0.5 beyond), and a far cell is good for elk but
hard for you.

**Distance to open roads [S].** Starkey bands outside the season (Rowland
2004; 89 cows):

| Distance (m) | 0–360 | 360–720 | 720–1,080 | 1,080–1,440 | 1,440–1,800 | >1,800 |
|---|---|---|---|---|---|---|
| Weight | 0.17 | 0.33 | 0.50 | 0.67 | 0.83 | 1.0 |

- **Use distance, not density.** Density-based scores barely matched use.
- **Traffic.** >1 vehicle per 12 h moves elk away (Wisdom 2004b), and 1 per
  2 h triggers vigilance (Ciuti 2012), so every open road counts in season.
- **Hunting-season security** (Ranglack 2017, 325 cows):
  - archery: ≥13% canopy, ≥2,760 m from motorized routes;
  - rifle: ≥9% canopy, ≥1,535 m, blocks ≥20.23 km².
  - **Conflict:** a JWM summary gives ≥23–60% canopy and 1,846–3,679 m
    (unverified). Both are kept.
- **Elkhorns** (Lowrey 2020): 75% of use at ≥31% canopy and ≥2,072 m; 50%
  at ≥53% and ≥3,496 m. Hillis security area: ≥101 ha of cover >0.8 km
  from open roads.
- **Starkey hunts** (Johnson 2004): distance (m) = 83 × hunters/km² + 751,
  and no night approach to roads during hunts. Outside heavy rifle pressure
  elk come closer at night; bulls avoid roads more than cows.
- **Bull mortality:** 62%, 45% and 31% at 4.5, 2.6 and 1.0 mi of open road
  per section (INT-GTR-303).

**Hunters [S]** (Johnson 2004 unless marked):
- Elk speed rises 1.4 m/min per rifle hunter/km² and 2.2 per archer/km².
  0.04 hunters/km² caused no response; above 1.25/km² elk stay stirred all
  day, with only 00:00–04:00 near normal. Elk flee; deer hide.
- Weekends bring 20.7 against 12.4 people a day: ×1.7 (Ciuti 2012). Shot
  elk used open, flatter ground near roads (Thurfjell 2017).
- Archers hunt timber: canopy use fell as archery density rose (−7.3% per
  hunter/km²), so weaken the canopy term in archery season.

**Flight from people** [S] (Starkey trials; baseline 0.05):

| Distance | ATV | Bike | Horse |
|---|---|---|---|
| 100 m | 0.62 | 0.58 | 0.50 |
| 500 m | 0.43 | 0.31 | 0.22 |
| 1,000 m | 0.25 | 0.13 | 0.07 |

- Hikers had little effect beyond 500 m.
- Elk kept 558–879 m from people and 239–310 m from trails. With people on
  the trails, 44% of elk locations fell in the 15% of the area beyond
  300 m.
- Elk returned within the 9-day quiet periods: pressure fades in days.

**Where hunters go [S].**
- **Montana elk hunters** (Lyon & Burcham 1998, 99 GPS hunts):
  - A hunt lasted 4.7 h over 10.7 km.
  - Half went >2.5 km from the truck; 12.5% went >4.5 km.
  - Average distance from a road was 267 m, with 26% of the time on roads.
  - 60% of hunting was on slopes gentler than the 22% average.
- **Pennsylvania deer hunters** (Stedman 2004): mean maximum 0.84 km from
  an open road (self-reported 2.23 km); 72% sat still 06:00–08:00.

**Refuge [S].**
- **Closed land beats cover.** Land closed to public hunting is the top
  covariate in both seasons (Ranglack 2017), beats Hillis security
  (Proffitt 2013), and doubles the odds of use in a late hunt (Proffitt
  2010).
- **Small refuges pull too** (Missouri Breaks, 97% accessible). A new
  31 km² amenity refuge raised bull selection odds 545% (CI 397–738%), and
  closing 45 km of routes on public land didn't hold elk (Proffitt 2025).
- **Manitoba:** adult bulls rarely left parks in the season (Dugal 2013).
  Alberta refuge elk left after sunset and returned earlier (Visscher 2017).
- **Timing:** moves to private land can exceed 25 km; the archery opener
  sets them, and halving licences changed nothing (Conner 2001; Vieira
  2003).
- **Closed roads:** over half of 802 closures were ineffective (Havlick
  2002). Total road density predicts bull deaths (Hayes 2002), and foot
  hunters use closed roads to reach the farthest ground.

**Pressure-layer recipe [I; starting numbers to field-calibrate]:**
1. **Access by mode.**
   - **US:** MVUM gives open routes, vehicle classes and season dates
     (absent = closed); RoadCore level 1 or "Admin" = closed (foot only).
     OSM fills other land:
     - `track` grades 1–3 with no access limits or gate: open;
     - grades 4–5: ATV;
     - `access=private|no` or a gate: closed.
   - **Canada:** LIO roads, AQréseau, OSM, and ABMI seismic lines and
     trails. BC's DRA and FTEN are Access Only, so use OSM.
2. **Unknown status:** open in season (or 0.5–0.7); always add foot weight.
3. **Access points:** road ends, gates, trailheads, parking, camps, boat
   launches.
4. **Vehicle term:** the Rowland ramp, stretched in season to full at
   ~1.5 km (rifle), ~2.8 km (archery) or ~3.5 km (heavy pressure). Use the
   flight kernels for ATV trails.
5. **Foot term:** Tobler walk time (6·e^(−3.5·|slope + 0.05|) km/h; ×0.6
   off-path) from the access points, with costs for thick bush and water.
   Calibrate so ~50% of pressure lies within 2.5 km and ~12.5% beyond
   4.5 km. The going grid already holds the walking costs.
6. **Multiplier:** hunter-days per km² from harvest reports; off below ~0.04
   hunters/km².
7. **Refuge:** parks, refuges, closed military land, no-hunting and
   discharge zones, First Nations reserves. Private land counts as
   restricted unless enrolled in an access programme (PAD-US access is
   categorical; check it).
8. **Visibility:** a viewshed to ~300 m from roads and trails, cut by
   canopy and LiDAR bush.
9. **Time:** openers peak, then decay; weekend ×1.7; night ×0.3 (×0.7 under
   heavy rifle pressure).

**Security** ≈ refuge × road ramp × canopy × ruggedness × (1 − visibility)
× (1 − foot density):
- **Canopy:** 0 below 9–13%, saturating ~50%, weaker in archery.
- **Ruggedness:** no published threshold; try 25–30% slope.

**Regional defaults:**
- Mixed ownership: refuge first.
- Big public forest: distance, cover, ruggedness.
- Eastern herds near farms: short (~0.5 km), day-only ramps, and only where
  hunter density matters (Kentucky's limited-access zones didn't change bull
  survival).

**Moose:** the same layer serves moose. These notes didn't cover moose
pressure numbers, and topography and cover shape moose movement more than
roads do (Bartzke 2015), so start moose with weaker road terms.

## 5. Wind, thermals and scent in mountains: the switch follows the sun on each slope

### The physics [S]

| Site | Upslope (anabatic: air rising up a sun-warmed slope) | Drainage (katabatic: cold air draining downhill) |
|---|---|---|
| Gentle sunlit east slope (Farina 2023) | within 30 min of sunrise; valley floor ~2 h later | — |
| Steep west face, Alps (Nadeau 2020, abstract) | starts 40–50 min after sunrise, complete ~5 h after | — |
| Isolated butte (Butler 2015; sunrise 06–07, sunset 20:30–21:30) | set by 10:00, peak ~11:00 | from 21–22, set by 23:00, to ~08:00 |
| Steep canyon (Butler 2015) | ~09:00 | 20–21 to ~07:00 |
| Douglas-fir watershed (Pypker 2007) | none under the canopy until the base gets sun (07–08); only then does drainage stop or stay below the crowns | starts under the canopy at 16:00–18:00, once it loses direct sun |

**Speeds.**
- Drainage: a layer 3–7 °C colder and 1–20 m deep, peaking at 1–4 m/s at
  1–15 m up.
- Upslope: 10–100 m deep, peaking at 1–5 m/s at 10–50 m.
- Drainage by slope angle:

  | Slope | Layer depth | Peak |
  |---|---|---|
  | 21° | 4–8 m | 1–2 m/s at 0.6–2 m (nose height) |
  | 4° | 50 m | 3.5–4 m/s |
  | 1.6° | 25 m | 4–6 m/s at 15–20 m |

  Gentle, long slopes drain deeper and stronger. The layer is ≈5% of the
  drop above.
- Measured at ~3 m: the butte ran 3.0 m/s upslope and 3.4 downslope; the
  canyon 2.4 upslope and 1.2 downslope.
- **Valley winds lag hours:** the canyon's slopes went up at 09:00, but
  up-canyon flow came only at ~15:00. Up-valley wind keeps blowing for
  hours after the slopes drain.
- **Valley inversions break** 1.5–5 h after sunrise.

**Overrides.**
- 2–3 m/s of background wind already reshapes drainage.
- The flow is forced when a low sensor reads >5–6 m/s, or the 700 hPa wind
  is >5 m/s.
- Ridge tops ~800 m up are decoupled: gradient wind, no daily cycle, often
  2× the plain's speed.

**Canopy.**
- Under 25–28 m Douglas-fir, the wind above the canopy ran up-valley while
  the air below often drained all day. It partly reversed with a stronger
  ridge wind (2.3 against 1.8 m/s).
- At Niwot Ridge, night drainage stayed under the canopy.
- Canopy is the least-studied factor.

**Scent.**
- A tracer released 600 m up a forested watershed reached the outlet at
  1–2 m/s (3.6–7 km/h). In late afternoon nearly all of it stayed under the
  canopy (Pypker 2007).
- [I] Scent pools on valley floors overnight until the inversion breaks.
- [I] Day cones should be short and wide; night drainage cones long,
  narrow and terrain-following.

**Hunter practice [H] against the physics.** "Down 6 pm–11 am, up noon–5"
is a fair average for shaded, timbered drainages but wrong per slope: an
open east face can be up by 08:00, and a timbered north bottom may never go
up below the canopy [I]. "Changes 90° at first light and 180° by the time
the sun hits it" (HuntTalk) and GoHunt's "under elk in morning drainage,
above them in afternoon upslope" both match the physics. A MeatEater
summary, "morning downslope, evening flip" (unverified), reads as section
6's reversed rule. High-country elk bed low and feed high, against the
thermal, so combine thermal timing with bed and feed elevations.

### Five causes of "swirling" wind [S; fixes I]

| Cause | Where and when | App |
|---|---|---|
| 1. Transition calm | 1–40 min of <1 m/s after local sunrise; ~2 h well mixed in timber | mark 0–60 min around each cell's own switch unreliable |
| 2. Competing flows | evening floors and confluences: slopes draining against a lagging up-valley wind; tributary surges; saddle spill-over | flag them in the evening |
| 3. Lee and side-drainage eddies | ridge wind across a drainage; one sensor ran wrong-way all day | the momentum bake; wind-check targets |
| 4. Daytime convection | sunlit slopes from late morning with a few m/s aloft | widen the spread by day |
| 5. Night sloshing | calm, clear basins: seiches carry smoke back and forth | pooled cells accumulate, not stream |

### WindNinja's diurnal option [S]

- **The scheme:** Mahrt's (1982) 1-D "shooting flow", as in CALMET. A heat
  flux from an energy budget (sun on each slope with terrain shadows,
  cloud) drives a flow that accelerates over the distance to the ridge or
  valley, 5% of the elevation difference deep. It is added to the starting
  field, which is then mass-solved.
- **With momentum:** a second mass run adds it on top of the CFD
  (`ninjaArmy.cpp`). The local 4.0.0 CLI has both flags but lacks the drag
  options, and no combined run has been tried. Non-neutral stability
  conflicts with momentum.
- **Validation** (Big Southern Butte, 3 m): slope flows too weak. Errors:

  | Regime | Speed RMSE | Direction RMSE |
  |---|---|---|
  | Downslope | 2.0–2.4 m/s | 78–88° |
  | Upslope | 1.7–2.0 m/s | 68–74° |

  No forest validation was found.
- **[I]** Don't bake its diurnal output: it is weak, ~70° off, and would
  multiply the 16-direction bake by hours and sky states. Mahrt's scheme is
  cheap enough to run in the browser.

### Gaps in Groundwind's thermal model (read in code 2026-10-05)

| # | Code | Physics | Effect |
|---|---|---|---|
| 1 | drainage timed by a global sun-elevation ramp (`cool` 1 below 0°, 0 at 10°); upslope gated on global sun >3°; per-cell `cosInc` but no horizon shadow (`model.ts` ~615–643) | each slope switches with its own sun and shade, hours apart | drainage ends too early on shaded faces and floors in the morning, and starts too late on slopes shaded in late afternoon |
| 2 | `kat = 3.0·sqrt(sin slope)·fetch_f` (`build_microclimate.py` ~453–459): 1.2–2.9 m/s on 25°, 0.3–0.8 on 2° | right at head height on steep slopes, but gentle, long slopes drain deeper and stronger; no depth term | gentle drainages too weak |
| 3 | `ana = 1.4·sqrt(sin slope)·sAna`: ≤~1.5 m/s on 30° in full sun, ~0.75 in trees | 2.4–3.0 m/s at 3 m in the open | upslope ~1.5–2× weak |
| 4 | flat ×0.7 drainage, ×0.5 upslope under trees | under tall, dense conifer the air below the crowns can drain all day; it couples only where sun reaches the floor, or with ~2 m/s above | wrong sign under dense timber at midday |
| 5 | no along-valley wind | up-valley lasts hours after slopes drain; down-valley 2–5 h after sunrise on floors | evening bottoms and morning floors wrong (not needed in flat Northern Ontario) |
| 6 | no ridge-top decoupling; mixing keyed to the local 10 m wind (`exp(−max(0, U−5)/8)` at night, km/h) | ridges keep the gradient wind; mixing should key to the wind above the valley (the fade values fit) | ridge cells get drainage they don't have |

**Recommended fix [I]:**
1. **Per-cell timing.** Bake DEM horizon angles so each cell has its own
   sunrise and sunset. Drive drainage decay and upslope onset from that
   local light, with a 0–60 min lag. Floors and pools outlast slopes by
   1.5–3 h.
2. **Slope-flow speeds.** Replace the sqrt(sin) speeds with a Mahrt-style
   slope flow (distance to ridge or valley, slope, heat flux, depth 5% of
   the drop). Calibrate to the 3 m means (upslope 2.4–3.0, downslope
   1.2–3.4 m/s) and to wind checks.
3. **Sub-canopy state.** In tall, dense conifer, decouple the air below the
   crowns: it drains unless sun reaches the floor or the wind above is
   strong.
4. **Valley wind.** A lagging along-valley term where valleys are deep
   enough.
5. **Ridges.** Ridge cells take the gradient wind with no diurnal term.
6. **Cones and labels.** Shape cones by regime, mark transition windows,
   and label swirl by its cause.
7. **Test data.**
   - Butler 2015 butte and canyon: public, ~3 m, hourly, labelled by
     regime.
   - Pypker 2007, for timber.
   - Wind checks should save the regime, canopy, aspect and local sun
     state; they may become the only fall, head-height, mountain-forest
     dataset.

These fixes help Highland Lake and Lac Bailey moose too.

## 6. Correction to the moose model: the thermal sit rule is reversed

Three places tell the hunter to sit where their scent will reach the
animal.

1. **docs/HUNT-FISH-SCIENCE.md, rule 5 (lines 225–230).** Air rises "from
   30–60 min after sunrise until mid-afternoon" and drains "from about an
   hour before sunset through the night". Then: "Morning: sit level with or
   below the target, across-slope; evening: sit above the target."
2. **app/src/spots/huntRules.ts:410,** the moose verdict note (wind
   ≤8 km/h, cloud <40%). In drainage: "air sinks downslope now … Sit above
   the animal." Otherwise: "air rises upslope now; sit level with or below
   where the animal is."
3. **huntRules.ts:506–516,** the calm-air fallback used where there is no
   ground model.
   - In drainage (`evening`, which includes the night and the first 0.7 h
     after sunrise), high ground scores 1.0 and hollows 0.35, with "sits
     above the ground below: evening thermals carry scent down past it".
   - In rising air, low ground scores 0.95 and high ground 0.6, with "low
     ground in the morning: rising air carries scent up and away". (TPI:
     whether a cell sits above or below the ground around it.)

**Why it's wrong.** Scent travels with the air.
- Draining air carries scent downhill, so a hunter above the animal sends
  scent onto it.
- Rising air carries scent uphill, so a hunter below it does the same.
- Moose feed low, on shores, wetlands and beaver meadows. Rewarding high
  ground at dusk sends scent onto the shoreline: rule 6 of the same doc
  already warns that "evening scent flows down every gully to the lake,
  fouling the shoreline below."

**The rule the physics gives [S/I].**
- **While air drains** (night, evening once the slope is in shade, and the
  morning until the sun reaches that slope): sit below the animal or level
  with it, across-slope.
- **While air rises** (on a sunlit slope, late morning to mid-afternoon):
  sit above it, or level.
- **"Morning" by the clock is mostly drainage.** The switch comes under
  30 min after sunrise on an open east face, ~5 h later on west faces and
  floors, and possibly never under dense timber.
- **Bowls and hollows at dusk stay bad.** Rule 9 and the 0.35 score are
  right.

**Reach.** Baked areas with the ground model work out scent direction
directly (`siteCore` compares the ground-air direction with the bearing to
the browse), so their heat map follows the physics. But the verdict note at
:410 shows regardless, and the fallback scores every calm cell without a
ground model.

**Fix [I].**
- Flip the note's two sentences.
- In the fallback, score by whether the feeding side lies uphill (drainage)
  or downhill (rising air) of the cell, not by TPI alone. Keep the dusk
  hollow penalty.
- Rewrite rule 5.

The fallback's switch times (0.7 h after sunrise, 1.5 h before sunset) stay
clock rules until per-slope timing lands.

## 7. Rut, bugling and hunting mode: same window as moose, more noise, more noses

**Date [S].**
- **One continental window.** Peak breeding and bugling fall between about
  20 Sept and 10 Oct, from 36°N to 58°N. Day length is the trigger, and
  herd age moves it more than latitude.
- **Starkey** (Noyes 1996): mean conception was 7 Oct with yearling sires
  and 21 Sept with 5-yr sires. The breeding span shrank from 71 to 41 days.
  The ~21-day oestrous cycle gives a second hump.
- **Tennessee** (Metts 2026):
  - Bugles ran 12 Aug–29 Oct, peaking 23 Sept–10 Oct with a second peak on
    17–19 Oct.
  - Conception peaked 26 Sept–7 Oct (from calving, 247 ± 3 days).
  - Day length explained daily counts (AIC weight 0.85); temperature and
    rain added nothing.
- **Other herds:** Duck Mountains mean breeding date 27 Sept. Ontario's
  season (Sept 21–Oct 4) sits in the peak. onX's "peak Sept 10–25" [H] is
  bugle onset.

**Curve [I]** (an elk `rutFactor`; moose today: 15–22 Sept 0.5, 23 Sept–8
Oct 1.0, 9–15 Oct 0.7, 16–25 Oct 0.4):

| 25 Aug–9 Sept | 10–19 Sept | 20 Sept–8 Oct | 9–20 Oct | 21–31 Oct | Nov |
|---|---|---|---|---|---|
| 0.4 | 0.75 | 1.0 | 0.6 | 0.3 | 0.1 |

Shift 5 days earlier for herds with mature bulls (draw units, parks,
eastern herds), and 7–14 days later and wider for heavily hunted units.
Latitude shifts it ≤~1 week; where peak calving is known, backdate 247–255
days.

**Hour [S/I].** Tennessee bugles came at all hours, peaking 07–09 and
18–20 (≈ sunrise −0.5 to +1.5 h; sunset −1.5 to +0.5 h). One site peaked
at midnight. Weights:

| | First and last light | Next to those bands | Midday | Night |
|---|---|---|---|---|
| Elk [I] | 1.0: sunrise −0.5 to +1.5 h, sunset −1.5 to +0.5 h | 0.5 (daylight hour) | 0.3 (0.5 in peak weeks) | 0.6 |
| Moose (now) | 1.0: sunrise −0.5 to +3 h, sunset −3 to +0.5 h | 0.6 (mid-morning) | 0.3 (0.5 in a cold peak rut) | 0.35 |

**Weather [S/I].**
- **No moose-style temperature multiplier.** There was no temperature
  effect on bugle counts in Tennessee or on two Russian farms. Wild
  Siberian wapiti showed a weak negative, and stopped calling during 3 very
  cold, snowy days.
- **Rule [I]:** cool and calm 1.0; a hot midday (>20 °C) 0.7; a snowstorm
  0.3.
- **Wind and rain** act on hearing, not on willingness to bugle: keep the
  moose wind table as a hearing proxy [I].
- **Moon and pressure:** no evidence.
- **Hunting pressure** on daytime calling: 0.5–0.8, a judgement call [I].

**Hearing.**
- **The sound:** a bugle runs 550–2,100 Hz, ~80 dB at 10 m, for 2–4 s, and
  carries "several km"; Siberian calls carry 1.5 km [S]. Hunters hear
  bugles at 0.8–1.2 km on clear mornings, <180 m in snow [H]. Forest
  absorbs 1–2 kHz.
- **Radius [I]:**

  | Conditions | Radius |
  |---|---|
  | Default | 1.0 km |
  | Calm, clear evening or night over valleys | 1.5 km |
  | Open basins under an inversion | 2–3 km |
  | Wind >20 km/h or dense timber | 0.5 km |
  | Falling snow | 0.2 km |

- **Ridges [I]:** ridges shadow a high bugle more than a moose grunt, so it
  may seem to come from the crest.
- **Distance bins [I]:** close <150 m, near 150–400 m, far 400–1,000 m, very
  far >1 km. People compress distance (perceived ≈ k·r^0.4) [S], so far
  bugles feel near: widen the far bins.
- **Bearing [S]:** ~2° error facing the sound, ~20° to the side, 6%
  front/back confusion. **[I]** "Face the sound, then set the rose"; a ±10°
  wedge (±20° with wind or off a canyon wall); a "behind me?" flip.
- **Triangulation [I]:** two bearings a few hundred metres apart within
  ~10 min beat a guessed distance.

**The bull.**
- **Evidence [S]:** herd bulls feed 24% of the day, against 53% for
  non-breeding males (Bowyer 1981, abstract).
- **Hunter practice [H]:**
  - Herd bulls hold their cows; satellites come; young bulls flee challenge
    bugles.
  - Pressured bulls "bugle and run" or go quiet.
  - Bulls don't cow-call, so a bugle with cow calls from one spot is a
    hunter.
- **Type flag [I]:**
  - Repeated bugles from a moving spot with cow sounds: a herd bull. Go to
    him, intercepting ahead of the herd's heading, and close to <150 m
    before any call.
  - A lone answering bugler: a satellite. Set up and let him swing.

**Approach and setup.**
- **Approach [H]:** bulls circle downwind and sweep side to side. They hang
  up ~90 m out when they can't see a cow (Ramos), or "about 50 yd"
  (MeatEater summary, unverified).
- **Swing [I]:** reuse `hunting/swing.ts`, ending the close-in cost at
  ~90 m (~45 m behind cover; moose 45–75 m). Draw a ±50 m band inside
  150 m.
- **Setup [I]:**
  - Plan to a point 100–150 m from the bull, not to the bull.
  - Pick the side where the head-height wind and thermals carry scent away,
    crosswind (60–120°) to the line to him.
- **Caller to shooter [H]:** 90–140 m for cow calling at range, ~30 m for a
  close challenge (moose 40–50 m).
- **Downwind sector [I]:** widen it from 60° to ~90° when cows are heard
  (many noses). The 60° / 450 m sector is the moose default, not elk data.
- **Route [I]:** contour at his level, or slightly below in drainage. Use
  dead ground for the last 300 m. After the first locate: "he's located;
  close in quiet".
- **Sounds:** bugle, bugle with grunts, chuckle, cow mew or chirp, cow bark
  (alarm), raking, glimpsed.

**Seasons over the rut.**

| Where | Seasons | Source |
|---|---|---|
| CO 2026 | archery 2–30 Sept; muzzleloader 12–20 Sept; rifle from 14 Oct | third-party, checked against CPW |
| MT 2026 | archery 5 Sept–18 Oct; rifle 24 Oct–29 Nov | third-party |
| KY 2026 | archery 12–25 Sept; bull firearm 26–30 Sept and 3–7 Oct | official |
| PA 2026 | archery 12–27 Sept; firearms 3–11 Oct | third-party |
| ON 2026 | 21 Sept–4 Oct, draw (an older rule gave 16–29 Sept) | official |
| MB 2026 | archery 31 Aug–20 Sept; rifle ~28 Sept–18 Oct | official |
| BC Kootenay | general 10 Sept–20 Oct; bow from 1 Sept | official |

**Rule [I]:**
- The verdict keys off the rut curve, not the weapon.
- **Western rifle after ~15 Oct:** "glass and still-hunt security cover"
  replaces "call and close". Calling = rut value × pressure.
- **Eastern firearm seasons are rut hunts:** calling and the heard-bull
  route apply, with setups 150–300 m off.

**What changes from moose:**

| | Moose (now) | Elk |
|---|---|---|
| Rut peak | 23 Sept–8 Oct | 20 Sept–8 Oct, second hump mid-Oct |
| Temperature | 0.3 above 20 °C | 0.7 on a hot midday; 0.3 in a snowstorm |
| Habitat by hour | the same (bar `warm`) | day/night switch |
| Hearing | "well over 1 km" | 1–1.5 km; 2–3 km under an inversion |
| Locating | rare repeats | triangulate frequent bugles |
| Hang-up | 45–75 m | ~90 m, ~45 m behind cover |
| Caller to shooter | 40–50 m | 30–140 m |
| The animal | a lone bull | herd bull (go to him) or satellite; wider sector with cows |
| Reused | heard log, swing, live cone, ground wind, site rules 1–4 and 6–9, rule 5 corrected | |

## 8. Data and test areas: Colorado first, BC first in Canada

Lidar was checked against the index services over a 10 km box.

| # | Area (centre) | Unit | Elk | Lidar | Relief | Why; catch |
|---|---|---|---|---|---|---|
| 1 | CO White River NF, Flat Tops (40.08, −107.30) | GMU 24, DAU E-6 | 42,470 in the DAU (2025) | 2016 + 2020 QL2, 100%, 1 m DEMs | 2,461–3,337 m | biggest herd; 2002 burns; MVUM; ~4% private. Alt: Gunnison GMU 55 |
| 2 | BC East Kootenay, Bull River (49.45, −115.40) | MU 4-22 | South Trench 5,907 (2017/18), −53% since 2007/08; ~9,500 in 2023 (unverified) | LidarBC 100% (2016, 2022, 2024); HRDEM 46% | 747–1,570 m | three epochs; 150 cutblocks; 2021–22 fires; 24% private. Cutblocks, DRA and FTEN are Access Only |
| 3 | ID Boise NF (43.92, −115.62) | GMU 39 | 7,275 (2011, old) | 2018 QL2, 100% | 1,403–2,420 m | 100% USFS; 2016 fire; recent cuts; 37 MVUM roads |
| 4 | MT Gravelly (44.85, −111.92) | HD 323 (322 in the 2023 plan) | objective 6,000–10,000 observed | 2022 QL2, 1 m | 2,099–2,955 m | open, migratory; MVUM returns 0. Alt: Elkhorns (beetle-kill; 1 m DEM pending) |
| 5 | ON Bancroft (45.25, −77.62) | WMU 57 east | 2+2 of 12 tags (2026); 4 taken in 2025 | HRDEM 100%; 139 FRI leaf-on tiles | 282–509 m | cheapest (Ontario wired); a poor wind test; the harvest-area boundary is in a PDF only |
| 6 | AB Porcupine Hills (49.90, −114.10) | WMU 305 | 1,014 observed (2025) | none open (AltaLIS sells it) | 1,274–1,812 m | licensing-constrained test only |

**Pipeline changes [I]:**
- **US stand layer from pixels** (no national stand polygons), in the same
  shape as `ca_forest.py`:
  - type, cover and height: LANDFIRE EVT/EVC/EVH, 30 m (LF 2025 western
    vegetation out Apr–Jun 2026);
  - openings: RAP 10 m (unrestricted);
  - cut year: FACTS (`fy_completed`);
  - burns: MTBS to 2024, WFIGS for 2025–26;
  - cross-check: Annual NLCD.

  SCANFI v2, CanLaD and NBAC already cover Canada.
- **Coverage checks.**
  - Use 3DEP index layers 18 and 24, not TNM tile hits: at the Elkhorns,
    TNM gave tiles covering 0% of the box.
  - Use HRDEM's `extent` asset, not the item geometry: at Bull River, 100%
    became 25% and 0%.
  - Use LidarBC's point-cloud index, not its project extent.
- **`fetch_pointcloud.py`** hard-codes `utm16` paths. Bancroft's tiles are
  zone 17 (`1kmZ17…`): make the zone a parameter.
- **BC Access Only layers** (cutblocks, DRA, FTEN) can't ship without
  written permission. Instead, use VRI 2025 harvest attributes, RESULTS
  openings and CanLaD for cuts, and OSM for roads (ODbL, as its own layer).
- **Alberta:** lidar is commercial; only the 25 m DEM is open. AVI Crown
  stands are open.
- **Bigger cores.** A hunt covers 10.7 km and half of hunters go >2.5 km;
  a herd bull moves 2.4 km a day. Plan ≥5 km each way.
- **Seasonal range per area** from the state layers: summer and transition
  range for September, transition and corridors for Oct–Nov, winter range
  for December. Verify WY's code meanings, which came from memory.
- **Per-layer `sources`** with licence (bake_area.py does this for
  Ontario). Store unit labels with the season year, since MT renumbered
  HD 322 to 323.
- **New inputs:** snow depth; MVUM, RoadCore, PAD-US and OSM access tags.
- **Licences:** US federal data is presumed public domain (confirm). Ask
  CPW before shipping Colorado's layers.

## 9. Market and competitors: a real gap, a short window

**Market.**
- **US elk hunters:** 794,602 in 2006 ($1,201 each) and ~700,000 in 2016.
  The "211–224k" figure seen online is Colorado's, not the nation's.
- **By state:**

  | State | Hunters | Year | Nonresident |
  |---|---|---|---|
  | CO | 223,745 | 2016 | — |
  | MT | 111,969 | 2024 | 17.9% |
  | OR | 110,489 | 2016 | — |
  | ID | 101,912 | 2016 | — |
  | WY | 58,524 active | 2024 | 25.4% |
- **Nonresidents** spend ~12× per trip ($1,659 against $142, Montana
  1988–98) on ground they don't know: the best fit for paying per area [I].
- **Canada:** Alberta elk licences rose 45,662 → 52,950 (2021–25) while
  moose fell 20,704 → 16,104.

**Competitors.**

| App | Wind and scent | Price/yr |
|---|---|---|
| onX Hunt | station-based, terrain-adjusted point forecast; optimal-wind flags; no thermals; satellite data on T-Mobile | $34.99 web ($29.99 App Store) to $99.99 |
| HuntWise | WindCast cones | $59.99–119.99 (unverified) |
| HuntStand | HuntZone 72 h cone, free tier; 9M+ downloads claimed | $29.99–99.99 |
| BaseMap, ScoutLook | wind or scent cones | $39.99–99.99; free |
| goHUNT, Elk Finder | none | $149.99–499.99; $79 |
| ProHunt | cone; "thermal zone predictions", method undisclosed | $79.99 |
| **Contors** | terrain-solved wind field, scent plume, thermal/mixed regime; solver undisclosed, no validation; **whitetail only** | free, $39.99, $79.99 (launched Aug–Sept 2026) |

**What hunters say [H].** They check with powder bottles, distrust station
wind ("OnX Wind Direction Wrong" threads), and say apps show the wind but
not the "air currents" after terrain (Furrer, MeatEater).

**Satellite.**
- Forecasts by text are commoditised: inReach basic = 1 message, 7-day $1;
  ZOLEO = 1 message.
- iPhone 14+ satellite SMS is free for 2 years in the US and Canada.
- T-Satellite carries onX data.
- **[I]** GW1 stands apart only because it feeds the terrain model. iPhone
  satellite SMS to the bot is untested.

**Position [I].**
- **The moat:**
  - WindNinja momentum bake;
  - head-height canopy and slope flows;
  - wind checks that tune the model;
  - offline areas;
  - satellite updates.
- **Prove it:** publish a validation against powder-bottle checks.
- **The window is short:** Contors could add elk, and onX has the reach.

## 10. Open questions and unverified numbers

- **Range:**
  - Yukon exclusion-area dates come from a snippet.
  - The Sault elk records aren't vetted for farmed animals (St. Joseph
    Island).
  - The Michigan herd wasn't checked.
  - Moose, bear and grouse seasons per area weren't re-checked.
  - The Ontario herd sizes ("about 100 each", 2012 Bancroft 293–476) are
    unconfirmed.
  - Licence text on GAP and USGS items wasn't read.
  - Texas legal status is unknown.
  - MT, ID, WY and PA dates are third-party.
- **Habitat:**
  - Westside coefficients weren't retrieved; "1.6 km" and "80 m" are
    unverified.
  - No fall bed-terrain or corridor study exists.
  - Snow thresholds and a fall UCT are untraced.
  - Older burn durations are unverified.
  - Wind effects on elk weren't researched.
  - No Ontario, Quebec or Michigan GPS habitat study was reached beyond
    Burwash.
- **Pressure:**
  - Ranglack's thresholds conflict (13% / 2,760 m against 23–60% /
    1,846–3,679 m).
  - Lyon 1983 is secondary.
  - No walk-time pressure model has been published, and there is no slope
    threshold for refuge.
  - PAD-US access codes weren't fetched.
  - No moose pressure numbers were researched.
- **Thermals:**
  - No fall 1–2 m wind data exist for forested elk terrain.
  - Transition timing by aspect is unknown.
  - The canopy coupling threshold rests on one comparison.
  - WindNinja's diurnal scheme is unvalidated in forest.
  - No combined momentum + diurnal run has been tried.
  - Wagenbrenner 2019 wasn't read.
  - Rokslide's "8:30–9:30 am" is unverified.
- **Rut:**
  - No multi-year bugle series exists.
  - Ontario rut timing and Roosevelt conception dates are unknown.
  - The 50 yd hang-up and "1–2 bugles a minute" are snippets.
  - Caller spacing conflicts (30 yd against 100–150 yd).
  - Downwind circling, cow-call range and elk scent-detection distance are
    unmeasured.
- **Data:**
  - Current counts for BC Trench (2023), Idaho Unit 39 and the MT EMUs are
    missing.
  - USFS regional stand maps weren't checked.
  - MTBS 2025 isn't online.
  - The Bancroft FRI licence is unconfirmed.
- **Market:**
  - Colorado's 2023–25 hunter totals sit behind a viewer.
  - No willingness-to-pay data exist.
  - Contors' and ProHunt's methods are undisclosed.
  - onX's prices conflict between web and App Store.

## Key sources

**Range and seasons, Canada**
- [Ontario elk regulations](https://ontario.ca/document/ontario-hunting-regulations-summary/elk)
- [Ontario elk tag quotas](https://www.ontario.ca/page/elk-tag-quotas)
- [Ontario elk harvest CSV](https://data.ontario.ca/dataset/elk-harvests)
- [Ontario 2025 elk hunter report](https://www.ontario.ca/files/2026-03/mnr-2025-elk-hunter-report-summary-en.pdf)
- [ERO 012-2541](https://ero.ontario.ca/notice/012-2541)
- [CBC Sudbury 2024](https://www.cbc.ca/news/canada/sudbury/elk-restoration-northern-ontario-1.7186287)
- [LIO WMU layer](https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open05/MapServer/5)
- [Ontario deer regulations](https://www.ontario.ca/document/ontario-hunting-regulations-summary/white-tailed-deer)
- [Yukon elk permit hunt map 2026](https://open.yukon.ca/information/663bc543-91b8-4a91-83c3-3436c70d23a0/resource/62e27fe8-a4c1-4e17-900a-242b21b531d0/download/env-elk-pha-2026.pdf)
- [Yukon PHA data sheet 2026](https://open.yukon.ca/information/663bc543-91b8-4a91-83c3-3436c70d23a0/resource/8c583d0c-2da4-45fc-87d2-1d34d20ea110/download/env-2026-permit-hunt-authorization-data-sheet.pdf)
- [Takhini survey 2024](https://open.yukon.ca/information/b6a1f544-a9cc-4289-ab1e-ce867965f711/resource/1fd10c65-7c19-4040-8a6e-d74c2dbdf555/download/env-takhini-elk-early-winter-survey-2024-full-report.pdf)
- [Yukon Wildlife Key Areas](https://open.yukon.ca/data/elk-wildlife-key-area-250k)
- [Quebec mammal ranges](https://www.donneesquebec.ca/recherche/dataset/aires-de-repartition-faune)
- [Quebec deer plan changes](https://cdn-contenu.quebec.ca/cdn-contenu/faune/documents/gestion-especes/Plans-gestion/plan-gestion-cerf-virginie-changements.pdf)
- [Saskatchewan elk plan](https://swf.sk.ca/wp-content/uploads/2025/10/Elk-MP.pdf)
- [Manitoba hunting guide 2026](https://www.manitoba.ca/nrnd/fish-wildlife/pubs/fish_wildlife/huntingguide.pdf)
- [BC Kootenay synopsis](https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/hunting/regulations/hunting-trapping-synopsis-region-4-kootenay.pdf)
- [NatureServe API](https://explorer.natureserve.org/api/data/taxon/ELEMENT_GLOBAL.2.1353292)
- [GBIF licence facet](https://api.gbif.org/v1/occurrence/search?country=CA&taxonKey=4262380&limit=0&facet=license)
- [IUCN terms](https://www.iucnredlist.org/terms/terms-of-use)

**Range, US**
- [GAP elk range](https://www.sciencebase.gov/catalog/item/59f5e1e6e4b063d5d307db71)
- [USGS corridor mapping, vol. 6](https://pubs.usgs.gov/publication/sir20265123)
- [CPW species data](https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/ArcGIS/rest/services/CPWSpeciesData/FeatureServer)
- [WGFD elk seasonal range](https://services6.arcgis.com/cWzdqIyxbijuhPLw/ArcGIS/rest/services/Elk_Seasonal_Range/FeatureServer/0)
- [Utah elk habitat](https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services/Utah_Elk_Habitat/FeatureServer/0)
- [NDOW elk distributions](https://services.arcgis.com/RyxlXSfFi87rAosq/arcgis/rest/services/Occupied_Elk_Distributions/FeatureServer/1)
- [MT big-game distribution](https://fwp-gis.mt.gov/arcgis/rest/services/wild/bigGameDistribution/MapServer)
- [CDFW ds945](https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds945_fpu/FeatureServer/0)
- [PGC elk zones](https://services1.arcgis.com/k8yxvICm95iIFicb/arcgis/rest/services/PGC_Hunting_Boundaries/FeatureServer)
- [state populations (aggregator)](https://worldpopulationreview.com/state-rankings/elk-population-by-state)

**Habitat**
- [Rowland et al. 2018](https://wildlife.onlinelibrary.wiley.com/doi/full/10.1002/wmon.1033)
- [Westside user guide](https://data.fs.usda.gov/research/pnw/tools/westside-elk-modeling/WestsideElkModelUserGuide.pdf)
- [Spitz et al. 2018](https://www.fs.usda.gov/pnw/pubs/journals/pnw_2018_spitz001.pdf)
- [Ruprecht et al. 2023](https://research.fs.usda.gov/download/treesearch/66581.pdf)
- [Snobl et al. 2024](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/elk/research/16---snobl.etal.2023.pdf)
- [Millspaugh et al. 1998](https://www.originalwisdom.com/wp-content/uploads/bsk-pdf-manager/2019/04/Millspaugh-et-al_1998_Summer-bed-sites-of-elk-in-the-Black-Hills-South-Dakota.pdf)
- [Ranglack et al. 2017, MFWP report](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/elk/research/fall-elk-resource-selection---final-report.pdf)
- [Cook et al. 1998 (PNW Science Findings 22)](https://research.fs.usda.gov/download/treesearch/4662.pdf)
- [Chranowski 2009](https://mspace.lib.umanitoba.ca/server/api/core/bitstreams/09896ecc-9e0d-420c-9501-56060913bd3e/content)
- [Merems et al. 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11445449/)
- [Appalachian elk selection](https://pmc.ncbi.nlm.nih.gov/articles/PMC13072265/)
- [Rickbeil et al. 2019](https://www.usgs.gov/publications/plasticity-elk-migration-timing-response-changing-environmental-conditions)
- [IDFG 2016](https://fishandgame.idaho.gov/ifwis/idnhp/cdc_pdf/Elk%20Season%20Range%20in%20Idaho%20Version%202.pdf)
- [FRI elk winter HSI](https://friresearch.ca/sites/default/files/null/HSP_1999_10_Rpt_ElkWinterForaging.pdf)
- [Long et al. 2014](https://research.fs.usda.gov/treesearch/47508)
- [Ensing et al. 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4160215/)
- [Conner et al. 2007](https://bioone.org/journals/journal-of-wildlife-diseases/volume-43/issue-4/0090-3558-43.4.784/Elk-Use-of-Wallows-and-Potential-Chronic-Wasting-Disease-Transmission/10.7589/0090-3558-43.4.784.full)
- [Popp et al. 2013](https://doi.org/10.1155/2013/415913)
- [McGeachy 2014](https://zone.biblio.laurentian.ca/dspace/handle/10219/2181)

**Pressure**
- [Rowland et al. 2004](https://research.fs.usda.gov/download/treesearch/24797.pdf)
- [Wisdom et al. 2004a](https://research.fs.usda.gov/treesearch/24836)
- [Wisdom et al. 2004b](https://research.fs.usda.gov/treesearch/24837)
- [Johnson et al. 2004](https://research.fs.usda.gov/treesearch/24784)
- [Wisdom et al. 2018](https://research.fs.usda.gov/treesearch/56220)
- [Ranglack et al. 2017, JWM](https://doi.org/10.1002/jwmg.21258)
- [Lowrey et al. 2020](https://doi.org/10.1002/jwmg.21781)
- [Proffitt et al. 2010](https://doi.org/10.2193/2008-593)
- [Proffitt et al. 2013](https://doi.org/10.1002/jwmg.491)
- [Proffitt et al. 2016](https://doi.org/10.1002/jwmg.21122)
- [Proffitt et al. 2025](https://doi.org/10.1002/wlb3.01509)
- [Dugal et al. 2013](https://doi.org/10.1002/ece3.788)
- [Visscher et al. 2017](https://doi.org/10.1002/wsb.741)
- [Paton et al. 2017](https://doi.org/10.1002/ecs2.1841)
- [Ciuti et al. 2012, Proc. B](https://pmc.ncbi.nlm.nih.gov/articles/PMC3479801)
- [Ciuti et al. 2012, PLoS ONE](https://doi.org/10.1371/journal.pone.0050611)
- [Thurfjell et al. 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5470680/)
- [Lyon & Burcham 1998](https://doi.org/10.2737/rmrs-rp-3)
- [Stedman et al. 2004](https://doi.org/10.2193/0022-541x(2004)068[0762:iwahrm]2.0.co;2)
- [Christensen et al. 1993, INT-GTR-303](https://www.fs.usda.gov/rm/pubs_int/int_gtr303.pdf)
- [Hayes et al. 2002](https://doi.org/10.2307/3803182)
- [Conner et al. 2001](https://doi.org/10.2307/3803041)
- [Vieira et al. 2003](https://doi.org/10.2307/3802678)
- [MVUM metadata](https://data.fs.usda.gov/geodata/edw/edw_resources/meta/S_USA.Road_MVUM.xml)
- [PAD-US](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview)

**Thermals**
- [Zardi & Whiteman 2013](https://home.chpc.utah.edu/~whiteman/homepage/articles/ZardiWhiteman_2012.pdf)
- [Butler et al. 2015](https://acp.copernicus.org/articles/15/3785/2015/)
- [Wagenbrenner et al. 2016](https://acp.copernicus.org/preprints/acp-2015-761/acp-2015-761-manuscript-version4.pdf)
- [Forthofer et al. 2009](https://ams.confex.com/ams/pdfpapers/156275.pdf)
- [Farina et al. 2023](https://iris.unitn.it/bitstream/11572/451009/1/apme-JAMC-D-22-0011.1.pdf)
- [Pypker et al. 2007](https://andrewsforest.oregonstate.edu/sites/default/files/lter/pubs/pdf/pub4223.pdf)
- [Nadeau et al. 2020](https://impacts.ucar.edu/en/publications/field-observations-of-the-morning-transition-over-a-steep-slope-i/)
- WindNinja [`cli.cpp`](https://github.com/firelab/windninja/blob/master/src/ninja/cli.cpp) and [`ninjaArmy.cpp`](https://github.com/firelab/windninja/blob/master/src/ninja/ninjaArmy.cpp)
- [GoHunt, using your nose](https://gohunt.com/browse/tips-and-tricks/using-your-nose-to-find-elk)
- [HuntTalk thermals thread](https://www.hunttalk.com/threads/thermals.300560/)

**Rut and calling**
- [Noyes et al. 1996](https://www.dfw.state.or.us/wildlife/research/docs/ELKEffectsofbullageonconceptiondatesandpregnancyratesofcowelkinoregon.pdf)
- [Metts et al. 2026](https://seafwa.org/sites/default/files/journal-articles/j13-09-metts-et-al-83-92.pdf)
- [Volodin et al. 2016](http://kmkjournals.com/upload/PDF/RJT/15/ther15_2_091_099.pdf)
- [Titze & Riede 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC2924247/)
- [Makous & Middlebrooks 1990](https://pubmed.ncbi.nlm.nih.gov/2348023)
- [Kolarik et al. 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4744263)
- [Bowyer 1981](https://academic.oup.com/jmammal/article-abstract/62/3/574/893391)
- [RMEF, The X-Zone](https://www.rmef.org/elk-network/the-x-zone/)
- [RMEF, Follow the ARC](https://www.rmef.org/media/elkcallingchampfollowthearc/)
- [KDFWR seasons](https://fw.ky.gov/Hunt/Pages/ky-hunting-fishing-seasons-planner.aspx)

**Data and test areas**
- [3DEP index](https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer)
- [HRDEM STAC](https://datacube.services.geo.ca/stac/api/collections/hrdem-lidar)
- [LidarBC index](https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer)
- [LANDFIRE](https://landfire.gov/data)
- [RAP](https://rangelands.app/products/)
- [USFS EDW datasets](https://data.fs.usda.gov/geodata/edw/datasets.php)
- [SCANFI v2](https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/SCANFI/v2/_SCANFI_v2_read_me.txt)
- [BC cutblocks (Access Only)](https://catalogue.data.gov.bc.ca/dataset/harvested-areas-of-bc-consolidated-cutblocks-)
- [BC copyright](https://www2.gov.bc.ca/gov/content?id=1AAACC9C65754E4D89A118B875E0FBDA)
- [AltaLIS catalogue](https://www.altalisdata.com/hubfs/2025/Product%20Catalogue%20PDFs%20(April%202025)/Altalis%20Product%20Catalogue%20-%20Digital%20Version.pdf?hsLang=en)
- [CPW 2025 elk estimates](https://cpw.widen.net/s/fmhlcbms2w/2025-elk-population-and-sex-ratio-estimates)
- [Rocky Mountain Trench inventory](https://wetlandstewards.eco/wp-content/uploads/2020/04/2017-18-Rocky-Mountain-Trench-elk-inventory-report.pdf)
- [IDFG elk plan](https://idfg.idaho.gov/old-web/docs/wildlife/planElk.pdf)
- [MT FWP Region 3 elk plan](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/elk/elk-management-plan/region-3-elk-plan.pdf)
- [WMU 305 survey](https://open.alberta.ca/opendata/wmu-305-aerial-ungulate-survey-2025)

**Market**
- [2016 survey (secondary)](https://outdoorempire.com/most-hunted-game-animals-us/)
- [2006 survey](https://huntinglife.com/elk-hunting-adds-nearly-1-billion-a-year-to-economy/)
- [KTVH, Montana](https://www.ktvh.com/news/montana-news/looking-at-non-resident-hunter-numbers)
- [WGFD 2024 elk report](https://wgfd.wyo.gov/media/32051/download)
- [MT FWP 2001 elk hunter profile](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/elk/research/human-dimension-surveys/2001-profile-elk-hunter.pdf)
- [My Wild Alberta sales](https://mywildalberta.ca/buy-licences/annual-sales-statistics.aspx)
- [Ontario 2025 moose report](https://www.ontario.ca/files/2026-03/mnr-2025-moose-hunter-report-summary-en.pdf)
- [Québec 2025 statistics](https://www.quebec.ca/nouvelles/actualites/details/statistiques-de-chasse-2025-une-annee-a-succes-pour-la-chasse-a-lorignal-68586)
- [onX wind and weather](https://www.onxmaps.com/hunt/learn/capabilities/weather)
- [onX pricing](https://www.onxmaps.com/hunt/app/pricing)
- [HuntStand (App Store)](https://apps.apple.com/us/app/huntstand-gps-maps-tools/id778772892)
- [Contors](https://contors.com)
- [Contors launch release](https://www.einpresswire.com/article/944773435/contors-hunting-map-app-launches-on-ios-android-and-web-with-4-industry-firsts)
- [ProHunt](https://prohunt.app/)
- [Elk Finder](https://elkfinder.com/)
- [Apple satellite messages](https://support.apple.com/en-us/120930)
- [T-Mobile T-Satellite apps](https://www.t-mobile.com/news/network/t-satellite-data-ready-app-expansion)
