# Old logging roads: found in the LiDAR, marked in the HD bake

Status: research and a plan, 2026-10-18. Nothing is built. Gavan that day:
"have Optimus research how to identify old roads. Should be marked up
automatically in an HD build." The measurements in §2.1 were made the same
day with scratch scripts (not committed) on the cached grids of Pickle
Lake, the Sault test, Whitefish Lake, Lac Bailey and Duhamel, and on 49 FRI
canopy tiles fetched for the test. Evidence tags as in
HUNT-FISH-SCIENCE.md: **[S]** peer-reviewed or agency science, **[G]**
agency guidance, regulation or licence text, **[H]** hunter lore, **[I]**
inference, our own measurements included. Every source was read on
2026-10-18; "(abstract)" or "(snippet)" marks what was read no further.

Why it matters:
- Old logging roads are how moose move through the bush [H] (Gavan,
  2026-10-07). The science is mixed: in Quebec moose used 11–20-year-old
  logging roads most and roads over 30 years old least, following the
  browse on them (St-Pierre 2021, thesis) [S]; on linear features
  (seismic lines, low-grade roads) moose moved faster and, in calving
  season, kept away (Dickie et al. 2020); in Alberta's foothills they drew
  closer to seismic lines in winter and were indifferent to roads
  (Finnegan et al. 2023) [S] (both in
  docs/research/research_notes/Clearwater…/).
- They are how hunters walk in: hunters on foot spent 26 % of their time
  on roads, and "closed roads facilitate access to areas most distant from
  open roads" (Lyon & Burcham 1998) [S].
- Today Gavan finds them by eye in the Terrain view, "really the only
  reason I use that view" (2026-10-07). His test spot is 48.91781,
  −85.58811 at Pickle Lake: an old road runs down to the creek north-west
  of it. It shows in the live DEM-drawn shade (MapLibre's multidirectional
  hillshade on the `dem` archive, about 1.6 m pixels); the baked 1 m LiDAR
  shade lays a white veil of hummock texture over it, and a 3×
  exaggeration made that worse. Why: a hillshade is a slope, so it
  amplifies short wavelengths. Hummocks 0.1–0.2 m high at 2–2.5 m spacing
  have slopes of 14–32°, a road's flank of 0.2 m over 10 m about 7°;
  tripled, the hummocks saturate the shading while the road reaches about
  20°. A 1.6 m grid cannot hold anything shorter than 3.2 m, which is
  where the hummocks' spectrum rolls off (Moore et al. 2019: most
  hummock–hollow variance at 1–10 m, roll-off at 2.4–2.9 m) [S]/[I].
  Drawing the roads as lines takes the question of the veil away.

## Bottom line

1. **This week, from the maps.** Ontario publishes its non-passable roads
   (closed, retired, decommissioned) as a second open package that the
   bake never uses; the app gets the passable ones only. At Pickle Lake
   that leaves 96 of 200 km of mapped road off the map. Baked as their own
   dashed "Old road" theme they are on the map in half a day; every
   province in two days. Quebec's road network keeps its impassable,
   grown-back and winter roads; BC's open forest-tenure segments keep
   retired road permits; Alberta's cutlines and the Yukon's disturbance
   lines are open. **But no map has Gavan's road**: nothing of any status
   within 1.86 km of his spot, nothing on the 1979 sheet or Toporama.
2. **From the LiDAR, about two weeks of work.** Measured on the mapped
   roads of Pickle Lake's core: a road that kept its bed is a raised bench
   about 0.6 m high and 7–8 m wide; a road built at grade and grown back
   is a strip of trees 2–3 m shorter than those beside it. Over 100 m of
   line, one or the other finds 89 % of the open road, 57–81 % of the
   restricted, about a third of the decommissioned and long-retired, but
   also passes 10 % of random stretches: a hand rule would draw roads
   everywhere. No published method finds old roads on flat boreal ground:
   the forest-road work is from slopes, and Ontario's own single-photon
   work (Morley et al. 2024; Ghanbari et al. 2026) re-places mapped roads
   but cannot find the overgrown ones. The plan is a trained detector:
   terrain and canopy derivatives, a per-pixel model taught by the
   provinces' mapped roads, lines linked and scored. Expected at Pickle
   Lake, within 5 m: about 0.85–0.95 of maintained roads, 0.6–0.8 of old
   roads that kept a bed, 0.2–0.6 of roads with none [I]. The bar set here:
   recall 0.85 on open roads, 0.7 on restricted, 0.4 on decommissioned;
   precision 0.8 in a blind check; Gavan's road found.
3. **Imagery dates them; it does not find them.** No optical sensor sees a
   road bed under closed crowns. Global Forest Change stamps the year a
   haul road was cut through standing forest (2001–2025), Landsat series
   date older ones, the 20 cm FRI photos (OGL-Ontario) show a line's state.
   No national road-change layer is published. Esri's photo is out: its
   terms bar training on it and compiling data from it for others.
4. **Licences.** Ontario, Quebec, Alberta, the Yukon, NRCan and ECCC
   lines can go in a paid pack with their credit lines (Quebec's CC BY
   wants a legal read for a locked pack; the Yukon's licence page would
   not load). BC's Digital Road Atlas and TRIM cannot ("Access Only"),
   and they are in Blanchard River's pack today under an OGL-BC label.
   OpenStreetMap is share-alike; ABMI's footprint, the AER's wells and
   Esri's imagery need written terms.
5. **Cost.** About 10–20 minutes of compute an HD area beyond today's bake
   (the core filters took 80 s over Pickle Lake's 104 M cells; the canopy
   tiles, about 1 GB a core, a minute or two to fetch); training once, in
   hours. Work: the mapped roads in one to two days; the detector and its
   test in about two weeks (Plan).

## 1. Road datasets, by province

"In a paid pack" means the lines, or lines derived from them, shipped in
an HD area. [G] for the licence text, [I] for the verdict.

| Source | Where | Old roads kept? | Dates on it | Licence | In a paid pack |
|---|---|---|---|---|---|
| MNRF Road Segments: the passable package and the **non-passable package** | ON | Yes: closed, retired, decommissioned; geometry "never deleted" | `YEAR_DECOMMISSIONED`; the build year is mostly a placeholder | OGL-Ontario | Yes, with the credit line |
| Forest management annual report and work schedule roads | ON | Decommissionings, by year | the report year | OGL-Ontario (FIM 2026 §1.2; the services themselves say nothing) | Yes; confirm per service |
| Ontario Road Network | ON | No (passable primary and branch roads only) | — | OGL-Ontario (+ licensed sources) | Yes; nothing at Pickle |
| FRI 2010 `UCL` polygons | ON | Wide corridors only | — | OGL-Ontario | Yes; 3 at Pickle |
| FRI 2007–2011 orthophotos | ON | — | — | "not open data", custom EULA | No |
| RQTT / AQréseau+ "Autre route" | QC | Yes: impassable, 4×4-only, winter, unvisited | classification year only | CC BY 4.0 | Yes, with credit; its anti-DRM clause wants a legal read |
| RATF road works 2013–2025; BDTQ 1:20 000 (1950–2006); the 1st and 2nd forest maps | QC | Yes: closed, dismantled, "abandonnée" | dates, map years | CC BY 4.0 | Yes |
| FTEN Road **Segment** Lines; RESULTS road polygons; BC Energy Regulator permits and seismic lines | BC | Yes (retired permits) | retirement, reference year | OGL-BC; BCER Open Data Licence | Yes |
| **Digital Road Atlas, TRIM**, FTEN Section Lines, CEF Integrated Roads | BC | Partly ("overgrown", "decommissioned", "Road Over-grown") | none, or TRIM's | **Access Only** | **No**, without GeoBC's written permission |
| Access and Facility Roads | AB | No flag | capture year | OGL–Alberta | Yes |
| Cutlines and Trails | AB | Yes (no regrowth flag) | capture year | **OGL–Alberta** | Yes |
| ABMI Human Footprint Inventory 2023 | AB | Yes ("We do not 'retire' human footprint") | seismic dating | acknowledgement, no licence | Ask |
| Surface disturbance lines; Vegetation Inventory Roads 40k; Yukon Road Network | YT | Partly; yes; no | image dates 2001–21; 1995–2006; — | OGL-Yukon 2.0 (its text would not load) | Yes; confirm the wording |
| CanVec transport; NTS 1:50 000 scans; Toporama | CA | 1977 trails, cart tracks | source dates | OGL-Canada | Yes |
| ECCC boreal caribou disturbance (2010–20); BEAD (2008–10) | CA | Yes | year added | OGL-Canada | Yes |
| National Road Network | CA | No | — | OGL-Canada | Yes; thin off highways |
| OpenStreetMap | — | varies | — | ODbL, share-alike | No: it would make our layer ODbL |

Credit lines: "Contains information licensed under the Open Government
Licence – Ontario" (and – Canada, – Alberta, – British Columbia); Quebec's
CC BY wants publisher, title, Données Québec, update date, link and
consultation date, which an About page carries.

### Ontario [G]

