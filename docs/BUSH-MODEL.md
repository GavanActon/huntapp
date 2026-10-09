# Bush thickness without LiDAR: the model

Eye-level bush (saplings, alder, low conifer branches, the 0.5–3 m layer)
decides how far a hunter sees and where an animal hides
(docs/HUNT-FISH-SCIENCE.md, "Bush thickness"). An HD area measures it
from the point cloud: the understory NRD, the share of LiDAR returns that
reached the top of the shrub layer and were stopped inside it
(build_vegstructure.py). An SD area, or any ground with no point cloud,
had only the rules table in build_habitat.py (`bush_thickness`), an
estimate from stand type and age that Lac Bailey's LiDAR showed wrong by
a wide margin: it called two thirds of the land thick, the point cloud
found mostly light to moderate bush.

This is the replacement: a model that predicts the same NRD, on the same
30 m habitat lattice, from what is seen from space, trained on Ontario's
leaf-on LiDAR. Code in `pipeline/bush/`; it runs inside the habitat bake
(`build_habitat.modelled_bush`) wherever an area has no point cloud and
does not say `bake.habitatBush: "estimate"`.

## The labels

Ontario's FRI leaf-on SPL LiDAR covers 452,122 one-km tiles across the
managed forest (the index is a 335 MB GeoPackage, cached as
`pipeline/raw/pointcloud/fri-index/tiles.npz`: tile, UTM zone, corner,
year, centre). Every flight is leaf-on, 2018–2025, so every label is of
the bush as it stands in the hunting season, with the leaves on.

`plots.py sample` draws 6000 candidate 300 m squares at random over the
tiles, reads SCANFI, CanLaD and the land cover at each (staged copies,
stage.py) and keeps a stratified pick of 320: quotas by years since a cut
or burn (0–3, 4–8, 9–25, 26–40, 40+), by SCANFI's lead species for the
mature treed ground (spruce, jack pine, fir, broadleaf, pine, other
conifer, tamarack, hardwood ≥ 50 %), by the non-treed classes (shrub,
herb, bryoid, rock, bare), each quota filled across four latitude bands
in turn. The regrowth sequence and the open classes are rare on the
ground and drawn well over their share, so the model sees the whole
range, not mostly mature spruce.

`plots.py fetch` pulls each square in part: the COPC nodes meeting it at
every octree level (fetch_pointcloud.band_plan, nothing thinned, 40–130
MB a plot at about 3 MB/s) and the tile's 0.5 m DEM. `plots.py measure`
runs build_vegstructure's own tile metrics over the fetched points and
cuts out the square's 10 m cells (the ones wholly inside it: a square not
on the 10 m lattice loses a row and a column), with the same floors an
HD area applies (density ≥ 5 returns/m², land ≥ 25 % of the cell, ≥ 50
returns reaching 3 m for an understory value). A plot's label is exactly
an HD area's.

