# Surrogate: a net that stands in for the momentum solve

Status: experiment run 2026-10-09, passed its decision rule (§5). Decided
with Gavan ("let's try it"). Code in `pipeline/surrogate/`, data in
`pipeline/raw/surrogate/`. Nothing in the app reads it yet; the seed set
(§4) is queued on xonix.

## 1. The idea: HD solves teach, SD serves

Today the terrain wind comes two ways ([MICRO-WIND.md](MICRO-WIND.md) §2):
the 2D mass-consistent layer anywhere (today's SD), and WindNinja's
momentum solver where it has been run (the four HD areas plus Sault;
[SCALE-PLAN.md](SCALE-PLAN.md)). The momentum solve is far better where
it matters (turn r 0.55 or worse for every mass-consistent setting against
it) and far too slow to run everywhere: 16 directions, an hour or more
each on a laptop, 2,500 tile-hours for Ontario's SD tiles alone.

The flywheel: keep running WindNinja on the areas people pay for (HD), and
train a conv net on every finished solve to predict the same field from
the DEM alone. The net runs in milliseconds over a tile, so it serves the
SD terrain wind everywhere. Each HD area adds training pairs; the net
retrains; SD improves for everyone; more people come; more HD gets bought.
The costly thing funds the cheap thing.

Three things decide whether it works, and the plan is built round them:

- **Diversity, not volume.** Paid areas will cluster in flat shield
  country. A net fed only by them is good at Pickle and wrong in the
  Chilcotin (the bush model showed this going north). The flywheel adds
  to a designed seed set of tiles chosen by terrain class, canopy and
  latitude, baked on our own PCs; it does not replace one. Volume is no
  problem: each 10 km tile is thousands of 1 km training windows.
- **The teacher sets the ceiling.** A net trained on WindNinja inherits
  WindNinja's misses, and the checks say the misses are the canopy floor
  and the ambient error, not the terrain. So the net replaces only the
  terrain layer; the tower-fitted floor, the `woods` lesson and the
  check inverse stay on top, as they do over the momentum bake today. A
  better teacher (PALM with canopy drag on the seed set) is a later
  upgrade behind the same gate, not a change to this design.
- **Two loops, kept apart.** HD solves to net is a weeks-long server-side
  loop. Checks to floor layer and ambient is a minutes-long phone-side
  loop. Checks validate the net and tune the floor; they cannot retrain
  it from a few hundred noisy points, and nothing here pretends they do.

## 2. What the teacher actually is

The momentum bake ([build_windcfd.py](../pipeline/build_windcfd.py)) is
not the 1 m LiDAR picture the HD label suggests. It is WindNinja 4.0.0's
momentum solver on the 30 m MRDEM in UTM over the core plus a 2.5 km
inflow buffer, 16 directions at 22 km/h, neutral air, `vegetation =
trees` as one roughness everywhere, output at 10 m. So the surrogate is a
terrain emulator at 30 m, and its only input is the DEM. That makes the
first test clean, and it means a pass here says nothing about canopy or
stability.

Per area the kit holds the DEM (`dem.tif`), and per direction the u and v
grids (km/h, east and north, 30 m, one extra row at the top and column at
the right) and, from the runs since 2026-10-05, the turbulence (the most
velocity fluctuation in the lowest 10 m, on a lon/lat grid of its own).

## 3. The test

Five areas have all 16 directions: Pickle Lake, Lac Bailey and Sault
(gentle shield), Highland Lake and Blanchard River (Boreal Cordillera,
real mountains). Hold one area out, train on the other four, score on
the held-out core.

- **Fold A: Blanchard held out.** The hardest and the one that matters:
  the gentle areas and one mountain area must teach the net enough to
  get a second mountain area right. If it passes here the net is worth
  having where today's SD is worst.
- **Fold B: Highland held out.** The same question the other way, so a
  pass is not one lucky area.

Inputs: the DEM relative to the window mean, its slope components, and
the ambient direction as two constant channels. Output: the deviation
from the ambient unit vector (u, v in units of the 22 km/h ambient) and
the turbulence where the run has it. A U-Net, 192-cell windows (5.8 km),
and the exact eightfold symmetry of the grid as augmentation: rotate the
DEM, the wind and the ambient together by 90°, mirror them, and the
physics is unchanged (WindNinja has no Coriolis).

Scored over the core, away from the inflow edge, all 16 directions:

| statistic | why |
|---|---|
| turn r: the net's turn from the ambient against WindNinja's | the number the mass-consistent layer failed on (≤ 0.55) |
| turn MAE, median, % within 5° / 10° / 22.5° | what a hunter would notice |
| speed ratio r, MAE, bias | lee slack and exposed speed-up |
| the same by slope band and by WindNinja's own speed band | where it fails, not just whether |

Against four yardsticks, scored the same way:

1. The uniform ambient (no model).
2. The mass-consistent neutral layer: today's SD. The net has to beat
   this clearly or it is complexity for nothing.
3. The mass-consistent stable lid.
4. The interpolation gap: each odd direction predicted from its two
   45°-apart neighbours by blending, the way the app blends the two
   nearest baked directions. An error near this is as good as the bake.

And a floor: where an area has two WindNinja runs of the same direction
(the first pass and the turbulence pass), their disagreement is the
solver's own noise; nothing can be judged below it.

**Decision rule, fixed now.** Adopt if on both folds the net beats the
neutral layer on turn r and speed r over the held-out core, and its
median turn error is within about twice the interpolation gap. If it
beats the neutral layer but not by much, it is still worth serving where
no momentum run exists, but not worth the seed-set work. If it does not
beat the neutral layer, stop; the scale plan's phase 3 (WindNinja on a
cloud box) is the way to SD wind at scale.

