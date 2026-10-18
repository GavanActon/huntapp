# The Clearwater box from national rasters: elevation, land cover, cutblocks, stand species

- **Sources (all read as windows over the area region on 2026-10-17, in a scratch session, nothing written to the repo or pipeline/raw):**
  - MRDEM-30 DTM (NRCan, OGL-Canada), https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif
  - 2020 Land Cover of Canada, 30 m (NRCan/CCMEO, NALCMS legend), https://datacube-prod-data-public.s3.ca-central-1.amazonaws.com/store/land/landcover/landcover-2020-classification.tif
  - CanLaD v1.1, latest disturbance type and start year 1985–2025 (CFS, CC BY 4.0), https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/canlad_including_insect_defoliation/v1.1/Latest_filtered_CAN_20260508/
  - SCANFI v2 2025 species shares, closure, height, age (CFS, OGL-Canada), https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/SCANFI/v2/
  - NRCan CDEM point elevations, https://geogratis.gc.ca/services/elevation/cdem/altitude
- **Read:** 2026-10-17 (my own analysis; 30 m pixels, masked to the lon/lat region and core)
- **Evidence:** [S] national agency products; the shares are my computation
- **Where:** region 256.6 km², core 99.6 km², the 5 km ring round the centre

## Extracted facts
Elevation (MRDEM-30):
- Region 1,014–1,372 m (2nd percentile 1,031, median 1,176, 98th 1,320). Core 1,058–1,310 m (median 1,164). 5 km ring 1,087–1,309 m. Centre 1,212 m (CDEM point: 1,200 m).
- Nearest Subalpine natural subregion polygon: 18.2 km SW of the centre (6.9 km from the region) at 52.153, −115.422, CDEM 1,698 m there. Nearest Alpine polygon: 38.5 km SSW at 51.950, −115.430, CDEM 1,964 m. The box's highest ground is about 330 m below the lowest Subalpine edge and about 600 m below the Alpine (treeline) edge.
- A treeline test like `build_profile.py`'s: the 98th percentile of treed-pixel elevation is 1,320 m; land above it is 2.0% of the region, and only 17% of that is open. That fails both thresholds (5% alpine share, 60% open), so the profile will say "no treeline: forest to the tops".

Land cover 2020 (share of region / core / 5 km ring):
- needleleaf forest 52.5 / 56.6 / 56.8%; mixed 12.6 / 12.5 / 13.1%; broadleaf 0.4 / 0.5 / 0.5%; shrubland 17.2 / 15.1 / 14.8%; grassland 5.7 / 4.4 / 3.8%; wetland 5.2 / 5.6 / 5.8%; cropland 3.3 / 2.1 / 2.3%; urban and built-up 2.4 / 2.7 / 2.3%; barren 0.5 / 0.4 / 0.3%; water 0.1 / 0.2 / 0.1%.

CanLaD disturbances:
- Harvest covers **23.0% of the region** (22.5% of the core, 20.6% of the 5 km ring); fire 0.02%.
- By harvest age in fall 2026 (share of the whole region): 0–4 yr 2.7%, 5–9 yr 4.2%, 10–20 yr 6.1%, 21–30 yr 8.1%, 31–41 yr 1.9%. Core: 3.1, 3.4, 4.3, 9.9, 1.7%.
- By start-year band (region): 1985–89 0.5%, 1990–94 0.6%, 1995–99 3.8%, 2000–04 3.8%, 2005–09 4.7%, 2010–14 1.9%, 2015–19 3.8%, 2020–25 4.0%.
- Alberta's historical wildfire perimeters (last 10 years; https://geospatial.alberta.ca/mimas/rest/services/wildfire/historical_wildfires_data/FeatureServer) hold one 5.1 ha fire (RWF-014-2016) in the box.

How the 2020 land cover sees the cuts (row: cut age; cells: land cover class, % of that age's cut pixels):
- 0–4 yr: needleleaf 84, grass 5, mixed 6, shrub 3 (cut after the 2020 imagery: still forest on the map).
- 5–9 yr: **grass 54**, needleleaf 27, shrub 13.
- 10–14 yr: **grass 45**, shrub 35, needleleaf 16.
- 15–20 yr: **shrub 60**, needleleaf 13, mixed 10, wetland 8.
- 21–30 yr: shrub 39, mixed 26, needleleaf 26.
- 31–41 yr: mixed 43, needleleaf 39, shrub 11.
- Read the other way: 58% of "grassland" pixels are CanLaD cuts (68% of those 5–9 yr old); 42% of "shrubland" pixels are cuts (median 20 yr); only 4% of "cropland" and 8% of "urban" are cuts (those are fields, pasture, well sites, roads and plant sites).

SCANFI v2 (treed pixels):
- Share of crown closure: lodgepole pine 29.9%, "other coniferous" 34.2%, broadleaf 25.7%, black spruce 7.4%, tamarack 2.6%, jack pine, balsam fir, Douglas-fir under 0.2% each. SCANFI has no white spruce layer of its own; in the Foothills "other coniferous" is mostly white spruce (inference from the Natural Regions description, place-natural-subregions.md).
- Leading species by pixel: other conifer 34.2%, lodgepole pine 30.7%, broadleaf 26.7%, black spruce 5.6%, tamarack 2.7%.
- Height median 19 m (10th–90th 6–24 m); closure median 67% (46–79%); stand age median 104 yr (17–135 yr).

## What it means for Clearwater
- [I] No treeline and no alpine anywhere near the box: every treeline rule (moose band, dwarf-shrub cap, ptarmigan, grizzly band) must stay off, as the profile will make it.
- [I] Disturbance here is logging, not fire. About a fifth of the land is cut, with a pulse of 21–30-year cuts and steady cutting since.
- [I] As tonight's bake is configured (no forest source for AB), the habitat grid takes cover from the 2020 land cover alone: the 5–14-yr cuts that show as "grassland" get no cover class (score 0 for every target), the 0–4-yr cuts read as dense conifer, and no cell has a cut age. The `ca.scanfi` forest adapter (as Yukon uses) carries CanLaD's cut years and fixes most of this.
- [I] SCANFI's species codes in this box are Pl, Cx and Hx. `build_habitat.py`'s lead_code has none of them (Sb 1, Pj 2, Sw 3, Bf 4, Cw 5, La 6, Pt/Po 7, Bw 8), so about 92% of treed cells would get lead 0.

## Not confirmed
- CanLaD is "latest disturbance": a stand cut twice shows only the later cut. Partial cuts and thinning may be missed.
- The 2020 land cover's grassland/cropland split in the White Area (hay vs pasture vs cereal) was not checked on imagery.