`dataset.py` pools the 10 m cells 3 × 3 into 30 m: the label is the mean
NRD of the cells that have one (at least 5 of 9), with the plant area
density, canopy height and cover, land share and LiDAR year beside it.
Cells cut or burnt after the flight (CanLaD's year later than the
tile's) are dropped: their label is of a forest that is gone. The three
HD areas (Pickle Lake and Sault from the same SPL, Lac Bailey from
Quebec's linear-mode LiDAR) go in the same way from their vegstructure
grids, each as one block.

## The features (features.py)

Read on any grid, the same code for a plot and for an area's lattice:

| Source | What | Why |
|---|---|---|
| SCANFI v2 (30 m) | ten species' crown shares, closure, height, median age, NFI land cover | the stand the understory grows under |
| CanLaD v1.1 (30 m) | disturbance type and year → years since | the regrowth sequence (Oliver & Larson): slash, thicket, self-thinning |
| MRDEM 30 m | elevation, slope, relief at 300 m and 1 km | wetness and site |
| Land cover 2020 | class | open ground, wetland |
| Sentinel-2 L2A (Earth Search, 10/20 m), 2023–2025 | per season the per-pixel median of clear pixels (SCL 4–7) in ten bands, NDVI, NDMI, NBR, NDRE; the within-cell spread of NIR at 10 m (texture) for leaf-on and autumn; leaf-off minus leaf-on differences | **leaf-on** (20 Jun–31 Aug): the canopy. **Autumn leaf-off** (12 Oct–25 Nov): the canopy bare, so an evergreen understory (fir, cedar, spruce regen) shows as green through it. **Spring leaf-off** (20 Apr–28 May): the same before leaf-out. **Snow** (15 Feb–5 Apr, snow kept): shrubs dark on a bright floor, canopy gaps bright |
| ALOS PALSAR-2 mosaic (Planetary Computer, 25 m) | HH, HV in dB, HV−HH, the latest two years | L-band answers to woody volume, stems included: a stem-exclusion thicket reads differently from a lichen floor |
| position | lat, lon | regional drift (tested without: see the scores) |

Up to six scenes a season, the least cloudy by the scene's own cover
first, each masked by its scene classification over the grid; a scene
with under 15 % of the grid clear is skipped. Earth Search's COGs carry
no BOA offset whatever their metadata says (a forest's blue reads DN
~300, not ~1300), so reflectance is DN × 10⁻⁴.

Not in yet, in the order they would help: GEDI's plant area density by
height bin (a direct understory measurement south of 51.6° N, needs an
Earthdata login), Sentinel-1 winter/summer backscatter, the provincial
20 cm orthophotos' texture, a bush check from the app (one tap, can you
see 20 m here) as leaf-on ground truth.

## The model (train.py)

LightGBM, Huber loss, on the 30 m cells; the three class layers
(nfiLandcover, dist_type, landcover) categorical. Two more boosters fit
the 20th and 80th percentiles (quantile loss): their gap is the model's
doubt in a cell, written as the `thickSpread` band.

The test is spatial, never random. The plots are clustered into 8 blocks
by position and each block is predicted by a model that never saw it.
Then the HD areas are held out whole: each predicted by a model trained
on the plots alone, and again with the other two areas in training.
A model on the national rasters and terrain alone (no imagery, no radar)
says what the imagery adds; one without PALSAR and one without lat/lon
say what each of those adds.

Scores: r and RMSE on the cell's NRD, the same at 90 m (3 × 3 cells
pooled: what a hunter reads off the map), and the AUC for thick
(NRD ≥ 0.45) and open (NRD ≤ 0.24), the two classes the Spots scorer
acts on.

### Results (2026-10-07: 320 plots, 24,231 plot cells; three areas, 175,428 cells)

Plots, each spatial block predicted by a model that never saw it:

| Features | r (30 m) | r (90 m) | RMSE | AUC thick | AUC open |
|---|---|---|---|---|---|
| the model's (no position) | 0.53 | 0.55 | 0.195 | 0.76 | 0.74 |
| national rasters + terrain only | 0.42 | 0.46 | 0.208 | 0.70 | 0.70 |
| without PALSAR | 0.53 | 0.55 | 0.195 | 0.76 | 0.74 |
| without the snow season | 0.51 | 0.53 | 0.197 | 0.74 | 0.73 |
| without texture | 0.52 | 0.55 | 0.195 | 0.76 | 0.74 |
| with lat/lon too | 0.58 | 0.61 | 0.186 | 0.78 | 0.78 |

The HD areas held out whole, the model trained on the plots alone:

| Area | LiDAR | r (30 m) | r (90 m) | RMSE | bias | AUC thick | AUC open |
|---|---|---|---|---|---|---|---|
| Pickle Lake | Ontario SPL | 0.60 | 0.69 | 0.143 | +0.01 | 0.80 | 0.84 |
| Sault test | Ontario SPL | 0.76 | 0.81 | 0.154 | +0.05 | 0.84 | 0.88 |
| Lac Bailey | Quebec linear-mode | 0.59 | 0.62 | 0.171 | +0.07 | 0.74 | 0.78 |

