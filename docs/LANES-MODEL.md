# Lanes for SD: a model of the 10 m bush

Status: scoping, 2026-10-10. Nothing is built. Gavan set the line that
day: "SD - cheap. HD - expensive physics." SD is models trained on what HD
measures, plus the cheap real data. HD is the heavy measurements and the
physics. The wind surrogate (SURROGATE.md) and the 30 m bush model
(BUSH-MODEL.md) are the first two SD models. This is the third: shooting
lanes where there is no point cloud.

## Why

- **What a lane is.** It is not a layer of its own. It is the 10 m
  understory NRD from the point cloud (build_vegstructure.py) drawn with
  `LANES_RAMP`: under 0.30 is clear, 0.30 and up is a darkening veil. So a
  lanes model is a 10 m eye-level bush model. The understory layer at
  10 m comes from the same output.
- **Where lanes exist today.** Only in the areas with a point cloud
  (Pickle Lake, Sault test, Whitefish Lake, Lac Bailey) or with tapped
  bush labels (Blanchard River, Highland Lake; bush/local.py). Searchmont,
  the first SD area, has none. The Lanes button still lit there and drew
  nothing.
- **What the 30 m model can't do.** A lane is a few metres wide, so it is
  gone inside a 30 m cell. BUSH-MODEL.md says so and bakes no lanes from
  it.

## What it predicts

- The understory NRD on the 10 m cells of the area's UTM grid, on
  Ontario's single-photon scale. It comes with a spread (q20 and q80), as
  the 30 m model does.
- From that, `lanes-<id>.pmtiles` and a 10 m `understory-<id>.pmtiles`,
  each faded where the model is unsure and credited as modelled, not
  measured.
- Canopy height and cover at 10 m come almost free from the same labels
  and inputs, as two more outputs. They could feed the habitat grid and
  the wind's roughness where an area has no point cloud. Optional.

## Labels already on disk

- **582 Ontario plots.** Each is a 300 m square of 29 × 29 measured 10 m
  cells, about 490,000 cells in all (`pipeline/raw/bush/plots/*/metrics.npz`:
  understory, canopy_height, canopy_cover, water_frac, n_reach). They
  were stratified for the 30 m model by years since a cut or burn, lead
  species, the open classes and four latitude bands. All of it is FRI
  leaf-on single-photon LiDAR, 2018–2025.
- **Four whole HD areas measured at 10 m**
  (`pipeline/raw/vegstructure-<id>.npz`): Pickle Lake, Sault test and
  Whitefish Lake (single-photon), and Lac Bailey (Quebec linear-mode,
  whose NRD runs lower for the same bush; keep it apart).
- **The northern plots** (BC, Yukon) in `pipeline/raw/bush/north/`, 70 GB.
  Their layout differs: check it before use.
- **More on demand.** The FRI index lists 452,122 one-km tiles, and
  `plots.py fetch` pulls a square in part.

## Inputs

- **The sharp photo.** Its pixels are what is new here: the 30 m model
  reads Sentinel-2, and local.py only had labels tapped on Esri. One 10 m
  cell is about 20 × 20 pixels at 0.5 m.
  - Ontario: the province's own imagery (LIO OIWMS, `on.oiwms` in
    build_tiles.py), OGL-Ontario. Tiles run to z23; the source photos
    vary by flight. **To check per plot: the flight year, the
    resolution and the season.** If much of it was flown leaf-off in
    spring, that is a mixed blessing. The photo and the leaf-on labels
    differ, but bare maple crowns show the floor and the conifer
    understory, which a leaf-on photo hides. That is the case that
    matters at Searchmont.
  - Quebec: `Imagerie_GQ`, 20 cm, flown August–October 2023, CC BY 4.0.
  - Elsewhere: Esri World Imagery. **Its terms likely bar training on
    it**, and possibly running a model over it. Check before relying on
    it at all.
- **The 30 m model's features, resampled:** Sentinel-2 seasons (snow
  included), SCANFI, CanLaD, the land cover.
- **Terrain at 10 m.** HRDEM where it exists, the cheap real data the SD
  line keeps; the MRDEM otherwise.
- **The forest map's stand**, where there is one (FRI in Ontario).

## The model

A small U-Net on photo chips, with the coarse features as extra channels
upsampled to the chip. It outputs NRD with q20 and q80 at 10 m. Trained
through the job kit on xonix (SURROGATE.md §6).

Two baselines, fixed before training, and the photo has to beat both:

1. The 30 m bush model, upsampled to 10 m.
2. A LightGBM at 10 m on the same features without the photo's pixels:
   local.py's recipe, trained on the point-cloud labels instead of taps.

## The test (fixed before the run)

- Hold out whole areas: Sault test, Whitefish Lake and Pickle Lake, each
  in turn. Score Lac Bailey on its own, for the sensor offset. Hold out
  plots by spatial block, as the 30 m model does.
- Metrics at 10 m:
  - **lane or not** (NRD under 0.30): AUC, plus at the drawn threshold the
    share of real lanes shown and the share of shown lanes that are real;
  - r at 10 m and at 30 m;
  - all of these by stratum, hardwood above all.
- **Pass:** lane AUC 0.80 or better on every held-out single-photon area,
  and better than both baselines. Otherwise SD keeps no lanes, and the
  button says so. For scale: the 30 m model's thick/open classes scored
  AUC 0.80–0.88 at 30 m, so expect 10 m to be harder.

## Risks

- **A leaf-on photo shows crowns, not the understory.** Under closed
  hardwood the photo may add nothing; the per-stratum scores will show
  it. This is the maple case.
- **The photo's year against the flight's.** Cuts made since will
  disagree; CanLaD flags them.
- **Season.** The photos' season may not match the labels' leaf-on: one
  model per season, or a season input.
- **Licence**, outside Ontario and Quebec (Esri).
- **The north.** The 30 m model fell over in BC: 5% thick there, against
  62% by the rules. Expect the same here until the northern plots are in.

## Cost, by order of magnitude

- **Photo chips** for the plots and the four areas: a few thousand tiles,
  some hundreds of MB.
- **Training:** hours on xonix.
- **Dev:**
  - about 2–3 days to a scored first pass;
  - a day more for the bake step and the render;
  - half a day for the app's Lanes button.

## Order

0. **The app, whatever the model does.** In an area with no lanes, the
   Lanes button stops lighting silently: "Shooting lanes come with HD
   here", with a sample patch, per the F2P line. Below zoom 13.5, where
   lanes don't draw, it says "Zoom in to see lanes".
1. Fetch photo chips for the labels. Check the flight year, resolution
   and season per plot.
2. Train and score the two baselines.
3. Train and score the U-Net.
4. If it passes, add a bake step `lanes-sd` that writes the lanes and the
   10 m understory for SD areas. Searchmont first.

## Decisions for Gavan

- Ontario first? It has open photos and labels on the same ground.
- Esri as an input outside Ontario and Quebec, after a licence check.
- SD lanes free, or part of the HD taste?
