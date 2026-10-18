# ABMI ruffed grouse habitat and footprint models, forested Alberta (2023)
- **Source:** Alberta Biodiversity Monitoring Institute (ABMI). Ruffed Grouse (*Bonasa umbellus*, TSN 175790) species profile (UpdateVersion 2023; text QA 2017–2018) and Biodiversity Browser chart data (model years 2019 and 2023); https://abmi.ca/species/ruffed-grouse ; raw model output: https://web-api-2021.abmi.ca/abmi-data-api/bio-browser-chart/get-species-abundance-data?tsn=175790&year=2023&isSpecies=true , .../get-linear-data?tsn=175790&year=2023&isSpecies=true , .../get-sector-data?tsn=175790&year=2023&isNorth=true&isSpecies=true ; profile text: https://abmi.ca/.ajax/species-profile/single-profile?sname=Bonasa%20umbellus&forNL=false
- **Read:** 2026-10-17 (agency page plus raw JSON behind its charts)
- **Evidence:** [S] agency science. These are province-wide ABMI species habitat models built from point-count and ARU detections, so they reflect the breeding season, not fall.
- **Where and when:** Alberta's forested region (Boreal, Foothills, Canadian Shield and Rocky Mountain natural regions), ABMI monitoring sites, model versions 2019 and 2023. Spring and early-summer surveys pick up drumming and calls.

## Extracted facts
- Range: "most common in the Foothills and Boreal Forest Natural Regions", "preferring Trembling Aspen and spruce habitats in the Boreal Forest and Foothills Natural Regions."
- "Ruffed Grouse relative abundance is predicted to be highest in mid-aged deciduous and mixedwood forest stands, followed by mid-aged White Spruce forest stands and the treed swamp vegetation type". It is "higher in harvested compared to naturally disturbed forests of the same age and type", and "essentially absent from the shrubby bog vegetation type and the rural residential, urban/industrial and industrial (rural) human footprint types".
- "Forestry footprint has the strongest positive unit effect and largest overall effect"; "Agriculture footprint has a negative unit effect". Sector effects (2023, forested region), local / regional: forestry +220% / +15.3%; agriculture −71% / −4.7%; energy −10.8% / −0.2%; transportation −8.5% / −0.1%.
- Linear footprint, local effect inside the feature vs the habitat it replaced (2023): seismic lines +32.6%; pipelines and transmission lines +29.6%; "road and rail verges" +16.9%; "roads and rails" (surfaces) −100%.
- Chart caption: bars are vegetation types; "Dots are added to forest types where harvesting occurs and show the predicted species abundance in harvested stands of various ages."
- Relative abundance, 2023 model. The number in brackets is the ratio to the maximum, harvested deciduous at 10 yr (0.0450):

| Stand | 0 yr | 10 | 20 | 40 | 60 | 80 | 100 | 140 |
|---|---|---|---|---|---|---|---|---|
| Deciduous, harvested | 0.0265 (0.59) | 0.0450 (1.00) | 0.0396 (0.88) | 0.0287 (0.64) | 0.0244 (0.54) | | | |
| Deciduous, natural | 0.0101 (0.22) | 0.0204 (0.45) | 0.0237 (0.53) | 0.0248 (0.55) | 0.0229 (0.51) | 0.0198 (0.44) | 0.0165 (0.37) | 0.0103 (0.23) |
| Mixedwood, harvested | 0.0107 (0.24) | 0.0353 (0.78) | 0.0360 (0.80) | 0.0282 (0.63) | 0.0224 (0.50) | | | |
| Mixedwood, natural | 0.0041 (0.09) | 0.0167 (0.37) | 0.0216 (0.48) | 0.0242 (0.54) | 0.0213 (0.47) | 0.0164 (0.36) | 0.0114 (0.25) | 0.0046 (0.10) |
| White spruce, harvested | 0.0084 (0.19) | 0.0283 (0.63) | 0.0318 (0.71) | 0.0238 (0.53) | 0.0178 (0.40) | | | |
| White spruce, natural | 0.0032 (0.07) | 0.0114 (0.25) | 0.0158 (0.35) | 0.0182 (0.40) | 0.0165 (0.37) | 0.0134 (0.30) | 0.0102 (0.23) | 0.0046 (0.10) |
| Pine, harvested | 0.0055 (0.12) | 0.0113 (0.25) | 0.0115 (0.26) | 0.0093 (0.21) | 0.0082 (0.18) | | | |
| Pine, natural | 0.0022 (0.05) | 0.0047 (0.10) | 0.0056 (0.12) | 0.0073 (0.16) | 0.0075 (0.17) | 0.0074 (0.16) | 0.0067 (0.15) | 0.0051 (0.11) |
| Black spruce | 0.0030 (0.07) | | | 0.0028 (0.06) | | | 0.0022 (0.05) | 0.0018 (0.04) |

- Non-forest types (ratio to max in brackets): treed swamp 0.0149 (0.33); grass 0.0123 (0.27); rough pasture 0.0082 (0.18); shrub 0.0077 (0.17); shrubby swamp 0.0076 (0.17); tame pasture 0.0051 (0.11); marsh 0.0045 (0.10); shrubby fen 0.0037 (0.08); graminoid fen 0.0035 (0.08); treed fen 0.0023 (0.05); crop 0.0021 (0.05); well sites 0.0009 (0.02); shrubby bog, rural residential, urban/industrial and industrial (rural) 0.
- The 2019 model shows the same pattern: harvested deciduous at 10 yr 0.0485 and natural deciduous at 40 yr 0.0275.

## What it means for Clearwater
- [I] Rescaled to a 0–1 stand value, the ruffed grouse ratios round to:
  - Deciduous cutblock: 0–4 yr 0.6, 5–25 yr 1.0, 26–50 yr 0.65, >50 yr 0.55.
  - Mixedwood cutblock: 5–25 yr 0.8.
  - White spruce cutblock: 5–25 yr 0.65.
  - Natural stands: deciduous 20–60 yr 0.5, mixedwood 0.5, white spruce 0.35–0.4.
  - Lodgepole: cutblock 0.25, natural 0.15. Black spruce 0.05.
  - Other types: treed swamp 0.33, shrub 0.17, rough pasture 0.18, tame pasture 0.11, crop 0.05.
- [I] Against the current rule this means:
  - Shrub at 0.8 is too high.
  - Young white-spruce cutblocks are worth ~0.65, not "other conifer 0.3". They regenerate with aspen and shrubs.
  - Pasture next to forest is low, not zero.
  - Lodgepole is a poor ruffed grouse type, so lodgepole value comes from spruce grouse.
- [I] CanLaD cutblocks (23% of the box since 1985, now 0–41 yr) are the main ruffed grouse habitat. The harvested curves apply to them.
- [I] Linear features: verges +17%, pipelines +30%, seismic +33%. A modest bonus (about +0.1 to +0.15) for aspen or mixedwood within ~30 m of pipeline rights-of-way, seismic lines and road verges is supported. The current +0.25 road bonus is larger than this breeding-season verge effect. Fall grit and sunning on roads may add to it (see the Millar Western note), but it is not measured here.

## Not confirmed
- These are spring–summer detection models. Drumming carries well over 100 m, so open types beside forest may be inflated (grass 0.27, for example). Fall habitat use is not modelled.
- The API gives age nodes (0, 10, 20, 40, 60…), not class boundaries.
- ABMI returns no model for spruce or dusky grouse. Spruce grouse were detected at only 8 of 1,161 ABMI camera sites (ACA 2026).
- The Oil Sands road edge-distance chart is empty for this species, so the near-road gradient is unknown.