With the other two areas in training as well, Lac Bailey rises to r 0.67
(0.73 at 90 m), Pickle and Sault stay put.

What the numbers say:

- **The imagery is most of the gain.** The rules' inputs alone (SCANFI,
  CanLaD, terrain) reach r 0.42; the seasons of Sentinel-2 take it to
  0.53 on unseen blocks and 0.60–0.76 on whole areas. The top features
  are leaf-on red and red-edge (a dark, closed canopy has little under
  it), elevation, closure, years since disturbance, and the autumn and
  snow differences from leaf-on, which is the evergreen understory
  showing through bare crowns.
- **The snow season earns its place** (r 0.51 without it); PALSAR and
  the NIR texture do not, yet. PALSAR stays in for now at no cost.
- **Position** (lat, lon) lifts the plot score to 0.58 but worsens the
  bias on both Ontario areas (Sault +0.05 → +0.11) while lifting Lac
  Bailey's r to 0.66 with a +0.10 bias. It is left out: it is not a
  cause, and it would extrapolate off the plots' range (Quebec, the
  Yukon) with no check. Regional drift is for the bush checks to learn.
- **By stratum**, the regrowth sequence (cuts and burns at every age),
  bryoid, herb and rock score r 0.5–0.84; the weak classes are tamarack
  (0.24), white and red pine (0.35), hardwood ≥ 50 % (0.39, RMSE 0.23)
  and shrub (0.41, RMSE 0.23). Hardwood is the hard case: hazel and
  maple under aspen vary at the scale of a crown, and the leaf-on LiDAR
  itself sees that layer through a closed deciduous canopy with few
  returns.
- **Lac Bailey's bias** (+0.07) is partly the sensor: Quebec's
  linear-mode NRD runs lower than Ontario's single-photon NRD for the
  same bush (build_vegstructure.py). The model is on Ontario's scale.
- **Against the targets** set before building (r 0.5–0.65 per cell,
  0.7+ at 90 m, thick/open AUC 0.85+): the cell and 90 m correlations
  are met on the SPL areas; the class AUCs reach 0.80–0.88 on them,
  short of 0.85 for thick. The classes are usable; the exact sight
  distance is not, which is why the SD tier shows the class with its
  doubt (`thickSpread`).
- **Highland Lake** (no point cloud): the model finds 5 % of the land
  thick and 41 % open where the rules said 15 % thick; the median doubt
  is 0.29 on the thick scale. Not field-checked.