## 4. If it passes

1. **Serve it as SD.** A `predict` step writes the 16 fields in the shape
   `build_windcfd.py collect` writes, so `build_microclimate.py` takes
   them exactly as it takes a momentum run. SD areas and SD tiles get a
   terrain layer in seconds. The app changes nothing.
2. **Seed set.** Chosen and kitted on 2026-10-09 (`pipeline/surrogate/seed.py`,
   kits in `pipeline/raw/windcfd-seed/seed-*/`, `sites.json`): 30 sites
   across Canada and the US picked by ecoregion and landform, relief
   from 98 m (Pike, IL) to 2,099 m (RMNP, CO), two batches of 12 and 18,
   queued for xonix's runners behind Whitefish Lake. Two are WindNinja's
   own field campaigns (Big Southern Butte, Salmon River Canyon: 50+
   sensors at 3.3 m), which judge the teacher against measured wind, and
   five sit by NEON or AmeriFlux towers. US kits use 3DEP, Canadian ones
   MRDEM, so hold out a US site to check for a DEM shift. `dataset.py`
   finds any kit with 16 finished directions in either kit folder.
   Retrain on everything; re-score the folds.
3. **The flywheel proper.** The bake agent of
   [SD-HD-PLAN.md](SD-HD-PLAN.md) pushes each finished HD solve into the
   training store; a retrain job runs when enough new tiles have landed;
   each new net goes through §3 before it serves.
4. **Uncertainty.** A small ensemble or dropout gives a spread per cell so
   the card can say how sure the terrain layer is; a net's wrong answers
   look smooth and plausible where a solver's look physical.
5. **Any direction, any stability, on the phone** is the later product
   step, once a teacher with canopy and buoyancy exists. Not this.

## 5. Results

### Pass 1, 2026-10-09 evening: it passes the rule

Code: `pipeline/surrogate/` (`dataset.py`, `fields.py`, `model.py`,
`train.py`, `eval.py`, `predict.py`, `test_fields.py`). Data and runs:
`pipeline/raw/surrogate/`. The net is a 4.7 M parameter U-Net; each fold
trained 12,000 steps in 25–27 min on XEVO's RTX 5060 (3.5–4.6 GB), and a
whole area's 16 directions predict in about 2 s. Scored over the held-out
core, away from the edge, all 16 directions (the eight odd directions for
the interpolation yardstick).

**Fold A, Blanchard River held out** (trained on Pickle, Lac Bailey,
Sault, Highland):

