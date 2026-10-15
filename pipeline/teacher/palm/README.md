# PALM: the stability teacher's first case (Searchmont)

Track A of [docs/TEACHER.md](../../../docs/TEACHER.md). PALM (palm_model_system
v25.10.1, GPL-3, gitlab.palm-model.org) is a large-eddy model with a plant
canopy model and stratification. Here it is set up to answer one question
first: **does stable air under the 2026-10-10 dusk wind (from 152°, 16 km/h)
reverse the Searchmont valley floor, the way Gavan felt it (from 308°), where
neutral WindNinja could not?**

## Files

| file | what |
|---|---|
| `install-palm.sh` | builds PALM under WSL2 Ubuntu, user space (micromamba, conda-forge), or `--apt` |
| `build_case.py` | the static driver (terrain, canopy, z0) and the `_p3d` namelists, as PALM JOBS folders |
| `check_driver.py` | validates a built case and prints a summary |
| `run_case.sh` | runs one run under WSL, copies its output to `pipeline/raw/teacher/palm/runs/`, writes `run.json` + `DONE`, and post-processes where it can |
| `postprocess.py` | after a run, by itself: fields, scent bands, `fields/RUNS.md` (the scheduled task "Groundwind PALM post" on XEVO, every 15 min) |
| `palm_to_fields.py` | `convert`: PALM output to the surrogate's field npz; `score`: the gate and WindNinja |
| `palm_to_scent.py` | `read`: PALM's binary particle output to npz; `bands`: the app's how-often scent bands per source ([SCENT-TEACHER.md](../../../docs/SCENT-TEACHER.md)) |
| `searchmont/case.json`, `grid.npz` | what was built (grid, sources, canopy summary) |
| `searchmont/JOBS/<run>/INPUT/` | `<run>_static` (NetCDF, not in git) and `<run>_p3d` |

The 1 m LiDAR cache is `pipeline/raw/teacher/palm/searchmont-1m.npz`;
converted fields and scores go to `pipeline/raw/teacher/palm/fields/`.

## The case

- **Box:** 5.12 × 5.12 km at 10 m (512 × 512), UTM 16N, aligned with the
  WindNinja trial's 10 m lattice (`C:/tmp/wn-trial/searchmont10`). Its centre
  is 400 m toward 152° from the floor check, so the ski hill (crest 1.5 km
  SSE) and its plateau are upwind inside it. The scored core is the middle
  3 × 3 km; the outer 640 m is tapered to one height for the cyclic
  boundaries.
- **Vertical:** 10 m to 510 m over the lowest ground (the relief is about
  235 m), stretched to 40 m by 1,010 m, to about 1.6 km. Rayleigh damping
  above 1.1 km.
- **Terrain:** HRDEM 2024 1 m LiDAR DTM (Sault Ste. Marie project),
  averaged to 10 m. PALM rounds it to 10 m steps.
- **Canopy:** where and how tall from the same survey's DSM − DTM at 1 m;
  how leafy from the FRI conifer/hardwood shares in the area's habitat grid;
  where in the crown from a beta profile per type. Hardwood leaves half on
  (`--leaf 0.5`, 10 October). Drag coefficient 0.2.
- **Ground roughness** (`z0`): water 0.0002 m, open wetland 0.03, rock and
  road 0.01, else 0.1 (the trees are the leaf area, not z0).
- **Wind:** held by the volume flow of a log profile through the forecast
  speed at 30 m over the lowest ground; no Coriolis (as WindNinja). The
  forecast's true direction is turned onto the UTM grid (convergence
  +2.2°).

