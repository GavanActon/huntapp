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
| `run_case.sh` | runs one run under WSL and copies its output to `pipeline/raw/teacher/palm/runs/` |
| `palm_to_fields.py` | `convert`: PALM output to the surrogate's field npz; `score`: the gate and WindNinja |
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
