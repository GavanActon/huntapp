# Explore: the map anywhere, the grid, and asking for a spot

Status: design 2026-10-07, after Gavan: "let's pivot to building the
generalized NA viewer with the ability to request spots … sectioned into a
grid … a specific view … we lock in spots … within each area we have an
idea of the coverage for data sets, resolutions." The purchase model
(cores, tiers, prices) is deferred until people have bought something;
nothing here depends on it. The request loop itself is in
[SD-HD-PLAN.md](SD-HD-PLAN.md); this is the view in front of it.

## The shape

- **The grid is the lattice.** The SD tile lattice ([TILES.md](TILES.md):
  0.15° × 0.0999°, about 11 km, ids `t-<i>-<j>`, stitching cell for cell)
  is the viewer's grid and the unit of every request. HD is cut on it too:
  the tile is the core, a margin around it the region. Two hunters asking
  about one valley share one set of files; the four named areas become
  legacy blocks.
- **The base streams, nothing is baked.** With signal the map opens
  anywhere in under a second on public tiles. Offline is what a request
  brought down.
- **Coverage is a dataset.** What a tile can have is read off the
  catalogues once (`pipeline/coverage.py`) into one PMTiles, not looked
  up when someone taps.
- **A view of its own.** Explore sits beside Bow, Wind and Topo: the map
  unfenced, the base streaming, the grid on. The hunting views stay clean.
- **Locking in a spot is a pin.** A named pin picks its tile; the tile
  card asks for it. The pin and the "Requested" state live in a stub
  area for the tile until the bake lands, through the runtime area
  registry of the SD/HD plan.

## The base, streamed

| Layer | Source | Notes |
| --- | --- | --- |
| Water, roads, places, land use | Protomaps basemap: one PMTiles for Canada and the US on R2 (`data.groundwind.app`), styled in the app's palette | OSM-derived, ODbL attribution; about 20–40 GB for the two countries, $0.5 a month on R2; the stack the app already runs (PMTiles by range) |
| Relief | AWS Terrarium terrain tiles (30 m everywhere, 10 m in the US), MapLibre hillshade | CORS-open, no key (checked 2026-10-05) |
| Contours | The same tiles through `maplibre-contour`, drawn on the phone | no bake, any interval |
| Weather | open-meteo as now: HRDPS over Canada and the northern US, HRRR and the blend elsewhere | the strip and the forecast cone work anywhere today |
| Ground wind | the forecast's only, until a tile is baked | |
| In Canada | the live services `sources.ts` already serves: the Canada Base Map, Toporama, the MRDEM hillshade, GeoMet radar | |
| In Ontario | LIO's live layers: units, Crown land, camps, parks, burns | |

Until R2 exists, the Canada Base Map and Terrarium alone carry Explore
in Canada; Protomaps comes with the R2 move in the SD/HD plan.

## Coverage, per tile

`pipeline/coverage.py` writes `coverage-ca.pmtiles` (layer `tiles` at
z6–z10, `blocks` of 1° at z2–z6) and the stats. Per tile:

| Field | From | Means |
| --- | --- | --- |
| `prov` | Natural Earth admin-1 | which adapters bake it, which live services stand in |
| `lidar`, `lidarN`, `project` | NRCan's HRDEM STAC, collection hrdem-lidar (923 projects) | 1 m terrain, contours, the going grid: the HD gate, with the year flown |
| `stands` | GeoHub FRI_v2_Boundaries (Ontario, 49 units, 2D packages by year), the écoforestière south of 52° N in Quebec, the VRI in BC, else SCANFI | inventory polygons against a 30 m model: the heat, the tree lines and the head-height wind differ most here (TILES.md) |
| `water` | by province: LIO, GRHQ and AQréseau, FWA and DRA, GeoYukon; else national, not wired | the habitat grid needs water and roads to bake at all |
| `grade` | 1 SD only · 2 HD possible · 3 HD with inventory stands | the colour of the cell |
| `baked` | the app's area files | hd, sd or empty; later the request state from D1: requested, baking, ready |

To add: the point-cloud catalogues (Ontario SPL leaf-on, Quebec MRNF,
USGS 3DEP EPT) for bush and lanes; the US (3DEP's WESM index for LiDAR,
LANDFIRE for stands, NHD and TIGER for water and roads); the request
state, served by the Worker from D1 as a small JSON the view overlays.

What the card says for a tile, from these fields: "1 m LiDAR, flown 2021 ·
FRI 2010 stands · LIO water and roads · HD possible" or "30 m terrain ·
SCANFI stands · SD only". The resolutions are the point: terrain 1 m or
30 m, stands an inventory or a 30 m model, bush a point cloud or the
satellite model, weather at 2.5 km.

