# Land status, tenure and wildlife zones over the Clearwater box

- **Sources (Government of Alberta feature services, OGL-Alberta unless noted; queried 2026-10-17 and intersected with the box in EPSG:3400):**
  - Green/White Area: https://geospatial.alberta.ca/mimas/rest/services/boundaries/land_green_white_area_public/FeatureServer/0
  - Public Lands Camping Pass area: https://geospatial.alberta.ca/mimas/rest/services/boundaries/land_public_land_camping_pass_public/FeatureServer/0
  - Public Land Use Zones: https://geospatial.alberta.ca/mimas/rest/services/boundaries/land_public_land_use_zone_public/FeatureServer/0
  - Indigenous land (reserves, Métis settlements, treaty): https://geospatial.alberta.ca/mimas/rest/services/boundaries/indigenous_land_public/FeatureServer
  - Rangeland management zones: https://geospatial.alberta.ca/titan/rest/services/boundaries/land_rangeland_mgmt_zone/FeatureServer/0 ; Forest Reserve range distribution units: https://geospatial.alberta.ca/titan/rest/services/rangeland/forest_reserve_range_distribution_units/FeatureServer/0
  - Recreational access, grazing dispositions: https://geospatial.alberta.ca/titan/rest/services/recaccess/recaccess_grazing/MapServer/1
  - Forest Management Agreements and Units: https://geospatial.alberta.ca/titan/rest/services/boundaries/forest_management_agreement_public/FeatureServer/0 ; https://geospatial.alberta.ca/titan/rest/services/boundaries/forest_management_unit_public/FeatureServer/0
  - Municipality: https://geospatial.alberta.ca/titan/rest/services/boundaries/municipal_boundary_public/FeatureServer/3
  - Wildlife sensitivity (grizzly zones, Key Wildlife and Biodiversity Zones, caribou, sheep and goat): https://geospatial.alberta.ca/titan/rest/services/biota/wildlife_sensitivity_mammals_10tm_nad83_aep/MapServer (layers 184 core, 187 secondary, 198 linkage, 199 support, 180 caribou, 4 sheep/goat) and https://geospatial.alberta.ca/titan/rest/services/biota/wildlife_sensitivity_key_wildlife_and_biodiversity_zone/MapServer/3
  - Protected areas (CPCAD): https://geospatial.alberta.ca/mimas/rest/services/gstplanning/cpcad_alberta_multiparts/FeatureServer/0
- **Read:** 2026-10-17
- **Evidence:** [G] provincial administrative and wildlife-sensitivity layers
- **Where:** region 256.6 km², core 99.6 km², 5 km ring round the centre

## Extracted facts
| Layer | Region | Core | 5 km ring | Centre |
|---|---|---|---|---|
| Green Area (public forest) | 91.9% | 96.7% | 96.1% | in |
| White Area (settled, mostly private) | 8.1% | 3.3% | 3.9% | out (east edge: east of about 115.18° W between 52.26 and 52.29 N, and a strip along the east side further north) |
| Rangeland zone "Rocky Mountain Forest Reserve North" | 26.9% | 23.3% | 18.9% | out (west third, west of about 115.29° W and south of 52.32° N) |
| Rangeland zone "Rocky North" | 73.1% | 76.7% | 81.1% | in |
| Forest Reserve grazing allotment "Prairie Creek" (Dry Creek DU, 24,327 acres) | 9.9% | 7.7% | 4.1% | out |
| Grazing dispositions (GRL leases, FGL forest grazing licences; 10 polygons) | 13.2% | 3.2% | 3.1% | out, 3.5 km away |
| Public Lands Camping Pass area ("Eastern Slopes Following Highways and Porcupine Hills PLUZ") | 100% | 100% | 100% | in |
| Public Land Use Zone | 0 | 0 | 0 | nearest Kiska/Willson 25 km W of the region; Upper Clearwater/Ram 36 km |
| First Nation reserve or Métis settlement | 0 | 0 | 0 | Treaty 6 territory |
| Protected area (CPCAD multiparts layer) | 0 | 0 | 0 | but see the next row: that layer misses the small recreation areas |
| Provincial Recreation Areas (Alberta "parks_protected_areas_alberta" layer, https://geospatial.alberta.ca/titan/rest/services/boundary/parks_protected_areas_alberta/FeatureServer/0) | 3 sites, 79 ha | | | Prairie Creek PRA 37 ha (centroid 52.249, −115.305; 4.5 km from the centre), Strachan PRA 28 ha (52.263, −115.174; 5.0 km), Prairie Creek Group Camp PRA 13 ha (52.241, −115.312; 5.6 km). All "Former Alberta Forest Recreation Area. Transferred to Alberta Parks in 1996." Cow Lake Natural Area (389 ha) lies 0.9 km east of the box. |
| West Fraser Alberta Wood Products (Sundre) FMA, FMA 9200030 | 83.9% | 86.9% | 85.6% | in |
| FMU R10 / R51 | 90.6 / 9.4% | 95.2 / 4.8% | | R10 |
| Grizzly Bear Zone – Secondary | 76.9% | 86.8% | 90.3% | in |
| Grizzly Bear Zone – Support | 23.1% | 13.2% | 9.7% | out |
| Grizzly Bear Zone – Core | 0 | 0 | 0 | 10.4 km away |
| Key Wildlife and Biodiversity Zone | 6.1% | 6.7% | 6.6% | 1.5 km away |
| Caribou range; sheep/goat areas | 0 | 0 | 0 | |

- Key Wildlife and Biodiversity Zones in the region total 15.7 km²; 70% of that lies within 500 m of Prairie Creek or North Prairie Creek (OSM stream lines), so they are mainly the two creek valleys.
- Municipality: Clearwater County (MD 0377), which gives the area its name.
- The rangeland zone and allotment layers are grazing administration; the "Rocky Mountain Forest Reserve North" zone is used here as a proxy for the Forest Reserve's extent, not its legal boundary.

## What it means for Clearwater
- [I] Nearly all of it is public land a hunter can walk onto. The exceptions are the White Area quarter-sections on the east edge (private: permission to enter and to hunt) and the grazing leases (contact the leaseholder; access-*.md has the rules).
- [I] Grizzlies are expected: the box is grizzly Secondary Zone, so the app should carry the grizzly kill-site card even though there is no grizzly season (regs.ts `grizzly: noSeason`).
- [I] The Key Wildlife and Biodiversity Zones (6%) are the province's ungulate winter-range and valley mapping; they are a candidate input for a winter or late-fall valley term.
- [I] Random camping needs the Public Lands Camping Pass everywhere in the box (cost and rules: access-*.md).
- [I] The three recreation areas are no-hunting, no-discharge ground (the 2026 guide: "In general, hunting or discharging a firearm (or bow) is prohibited in provincial parks and provincial recreation areas", and none of these three is among its exceptions), and black bear bait is barred within 1.6 km of them. They are small (79 ha in all) but sit on Prairie Creek and by Strachan, where hunters camp; the app should mask them or carry a line.

## Not confirmed
- The legal Rocky Mountain Forest Reserve boundary (no open boundary layer found; the zone proxy may differ).
- Which White Area parcels are cultivated, fenced or posted.
