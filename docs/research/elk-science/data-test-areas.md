# Open data for elk country (US and western Canada) and candidate test areas for Groundwind

Research notes, current to 2026-10-05. Coverage was checked live against the agencies' own index services (USGS 3DEP index, NRCan HRDEM STAC, LidarBC tile index, Ontario FRI lidar tile index, BC WFS, USFS EDW, BLM SMA, state hunt-unit services). Unless a source says otherwise, every "cover %" is the share of a 10 x 10 km box centred on the stated point. The scripts are in the session scratchpad and were not added to the repo.

Method notes that matter for the pipeline:
- A TNM Access API tile hit does not mean the area is covered. For the Elkhorns, TNM returned two MT_Statewide_Phase5_D23 1 m tiles (published 2026-08-13), yet that project covers 0% of the 10 km box. The covering lidar (MT_DNRCphase1_6_2018) has its 1 m DEM "Pending publication". Use the 3DEP index layers for the footprint (layer 18 "1 Meter" and layer 24 "Lidar Point Cloud", which has `ql`, `collect_start/end` and `onemeter_category`). — [USGS 3DEP Elevation Index](https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer); [TNM Access API](https://tnmaccess.nationalmap.gov/api/v1/products)
- The HRDEM STAC item geometry is a bounding box. The real footprint is in each item's `extent` GeoJSON asset. At Bull River BC, the STAC geometry said 100% for the 2016 and 2017 East Kootenay projects, but the real extents cover 25% and 0%. — [NRCan datacube STAC hrdem-lidar](https://datacube.services.geo.ca/stac/api/collections/hrdem-lidar)
- The LidarBC "project extent" layer also overstates coverage (100% everywhere tested). Use its point cloud index (layer 4) or DEM tile indexes (layers 5 and 6) instead. — [LidarBC public index FeatureServer](https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer)

## Q1. US open data for elk country: terrain, vegetation, disturbance, water, roads, land ownership

### Takeaway
Every US layer the pipeline needs exists as free federal data, with lidar of QL2 or better across all the US candidate areas tested. The gaps are vegetation at stand level (LANDFIRE and RAP are 30 m or 10 m pixels, not stand polygons, and USFS stand maps are regional and patchy) and MVUM coverage, which is missing for some forests. LANDFIRE LF 2025 is mid-release, Annual NLCD runs to 2024, MTBS runs to 2024, and WFIGS has the 2025-2026 fires.

### Cited Findings

**Elevation and lidar**
- The 3DEP Elevation Index MapServer exposes query layers for the 1 m DEM footprint (layer 18, with fields project, pub_date, product_link) and the lidar point cloud footprint (layer 24, with workunit, ql, collect_start/end, onemeter_category, dem_gsd_meters, lpc_link). This is the reliable way to check coverage for an area. — [3DEP index layer 18](https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/18), [layer 24](https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/24)
- The TNM Access API returns downloadable 1 m DEM GeoTIFF tiles (10 km tiles, e.g. `USGS_1M_13_x30y444_CO_NorthwestCO_2020_D20.tif`) for `datasets=Digital Elevation Model (DEM) 1 meter`. — [TNM Access API](https://tnmaccess.nationalmap.gov/api/v1/products)
- The seamless 1/3 arc-second (~10 m) DEM is served as 1x1 degree COGs at `prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n41w108/USGS_13_n41w108.tif`, and windowed reads work over HTTP. Verified by reading the relief for all US candidates. — [USGS staged 1/3" COG (example tile)](https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n41w108/USGS_13_n41w108.tif)
- Lidar at the US candidates (index layer 24, 10 km box):
  - CO White River (40.08,-107.30): CO_Central_Western_2016 QL2 (40%) plus CO_NWCO_1_2020 QL2 (69%), together 100%. Both have 1 m DEMs.
  - CO Gunnison (38.62,-106.70): CO_WestCentral_2019 QL2, 100%.
  - MT Gravelly (44.85,-111.92): MT_StatewideP4_6_B22 QL2 2022, 100%, 1 m "Meets".
  - MT Elkhorns (46.33,-111.85): MT_DNRCphase1_6_2018 QL2 (collected 2018-09 to 2019-07), 100%, but the 1 m DEM is "Pending publication".
  - ID Unit 39 (43.85,-115.80): ID_FEMAHQ_2018 QL2 (100%) plus NV_USFSR4_4_D23 QL1 2023 (100%). At 43.92,-115.62 only the 2018 QL2 covers it.
  - WY Greys River (43.10,-110.80): WY_Southwest_1_2020 QL2, 100%.
  - [3DEP index layer 24 query](https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/24)

**Vegetation and disturbance**
- LANDFIRE's current cycle is LF 2025. On the release schedule:
  - R2 (Southwest CONUS) vegetation and fuel: April 2026.
  - R4 (Northwest CONUS) vegetation and fuel: June 2026.
  - R5 (full CONUS and AK disturbance): scheduled September 2026.
  - R6 (Southeast/Central CONUS): scheduled November 2026.
  - Products are 30 m pixels, downloadable through the LF Map Viewer, full-extent downloads, the LF Product Service REST API (lfps.usgs.gov) and WCS/WMS.
  - [LANDFIRE data](https://landfire.gov/data)
- LF 2024 accounts for disturbances through FY2024 and was released in 2025. Its vegetation products were updated only for 2024 disturbances, because LF 2023 had already brought earlier disturbances current using machine learning and 2023 imagery. — [USGS: LANDFIRE 2024 update](https://www.usgs.gov/data/landfire-2024-update)
- Annual NLCD Collection 1.1 (released June 2025) covers CONUS for 1985-2024 at 30 m. It has six products (land cover, change, confidence, fractional impervious, impervious descriptor, spectral change day-of-year) as COGs via EarthExplorer, MRLC, ScienceBase and AWS S3. — [USGS EROS: Annual NLCD 40 years](https://www.usgs.gov/centers/eros/news/annual-nlcd-lengthens-land-cover-record-40-years?page=0)
- Rangeland Analysis Platform (RAP) products:
  - 30 m cover (1986 to present): annual and perennial forbs and grasses, shrubs, trees, bare ground.
  - 10 m cover (2018 to present, western US): adds invasive annual grass, sagebrush, pinyon-juniper and canopy gap.
  - Production / biomass (1986 to present, annual and 16-day).
  - Partitioned NPP.
  - Delivered as COGs, GeoTIFFs, Earth Engine and the rapr package.
  - Terms: "The USDA Agricultural Research Service (ARS) and the U.S. Government have not placed any restriction on its use or reproduction."
  - [RAP products](https://rangelands.app/products/)
- USFS FACTS harvest history is served by EDW_TimberHarvest_01 (layers by decade from 1820-1945 to "2021 - Current", plus "All Years"). Fields include activity_name, treatment_type, fy_completed, date_completed and gis_acres. The national "Timber Harvests" download (gdb 530 MB / shp 978 MB) was last refreshed Oct 2, 2026, as were "Hazardous Fuel Treatment Reduction: Polygon" and "Activity SilvicultureReforestation". — [EDW TimberHarvest MapServer](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TimberHarvest_01/MapServer); [FSGeodata Clearinghouse datasets](https://data.fs.usda.gov/geodata/edw/datasets.php)
- MTBS:
  - The USFS EDW MTBS map service has Burned Area Boundary and Fire Occurrence layers for each year 1984-2024, so 2024 is the latest MTBS year online. — [EDW_MTBS_01 MapServer](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MTBS_01/MapServer)
  - The EDW "MTBS Burn Area Boundary" download (gdb 107 MB) was refreshed Oct 4, 2026. — [FSGeodata datasets](https://data.fs.usda.gov/geodata/edw/datasets.php)
  - The USGS burn severity portal now hosts MTBS (the old mtbs.gov direct download has been folded into it) and lists availability as "1984-2026". — [USGS Burn Severity Portal: MTBS](https://burnseverity.cr.usgs.gov/products/mtbs); [mtbs.gov direct download notice](https://www.mtbs.gov/direct-download)
- NIFC's authoritative WFIGS perimeter services are:
  - [WFIGS Interagency Fire Perimeters](https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer)
  - Current, YearToDate (2026), Certified and Daily variants under the same host. — [ArcGIS Online item search, owner NIFC_Authoritative](https://www.arcgis.com/sharing/rest/search?q=title:%22WFIGS%22%20perimeters&f=json)
- USFS "Final Fire Perimeter" (FirePerimeterFinal) and "Fire Occurrence - Yearly Update" (FIRESTAT ignition points) on EDW were both refreshed Oct 4, 2026. — [FSGeodata datasets](https://data.fs.usda.gov/geodata/edw/datasets.php)
- Montana FWP publishes useful elk layers: Deer and Elk Hunting Districts (2026 and 2027 seasons), Elk Hunting District Portions, Elk Management Units (2023), Elk Distribution in Montana, and Big-Game Habitat Priority Areas. — [MT FWP ADMBND_HD_DEERELKLION](https://services3.arcgis.com/Cdxz8r11hT0MGzg1/arcgis/rest/services/ADMBND_HD_DEERELKLION/FeatureServer); [ArcGIS Online owner:MtFishWildlifeParks](https://www.arcgis.com/sharing/rest/search?q=owner:MtFishWildlifeParks%20elk&f=json)

**Water**
- The 3D Hydrography Program (3DHP) replaces NHD, WBD and NHDPlus HR with one lidar-derived product. Complete national coverage is expected in 2032. NHD and NHDPlus HR remain the "bridge datasets" until then. From January 28, 2025 the 3DHP database was first populated with NHD features mapped to the new model. — [USGS 3DHP about](https://www.usgs.gov/3d-hydrography-program/about)
- NWI wetlands can be queried by area from the USFWS Wetlands MapServer layer 0. Polygon counts at the candidates (10 km box): CO White River 821, CO Gunnison 348, MT Gravelly 507, MT Elkhorns 355, ID Unit 39 (43.85,-115.80) 81 and (43.92,-115.62) 29, WY Greys River 320. — [USFWS Wetlands MapServer](https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0)

**Land ownership and access**
- PAD-US 4.1 is the latest release. It is distributed as a national or per-state geodatabase, plus CSV and raster versions. Citation: USGS GAP 2024, https://doi.org/10.5066/P96WBCHS. — [PAD-US data download](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-download); [ScienceBase PAD-US 4.1](https://www.sciencebase.gov/catalog/item/6759abcfd34edfeb8710a004)
- The BLM national Surface Management Agency layer (MapServer layer 1, fields ADMIN_AGENCY_CODE and ADMIN_UNIT_NAME) can be queried by area. It returned USFS for all US candidates, with private inholdings of 0-12% except ID 43.85,-115.80, which came out 48% USFS, 27% private and 23% state. — [BLM_Natl_SMA_LimitedScale layer 1](https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/1)
- USFS "Surface Ownership Parcels" (gdb 69-78 MB) was refreshed Oct 4, 2026. One version is described as a PAD-US staging dataset. — [FSGeodata datasets](https://data.fs.usda.gov/geodata/edw/datasets.php)

**Roads and trails**
- USFS national downloads, all on the clearinghouse:
  - National Forest System Roads (gdb 239 MB), refreshed Oct 4, 2026.
  - National Forest System Trails (gdb 119 MB), refreshed Oct 4, 2026.
  - Motor Vehicle Use Map: Roads (gdb 118 MB, refreshed Oct 1, 2026), which gives the vehicle classes allowed and the seasons of use. Only SYMBOL values 1, 2, 3, 4, 11 and 12 are FS system roads.
  - [FSGeodata datasets](https://data.fs.usda.gov/geodata/edw/datasets.php)
- MVUM roads and trails are queryable from EDW_MVUM_02 (layers 1 and 2). They returned 0 features at both Gravelly points (Beaverhead-Deerlodge NF), but 12-41 road features at the CO, ID, WY and Elkhorn points. — [EDW_MVUM_02 MapServer](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer)
- OpenStreetMap data is licensed under the Open Database License (ODbL). — [OSM copyright](https://www.openstreetmap.org/copyright)

**Hunt units (for labelling areas)**
- Colorado: CPW GMU Boundary (Big Game) is layer 6 (fields GMUID, ELKDAU) and Elk DAU is layer 23 of CPWAdminData. — [CPWAdminData FeatureServer](https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer)
- Idaho: IDFG Game Management Units (fields NAME, Elk_Zone, and links to the zone pages). — [IDFG GameManagementUnits](https://services.arcgis.com/FjJI5xHF2dUPVrgK/arcgis/rest/services/GameManagementUnits/FeatureServer/0)
- Wyoming: WGFD ElkHuntAreas (fields HUNTAREA, HERDUNIT, HERDNAME, HUNTNAME) and ElkHerdUnits. — [WGFD ElkHuntAreas](https://services6.arcgis.com/cWzdqIyxbijuhPLw/arcgis/rest/services/ElkHuntAreas/FeatureServer/0)

### Inferences
- For a US bake, the stand layer has to be built from pixels: LANDFIRE EVT/EVC/EVH for type, cover and height; RAP 10 m for open ground and shrub; FACTS harvest polygons with fy_completed for cut year; MTBS (to 2024) plus WFIGS (2025-2026) for burns with year; Annual NLCD as a cross-check. This is close to the Canadian SCANFI + CanLaD approach the pipeline already uses.
- The 1 m DEM is published for every recommended US area except the Elkhorns. There, the pipeline's point-cloud path would have to grid the 2018-19 QL2 LAZ itself, as fetch_pointcloud.py already does for Ontario.
- US federal works (3DEP, LANDFIRE, NLCD, NHD/3DHP, NWI, PAD-US, MTBS, FACTS, USFS roads) are normally free of copyright under US law. That is an inference to confirm per dataset, not something checked here.
- LANDFIRE LF 2025 vegetation may already be out for the western candidates if they sit in the SW or NW GeoAreas. Confirm the GeoArea before choosing LF 2024 or LF 2025.

### Gaps
- USFS regional stand maps (R1 VMap for MT and northern ID, R2 vegetation for CO and WY, R4 for southern ID and WY) were not found on the national clearinghouse listing; only Region 5 "Existing Vegetation" appeared. Their availability and vintage were not checked.
- FSVeg tabular stand exams (FSVeg Spatial) appear to need agency access. This could not be confirmed.
- The latest PAD-US could be newer than 4.1 by October 2026. The USGS download page still names 4.1.
- Rights on the state hunt-unit services (CPW, IDFG, FWP, WGFD) were not checked.
- MTBS 2025 fires are not yet on the EDW MTBS service. Whether the burn severity portal has 2025 data could not be confirmed.

## Q2. Western Canada and Ontario open data: BC, Alberta, Saskatchewan/Manitoba, national

### Takeaway
BC is the richest open-data province for elk: open lidar (LidarBC, OGL-BC, several epochs in the East Kootenay), VRI 2025, RESULTS, fire perimeters, Freshwater Atlas and parcel ownership. Its consolidated cutblocks, Digital Road Atlas and forest-tenure roads, however, are "Access Only", which means no reproduction without permission. Alberta's Crown AVI is now open (OGL-Alberta), but its high-resolution provincial lidar is commercial (AltaLIS / Airborne Imaging / Hexagon), and HRDEM has no lidar at the Eastern Slopes points tested. National SCANFI v2, CanLaD (to 2025) and NBAC (1972-2025) fill the forest and burn layers anywhere.

### Cited Findings

**National (NRCan, OGL-Canada)**
- HRDEM is lidar-derived in the south (1 m or 2 m) and satellite-derived in the north (2 m). Its licence is the Open Government Licence - Canada. It is available by direct download and through a STAC API. — [HRDEM on open.canada.ca](https://open.canada.ca/data/en/dataset/957782bf-847c-4644-a757-e383c0057995)
- The NRCan datacube STAC has collections hrdem-lidar (per lidar project), hrdem-mosaic-1m, hrdem-mosaic-2m and mrdem-30. Each hrdem-lidar item carries dtm, dsm, extent, coverage and VRT assets on `canelevation-dem.s3.ca-central-1.amazonaws.com`. — [STAC collections](https://datacube.services.geo.ca/stac/api/collections)
- MRDEM-30 (30 m national) is one COG, read directly for this work. — [mrdem-30-dtm.tif](https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif)
- SCANFI v2:
  - 30 m rasters for 1985-2025, carrying NFI land cover, height, total crown closure, biomass and per-species crown closure. The species layers are balsam fir, black spruce, broadleaf, Douglas-fir, jack pine, lodgepole pine, other conifer, ponderosa pine, tamarack, and white and red pine.
  - New in v2: a forest stand age layer (`SCANFI_age_median_XXXX`) built from CanLaD 2 disturbance history plus NFI-based age.
  - Files are dated 20260119. Citation: Guindon et al. 2026, https://doi.org/10.23687/07653869-f303-46c2-a04e-9ab479b73cbf.
  - [SCANFI v2 readme](https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/SCANFI/v2/_SCANFI_v2_read_me.txt)
  - The v2 update report (January 2026) describes the maps as 5-year intervals from 1985 to 2025. — [SCANFI v2 update report](https://www.download-telecharger.services.geo.ca/pub/nrcan_rncan/Forests_Foret/SCANFI/v2/___SCANFI%20v2%20%E2%80%93%20EN%20-%20Update%20report.pdf)
- SCANFI is licensed under the Open Government Licence - Canada. — [SCANFI record](https://open.canada.ca/data/en/dataset/18e6a919-53fd-41ce-b4e2-44a9707c52dc)
- CanLaD "including insect defoliation" v1.1 has a "Latest_filtered_CAN_20260508" folder with the latest-disturbance rasters for 1985-2025, plus a time-series folder. The pipeline already reads `canlad_1985_2025_latest_{layer}_v1_1_20260508.tif`. — [CanLaD v1.1 folder](https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/canlad_including_insect_defoliation/v1.1/); C:\dev\huntapp\pipeline\ca_forest.py
- NBAC has annual polygon zips for each year to 2025 (NBAC_2019 ... NBAC_2025, dated 20260513), plus 30 m and 250 m "most recent burn" rasters covering 1972-2025 and summary stats. — [CWFIS NBAC downloads](https://cwfis.cfs.nrcan.gc.ca/downloads/nbac/)

**British Columbia (BC Data Catalogue)**
- LidarBC releases provincial lidar as Open Data under the Open Government Licence - British Columbia. About 86,000 km² was mapped at the time of the source (the date of that figure was not confirmed). — [LidarBC (gov.bc.ca)](https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/lidarbc)
- The "LiDAR" catalogue record is OGL-BC. The portal app record itself is labelled "Access Only". — [BC catalogue: LiDAR](https://catalogue.data.gov.bc.ca/dataset/lidar); [LidarBC portal record](https://catalogue.data.gov.bc.ca/dataset/lidarbc-open-lidar-data-portal)
- The LidarBC index service has a project extent layer, DSM indexes at 1:2,500, 1:10,000 and 1:20,000, a point cloud index (year, density, s3Url) and DEM indexes at 1:2,500 and 1:20,000. Measured at the East Kootenay candidates:
  - Bull River: point cloud 100% (2016 at 6 pts/m², 2022 and 2024 at 8 pts/m²); 1 m DEM 1:20k tiles 2016 and 2022; 1:2,500 1 m DEM tiles 2024 cover 95%.
  - Elk Valley: point cloud 100% (2016, 2022).
  - Premier Ridge: 95% (2015, 2016, 2018).
  - Grasmere: 82% (2016, 2024).
  - Flathead: 76% (2016).
  - [LidarBC index](https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer)
- HRDEM holds only part of this lidar. Real-extent coverage was 46% at Bull River, 24% at Grasmere, 73% at the Elk Valley, 38% at the Flathead and 42% at Premier Ridge. In the East Kootenay, LidarBC rather than HRDEM is the lidar source. — [HRDEM STAC hrdem-lidar](https://datacube.services.geo.ca/stac/api/collections/hrdem-lidar/items)
- VRI 2025 Forest Vegetation Composite Rank 1 Layer: OGL-BC, modified 2026-05-27. There are 763-1,668 VRI polygons per 10 km candidate box. — [BC catalogue: VRI 2025 R1](https://catalogue.data.gov.bc.ca/dataset/vri-2025-forest-vegetation-composite-rank-1-layer-r1-)
- Harvested Areas of BC (Consolidated Cutblocks) is labelled "Access Only". It combines RESULTS, VRI and satellite change detection and includes estimated harvest dates on all ownerships. There is a full-province download (Cut_Block_all_BC.zip) and a documentation PDF revised 2026. Cutblocks per candidate box: Bull River 150 (1965-2022), Grasmere 113 (1964-2024), Elk Valley 110 (1977-2025), Premier Ridge 98, Flathead 20. — [BC catalogue: consolidated cutblocks](https://catalogue.data.gov.bc.ca/dataset/harvested-areas-of-bc-consolidated-cutblocks-); [BC WFS](https://openmaps.gov.bc.ca/geo/pub/wfs)
- RESULTS - Openings svw is OGL-BC and was updated 2026-10-05. — [BC catalogue: RESULTS openings](https://catalogue.data.gov.bc.ca/dataset/results-openings-svw)
- BC Wildfire Fire Perimeters, both Historical and Current, are OGL-BC (updated 2026-10-01 and 2026-10-05). Recent fire years by box: Bull River 2008, 2021, 2022; Grasmere 2013-2015; Premier Ridge 2000-2023; Elk Valley 1991, 2019. — [BC catalogue: historical perimeters](https://catalogue.data.gov.bc.ca/dataset/bc-wildfire-fire-perimeters-historical); [current](https://catalogue.data.gov.bc.ca/dataset/bc-wildfire-fire-perimeters-current)
- Digital Road Atlas (DRA) Master Partially-Attributed Roads is "Access Only". It is updated monthly, with a full-province gdb of 258 MB. — [BC catalogue: DRA](https://catalogue.data.gov.bc.ca/dataset/digital-road-atlas-dra-master-partially-attributed-roads)
- Forest Tenure Road Section Lines (FTEN) is "Access Only". — [BC catalogue: FTEN road sections](https://catalogue.data.gov.bc.ca/dataset/forest-tenure-road-section-lines)
- Freshwater Atlas Stream Network, Wildlife Management Units and ParcelMap BC Parcel Fabric (with OWNER_TYPE) are all OGL-BC. — [FWA streams](https://catalogue.data.gov.bc.ca/dataset/freshwater-atlas-stream-network); [WMUs](https://catalogue.data.gov.bc.ca/dataset/wildlife-management-units); [ParcelMap BC](https://catalogue.data.gov.bc.ca/dataset/parcelmap-bc-parcel-fabric)
- On the BC government copyright page, data that is not under a licence agreement is "'access only' and reproduction is not permitted without written permission". — [BC copyright / Access Only](https://www2.gov.bc.ca/gov/content?id=1AAACC9C65754E4D89A118B875E0FBDA)
- The BC catalogue also lists elk-specific layers: Elk (Cervus elaphus) Telemetry Locations Database, Population Exchange Routes, Populations 1:250,000, and a 1998 aerial survey. — [BC catalogue elk search](https://catalogue.data.gov.bc.ca/dataset/elk-cervus-elaphus-telemetry-locations-database)

**Alberta**
- Alberta Vegetation Inventory (AVI) Crown is under the Open Government Licence - Alberta. It is a single consolidated feature class, a ~550 MB file geodatabase zip on the GoA extranet FTP (`extranet.gov.ab.ca/srd/geodiscover/srd_pub/biota/AlbertaVegetationInventoryCrown.zip`). Air photo vintages run 1987-2019 (field PHOTO_YR), and there is an added LID_UND field for lidar-detected understorey. — [open.alberta.ca: AVI Crown](https://open.alberta.ca/opendata/gda-3dbcfa02-e97a-4059-9414-1ed8e0700e80); [GeoDiscover metadata](https://geodiscover.alberta.ca/geoportal/rest/metadata/item/100b275712b442acbda4a0358d8a4951/html)
- AVI Crown Post-Inventory Harvest Areas (OGL-AB) maps areas harvested after the inventory date, for Crown-managed FMUs. Derived Ecosite Phase v2.0 (OGL-AB) covers where AVI and lidar both exist. — [AVI post-inventory harvest](https://open.alberta.ca/opendata/gda-f660e31d-ddce-4277-9cd5-2c110b99b1f5); [Derived Ecosite Phase v2.0](https://open.alberta.ca/opendata/gda-ae37f83c-c994-47a9-b2f0-39ba1da0e64c)
- AltaLIS lidar products:
  - LiDAR15 DEM and LiDAR 7.5 DEM, both resampled from 1 m lidar and "sold by the township".
  - Airborne Imaging 1 m bare-earth custom area deliveries.
  - Hexagon's 2 m lidar library (vintages 2003-2011, over 400,000 km² of BC, AB and SK) through the HxDR store.
  - Only the Provincial DEM series (25 m and 100 m raster and hillshade, from 1:60,000 air photos of 1980-1995, vertical accuracy 5-10 m) carries an "Open Data License".
  - [AltaLIS Product Catalogue, April 2025](https://www.altalisdata.com/hubfs/2025/Product%20Catalogue%20PDFs%20(April%202025)/Altalis%20Product%20Catalogue%20-%20Digital%20Version.pdf?hsLang=en)
- The Alberta Provincial DEM is available from AltaLIS under the Province's Open Government Licence. — [open.alberta.ca: Provincial DEM](https://open.alberta.ca/opendata/gda-c16469a2-5541-455c-bba0-63a24c0ff08a)
- ABMI open lidar: about 5,600 km² was released free in 2024, with a further 38,000 km² due through 2024-2025. The announcement is dated April 4, 2024. The additional area is described as lying "along the eastern border of Alberta", so it is not the Eastern Slopes. — [CCLM portal: ABMI lidar](https://www.cclmportal.ca/portal/land-management/news/abmi-lidar-data-be-made-available-public); search summary of [biodiversitypathways.ca](https://biodiversitypathways.ca/open-lidar-data/)
- HRDEM has no lidar project at Porcupine Hills (49.90,-114.10) or Ya Ha Tinda (51.73,-115.55), and only 2% at Castle (49.35,-114.35), which spills over from a BC project. — [HRDEM STAC hrdem-lidar](https://datacube.services.geo.ca/stac/api/collections/hrdem-lidar/items)
- Alberta's open "Historical wildfire data: 2006 to 2025" (OGL-AB) is a CSV of fire records (cause, size, lat/lon), not perimeters. — [open.alberta.ca: wildfire data](https://open.alberta.ca/opendata/wildfire-data)
- The Public Land Use Zone "designated trails and roads" datasets for Porcupine Hills, Ghost and McLean Creek are OGL-AB (modified 2026-06-12). — [Porcupine Hills PLUZ trails](https://open.alberta.ca/opendata/porcupine-hills-public-land-use-zone-georeferenced-maps)
- Alberta publishes WMU aerial ungulate survey reports (e.g. WMU 305, 306 and 308 for 2025) and annual elk allocations (2026 PDF), all under OGL-AB. — [WMU 305 survey 2025](https://open.alberta.ca/opendata/wmu-305-aerial-ungulate-survey-2025); [Elk allocations](https://open.alberta.ca/opendata/elk-allocations-hunting-season)

**Saskatchewan and Manitoba (partial)**
- HRDEM lidar projects intersect Riding Mountain, MB (NRCAN-FHIMP_PICAI_MB_SouthWest_Manitoba_2024, PC-Riding_Mountain_2020, MB-Whitemud, MB-Assiniboine_River_West_2008). Only MB-Swan_Lake_watershed (2021) touches the Duck Mountain / Porcupine Hills box. These shares come from STAC item geometry, which can overstate, so they were not confirmed against real extents. — [HRDEM STAC](https://datacube.services.geo.ca/stac/api/collections/hrdem-lidar/items)

**Ontario (for the Bancroft test)**
- HRDEM real extents at WMU 57 east (45.25,-77.62): ON-SPL_ON_Highlands_East_UTM17_2023 (71%) plus ON-SPL_ON_Renfrew_UTM18_2022 (46%), together 100%. At 45.20,-77.80 the Highlands East 2023 project alone covers 100%. — [HRDEM STAC](https://datacube.services.geo.ca/stac/api/collections/hrdem-lidar/items)
- Ontario's FRI leaf-on lidar tile index (the source fetch_pointcloud.py already uses) has 139 one-km 2023 tiles at 45.25,-77.62 and 122 at 45.20,-77.80. Each offers LAZ, DEM, DSM, CHM and HAG downloads. — [Ontario FRI leaf-on tile index](https://download.fri.mnrf.gov.on.ca/api/api/Download/tile-index/FRI_Leaf_On_Tile_Index_GeoPackage/FRI_Leaf_On_Tile_Index_GeoPackage.gpkg)

### Inferences
- The East Kootenay is the cleanest Canadian elk bake: LidarBC point clouds plus SCANFI v2 and CanLaD, which the pipeline already supports, or VRI 2025 for real stand polygons. RESULTS openings, VRI harvest dates and CanLaD can stand in for the Access Only consolidated cutblocks. OSM can stand in for DRA and FTEN roads unless permission is obtained.
- Most of Alberta's Eastern Slopes forest sits in Crown-managed FMUs (e.g. C5 for the Porcupine Hills and Castle area), so AVI Crown likely covers them. Company FMA areas, such as parts of the Bighorn and foothills, may not be in "AVI Crown". This is not verified.
- An Alberta Eastern Slopes area today would run on MRDEM-30 or the 25 m provincial DEM, which is too coarse for Groundwind's head-height wind work. Alberta is a poor first elk bake unless lidar is licensed.
- fetch_pointcloud.py hard-codes `utm16` tile paths. Bancroft tiles are zone 17 (tile names start `1kmZ17`), so the path template needs a zone parameter.

### Gaps
- The licence of the NBAC download, and of BC's VRI attribute vintages by area, were not individually checked. NBAC is presumed OGL-Canada.
- No open Alberta wildfire perimeter polygon dataset was found on open.alberta.ca; NBAC covers Alberta nationally.
- The authoritative Alberta WMU boundary dataset was not located. The unit lookups used a third-party ArcGIS Online copy ([CRS_LCC_WMUs](https://services8.arcgis.com/YDfsDuqxD6YlLAbi/arcgis/rest/services/CRS_LCC_WMUs/FeatureServer)).
- Saskatchewan and Manitoba provincial forest inventories, lidar portals and road layers were not researched (search budget ran out).
- The ~86,000 km² LidarBC figure is from an undated government page; current total coverage is not confirmed.

## Q3. Candidate test areas (centre, unit, why, relief, lidar check, vegetation, access, elk numbers)

### Takeaway
Recommended first bakes, in order:
1. CO White River NF, GMU 24 (DAU E-6, the largest elk DAU in Colorado).
2. BC East Kootenay, Bull River/Wardner, MU 4-22.
3. ID Boise NF, Unit 39 (Boise River zone).
4. MT Gravelly Range, HD 323 (or the Elkhorns, HD 380, if beetle-kill timber is the test).
5. ON Bancroft-North Hastings, WMU 57 east.
6. AB Porcupine Hills, WMU 305, as a licensing-constrained fallback test only.

All but Alberta have full open lidar coverage confirmed against the index services.

### Cited Findings

**1. Colorado: White River NF, Ripple Creek / Marvine side of the Flat Tops (recommended US pick)**
- Centre 40.08,-107.30. Falls in GMU 24, elk DAU E-6. — [CPW GMU layer](https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer/6)
- Elk numbers: the 2025 post-hunt estimate for DAU 06 (GMUs 11, 12, 13, 23, 24, 25, 26, 33, 34, 131, 211, 231) is 42,470 elk, with 19 bulls per 100 cows. The statewide estimate is 339,370. — [CPW 2025 Elk Population and Sex Ratio Estimates](https://cpw.widen.net/s/fmhlcbms2w/2025-elk-population-and-sex-ratio-estimates)
- Lidar: CO_Central_Western_2016 QL2 (40%) plus CO_NWCO_1_2020 QL2 (69%), together 100%. Both have published 1 m DEMs. — [3DEP index](https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/24)
- Relief 2,461-3,337 m (876 m range, 3DEP 1/3"). — [3DEP 1/3" COG](https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n41w108/USGS_13_n41w108.tif)
- Disturbance: MTBS Big Fish and Lost Lakes fires (2002); 17 FACTS harvest records (FY 1982-2002). — [EDW MTBS](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MTBS_01/MapServer); [EDW TimberHarvest](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TimberHarvest_01/MapServer)
- Access and water: 12 MVUM road features and 821 NWI wetland polygons. Land is USFS with about 4% private inholdings (BLM SMA). — [EDW MVUM](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer); [NWI](https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0); [BLM SMA](https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/1)
- Alternate, Gunnison NF (38.62,-106.70): GMU 55, DAU E-43, 6,920 elk (2025). Lidar CO_WestCentral_2019 QL2 at 100%. Relief 2,627-3,789 m (1,161 m). 23 MVUM roads and 10 trails. No MTBS fires, one FACTS record (2021). — [CPW 2025 estimates](https://cpw.widen.net/s/fmhlcbms2w/2025-elk-population-and-sex-ratio-estimates); [3DEP index](https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/24)

**2. Montana: Gravelly Range, Beaverhead-Deerlodge NF (or the Elkhorns)**
- Gravelly centre 44.85,-111.92. Falls in HD 323, Gravelly EMU, on the 2026-2027 district map. — [MT FWP Deer and Elk Hunting Districts 2026-27](https://services3.arcgis.com/Cdxz8r11hT0MGzg1/arcgis/rest/services/ADMBND_HD_DEERELKLION/FeatureServer/0)
- The 2023 plan describes the Gravelly EMU as HD 322:
  - 3,039 mi², 63% public: USFS ~24%, BLM ~20%, DNRC ~13%, private ~37%.
  - Covers the Gravelly, Greenhorn, Ruby, Snowcrest, Blacktail and Centennial ranges.
  - Objective: winter aerial counts of 6,000-10,000 elk observed.
  - Five long-distance migrant wintering herds spend most of the year on public land.
  - [MT FWP 2023 Elk Plan, Region 3](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/elk/elk-management-plan/region-3-elk-plan.pdf)
- Statewide, biologists counted over 143,000 elk in 2023 aerial surveys. — [MT FWP 2023 Elk Plan intro](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/elk/elk-management-plan/elk-management-report-intro.pdf)
- Gravelly lidar: MT_StatewideP4_6_B22 QL2 (2022), 100%, with the 1 m DEM published. Relief 2,099-2,955 m (857 m). MTBS Eureka fire 2013. 507 NWI polygons. 0 FACTS records and 0 MVUM features (MVUM data gap, see Q1). SMA shows 100% USFS. — [3DEP index](https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/24); [EDW MTBS](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MTBS_01/MapServer)
- Elkhorns alternative, centre 46.33,-111.85, HD 380 Elkhorn Mountains EMU:
  - 1,044 mi², 42% public.
  - The Elkhorns Wildlife Management Area is "the only one in the National Forest System".
  - Objective: 1,700-2,300 elk observed in winter. Brow-tined bull permits since 1987.
  - 80% of lodgepole pine was killed by mountain pine beetle, yet canopy cover stayed high.
  - [MT FWP Region 3 plan](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/elk/elk-management-plan/region-3-elk-plan.pdf); [Plan intro](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/elk/elk-management-plan/elk-management-report-intro.pdf)
- Elkhorns data: lidar point cloud MT_DNRCphase1_6_2018 QL2 at 100%, but the 1 m DEM is "Pending publication". Relief 1,679-2,869 m (1,190 m). 28 FACTS records (1969-2013). 19 MVUM roads. 355 NWI polygons. — [3DEP index](https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/24); [EDW TimberHarvest](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TimberHarvest_01/MapServer)

**3. Idaho: Boise NF, Unit 39 (Boise River elk zone)**
- Centres 43.92,-115.62 (recommended: 100% USFS) and 43.85,-115.80 (closer to Idaho City: 48% USFS, 27% private, 23% state). Both are in GMU 39, Boise River elk zone. — [IDFG GMUs](https://services.arcgis.com/FjJI5xHF2dUPVrgK/arcgis/rest/services/GameManagementUnits/FeatureServer/0); [BLM SMA](https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/1)
- Elk numbers (Idaho Elk Management Plan 2014-2024, the zone section):
  - Surveys: 6,901 elk in 2008 and 7,275 in 2011.
  - Objectives: 3,200-4,800 cows, 650-950 bulls.
  - Zone 2,444 mi², 76% public land, rangeland and forest.
  - [IDFG Elk Management Plan 2014-2024](https://idfg.idaho.gov/old-web/docs/wildlife/planElk.pdf)
- Lidar: ID_FEMAHQ_2018 QL2 at 100% at both points. NV_USFSR4_4_D23 QL1 (Aug-Sep 2023, 0.5 m DEM) also covers 43.85,-115.80. — [3DEP index](https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/24)
- At 43.92,-115.62: relief 1,403-2,420 m (1,018 m); 46 FACTS records (FY 2017-2020); MTBS Pioneer fire 2016; 37 MVUM roads and 2 trails; 29 NWI polygons. At 43.85,-115.80: 605 m relief, 63 FACTS records (2008-2026), King Gulch fire 1989. — [EDW services](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TimberHarvest_01/MapServer); [3DEP 1/3"](https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n44w116/USGS_13_n44w116.tif)
- Wyoming alternate: Greys River at 43.10,-110.80 is elk Hunt Area 89 "Lower Greys River", Afton herd unit 105. 100% USFS. WY_Southwest_1_2020 QL2 at 100% with 1 m DEM. Relief 1,853-2,714 m. MTBS Aspen Hollow 1996 and Middle 2007. — [WGFD ElkHuntAreas](https://services6.arcgis.com/cWzdqIyxbijuhPLw/arcgis/rest/services/ElkHuntAreas/FeatureServer/0); [3DEP index](https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/24)

**4. BC East Kootenay: Bull River / Wardner, MU 4-22 (recommended Canadian mountain pick)**
- Centre 49.45,-115.40. The 10 km box is 79% MU 4-22 and 21% MU 4-03. — [BC WFS WAA_WILDLIFE_MGMT_UNITS_SVW](https://openmaps.gov.bc.ca/geo/pub/wfs)
- Elk numbers: the 2017/18 Rocky Mountain Trench inventory (Stent, Gooliaff and Lamy, FLNRORD Kootenay):
  - 6,671 elk (90% CI 5,764-7,578) for Invermere to the US border.
  - 5,907 in the South Trench (MUs 4-02, 4-03, 4-04, 4-05, 4-20, 4-21, 4-22, 4-24).
  - A 53% decline since 2007/08 (14,115).
  - [2017/18 Rocky Mountain Trench Elk Inventory](https://wetlandstewards.eco/wp-content/uploads/2020/04/2017-18-Rocky-Mountain-Trench-elk-inventory-report.pdf)
  - An earlier January 2013 survey put the South Trench at 7,509 (11,580 in 2008). — [e-know, Aug 12 2013](https://www.e-know.ca/?p=31018)
- Lidar: LidarBC point cloud 100% (2016 at 6 pts/m²; 2022 and 2024 at 8 pts/m²). 1 m DEM tiles exist for 2016 and 2022 (1:20k) and 2024 (1:2,500, 95%). HRDEM alone covers only 46%. — [LidarBC index](https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer); [HRDEM STAC](https://datacube.services.geo.ca/stac/api/collections/hrdem-lidar/items)
- Relief 747-1,570 m (823 m, MRDEM-30). — [MRDEM-30](https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif)
- Vegetation, disturbance, water and roads (BC WFS):
  - 973 VRI polygons.
  - 150 consolidated cutblocks (1965-2022).
  - 28 historical fire polygons, including 2008, 2021 and 2022.
  - 106 FTEN road sections and 1,255 DRA road segments.
  - 443 FWA streams and 41 FWA wetlands.
  - [BC WFS](https://openmaps.gov.bc.ca/geo/pub/wfs)
- Ownership (ParcelMap BC): private 24%, Untitled Provincial 21%, Crown Provincial 19%. The rest of the box has no parcels, i.e. unsurveyed Crown. — [ParcelMap BC](https://catalogue.data.gov.bc.ca/dataset/parcelmap-bc-parcel-fabric)
- Alternates checked:
  - Grasmere/Wigwam (49.10,-115.05, MU 4-02): 1,525 m relief; ownership 64% untitled provincial, 19% private, 14% federal; LidarBC 82%; cutblocks to 2024; fires 2013-2015.
  - Elk Valley (49.55,-115.00, MU 4-23): 65% private, so rejected.
  - Flathead (49.20,-114.55, MU 4-01): LidarBC 76% (2016 only).
  - Premier Ridge (49.90,-115.70, MU 4-21/4-20): LidarBC 95%.
  - [LidarBC index](https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer); [BC WFS](https://openmaps.gov.bc.ca/geo/pub/wfs)

**5. Ontario: Bancroft-North Hastings elk, WMU 57 east (harvest area 2, hunt code 101)**
- 2026 quotas:
  - Hunt code 101, WMU 57 (east): 2 bull and 2 cow tags.
  - Codes 130 and 131, WMU 61 north and south: 2 and 2 each.
  - WMU 57 west, 58, 60, 62 and 63A: 0.
  - Tags are valid for harvest areas smaller than a WMU.
  - [Ontario elk tag quotas 2026](https://www.ontario.ca/page/elk-tag-quotas)
- Season September 21 to October 4 (2026), residents only. Last year's draw had 12 tags and 2,166 applicants. — [Ontario hunting regulations: elk](https://www.ontario.ca/document/ontario-hunting-regulations-summary/elk)
- Ontario harvest totals from mandatory reports: 20 (2011), 22 (2012), 23 (2013), then 4-15 a year since 2014 (2025: 3 bulls, 1 cow). — [Ontario elk harvests CSV](https://data.ontario.ca/dataset/elk-harvests)
- Centre 45.25,-77.62, in WMU 57. The box is about 48% unpatented (Crown) land per the LIO layer, against 7% at 45.20,-77.80 nearer Bancroft. — [LIO WMU layer](https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open05/MapServer/5); [LIO unpatented land](https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open08/MapServer/34)
- Lidar: HRDEM Highlands East 2023 (71%) plus Renfrew 2022 (46%), together 100%. There are also 139 FRI leaf-on 2023 lidar tiles (LAZ, DEM, CHM). — [HRDEM STAC](https://datacube.services.geo.ca/stac/api/collections/hrdem-lidar/items); [FRI tile index](https://download.fri.mnrf.gov.on.ca/api/api/Download/tile-index/FRI_Leaf_On_Tile_Index_GeoPackage/FRI_Leaf_On_Tile_Index_GeoPackage.gpkg)
- Relief 282-509 m (227 m, MRDEM-30). This is low relief compared with the western sites. — [MRDEM-30](https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif)
- The Bancroft-North Hastings herd was one of four 1998-2001 reintroductions, and Ontario's first modern elk hunt was held near Bancroft in fall 2011. — [Ontario: Elk in Ontario](https://www.ontario.ca/page/elk-ontario)

**6. Alberta: Porcupine Hills, WMU 305 (licensing-constrained test only)**
- Centre 49.90,-114.10. Falls in WMU 305 "South Porcupine Hills" (third-party ArcGIS Online WMU layer). — [CRS_LCC_WMUs](https://services8.arcgis.com/YDfsDuqxD6YlLAbi/arcgis/rest/services/CRS_LCC_WMUs/FeatureServer)
- Elk numbers:
  - February 2025 WMU 305 survey: 1,014 elk observed (minimum count), bull:cow:calf 16:100:24. Earlier counts were 438 (2007), 1,575 (2015) and 298 (2020). The unit lies north of Pincher Creek, bounded by Highways 3, 22, 2 and SR 520. — [WMU 305 survey 2025](https://open.alberta.ca/opendata/wmu-305-aerial-ungulate-survey-2025)
  - March 2020 count across WMUs 304, 305, 306, 308 and 310: 3,405 elk, about 51% higher than in 1993. — [WMU 304-310 elk count 2020](https://open.alberta.ca/opendata/wildlife-management-units-304-305-306-308-310-elk-count-2020)
- No HRDEM lidar here (or at Ya Ha Tinda, WMU 418). Provincial lidar is commercial (AltaLIS), so the open DEM is MRDEM-30 or the 25 m provincial DEM. Relief 1,274-1,812 m (538 m); Ya Ha Tinda 1,509-2,827 m. — [HRDEM STAC](https://datacube.services.geo.ca/stac/api/collections/hrdem-lidar/items); [AltaLIS catalogue](https://www.altalisdata.com/hubfs/2025/Product%20Catalogue%20PDFs%20(April%202025)/Altalis%20Product%20Catalogue%20-%20Digital%20Version.pdf?hsLang=en)
- Open layers here: AVI Crown (OGL-AB) and the Porcupine Hills PLUZ designated trails and roads (OGL-AB). — [AVI Crown](https://open.alberta.ca/opendata/gda-3dbcfa02-e97a-4059-9414-1ed8e0700e80); [PLUZ trails](https://open.alberta.ca/opendata/porcupine-hills-public-land-use-zone-georeferenced-maps)

### Inferences
- **Best first elk bake: CO GMU 24.** It has the biggest herd (42k in the DAU), two lidar epochs, a 2002 burn mosaic, older FACTS cuts, NWI wetlands, MVUM, near-total National Forest, and high, broken terrain for WindNinja.
- **Best Canadian mountain bake: BC MU 4-22.** It has three lidar epochs (useful for change and canopy), dense cutblock and fire history, open-forest and grassland restoration country, and a mix of Crown and private land that will test the ownership layer.
- **Ontario WMU 57 east** is the cheapest bake for the developer: Ontario sources are already wired and the 2023 SPL point clouds are available. Its 227 m relief and tiny tag quota (4 tags) make it a poor wind or elk-model test, but a good field-access test.
- **Montana: Gravelly vs Elkhorns.** The Gravelly area is open, high and almost all public, with a long-distance migratory herd. The Elkhorns adds beetle-killed lodgepole and island-range wind, but needs a self-gridded DEM from the 2018-19 point cloud.
- **Alberta** should wait until lidar is licensed or an open source appears. It would otherwise be the only area running WindNinja on a 25-30 m DEM.

### Gaps
- Current (2023-2026) elk numbers were not verified for:
  - Idaho Unit 39 (newest found: 2011 survey).
  - The Wyoming Afton herd.
  - The Gravelly and Elkhorn EMUs (only objectives and plan text were found; actual recent counts are on plan charts that were not extracted).
  - The BC Trench after 2017/18: a 2023 inventory of about 9,500 elk (45% up over 5 years) appeared only in a search-engine summary with no primary source.
  - The Ontario herd: no population estimate was found on ontario.ca.
- The WMU 57 east/west harvest-area boundary was not available as a service. Check 45.25,-77.62 against the MNR harvest-area map before baking.
- The Bancroft-Minden Forest FRI (stand polygons) was not checked for open availability. Elk use of the 45.25,-77.62 box specifically was not checked.
- Public-access detail (locked gates, landlocked parcels, BC range tenures) was not assessed beyond ownership.

## Q4. Licensing traps

### Takeaway
The traps are:
- BC's "Access Only" layers: consolidated cutblocks, the Digital Road Atlas and FTEN roads.
- Alberta's commercial lidar.
- OSM's share-alike licence.
- Attribution on all the Open Government Licences.
- Non-authoritative or changing hunt-unit layers.

US federal data and RAP are unrestricted.

### Cited Findings
- **BC Access Only.** Consolidated Cutblocks, Digital Road Atlas (DRA) and Forest Tenure Road Section Lines carry the "Access Only" licence in the BC Data Catalogue. — [cutblocks](https://catalogue.data.gov.bc.ca/dataset/harvested-areas-of-bc-consolidated-cutblocks-); [DRA](https://catalogue.data.gov.bc.ca/dataset/digital-road-atlas-dra-master-partially-attributed-roads); [FTEN](https://catalogue.data.gov.bc.ca/dataset/forest-tenure-road-section-lines)
- The BC copyright page says such materials are "'access only' and reproduction is not permitted without written permission"; the contact is QPIPPCopyright@gov.bc.ca. — [BC copyright](https://www2.gov.bc.ca/gov/content?id=1AAACC9C65754E4D89A118B875E0FBDA)
- **BC open layers.** LidarBC lidar, VRI 2025, RESULTS openings, fire perimeters, FWA, WMUs and ParcelMap BC are OGL-BC. — [BC catalogue LiDAR](https://catalogue.data.gov.bc.ca/dataset/lidar); [VRI 2025](https://catalogue.data.gov.bc.ca/dataset/vri-2025-forest-vegetation-composite-rank-1-layer-r1-); [RESULTS](https://catalogue.data.gov.bc.ca/dataset/results-openings-svw)
- **Alberta lidar.** AltaLIS sells LiDAR15 and LiDAR 7.5 DEMs "by the township", resells Airborne Imaging 1 m and Hexagon 2 m lidar, and marks only the Provincial DEM series as "Open Data License". — [AltaLIS catalogue](https://www.altalisdata.com/hubfs/2025/Product%20Catalogue%20PDFs%20(April%202025)/Altalis%20Product%20Catalogue%20-%20Digital%20Version.pdf?hsLang=en)
- **Alberta AVI.** AVI Crown is OGL-AB: "To access the data you must agree to the terms of the Open Government Licence - Alberta". — [AVI Crown metadata](https://geodiscover.alberta.ca/geoportal/rest/metadata/item/100b275712b442acbda4a0358d8a4951/html)
- Earlier AVI-related records on the Alberta portals showed "Agreement Required" and contact addresses such as AF.DEP@gov.ab.ca (search snippet). The open AVI Crown record above appears to supersede that for Crown AVI. — [donnees.iriu.ca AVI harvest areas](https://donnees.iriu.ca/fr/dataset/da07e4d0-bf30-45a8-b0d2-a6fcb3939a7a)
- **National Canada.** HRDEM and SCANFI are under the Open Government Licence - Canada. — [HRDEM](https://open.canada.ca/data/en/dataset/957782bf-847c-4644-a757-e383c0057995); [SCANFI](https://open.canada.ca/data/en/dataset/18e6a919-53fd-41ce-b4e2-44a9707c52dc)
- **Ontario.** Elk harvest data is under the Open Government Licence - Ontario. The pipeline already records FRI as OGL-ON (bake_area.py). — [Ontario elk harvests](https://data.ontario.ca/dataset/elk-harvests); C:\dev\huntapp\pipeline\bake_area.py line 454
- **RAP.** "The USDA Agricultural Research Service (ARS) and the U.S. Government have not placed any restriction on its use or reproduction." — [RAP products](https://rangelands.app/products/)
- **OSM.** ODbL. — [OSM copyright](https://www.openstreetmap.org/copyright)
- **Montana hunt districts changed.** FWP's current layer is "Deer and Elk Hunting Districts (2026 and 2027 Seasons)", and the 2023 plan notes HD 380 had a boundary change in 2022. The Gravelly EMU is HD 322 in the plan but HD 323 on the 2026-27 layer. — [MT FWP HD layer](https://services3.arcgis.com/Cdxz8r11hT0MGzg1/arcgis/rest/services/ADMBND_HD_DEERELKLION/FeatureServer/0); [Region 3 plan](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/elk/elk-management-plan/region-3-elk-plan.pdf)

### Inferences
- Shipping baked BC area packs that contain consolidated cutblock polygons, DRA or FTEN geometry would be "reproduction", so it needs written permission. Safe substitutes: VRI 2025 harvest attributes plus RESULTS openings (OGL-BC) and CanLaD for cut year; OSM (with ODbL attribution and share-alike on the road database) for roads.
- Alberta Eastern Slopes lidar cannot go into a paid, distributed app without a commercial licence. Before relying on any other free Alberta lidar, check whether ABMI or ODAA releases reach the target area.
- Every OGL (Canada, BC, Alberta, Ontario) requires an attribution statement. The app's per-area "sources" block, which bake_area.py already writes for Ontario, should carry provider and licence for each layer.
- OSM-derived road and trail layers baked together with other data may fall under ODbL "produced work" or "derivative database" rules. Keep OSM roads as a separate layer with its own attribution.
- Hunt-unit layers change between seasons (Montana 2026-27). Label areas from the current-season service and store the season with the label.

### Gaps
- The exact terms of OGL-BC, OGL-Alberta and OGL-Canada (attribution wording, exemptions for personal information) were not fetched.
- Whether BC grants written permission for Access Only layers to commercial apps, and on what terms, was not researched.
- The redistribution terms of the state hunt-unit services and PAD-US were not checked; they are presumed open.
- LANDFIRE, NLCD, 3DEP and NHD licence statements were not fetched. They are presumed public domain as US federal data.
