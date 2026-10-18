# Alberta Base Features access layers, measured in the Clearwater box (2026)
- **Source:** Government of Alberta (Alberta Environment and Parks), Base Features "Access and Facility Roads" (FeatureServer layer 0; portal item fb8aad1ca27f413b931bd39981489e36) and "Cutline" (access MapServer layer 30); Alberta Transportation and Economic Corridors, *Alberta highways 1 to 986: traffic volume history 2016–2025* (xlsx, produced 2026-02-27); Alberta "Protected Area Designations" layer; RecAccess grazing layer; Open Government Licence – Alberta v2.2.
  - https://geospatial.alberta.ca/titan/rest/services/transportation/access_facility_roads/FeatureServer/0
  - https://geospatial.alberta.ca/portal/sharing/rest/content/items/fb8aad1ca27f413b931bd39981489e36?f=json
  - https://geospatial.alberta.ca/titan/rest/services/utility/access/MapServer/30
  - https://geospatial.alberta.ca/titan/rest/services/utility/access_utility/MapServer
  - https://open.alberta.ca/opendata/traffic-volumes-at-points-on-the-highway
  - https://geospatial.alberta.ca/titan/rest/services/boundary/parks_protected_areas_alberta/FeatureServer/0
  - https://geospatial.alberta.ca/titan/rest/services/recaccess/recaccess_grazing/MapServer/1
  - https://open.alberta.ca/licence
- **Read:** 2026-10-17 (agency service metadata, plus my own queries of those services. Every km, km/km² and % below is my measurement, not a published figure.)
- **Evidence:** [G]
- **Where and when:** Clearwater box 52.206–52.350 N × 115.368–115.133 W. That is 256.6 km² measured in EPSG:3400. Data as served on 2026-10-17. Distances are on a 50 m grid of 102,609 points.

## Extracted facts
- **Roads licence.** The roads item's `licenseInfo` reads: "Your use of the information will be governed by the terms of the Open Government Licence - Alberta, in force as of the date you accessed the information."
  - OGL–Alberta v2.2 grants use "including for commercial purposes".
  - Attribution when none is specified: "Contains information licensed under the Open Government Licence – Alberta."
  - The access_utility service (powerlines, facility polygons) carries the same OGL wording.
  - The cutline layer's metadata says only "Copyright Government of Alberta". I found no licence statement on that service.
- **What the roads layer is.** The service description says: "The Base Features Access Road spatial layer is the authoritative source of road data for the province of Alberta. It is a part of the Access data collection which also includes railways, powerlines, cutlines and trails, and industrial facilities."
- **Road schema.** FEATURE_TYPE is an integer subtype:

  | Code | Name |
  |---|---|
  | 1 | Ferry Crossing |
  | 2 | Ford/Winter Crossing |
  | 3 | Interchange Ramp |
  | 4 | One Lane Gravel Road |
  | 5 | Two Lane Gravel Road |
  | 6 | Divided Paved Road |
  | 7 | One Lane Undivided Paved Road |
  | 8 | Two Lane Undivided Paved Road |
  | 9 | Four Lane Undivided Paved Road |
  | 10 | Driveway |
  | 12 | Winter Road |
  | 14 | Dry-Weather Road |

  - ROAD_CLASS is a string: PRIMARY, SECONDARY, URBAN or OTHER.
  - HWY_NUMBER is a string, blank or " " when there is no number.
  - NAME is empty for every segment in the box.
  - The type names exist only as subtype labels. A GeoJSON or attribute export gives the integer.
- **Some numbered highways are gravel.** Province-wide segment counts by class and type include:
  - SECONDARY + type 5 (two-lane gravel): 4,046 segments;
  - PRIMARY + type 5: 230 segments.
