# SD tiles: the grids for any ground, baked once

SD (docs/AREAS.md, Live, SD and HD) is cut from fixed tiles, not drawn
around a point. Two hunters asking about the same valley then share the same
files, and the cost grows with land, not with users. The first province
planned is northern Ontario, where the habitat model was built.

Code: `pipeline/tiles.py` (the lattice, the bake, the checks),
`pipeline/stage.py` (local copies of the national rasters) and
`pipeline/on_vectors_local.py` (LIO's province-wide packages). Built
2026-10-06; the app does not read tiles yet.

## The lattice

- A tile is 375 × 370 cells of the habitat lattice (0.0004° × 0.00027°,
  anchored at 180° W, 90° N): 0.15° × 0.0999°, about 11 × 11 km at 49° N.
  The id is `t-<i>-<j>`, i counting east from 180° W, j south from 90° N.
  Pickle Lake's camp is in `t-629-411`.
- Every tile's habitat and micro grids line up cell for cell with their
  neighbours', and the going grid (a third of the cell) with its own. Any
  block of tiles stitches into one grid in the format the app already
  reads (`tiles.py stitch`).
- Each tile is baked as a small area of its own, kept out of the app's list
  (`HUNTAPP_AREAS_DIR`, pipeline/raw/tiles/areas/). Its core is the tile and
  its region the tile plus 90 cells each way (about 2.6 km), so the wind
  solve and the distances see the ground around it. The habitat and micro
  grids are cut back to the tile after.

## What an SD tile holds

Only inputs that exist the same way everywhere in the province:

| Input | From |
| --- | --- |
| Terrain | MRDEM 30 m (staged) |
| Stands: species, height, closure, age | SCANFI v2 and CanLaD v1.1, inferred by `ca_forest.py` (staged) |
| Land cover | NRCan 2020 (staged) |
| Water, streams, wetlands | LIO's OHN and wetlands packages |
| Roads (passable), burns | LIO's MNRF road segments and fire packages |

Not in SD: LiDAR, the point cloud's bush and lanes, the FRI, WindNinja,
lake depths (ARA), the display layers. A tile is the three grids:
habitat (36 bands), micro (21: no momentum) and going, about 4 MB.

## Staged inputs

Reading the national COGs over HTTP runs at about 3 MB/s from here, and
LIO's query server drops TLS now and then. Both are fine for one area and
far too slow and flaky for thousands of tiles. So:

- `stage.py fetch --name <n> --box W S E N` copies a box of each of the 18
  national rasters to pipeline/raw/stage/<n>/, on the source's own pixel
  grid. `stage.source(url, box)` hands a bake the local file when one holds
  its box. A window read from the copy gives the same pixels as one from the
  source (checked on height, MRDEM and CanLaD, 2026-10-06). Used by
  rasters.py, ca_forest.py and build_hillshade.py, so every bake in the box
  reads from disk, areas included.
- `on-north` is the managed forest's box (-95.25, 44.2, -75.7, 52.5), the
  39 forest management units' extent plus a margin. It runs as a hidden
  process (pipeline/raw/stage-on-north.log) and resumes where it stopped.
- LIO publishes every theme as one file geodatabase for the province at
  `https://ws.gisetl.lrc.gov.on.ca/fmedatadownload/Packages/fgdb/<CODE>.zip`
  (OGL-Ontario; the old gisapplication host fails its certificate). SD
  needs OHNWBDY, OHNWCRS, WETLAND, MNRRDSEG and FIREDSTB (3.6 GB zipped,
  5 GB unpacked, in pipeline/raw/stage/lio/<CODE>/). `on_vectors_local.py`
  (py -3.13, pyogrio) reads them by the tile's box and writes what
  build_vectors.py writes. Checked on t-629-411: the same features and
  properties as the server's. Roads and burns sit exactly where the
  server's do; the water and wetlands are all 1.2 m off (the server moves
  NAD83 to WGS84 for those), a 25th of a habitat cell. Roads are filtered to `PASSABLE_IND = 'Yes'`,
  as the server serves only those (the package has 518k segments, the
  server 315k).

## The pilot (2026-10-06)

The 3 × 3 block around Pickle Lake, `t-628-410` to `t-630-412`
(-85.80 to -85.35, 48.74 to 49.04), takes in all of Pickle Lake's HD region.

**Time and size.** 4–6 minutes a tile on XEVO, three at a time beside
Sault's WindNinja runners: forest 120–185 s (the stand polygons), habitat
35–60, the core's elevation 30–60, micro 20–50, vectors 30 (local),
rasters 20, going 5–35. The tile files are 3.3–4.5 MB; the working folder a
tile leaves is about 32 MB.

**Seams.** Where a tile's margin covers its neighbour's cells, the two
agree:
- the day wind's direction differs by a median of 0.04° (p95 1.1°), the
  night wind's by 0.6° (p95 2.3°);
