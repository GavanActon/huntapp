# Data sources

Region: **Pickle Lake**, about 12 km around the camp: bbox −85.72 … −85.46 W,
48.86 … 49.0 N, baked to z13; the core (−85.65 … −85.535, 48.895 … 48.967,
about 4 km) is baked to z16. Gavan, 2026-09-25: only the immediate area
around Pickle Lake matters. The camp is on the peninsula on Pickle Lake at 48.9262, −85.5987 (the map link pin, 48.930948,
−85.593408, is ~600 m north-east of it); it sits in **WMU 21B**, **Fisheries Management Zone 7**,
**Forest Management Unit 060 White River Forest** (Nawiinginokiima Forest
Management Corp., FMP 2018–2028), Bear Management Area TR-21B-032, trapline
WA008, Crown Land Use Policy Area G1798 (General Use). NTS sheets 042C13
(camp) and 042C14 (east); 042F to the north. All endpoints below were fetched
successfully on 2026-09-25.

Every Ontario layer comes from ten ArcGIS MapServer services at
`https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open01..10`.
They answer `/query?…&f=geojson&outSR=4326`, page with `resultOffset`
(2 000 or 5 000 per page), send CORS headers, and are Open Government
Licence – Ontario. NRCan services are OGL-Canada, Open-Meteo CC-BY 4.0.

## What the app uses today (live, no pipeline)

| Layer | Source | Endpoint |
| --- | --- | --- |
| Base map | NRCan Canada Base Map (CBMT), cached Web Mercator | `maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps/CBMT_CBCT_GEOM_3857/MapServer/tile/{z}/{y}/{x}` |
| Topographic | NRCan Toporama WMS (CanTopo look) | `maps.geogratis.gc.ca/wms/toporama_en`, layer `hypsography` (contours and spot elevations only; the full `WMS-Toporama` render hides the hillshade), EPSG:3857 |
| Hillshade (30 m) | NRCan MRDEM WMS | `datacube.services.geo.ca/ows/mrdem`, layer `dtm-hillshade` |
| Imagery | Ontario Imagery Web Map Service (OIWMS) | `…/LIO_Imagery/Ontario_Imagery_Web_Map_Service/MapServer/tile/{z}/{y}/{x}` |
| Lake depths | LIO Bathymetry Line (MNR lake surveys) | `LIO_Open01/MapServer/30`, field `DEPTH`. None of the camp lakes have digitised lines (see historic lake sheets below); White Lake to the south does (1972) |
| Camps | LIO Crown Land – MNR Non-Freehold Dispositions | `LIO_Open08/MapServer/33`, `PURPOSE_OF_DISPOSITION LIKE '%Camp%'`. 40 in the region: commercial outpost camps, private recreation camps, cottages |
| WMU | LIO Wildlife Management Unit | `LIO_Open05/MapServer/5`, field `OFFICIAL_NAME` |
| Private land | LIO Patent Land External | `LIO_Open08/MapServer/35` (242 parcels) |
| Parks | LIO Provincial Park Regulated | `LIO_Open03/MapServer/4` |
| Burns | LIO Fire Disturbance Area | `LIO_Open09/MapServer/28`, `FIRE_YEAR` (20 perimeters) |
| Radar | ECCC GeoMet WMS | `geo.weather.gc.ca/geomet`, layer `RADAR_1KM_RRAI` |
| Forecast | Open-Meteo (ECCC HRDPS 2.5 km inside Canada) | `api.open-meteo.com/v1/forecast` |

## What the Spots tab scores (baked 2026-09-25)

`app/public/data/habitat-pickle-lake.hab` (1.8 MB gzipped) is a 30 m
lon/lat grid, 650×519, with 34 bands; `pipeline/build_habitat.py` writes
it and `app/src/spots/habitatGrid.ts` reads the self-describing header.
Inputs, all fetched and on disk:

| Input | Source | Notes |
| --- | --- | --- |
| Elevation | NRCan **MRDEM 30 m DTM** COG `canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif` (EPSG:3979) | Windowed `/vsicurl/` read works with default GDAL settings but took 10 min the first time (this network truncates long range reads; GDAL retries). Cached as `pipeline/raw/mrdem-pickle-lake.npz`. Copernicus DSM reads fail outright. Slope, aspect, TPI, ridge / valley / saddle / bench landform come from it. |
| Land cover | NRCan **2020 Land Cover of Canada** 30 m COG `datacube-prod-data-public.s3.ca-central-1.amazonaws.com/store/land/landcover/landcover-2020-classification.tif` | Fills cover outside FRI polygons and flags cuts made after the 2010 FRI (shrub or barren over a pre-2000 stand → inferred cut, age 11). Cached as `raw/landcover-pickle-lake.npz`. |
| Forest stands | **FRI FIMv2 White River Forest 2010 2D** FGDB (116 MB zip), layer `Polygon_Forest`, 1 359 stands in the region | Read with pyogrio (OpenFileGDB) under Python 3.13; `build_forest.py` writes `forest-pickle-lake.geojson` (5 MB): species composition, origin year, height, crown closure, site class, depletion year and type. The region is mostly black spruce; 42 polygons of the 1999 burn, 9 harvests, 44 brush. |
| Water | OHN Waterbody `LIO_Open01/25` (248: 229 lakes, 10 ponds, 9 rivers), Watercourse `/26` (757), fields `OFFICIAL_NAME_LABEL`, `WATERBODY_TYPE`, `PERMANENCY` | Lake ids, shore distance, stream inlets and outlets, fetch in eight wind directions per lake. |
| Wetlands | LIO Wetland `LIO_Open01/15` (470: 221 swamp, 181 marsh, 62 fen, 4 bog) | 9.8 MB GeoJSON, used only in the bake. |
| Roads | LIO MNRF Road Segment `LIO_Open09/18` (109 in this 12 km box, all passable) | Distance to a road; grouse and access rules. |
| Burns | LIO Fire Disturbance Area `LIO_Open09/28` (1988, 1999 here) | Years since fire. |
| Lake facts | **Aquatic Resource Area** water polygons `LIO_Open07/2` (16 here) | Fish species per lake, max and mean depth, Secchi, thermal regime. Pickle: walleye, pike, whitefish, cisco, perch, max 17.6 m, mean 3.6 m. McGill: max 15.1 m, Secchi 1.8 m. Ketchup: max 12.9 m, mean 2.5 m. Lake trout only in White and Ravine Lakes. No brook trout recorded. The `returnCountOnly` query on this layer errors; a plain query works. |
| Depth | none digitised for the camp lakes | The grid carries an **estimated** depth: distance from shore raised to a power fitted per lake so the mean matches the ARA mean depth and the deepest cell the ARA maximum. Ten lakes have the model; the rest are unknown (255). |

## What the pipeline bakes (offline PMTiles)