| run | wind | air | length | averaged |
|---|---|---|---|---|
| `searchmont_neutral` | 152°, 16.2 km/h | neutral (`neutral = .T.`) | 3 h | last 1 h |
| `searchmont_stable` | 152°, 16.2 km/h | 2 K/100 m to 300 m, 0.5 above; the ground cooling 1 K/h (each surface from the air's temperature at its height); the crowns −0.02 K m/s | 2.5 h | last 30 min |
| `searchmont_midday` | 186°, 10.4 km/h | mixed layer to 800 m; +0.06 K m/s at the ground, +0.09 K m/s (about 110 W/m²) at the canopy top | 2.5 h | last 30 min |

Each writes the averaged 3D u, v, w, e (and θ) up to the canopy over the
highest ground, plus u, v, w on the first four levels over the ground every
30 s over the averaging window (gusts, lulls, how often the floor reverses).

## Build and check (Windows, py 3.14)

    py -3.14 pipeline/teacher/palm/build_case.py searchmont
    py -3.14 pipeline/teacher/palm/check_driver.py searchmont

The layout to run is the 10 m whole box above. A nested layout (a 20 m
root over the box, a 10 m child over the 3 km core, a third of the cells) is
built and runs, but is not ready: the child's multigrid needs converging
over the terrain, and then it costs more than it saves (TEACHER.md):

    py -3.14 pipeline/teacher/palm/build_case.py searchmont --dx 20 --nest 10:3000 --npe 8,16 --tag nest

`--npe` sets the root's and the child's MPI ranks (24 on xonix). Other
switches: `--surface flux|rate|none` and `--cthf` for the stratified runs,
`--leaf` for the hardwood leaves still on, `--canopy forest` for the FRI
stands instead of the LiDAR crowns, `--hours` and `--tag` for short tests.
At 5 m the whole box is 185 M cells and about 65 GB, too big for xonix: 5 m
only as a nest over the floor.

**Tried on XEVO at 20 m (2026-10-11, 10 min of model time):** all three
runs as set here run clean, and so do stable with the profile alone or with
a −0.02 K m/s ground flux. A fixed stable flux doubles the cost (PALM
iterates the surface stability at every surface element), one reason for
the cooling rate. **`cthf` is kinematic (K m/s)** whatever v25's docs say
(W/m²): the code adds it to the temperature tendency as is. "−25" and
"+110" blew the first tests up. Numbers in TEACHER.md.

## The spot cases (2 and 4 m, 2026-10-13)

These are small cyclic boxes, one kind of place each. Most are anchored where Gavan
felt or logged the wind. Results are in TEACHER.md, "Funnelling, and the spots for
rules".

| case | box | runs | what it teaches |
|---|---|---|---|
| `pickle-slot` | 1 km, 4m and 2m | s186 (29 Sep 13:00, felt funnelling NE), s160, s135, w270, nw315, n000, sw225, ne045 | a 30 m channel between two waters, a hill alongside |
| `pickle-bogstrip` | 1 km, 4m (2m: b190) | b190 and b232 (the 29 and 30 Sep evenings, felt along the strip both ways), b150 | a 60 m open strip between 14 m walls |
| `pickle-bogs` | 2 km, 4m | dawn175 and dusk288 (stable, HRDPS's inversions), nw305 | the bogs SW and S of camp: a calm floor's drift, cold air pooling |
| `lacbailey-bank` | 1 km, 4m (2m: n000) | n000, s180, w270, dusk000 | a bank of 50–90 m over a lake: the lee at the shore, the lift, cold air down the bank |

    py -3.14 pipeline/teacher/palm/build_case.py pickle-slot --dx 4 --tag 4m
    py -3.14 pipeline/teacher/palm/build_case.py pickle-slot --dx 2 --tag 2m --runs s186

What a case can set, beyond Searchmont's:
- `vertical` (`const_m`, `dz_top_m`, `top_m`): a shallow column for a fine grid. It keeps
  dz to `const_m` over the highest ground, then stretches to `dz_top_m` and runs to
  `top_m`. At 2 m the old rule (dz to relief + 270 m, top 1.6 km) is about 300 levels.
  `check_driver.py` then wants a top five times the relief, not 600 m over it.
- `taper_percentile`: the level the outer ring is blended to. The default is the median;
  use 5 where the box's edges cross high ground and the water upwind would otherwise
  become a bank.
- `fine_water`: water at 1 m, from `pipeline/raw/lakes-1m-<area>.npz`, else from the
  area's `waterbody-<area>.geojson`, instead of the habitat's 30 m cells. At a few metres
  those cells would take the trees off a channel's walls.
- A run's `zref_m`: the height its `speed_kph` is held at (default 30 m). The inversion
  runs hold HRDPS's 80 m wind.
- A run's `viz` (`box_m`, `stride_m`, `top_m`, `dt_s`, `last_s`): 3D snapshots round the
  point as mask 2 (`<run>_masked_M002`), for pictures. At 2 m over 480 m that is
  250 MB for 2 minutes.

On xonix the kit is the share's copy (`Z:\surrogate\palm`, mounted in Ubuntu as
`/mnt/z`): copy changed scripts and built cases there. Chain runs one after another
(`pickle-slot-chain.sh`, `pickle-rules-chain.sh` there), never two PALM runs at once.

## Install PALM (WSL2 Ubuntu)

    bash /mnt/c/dev/huntapp/pipeline/teacher/palm/install-palm.sh          # no root needed
    bash /mnt/c/dev/huntapp/pipeline/teacher/palm/install-palm.sh --apt    # or Ubuntu's packages

On XEVO (2026-10-11): toolchain 47 s, PALM built in 148 s, PALM's
`example_cbl` test runs on 4 cores in 7 s. Pins that matter: gfortran 14
(OpenMPI's Fortran bindings and netcdf-fortran 4.6.4's `_100` builds come
from it; their `.mod` files load in no other generation) and CMake 3 (CMake
4 refuses PALM's packages).

## Run (WSL)

    bash /mnt/c/dev/huntapp/pipeline/teacher/palm/run_case.sh searchmont_stable --cores 24
    bash /mnt/c/dev/huntapp/pipeline/teacher/palm/run_case.sh searchmont_stable --end 120 --name timing   # a timing test

A nested run takes its ranks from the namelist (`domain_layouts`), whatever
`--cores` says. On XEVO a 10 m step of the whole box takes 6.6 s on 12 ranks
and the code stops scaling at 8 ranks (memory-bound).

Keep PALM's own folders in the Linux file system (`~/palm`, the default):
`/mnt/c` is slow for its temporary files. On xonix, stop the WindNinja
runners for the run.

## Convert and score (Windows)

    py -3.14 pipeline/teacher/palm/palm_to_fields.py convert searchmont searchmont_stable --output pipeline/raw/teacher/palm/runs/searchmont_stable/OUTPUT
    py -3.14 pipeline/teacher/palm/palm_to_fields.py score searchmont --windninja C:/tmp/wn-trial/searchmont10/dusk-mom

A nested run's child is converted too (`<run>_N02.npz`, with the root's
ambient), and `score` reports both. The gate is in `palm_to_fields.py`'s
docstring and in TEACHER.md. A run is graded only after 1.5 h of spin-up
and with its ambient within 1.5× of the forecast's speed; anything shorter
prints NOT GRADEABLE and its checks are diagnostics. The built quick test
(`searchmont_*_t20`: 20 m, 10 min, ~4 min on XEVO's 12 ranks) is for
trying settings, with `--tag t20` on `convert` and `score`.

**Calibrate the wind first.** After a 10 min spin-up the domain-mean wind
10 m over the canopy was a third of the profile's: the volume flow and the
canopy drag push the momentum up. Run a 2 h neutral spin-up at 20 m,
convert it, and scale `speed_kph` in `build_case.py` until the canopy+10 m
mean (the `domain` ambient) is the forecast's.

## Scent in every run (2026-10-14)

Every run built by `build_case.py` also carries scent ([docs/SCENT-TEACHER.md](../../../docs/SCENT-TEACHER.md)):
up to ten passive particle groups, one per source, released on a 1 m box at 1.5 m (or 5 m) over
the local ground from 15 minutes before the averaging window to the end, 15 minutes of life, the
subgrid walk on, reflected at the ground, positions written every 20 s with origin and group
(`OUTPUT/<run>_prt_bin/`), plus `pc_av` in the averaged 3D output and `pc` in the gust mask. The
sources: the case's `scent.sources` (lat/lon or UTM, `heights`, `over_water`), then the point at
1.5 and 5 m, then a ring at `scent.radius_m` (default a fifth of the core), on land inside the core;
`scent=False` on a run turns it off. `check_driver.py` checks the block. `run_case.sh --end` (timing
runs) strips it. After a run:

    py -3.14 pipeline/teacher/palm/palm_to_scent.py read pickle-slot pickle-slot_s186_4m --tag 4m
    py -3.14 pipeline/teacher/palm/palm_to_scent.py bands pickle-slot pickle-slot_s186_4m --tag 4m

`bands` writes, per source, the share of minutes a nose gets noticeable scent on the app's 10 m
grid (the app's NOSE and bands), the reach by sector, the plume's bearing, width and vertical
spread with distance, the share under the canopy and the intermittency at 20/50/100/200 m, to
`pipeline/raw/teacher/palm/fields/<run>_scent*`, with a picture. Runs made before this date have no
particles: rerun them for scent.

### Nothing to do after a run (2026-10-14)

`run_case.sh` ends by writing `run.json` and `DONE` into the run's folder and, where the Windows
Python with the packages is reachable (XEVO), running `postprocess.py` on the spot. Everywhere else
(xonix) the scheduled task **"Groundwind PALM post"** on XEVO runs `postprocess.py --once` every
15 minutes: it finds finished runs under both runs roots (XEVO's own and the share's), converts the
field (`palm_to_fields.py convert`), reads the particles and makes the scent bands (`palm_to_scent.py`),
and rewrites `pipeline/raw/teacher/palm/fields/RUNS.md`, one line per run with what it gave. State is
`<run>/OUTPUT/.post.json`, the log `<run>/post.log`. A rerun under another name (`--name x_scent`)
gets its products under that name. By hand: `postprocess.py --once [--run <folder>] [--force]`.