| | turn MAE | turn median | within 10° | turn r | speed MAE | speed r | speed bias |
|---|---|---|---|---|---|---|---|
| surrogate | 16.1° | 6.7° | 62% | 0.40 | 0.177 | 0.79 | −0.03 |
| uniform ambient | 27.4° | 13.7° | 40% | | 0.316 | | +0.13 |
| mass-consistent neutral (today's SD) | 22.5° | 8.1° | 56% | 0.34 | 0.318 | 0.36 | +0.11 |
| mass-consistent stable | 24.2° | 11.1° | 47% | 0.32 | 0.388 | 0.32 | +0.15 |
| interpolation yardstick (odd 8) | 21.2° | 9.1° | 53% | 0.36 | 0.196 | 0.72 | 0.00 |
| surrogate (odd 8) | 16.5° | 7.2° | 60% | 0.40 | 0.178 | 0.80 | −0.03 |

**Fold B, Highland Lake held out:**

| | turn MAE | turn median | within 10° | turn r | speed MAE | speed r | speed bias |
|---|---|---|---|---|---|---|---|
| surrogate | 3.4° | 2.0° | 95% | 0.54 | 0.124 | 0.80 | −0.11 |
| uniform ambient | 4.9° | 3.4° | 90% | | 0.175 | | −0.08 |
| mass-consistent neutral (today's SD) | 5.6° | 3.7° | 87% | 0.26 | 0.171 | 0.42 | −0.06 |
| mass-consistent stable | 9.6° | 7.8° | 62% | 0.38 | 0.291 | 0.49 | −0.06 |
| interpolation yardstick (odd 8) | 4.6° | 2.5° | 89% | 0.22 | 0.113 | 0.65 | −0.01 |
| surrogate (odd 8) | 3.2° | 2.2° | 96% | 0.72 | 0.127 | 0.80 | −0.11 |

In-sample (Pickle, fold A's net): turn MAE 0.5°, turn r 0.95, against
1.1° and 0.80 for the neutral layer.

**By ground, Blanchard.** Where it matters most the gap is widest:

| cells | share of core | surrogate turn MAE / speed r | neutral layer turn MAE / speed r |
|---|---|---|---|
| slope under 3° | 18% | 10.8° / 0.61 | 11.5° / 0.56 |
| slope 3–10° | 37% | 14.3° / 0.71 | 17.4° / 0.49 |
| slope over 10° | 45% | 19.6° / 0.85 | 31.0° / 0.30 |
| slack and lee (WindNinja speed under 0.7) | 32% | 32.2° / 0.53 | 46.3° / −0.12 |
| ordinary (0.7–1.1) | 45% | 8.7° / 0.39 | 11.2° / 0.17 |
| exposed (over 1.1) | 24% | 8.3° / 0.58 | 11.6° / 0.46 |

The pooled turn r (0.40) is dragged down by the slack and lee cells,
where direction is ill-defined in the truth itself; on cells with speed
0.7 or more the surrogate's turn r is 0.79–0.83 against 0.64 for the
neutral layer. The neutral layer's speed r in the lee is negative: it
pushes air through valleys that WindNinja has slack.

**On the flat shield (Highland's slopes under 3°, Pickle in-sample) the
neutral layer is already nearly as good**, which is what the SD tile
pilot measured at Pickle. The surrogate earns its place on slopes, in
the lee, and in the mountains.

**Verdict against §3's rule:** on both folds the surrogate beats the
neutral layer on turn r and speed r, and its median turn error is inside
the interpolation gap, not just within twice it. Adopt, with the seed
set as the next step (§4).

**What the maps show** (`runs/foldA/eval-blanchard-river/maps-270.png`,
`runs/foldB/eval-highland-lake/maps-045.png`): at Highland the surrogate
reproduces WindNinja's lee pockets and the speed texture over the ridges
almost cell for cell, where the neutral layer shows a smooth wash. At
Blanchard the surrogate carries the ridge-scale turning and the lee
slack; WindNinja's own 270° field there is striped east to west across
the whole domain, a solver artefact the surrogate does not copy, so part
of its measured error at Blanchard is the teacher's noise. A net
trained on many areas averages such artefacts out, which is one more
argument for the seed set.

**Found on the way, both in the app's baked momentum bands too:**

- WindNinja writes its u and v on the cell corners: the grids are one
  row and column larger than the DEM, and the value in the cropped cell
  (i, j) is the wind at that cell's north-east corner. `collect()` reads
  them as centres, so the app's momentum bands sit about 21 m south-west
  of the terrain. `dataset.py` averages the four corners onto each
  centre (checked by sub-cell correlation against the turbulence grid,
  which is on the DEM: within an eighth of a cell after the fix). Pass 1
  trained on the uncorrected grids; pass 2 is on the centred ones.
- WindNinja's components are in UTM grid axes, turned from true north
  by the meridian convergence: 1.1° at Pickle, 1.8° at Sault, 1.5° at
  Blanchard. The training code undoes it from the epsg and bounds;
  `collect()` does not, so the baked bands carry a 1–2° fixed turn.
- The first-pass and turbulence-pass runs of the same direction are
  bit-identical, so there is no run-to-run noise floor; the
  interpolation gap stays the yardstick.

Both `collect()` fixes are a few lines and a micro rebake per area;
Pickle's rebake waits on the safety check as before.

### Pass 2, centred grids: the same answer

Both folds retrained on the corner-averaged grids, same settings
(`runs/foldA2`, `runs/foldB2`). The half-cell shift made no difference
the net could use at 30 m:

| held out | turn MAE | turn median | turn r | speed MAE | speed r | speed bias |
|---|---|---|---|---|---|---|
| Blanchard, pass 1 → 2 | 16.1° → 16.1° | 6.7° → 6.9° | 0.40 → 0.42 | 0.177 → 0.178 | 0.79 → 0.79 | −0.03 → −0.04 |
| Highland, pass 1 → 2 | 3.4° → 3.4° | 2.0° → 2.0° | 0.54 → 0.50 | 0.124 → 0.117 | 0.80 → 0.80 | −0.11 → −0.10 |

The baselines are unchanged to the second decimal, so the verdict stands
on the clean data. The eightfold test-time average (`--tta`) is worth
about 0.4° of turn MAE and 0.01–0.04 of turn r for eight passes; take it
when serving, not when iterating. Pass 2's checkpoints are the ones to
build on.

**Open points for the seed-set round:** the speed under-call at
Highland (bias −0.10, its winds run faster than any training area's)
should close once the training set holds faster terrain; a US site held
out for the 3DEP shift; and Big Southern Butte and Salmon River to score
the teacher itself against measured wind.

## 6. Machines

The first folds ran on XEVO (RTX 5060, 8 GB): the 4.7 M parameter net on
192-cell windows peaked at 4.6 GB and trained a fold in 25–27 min.

**Next time, xonix does the inference** (Gavan, 2026-10-09), and the seed
set's training. xonix (hostname XONIC: RTX 5090 with 32 GB, Intel Core Ultra 9
290HX, 64 GB RAM) has only PowerShell and the WindNinja kit today, so it
needs, once:

1. The repo, or just `pipeline/surrogate/` and `pipeline/raw/surrogate/`
   (the npz files and `runs/<name>/ckpt.pt`; about 420 MB for the five
   areas plus baselines). Training reads only numpy; `dataset.py` also
   wants rasterio and pyproj if the kit's runs are to be rebuilt there.
2. Python 3.14 and `pip install numpy scipy pyproj rasterio matplotlib`,
   then `pip install torch --index-url https://download.pytorch.org/whl/cu128`
   (2.11.0+cu128 has a cp314 wheel; the 5090 is Blackwell like the 5060
   here, so it needs this CUDA 12.8 build and a driver of 570 or later,
   nothing older).
3. Check: `py -3.14 -c "import torch; print(torch.cuda.get_device_name(0))"`
   and `py -3.14 pipeline/surrogate/test_fields.py`.
4. Inference: `py -3.14 pipeline/surrogate/predict.py --area <id>
   --checkpoint runs/<name>/ckpt.pt` writes the 16 fields; a whole area
   takes about 2 s on the laptop, so on xonix the cost is the data, not
   the GPU. Training on 32 GB allows batch 64 or 256-cell windows, or a
   wider net; a fold that takes 25 min here should take well under 10.

The hand-off that exists is the kit share the other way (`\\XEVO\windcfd`),
so either xonix pulls from a checkout or the npz files and checkpoints go
on that share. Nothing of this is set up yet; XONIC did not answer a ping
on 2026-10-09.