| Layer | Source | Notes |
| --- | --- | --- |
| LiDAR hillshade (1 m) | NRCan HRDEM, project **ON-SPL_ON_White_Lake_UTM16_2021-1m** (single-photon LiDAR, Oct 2021), COG. Reads over HTTP need `CPL_VSIL_CURL_CHUNK_SIZE=16 MB` and `GDAL_HTTP_MULTIRANGE=YES` and drop often, so `build_hillshade.py` reads the core once in 1024 px blocks with retries and checkpoints, then renders from memory. Baked as `hillshade-lidar-<region>.pmtiles` (z14–16), drawn above the 30 m MRDEM shade | `https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-lidar/ON-SPL_ON_White_Lake_UTM16_2021-1m-dtm.tif` (EPSG:3979). Neighbours: Greenstone 2018, Hornepayne 2023, Obakamiga Lake 2024. Seamless mosaic: `hrdem-mosaic-1m/7_3-mosaic-1m-dtm.tif` (window-read with `/vsicurl/`). |
| Historical topo | NRCan CanMatrix2 "print ready" scans (042C13 = White Lake, edition 2, 1970s), georeferenced by `georef_sheet.py` (the map face's neatline pinned to the sheet's lat/lon edges; the `50k_tif` zips carry no geotransform) | `ftp.maps.canada.ca/pub/nrcan_rncan/raster/canmatrix2/50k_tif/042/c/canmatrix2_042c13_tif.zip` (17 MB) and `…042c14_tif.zip` (12 MB); also `250k_tif/`. The OCUL historical topo project (1906–1977) has no sheets this far north. |
| Topo (offline) | Toporama WMS pre-rendered, or CanMatrix2 | Toporama 50k GeoTIFFs also exist: `raster/toporama/50k_utm_tif/042/c/toporama_042c13_utm.zip` |
| Forest cover | Ontario FRI Packaged Products v2 (FIMv2), **White River Forest 2010 2D**, FGDB — **downloaded and baked to GeoJSON 2026-09-25, see above** | `https://ws.gisetl.lrc.gov.on.ca/fmedatadownload/Packages/pp_FRI_FIMv2_WhiteRiverForest_2010_2D.zip`. Neighbours: Marathon Block 2008 (Big Pic), Nagagami 390 2014, Magpie 565 2014. FRI Term 2 (2018–2028) for White River is "nearing completion"; check GeoHub before rebuilding. Fallback raster: NRCan 2020 Land Cover 30 m COG. Cut-block age: CanLaD harvest-year raster 1984–2015. |
| Bush roads | LIO MNRF Road Segment | `LIO_Open09/MapServer/18`, 9 427 segments in the region (paged). Fields `ROAD_NAME`, `STATUS`, `PASSABLE_IND`, `GATE_IND`, `BERM_IND`, `YEAR_DECOMMISSIONED`. Also ORN Road Net Element `LIO_Open09/MapServer/0`, Road Barrier `/22`. |
| LiDAR contours (1 m) | Traced by `build_contours.py` from the cached HRDEM grid above: averaged to 2 m, Gaussian-smoothed (σ 1 cell), lakes masked with the LIO waterbody polygons, closed rings under 40 m dropped. Every whole metre is baked as `contours-<region>.pmtiles` (z14–16, ~3 MB) with `elev` and `step` (the coarsest of 10/5/2/1 dividing `elev`); the app keeps `step >= interval`, so 1 / 2 / 5 / 10 m is a setting, not a rebuild. z14 holds 2 m and coarser only | derived from HRDEM |
| Elevation (relief colours) | `build_dem.py`: Mapbox Terrain-RGB heights (0.1 m steps), lossless WebP, one archive `dem-<region>.pmtiles` (z8–16, ~12 MB). LiDAR from the cached HRDEM grid wherever it exists, MRDEM 30 m (cubic up, area-mean down) around it with a 150 m feather at the LiDAR edge; decoded heights within 0.15 m of the LiDAR. The app draws it as the Elevation colours layer (`color-relief`, with the LIO waterbody polygons, `waterbody-<region>.geojson`, as water on top) and, in the Hillshade layer, a multi-directional `hillshade` for the wide view that fades out at z14, where the baked grey 1 m LiDAR shade takes over. That one stays: its crisp 1 m shading shows old skid trails and ditches that the DEM-drawn shade (1.6 m pixels, smoothed light) loses | derived from HRDEM and MRDEM |
| Contours | LIO Contour | `LIO_Open01/MapServer/29`, field `ELEVATION` |
| Water | Ontario Hydro Network | Waterbody `LIO_Open01/25`, Watercourse `/26`, Shoreline `/14`; names `LIO_Open09/36` |
| Tenure & regs | LIO | Unpatented Crown `LIO_Open08/34`, BMA `LIO_Open10/23`, Trapline `LIO_Open10/24`, FMZ `LIO_Open07/14`, CLUPA `LIO_Open06/5`, Conservation Reserve `LIO_Open03/2`, Fishing Access Point `LIO_Open07/15`, Bait Harvest Area `LIO_Open07/3`, Moose survey plot grid `LIO_Open07/35` |
| Trails & rail | LIO | OTN Trail Segment `LIO_Open04/19`, ORWN Track (abandoned rail) `LIO_Open04/18` |
| Historic lake sheets | GeoHub "Historic Bathymetry Maps" | The Bathymetry Index (`LIO_Open01/31`) lists 17 lakes here: **Pickle L. (1978), Ketchup Lake (1978), McGill L. (1979)**, Swillie, Jembi, Bulldozer, Kabossakwa, Olga, Ravine, all transect surveys with scanned sheets and **no digitised contours**. Georeference in QGIS and rasterise or digitise by hand; this is the only depth data for the camp lakes. |
| Basemap | Protomaps OSM extract | `pmtiles extract https://build.protomaps.com/<date>.pmtiles --bbox=-86.3,48.4,-84.9,49.5 --maxzoom=14` |

## Not available as open data

- Ontario Parcel (full cadastre) is not open; patented-land polygons stand in.
- FMP harvest blocks and planned roads are not on the LIO REST services;
  per-plan GIS zips are on NRIP FMP Online (Salesforce, manual download).
- A retired "Recreation Point" dataset exists only as a document.
- Hunting season dates per WMU have no structured feed; the regulations
  summary is HTML on ontario.ca.
