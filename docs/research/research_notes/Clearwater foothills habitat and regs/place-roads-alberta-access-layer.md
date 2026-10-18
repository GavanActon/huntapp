# Roads in the box from Alberta's Access and Facility Roads layer

- **Source:** Alberta Environment and Parks, *Access and Facility Roads* ("Road Arcs"), feature service https://geospatial.alberta.ca/titan/rest/services/transportation/access_facility_roads/FeatureServer/0 (fields FEATURE_TYPE, NAME, HWY_NUMBER, ROAD_CLASS, GEO_SOURCE, GEO_DATE …); codes from the map service renderer https://geospatial.alberta.ca/titan/rest/services/transportation/access_facility_roads/MapServer/0 and the legend service https://geospatial.alberta.ca/titan/rest/services/boundaries/base_access_road_legend/MapServer/legend . Cross-check: OpenStreetMap via the Overpass API (ODbL).
- **Read:** 2026-10-17 (664 road arcs intersecting the region; lengths and distances computed in EPSG:3400 on a 120 m lattice)
- **Evidence:** [G] provincial base-feature layer; the statistics are my computation
- **Where:** the Clearwater region and core

## Extracted facts
- FEATURE_TYPE codes: 1 ferry crossing, 2 ford/winter crossing, 3 interchange ramp, 4 one-lane gravel road, 5 two-lane gravel road, 6 divided paved road, 7 one-lane undivided paved, 8 two-lane undivided paved, 9 four-lane undivided paved, 10 driveway, 12 winter road, 14 dry-weather road. ROAD_CLASS is SECONDARY for Hwy 752 (HWY_NUMBER 752), otherwise OTHER.
- Arcs in the region by type: one-lane gravel 433, dry-weather 93, two-lane paved 83 (59 of them Hwy 752), driveway 50, two-lane gravel 5.
- Density (km of road per km²): region 1.04 (one-lane gravel 0.69, dry-weather 0.18, two-lane paved 0.10, driveway 0.04, two-lane gravel 0.02); core 1.03 (paved 0.18); 5 km ring 0.97 (paved 0.19).
- Distance to the nearest road of any kind, share of the region within 100 / 250 / 500 / 1,000 / 2,000 m: 19 / 44 / 73 / 96 / 100%; farthest point 1.68 km. Core: 19 / 43 / 69 / 94 / 100%, farthest 1.68 km.
- Distance to a paved road, share of the region within 250 / 500 / 1,000 / 2,000 m: 5 / 10 / 20 / 39% (median 2.6 km); core 9 / 18 / 35 / 65% (median 1.5 km).
- The centre is 613 m from the nearest road and 2.74 km from the nearest paved road (Hwy 752, which with the North Fork Road forms the WMU 324/326 boundary). Of the 83 paved arcs, 59 are Hwy 752 (SECONDARY) and 24 are unnamed OTHER-class paved roads.
- The layer holds roads only: no seismic lines, pipelines, cutlines or quad trails. OSM in the box adds a handful of tagged "track" ways ("Quad Trail") and names such as Range Roads 90–100, Township Roads 382–392, the North Fork Road (tertiary) and the "Sunpine Mainline" (a logging haul road, unclassified, unpaved).

## What it means for Clearwater
- [I] Nowhere in the box is more than 1.7 km from a road. The pack-out access score (1.0 up to 1.6 km-equivalent) will be close to 1.0 everywhere on the flat; it will not separate cells. Pressure, not access, is the useful road term here.
- [I] For the bake's road classifier (`build_habitat.road_kind`), Alberta's words: FEATURE_TYPE 6–9 → highway (paved: Hwy 752, and 8.7 km of paved OTHER-class road that runs along the WMU boundary, i.e. the North Fork Road); 3 → highway; 4, 5 and 14 → road (a truck gets meat out on it); 2 and 12 → trail. Driveways (10): the access-alberta-access-layers-box-footprint.md test found 31 of the 50 arcs in the White Area and only 2 near a well, so they are mostly private approaches; drop them from access and keep them as a house proxy. Cutlines, seismic lines and pipelines need a separate layer (Base Features "Cutline", 3.58 km/km² here, or the ABMI Human Footprint Inventory; see access-*.md).
- [I] With the Alberta layer baked, the road-traffic factor would bite on ~10% of the region (within 500 m of paved road) and the "on a road or trail" ×0.85 on roughly 30% (within 150 m of any road).

## Not confirmed
- The layer's licence wording on the service (copyright text "Alberta Environment and Parks, Government of Alberta"); OGL-Alberta is likely but was not confirmed for this service (the access-*.md note checks it).
- Which gravel roads are gated or decommissioned, and traffic volumes.
