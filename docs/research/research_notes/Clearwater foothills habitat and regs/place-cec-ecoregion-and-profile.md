# CEC ecoregion at Clearwater, and the profile build_profile.py will write

- **Source:** Commission for Environmental Cooperation, *North American Terrestrial Ecoregions, Level III* (2006, v2), the service `pipeline/build_profile.py` queries: https://services7.arcgis.com/oF9CDB4lUYF7Um9q/ArcGIS/rest/services/NA_Terrestrial_Ecoregions_Level_3/FeatureServer/3/query ; the repo's `pipeline/build_profile.py`, `app/src/spots/profile.ts`, `placeRules.ts`, `huntRules.ts`; the Clearwater bake log `pipeline/bake-clearwater.log` (read-only, as of 21:14 on 2026-10-17).
- **Read:** 2026-10-17 (point queries at the centre and the four region corners; code read)
- **Evidence:** [S] for the ecoregion; the profile values are my reading of the code ([I])
- **Where:** centre 52.278114, −115.250061

## Extracted facts
- Centre and all four region corners: **Level I 5 "Northern Forests"; Level II 5.4 "Boreal Plains"; Level III 5.4.2 "Clear Hills and Western Alberta Uplands".**
- `build_profile.py`: `NORTH_L1 = {"2", "3", "6"}` (Tundra, Taiga, Northwestern Forested Mountains) and `NORTH_LAT = 57.0`, so `north = False` here.
- Treeline test: 98th percentile of treed cells and "land above it is a real share of the area (≥5%) and mostly open (≥60%)". From the national rasters the box gives 1,320 m, 2.0% above, 17% open (place-elevation-landcover-cuts-stands.md), so `treeline = null`.
- `stands`: `shrubHeight` only for `bc.vri` and `qc.ecoforestier`; `leadSpecies` false for `ca.scanfi` or no forest map. Tonight's bake log: "vectors: skipped, no vectors source for this area (bake.vectors)", "forest: skipped, no forest source for this area (bake.forest)", "satellite: skipped, no imagery source". `bake_area.py`'s per-jurisdiction defaults (`bake_by`) have entries for ON, YT, BC and QC only, none for AB.
- With treeline null and north false, `profile.ts` and the rules give: no `dz` (moose band, dwarf-shrub cap, open-country terms, forest-grouse band all off); the Ontario disturbance curve; the Ontario rut curve; the Ontario black bear rule (jack-pine bonus, 15 Oct late-fall switch); `presence('grizzly')` = 'absent' and `presence('ptarmigan')` = 'absent' unless the species table says otherwise; with `zone.name` null, no species-table entry, so every target shows and no season lines appear. `FISH_HERE` is false (jurisdiction not ON).
- `area_checklist.py`: `MODEL_FIT` has no "AB" entry, so the Model row will read "rules written for boreal Ontario, not checked in AB's country" (warn); the Leaf calendar row will warn because 52.3° N > `LEAF_LAT` 52.0 and the area file has no `leaves`.

## What it means for Clearwater
- [I] The profile machinery treats Clearwater as boreal Ontario, which is broadly right for the terrain (no treeline, not the far north) and wrong in four places that the profile cannot express today: grizzlies (present, protected), the deer (white-tailed deer of the foothills, the main game), fields and young cutblocks (holes in the grid without the forest adapter), and the regulations (two WMUs).
- [I] The `north` flag being false is right: the Yukon/Alaska burn and rut calendars should not apply at 52° N in the Boreal Plains ecoregion.

## Not confirmed
- At first these values were predicted from the code and the rasters. At 22:50 EDT the bake's `profile` step had written them into the area file, and they matched exactly (read-only check): `"treeline": null`, `"ecoregion": {"cec1": "5", "cec2": "5.4", "cec3": "5.4.2", "name": "Clear Hills and Western Alberta Uplands", "family": "Boreal Plains"}`, `"north": false`, `"stands": {"shrubHeight": false, "leadSpecies": false}`.
- By then the bake session had also set `zone` to `{label: 'WMU', name: '326'}` and relief to [1070, 1328]. `bake.forest` and `bake.vectors` were still null.