**MNRF Road Segments** (`MNRRDSEG`): roads on Crown land maintained by or
of interest to the ministry, a data class since 2006. It "should not
include ATV trails or temporary paths used for forest harvesting e.g.
skidder trails", and "When a road segment is no longer accessible by
conventional four-wheel vehicles, the STATUS field is updated, and the
geometry is retained (never deleted)" (data dictionary, 2026-03-31).
Positional accuracy: "Precise: +/- 10 m" by the package's metadata; on
the Nipissing and Dryden forests the mapped roads were off by a mean
9.4 m and a 95th percentile of 51 m (Ghanbari et al. 2026) [S].
- **Two packages now.** `MNRRDSEG.zip` fetched 2026-10-18 holds 314,768
  segments, every one passable, and so does the LIO map service the bake
  queries (`LIO_Open09/MapServer/18`: all 314,735 passable). The 203,212
  non-passable segments (119,570 km) are published apart,
  `MNRRDSEG_Non_Passable_Roads.zip` (layer `NonPassable09092026`), which
  "may not reflect the most current non-passable road information". Our
  staged copy of 2026-10-06 (`pipeline/raw/stage/lio/MNRRDSEG`) holds both
  (517,982); `on_vectors_local.py` filters it back to the passable ones.
- **What the app leaves out.** Over Pickle Lake's region, clipped to the
  box: 104.6 km passable (in the app) and 95.7 km non-passable (not), 91
  km once repeated lines are dropped, 79 km of it closed (59 km with no
  FMP class: the old "Retired Roads"). The core: 43 km, 21 closed or
  impassable. Around White River the non-passable lines lie within 25 m
  of a passable one only 2 % of the time: other roads, not copies.
- **Fields**: `STATUS` Open / Closed / Restricted / Internal
  ("Decommissioned" was dropped on 2019-03-12); `PASSABLE_IND` "if a 4x4
  vehicle is able to drive the segment"; `FMP_ROAD_CLASS` primary,
  branch, operational ("normally not maintained … often site prepared and
  regenerated"); `CLOSURE_INTENT` (Caribou, ESA, Public Safety,
  Regeneration, Remote Tourism, Unauthorized); `CLOSED_STATE` (Untreated,
  Treated, Regenerated, Rehabilitated); `TREATMENT_TYPE`; flags for a
  berm, gate, planted or destroyed roadbed, slash pile, removed crossing;
  `YEAR_DECOMMISSIONED` (1990–2040: later years are planned). No
  "overgrown" field: "brush", "grown in" and "overgrown" turn up in 184 of
  the non-passable package's comments. At Pickle Lake the closure fields
  are empty, 33 segments have a crossing removed and 16 a destroyed
  roadbed.
- **The years cannot date an old road.** `YEAR_CONSTRUCTED` is mostly a
  load year: "Before 2016" alone is on 89,491 segments; only 1,966 carry
  an actual year before 1990. At Pickle Lake: 82 km "Before 2016", 66 km
  "Before 2010", 31 km "1982 Approximate"; actual years only on 2017–2024
  roads.
- **Where its old roads came from**: 65,853 non-passable segments say
  "Added from the 'Retired Roads' layer"; the annual reports add the
  decommissionings (at Pickle Lake 40 segments, 2018 and 2020).
- **Gavan's road is not in it**: the nearest segment of either package is
  1.86 km from his spot.

**Forest management records.** The annual report's road layer (roads
built, maintained, decommissioned or with access control changed in the
year; decommissioning codes BERM, SCAR, SLSH, WATX) and the work
schedule's road activities are live per-forest services
(`White_River_2024_AR_3363`: 73 lines, 9 in Pickle Lake's box;
`White_River_2026_AWS_2747_View`: 7,457, 34 in the box). FIM 2026 §1.2
has the ministry publish this under OGL-Ontario. The historical annual
report package (2002–2023) no longer carries its roads tables. White
River's 2014–19 audit: "Decommissioning of 87.7 kms of operational roads"
by signs, ditching and berms. These are labelled decommissioned roads for
training, and shippable.

**Others.** The Ontario Road Network takes an MNRF road only when it is
primary or branch, open or restricted, passable and connected: none at
Pickle Lake. The FRI 2010 has no roads layer: its `UCL` polygons ("roads,
railroads, logging camps … utility corridors") number 3 in the box, its
access codes are blank. OTN trails and road barriers: none in the box.
`LIO_Open04/18` is the rail network (Operational, Discontinued), not
abandoned rail.

### Quebec (CC BY 4.0 throughout) [G]

- **AQréseau+ → RQTT.** AQréseau+ "évolue et est désormais offert sous le
  nom de RQTT"; the `AQreseau_WMS` service the bake reads stays up only
  until the RQTT's goes live, the transition running to the end of 2026.
  RQTT guide v1.0, 2026-07-02, updated three times a year, as GPKG, SHP
  and FGDB. The forest roads are layer "Autre route": 968,572 segments,
  509,251 km (release AQ20260701).
- **It keeps the old roads, and says which.** `CarRte`: OUI two-wheel
  drive, NON four-wheel drive only, **IMP "Impraticable (hiver, refermé,
  lessivé, historique, etc.)"**, INC unknown. `Cls_CheFor`: HN and 01–05
  drivable classes; NC not classed; **HI** winter roads ("chemin
  temporaire … impraticables sur une base régulière"); **IN** unknown,
  "p. ex. : chemins d'anciens secteurs de coupe qui n'ont pas été visités
  depuis les dernières interventions". Province-wide IMP 116,558 km (69,522
  of it winter roads), NON 55,152 km, IN 24,683 km. `An_Classi` is the
  year of the classification, not of building; "La condition réelle sur
  le terrain … n'est pas consignée."
- In the bake: `qc_vectors.py` drops HI, the winter roads: roads built at
  grade, the kind only the canopy finds (§2.1). NON and IMP stay in
  `roads`, where `build_habitat.road_kind` reads them as drivable pack-out
  roads.
- **RATF** (road works by year, 2013-14 to 2024-25, public land): the
  2024-25 layer has 24,096 lines, including IF "Implantation suivi d'une
  fermeture permanente" and DE dismantled. **Infrastructures en milieu
  forestier** (since 2003): landings and gravel pits, the ends of old
  spurs.
- **BDTQ 1:20 000** (1950–2006 photography, about 4 m, no longer updated):
  "voie de communication … abandonnée", "chemin non carrossable", and the
  vegetation class "Percée" (a linear clearing). The **1st and 2nd forest
  inventory maps** (1970–83, 1981–94), scanned, show the road network
  then.
- The MRNF's LiDAR products (1 m DTM and canopy height since 2006) carry
  no road layer.
- **CC BY 4.0 in a paid pack**: besides the credit, "You may not … apply
  any Effective Technological Measures to, the Licensed Material if doing
  so restricts exercise of the Licensed Rights by any recipient". A locked
  HD pack carrying Quebec lines wants a legal read; the OGLs have no such
  clause. [I]

### British Columbia [G]

- **The Digital Road Atlas and TRIM are "Access Only", not OGL-BC.** The
  BC Data Catalogue: DRA Master Partially-Attributed Roads, licence
  "Access Only", `isopen` false; TRIM Transportation Lines, "Access Only",
  download audience "Government", its record adding "IS NOT under the
  Open Government license … may not redistribute, or sell the data". The
  same for FTEN Road Section Lines and the CEF Integrated Roads. BC's
  copyright page: Access Only material is not to be reproduced "without
  written permission". **`bc_vectors.py` ships the DRA and TRIM lines in
  Blanchard River's pack under `bc_common.write`'s default licence,
  OGL-BC.**