### The first run (2026-10-07)

77,034 tiles have their centre in a province or territory (the Natural
Earth 50 m shoreline keeps the coast and a little sea). 900 HRDEM projects
meet the box, 48 of Ontario's 49 units have a 2D package. The lattice walk
takes 47 s, the PMTiles 95 s (15 MB; the GeoJSON 28 MB). Share of tiles:

| prov | tiles | 1 m LiDAR | inventory stands | both |
| --- | --- | --- | --- | --- |
| QC | 13,641 | 39% | 100% (south of 52°, an estimate) | 39% |
| ON | 9,010 | 51% | 47% | 41% |
| BC | 8,787 | 52% | 100% (VRI) | 52% |
| AB | 6,296 | 34% | none wired | 0% |
| SK | 5,972 | 36% | none wired | 0% |
| MB | 6,113 | 18% | none wired | 0% |
| NL | 3,523 | 13% | none wired | 0% |
| NB, NS, PE | 1,025 | 100% | none wired | 0% |
| YT | 4,639 | 5% | none wired | 0% |
| NT, NU | 18,028 | 1% | none | 0% |
| all | 77,034 | 28% | 35% | 18% |

The LiDAR is recent: of the tiles with any, 90% have a project flown in
2017 or later, the busiest years 2019 (3,417 tiles), 2024 (3,495) and
2022 (2,900). So HD is possible on about half the tiles of Ontario,
Quebec and BC and on all of the Maritimes, and SD-only country is the
Prairies, Newfoundland and the north. The Prairies' own inventories
(AVI, SFVI, FLI) are the obvious next adapters.

Caveats: Highland Lake reads as `hd` because its hillshade came from
ArcticDEM, not LiDAR; a project's STAC geometry is its outline, so a tile
at an outline's edge may hold less LiDAR than the index says; Quebec's
inventory extent is a latitude rule, not the map of the inventoried
territory.

## Explore v0 (built 2026-10-07, branch `explore`, worktree C:/dev/huntapp-explore)

Built as a virtual area rather than a new map state: `areas/explore.json`
(`virtual: true`, region the country, nothing baked) rides the switch that
exists, and with no baked files the style already falls back to the live
Canada Base Map, the MRDEM shade and Toporama. What is there:

