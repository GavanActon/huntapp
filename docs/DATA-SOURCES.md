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
