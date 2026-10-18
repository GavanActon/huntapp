# Alberta Wildlife Management Units: which WMU the Clearwater box is in

- **Source:** Government of Alberta, *Wildlife Management Unit* (open data, OGL-Alberta; dataset modified 2025-07-31, record updated 2026-09-06), https://open.alberta.ca/opendata/gda-937714ca-daad-4b7b-be9f-35a4b9cbd3c0; feature service https://geospatial.alberta.ca/mimas/rest/services/boundaries/fishwild_wildlife_mgmt_unit_public/FeatureServer/0 (fields WMUNIT_NAME, WMUNIT_CODE). Legal descriptions: https://www.albertaregulations.ca/huntingregs/wmu/324.html and https://www.albertaregulations.ca/huntingregs/wmu/326.html
- **Read:** 2026-10-17 (point and envelope queries; polygons downloaded as GeoJSON and intersected with the area box in EPSG:3400)
- **Evidence:** [G] official boundary layer ("an area of wildlife managed under Wildlife Act, Alberta Regulation 143/79")
- **Where and when:** area file app/src/areas/clearwater.json: centre 52.278114, −115.250061; region −115.368…−115.133 × 52.206…52.350; core −115.323…−115.177 × 52.233…52.323

## Extracted facts
- Point query at the centre: **WMU 326 "Baseline"** (WMUNIT_CODE 00326).
- The region straddles two units: **WMU 324 "Prairie Creek"** 53.0% of the region, 36.1% of the core, 28.6% of the 5 km ring round the centre; **WMU 326 "Baseline"** 47.0% of the region, 63.9% of the core, 71.4% of the 5 km ring. Region 256.6 km², core 99.6 km².
- The shared boundary in the box runs NW–SE along the North Fork Road, then west and south-west along Secondary Road 752; 326 is the wedge west of the North Fork Road and north of Hwy 752; 324 lies north-east of the North Fork Road and south of Hwy 752. The centre is 2.7 km from the boundary; the core's south-west corner is 80 m from it.
- WMU 324 legal description (as printed): "Commencing where highway 11 crosses the North Saskatchewan River near Rocky Mountain House; thence southeasterly along highway 11 to highway 22; thence southerly along highway 22 to highway 54 … to the right bank of the Clearwater River; thence upstream … to the west boundary of range 8, west of the fifth meridian; thence north … to the junction of secondary road 591 and the road locally known as the Swan Lake road; thence northwesterly along the Swan Lake road to secondary road 752; thence northeasterly along secondary road 752 to the road locally known as the North Fork road; thence northwesterly and westerly along the North Fork road to the right bank of the Ram River; thence downstream … to the North Saskatchewan River …"
- WMU 326 legal description: "Commencing at the point where the road locally known as the North Fork road crosses the Ram River in township 39, range 10, west of the fifth meridian; thence southeasterly along the North Fork road to secondary road 752; thence southwesterly along secondary road 752 to the road locally known as the Swan Lake road; thence southeasterly along the Swan Lake road to its junction with secondary road 591 … to the right bank of the Clearwater River; thence upstream … to secondary road 734; thence … along secondary road 734 to the right bank of the Ram River; thence downstream … to the point of commencement."
- Surrounding units (envelope query): 318 James, 320 Bearberry, 322 Horseguard, 328 Schunda, 330 O'Chiese, 332 Alder Flats, 417 Wilson, 420 Clearwater, 422 Hummingbird, 428 Kiska, 429 Meadows. (WMU 420 is the one named "Clearwater"; it is a mountain unit to the west, not this box.)
- Alberta designations: both units are **Foothills (300-series) WMUs**; area biologist for both: Rocky Mountain House Fish and Wildlife office (WMU biologist contact layer, https://geospatial.alberta.ca/titan/rest/services/boundaries/fishwild_wmu_biologist_contact_public/FeatureServer/0).
- WMU sizes (aerial survey reports): 324 is 1,026 km², 326 is 1,046 km².

## What it means for Clearwater
- [I] `zone.name` should be **"326"** (the centre), with the 324 entry beside it; the regs differ between them for deer and moose (regs-alberta-hunting-guide-2026.md), so the area needs per-cell zones or at least a line naming the road that divides them.
- [I] The area's name comes from Clearwater County (the municipal district), not from WMU 420 "Clearwater" or the Clearwater River, which is 22 km away.

## Not confirmed
- The service is the "public" generalisation; the legal boundary is the regulation text. Where the two disagree by a few metres along the roads, the text governs.