- Canoe routes and portages: only OpenStreetMap (`route=canoe`, `portage=*`).
- The old LIO WMS connector URLs on the OSM wiki are dead.

### Vegetation structure from LiDAR (bush thickness)

**Source.** Ontario MNR Forest Resources Inventory leaf-on single-photon
LiDAR (Leica SPL100), project White Lake 2021, flown 18–29 Sep 2021.
- Classified COPC point clouds in 1 km tiles, EPSG:3160 + CGVD2013.
- From the FRI download service: tile index
  `https://download.fri.mnrf.gov.on.ca/api/api/Download/tile-index/FRI_Leaf_On_Tile_Index_GeoPackage/FRI_Leaf_On_Tile_Index_GeoPackage.gpkg`,
  tiles at `.../Download/laz/utm16/<Tilename>.copc.laz` with `_DEM.tif`,
  `_DSM.tif` and `_Canopy.tif` beside them. Open, OGL-Ontario.
- The API refuses Range headers but redirects to a signed blob URL that
  takes them.
- NRCan's point-cloud bucket does not hold this project.
- About 36 returns/m², 2–4× in flight-line overlaps.
- `fetch_pointcloud.py` fetches tiles (resumable, capped by `--max-gb`).
  `build_vegstructure.py` bakes `raw/vegstructure-<region>.npz` (10 m
  grids), `understory-<region>.pmtiles` (z14–16) and, from the same grid,
  `lanes-<region>.pmtiles` for the Bow view (open ground clear, thick bush
  dark; `--lanes` re-renders only that one, in seconds).
- Coverage so far: 34 of the core's 90 tiles (2 km around camp, the eight
  tiles round the rest of Pickle Lake's shore, four check tiles; 9.7 GB).
  The whole core is 26 GB. On a metered link, `fetch_pointcloud.py --band`
  fetches only a shore band or a circle of a tile (its COPC nodes at every
  level, so the points there are complete) at a quarter to a third of the
  tile's bytes; `--list` prints the exact cost first from the tile indexes.

**Method.** Height is the return's z minus the provider's 0.5 m DEM of the
same tile (bilinear).
- Dropped: noise classes 7/18, returns outside −1…45 m, and returns over
  DEM-flattened water, which sit 0.5–1 m above it and would read as shrubs.
- SPL return numbers carry no linear-mode meaning (95 % are "single"), so
  every return counts as an independent interception sample.
- Metrics, per 10 m cell:
  - **Canopy height**: 95th percentile of returns above 2 m (White et al. 2013).
  - **Canopy cover**: share of returns above 2 m.
  - **Understory (bush thickness)**: returns 0.5–3 m ÷ returns 0–3 m. This
    is the normalised relative density, which corrects for occlusion by
    counting only what reached the layer (Campbell et al. 2018; Wing et
    al. 2012). Nodata under 50 returns.
  - **Understory PAD**: the Beer–Lambert inversion of the same gap fraction
    (MacArthur & Horn 1969).
  - Return counts in height bands, so a browse layer (0.5–2 m) needs no
    re-bake.

**Check against the FRI** (medians):

| Stand | Understory |
|---|---|
| Open muskeg | 0.12 |
| Mature closed conifer | 0.38 (height 14.8 m, cover 0.69) |
| Hardwood-leading | 0.59 |
| Alder brush | 0.69 |
| Young stands and cut/blowdown regrowth | 0.71 (the 2007 aspen blowdown 0.77) |
| Cedar lowland | 0.67 |

LiDAR height against FRI stand height: r 0.76 over 84 stands.

**Caveats.**
- Leaf-on in late September: deciduous brush opens up after leaf fall,
  and conifer does not.
- The 0.5–3 m layer includes low live conifer branches, which is what a
  hunter pushes through anyway.
- Five growing seasons since 2021: regrowth is taller, and later cuts
  are not shown.
- Single-photon returns thin out under closed conifer; see `n_reach` in
  the npz.
- 10 m cells: single shrubs are not resolved.

The DTM row above says Oct 2021. The points' GPS times put the flights
at 18–29 Sep.

References: Campbell, Dennison, Hudak, Parham & Butler 2018, RSE
215:330–342 · Wing et al. 2012, RSE 124:730–741 · MacArthur & Horn 1969,
Ecology 50:802–804 · White et al. 2013, CFS FI-X-010 · Irwin et al. 2021,
Remote Sens. Lett. 12(10):1049–1060.