- terrain, landform, slope and the drainage speed are identical;
- the distance bands (to a road, to cover, to a big lake's shore) differ
  where the nearest one lies past the margin: p95 about 1.2 km on distRoad.

**SD against HD at Pickle Lake** (`tiles.py compare ... --area pickle-lake`,
cell by cell over the HD region):
- Terrain, water, roads and wetlands are the same inputs: elevation r 1.00,
  water the same on 99.7% of cells, distance to road r 1.00, to wetland
  r 0.94.
- The 10 m wind barely differs. By day, the same solve on SD's roughness
  turns the wind within 0.5° of HD's (median; p90 1.2°). WindNinja's
  momentum solve, HD's day wind, is 1.1–1.9° from SD's (p90 2.5–3.8°). But
  Pickle Lake is gentle ground: the terrain turns the forecast wind only
  1.3–1.6° there (p90 4–5°). On steep ground WindNinja matters more:
  at Highland Lake the two solves differ by 3.2° median and 10° p90.
- **The stands are where SD falls short.** The cover class agrees on 49% of
  cells (53% in the core). SCANFI calls far more conifer (median conifer
  share 81% against the FRI's 40%), mixedwood and open wetland often read
  as dense conifer, and per cell the stand height (r 0.02) and closure
  (r −0.13) are unrelated to HD's, though their medians match. The
  head-height canopy fraction is r 0.5. So the heat map, the tree lines,
  slots and head-height wind in the stands differ more than the 10 m wind
  does.

Not yet tested against wind checks: none have left the phone (a fresh CSV
export from Gavan's phone would do).

**It is SCANFI, not the polygons.** SCANFI's own 30 m pixels, read straight
at each HD cell, do no better than SD's merged stands: height r 0.08 against
the LiDAR in the core and 0.06 against the FRI outside it, closure about 0,
conifer share r 0.36–0.39 and high (82% against 30–60%). Height averaged
over 150, 300 and 600 m blocks is still r ≈ 0. The grids line up: water
agrees on 98.4% of cells, best with no shift. The FRI's stand heights
against the same LiDAR: r 0.76 over 84 stands (DATA-SOURCES.md).

## Stands: the FRI first

The current index of the FRI's FIMv2 packages is the GeoHub map "Forest
Resources Inventory Packaged Products - Version 2", layer
`services9.arcgis.com/a03W7iZ8T3s5vB7p/arcgis/rest/services/FRI_v2_Boundaries/FeatureServer/0`
(its Data_2D field holds each package's link). LIO's "FRI Status" and
"FRI Packaged Product Catalogue" layers stop around 2011 and miss these.

- 2D packages cover 404,000 of the 461,000 km² of management units and
  parks (88%), inventoried 2007–2016 (median 2012), 100–500 MB each
  (Abitibi River 484 MB, Algoma 211, White River 116). OGL-Ontario.
- None for Kenogami (19,800 km²), Whitefeather (11,800), Nipissing
  (11,500, 3D only), Ottawa Valley (8,100) and Romeo Malette (6,300).
- The Far North has three 2016 packages (West, Central, East as a draft),
  about 27,600 km² between them.
- Algoma Forest has a 2013 FIMv2 package, so the Sault area could use the
  FRI after all.

The plan: FRI stands wherever a 2D package covers the tile, with CanLaD's
cuts and burns since the inventory year laid over them (Quebec's adapter
does the same with its later disturbances). SCANFI only in the gaps. The
FRI comes as polygons, so the forest step needs no polygonising: a clip by
the tile's box, as for LIO's packages.

## Northern Ontario

The 39 forest management units cover about 440,000 km² (LIO, 2026-10-06):
about 3,600 tiles. The Far North (about 450,000 km² more) comes after.

- At the pilot's 4–6 minutes and three at a time, XEVO alone would take
  about five days. Both PCs without WindNinja running, or a faster forest
  step, bring that to about a day.
- About 15 GB of tiles. The working folders (about 115 GB at 32 MB a tile)
  must be cleared as each tile finishes.

To do before the run:
1. The forest step: polygonising each tile's stands and rasterising them
   back is half the time. Read SCANFI straight into the habitat grid, and
   make the polygons for the map once per province.
2. Clear each tile's working folder once its grids are out.
3. The distance bands: cap them at the margin, or take the features from the
   whole province.
4. A tile index (which tiles exist, their date and size) for the app.
5. Order: tiles with the most MNRF road per km² first, the 21A/21B, White
   River, Wawa and Sault country before the rest.
6. Runners on both PCs claiming tiles from a shared folder, as the WindNinja
   kit does.

The app's side (a virtual area stitched from the tiles around a point,
national display layers, saving a box offline) is not started.
