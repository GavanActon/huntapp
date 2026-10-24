# US areas: the first one, Luther, Michigan

Status: built 2026-10-23 for a friend of Gavan's hunting Lake County, Michigan
(43.96765, -85.70444, Cadillac Forest Management Unit, deer country). The
area is `luther` (app/src/areas/luther.json, jurisdiction `MI`). This is how a
US area goes through the pipeline that was written for Canada, and what is
still Canadian in it.

## The idea

Every bake step reads the same national rasters by URL (the MRDEM, the 2020
land cover, SCANFI's species, closure, height and age, CanLaD's cuts and
burns) through `stage.source()` (pipeline/stage.py), which hands back a local
copy when one holds the box. So a US area stages US rasters under the
Canadian names, on the Canadian grid (EPSG:3979 at 30 m), and the Canadian
steps run unchanged: rasters.py, ca_forest.py, habitat_lite.py, the bush
model, build_dem.py, the SD wind. Only the terrain's core (the 1 m LiDAR),
the point cloud and the vectors have adapters of their own.

| Layer | Canada | Michigan | Made by |
| --- | --- | --- | --- |
| 30 m DEM (the wide relief, the SD wind, slopes) | MRDEM | USGS 3DEP 1 arc-second tiles, warped to EPSG:3979 at 30 m | `us_terrain.py` wide → stage `mrdem.tif` |
| 1 m DEM (shade, contours, going) | HRDEM LiDAR DTM | USGS 3DEP 1 m DEM tiles (MI Lake 2016), UTM 16N metres | `us_terrain.py` core → `raw/lidar-<id>.npz` |
| Point cloud (bush, lanes) | Ontario FRI leaf-on, Quebec MRNF | USGS 3DEP LAZ tiles (MI_16CountiesFEMA2015, leaf-off April 2016, QL2, classified), in Michigan Central feet: rewritten in UTM metres | `us_pointcloud.py` → `raw/pointcloud/tiles-<id>.json` |
| Land cover | NRCan 2020 (NALCMS legend) | NLCD 2021, recoded to the NALCMS legend (pasture as grass) | `us_stage.py` → stage `landcover.tif` |
| Stands | SCANFI species, closure, height, age; CanLaD cuts and burns | LANDFIRE 2024 EVT (each type read as shares of SCANFI's ten species groups), CC and CH (else EVC/EVH), FDist (fire → burn, mechanical removal → cut, dated by its time-since class); age unknown except where dated | `us_stage.py` → stage `sp_*.tif`, `nfiLandcover`, `closure`, `height`, `age`, `dist_*` |
| Water | LIO, GRHQ, FWA | NHDPlus HR from the basin's GeoPackage (prd-tnm S3, 181 MB for HU4 0406): waterbodies, river areas, network flowlines | `us_vectors.py waterbody watercourse` |
| Wetlands | LIO, Quebec | National Wetlands Inventory (ArcGIS service, asked in eighths: the server 500s past an offset of 2000 and on big answers): forested and shrub → Swamp, emergent → Marsh | `us_vectors.py wetland` |
| Roads | LIO, DRA | Michigan Framework All Roads v17a (Michigan Tech's service) + the DNR's forest roads (forest access routes as trails, ORV words kept) | `us_vectors.py roads` |
| Hunting unit | WMU, Zone, MU | the deer management unit: `wmu-<id>.geojson` OFFICIAL_NAME `DMU 043`, zone label `DMU`; regs.ts has DMU 043 | `us_vectors.py wmu` |
| Public land | parks, Crown | PAD-US fee lands + DNR managed lands as `parks-<id>`; `land-<id>` draws the region outside them as likely private (Michigan has no open parcel layer; owner names are county assessor data) | `us_vectors.py parks land`; build_property.py steps aside for a US state |
| Topo, NTS scans, provincial imagery | Toporama, CanMatrix, LIO/Québec | none: the map streams Esri's topo and sharp imagery (`live.sharp esri`); `bake.nts` is `[]` | bake_area.py skips the steps |
| Forecast | HRDPS continental | the same: HRDPS reaches northern Michigan (HRRR exists if ever wanted) | nothing |
| Place names | NRCan geonames | not wired: the app's Where to and the site's lookup are Canadian; USGS GNIS is the source to add | open |

## Running it

Downloads first, into `pipeline/raw/us3dep/<stage>/` (the area's
`bake.us3dep.stage`, `cadillac` for Luther): the TNM lists (`tnm-*.json`),
`ned1/` (1 arc-second), `dem1m/` (1 m), `lpc/` (LAZ within ~3 km of the spot),
`nlcd/nlcd_<year>_lc.tif` (MRLC WCS clip), `landfire/<job>.tif` (the LANDFIRE
Product Service clip: EVT;EVH;EVC;CC;CH;FDist) with `LF23_EVT_240.csv`, and
`nhd/NHDPLUS_H_<HU4>_HU4_GPKG.zip`. Then:

    py -3.14 pipeline/bake_area.py --new --lat 43.96765 --lon -85.70444 --name Luther --jurisdiction MI --id luther --stage cadillac
    py -3.14 pipeline/us_terrain.py --area luther          # the 30 m stage and the 1 m core
    py -3.14 pipeline/us_stage.py --area luther            # land cover and the stands as the national layers
    py -3.14 pipeline/bake_area.py --area luther           # the ordinary bake: vectors, property, forest, hillshade, dem, …

`bake_area.py --new --jurisdiction MI` writes the files list, the adapters
(`vectors us`, `forest ca.scanfi`, `pointcloud us.3dep`), `bake.lidar us3dep`,
the timezone (America/Detroit), the zone label (DMU) and no NTS sheets.

## What the leaf-off cloud taught (2026-10-24)

The MI Lake 2016 cloud was flown in April with the leaves off. Its canopy
height and ground are good, but the shrub band carries almost no returns
(understory ratio median 0.02 against 0.44 at Whitefish Lake), so the
measured bush came out open everywhere and the lanes made from it drew
nothing. Luther therefore sets `bake.habitatBush: "model"`: the bush step
renders the national bush model's understory and lanes (`bush/render.py
--lanes`, stand scale at 30 m) in the cloud's place, as Clearwater has them,
and the layers table says so. A leaf-off understory measure would need its
own calibration against plots. Expect the same for most US 3DEP projects,
which are flown leaf-off for the terrain.

Also learned: a new area's baked folder must be committed before its first
push. The dev build runs the R2 sync from the commit, and with no data folder
it writes an empty manifest over R2's, which the app reads as nothing built.

## What is still Canadian, and what it costs

- The stands' attribution and vintage words come from the area file
  (`bake.forest.attribution`: "Forest inferred from LANDFIRE and NLCD"); the
  coverage report's terrain words know `us3dep`. The stage's layers are still
  called SCANFI's inside ca_forest.py.
- The habitat rules are boreal Ontario's: red pine plantations, oak and
  northern hardwoods are read through the Hx/Px lead codes, with no oak of
  their own. The lead table in build_habitat.py has no Pr/Pw/oak.
- The surrogate SD wind was trained on MRDEM terrain; the 3DEP DEM is the
  same kind of ground at the same resolution, but no US tile has been
  checked against a tower.
- The app: `provinceAt` says ON for a Michigan link (the area file's
  `jurisdiction` MI overrides it for the area itself); the Explore strip says
  "anywhere in Canada"; the site's and Worker's `inCanada` boxes happen to
  include the northern US; the coverage index (coverage.py) stops at the
  border, so the box card and the layers table read nothing under a US box.
- SD tiles: the lattice is world-wide, but tiles.py's steps and agent.py's
  jurisdiction guess are Canadian; the same staging would feed a US tile bake.
- The land classes have no "public, open" word: public land is simply
  undrawn, as open Crown land is, and everything else in Michigan is drawn
  as likely private.