- **Roads in the box: 668 segments, 265.7 km, 1.04 km/km².**

  | Type | Length | Density (km/km²) |
  |---|---|---|
  | 4, one-lane gravel | 177.4 km | 0.69 |
  | 14, dry-weather | 46.4 km | 0.18 |
  | 8, two-lane paved | 26.6 km | 0.10 |
  | 10, driveway | 9.7 km | 0.04 |
  | 5, two-lane gravel | 5.5 km | 0.02 |

  - The 26.6 km of type 8 is Hwy 752 (SECONDARY, 17.9 km) plus 8.7 km of paved OTHER, probably the North Fork Road.
  - All-weather roads (gravel + paved) total 209.5 km, 0.82 km/km².
- **Cutlines in the box: 3,318 segments, 918 km, 3.58 km/km².** These are Base Features 1:20,000 arcs.
  - The only FEATURE_TYPE present is "CUTLINE-TRAIL" (FEATURE_CODE DC76100000). The layer does not separate seismic lines, pipelines or OHV trails.
  - Length by CAPTURE_DATE year: 1984 366 km; 2005 373 km; 2006 55 km; 2011 58 km; 2015 67 km. These are mapping dates, not cut dates.
- **Share of the box within a distance of each feature set (50 m grid):**

  | Feature set | ≤150 m | ≤250 m | ≤500 m | ≤1 km | ≤2.5 km | Median | Max |
  |---|---|---|---|---|---|---|---|
  | All roads | 28.2% | 44.2% | 73.0% | 95.6% | 100% | 291 m | 1,705 m |
  | All-weather roads (gravel + paved) | 23.0% | 36.7% | 63.5% | 89.3% | 100% | 362 m | 2,689 m |
  | Paved | 3.1% | 5.1% | 10.2% | 20.3% | 47.7% | 2.6 km | 9.6 km |
  | Provincial highway (PRIMARY or SECONDARY = Hwy 752) | 2.1% | 3.5% | 7.0% | 13.9% | 33.6% | 3.9 km | 11.9 km |
  | Cutline-trails only | 70.4% | 88.6% | 98.7% | 100% | 100% | 89 m | 1,126 m |
  | Roads (no driveways) + cutline-trails | 79.3% | 94.2% | 99.8% | 100% | 100% | 71 m | 668 m |

- **Driveways (type 10):** 50 arcs, 9.7 km.
  - 5.9 km (31 arcs) lie in the White Area, which is only 20.8 km² (8%) of the box. 3.8 km (19 arcs) lie in the Green Area. I tested this against the Green/White Area layer: https://geospatial.alberta.ca/mimas/rest/services/boundaries/land_green_white_area_public/FeatureServer/0
  - Only 2 of the 50 arcs have an end within 150 m of a well surface hole.
  - So in this box "Driveway" is mostly farmyard and other private approaches, not well-site spurs. place-roads-alberta-access-layer.md calls them "mostly well-site and facility spurs"; this test does not support that.
- **Powerlines:** 5 segments in the box.
- **Hwy 752 traffic (AADT, two-way vehicles/day, 2025).**
  - 140 at "E OF 734 SW OF STRACHAN" and 150 at "N OF TOWER RD 35-36-11-5". Both are south-west of the box: section 35-36-11-W5 lies at 52.13–52.14 N, 115.45–115.48 W.
  - 1,000 at "W OF RGE RD 91 11-38-9-5" and 1,460 at "E OF RGE RD 91". Section 11-38-9-W5 lies at 52.246–52.261 N, 115.168–115.192 W, inside the box near its east edge.
  - The three south-west stations read 40–130 vehicles/day in 2016–2022. Hwy 734 north of the 752 junction read 140 in 2025.
  - The traffic dataset's licence is OGL–Alberta (`license_id: OGLA`).
- **Protected areas inside the box:** Prairie Creek PRA (37 ha), Prairie Creek Group Camp PRA (13 ha) and Strachan PRA (28 ha).
  - Cow Lake Natural Area (389 ha) lies 0.86 km east of the box.
  - A 1 km ring around the three PRAs covers 14.0 km², 5.5% of the box.
