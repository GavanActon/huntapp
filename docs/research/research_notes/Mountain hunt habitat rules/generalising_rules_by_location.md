# Generalising habitat rules by location (Canada, contiguous US, Alaska)

Evidence tags: **[S]** peer-reviewed science, **[G]** agency or data-provider documentation, **[H]** press or vendor claims. Where a figure came only from a search-result snippet and the page itself was not read, it says so.

Context for the reader: Groundwind's rules were tuned for flat boreal Ontario (48.9° N). The app now has areas in BC and Yukon mountains (60–63° N, 700–2000 m, treeline about 1300–1450 m), Quebec and Ontario, plus an Explore mode on an 11 km tile lattice. The aim is a per-location profile that sets which species are present, their phenology, elevation preference relative to treeline, and browse/cover value by vegetation class.

---

## 1. Ecological frameworks with open data: which is best for setting habitat rules?

### Takeaway
Use a two-level key. The continent-wide backbone is **CEC North American ecoregions Level III** (182 regions, Canada, US and Mexico in one layer). Where they exist, provincial or territorial **climate-based** systems override it, because they are mapped as elevation bands and so give "subalpine/alpine" directly: **BC BEC zones/subzones**, **Yukon Bioclimate Zones and Subzones** (30 m DEM with elevation-limit rule polygons), and **Quebec bioclimatic domains**. For the vegetation class itself, **NALCMS 2020 30 m** is the only seamless Canada+US+AK land cover. It separates "temperate/sub-polar shrubland" (class 8) from "sub-polar/polar shrubland-lichen-moss" (class 11), which works as a tall-shrub vs dwarf-shrub/alpine split. **ABoVE PFT top cover** (Macander & Nelson) adds deciduous-shrub % in Alaska and Yukon only.