- `bc_vectors.py`'s TRIM code is wrong as well: DA25150000 is "Road
  (Unimproved)" (1.93 million lines), not a trail. Trail is DD31700000,
  skid trail DD31700120, **road over-grown DA25150100** (45,729 lines),
  cutline JA08400000 (in TRIM's miscellaneous lines).
- **Open in BC**: FTEN Road **Segment** Lines (OGL-BC; Active, Retired
  (80,912) or Pending; "Retired … does not mean the road is necessarily
  decommissioned … may not have been built"); RESULTS forest cover's road
  polygons (OGL-BC); the BC Energy Regulator's road permits (OGL-BC) and,
  from its own portal, seismic lines under the BCER Open Data Licence
  (commercial use allowed); LidarBC (OGL-BC).
- The DRA's surfaces include "overgrown" (90,178 segments) and
  "decommissioned" (442); its capture date is blank everywhere.

### Alberta [G]

- **Access and Facility Roads**: OGL–Alberta; 1,076,398 arcs; capture
  year only; no decommissioned or reclaimed flag.
- **Cutlines and Trails**: OGL–Alberta ("To access the data you must
  agree to the terms of the Open Government Licence - Alberta", its
  metadata), which answers the open question in the Clearwater notes.
  3,764,703 arcs, "a minor access feature, usually only a linear
  clearing"; "All cutlines and trails visible in the imagery are
  digitized", updated from SPOT to 2022–23. Capture years, not cut years;
  seismic lines, pipelines and quad trails lumped; no flag for lines grown
  back.
- **ABMI Human Footprint Inventory 2023** dates seismic lines, but "We do
  not 'retire' human footprint"; its terms ask for acknowledgement and
  grant no commercial licence. Ask before shipping it.
- The Alberta Vegetation Inventory does not map clearings under 15 m.
  Alberta's own LiDAR: no open licence found; NRCan bought
  OGL-compatible licences for 22,876 km² and 78,072 km² of it in 2025
  (CanadaBuys award notices), which may reach HRDEM.

### Yukon [G]

- **Surface disturbance lines** (OGL-Yukon 2.0): digitised from imagery
  dated 2001–2021 (mostly 2010, 2019, 2020) with `TYPE_DISTURBANCE`
  (Access Road, Trail, Unpaved Road, Survey/Cutline, Seismic Line …),
  `WIDTH_M` and `IMAGE_DATE`; 70,930 lines; the "Historic" and "Retired"
  sets are not published. `yt_vectors.py`'s note "2014-16 SPOT imagery" is
  wrong, and its filter drops the seismic lines.
- **Vegetation Inventory Roads 40k** (1995–2006): 10,975 lines, 6,790 of
  them "Exploration network". **Yukon Road Network**: no date or status.
- The OGL-Yukon page answered HTTP 403: likely the same commercial-use
  terms as the other 2.0 OGLs, to confirm.

### National, and OpenStreetMap [G]

- **CanVec Transport** (last release 2019, no upkeep planned): roads from
  the NRN; class 317 "Resource-Recreation Cart Track" (88,204 segments in
  Ontario, which looks like the ORN's resource roads relabelled [I]);
  trails with a source date and accuracy. Pickle Lake's box: no road, 3
  trails (2.8 km) dated 1977 at 18–19 m. Around White River only 19–32 %
  of CanVec's 617 km of 1977 trails lie within 25–100 m of an MNRF road.
- **The National Road Network** is the ORN in Ontario; thin elsewhere off
  the highways.
- **NTS 1:50 000 scans (CanMatrix)**: one edition per sheet on NRCan's
  servers, none older found. 042C13 is edition 2, © 1979, "Updated from
  aerial photographs taken in 1976. Culture check 1977", accuracy 50 m;
  its legend has "cart track" and "trail, cut line or portage". Round camp
  it shows no road or track, only a township line. Crown copyright runs
  50 years from publication (Copyright Act s.12), so sheets published in
  1975 or earlier should be in the public domain [I]; NRCan's copies are
  OGL anyway. A pointer to pre-1977 trails, not a line to draw.
- **ECCC's boreal caribou disturbance** (2008–10, 2015, 2020) and
  **BEAD** (2008–10): roads and seismic lines read off 30 m Landsat over
  caribou ranges and the boreal, with a year added; "not designed to
  identify the age of disturbances"; nothing at Pickle Lake's camp.
- **OpenStreetMap** (ODbL): near Pickle Lake four ways, around White River
  974 of 1,164 tracks imported from CanVec. Blending OSM lines with ours
  makes a derivative database that must be offered free under ODbL
  (§4.4, §4.6); leave it out.

## 2. Roads from LiDAR alone

### 2.1 What a road is in Pickle Lake's LiDAR (measured 2026-10-18)

The test [I]: every segment of the MNRF packages that meets Pickle Lake's
core (55 once 10 repeated lines are dropped, 43 km), cut across every 5 m:
- in the cached 1 m HRDEM (`raw/lidar-pickle-lake.npz`, the 2021
  single-photon survey), smoothed σ 0.7 m and levelled on the ground
  15–25 m either side. The **bench** is the mean height of the 5 m on the
  line less that of 5–9 m either side;
- in the FRI's own 0.5 m canopy model (`_Canopy.tif`, the 48 tiles of the
  core that carry a mapped road). The **gap** is the median height of the
  trees 8–20 m out less that of a 3 m strip;
- each at the offset within ±10 m where it is greatest, then over **100 m
  of line**: 20 cuts at one offset, so the length does the averaging;
- against **controls**: the same lines moved 60 m sideways, each signal
  held to its own controls' 95th percentile (bench 0.31 m, gap 3.3 m).

| MNRF class | km | the bench, lined up | 100 m windows | bench | gap | either |
|---|---|---|---|---|---|---|
| Open, passable | 12.1 | +0.64 m, 7–8 m wide at half height, lows of −0.15 m at 10–13 m | 206 | 73 % | 72 % | **89 %** |
| Restricted, passable | 10.0 | +0.39 m | 137 | 45 % | 28 % | 57 % |
| Restricted, impassable | 1.3 | +0.35 m | 21 | 33 % | 67 % | 81 % |
| Closed, decommissioned 2018–20 (built 2017–18, in the cuts) | 7.9 | weak | 124 | 25 % | 5 % | 30 % |
| Closed, the old "Retired Roads" | 4.9 | none | 90 | 0 % | 33 % | 33 % |
| Closed, built 2023, after the flight | 6.4 | none | 100 | 1 % | 15 % | 16 % |
| Controls | | | 1,391 | 5 % | 5 % | **10 %** |

At 10 m cells (`raw/vegstructure-pickle-lake.npz`, the lowest cell within
±10 m), canopy cover on the line and 60 m off it: open roads 0.01 / 0.73,
restricted 0.50 / 0.69 and 0.51 / 0.80, closed 0.46 / 0.58 with the canopy
as tall on the line as beside it (12.6 / 12.7 m).

What it says [I]:
- **A drivable road here is a raised bench** about 0.6 m high and 7–8 m
  wide with shallow lows either side, under open sky.
- **One cut is not enough.** Hummocks, glacial flutes and scarps put a
  0.72 m "bench" somewhere within ±10 m of one control cut in twenty, and
  a single cut of open road beats that only 30 % of the time. Over 100 m
  the controls fall to 0.31 m. Any detector has to add up evidence along
  the line.
- **The signal fades with closure and age.** Restricted roads stand half
  as high. Roads decommissioned in 2018–20 keep a weak bench (25 %) and,
  lying in the 2017 cuts, have no trees either side to make a gap.
- **The long-retired roads have no bench but leave a canopy line.** In
  the 0.5 m canopy model a third of their windows show a strip 2–3 m lower
  than the trees beside it (about 4 m against 6–7 m). They were built at
  grade, likely winter or bladed operational roads, and grew back with
  shorter trees. With Ontario's mapped roads 51 m off at the 95th
  percentile (Ghanbari et al. 2026), a ±10 m search misses some real
  ones: these shares are a floor.
- **The two signals cover each other's blind spots**: the bench finds
  what runs through cuts, the gap what runs at grade under trees; either
  finds 89 % of the open road.
- **But either one also passes 10 % of the control windows**: a hand rule
  would draw a road every few hundred metres of bush. Precision has to
  come from what a model learns of the shape (width, shoulders, ditches,
  continuity) and from the network a line joins.
- **Roads newer than the flight are not in the LiDAR** (6.4 km of the
  core's closed roads were built in 2023). Every test drops roads built
  after the survey.

**The 1 m HRDEM is enough.** On the same cuts (the 78 tiles whose 0.5 m
provider DEM is cached), the province's 0.5 m DEM and NRCan's 1 m HRDEM
gave the same answer: control p95 0.262 m both; restricted roads 48 and
47 % (passable), 57 and 52 % (impassable) of 100 m windows. For a 7 m
bench the cached `lidar-<id>.npz` is the input; ditches are another
matter (§2.2). [I]

**Other areas, the bench alone** (the same 100 m test on every mapped road
in the core):

| Area (LiDAR) | Class | 100 m over the controls' p95 | control p95 | canopy cover on / off (10 m) |
|---|---|---|---|---|
| Sault test (HRDEM 2022–24) | Open, passable (4.6 km) | 51 % | 0.16 m | 0.35 / 0.67 |
| Whitefish Lake (SPL 2023–24) | Open, passable (5.4 km) | 26 % | 0.25 m | 0.00 / 0.06 (through open cuts) |
| Whitefish Lake | Open, impassable (1.5 km) | 0 % | | 0.61 / 0.83 |
| Lac Bailey (linear-mode, about 2.5 pts/m²; 2023 project flown 2024, 2015–17 in its gaps) | forest class 02 / 03–04 | 58 % / 27–29 % | 0.54 m | 0.00–0.14 / 0.52–0.55 |
| Lac Bailey | 4×4 only (NON) / impassable (IMP) | 29 % / 53 % | | 0.52 / 0.55 (NON) |
| Duhamel (HRDEM 2018–22, hilly hardwood) | class 02 / 04–05 / NON / IMP | 37 % / 13–16 % / 8 % / 6 % | 0.62 m | not read |

So [I]: the bench alone finds a quarter to three quarters of the drivable
roads by area, and the rougher the ground the less a bench stands out of
it (Duhamel). On Lac Bailey's steep burned slopes the cut and fill
outlast the road's use: its abandoned roads read as well as the low-class
drivable ones, though at 10 m their canopy has closed. Where the bench is
weak the gap often is not; where there are no trees there is no gap.

**A hand-made filter is not a detector.** Over 2 km round Gavan's spot,
the band-pass (2.5−10 m, then 1.2−5 m) averaged along 41 m in 12
directions, over the local hummock noise, lights up the NNE–SSW glacial
flutes, ridge crests, the lake shore and star-shaped speckle on the
flats; on the 0.5 m canopy model it draws stars between crowns. No
road-like line stands out of either. [I]

**Gavan's spot (48.91781, −85.58811).** No MNRF road of any status within
1.86 km (the nearest a closed operational road built 2017, decommissioned
2020, to the south-west); no road or trail on the 1979 sheet or Toporama
042C13 (v7.0, 2016) within about a kilometre; the 2010 FRI stands round it
date from 1888–1928 with no cut recorded; the baked imagery (1.57 m) shows
closed crowns, the 0.5 m canopy model of tile 603/5419 crowns and the
creek's marsh, no line. If the road is in any of our data it is in the DTM
alone (Gavan sees it in the DEM-drawn shade). We could not single it out
by eye in scratch renders of the DTM within 1.5 km (the app's DEM shade at
z15–16, band-passed relief, a Hessian ridge filter): the ground carries
NNE–SSW glacial flutes, an east-facing terrace scarp of 1–1.6 m just
north-west of the spot, a creek gully with a levee 600–900 m west, and the
HRDEM keeps rough returns off the lake (the provider's 0.5 m DEM is
flattened). The reference line has to be Gavan's trace, and the first
question for the detector is whether it finds a line there at all. [I]

### 2.2 What the literature has

**The road in section** [G]:
- Ontario, all-weather roads on mineral flats: the surface about 1 m
  above the original ground "if the terrain is favourable", ditches
  keeping water at least 1 m below it, crown about 4 %, fill slopes
  1.5–2:1; roads floated over peat on the root mat, 0.5–1.3 m of fill,
  no ditches where the peat is over 1 m (OMNR 1990, Environmental
  Guidelines for Access Roads and Water Crossings; the 2010 Stand and
  Site Guide). No dimensional standard by road class was found.
- Alberta's caribou-range roads: grade 0–0.5 m; Quebec's class 4–5 roads
  4–7.5 m wide with 20–25 m rights-of-way (RADF).
- Winter roads on frozen ground: "no granular/soil base course and
  running surface, or ditches", "no permanent inert feature" (Gillies &
  Belyea 2017, FPInnovations).
- Skid and forwarder trails: 3.2–5.7 m wide at 18–25 m spacing; ruts
  over 0.2–0.3 m count in Ontario's and Quebec's rules.
- What abandonment leaves on flat ground [I]: mostly the prism, with
  breaks where culverts and crossings were pulled, berms at the
  entrances, slash windrows, landing aprons. On peat, old lines are
  flattened, slightly sunken strips: seismic lines sit 8.4 cm below the
  forest beside them, their microrelief 20 % smoother (Stevenson et al.
  2019) [S]. Expect three signatures at Pickle Lake: a raised bench with
  ditches; a low fill without; a smooth, slightly sunken strip with the
  hummocks gone.
- Regrowth [S]: compaction holds it back; on Quebec roads cover over
  1.3 m reaches about 50 % (wide roads) to 80 % (narrow) only after 20
  years, the centre staying most open (Braham et al. 2023); after 35
  years only 8 % of wide Alberta seismic lines had over half woody cover
  (Lee & Boutin 2006, abstract).

**Methods and results** [S] (P full text, A abstract):

| Study | Ground, data | Method | Result |
|---|---|---|---|
| Sherba et al. 2014 | California, 29° slopes, dense canopy; roads unused since 1952; 0.9 m ground spacing | object-based classification of slope and edges | 86 → 90 % overall, producer's 0.79 → 0.84; producer's 0.42 at 1.9 m spacing, 0.10 at 3.9 m (P) |
| Ferraz et al. 2015/16 | Vosges mountains, 1,425 km², 2–4 ground pts/m² | random forest on slope, roughness, two-scale slope difference; a graph of nodes ≤ 50 m apart | 0.88 found within 5 m, 0.11–0.12 false; "not applicable" on flat terrain (P, the French twin) |
| Salberg et al. 2017 | Norway, 0.5 m | fully convolutional net on slope, official road lines as labels | road pixels 95.3 %; two parallel ditches made a false road (P) |
| Prendes et al. 2019 | steep Spain, 0.5 pts/m² | pixel vs object classification | completeness 0.59–0.65, correctness 0.90–0.93 within 10 m (P) |
| Buján et al. 2021 | Galicia, dirt roads under closed canopy | hybrid decision tree | completeness 0.78 / 0.75 / 0.61 / 0.37 at 8 / 4 / 2 / 1 pts/m² (3 m buffer) (P) |
| Abdi et al. 2022 | Finnish thinnings, ≥ 5 pts/m² | U-Net on surface, canopy or terrain models | trails: surface model IoU 0.87, canopy 0.78, terrain 0.67; in unthinned stands 0.69 / 0.51 (P) |
| Roussel et al. 2022 (ALSroads) | Quebec, > 10,000 km² | least-cost path between the ends of each mapped road over a 7-metric conductivity raster | 95 % within 3 m (A; code read) |
| **Morley et al. 2024** | **boreal Ontario, SPL100 at 42–45 pts/m², 2–4° slopes** | ALSroads tuned for small relief | centrelines within 0.4 m on good roads; "many roads do not have ditches or embankments"; **class 3–4 roads (overgrown, no surface or edges) not relocatable**; 69 % of "status unknown" roads came out class 4 (P) |
| **Ghanbari et al. 2026** | **Ontario SPL, Nipissing and Dryden** | attention residual U-Net on 11 features (hillshade, slope, surface model, roughness, edges, intensity, canopy height, returns 0.5–3 m, ground share, distance to the mapped road) trained on 890 Quebec segments, fused with ALSroads | pixel precision 0.24, recall 0.92; mapped-road error 9.36 → 2.07 m, 66.7 → 87.2 % within 3 m; false positives on clearings and cutlines, misses in fresh cuts (P) |
| McDermid et al. 2025 | Alberta treed fen, 30 pts/m² | attention U-Net on the terrain model alone | trails about 20 cm deep at F1 0.77; hummocks and hollows the main false positives (P) |
| Aihara & Mitsuda 2025 | Japan, 0.5 m | DeepLabv3+ on a curvature-and-slope relief map | F 0.83 within 1 m; the raw elevation, slope and curvature stack F 0.002; flat-land and narrow roads missed (P) |
| Lidberg et al. 2023 | Sweden, 1–2 pts/m², ditches | encoder-decoder on a high-pass median image | recall 0.84–0.86, run nationally (A; code read) |

What it adds up to [I]:
- **The methods are from slopes**, where a road is a bench cut into a
  hillside. Pickle Lake's flats are the hard case, and no paper tests it.
- **Every Canadian tool needs a prior map** (ALSroads, the Forest Line
  Mapper and BERA Tools, Ghanbari's model). They re-place mapped roads
  well; none maps unmapped old roads from scratch. The mapped old roads
  (Plan, step 1) are such a map; Gavan's road is the case none of them
  handles.
- **The input matters more than the network**: a relief rendering beat
  the raw stack by two orders of magnitude (Aihara); surface and canopy
  models beat the terrain model for skid trails (Abdi).
- **Ditches need finer grids**: separable on 0.2–0.25 m models at
  11.7 pts/m², unreliable at 1 m (Waga 2021, dissertation) [S]; the bench
  is fine at 1 m (§2.1).
- Relief renderings to feed a model or a person: the local relief model
  (Hesse 2010; trend radius 5–10 m on flat ground), sky-view factor and
  openness (Zakšek et al. 2011; Doneus 2013; on flat ground the sky-view
  factor "is very sensitive to DEM noise", Kokalj & Hesse 2017), the VAT
  blend with its flat-terrain setting (radius 10 m, skipping the first
  4 m; Kokalj & Somrak 2019), feature-preserving smoothing (Lindsay et al.
  2019: on a 0.5 m Ontario DEM, kernels of 11–21 cells at 10–20° kept
  ditches; a Gaussian above σ 1.3–1.7 cells blurred broader landforms).
  Tools: WhiteboxTools (MIT), rvt-py (Apache-2.0), lidR and ALSroads
  (GPL-3; fine inside the bake, which ships outputs, not code [I]).

**The noise, in numbers** [S]/[I]: hummock-to-hollow relief is about 0.2 m
with most variance at 1–10 m (Moore et al. 2019); in a black-spruce bog
the semivariogram range is 0.9–1.9 m (Graham et al. 2020). That overlaps a
road's 8–16 m cross-section, so smoothing alone cannot part them: a
Gaussian of σ 1–1.5 m keeps 65–85 % of a 7 m bench and removes over 90 %
of 2–3 m texture, but not the 3–10 m part. Adding evidence along 20–50 m
of line gains roughly √(L/ℓ), 3–6× for a correlation length of 1.3–2.5 m:
what §2.1 saw between one cut and 100 m.

### 2.3 The canopy and the point cloud

- **Resolution**: a canopy model at least a fifth of the line's width
  (Queiroz et al. 2020, the Forest Line Mapper) [S]: 1 m for a 5 m road.
  The 10 m vegetation grids cannot resolve one; the FRI serves a 0.5 m
  canopy model per tile (`_Canopy.tif`) and the MRNF a 1 m one.
- **Grading how grown in** [S]: return heights binned <0.3, 0.3–1, 1–5,
  5–10, >10 m per 4 × 5 m segment gave four road states at 73 % (Waga et
  al. 2020, abstract); canopy over 1 m on the line, "impassable for
  automotive vehicles" (Girardin et al. 2022); 3 m, or half the stand
  beside it, "regenerated" (van Rensen et al. 2015). Measured against the
  forest beside the line, from the same flight. [I]
- **Returns** [S]/[G]: ALSroads rewards ground-return density on the road
  and penalises returns at 0.5–3 m. Single-photon LiDAR gives no
  per-return intensity, and its noise at low angles "slightly reduced the
  contrast between road and non-road ground-return densities" (Ghanbari
  et al. 2026); it still put about 28 ground points/m² under trees against
  about 10 for a linear-mode sensor (Brown et al. 2020). Leaf-on SPL ground
  error under vegetation, Ontario FRI: RMSE 11 cm (White et al. 2021,
  abstract). In a treed bog at 4 pts/m², LiDAR ground sat 0.4–0.5 m high:
  shrubs taken for ground (Lovitt et al. 2017).
- **The DTM itself** [G]: the HRDEM is a TIN of ground and water points
  rasterised with no breaklines and small voids filled (NRCan, HRDEM
  product specification 1.7). Where ground returns are sparse its long
  facets make straight edges a line filter likes; ground filters also
  strip road edges (White et al. 2010: re-filtering added 17.5 % ground
  points). [S]/[I]

### 2.4 Lines from pixels [S]

- Skeleton, spurs under 5–15 m cut, lines under 20–25 m dropped (David et
  al. 2009; Prendes et al. 2019; Aihara & Mitsuda 2025).
- Gap bridging by direction and distance alone still left 3.65 gaps a km,
  52 m on average (Rommel 2015, MSc). A least-cost path over the
  probability between endpoints is the robust bridge (ALSroads, the Forest
  Line Mapper, Ghanbari et al.); junctions fail in every pipeline.
- Weak labels: a shift-tolerant loss gave 2.5 times the recall at 0.9
  precision when map lines were often over 5 m off (Mnih & Hinton 2012).
- Measures: completeness, correctness and quality within a buffer (3–5 m
  usual), positional p50 and p95, and a connectivity score (APLS) because
  pixel scores can prefer a broken road to a fat one.

### 2.5 Accuracy on old roads, and what spoils it

| Condition | Result | Source |
|---|---|---|
| abandoned ~60 years, steep, dense canopy | 0.90 overall, producer's 0.84 | Sherba et al. 2014 [S] |
| flat boreal Ontario, overgrown class 3–4 | not relocatable | Morley et al. 2024 [S] |
| old strip roads in unthinned mature stands | IoU 0.69 (surface model) | Abdi et al. 2022 [S] |
| 20 cm trails in treed fen | F1 0.77 | McDermid et al. 2025 [S] |
| narrow game and ATV trails under canopy, 1 m LiDAR | not identifiable | Finnegan et al. 2018 [S] |
| skid trails "without a pronounced cross-section" | "difficult to identify" | White et al. 2010 [S] |

What spoils it [S]: flat ground with no prism (Ferraz; Morley; Aihara);
sparse ground under canopy (Sherba's thinning, Buján's densities);
ground filters and TIN facets; hummocks and windthrow pits and mounds
(McDermid; root-plate pits 28–49 cm, Krišāns et al. 2020); creeks,
thalwegs, cutlines and clearings (Sherba, Ferraz, Ghanbari); parallel
ditches (Salberg); fresh cuts (Ghanbari).

**Expected at Pickle Lake** [I] (completeness / correctness within 5 m,
our reading of the above): maintained gravel roads 0.85–0.95 /
0.75–0.90; old roads whose bed survives 0.60–0.80 / 0.60–0.80; no prism
(winter roads, skid trails, fill removed) 0.20–0.60 / 0.40–0.70, by the
canopy. Quebec's 2.5 pts/m²: 10–25 points lower; ArcticDEM (a surface
model): cleared corridors of 10 m and more only. §2.1's crude filter
already reaches the low end on open roads; the trained model has to win
the rest on precision.

## 3. Roads from imagery

**In short**: imagery dates a road and tells its state; it does not find
an old road under closed crowns, which the LiDAR does. [I]

**National change maps** [G]/[S]:
- The Canadian Landsat change-attribution method has a road class
  (Hermosilla et al. 2015, Remote Sens. Environ. 170:121, snippet). For
  the national run, the road class's producer's accuracy of 0.36 and
  user's of 0.75 (Hermosilla et al. 2016, Int. J. Digital Earth 9:1035)
  were seen only in a search summary. **The published national products
  (NFIS "CA Forest Harvest" and "Wildfire" 1985–2022, C2C change type)
  carry fire and harvest only: no road layer.**
- **CanLaD** v1.1 (1985–2025, CC BY 4.0): "The minimum detectable
  disturbance size is 1.08 hectares (12 pixels), which may limit the
  detection of linear disturbances such as roads" (its readme).
- **Global Forest Change** (Hansen et al. 2013; loss 2001–2024 at about
  30 m, CC BY 4.0; 2025 in Earth Engine) catches new haul roads cut
  through standing forest: round camp the 2024 cut blocks are joined by
  one-pixel loss lines 0.7–1.2 km long, stamped with the year. Roads
  inside blocks merge into them, and older roads are not there. [I]
- **ECCC's disturbance roads**: Landsat drew about 62 % of the linear
  length that SPOT 10 m drew (Environment Canada 2011, appendix 7.2) [G].

**How long a road shows** [S]:
- Tropical Landsat: a median 4 years open, then about 20 years
  revegetating before a road disappears; 5–6 m roads show when the
  contrast is good (Kleinschroth et al. 2015). Sentinel-2 U-Net, Amazon
  roads: recall 0.65, precision 0.71 (Botelho et al. 2022, abstract);
  Sentinel-1 and -2 monthly, new forest openings: F1 0.91, 30 % of them
  old roads reopened (Slagter et al. 2024).
- The boreal heals slower: compaction holds Quebec's road beds open
  (St-Pierre et al. 2021, abstract); the wettest Alberta seismic lines had
  not regrown after 50 years (van Rensen et al. 2015, abstract); roads
  near Wabakimi stayed bare about 30 years after logging (Wildlands League
  2019, an NGO report).
- Dating known Ontario forest roads near Savant Lake from Landsat
  composites, 1974–2019: 80 % right before 1984, 68 % after (Noltie 2023,
  MSc Queen's; snippets only).

**What resolution sees a 4–6 m road** [I]: Landsat only a corridor of
15–30 m or a strong contrast; Sentinel-2 new and open roads, not
overgrown ones; at least 2–3 m pixels to draw one (two pixels across the
feature); the provinces' 16–40 cm photos wherever the crowns leave a gap.
At Gavan's spot the baked imagery shows closed crowns and no line.

**Historical air photos** [G]:
- NRCan's National Air Photo Library: over 6 million photos, some from the
  1920s, over 90 % black and white; scans $25 (300–800 dpi) to $37
  (1,200–2,032 dpi) a frame through EODMS. No licence stated; NRCan's
  terms want written permission for commercial redistribution. Photos
  published before about 1975 may be public domain under s.12: a question
  for counsel.
- Archives of Ontario, the forest inventory prints (RG 1-429-7): about
  946,000 photos, 1946–1999, summer and winter, the province to James
  Bay; copies for "research or private study", other uses by permission.
- Quebec's historical photos are not open; BC's, Alberta's and the
  Yukon's state no open licence. US declassified film (CORONA 1960–72,
  KH-9 1973–80) is public domain; coverage here not checked.
- Orthorectified against our own DTM, film scans land within about 1–4 m
  (USGS Techniques and Methods 11-C11, 2026; Knuth et al. 2023): enough to
  date a LiDAR line, not to draw one.

**Orthophotos** [G]:
- Ontario: the open programmes (SWOOP, SCOOP, DRAPE, COOP, NWOOP,
  2006–2025, 16–50 cm, mostly spring leaf-off) are OGL-Ontario where the
  province owns the rights; **the FRI Term 2 imagery (2018–2027, 20 cm,
  four bands, leaf-on) is OGL-Ontario** and downloads in 5 km tiles
  (camp's is 2.9 GB); FRI Term 1 (2007–2011) is not open. The province's
  imagery service also carries third-party satellite pictures in the far
  north (WorldView, Pléiades), which OGL-Ontario §6(c) does not license.
- Quebec: orthophotos since 1992 and the forest mosaics since 2002–2004,
  20–30 cm, CC BY.
- **Esri World Imagery** (Master Agreement E204, revised 2025-08-01, §§1–3
  read): "Customer may not use Data outside of the Software and Online
  Services to teach or train machine systems…" (§3.3(h)); no use "for the
  purpose of compiling, enhancing, verifying, supplementing, adding to,
  or deleting from compilation of information that is sold, rented,
  published, furnished, or in any manner provided to a third party"
  (§3.3(b)). No training on it, no detector run over it for our layer.

**What imagery adds to the LiDAR detector** [I]:
1. **The year**: the Global Forest Change loss year along a line
   (2001–2025), the harvest year of the blocks it serves (a road is at
   least as old as its blocks: FRI `YRDEP`, CanLaD), the annual reports'
   year, and for older lines a Landsat series sampled along them as
   Noltie did. Free; minutes an area.
2. **Its state now**: bare, brushy or grown in, from the FRI Term 2 near
   infrared and a Sentinel-2 profile across the line, beside the canopy
   model.
3. **Confirmation**: a line seen open in any epoch and joined to the
   network is a road, not an esker, a levee or a flute.
4. **Roads cut since the flight**: Sentinel-2 and Global Forest Change.

Not worth it: Esri, Planet or SPOT (licence and cost), waiting for a
national road-change layer, CanLaD for roads, wall-to-wall orthorectified
film. Historical photos on request only, an epoch at a time, to date a
line.

## 4. The bake step: `build_oldroads.py`

One step, `oldroads`, in `bake_area.plan()` after `vegstructure` and
before `going` and `vector-tiles`: `needs=("hillshade", "vectors")`, the
point cloud optional; skipped with a reason where `bake.lidar` is `none`
or `arcticdem` (a 30 m grid or a stereo surface model has no road bed
under trees). Those areas get the mapped old roads alone (Plan, step 1).

### Inputs

| Input | Where it is | Used for |
|---|---|---|
| 1 m DTM | `pipeline/raw/lidar-<id>.npz` (build_hillshade's cache, EPSG:3979) | bench, ditches, cut and fill |
| 0.5–1 m canopy model | Ontario: the FRI tiles' `_Canopy.tif` (0.5 m, 7.6–12.5 MB a tile); Quebec: the MRNF's 1 m canopy height; else from the point cloud | the gap; how grown in |
| ground returns per m², returns 0.5–3 m | the point cloud, in the vegstructure pass | the trust mask; brush on the line |
| the provinces' roads, every status | new theme `oldroads` and today's `roads` (step 1) | weak labels, `known`, linking |
| water, wetlands, streams | the vectors step's GeoJSON | masks; creek confusions |
| Global Forest Change, CanLaD, FRI depletion years | national rasters (CanLaD is already read by window) | the year |

### Method, in order

1. **Trust mask.** Lakes and ponds out (the waterbody polygons, 3 m
   inward: the HRDEM keeps rough water returns). Cells more than 1–2 m
   from a ground return flagged: TIN facets. Treed bog marked apart for
   its raised ground.
2. **Snap the mapped roads.** Each mapped road, every status, is moved to
   the cheapest path through a road-likeness surface within ±50 m (the
   ALSroads and Ghanbari way; `skimage.graph`'s least-cost paths in
   Python). Kept as labels where the snapped line has a bench or a gap;
   otherwise drawn as `src: map`, unconfirmed, at its mapped place.
3. **Derivatives**, in 2 km blocks with a 64 m rim, each over the local
   hummock noise (the 0.7–2.5 m band's spread over 9 m): band-passed
   relief (σ 1 → 10 m, 2.5 → 10 m, 2.5 → 25 m), a local relief model,
   Hessian ridge and valley strength and direction at σ 0.75–2.5 m, a
   paired-ditch score (two valleys 6–16 m apart flanking a ridge), slope
   and its spread, sky-view factor and openness with the flat-ground
   settings, and the oriented averages of these along 41 m in 12
   directions. From the canopy model: height, height against the 30 m
   neighbourhood, the oriented minimum along 41 m, distance to canopy
   over 1 m; from the points: the ground share and returns 0.5–3 m.
4. **Road probability per pixel.** LightGBM first (the bush model's
   tooling) on the snapped labels (3–5 m half-width, an ignore band to
   15 m), negatives 30 m and more from any mapped road, hard negatives on
   creeks, cut-block edges and beaver dams; trained on the other HD areas
   and on FRI LiDAR tiles across Ontario where the MNRF layers have roads
   (as `bush/plots.py` fetches its squares), each area held out in turn.
   An attention U-Net on rendered relief bands only if LightGBM misses
   the bar (xonix; LANES-MODEL.md's recipe; a shift-tolerant loss).
5. **Lines.** Hysteresis (seeds ≥ 0.6, grown ≥ 0.35), a skeleton, spurs
   under 15 m cut, traced and simplified to 1 m. Ends joined where they
   lie within 50 m, point within 30° of each other, and the cheapest path
   between them over 1 − p keeps a mean p ≥ 0.35. A line under 100 m
   that joins nothing is dropped. (Skeletons and least-cost paths want
   scikit-image, not installed for py 3.14 here yet.)
6. **Scores and attributes**, per line and per 20 m section:
   - `conf` 0–1, calibrated on the held-out area: mean probability,
     length, curvature (no bend under ~15 m radius), trusted share,
     joined to the network, a known road under it;
   - `grown`: open (canopy on the line under 1 m), brushy (1–3 m), young
     trees (3–8 m), grown in (over 8 m, or half the stand beside it);
   - `width_m`, `relief_m` (the bench or the cut), `ditches` (yes/no);
   - `known`: the provincial road under it (id, status, class, years) or
     none;
   - `year`: what a dated disturbance or record puts on it (§3), or none;
   - `src`: `lidar`, `map` or `both`.

### Output

`oldroads-<id>.geojson` (bake only) and a theme `oldroads` in
`places-<id>.pmtiles` (`build_vector_tiles.ARCHIVES["places"]`). Not
merged into `roads`: build_habitat reads every road as pack-out access
and traffic, and build_going sets a road cell's bush to 0.2; a grown-in
skidder road is neither. The coverage report names the source ("from the
2021 LiDAR and the MNRF's non-passable roads").

### In the app

- A dashed line, `oldroads-line`, from z13: its ink by base as the
  contours' (`CONTOUR_INK`: dark on the shade in Terrain, cream over the
  imagery in Hunt), its opacity by `conf`, firmer when open, fainter when
  grown in.
- On the Roads switch, so Terrain and Hunt (and every view with roads)
  show it with no new button.
- The word: **Old road**. A tap: one line in the tap popup, read off the
  drawn layer as `infoPopup.ts` reads the property lines (`landAt`): "Old
  road · from the LiDAR · brushy · not on the province's map".
- Later, not in the first cut: the going grid reads the lines (a smoother
  tread, ROUTES.md), and the moose swing (`hunting/swing.ts`) takes them as
  travel lanes.

### Cost per area

Measured on the pipeline PC over Pickle Lake's core (10,130 × 10,228 cells
of 1 m, 104 M), scipy on one core: loading the cache 3 s; Gaussians at σ
1, 2.5 and 10 m 2.7, 3.5 and 8.8 s; a Hessian at one scale 10.7 s; the
oriented filter in 12 directions 51 s; 80 s in all. [I]
- The whole stack: about 5–10 minutes on one core, a minute or two in 2 km
  blocks across the cores.
- The model over 104 M cells, block by block: minutes for LightGBM,
  seconds for a U-Net on xonix.
- The FRI canopy tiles: about 1 GB for Pickle Lake's 90; 39 of them
  (440 MB) came in 29 s six at a time (curl, 2026-10-18).
- Lines and scores: a minute or two.
- **About 10–20 minutes an HD area** beyond today's bake; 0.2–1 MB of
  GeoJSON, a few hundred KB in `places`. Training once, in hours.

### Validation (fixed before the run)

**The truth.**
- **Gavan's road: his own trace**, not ours (§2.1). The Path button from
  the spot to the creek, ten minutes on the phone, sent the way bush
  labels are, or five to ten pins along it.
- **The MNRF roads, both packages**, over Pickle Lake's core (43 km; the
  region's 200 km if the HRDEM is read over the whole region), snapped
  first (method step 2); roads built after the flight dropped (6.4 km in
  the core). The long-retired ones scored apart.
- **A blind check for precision**: 150 detected lines not on any map,
  drawn at random and stratified by `conf`, each shown as a 300 m chip of
  the relief rendering, the 0.5 m canopy model and the photo, judged road
  / trail / not / can't tell by someone who has not seen the score.

**The hold-out.** Pickle Lake scored by a model that never saw it
(trained on the Sault test, Whitefish Lake and FRI tiles elsewhere in
Ontario); Lac Bailey the same way for the sparse Quebec sensor, its
AQréseau roads (NON and IMP included) as truth.

**Measures.** Completeness, correctness and quality by class within 3 and
5 m (status × passable × FMP class in Ontario; `Cls_CheFor` × `CarRte` in
Quebec); positional p50 and p95; precision from the blind check (the maps
give only a floor, since real unmapped roads count against it); false
lines by ground (bog, upland, glacial flutes); Gavan's road: the share of
his trace within 10 m of a detected line.

**The bar** (Pickle Lake held out):
- Gavan's road: 80 % of his trace within 10 m of lines with `conf` ≥ 0.5,
  in no more than three pieces.
- Completeness within 5 m: ≥ 0.85 on open roads, ≥ 0.70 restricted,
  ≥ 0.40 decommissioned 2018–20; the retired class reported.
- Precision ≥ 0.80 in the blind check at the drawn threshold (on lines:
  Ghanbari's pixels ran at 0.24).
- Positional p50 ≤ 2 m, p95 ≤ 8 m.
- Lac Bailey: completeness ≥ 0.70 on classes 02–04, reported for NON and
  IMP.

If it misses: ship the mapped old roads (step 1) and LiDAR lines only at
`conf` ≥ 0.8, or none.

## Plan

Working days; each step is usable on its own.

1. **The mapped old roads (Ontario half a day; every province 2 days).** A
   theme `oldroads` drawn dashed as "Old road":
   - Ontario: stage `MNRRDSEG_Non_Passable_Roads.zip` beside
     `MNRRDSEG.zip` in `pipeline/raw/stage/lio/` (where the packages are
     staged by hand today). The HD bake's vectors step
     (`build_vectors.py bake`) reads the map service, which serves
     passable roads only, so the `oldroads` theme comes from the package
     through `on_vectors_local.py`'s reader: the non-passable roads and
     the closed passable ones, carrying `STATUS`, `YEAR_DECOMMISSIONED`,
     `BERM_IND`, `ROADBED_DESTROYED_IND`, `WATER_CROSSING_REMOVED_IND`
     and `GENERAL_COMMENTS`.
   - Quebec: `qc_vectors.py` keeps the winter roads (`Cls_CheFor` HI,
     dropped today) and moves `CarRte` IMP and NON and class IN out of
     `roads` into `oldroads`; it reads the RQTT files before
     `AQreseau_WMS` is retired (end of 2026).
   - BC: `bc_vectors.py` swaps the DRA and TRIM for FTEN Road Segment
     Lines (retired ones too), RESULTS road polygons and the BCER
     permits, unless GeoBC grants the DRA; fixes the TRIM codes if TRIM
     stays.
   - Yukon: `yt_vectors.py` keeps the seismic lines and puts the access
     roads, trails and cutlines in `oldroads`, with Vegetation Inventory
     Roads 40k.
   - Alberta: a new `ab_vectors.py` for Clearwater (it has none): Access
     and Facility Roads into `roads`, Cutlines and Trails into
     `oldroads`.
   - `build_vector_tiles.py`: `oldroads` in `ARCHIVES["places"]`;
     `mapStyle.ts`: the layer (In the app).
2. **The canopy at 0.5–1 m (1 day).** `fetch_pointcloud.py` fetches the
   FRI `_Canopy.tif` tiles in parallel; `qc_pointcloud.py` the MRNF canopy
   heights; `build_vegstructure.py` writes ground returns per m² and
   returns 0.5–3 m at 1 m in its pass.
3. **Features, snapping and labels (2–3 days).**
   `pipeline/oldroads/features.py` (§4 step 3, 2 km blocks),
   `pipeline/oldroads/snap.py` (least-cost snapping, step 2),
   `pipeline/oldroads/labels.py` (labels, ignore bands, hard negatives),
   `pipeline/oldroads/plots.py` (FRI tiles across Ontario with roads of
   each class).
4. **The model (1–2 days).** `pipeline/oldroads/train.py`: LightGBM,
   spatial blocks, areas held out; the model committed as the bush
   model's is.
5. **Lines and scores (2 days).** `pipeline/build_oldroads.py`: predict,
   skeleton, link, score, attributes, `oldroads-<id>.geojson`, the coverage
   entry; the `oldroads` step in `bake_area.py`.
6. **Validation (1–2 days, and 15 minutes of Gavan's).**
   `pipeline/oldroads/score.py`; his trace; the blind check.
7. **The app (1 day).** The layer, its tap line (`infoPopup.ts`), the
   coverage words, VIEWS.md's table.
8. **Only if step 6 misses the bar: a U-Net (2–3 days, xonix).**
9. **Later**: the year on each line (§3); the going grid and the moose
   swing reading the lines; asking Laval (Ghanbari, Achim) for their model
   or features.

About two weeks to a scored, drawn first version on Pickle Lake; step 1
alone in a day or two.

## Open questions

For Gavan:
- **His road, traced.** The reference for the whole test.
- **Step 1 first?** The mapped old roads can be on the map this week.
  Their positions are off by up to tens of metres, and the long-retired
  ones may be grown in; draw them faint and say "mapped", or wait for the
  LiDAR to confirm and re-place them?
- **Which switch**: on Roads (Topo, Sat, Hunt, Bush, Scout, Terrain), or
  one of its own on in Terrain and Hunt?
- **Skid trails**: a young cut is laced with forwarder trails, two ruts
  and no bench. Mark them, mark them apart, or leave them out? The first
  cut leaves them out (100 m, a bench or a gap with trees beside it).
- **Grown-in roads**: show a line under 8 m trees? Still a bench to walk
  and a way moose move; not a lane to shoot down.

Found on the way, not this doc's subject:
- **BC's road atlas in a paid pack.** The DRA and TRIM lines in Blanchard
  River's pack are "Access Only" and labelled OGL-BC by
  `bc_common.write`. Replace them (Plan, step 1) or get GeoBC's
  permission before HD is sold there. [G]
- **Esri's terms and the saved sharp imagery.** §3.2(c) of Esri's Master
  Agreement: basemaps go offline "through Esri Content Packages … for use
  with licensed ArcGIS Runtime applications and ArcGIS Desktop. Customer
  may not otherwise scrape, download, or store Data." The app streams
  Esri's photo where an area says `live.sharp: "esri"` (Blanchard River,
  Highland Lake, both Clearwaters) and saves it into its own pack on the
  phone (AREAS.md: "rests on Gavan's call"); in a paid app that reads as
  outside the terms. [G]/[I]
- **Quebec's CC BY and a locked pack** (§1): a legal read.

Not settled by this research:
- Whether old roads are moose routes at Pickle Lake in the rut: the
  science is Quebec's roads in other seasons and the West's seismic
  lines. Hunt-log entries and tracks near detected lines would answer it
  over a season.
- The detector's real accuracy here: §2.1 is a crude filter on mapped
  roads, and the literature's numbers come from other ground.
- Where the canopy test fails: a young stand everywhere leaves no trees
  beside the road to make a gap.
- Not confirmed online: the Hermosilla road-class accuracies and whether
  any unpublished national road-change layer exists; the OGL-Yukon text;
  the NAPL and Archives of Ontario photo licences; the White River
  2018–2028 FMP's road files (NRIP would not render); ABMI's metadata;
  Alberta's own LiDAR terms; an Ontario numeric road standard;
  peer-reviewed ditch-infill rates; pit-and-mound sizes in black spruce;
  the full texts of Roussel et al. 2022/2023, Hesse 2010 and Steger 1998.

## Sources

All read or checked 2026-10-18; the body marks what was read only as an
abstract or a search snippet.

Ontario: MNRF road packages
https://ws.gisetl.lrc.gov.on.ca/fmedatadownload/Packages/fgdb/MNRRDSEG.zip
and https://ws.gisetl.lrc.gov.on.ca/fmedatadownload/Packages/MNRRDSEG_Non_Passable_Roads.zip;
GeoHub item https://www.arcgis.com/sharing/rest/content/items/49199425ea2a4bea9cc74879cf3ef6a0;
data dictionary https://www.publicdocs.mnr.gov.on.ca/mirb/DD%20MNRF%20Road%20Segment,%20MNR%20Road%20Network%20(2026-03-31).docx;
documentation https://www.publicdocs.mnr.gov.on.ca/mirb/MNR%20Road%20Segment%20-%20Documentation.docx;
map service https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open09/MapServer/18;
OGL-Ontario https://www.ontario.ca/page/open-government-licence-ontario;
White River AR/AWS https://services1.arcgis.com/TJH5KDher0W13Kgo/arcgis/rest/services/White_River_2024_AR_3363/FeatureServer;
FIM 2026 https://www.ontario.ca/files/2026-07/mnr-2026-forest-information-manual-en-2026-07-29.pdf;
White River audit 2019 https://files.ontario.ca/mnrf-ifa-5-2019/mnrf-white-river-ifa-final-report-2019-en-2021-05-13.pdf;
ORN capture specifications https://www.publicdocs.mnr.gov.on.ca/mirb/ORN%20Data%20Capture%20Specifications-EN.docx;
FRI orthophotos 2007–11 https://www.arcgis.com/sharing/rest/content/items/2ecc0cc57d1d4d58b5d3540fd0ee2cbd;
FRI Term 2 imagery https://www.arcgis.com/sharing/rest/content/items/bd2c61eb8f94459587ba9f112f67296a;
open imagery https://data.ontario.ca/dataset/open-ontario-imagery;
FRI canopy tiles https://download.fri.mnrf.gov.on.ca/api/api/Download/geohub_compressed_chm/utm16/<tile>_Canopy.tif;
OMNR 1990 https://www.ontario.ca/page/environmental-guidelines-access-roads-and-water-crossings.

Quebec: RQTT guide https://diffusion.mern.gouv.qc.ca/diffusion/RGQ/Vectoriel/Theme/Local/RQTT/Document/Guide_d_utilisation_RQTT.pdf;
AQréseau "Autre route" https://servicescarto.mrnf.gouv.qc.ca/pes/rest/services/Territoire/AQreseau_WMS/MapServer/62;
RATF https://www.donneesquebec.ca/recherche/dataset/rapport-d-activite-technique-et-financier-ratf;
BDTQ https://www.donneesquebec.ca/recherche/dataset/cartes-topographiques-a-l-echelle-de-1-20-000;
licence https://www.donneesquebec.ca/licence/; CC BY 4.0 https://creativecommons.org/licenses/by/4.0/legalcode.en.

British Columbia: DRA https://catalogue.data.gov.bc.ca/dataset/digital-road-atlas-dra-master-partially-attributed-roads;
TRIM https://catalogue.data.gov.bc.ca/dataset/trim-transportation-lines;
FTEN segments https://catalogue.data.gov.bc.ca/dataset/forest-tenure-road-segment-lines;
CEF roads https://catalogue.data.gov.bc.ca/dataset/bc-cumulative-effects-framework-integrated-roads-current;
Access Only https://www2.gov.bc.ca/gov/content?id=1AAACC9C65754E4D89A118B875E0FBDA;
BCER licence https://www.bc-er.ca/files/gis/BCER-Open-Data-Licence.pdf;
TRIM codes https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_basemapping/MapServer/layers?f=json.

Alberta: Cutlines and Trails https://geodiscover.alberta.ca/geoportal/rest/metadata/item/1daaafe0d33048b2a5daa70d7abe0645/xml;
Access and Facility Roads https://geospatial.alberta.ca/titan/rest/services/transportation/access_facility_roads/FeatureServer/0;
OGL–Alberta https://open.alberta.ca/licence; ABMI terms https://abmi.ca/abmi-home/terms-and-conditions.

Yukon: https://open.yukon.ca/api/3/action/package_show?id=surface-disturbance-linear-features;
https://open.yukon.ca/api/3/action/package_show?id=vegetation-inventory-roads-40k.

National: CanVec https://open.canada.ca/data/en/dataset/2dac78ba-8543-48a6-8f07-faeef56f9895;
CanMatrix 042C13 https://ftp.maps.canada.ca/pub/nrcan_rncan/raster/canmatrix2/50k_tif/042/c/canmatrix2_042c13_tif.zip;
ECCC disturbance https://open.canada.ca/data/en/dataset/63e1cda6-debe-4b9b-b075-3666443e30b4;
OGL-Canada https://open.canada.ca/en/open-government-licence-canada;
HRDEM specification https://ftp.maps.canada.ca/pub/elevation/dem_mne/highresolution_hauteresolution/HRDEM_Product_Specification.pdf;
OSM https://www.openstreetmap.org/copyright; ODbL https://opendatacommons.org/licenses/odbl/1-0/.

Imagery: CanLaD readme https://download-telecharger.services.geo.ca/pub/nrcan_rncan/Forests_Foret/canlad_including_insect_defoliation/v1.1/_readme.txt;
Global Forest Change https://storage.googleapis.com/earthenginepartners-hansen/GFC-2024-v1.12/download.html;
NFIS change https://opendata.nfis.org/mapserver/nfis-change_eng.html;
NAPL https://natural-resources.canada.ca/maps-tools-publications/satellite-elevation-air-photos/air-photos-library/national-air-photo-library
and https://natural-resources.canada.ca/maps-tools-publications/satellite-elevation-air-photos/purchasing-aerial-photography;
Archives of Ontario https://www.archives.gov.on.ca/topic/aerial-photographs/;
Esri Master Agreement https://www.esri.com/content/dam/esrisites/en-us/media/legal/ma-full/ma-full.pdf.

Papers (DOI): Ghanbari et al. 2026, ISPRS Arch. XLIX-B1-2026:421, 10.5194/isprs-archives-XLIX-B1-2026-421-2026 ·
Morley et al. 2024, Forestry 97:38, 10.1093/forestry/cpad021 ·
Roussel et al. 2022, JAG 114:103020, 10.1016/j.jag.2022.103020 ·
Sherba et al. 2014, Remote Sens. 6:4043, 10.3390/rs6054043 ·
White et al. 2010, Remote Sens. 2:1120, 10.3390/rs2041120 ·
Ferraz et al. 2016, ISPRS J. 112:23, 10.1016/j.isprsjprs.2015.12.002 (read through its French twin, Rev. Fr. Photogramm. Télédétect. 211–212:103, 2015) ·
Salberg et al. 2017, LNCS 10270:193, 10.1007/978-3-319-59129-2_17 ·
Prendes et al. 2019, iForest 12:366, 10.3832/ifor2989-012 ·
Buján et al. 2021, Remote Sens. 13:393, 10.3390/rs13030393 ·
Abdi et al. 2022, Remote Sens. 14:349, 10.3390/rs14020349 ·
McDermid et al. 2025, Remote Sens. 17:1539, 10.3390/rs17091539 ·
Aihara & Mitsuda 2025, Jpn. J. For. Plann. 59:11, 10.20659/jjfp.A20250102 ·
Lidberg et al. 2023, J. Irrig. Drain. Eng. 149(3), 10.1061/JIDEDH.IRENG-9796 ·
Queiroz et al. 2020, Remote Sens. 12:4176, 10.3390/rs12244176 ·
Waga et al. 2020, For. Sci. 66:501, 10.1093/forsci/fxz053; Waga 2021, Diss. For. 316, 10.14214/df.316 ·
Girardin et al. 2022, Remote Sens. 14:457, 10.3390/rs14030457 ·
Braham et al. 2023, Forests 14:511, 10.3390/f14030511 ·
Mnih & Hinton 2012, ICML, https://icml.cc/2012/papers/318.pdf ·
Moore et al. 2019, Biogeosciences 16:3491, 10.5194/bg-16-3491-2019 ·
Graham et al. 2020, Ecosystems 23:1464, 10.1007/s10021-020-00481-z ·
Lindsay et al. 2019, Remote Sens. 11:1926, 10.3390/rs11161926 ·
Kokalj & Somrak 2019, Remote Sens. 11:747, 10.3390/rs11070747 ·
Zakšek et al. 2011, Remote Sens. 3:398, 10.3390/rs3020398 ·
Doneus 2013, Remote Sens. 5:6427, 10.3390/rs5126427 ·
Hesse 2010, Archaeol. Prospect. 17:67, 10.1002/arp.374 ·
Stevenson et al. 2019, Forests 10:295, 10.3390/f10040295 ·
Brown et al. 2020, Remote Sens. 12:722, 10.3390/rs12040722 ·
White et al. 2021, Remote Sens. Environ. 252:112169, 10.1016/j.rse.2020.112169 ·
Lovitt et al. 2017, Remote Sens. 9:715, 10.3390/rs9070715 ·
Krišāns et al. 2020, Forests 11:1143, 10.3390/f11111143 ·
van Rensen et al. 2015, Biol. Conserv. 184:127, 10.1016/j.biocon.2015.01.020 ·
Lee & Boutin 2006, J. Environ. Manage. 78:240, 10.1016/j.jenvman.2005.03.016 ·
Finnegan et al. 2018, PLoS ONE 13:e0195480, 10.1371/journal.pone.0195480 ·
St-Pierre et al. 2021, For. Ecol. Manage. 482:118846, 10.1016/j.foreco.2020.118846 ·
Hermosilla et al. 2015, Remote Sens. Environ. 170:121, 10.1016/j.rse.2015.09.004 ·
Hansen et al. 2013, Science 342:850, 10.1126/science.1244693 ·
Perbet et al. 2025 (CanLaD), Sci. Data 12:2012, 10.1038/s41597-025-06269-x ·
Kleinschroth et al. 2015, Ecosphere 6(4):art64, 10.1890/ES14-00488.1 ·
Botelho et al. 2022, Remote Sens. 14:3625, 10.3390/rs14153625 ·
Slagter et al. 2024, Remote Sens. Environ. 315:114380, 10.1016/j.rse.2024.114380 ·
Knuth et al. 2023, Remote Sens. Environ. 285:113379, 10.1016/j.rse.2022.113379 ·
DeWitt et al. 2026, USGS T&M 11-C11, 10.3133/tm11C11 ·
Dickie et al. 2020, J. Anim. Ecol. 89:623, 10.1111/1365-2656.13130 ·
Finnegan et al. 2023, Ecosphere 14:e4636, 10.1002/ecs2.4636 ·
Lyon & Burcham 1998, USFS RMRS-RP-3, https://www.fs.usda.gov/rm/pubs/rmrs_rp003.pdf.
Theses and reports: St-Pierre 2021 (moose on Quebec roads); Noltie 2023, Queen's,
https://qspace.library.queensu.ca/items/d2627995-3cce-49ad-ac15-a4d65bfb4d42;
Rommel 2015, Trier; Gillies & Belyea 2017, FPInnovations; Wildlands League 2019.