- **Grazing dispositions on the RecAccess map:** 9 GRL, covering 11.5 km² of the box (4.5%), and 1 FGL, covering 22.4 km² (8.7%).
- **Wells.** I counted from a hosted copy of AER ST37 surface holes (`AB_SurfaceHole_Locations` on services.arcgis.com, last edited 2022-08-04; "based on the ST37 report").
  - 209 surface holes in the box, at about 155 distinct surface locations when rounded to ~100 m. That is about 0.6 locations per km².
  - Status: Issued 68, Suspension 57, Amended 35, Abandoned 18, RecCertified 16, RecExempt 9, Re-Entered 6.
  - URL: https://services.arcgis.com/xYjDUN35YwdCEcMm/ArcGIS/rest/services/AB_SurfaceHole_Locations/FeatureServer/0

## What it means for Clearwater
- [I] **The road-distance access steps barely vary here.** 28% of the box gets 0.85 (≤150 m), 72% gets 1.0, and nothing reaches the 0.8 (2.5–4 km) or 0.5 (>4 km) steps. Pack-out cost is ≤1.7 km on the flat almost everywhere, plus modest climb. So access does not tell spots apart in Clearwater. Pressure does.
- [I] **Cutline-trails are everywhere: 79% of the box is within 150 m of a road or cutline-trail.**
  - If the bake fed them into the "×0.85 within 150 m of any road or trail" rule, nearly the whole map would take the same penalty.
  - Keep them out of the traffic factor. Use them, if at all, for "OHV can get within X m" (94% of the box within 250 m) or for predator travel.
- [I] **Hwy 752 is a high-traffic road by every published wildlife threshold.** It carries 150–1,000+ vehicles/day; the thresholds are ≥12/day for elk vigilance (Ciuti 2012) and >100/day for grizzly avoidance at all times (Northrup 2012, abstract level). The existing ×0.6 within 250 m of a paved highway fits it.
- [I] **Proposed road classifier for Alberta** (integer FEATURE_TYPE plus ROAD_CLASS):
  - **highway:** FEATURE_TYPE 3, 6, 7, 8 or 9, or ROAD_CLASS PRIMARY/SECONDARY whatever the surface. The ROAD_CLASS test catches gravel numbered highways.
  - **road:** types 4 and 5 (gravel), and 14 (dry-weather: a truck in dry weather or a quad gets meat out).
  - **trail:** types 12 (winter road) and 2 (ford/winter crossing).
  - **drop:** 1 (ferry) and 10 (driveway; private approaches, so not public access). Keep driveways as a house proxy instead: no discharge within 183 m of an occupied building.
  - **Open question:** whether the paved OTHER segments (8.7 km, probably the North Fork Road) are "highway". They are paved through roads with no provincial count. I'd class them as highway.
- [I] **About 155 well sites (~0.6/km²)** suggest many one-lane gravel roads are industrial spurs to pads; I did not test this road by road. Traffic on them is probably low except to active (Issued/Amended) wells and the gas plant. No counts exist.
- [I] **Licensing.** Roads and highway traffic are OGL–Alberta, safe for the paid HD tier with the attribution line. The cutline layer has no stated licence. Ask, or assume OGL only after confirming.

## Not confirmed
- Whether the cutline layer is under OGL–Alberta. No licence text appears on its service or item.
- Which cutline-trails are drivable, gated, regenerated, or used by OHVs. Base Features does not say.
- Traffic on gravel, dry-weather or county roads, including the North Fork Road. Alberta counts only provincial highways.
- Where along Hwy 752 inside the box traffic steps up from ~150 to ~1,000 vehicles/day. There is no count station between Tower Rd and RR 91.
- The well copy is from 2022 and is not the AER's own service. Pipelines were not quantified (see access-abmi-hfi-and-energy-data.md).