### Cited Findings
- **[G] CEC Level III ecoregions:** 182 Level III regions nested in Level II and Level I. This is an update of the 2009 CEC release, jointly developed by Canada, Mexico and the US. It is served as an ArcGIS FeatureServer (`NA_Terrestrial_Ecoregions_Level_3`) and through ScienceBase. — [ArcGIS REST service](https://services7.arcgis.com/oF9CDB4lUYF7Um9q/ArcGIS/rest/services/NA_Terrestrial_Ecoregions_Level_3/FeatureServer); [ScienceBase item](https://beta.sciencebase.gov/catalog/item/4fb68477e4b03ad19d64b370)
- **[G] US EPA Level III and IV ecoregions:** cover the continental US, with shapefile downloads (US Level III about 28–35 MB). Level IV is a finer US-only subdivision. — [EPA Level III and IV Ecoregions](https://epa.gov/eco-research/level-iii-and-iv-ecoregions-continental-united-states)
- **[G] Canada's National Ecological Framework (ecozones → ecoregions → ecodistricts):** "an ecodistrict is a subdivision of an ecoregion… characterized by distinctive assemblages of relief, landforms, geology, soil, vegetation, water bodies and fauna". Available as FGDB, GeoJSON and Esri REST under the Open Government Licence – Canada 2.0. — [Terrestrial Ecodistricts of Canada (open data mirror)](https://donnees.iriu.ca/dataset/5580569b-adc9-4063-bacc-3fa788b5f160); [NEF for Canada](https://donnees.iriu.ca/dataset/fe9fd41c-1f67-4bc5-809d-05b62986b26b/resource/c8e06123-d8aa-4206-858e-11ae78d6584d)
- **[G] BC BEC map:** the "current and most detailed version of the approved corporate provincial digital BEC Zone/Subzone/Variant/Phase map". The record cites version 12 (2 Sept 2021); a newer version may exist, so check. The layer is `WHSE_FOREST_VEGETATION.BEC_BIOGEOCLIMATIC_POLY` on OpenMaps (`openmaps.gov.bc.ca/geo/pub/...`), with WMS and KML listed. The same OpenMaps GeoServer serves WFS for BCGW layers. A 1:2M generalized version is on the BC ArcGIS MapServer. — [BEC Map record](https://open.canada.ca/data/en/dataset/f358a53b-ffde-4830-a325-a5a03ff672c3); [Generalized BEC 1:2M MapServer](https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/672)
- **[G] Yukon Bioclimate Zones and Subzones v1.0:**
  - Built from a 30 m DEM plus "rule-polygons" whose attributes "define upper and lower elevation limits of the bioclimate zone/subzone(s)", set from field data, expert observation and imagery.
  - Usable at scales larger than 1:250,000 "with caution". It is deliberately extended over lakes and glaciers so it can be intersected with any land cover layer.
  - Distributed from GeoYukon under the Open Government Licence – Yukon. Last updated 14 May 2026 (per the open.yukon.ca listing). Revised periodically.
  - Source: [open.yukon.ca dataset](https://open.yukon.ca/data/bioclimate-zones-and-subzones)
- **[G] Yukon's classification framework (YBEC):** "uses similar concepts to the Biogeoclimatic Ecosystem Classification System of British Columbia". The levels are Ecoregion (L2), Ecodistrict (L3) and Bio-Climate Zone (L4). A separate "Ecoregions of the Yukon Territory" dataset is on open.canada.ca. — [Yukon ELC page (search summary; page returned 403 to fetch)](https://yukon.ca/en/ecological-landscape-classification); [Ecoregions of the Yukon](https://open.canada.ca/data/en/dataset/e2feb04e-3620-f632-6619-a546ec830744)
- **[G] Quebec:**
  - 10 bioclimatic domains, defined by "the nature of late-succession vegetation, expressing the balance between climate and mesic sites". Southern domains split into sub-domains by precipitation or disturbance regime.
  - Published in "Classification écologique du territoire québécois" on Données Québec as GPKG (326 MB, modified 2025-08-19), FGDB and WMS.
  - Source: [Données Québec CET dataset](https://www.donneesquebec.ca/recherche/fr/dataset/systeme-hierarchique-de-classification-ecologique-du-territoire); [map of vegetation zones, domains and regions](https://donneesquebec.ca/recherche/dataset/systeme-hierarchique-de-classification-ecologique-du-territoire/resource/30d753fd-131d-4fb3-8283-1d9a09be19f7)
- **[G] NALCMS 2020, 30 m:**
  - 19 classes, from FAO LCCS. Image years: Canada 2020 (some 2019/2021), CONUS 2019, Alaska 2021, Mexico 2020.
  - Classes: 1 temperate/sub-polar needleleaf forest; 2 sub-polar taiga needleleaf forest; 5 temperate/sub-polar broadleaf deciduous; 6 mixed; **8 temperate/sub-polar shrubland**; 10 temperate/sub-polar grassland; **11 sub-polar/polar shrubland-lichen-moss**; **12 sub-polar/polar grassland-lichen-moss**; **13 sub-polar/polar barren-lichen-moss**; 14 wetland; 15 cropland; 16 barren; 17 urban; 18 water; 19 snow/ice.
  - The Earth Engine copy (USGS release) is marked as a US Government work in the public domain.
  - The CEC atlas offers TIF downloads per country (Canada 1.86 GB, US 1.57 GB) but its page did not state terms.
  - Sources: [GEE NALCMS 2020 catalog](https://developers.google.com/earth-engine/datasets/catalog/USGS_NLCD_RELEASES_2020_REL_NALCMS); [CEC Land Cover 30 m 2020](https://www.cec.org/north-american-environmental-atlas/land-cover-30m-2020/)
- **[G] LANDFIRE EVT (LF 2023):**
  - Maps NatureServe's terrestrial ecological systems for CONUS, Alaska and Hawaii.
  - Built with decision-tree models per lifeform (tree, shrub, herb) from field plots, Landsat, topography and biophysical gradients.
  - Disturbed areas from the last 20 years are re-mapped for lifeform, cover and height.
  - Public domain (data.gov listings). US only; no Canada.
  - Sources: [USGS LANDFIRE 2023 EVT metadata](https://data.usgs.gov/datacatalog/metadata/USGS.673b9d33d34e689449dca98b.xml); [data.gov EVT listing](https://catalog-old.data.gov/dataset/landfire-2023-existing-vegetation-type-evt-hi-08b35)
- **[S][G] ABoVE PFT Top Cover, Alaska and Yukon, 1985–2020 (Macander & Nelson 2022, ORNL DAAC):**
  - A 30 m annual series of top cover for 7 PFTs: conifer trees, broadleaf trees, **deciduous shrubs**, evergreen shrubs, graminoids, forbs and light macrolichens.
  - Covers 1,770,000 km² of northern and central Alaska and northwestern Canada.
  - Net change: deciduous shrubs +66,000 km²; graminoids −40,000 km².
  - Sources: [ORNL DAAC guide](https://daac.ornl.gov/ABOVE/guides/AK_Yukon_PFT_TopCover.html); [ABR summary](https://www.abrinc.com/post/mapping-changes-in-plant-cover-across-arctic-and-boreal-alaska-and-yukon)
- **[G] Related ABoVE products:** a North Slope tundra PFT fractional cover set and a 30 m "Aboveground Biomass, Shrub Dominance, North Slope AK 2007–2016" set exist. Both cover Arctic Alaska only. — [AK Tundra PFT Fractional Cover](https://daac.ornl.gov/ABOVE/guides/AK_Tundra_PFT_FractionalCover.html); [Shrub dominance North Slope](https://data.nasa.gov/dataset/d12dfc6c-33d1-49c5-8259-7efbbe0dbb0e)

### Inferences
- **Best for rules:**
  - **Climate-and-elevation keyed systems** (BEC, Yukon bioclimate, Quebec domains) say *what the vegetation means* to an animal: subalpine willow/birch shrub vs boreal lowland shrub. They do this better than any land-cover map.
  - The **CEC L3** layer is the only seamless fallback for Explore tiles in the US and in provinces without such a system.
  - Suggested profile key: `species-range gate → CEC L3 (always) → provincial climate zone (if any) → elevation-relative-to-treeline band → NALCMS class`.
- **NALCMS class 8 vs 11/12/13 is the cheapest continent-wide tall/dwarf/alpine split.** In BC and Yukon mountains, class 8 above the forest line is mostly subalpine willow/birch (high moose value). Classes 11–13 are dwarf shrub, lichen and moss (low browse, but caribou lichen).
- **ABoVE deciduous-shrub cover** is the best direct moose-browse proxy for Yukon and Alaska tiles. It does not reach BC south of the Yukon border, nor the rest of Canada.
- **The Yukon layer already *is* "elevation relative to treeline".** Its rule polygons carry upper and lower elevation limits per zone. BEC subalpine and alpine zones play the same role in BC. Codes such as SWB/ESSF/MH for subalpine and BAFA/IMA/CMA for alpine are from general knowledge and should be checked against the BEC attribute catalogue.
- LANDFIRE EVT is far richer than NALCMS for the US (ecological systems, shrub height). It could be the US-tile vegetation source, with NALCMS for Canada, at the cost of two class lookup tables.

### Gaps
- No licence statement was found on the CEC Atlas page for NALCMS. The Earth Engine copy is marked public domain, but the Canadian contribution (NRCan) is normally OGL-Canada. Confirm before redistributing tiles.
- The current BEC version number and WFS layer name were not re-verified. The record cites v12 (2021).
- The Données Québec licence was not confirmed. Données Québec usually uses CC BY 4.0.
- No continent-wide map that separates *tall* shrub (>1.5 m) from dwarf shrub by height was found for Canada outside the ABoVE domain. LANDFIRE EVH/EVC give shrub height in the US only, and this was not verified here.
- The EPA Level IV licence and the CEC ecoregion licence were not checked. US federal works are normally public domain.

---

## 2. Climate at a point with elevation adjustment

### Takeaway
**AdaptWest/ClimateNA** is the right baseline for a profile:
- 1 km normals for all of North America, 1961–90 through 1991–2020.
- CC-BY 4.0.
- Includes DD5, NFFD, FFP, PAS, MAT and monthly means (so mean October temperature is directly available).
- Built with ClimateNA's local elevation adjustment, so the same method can be used to correct 30 m cells.

For live and recent weather use Open-Meteo, whose climate API is CC BY 4.0 and DEM-adjusted. **Daymet** (1 km daily, all of NA, includes SWE) works for recent-year anomalies. **WorldClim is non-commercial only**, so avoid it.

### Cited Findings
- **[G] AdaptWest ClimateNA v7.3 rasters:**
  - 1 km over North America, Lambert Azimuthal Equal-Area projection.
  - Normal periods 1961–1990, 1971–2000, 1981–2010 and 1991–2020.
  - Two sets: 33 bioclimatic variables ("seasonal and annual means, extremes, growing and chilling degree days, snow fall, potential evapotranspiration, and a number of drought indices", incl. DD5, NFFD, FFP, PAS, MAT, Eref) and 48 monthly temperature/precipitation variables.
  - GeoTIFF, about 30 MB per raster and about 1 GB per zip.
  - Licence: "These data are made available under a CC-BY 4.0 license."
  - v7.3 "fixed a bug that limited the dynamic local elevation adjustment from being fully implemented for monthly minimum temperature".
  - Source: [AdaptWest ClimateNA page](https://adaptwest.databasin.org/pages/adaptwest-climatena/)
- **[S] ClimateNA method (Wang, Hamann, Spittlehouse & Carroll 2016, PLoS One 11(6):e0156720):**
  - "Locally downscales historical and future monthly climate data layers into scale-free point estimates" for all of North America.
  - Computes "a large number of biologically relevant climate variables that are usually derived from daily weather data".
  - Covers historical 1901–2014 and future periods.
  - Source: [PMC4898765](https://pmc.ncbi.nlm.nih.gov/articles/PMC4898765)
- **[G] Open-Meteo Climate API:**
  - 7 CMIP6 HighResMIP models at 20–51 km native resolution, statistically downscaled to 10 km.
  - Temperature uses "elevation-based grid-cell selection using a 90-meter digital elevation model".
  - Linear monthly bias correction against **ERA5-Land** over a 50-year calibration.
  - Covers 1950–2050. Snowfall has "larger biases in complex terrain".
  - Licence CC BY 4.0. The free tier is non-commercial; commercial use needs an API key.
  - Source: [Open-Meteo Climate API docs](https://open-meteo.com/en/docs/climate-api)
- **[G] ERA5-Land via Open-Meteo Historical Weather API:** ERA5-Land is the reference dataset and is exposed through Open-Meteo's Historical Weather API, including `snow_depth`. One snippet gave availability "from 1950 to 3 months from the present" for a hosted copy. — [Open-Meteo Climate API docs](https://open-meteo.com/en/docs/climate-api); [GEE ERA5-Land](https://developers.google.com/earth-engine/datasets/catalog/ECMWF_ERA5_LAND_HOURLY?hl=vi)
- **[G] Daymet V4 R1:**
  - Daily 1 km grids for continental North America (plus Hawaii and Puerto Rico).
  - Variables: Tmax, Tmin, precipitation, shortwave radiation, vapour pressure, **snow water equivalent**.
  - From 1980; the GEE copy runs to 2024-12-30, so it lags by about a year.
  - DOI 10.3334/ORNLDAAC/2129.
  - Source: [GEE Daymet V4](https://developers.google.com/earth-engine/datasets/catalog/NASA_ORNL_DAYMET_V4?hl=fr); [ORNL DAAC ds 1840](https://daacweb-prod.ornl.gov/cgi-bin/dsviewer.pl?ds_id=1840)
- **[G] PRISM terms:** "All data… may be freely reproduced and distributed", with the PRISM Group name, URL and access date stated. — [PRISM Terms of Use](https://prism.oregonstate.edu/terms/)
- **[G] WorldClim 2.1 terms:** "freely available for academic use and other non-commercial use. Redistribution or commercial use is not allowed without prior permission." — [About WorldClim](https://worldclim.org/about.html)

### Inferences
- **Variables worth carrying in the profile.** All are in the AdaptWest bioclim/monthly sets.
  - **DD5** (growing-degree-days >5 °C): drives regrowth rate after burns and cuts, berry ripening and treeline.
  - **NFFD/FFP** (frost-free days/period): length of the green season.
  - **PAS** (precipitation as snow): winter severity and the expected snow depth range.
  - **Tave09/Tave10** (mean September/October temperature): rut-period heat stress and leaf-off timing.
  - **MAT and the summer mean**: treeline check (see §3).
  - The current fixed "late fall switch" and 14 °C heat threshold can then be relative: e.g. heat-stress days counted against the local Tave10, and the leaf-off switch keyed to a degree-day or frost date.
- **Lapse-rate downscaling recipe:**
  - Sample the 1 km normal and its own 1 km elevation.
  - Compute a *local* lapse rate per variable and month by regressing the 1 km values on elevation within a moving window of about 10–30 km. This mirrors ClimateNA's "dynamic local elevation adjustment".
  - Apply it to the difference between the 30 m DEM and the 1 km elevation.
  - This beats a fixed 6.5 °C/km in valleys with inversions, which is common in Yukon winters.
  - Open-Meteo's 90 m DEM grid-cell selection is the live-weather counterpart.
- **Licensing for a commercial app:**
  - Fine: AdaptWest (CC-BY), Open-Meteo (CC BY, with a paid commercial tier), PRISM (attribution), Daymet (NASA DAAC data are generally open).
  - Avoid: WorldClim.

### Gaps
- TerraClimate (about 4 km monthly, global) and the PRISM spatial extent (CONUS only, 800 m/4 km) were not re-verified in this pass.
- The ERA5-Land latency on the Copernicus CDS was not verified. The "3 months" figure is from a hosted copy's snippet.
- Published surface lapse rates for the northern Cordillera (seasonal, inversion-prone) were not found in this pass. The 6.5 °C/km standard-atmosphere value is a placeholder, not a sourced local value.
- The ClimateNA paper page was behind a captcha. Exact details of the local regression (window size, variables) are not quoted here.

---

## 3. Treeline: models, local derivation and "elevation relative to treeline" as a habitat axis

### Takeaway
- The global physiological rule (Paulsen & Körner 2014 TREELIM) is a growing season of at least 94 days with daily mean >0.9 °C, and a season mean of at least 6.4 °C.
- From climate alone this gives a *potential* treeline, which can sit above the real one.
- For each tile, the practical step is to derive the *actual* local forest line empirically: the upper percentile of forested-cell elevations from a forest-cover map and DEM. The climatic line serves as a sanity bound.
- Mass-elevation effects make treeline vary by hundreds of metres at the same latitude (Rockies vs Coast Mountains). Latitude alone is a poor predictor.

### Cited Findings
- **[S] Körner & Paulsen 2004, J. Biogeography 31:713–732:**
  - Root-zone temperature logged at 46 treeline sites from 68° N to 42° S, 1996–2003.
  - Climatic treelines sit at a seasonal mean ground temperature of **6.7 °C ± 0.8 SD**.
  - "The length of the growing season, thermal extremes or thermal sums have no predictive value for treeline altitude on a global scale."
  - Source: [edoc Basel record](https://edoc.unibas.ch/8594)
- **[S] Paulsen & Körner 2014, Alpine Botany (TREELIM):**
  - Best fit with a daily mean air temperature threshold of **0.9 °C** to define the season, a **minimum season of 94 days** and a **minimum season mean of 6.4 °C**.
  - The 6.4 °C (air) figure and the 6.7 °C (root-zone) figure above are different measures, not a contradiction.
  - Source: [edoc Basel 33369](https://edoc.unibas.ch/33369); [GMBA treeline definition](https://www.gmba.unibe.ch/services/tools/treeline_definition)
- **[S/low weight] Mass-elevation effect:** treeline averages about 350 m higher in a Rocky Mountains study area (2151 m) than in a Coast Mountains study area (1808 m), "despite the Rocky Mountains study area being situated at higher latitude". This comes from an SFU geography project page and a Rocky Mountains mass-elevation-effect paper record, both from search snippets. — [SFU treeline project](https://www.sfu.ca/geog355fall02/mriegner/GEOG%20355%20Project/sub5results/re_treelines.htm); [Mass elevation effect, Rocky Mountains](https://katalog.hcu-hamburg.de/vufind/Search2Record/OLC1992729263)
- **[S] Southwest Yukon (Kluane Ranges):** repeat aerial photos show treeline change. Elevational advance of spruce was seen "in comparatively fewer areas", typically alongside infilling. — [ScienceBase record](https://www.sciencebase.gov/catalog/item/56dda09ae4b015c306fae32d)
- **[S][G] Ways to derive local treeline from imagery and a DEM:**
  - (a) Identify treeline elevations by hand, interpolate a treeline surface, intersect it with a 90 m DEM, and call everything above it alpine. This was used for "Potential alpine habitat in the western USA based on treeline elevation".
  - (b) Landsat vegetation-index transects every 100 m along 100 km lines from 115 high peaks across western North America, Canada to Central America, ending under 2 km into closed forest.
  - Sources: [Dryad dataset](https://datadryad.org/dataset/doi:10.5061/dryad.sqv9s4n9m); [EGUsphere 2025-1203](https://egusphere.copernicus.org/preprints/2025/egusphere-2025-1203/)
- **[G] Yukon bioclimate zones as treeline bands:** they encode elevation limits per zone through DEM rule-polygons (see §1). — [open.yukon.ca](https://open.yukon.ca/data/bioclimate-zones-and-subzones)
- **[S] Yukon moose (South Canol) and elevation:** moose used "smaller ranges at lower elevations" in winter, "presumably limited by snow depths". They moved up through summer, "reaching maximum elevations during rut and early winter". Shrub-dominated classes were selected in all seasons. Source: search snippet of Alces abstract; the page returned 404 to fetch. — [Alces "Yukon Moose II"](https://alcesjournal.org/index.php/alces/article/view/174); [McCulley 2015 thesis (Yukon EMR library)](https://emrlibrary.gov.yk.ca/emrlibrary/theses/mcculley-a-2015.pdf)

### Inferences
- **Per-tile local treeline recipe:**
  - Within an 11 km tile plus a buffer of about 10 km, take forest cells: NALCMS 1/2/5/6, SCANFI/VRI crown closure above a threshold, or LiDAR canopy height >2–3 m where available.
  - Set treeline = the 95th–98th percentile of their DEM elevations, restricted to slope aspects that are adequately sampled. Do north- and south-facing aspects separately, because southerly aspects run higher.
  - Clamp the result between the TREELIM climatic line (from AdaptWest monthly means with a lapse rate) and the valley floor. Fall back to the climatic line where there is too little forest.
  - Then **Δz = elevation − local treeline** becomes a continuous habitat axis. Bands might be "valley/boreal" (Δz < −300 m), "upper forest" (−300 to −100), "subalpine shrub ecotone" (−100 to +150), "alpine" (> +150).
- For moose in the northern Cordillera, published Yukon telemetry supports a seasonal *preference shift along Δz*: high (ecotone and subalpine shrub) in late summer, rut and early winter; down to valleys as snow deepens. This argues for a date-and-snow-dependent preferred Δz rather than a fixed elevation preference.
- The app's stated treeline of 1300–1450 m at 60–63° N should be re-derived per tile, not hard-coded. The Rockies-vs-Coast example shows treeline varies by about 350 m at similar latitudes.

### Gaps
- No published metres-per-degree-latitude gradient for Cordilleran treeline was found in this pass.
- The quantitative seasonal elevations in metres for Yukon moose were not retrieved; the Alces pages returned 404.
- No validated, ready-made treeline raster covering Canada and Alaska was found.

---

## 4. Snow: live and recent products, latency, and thresholds that move ungulates

### Takeaway
No single live snow-depth product covers all target areas at fine resolution:
- **SNODAS** (1 km, daily) covers the US and southern Canada only, to 52.88° N. It excludes northern BC, Yukon and most of Alaska, and is now at a "basic" service level.
- For BC, Yukon and Alaska, use model snow depth: ERA5-Land or forecast-model snow depth through Open-Meteo. Pair it with **VIIRS VNP10A1F** (375 m daily, cloud-gap-filled) snow *cover* to check presence or absence.

Published thresholds:
- **Moose** (Coady 1974): >40 cm starts to impede, >70 cm affects habitat selection, >90 cm severely restricts.
- **White-tailed deer** (Nova Scotia): start yarding >19 cm; severely restricted at about 50 cm.

### Cited Findings
- **[G] SNODAS (NSIDC G02158):**
  - 1 km, daily, 30 Sept 2003 to present.
  - Bounding box 24.95°–52.88° N, 124.73°–66.94° W: CONUS plus parts of Canada.
  - Variables include snow depth and SWE.
  - Files posted by "scripts that run several times a day" at `https://noaadata.apps.nsidc.org/NOAA/G02158/`. Binary format, with conversion tools to GeoTIFF/NetCDF.
  - Now at a "BASIC Level of Service due to recent funding limitations". Citation is required; no explicit open licence is shown.
  - Source: [NSIDC G02158](https://nsidc.org/data/g02158/versions/1)
- **[G] CMC Daily Snow Depth Analysis (NSIDC-0447):**
  - Northern Hemisphere, 24 km.
  - Operationally "updated every 6 hours using optimum interpolation" with an initial guess from a snow model driven by GEM analysed temperatures and forecast precipitation.
  - The NSIDC archive runs only 1 Aug 1998 – 31 Dec 2020.
  - Source: [NSIDC-0447](https://nsidc.org/data/nsidc-0447)
- **[G] VIIRS VNP10A1F v2:**
  - Daily 375 m cloud-gap-filled snow cover. Cloudy pixels are replaced with the most recent cloud-free observation.
  - Designed to continue the MODIS v6.1 snow record "beyond the life expectancy of MODIS".
  - MOD10A1F vs VNP10A1F monthly snow-cover days agree at r = 0.99 (Great Basin, WY2013–2023).
  - Sources: [NSIDC VNP10A1F v2](https://nsidc.org/data/VNP10A1F/versions/2); [MDPI Remote Sensing 16:3029](https://www.mdpi.com/2072-4292/16/16/3029)
- **[G] ERA5-Land snow_depth** is available through Open-Meteo's Historical Weather API, which uses ERA5-Land as its reference. Open-Meteo warns that modelled snowfall is biased in complex terrain. — [Open-Meteo Climate API docs](https://open-meteo.com/en/docs/climate-api)
- **[G] Daymet** includes daily SWE at 1 km, but with about a one-year lag. — [GEE Daymet V4](https://developers.google.com/earth-engine/datasets/catalog/NASA_ORNL_DAYMET_V4?hl=fr)
- **[G/S] Moose thresholds (Coady 1974, as cited by ADF&G):**
  - "Moose are adversely affected by snow depths of 70–90 cm… depths greater than 90 cm restrict movement to the extent that adequate food intake may be unattainable."
  - Another ADF&G summary: ">40 cm begins to impede movement, >70 cm influences habitat selection, >90 cm restricts movements and greatly increases energy consumption".
  - Sources: [ADF&G Unit 4C moose report 2014](https://www.adfg.alaska.gov/static/research/wildlife/speciesmanagementreports/pdfs/moose_2014_chapter_15_unit_4c.pdf); [Coady, ADF&G](https://www.adfg.alaska.gov/static/home/library/pdfs/wildlife/research_pdfs/76_mo_int_dis_coady.pdf)
- **[S] Snow and elevation in north-central BC:** "significant negative correlation between mean monthly elevation and mean monthly snow on the ground for migratory moose". — [Seasonal movements of migratory and resident female moose, north-central BC (AGRIS)](https://agris.fao.org/search/en/records/65df01697c7033e84bec7042)
- **[S] Northern Yukon (Old Crow):** 17 of 19 collared moose were migratory. They summered in Old Crow Flats and moved 59–144 km to surrounding upland/"alpine" winter ranges, leaving Aug–Nov and returning Apr–Jul. — [Alces: Seasonality of a migratory moose population in northern Yukon](https://alcesjournal.org/index.php/alces/article/view/247)
- **[G] White-tailed deer (Nova Scotia):** deer "migrate to wintering areas and begin to yard in response to snow depths greater than 19 cm, and at depths of 50 cm become severely restricted in their movements". — [Nova Scotia Species Management Plan, White-tailed Deer](https://novascotia.ca/NATR/wildlife/habitats/terrestrial/pdf/SMP_White-tailed_Deer.pdf)

### Inferences
- **Live snow stack:**
  - **SNODAS** where lat ≤ 52.88° (CONUS, southern Ontario/Quebec/BC).
  - Elsewhere: **Open-Meteo snow depth** (forecast models live, ERA5-Land recent past), lapse-adjusted by elevation band.
  - **VNP10A1F** as a 375 m snow/no-snow mask to fix model errors at the snowline. This matters most in mountains, where the snowline is the habitat boundary.
- **Make snow a dynamic switch, not a date:**
  - Deer: "winter mode" when local depth exceeds about 20 cm (start of yarding) and "yard-only" when it exceeds about 50 cm.
  - Moose: penalise open and deep-snow cells above about 70 cm; restrict to conifer cover and low Δz above about 90 cm.
  - This replaces the fixed "late fall" date.
- **In the mountains, the moose snow threshold also moves the preferred Δz downward.** Telemetry consistently shows descent as snow accumulates.

### Gaps
- **IMS** (NSIDC G02156; daily Northern Hemisphere snow/ice cover at 1 km/4 km/24 km): the NSIDC page timed out, so resolutions, start dates and latency were not verified.
- **Canadian live products** (HRDPS 2.5 km snow depth on MSC GeoMet/Datamart, CaLDAS, CaPA precipitation) were not verified. They are likely the best Canadian live snow depth (OGL-Canada), but this needs checking.
- The "40 cm New Brunswick trigger" and "46 cm" deer figures appeared in snippets without clear attribution and were left out.
- No published snow thresholds for black bear denning or grouse snow-roosting were gathered. These were out of time.

---

## 5. Phenology by location: leaf-off and green-up, rut timing, berry season

### Takeaway
- **Moose rut** is tightly synchronous in North America: late September to early October, with most conceptions in a window of about 10 days. Shifting it with latitude matters less than keeping it, plus perhaps a few days later in the far north.
- **White-tailed deer rut** varies hugely in the South: the mean conception date differs by more than 5 weeks within Mississippi, and Georgia runs from mid-October to late December. It is roughly fixed (early to late November) in the North.
- Deer rut should therefore come from a lookup of agency fetal-aging (conception date) maps, not from latitude.
- Leaf-off and green-up can be taken per tile from the MODIS MCD12Q2 climatology (500 m).
- Berry and other plant timing can be shifted with Hopkins' rule (about 4 days per degree latitude and per 122 m of elevation) or, better, with degree-days.

### Cited Findings
- **[G] MCD12Q2 v6.1 (MODIS Land Cover Dynamics):**
  - 500 m, up to two vegetation cycles per year.
  - Layers include greenup onset, midgreenup, maturity, peak, senescence, midgreendown and **dormancy**, plus EVI2 amplitude and quality flags.
  - The GEE copy covers 2001–2023.
  - **VNP22Q2** (Suomi-NPP VIIRS) gives the equivalent yearly phenology metrics for continuity.
  - Source: [GEE MCD12Q2 v061](https://developers.google.cn/earth-engine/datasets/catalog/MODIS_061_MCD12Q2?authuser=4); [GEE phenology tag](https://developers.google.com/earth-engine/datasets/tags/phenology?hl=en)
- **[G] Hopkins' Bioclimatic Law:** spring events occur about "four days later for each degree of latitude to the north, for each five degrees longitude to the east, and for each 400 feet (122 m) rise in altitude". Autumn events come about the same intervals *earlier*. — [Alabama Extension (ACES)](https://www.aces.edu/blog/topics/forestry/estimating-alabama-bloom-times-using-hopkins-bioclimatic-law/)
- **[S] Modern estimates around Hopkins' law** (snippet; probably PMC6426166 or a related paper): shifts range from about –5 to 50 days per 1000 m of elevation and –1 to 4 days per degree north. — [PMC6426166](https://pmc.ncbi.nlm.nih.gov/articles/PMC6426166)
- **[G] Moose, Alaska:**
  - Bulls rut "in late September and early October".
  - An ADF&G document (snippet) states ">85% of all pregnancies occurring in <10 days".
  - Schwartz's "Reproductive Biology of North American Moose" (Alces) is the standard review, but its PDF is a scanned image and could not be read here.
  - Sources: [ADF&G Moose species profile](https://www.adfg.alaska.gov/index.cfm?adfg=moose.printerfriendly); [Schwartz, ADF&G-hosted PDF](https://www.adfg.alaska.gov/static/home/library/pdfs/wildlife/research_pdfs/alces/6027.pdf)
- **[S] Moose across latitude, Europe:**
  - Sweden: 555 females at 18 sites over 12° of latitude. A breakpoint at 64° N, where females give birth 14–21 days later than at 56° N. Moose "match their parturition timing to vegetation onset along latitudinal and continental gradients".
  - Estonia: 95% conceived 29 Aug–30 Oct, and over 45% 19 Sept–2 Oct.
  - Conception date was negatively related to density, and high air temperature during the rut delayed conception (search snippet).
  - Sources: [SLU news on the parturition study](https://www.slu.se/en/ew-news/2020/6/unique-study-moose-adapt-their-calving-to-the-climate); [Dryad parturition data](https://datadryad.org/stash/dataset/doi:10.5061/dryad.ghx3ffbkg); [Alces: Geographical variation in mating and calving periods of moose](https://alcesjournal.org/index.php/alces/article/view/803)
- **[G] Mississippi (MDWFP):**
  - The agency publishes a "Simulated Mean Conception Date Map" built from herd-health fetal data: collection dates, mean conception date and conception range.
  - Press coverage of the agency data: the average breeding date in extreme SE Mississippi is about five weeks later than parts of the Delta.
  - "Hunter-observable rutting activity peaks about two weeks prior to the mean breeding date" [H].
  - Sources: [MDWFP deer breeding date map](https://www.mdwfp.com/wildlife-hunting/deer-program/deer-breeding-date-map/); [Mississippi Sportsman](https://mississippisportsman.com/hunting/deer-hunting/mapping-mississippis-breeding-period/)
- **[H] Southeast rut spreads (press, citing agencies):**
  - North Carolina peaks go from about 25 Oct (Lower Coastal Plain) to about 1 Nov (Upper Coastal Plain), mid-Nov (Piedmont), 21 Nov (Foothills) and end of November (Mountains).
  - South Carolina peak conception about 30 Oct.
  - Georgia from mid-October on the coast to late December at the SW border.
  - Southern variation is attributed to "climate, genetics, nutrition, sex ratio and radically different day lengths".
  - Sources: [Deer & Deer Hunting: southern rut](https://www.deeranddeerhunting.com/southern-rut); [D&DH: Southern Whitetail Rut](https://www.deeranddeerhunting.com/?p=183573)
- **[G/H] Northern deer:**
  - New Jersey Fish & Wildlife: rut peaks 3–23 Nov for northern adults.
  - A former Vermont deer project leader's fetal data: peak conception in the third week of November.
  - Peak breeding in the North "occurs consistently from early to mid-November based on photoperiod" (press).
  - Sources: [NJ Fish & Wildlife, Biology of the White-tailed Deer](https://deptest.nj.gov/njfw/?p=12443); [UC Hunting Properties blog](https://www.uchuntingproperties.com/blog/northeast-late-fawn-drop-validates-last-seasons-mid-november-rut/)
- **[H] Berries:**
  - Black huckleberry (*Vaccinium membranaceum*) ripens about mid-July in Glacier NP. Elevation delays ripening through slower growing-degree-day accumulation, by "several weeks between valley floors and higher slopes".
  - Bears forage at the ripening elevation in late July and August.
  - These are low-quality sources; treat as indicative only.
  - Sources: [wildhuckleberry.com](https://wildhuckleberry.com/?p=2102); [ScienceBase huckleberry item](https://sciencebase.gov/catalog/item/5ee3b16982ce3bd58d7e1cae)

### Inferences
- **Moose rut:** keep about 23 Sept–8 Oct as the core window everywhere in North America. Possibly shift a few days later above about 60–64° N, by analogy with the Swedish calving breakpoint, but this is unproven for North America. Add a heat modifier: hot rut days lower daytime activity and may delay conception, so tie it to the live temperature against local Tave09/Tave10.
- **Deer rut:**
  - A table keyed by state, province or agency region (conception date maps exist for MS, AL, GA, NC, SC, etc.).
  - Default for the North (above about 40° N): peak conception about 10–20 Nov. The hunter-visible chasing peak is about 2 weeks earlier, per MDWFP.
  - Do not interpolate southern deer rut by latitude. Local genetics from restocking break the photoperiod relationship.
- **Leaf-off:** use the MCD12Q2 multi-year median of senescence/dormancy (2001–2023) per tile as the "late fall" switch for cover value. This replaces the fixed date. Mountain tiles get it earlier at higher Δz automatically, because MCD12Q2 is per 500 m pixel. Within a 500 m pixel, Hopkins' rule (about 4 days per 122 m) can adjust autumn timing to earlier with elevation.
- **Berries:** model ripening as a degree-day target (DD5 accumulated from snow-off) rather than a date, so latitude and elevation follow from climate. Validating specific DD targets for *Vaccinium*, *Shepherdia* and *Empetrum* is a gap.

### Gaps
- No continent-wide machine-readable deer conception-date map was found; the QDMA/NDA "Whitetail Report" series could not be reached in this pass. The Alabama DCNR breeding chart and Georgia, NC and SC agency maps were found only through press.
- North American moose conception dates by latitude (Schwartz's review) could not be read; the scanned PDF has no text.
- No peer-reviewed degree-day thresholds for berry ripening in boreal and subalpine Canada were retrieved.
- VNP22Q2 resolution and latency were not confirmed, and neither was whether MCD12Q2 production continues past 2023.

---

## 6. Species range and regulation data

### Takeaway
- For a range gate, the **USGS GAP** models are open 30 m habitat maps covering the US (CONUS, AK, HI, PR). Canada has no equivalent single open source.
- Use provincial and territorial range maps plus GBIF occurrences as a sanity check. IUCN ranges are coarse, and their terms of use need checking for commercial use.
- **No unified machine-readable hunting-season source exists.** Season data are agency PDFs, web pages and occasional open-data tables (e.g. Maryland). The aggregators (GoHunt) build their own databases.

### Cited Findings
- **[G] USGS GAP species distribution models:**
  - 30 m "deductive" habitat models from published habitat associations plus land cover, elevation and hydrology.
  - More than 2000 vertebrates across CONUS, Alaska, Hawaii, Puerto Rico and USVI.
  - GAP *ranges* are usually described as mapped on 12-digit HUCs; this was not verified on the pages read.
  - Distributed via ScienceBase and the GAP Species Viewer; a white-tailed deer habitat map exists on ScienceBase.
  - Sources: [USGS GAP SDM collection (ScienceBase)](https://sciencebase.gov/catalog/item/53ebb9a5e4b0461e44772d9e); [USGS fact sheet 2013-3087](https://pubs.usgs.gov/fs/2013/3087/pdf/fs2013-3087.pdf)
- **[G] Maryland** publishes a "Hunting Dates" dataset in its open data catalogue (federated on AmeriGEOSS/data.gov). Most agencies publish seasons as web pages and PDFs, not APIs. — [AmeriGEOSS Hunting Dates](https://data.amerigeoss.org/dataset/hunting-dates)
- **[G] Yukon** posts season-opening notices as news releases on open.yukon.ca, not as structured data. — [open.yukon.ca 2020 release](https://open.yukon.ca/information/news-releases-2020/resource/53788423-1dac-43ac-bc56-1604c9ab5765)
- **[H] GoHunt** compiles its own draw-odds database from state data. It claims these are "more accurate than the simple state odds", offers unit profiles "for every single hunt unit in the west", and updates state by state. — [GoHunt Draw Odds](https://www.gohunt.com/draw-odds); [GoHunt announcement](https://gohunt.com/browse/news-and-updates/announcements/draw-odds-updated-for-alaska-arizona-colorado-oregon-utah-and-wyoming)

### Inferences
- **Range gate per tile:**
  - US: GAP range (HUC12) plus GAP habitat.
  - Canada: provincial and territorial range layers where open, otherwise a GBIF occurrence density buffer.
  - Hand-curated overrides for edge cases. For example, elk in the Sault area has range-edge animals but no season, as already noted in docs/ELK-SCIENCE.md.
- **Season dates** will need a hand-maintained table per jurisdiction × WMU/GMU × species, sourced from regulation PDFs. Store them as data with "verified on" dates. The app should show "check regulations", not legal advice.
- The **rut and season overlap** is what hunters care about. Phenology (§5) and season tables should share one per-jurisdiction record.

### Gaps
- The terms of use for IUCN Red List spatial data (commonly non-commercial) and NatureServe range maps were not verified in this pass. Commercial use needs checking.
- GBIF occurrence licensing per record (CC0/CC BY/CC BY-NC mix) was not reviewed.
- BC, Ontario and Quebec open range maps for moose, deer, black bear and grouse were not individually located.
- No structured, API-style source for Canadian provincial hunting seasons was found.

---

## 7. Transferability of habitat models

### Takeaway
The literature is consistent: habitat selection is **context-dependent**. The same habitat type is selected differently depending on how much of it is available and how rich the surroundings are (functional responses). A fixed set of weights tuned in one place will be biased elsewhere.

The tools that address this are:
- **Generalized functional responses (GFR)**: RSF coefficients written as functions of availability (Matthiopoulos et al. 2011).
- **Availability interactions or splines** (Aarts et al. 2013).
- Hierarchical or recalibrated models using local data.

Moose RSPFs from Ontario transferred to another site with little loss in *ranking* ability (ROC). They failed to predict *abundance* across management units, with errors tied to forage availability.

### Cited Findings
- **[S] Mysterud & Ims 1998, Ecology 79(4):1435–1441,** "Functional responses in habitat use: availability influences relative use in trade-off situations". This is the founding paper for availability-dependent selection. Full text not fetched; citation from memory. — [DOI](https://doi.org/10.1890/0012-9658(1998)079[1435:FRIHUA]2.0.CO;2)
- **[S] Matthiopoulos, Hebblewhite, Aarts & Fieberg 2011, Ecology 92(3):583–589:**
  - "An empirical model fit to data from one place or time is unlikely to capture species responses under different conditions because organisms respond nonlinearly to changes in habitat availability."
  - GFRs model "the regression coefficients of the underlying RSF as functions of availability", using several sampling instances with diverse availability profiles. They can therefore "predict population distributions in new environments".
  - Source: [St Andrews research portal](https://research-portal.st-andrews.ac.uk/en/publications/generalised-functional-responses-for-species-distributions/)
- **[S] Aarts, Fieberg, Brasseur & Matthiopoulos 2013, J. Animal Ecology 82(6):1135–1145:** models with non-linear b-spline effects and "interactions between environmental covariates and habitat availability measures performed best". The relative influence of availability can be estimated, not fixed beforehand. — [Glasgow eprints](https://eprints.gla.ac.uk/78763)
- **[S] Yates et al. 2018, Trends Ecol. Evol. 33(10):790–802,** "Outstanding Challenges in the Transferability of Ecological Models". A survey of 50 experts set the priority knowledge gaps that limit transfer of predictions to novel conditions. — [St Andrews repository](https://research-repository.st-andrews.ac.uk/handle/10023/19222)
- **[S] Gaudry et al. 2018, Scientific Reports (roe deer, 3 French populations, 61 GPS females):**
  - "The use of a given habitat type does not only depend on its availability within the home range, but also depends on the general context where it is available."
  - Functional responses appeared in poor environments; there was little selectivity in rich ones.
  - Source: [PMC5865119](https://pmc.ncbi.nlm.nih.gov/articles/PMC5865119/)
- **[S] Moose RSPF transfer in Ontario (Kerckhoff, McLaren, Mahoney & Knight, Alces; thesis at Lakehead):**
  - "Models lost little predictive power when applied to another site", based on ROC comparisons.
  - But "the RSPF failed to predict carrying capacities in management units across Ontario". The differences "varied predictably with differences in covariates related to forage availability, suggesting habitat selection strength and RSPF transferability vary with landscape quality".
  - Source: search-snippet abstract; page 404 on fetch. — [Alces article](https://alcesjournal.org/index.php/alces/article/view/115); [Kerckhoff 2011 thesis](https://knowledgecommons.lakeheadu.ca/jspui/bitstream/2453/465/1/KerckhoffK2011m-1a.pdf)
- **[G] USFWS HSI for moose, Lake Superior region (Allen, Jordan & Terrell 1987, FWS/OBS 82/10.155):**
  - Index 0–1 from four landscape variables: % regenerating forest, % non-forested wetland, % spruce/fir and % deciduous/mixed forest.
  - Expert-based, drawing on Peek et al.
  - A later "application and partial validation" was published.
  - Sources: [USGS pub](https://www.usgs.gov/publications/habitat-suitability-index-models-moose-lake-superior-region); [Partial validation](https://pubs.usgs.gov/publication/70126469)
- **[G] Quebec moose habitat quality index:** Quebec publishes its own moose "indice de qualité de l'habitat" (IQH). — [Quebec IQH orignal PDF](https://cdn-contenu.quebec.ca/cdn-contenu/faune/documents/habitats/indice-qualite-habitat-orignal.pdf)
- **[S] Regional differences in moose habitat use:** RSF studies reject a single model across resident and migratory moose from two regions, and moose response to roads differs between regions (search summary). — [USU digital commons](https://digitalcommons.usu.edu/wild_facpub/2768)

### Inferences
- **What to do instead of one set of weights:**
  - (1) Express each rule weight as a function of **local availability within the tile or home-range window** (GFR-style). For example, the value of a shrub cell rises when shrub is scarce in the surrounding 2–5 km and saturates when it is everywhere. Groundwind's heat map already uses window scoring, so this fits.
  - (2) Add **climate and Δz covariates** to weights, e.g. conifer cover value rises with PAS and the live snow depth.
  - (3) Calibrate with **local evidence**: hunter sightings and harvest pins in the app, and public telemetry (Movebank) where licensed. Use them as a hierarchical prior per ecoregion rather than a full refit.
- **Keep scores relative.** The Ontario moose result says ranking transfers better than absolute density. Present per-tile percentiles ("best 10% here") rather than absolute "moose per km²".
- **HSI and IQH as a cross-check.** The 1987 Lake Superior moose HSI variables (regen %, non-forested wetland %, spruce-fir %, deciduous-mixed %) are close to the current Ontario rules. They give an agency-documented baseline for the boreal-flat profile; Quebec's IQH gives another.

### Gaps
- No western or Alaska moose HSI variants were located in this pass (e.g. Alaska Interior/subalpine HSI or BC MoE moose capability models).
- No meta-analysis quantifying how much RSF performance drops with ecological distance (e.g. by CEC ecoregion) was found.
- Van Beest et al. (density-dependent functional responses in large herbivores) was seen only in a figure caption and not reviewed.

---

## 8. Competitors: how hunting apps regionalise predictions (public documentation only)

### Takeaway
No competitor publicly documents location-adaptive *habitat rules* of the kind proposed here. Their regional predictions are about **deer movement timing**, built from weather, moon and pressure plus proprietary training data:
- Spartan Forge: state-agency collar studies.
- onX: trail-camera images.
- HuntStand: "decades of observational data" plus satellite AI, for a monthly whitetail habitat-suitability map.

GoHunt regionalises **draw odds and units**, not habitat. Contors (the closest rival) markets an assistant that "reads the terrain, the cover, the wind and the season" but documents no method.

### Cited Findings
- **[H] Spartan Forge:**
  - Uses "data from multiple collared deer studies conducted by state agencies across different regions" (claimed more than 2,000 collective deer-years).
  - Paired with weather forecast, wind, barometric pressure, humidity, sunrise/sunset and moon position.
  - Predicts how likely deer are to move and whether they stay near bedding.
  - The founder claims "65 percent accurate" on a collared deer study.
  - Source: [Outdoor Life](https://www.outdoorlife.com/hunting/spartan-forge-hunting-app/)
- **[H] HuntWise HuntCast:** analyses "hundreds of movement factors" (temperature changes, wind, moon phase, barometric pressure, fronts) into an hour-by-hour, species-specific "Huntability" score from 1 to 10. — [HuntWise: How HuntCast helps](https://huntwise.com/field-guide/deer/how-huntcast-helps-you-plan-a-better-whitetail-hunt); [HuntCast feature page](https://huntwise.com/features/huntcast)
- **[H] onX Deer Movement Forecast:** combines "100+ million anonymized trail camera images" with "50+ environmental factors" (temperature, wind, pressure, moon, hunting pressure). Gives hour-by-hour and 7-day forecasts "for your area". No data partners are named. — [onX feature page](https://www.onxmaps.com/hunt/app/features/deer-movement-forecast)
- **[H] HuntStand Pro Whitetail:** a "Whitetail Habitat Map" that "estimates an area's suitability for whitetails at a granular, monthly level using decades of observational data combined with advanced satellite measurements and artificial intelligence". It also has rut-information layers, crop history and a "Whitetail Activity Forecast". — [Hunting Life announcement](https://huntinglife.com/huntstand-announces-powerful-new-app-tier-focused-on-whitetail-deer); [Bowhunters United](https://bowhuntersunited.com/2022/10/25/up-your-whitetail-hunting-game-with-this-new-popular-app-tier)
- **[H] GoHunt Insider:** draw odds compiled by in-house data scientists, predictive draw odds, filtering tools, and profiles for every western hunt unit. — [GoHunt Draw Odds](https://www.gohunt.com/draw-odds); [Field & Stream guide](https://www.fieldandstream.com/hunting/gohunt-insider-guide)
- **[H] Contors (iOS):**
  - "Scout… reads the terrain, the cover, the wind and the season, then tells you where to sit and why."
  - A hunt journal auto-fills stand, wind, temperature, pressure and moon.
  - Offline maps; the free tier includes one property, USGS topo, LiDAR hillshade and public land.
  - Source: [App Store listing](https://apps.apple.com/app/id6790434038)

### Inferences
- The competitive gap is real. Others regionalise *when* deer move (weather plus collars or cameras) or *where you can draw*. None publicly regionalises *what habitat means* by ecoregion, treeline and snow for multiple species including moose, bear and grouse.
- HuntStand's "monthly" habitat suitability is the closest analogue: a seasonal habitat map.
- Spartan Forge's "state agency collar studies across regions" is the closest to a recalibration-by-region approach, but only for whitetail.
- Vendor accuracy claims (e.g. 65%) are unverifiable and have no stated baseline.

### Gaps
- None of these vendors publishes methods, validation, or how they handle regions without training data. Only marketing claims were found.
- Contors' regional coverage and any methodology were not documented beyond the App Store text.
- onX's elk and mule deer tools, and any onX habitat layers, were not checked.