Not measured yet: the model against ground truth other than LiDAR; how
well the doubt band predicts its own error; a leaf-off LiDAR flight
(none here, all Ontario's are leaf-on). The spatial-block score moves by
several hundredths with the draw of blocks (eight blocks over 320
plots): read differences under 0.03 as noise.

## In the bake (predict.py, build_habitat.modelled_bush)

For an area with no point cloud the habitat bake runs the features on
its lattice (a 30 km area reads a few hundred Sentinel-2 windows: some
minutes), predicts the NRD and its spread, and puts the NRD on the
estimate's 0–1 scale by a fixed curve:

| NRD | 0 | 0.15 | 0.30 | 0.45 | 0.60 | 0.75 | 1 |
|---|---|---|---|---|---|---|---|
| thick | 0 | 0.20 | 0.45 | 0.70 | 0.85 | 0.95 | 1 |

so the Spots scorer's thresholds keep their meaning: thick (0.7) is NRD
0.45, where the understory map's own "thick" class starts
(build_vegstructure.RAMP; the HD areas' calibrations put it at
0.44–0.59), open (0.35) is NRD 0.24. The estimate stays on water, roads
and any cell no leaf-on imagery saw (`thickSrc` 2; the model's cells are
3). The header's `bushCalib` is the same curve, so build_going.py reads
the NRD straight back for the walking cost instead of guessing it through
Pickle Lake's calibration.

`py -3.14 pipeline/bush/predict.py --area <id>` predicts an area's
lattice and prints the shares, without baking.

## The map layer (render.py, the bake's `bush` step)

An area with no point cloud gets an understory layer from the model
(`understory-<id>.pmtiles`, the same file name and the same colours as an
HD area's LiDAR layer, so the Bush view and the hot button work
unchanged). The habitat bake keeps the model's NRD and percentiles in
`pipeline/raw/bushmodel-<id>.npz`; `render.py` draws them from zoom 10 to
the core's maximum, bilinear above zoom 12, cut at the area's
waterbodies.

The doubt shows: each cell's colour is faded by the model's spread (80th
minus 20th percentile), solid at no spread down to 30 % at a spread of
0.45 NRD or more, so the layer never reads like a 10 m measurement. The
layer's attribution and its "What's in it" entry say modelled, not
measured. There is no lanes layer: shooting lanes are a 10 m LiDAR
measure a 30 m prediction cannot make, and the coverage report says so.

First area: Highland Lake, 2026-10-07. Not field-checked.

## Layered with the forest map (2026-10-08)

The first area outside the boreal the model learned was Blanchard River,
BC (subalpine fir at 15 % closure, willow flats, alpine): the model called
5 % of the land thick, the rules 62 %. Gavan: "we'll need to find
latitudinal modelling, or some layered approach with other inputs." Two
things changed in the habitat bake:

- **The map's word stands where it names the ground.** A map that
  describes every polygon (Quebec's, BC's VRI; `FOREST_UPDATED`) says
  outright where the ground is open herb, lichen, rock, ice, open fen or a
  tall-shrub thicket. On those cells the model, trained on Ontario's
  boreal, has nothing to add: they keep the rules' value (`thickSrc` 2).
  The VRI's tall shrub (2 m and up: willow, alder, birch scrub) is a wall
  at eye level that the Ontario model reads as open; its low shrub
  (knee-high dwarf birch) is now 0.4, not the alder run's 0.85
  (`bush_thickness` reads a shrub polygon's height; `bc_forest.py` writes
  it from the class or the VRI's measured shrub height). At Blanchard the
  map speaks for 31 % of the land, the model for 61 %.
- **The fir floor scales with closure.** The rule "fir and cedar keep
  branches to the ground" set 0.75 under every fir stand; an open
  subalpine fir stand is fir clumps with lichen flats between. Where the
  map gives a closure the floor runs from 0.4 at 10 % to 0.75 at 50 %
  and above; Blanchard's rules now say 21 % thick. With the retrained model
  (below) and the measured shrub values, Blanchard's final grid is 7 %
  thick and 72 % open (the model alone: NRD mean 0.15, thick on 0 % of
  the cells it sees), Highland Lake's 1 % thick and 70 % open (the
  rules had said 36 %). Not field-checked.

**What the northern LiDAR says the VRI's classes are** (115 plots,
11,377 cells, each cell's VRI polygon looked up; `thick` is NRD ≥ 0.45,
`open` ≤ 0.24):

| VRI class | n | NRD | thick | open |
|---|---|---|---|---|
| treed conifer, open | 3,426 | 0.30 | 0.16 | 0.40 |
| treed conifer, sparse | 1,049 | 0.29 | 0.16 | 0.48 |
| treed conifer, dense | 881 | 0.25 | 0.03 | 0.50 |
| treed broadleaf, dense | 1,250 | 0.21 | 0.01 | 0.64 |
| treed broadleaf, open | 858 | 0.29 | 0.14 | 0.45 |
| treed mixed, open | 662 | 0.30 | 0.20 | 0.40 |
| low shrub, open | 466 | 0.30 | 0.23 | 0.47 |
| low shrub, sparse | 129 | 0.12 | 0.00 | 0.75 |
| tall shrub, open / dense / sparse | 261 / 167 / 78 | 0.29 / 0.28 / 0.18 | 0.06 / 0.11 / 0.01 | 0.35–0.71 |
| herb, dense | 381 | 0.01 | 0.00 | 0.99 |
| graminoid, dense | 205 | 0.03 | 0.00 | 0.97 |
| bryoid | 208 | 0.08–0.13 | 0.00 | 0.83 |
| exposed land | 40 | 0.03 | 0.00 | 0.97 |