- `app/src/explore/`: `lattice.ts` (the tile math), `store.ts` (the picked
  cell, the cells asked for, the email, kept on the phone), `coverage.ts`
  (the PMTiles source and three layers, feature state for picked and
  requested), `TileCard.tsx` and `index.ts` (enter, leave, the tap, the
  wind box following the view, Explore's own layers on arrival).
- The view pill: an Explore view that switches the app there, a Back row
  in Explore; `virtual` areas are left out of every list and bundle; the
  home (the forecast profile) is the area Explore was entered from.
- `data/explore/coverage-ca.pmtiles` (15 MB) in the app's data for now;
  R2 later. The Worker's `/api/request` takes `tile` and `kind`; the D1
  table needs the two columns before that is deployed.
- Checked headless on 2026-10-07: the map opens unfenced at z4–18, the
  blocks and cells draw with their colours (the LiDAR's patchiness reads
  at the Manitoba border), a tap on Pickle's north cell gives t-629-410,
  ON, LiDAR 2021 (2 surveys), FRI 2010, LIO, grade 3; no errors.

- Added the same night on Gavan's look at the shots ("hard to see where
  you're looking on just a green screen"): the Canada Base Map's names
  as a live text layer over the grid (`sources.ts` labels), the base less
  desaturated in Explore so water reads, and a Where-to box in the bottom
  bar while no cell is picked: a lake or a town by name through NRCan's
  Canadian Geographical Names service (`geonames.json`, CORS-open, no
  key), or coordinates in any form `map/coords.ts` reads, with Paste and
  Me; a hit eases the map there with the ring. Checked headless: "ketchup
  lake" → Ketchup Lake · lake · Thunder Bay · ON → the map at z11 on it;
  "N 48° 55.57' W 85° 35.92'" → a Go to row.

- 2026-10-08, after a look at the deployed view ("really hard to see … I
  see names but not lakes"): Explore's base from z7 is now the whole
  Toporama sheet (`sources.ts` toposheet, the WMS's `WMS-Toporama`
  layer): blue lakes with shores, creeks, woods, contours, roads, names.
  The quiet geometry base and the names layer carry the zooms below 7.
  The grid's tint is a tenth of what it was so the lakes stay blue, the
  cells are hairlines, the picked cell a dark outline.

### Next: the box you draw, not the cell

Gavan, 2026-10-08: "I might just want to draw a grid and download that
area. Tiles are pretty massive. Sucks when your lake is in the middle of
a line." He is right, and the shot shows it: Pickle Lake sits on the edge
of cell 629-411. So the lattice stays the catalogue and the pipeline's
unit, and the thing a hunter asks for becomes a box they draw:

- A square from the tap, 10 × 10 km by default, dragged to move and
  pulled at the corners to resize, its size in km and the pack's size in
  MB shown as it changes.
- Its coverage is read off the tiles under it: HD possible where every
  tile has 1 m LiDAR, the newest year flown, the stands' source.
- SD for a box: the tiles under it are baked or already there (shared,
  stitching cell for cell), and the pack is cut to the box: the grids
  cropped, the display layers baked for the box.
- HD for a box: the box is the core and the region its margin, exactly
  as Lac Bailey's 10 × 10 km was baked; no lattice line can cut a lake.
- The request carries the box, not a cell id; the Worker stores it and
  the agent bakes it.

Effort: the box on the map about a day, the request and the cropped pack
with the bake agent of SD-HD-PLAN.md. The cell card stays until the box
is in, then goes.

Not yet: the request state from D1 (only this phone's asks show), the
declination in Explore (0), the weather time zone (Toronto's), the US,
Protomaps, the point clouds in the index, stub areas for requested cells.
Merge needs the other sessions out of `areas/index.ts`, `mapStyle.ts`
and `MapView.tsx`: the hunks are small.

## The view

- **Entering Explore** unfences the map: the region follows the view, the
  grids are off, the weather lattice follows the view and is fetched
  again only after a big move, the base layers above stream. Leaving it
  returns to the active area as it was.
- **The grid** draws from z6 as coverage colour (blocks below z6 as a
  heat of "share with LiDAR"), from z9 as cells with a hairline. Grey
  SD only, green HD possible, blue baked SD, gold baked HD, hatched
  requested or baking. The cell under the map's centre or a tap is
  outlined.
- **The tile card** on a tap: the id as a place ("11 km cell near Pickle
  Lake"), the coverage lines above, what is baked, and the actions: Get
  this tile (SD, free) · Get HD here (paid, where `grade` ≥ 2) · Pin a
  spot. A long press drops a pin and opens the same card for its tile.
- **Requested tiles** show hatched with their stage, polled while
  online, and in Locations as "Requested · t-629-411 · in the queue";
  the email link from the loop lands in the tile once it is baked.
- **Coverage inside an area** stays what the Offline sheet's "What's in
  it" already shows, from the bake's coverage report.

## What it takes in the app

| Piece | Where | Effort |
| --- | --- | --- |
| The state with no area: `REGION`, `CORE`, the fence, the weather lattice read from the view (16 files read them today) | config.ts, areas/, weather/windGrid.ts, map/MapView.tsx | 1–2 weeks |
| Base sources for Explore: Canada Base Map + Terrarium hillshade and contours now, Protomaps when R2 is up | sources.ts, mapStyle.ts, a new `explore/` folder for the rest | 2–3 days |
| The coverage index | pipeline/coverage.py (built 2026-10-07) | done, grow it |
| The grid layer, the tile card, the request post with the tile id | explore/, the Worker's `/api/request` (exists; add `tile`) | 3–4 days |
| Tiles as areas: a stub area per requested tile, pins in it, "Requested" in Locations | areas/ registry (SD-HD-PLAN) | 2–3 days |
| US adapters for SD (3DEP DEM, LANDFIRE, NHD, roads) | pipeline | 1–2 weeks |

Other sessions are in `areas/index.ts`, `sources.ts` and `mapStyle.ts`
now (the Blanchard River BC area, the bush model), so the Explore code
goes in a new folder and touches those files last, in small hunks.

## Order

1. The coverage index for Canada and its stats (done 2026-10-07): where
   HD is possible at all, by province and by year flown.
2. Explore v0: the unfenced map on the Canada Base Map and Terrarium,
   the grid from the index, the tile card posting to `/api/request`.
   Email by hand until the bake agent exists.
3. Tiles as areas in the registry; the Requested state from D1.
4. R2 and Protomaps; the US adapters; the point-cloud catalogues.

Rough total: four to five weeks of sessions to a Canada-wide Explore with
requests; the US on top.

## Decisions for Gavan

- A request is one tile, or may be a block: start with one tile.
- The grid only in Explore, or faintly in every view: Explore only.
- The purchase model: after the first buyers, as agreed.