So the first version of the layering, which took the VRI's tall shrub as
a wall (0.85, the alder run's value), was wrong by the LiDAR's own
measure: willow and dwarf birch let most returns through. The rules now
put a mapped tall shrub at 0.42 and a low one at 0.35 on the estimate's
scale, and the map's word is kept over the model only for the open
classes (herb, bryoid, rock, ice, open fen), which measure 0.01–0.13 and
leave nothing for the model to add. Shrub goes back to the model, which
now has northern shrub plots to learn it from. The north as a whole is
moderate at eye level by this measure: NRD 0.2–0.3 under nearly every
treed class, thick on under a fifth of the cells.

## Teaching the model the north (started 2026-10-08)

The labels are all Ontario's, 46–52° N. Open leaf-on LiDAR north of 56°:

| Source | Where | When | Access |
|---|---|---|---|
| **LidarBC** (`north.py`) | northern BC: the Peace to the Liard 2024–25 (30,000 tiles, UTM 10), Atlin 2021 (143 tiles, UTM 8); BWBS boreal, SWB and ESSF subalpine, alpine | flight windows in each file name (start_end); kept when the window starts in June and ends by 15 September, before the aspen and willow drop (18 of the first 119 draws ran into October and were dropped); the 2021 programme's names carry no date, its report gives 2021-06-26 to 2021-09-10 | plain LAZ tiles, ~235 MB and 40 M points each, on the province's object store; index on an ArcGIS FeatureServer |
| USGS 3DEP, Alaska | Tok 2024 (EMRI_3, 100 B points, by the Yukon border), Healy 2024 (subalpine and alpine), Delta Junction Sept 2021, Mat-Su, Glacier Bay B3 2019 | summer flights, QL1–2 (WESM) | EPT octrees on AWS, EPSG:3857 (reproject before gridding); no SCANFI or CanLaD there, so a model variant without the national rasters |
| NEON AOP | BONA, DEJU, HEAL (interior Alaska) | July–August, yearly 2017–2025 | NEON API, DP1.30003.001 |
| Yukon | none open as point clouds found | | |

### Results (2026-10-08: 115 northern plots, 11,076 cells, in with Ontario's 320)

The northern plots are open at eye level by the LiDAR's measure: NRD
mean 0.25, thick on 11 % of cells, open on 52 %. Scored on them:

| Trained on | r (30 m) | r (90 m) | RMSE | bias | AUC thick | AUC open |
|---|---|---|---|---|---|---|
| Ontario's plots alone (what the north had) | 0.66 | 0.71 | 0.138 | +0.04 | 0.89 | 0.75 |
| its own plots too, in the spatial folds | 0.61 | 0.64 | 0.139 | +0.04 | 0.85 | 0.77 |

So the Ontario model already carried north: the imagery seasons read
the understory the same way at 57° as at 49°, and the folds with the
north in (two far blocks, each predicted without the other) score no
better. The one that was wrong at Blanchard River was the rules table,
not the model: 62 % thick against the model's 5 %, and the LiDAR says
the north's treed ground is thick on 3–20 % of cells by class. The
final model is trained on both sets; the Ontario spatial-fold score is
unchanged (r 0.54, 0.59 at 90 m) and the HD areas held out score as
before (Pickle 0.57, Sault 0.75, Lac Bailey 0.66). The per-stratum
view adds a shrub stratum at r 0.55 (3,003 cells, bias 0.00) now that
the north supplies most of it.

`north.py` samples 300 m squares over LidarBC's leaf-on tiles with
`plots.py`'s strata (the open classes drawn harder: they are what the
north has), fetches whole tiles, cuts each plot out with a 20 m rim and
measures it with `build_vegstructure.tile_metrics_class` (a ground model
from its own ground returns, as Quebec's tiles are measured). Its
metrics.npz sits beside the Ontario plots', `dataset.py` reads
`plots-north.json` with `plots.json`, and `train.py` scores the northern
plots as their own strata. The test to add: the northern plots held out
whole against a model trained on Ontario alone (what the north gets
today), then in the spatial folds. Alaska and NEON after that, if BC's
boreal and subalpine do not carry to the Yukon's.

### Two more rounds for Blanchard River, and what they showed (2026-10-09)

The live model called Blanchard open to light throughout: no cell thick,
the dense spruce belts along the creeks no thicker than the parkland
round them. On Esri's 0.5 m photo the difference between open ground,
tall bush and the belts is plain (Gavan: "clearly open space vs tall
bush").

- **Atlin, 88 more plots (102 in all, map sheet 104K).** Held out whole,
  Atlin scored r 0.70, but Blanchard did not move. The 2021 Atlin
  programme flew the Taku valley: its plots sit at a median 56 m, coastal
  lowland cottonwood and alder, not high country. Blanchard's spots are at
  1,055 m, SCANFI calls them closure 0, and their snow season is far
  brighter than any plot's: their nearest training cells were 2.3 standard
  deviations away (0.6 between plots).
- **High, open ground, 59 plots.** These came from the Peace–Liard tiles
  at 850 m or more with SCANFI closure at most 25%
  (`north.py sample --tiles --min-elev --max-closure`). Their LiDAR
  measured open (NRD 0.21, 6 % thick). With them in, Blanchard's nearest
  cells were 1.5 sd away, its level stayed open, and the shape still did
  not follow the photo.
- **Neither retrain went live.** The committed model follows the photo's
  dark canopy best of the three (rho 0.38, against 0.16 and 0.24). Haines'
  LiDAR is all leaf-off (December 2020, November 2018, October), so not
  usable as labels.

## An area's own model (`bush/local.py`)

Where the general model has never seen the ground, labels tapped on the
sharp photo teach it the area. The app's hidden bush-label tool
(`?label=bush`) drops 20 m patches of four kinds: open, low shrub, tall
bush and dense trees. Send uploads them for a code. They go into
`pipeline/bush/labels/<id>.json`, and `local.py` learns the kinds from this
document's features on a 10 m grid in the area's UTM zone, then maps the
whole area. Each label stands for the cells in its patch, and position is
left out.

The kinds go onto the NRD scale by their probabilities: open 0.08, low
shrub 0.28, tall bush 0.55, dense trees 0.65. The spread is how far those
scatter under a cell (1.68 sd). `build_habitat` averages the 10 m map into
its lattice in place of the general model, and `render.py` draws the bush
layer from it at 10 m. The bake step `bush-local` runs it before the
habitat whenever an area has labels. Esri's photo is only what the labels
were tapped on: none of its pixels go into the model.

**Blanchard River, 536 labels** (Gavan, 2026-10-09). The open labels in the
box north of the West spot were made low shrub at his word. Scored a whole
patch at a time (17 patches): 75 % of labels right (44 % by chance), thick
or not 87 % (AUC 0.84), open against the rest AUC 0.94. Dense trees were
103 of 109 right. Tall bush is the weak kind: chest-high willow and
knee-high shrub look alike from space, and 45 of 72 were taken for low
shrub. More tall-bush labels, and field notes, are what it needs. The
spruce belts, their tall-bush edges, the low-shrub parkland and the open
alpine all show at 10 m.

## Running it

```
py -3.14 pipeline/bush/plots.py sample --n 320 --seed 7
py -3.14 pipeline/bush/plots.py fetch --max-gb 45      # hours; resumable
py -3.14 pipeline/bush/dataset.py plots --watch        # measures and featurises as plots land
py -3.14 pipeline/bush/dataset.py area pickle-lake     # and sault-test, lac-bailey
py -3.14 pipeline/bush/train.py                        # scores, then pipeline/bush/model/
```

The model files (three LightGBM boosters and model.json) are committed;
the plots and features (pipeline/raw/bush/, tens of GB) are not.
