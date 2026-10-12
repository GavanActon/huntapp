# The physics teacher: stability and canopy for the wind surrogate

Status: started 2026-10-11. Gavan's call that day: the big emphasis is a
physics teacher with stability and canopy for the surrogate, and try both
candidates if that is what it takes. This is layer 1 of
[WIND-LEARNING.md](WIND-LEARNING.md) and phase 4 of
[SCALE-PLAN.md](SCALE-PLAN.md) with stability added to the brief. Today's
teacher (WindNinja momentum, neutral, terrain only;
[SURROGATE.md](SURROGATE.md) §2, §5) gets the shape of synoptic speed-up
and shelter and nothing thermal: no Searchmont reversal, no skill in the
Salmon River canyon at night.

Two tracks, run side by side, judged by the same gates:
- **Track A: PALM**, the LES reference with a plant canopy model and
  stratification: slow, proven physics. Below.
- **Track B: the GPU engine** of [GPU-SOLVER.md](GPU-SOLVER.md), with
  buoyancy: fast enough to bake a continent if it is right. Its own section.

## Track A: PALM

Status 2026-10-11 evening: PALM builds and runs on XEVO under WSL2; the
Searchmont case is built, checked and read by PALM; the measuring stick
runs on PALM's own output. Nothing has run at full length. How to build and
run it: [pipeline/teacher/palm/README.md](../pipeline/teacher/palm/README.md).

### What it gives

PALM (palm_model_system v25.10.1, Leibniz Universität Hannover, GPL-3) is a
large-eddy model: it resolves the eddies instead of averaging them away.
Over today's teacher it adds:
- **Stability.** Stratified air from the initial temperature profile, and
  the ground cooling or warming: decoupled floors, drainage, the evening
  inversion, lee waves and the rotors under them. This is the Searchmont
  hypothesis: an SSE wind across the valley, stable air, a rotor on the
  floor.
- **Canopy.** Drag from leaf area density level by level. Here it comes
  from the 2024 LiDAR crowns (DSM − DTM at 1 m) and the FRI's
  conifer/hardwood shares, so the air under the crowns comes out of the
  solve, not out of a rule.
- **The spread, not only the mean.** Gusts, lulls and how often the floor
  reverses, sampled every 30 s near the ground. A felt check is one such
  sample (WIND-LEARNING.md: score checks as samples of a distribution).
- **The same fields as today's teacher.** `palm_to_fields.py` writes the
  surrogate's convention: u, v over the ambient in grid axes, at 10 m over
  the canopy (WindNinja's height), 10 m over the ground, and head height. A
  v2 net can train on it with stability as an input.

What this first setup leaves out:
- **No land surface or radiation model.** The ground's cooling or heating
  is set per stability class, not solved from the sun, sky and soil. PALM
  has both built (LSM, RRTMG); they come next if the simple classes pass.
- **The crowns' cooling and heating are fixed fluxes** (`cthf`: −0.02 K m/s
  at dusk, +0.09 at noon), not computed from radiation with feedback.
- **Stair-step terrain** at 10 m. v25 has cut cells; untested here.
- **Cyclic boundaries.** One static driver serves every direction and
  stability, which is what a teacher needs. The cost: the terrain is tapered
  to one height over the outer 640 m, and the hill's wake comes round again
  after one box length (5.1 km). The alternative is an inflow with
  synthetic turbulence on a grid turned to the wind: one driver per
  direction.
- **Head height is under the first level** (5 m at 10 m spacing). It is
  taken down to 2 m by the log law in the open; under the crowns it is used
  as it is.

### Feasibility, measured on XEVO

XEVO is a Core 7 240H (10 cores, 16 threads; WSL sees 16 CPUs, 15 GB).

- **The build.** `install-palm.sh`, user space (micromamba, conda-forge),
  no root: toolchain 47 s, PALM 148 s, PALM's `example_cbl` test 7 s on 4
  cores. Four traps, all fixed in the script:
  - gfortran 14 to match OpenMPI's and netcdf-fortran's `.mod` files (they
    load in no other compiler generation);
  - CMake 3 (CMake 4 refuses PALM's packages);
  - OpenMPI 5 counts cores, not threads, so ranks past 8 need
    `PRTE_MCA_rmaps_default_mapping_policy=:oversubscribe`;
  - palmrun takes stdin from `/dev/null` (it pipes through `more`).
  
  And one trap in PALM itself: v25's docs give the canopy-top heat flux
  `cthf` in W/m², but the code adds it to the temperature tendency as a
  kinematic flux (K m/s). The first stable test's "−25 W/m²" was −25 K m/s
  and blew up in 11 min; the first midday test's "+110" put w at 38 m/s in a
  minute.
  
  The `--apt` mode is PALM's own Ubuntu recipe, untested here (no sudo).
- **The case.** `build_case.py searchmont` takes 7 min, most of it the 1 m
  LiDAR download. `check_driver.py` passes:
  - PIDS attributes present; grid sizes match the `_p3d`;
  - no NaN, no fill;
  - terrain periodic at the edges;
  - terrain within 0.01 m (median) of the WindNinja trial's 10 m DEM;
  - all four check points in the core.

  The box: 5.12 × 5.12 km, 512 × 512 × 87 cells, relief 231 m, canopy cover
  88%, leaf area index 2.6 (p90 3.4), 26% conifer.
- **PALM reads it and runs.** 20 m versions, 10 min of model time, 12
  ranks:

  | run | time step | cost, µs per point-step (wall) | verdict |
  |---|---|---|---|
  | neutral | 2.0–2.2 s | 0.21 | clean |
  | stable, profile only (no ground cooling) | 2.1–2.25 s | 0.32 | clean |
  | stable, ground flux −0.02 K m/s | 2.1–2.3 s | 0.69 | clean, but PALM's stability iteration at every surface takes 46% of the run |
  | stable, ground cooling −1 K/h | 2.1–2.3 s | 0.31 | clean |
  | stable, ground cooling −1 K/h, canopy top −0.02 K m/s | 2.1–2.3 s | 0.36 | **clean: the stable run's setting** |
  | midday, ground flux +0.06 K m/s, canopy top +0.09 K m/s | 2.8–3.1 s | 0.46 | **clean: the midday run's setting** |
  | stable, canopy top "−25" (taken as K m/s, see above) | 2.2 s falling to 0.3 s by 11 min | — | breaks |
  | stable, nested (20 m root, 10 m core over 3 km), child multigrid 2 cycles | 0.95 s falling to 0.40 s by 2 min | 3.3–3.9 s a step (7.5 M cells) | runs, but jets grow at the child's inflow edge |
  | the same, child multigrid converged | — | over 14 s a step | too slow |

- **The measuring stick runs on PALM's output.** `palm_to_fields.py
  convert` then `score` (with the WindNinja comparison) ran on the 20 m
  tests and on a nested test's root and child. The surrogate's own loader
  (`fields.load_area`) reads the result as it is.
  - The scorer grades a run only when its averaging began after 1.5 h of
    spin-up and its ambient is within 1.5× of the forecast's speed. Every
    test here is short and uncalibrated, so all of them print NOT GRADEABLE
    and their checks are diagnostics.
  - Diagnostics, the same 20 m box and 10 min, floor check at head height:

    | | floor from | turn from the ambient | speed (× ambient) | 30 s samples reversed | treetops from |
    |---|---|---|---|---|---|
    | neutral | 136° | −17° | 0.50 | 0% | 185° |
    | stable | 221° | +68° | 0.19 | 20% | 156° |
    | felt / seen | 308° | (reversed) | light | | 180° |

  - Against WindNinja's 10 m dusk run over the core, the neutral test's
    median turn difference was 14° (speed r 0.60), the stable test's 38°.
  - A 6 min nested test (40 m root, 20 m child, edge jets) called the floor
    from 301–302°.
  - None of this is a result: the tests are too short, coarse and
    uncalibrated to grade. But stable air already turns the floor about
    85° toward what was felt, slows it, and reverses it a fifth of the
    time, where neutral air does none of that. That is the hypothesis's
    direction, and the reason to run the real thing.
- **The wind needs calibrating.** After the 10 min spin-up the domain-mean
  wind 10 m over the canopy was 5.9 km/h, against 28 km/h at 600 m. The
  volume-flow constraint and the canopy drag push the momentum up. A full
  neutral spin-up says how far to scale the initial profile so the
  canopy+10 m mean matches the forecast's 16 km/h. That matters for the
  stable run, where the Froude number sets whether the rotor forms.

### Cost

From XEVO's measured rate:
- 10 m neutral: 6.6 s per step on 12 ranks (0.29 µs per point-step), time
  step 0.95 s;
- stable at 1.71× neutral per step, midday at 2.18× (at 20 m: ground
  cooling and canopy-top cooling at 0.36 µs, midday at 0.46, neutral 0.21);
- a nested step (20 m root + 10 m child, 7.5 M cells, 12 ranks, stable):
  3.3–3.9 s;
- XEVO stops scaling at 8 ranks: 0.35 µs on 4, 0.21 on 8, 0.21 on 12 at
  20 m. That is a memory-bandwidth-bound code.

**xonix is not measured.** With 24 real cores and similar dual-channel
memory I take it at about 2× XEVO, likely 1.5–2.5×. Core-hours below are
xonix wall × 24.

| run | cells | steps | XEVO | xonix, runners stopped | core-hours |
|---|---|---|---|---|---|
| 10 m whole box, neutral, 3 h | 22.8 M | 11,400 | 21 h | ~10 h | ~250 |
| 10 m whole box, stable, 2.5 h | 22.8 M | 9,500 | 30 h | ~15 h | ~350 |
| 10 m whole box, midday, 2.5 h | 22.8 M | 6,400 (dt 1.4 s) | 26 h | ~13 h | ~310 |
| nested 20 m root + 10 m core, stable, 2.5 h (not ready, below) | 7.5 M | 17,600+ | 19 h+ | ~10 h+ | ~230+ |
| 5 m whole box | 185 M | 19,000 | — | does not fit: ~65 GB | — |
| 5 m nest, 1.5 km over the floor, in the 10 m core | +7 M | 19,000+ | ~40 h | ~20 h | ~500 |

- **The first case** is three 10 m whole-box runs (built:
  `searchmont/JOBS/searchmont_{neutral,stable,midday}`): about 38 h of
  xonix, two nights and the day between. The stable run alone, the one
  that answers the question, is about 15 h.
- **The nest is not ready.** A 20 m root with a 10 m child over the core
  would be a third of the cells. It is built
  (`--dx 20 --nest 10:3000 --npe 8,16 --tag nest`) and passes the checks,
  and PALM runs it. But:
  - with PALM's two-cycle multigrid in the child, the child kept 20–60×
    the root's divergence. Jets grew at its inflow (east) edge, 22.5 m/s
    against the root's 8.6 by 2 min, and the shared step fell to 0.40 s;
  - converging the multigrid fixes the solve but costs more per step than
    the nest saves (over 14 s a step against the whole 10 m box's 6.6 s).

  Worth a day's tuning later (a wider child, two-way nesting, the
  terrain smoothed at the child's edge), not on the critical path.
- **5 m** only as a nest, and only for the stable run, if the 10 m result
  is close.
- **At teacher scale** (30 m on a 12 km tile, 2.5 h): about 29 G
  cell-steps, ~20 core-hours a run.
  - The full seed set, 36 sites × 16 directions × 3 stabilities (1,728
    runs), is ~35,000 core-hours: about 60 days of xonix.
  - On rented CPU at $0.02–0.04 a core-hour, $0.7–1.4 k.
  - So PALM can be the teacher of record only in the cloud, or for a
    subset (12 sites × 8 directions × 2 stabilities ≈ 8 days of xonix).
  - PALM's RANS mode (`turbulence_closure = 'tke-e'`) keeps buoyancy and
    canopy at a fraction of the LES cost. It is the cheap variant to try if
    the LES passes.

How sure these are:
- The per-step cost is measured (±15% run to run on a busy laptop).
- The time step is measured at the start of the run; it can fall when the
  turbulence spins up.
- The xonix factor is a guess (±50%).
- The run lengths are judgment (spin-up 1.5–2 h). The stable run is an
  evening transition and never steady, so its length is a choice of how
  far into the evening to look.

### The gates

PALM becomes the teacher, or the teacher for the hard cases, only past
these:

1. **SCALE-PLAN phase 4's rule, as written.** Beat WindNinja on tier 2
   (stations in openings and canopy, by stability class) by 10 points of
   "within 45°", and do not lose on tier 1 (terrain). For a teacher it is
   scored twice: its fields at the stations it covers, and the v2 net
   trained on it against v1 on the 1,200-station scoreboard. Valley floors
   at night are where it should pay.
2. **Searchmont, both ways** (`palm_to_fields.py score`). What "right"
   means, in numbers:
   - **Stable SSE** (from 152°, 16.2 km/h), at the floor check at head
     height:
     - from within 45° of 308° (felt 308, puffs 303 and 313);
     - turned more than 90° from the ambient, in the cell and in the 3 × 3
       median;
     - the reversed air a patch of at least 0.5 ha round the point, not
       one cell;
     - under 0.5 of the ambient speed (felt light).
   - **Stable SSE, the treetops 500 m SE**, at 10 m over the canopy: from
     within 45° of 180°, and not reversed.
   - **Midday** (from 186°, 10.4 km/h, convective):
     - the floor from within 45° of 249° (along the valley), not reversed;
     - the top's five checks (180–299°) with a median miss no worse than
       WindNinja momentum's 30°.
   - **Neutral SSE** has no pass mark. It says whether a reversal is
     stability's (neutral does not reverse: the hypothesis) or the hill's
     alone.
3. **Big Southern Butte** (the surrogate thread's `idaho.py` scoring;
   neutral; the SW–W sectors where the campaign has its wind):
   - speed-ratio r at least WindNinja's 0.40 (0.67–0.78 in SW–W);
   - ratio MAE under its 0.35.

   The over-contrast (predicted speed-ups over 1.3 that measure 1.11) is
   where an LES should win.
4. **Later, the real stability test: the Salmon River canyon at night.**
   Its 27 sensors give every model no skill today (ratio r −0.06 for the
   teacher). Any r over 0.3 is new information.

### Schedule

| day | what | who |
|---|---|---|
| 0 (done, 2026-10-11) | PALM built on XEVO; Searchmont case built, checked, read by PALM; the stable setting chosen; the measuring stick tested; cost measured | agent |
| 1 | a 2 h neutral spin-up at 20 m to calibrate the initial wind (~40 min on XEVO, no xonix needed); WSL2 and PALM on xonix (~45 min) | agent; Gavan |
| 1–3 (two nights) | the three Searchmont runs, 10 m whole box; the stable one first | xonix |
| 2 | convert, score, write up: does stable air reverse the floor? | agent |
| 3–4 | Big Southern Butte: a case from the seed kit's DEM (no area, no canopy; 30 m, 12 km), neutral, 2–4 directions overnight; scored with `idaho.py`'s method | agent + xonix |
| 5 | the gates; if Searchmont and the butte pass, the stability seed design (subset or cloud) and the Salmon River night case | agent, Gavan decides |

About a working week of agent time and 3–4 nights of xonix.

### What Gavan must do

1. **WSL2 on xonix** (admin, once, ~30 min and a reboot):
   - in an admin PowerShell, `wsl --install -d Ubuntu-24.04`, reboot when
     asked; virtualisation must be on in the BIOS;
   - open Ubuntu and make a user;
   - give WSL the machine in `%UserProfile%\.wslconfig`, then
     `wsl --shutdown`:

     ```
     [wsl2]
     memory=48GB
     processors=24
     swap=16GB
     ```
2. **Get the files and install PALM** (no admin, ~5 min):
   - copy `pipeline/teacher/palm/` with its built `searchmont/` folder to
     xonix (the drivers are not in git; or run `build_case.py` there, which
     needs py 3.14 with rasterio, pyproj, scipy, netCDF4 and the area's
     habitat file);
   - in Ubuntu: `bash /mnt/c/<path>/pipeline/teacher/palm/install-palm.sh`.
3. **Stop the WindNinja runners for each run window:** about 15 h for the
   stable run, 38 h for all three Searchmont runs. PALM is memory-bound
   and shares the CPU badly. Restart the runners after. (XEVO could do the
   stable run alone in about 30 h if it is free.)
4. **Decide later:** the cloud spend if PALM becomes the teacher of record
   ($0.7–1.4 k for the full seed set), against a subset on xonix.

### The first full run: stable Searchmont on xonix, 2026-10-12

The 10 m stable case ran on xonix in WSL2 (22 ranks, 1.4 s a step, 4.7×
XEVO; 8,468 steps for 2.5 h of air in about 3.3 h of wall time). The
physics the case exists for showed up: over the last half hour the floor
under the check is turned 118° from the ambient at 0.19 of its speed and
reversed 43% of the time, with a reversed patch of 810 ha across the
valley, and the treetops come out from 138° (felt 180°, within 45°). But
the floor's direction is 36°, not the 308° felt, and the run is not
gradeable by its own gate: the whole low layer went slack, the ambient
at the reference 1.6 km/h against the forecast's 16, with 27 km/h left at
600 m. The case over-stabilised: a ground cooling of 1 K/h for 2.5 h under
a wind held by the column's volume flow put the momentum aloft and let
the valley sleep, which is a stronger inversion than a windy dusk makes.
Against WindNinja the numbers (turn r 0.02, speed r 0.37) mean nothing
in that state. Next: the neutral run as the baseline, then the stable
case again with milder cooling (0.3–0.5 K/h, or a fixed small surface
flux), so the air at 30 m stays near the forecast while the floor is
free to decouple. The decoupling and the reversal are there; the dose
is wrong.

## Track B: GPU engine

Status 2026-10-12, early hours. Step 1 of [GPU-SOLVER.md](GPU-SOLVER.md)'s
spike runs: neutral air over bare terrain, on XEVO's RTX 5060 (8 GB). The
canopy drag is in the code and off; there is no buoyancy yet. On the butte
it does not yet pass the spike's step-1 line against WindNinja (below).

The code is in `pipeline/teacher/lbm/`:
- `lbm.py`: the solver, and one run per area and direction;
- `test_lbm.py`: the tests;
- `compare_wn.py`: against WindNinja's field and the butte's sensors;
- `plotstyle.py`: the figures' look.

Results go to `pipeline/raw/teacher/lbm/` (out of git).

### What runs

- **The solver.** D3Q19 lattice Boltzmann in PyTorch, single precision.
  - Populations are stored as f − w, to keep their digits.
  - The collision is regularised BGK: the populations are rebuilt from
    ρ, j and the second moment. That drops the ghost modes that blow plain
    BGK up near τ = ½.
  - Both moment passes are matrix products. It runs on CUDA when there is
    one, the CPU otherwise.
- **Closure.** An eddy viscosity l²|S| from the local non-equilibrium
  stress (Hou et al. 1996). Two mixing lengths:
  - `les`: Smagorinsky, Cs 0.16, with Mason–Thomson wall damping;
  - `rans`: Blackadar's, steady in about two flow-throughs. This is the
    like-for-like check against WindNinja's k-ε, and the Jackson–Hunt
    test's closure.
- **Forces.** Guo forcing, folded into the rebuilt moments (Guo's source
  term is exactly second-order Hermite).
  - Drag forces −k|u|u are solved semi-implicitly, so they are stable for
    any k.
  - The canopy term −c_d a(z)|u|u is a per-cell drag list, switched off.
- **Floor (`--floor smooth`).** The roughness is a drag layer in each
  column's first air cell: the log law's surface stress,
  (κ / ln(z₁/z₀))² |u_h| u_h, put in as a force.
  - The wall itself takes no stress. A cell is solid where its centre is
    under the true ground.
  - Each population coming out of the ground is rebuilt from the air
    node's own moments, mirrored in the ground's plane (normal from the
    DEM's slope). That is free slip at the true ground, not at a
    staircase.
  - Nodes the ground wraps round (more than 5 wall links, about one wall
    node in five on the butte) keep only the mirrored velocity, for
    stability. That is a known momentum source (below).
- **Drive and inflow.** A forced boundary layer: a body force u*²/δ below
  δ = 500 m balances the surface stress. It stands in for the pressure
  gradient and Coriolis that hold a real boundary layer up.
  - The inlet takes that layer's equilibrium profile (mixing length
    λ 80 m), by non-equilibrium extrapolation. U(top)/U₁₀ is 2.07, the
    geostrophic drag law's ratio for z₀ 0.1 m.
  - With `les` the inlet adds the turbulence of a plane 100 cells in, less
    its mean, rescaled level by level to a neutral surface layer's rms.
- **The other faces.**
  - Outlet: pressure held, behind a viscous sponge.
  - Sides: periodic over a flat buffer.
  - Lid: free slip at 3 × relief + 300 m.
- **One run = one direction.** The lattice is turned so the wind blows
  along +x; the DEM is resampled onto it and blended to flat in the
  buffers.
  - The time-mean wind is sampled at 10 m and 2 m over the ground (the log
    law below the first centre) and turned back onto the DEM grid.
  - It is written in the surrogate's convention: u, v east and north in
    grid axes, over the 10 m speed on flat ground upwind, with the grid
    convergence as `fields.Area.amb` has it.
  - So `idaho.py` can score it as it is. `compare_wn.py` already samples
    the butte's sensors that way.
- **Units.** Lattice units throughout.
  - Mach 0.1 at the top of the boundary layer, so u₁₀ is about 0.028. The
    air over the butte's summit reaches Mach 0.21.
  - τ₀ comes from a lattice Reynolds number, Re = U_top H_lid / ν₀ = 10⁵:
    τ₀ = 0.50015 at 30 m. The air's own Re (~10⁹) is out of reach on any
    lattice, so ν₀ is a stability floor and the closure carries the
    stress.
  - Δt is 0.14 s at 30 m for 22 km/h at 10 m.

### The tests

`test_lbm.py` writes `pipeline/raw/teacher/lbm/tests/tests.json` and
`test-ridge.png`.

- **Links.** Every population that streams out of the ground is replaced
  exactly once, for all three floors (10,111 links, none missing or
  doubled).
- **Flat fetch** (30 m cells, 12 km, 2.7 km lid). The 10 m wind holds at
  1.017–1.020 of the inlet's all the way, and the fitted z₀ is 0.084 m
  against 0.1 m set.
- **2D Gaussian ridge** (h 80 m, L 400 m, h/L 0.2, 10 m cells, `rans`),
  against the same lattice with no ridge:

  | height over the crest | 5 m | 15 m | 25 m | 45 m | 85 m |
  |---|---|---|---|---|---|
  | LBM, smooth floor | +0.56 | +0.45 | +0.40 | +0.32 | +0.24 |
  | Taylor & Lee, 2h/L e^(−3z/L) | +0.39 | +0.36 | +0.33 | +0.29 | +0.21 |
  | LBM, staircase floor | −0.27 | −0.08 | +0.01 | +0.11 | +0.18 |

  - At 10 m the crest is +0.50 against 2h/L = 0.40.
  - The foot dips to 0.94, the lee to 0.94 at 1.9 L, and nothing
    reverses. The lee is smooth: the old check counted 3 minima, all
    kinks under 0.01 where the first air cell steps up a level; it now
    counts only dips deeper than 0.005.
  - So the shape is right and the magnitude 10–40 % high, most in the
    first cell. 4 % of that is the lid's blockage.
- **Stability** (a 300 m hill, 30 m cells, 5,000 steps). All finite.
  - `rans`, Re 10⁵: Mach 0.13, flat 10 m wind 0.99 of the inlet's.
  - `les` at Re 10⁵ and 10⁶ (τ₀ 0.50007 and 0.500007), recycled inflow:
    Mach 0.17, turbulence intensity 0.26 at 10 m upwind.
  - Mass drift under 0.3 % (open boundaries).
- **Speed.** 0.21 GLUPS at 13 M cells, either closure, 240 bytes a cell
  (eager torch, no fused kernel; Triton is not on Windows).
  - Streaming runs near the card's bandwidth (~320 GB/s). The collision is
    85 % of the step.
  - The 30 m butte lattice (517 × 434 × 90 = 20.2 M cells) peaks at
    4.3 GB, and fits here.

### Big Southern Butte, wind from 225°, `rans`, against WindNinja and the sensors

The lattice is a 5 km radius round the summit, turned to the wind, with
2.5 km of inflow, 3 km of outflow and 1.5 km of sides. The comparison is
over the core (87,000 cells), and over the 52 sensors in the 225° bin of
`idaho.py`'s points file. Both models are scored on the flat-ground
variant (speed over its own median on flat ground; R2 is off the lattice).

| | 60 m (2.6 M cells, 3 min) | 30 m (20.2 M cells, 46 min shared) | WindNinja |
|---|---|---|---|
| speed r against WindNinja, core / butte | 0.36 / 0.47 | 0.45 / 0.58 | |
| turn r against WindNinja; median \|Δdir\| | 0.15; 4.2° | 0.19; 4.1° | |
| sensors: ratio r, MAE | 0.44, 0.38 | 0.62, 0.37 | 0.69, 0.29 (uniform 0.29) |
| summit (16): measured 1.09 | 1.72 | 1.82 | 1.03 |
| windward flank (8): measured 1.00 | 1.08 | 1.11 | 0.89 |
| lee flank (13): measured 0.80 | 1.08 | 1.08 | 0.47 |
| plain (15): measured 0.94 | 0.96 | 0.99 | 0.75 |

Figure: `pipeline/raw/teacher/lbm/bsb-rans-30m-225/compare-225.0.png`.

What it says:
- **It fails GPU-SOLVER.md's step-1 line** (median |Δdir| ≤ 3°, speed
  r ≥ 0.9 against WindNinja) and loses to WindNinja at the sensors.
- **It is right where WindNinja is wrong, and wrong where it is right.**
  - On the plain and windward flank the LBM is nearer the measurements
    than WindNinja. WindNinja reads the plain 20 % low.
  - In the lee the truth (0.80) sits between WindNinja's too-deep shelter
    (0.47) and an LBM with no wake at all (1.08).
  - On the summit the LBM is far too fast (1.8 against 1.09).
- **Resolution moves it the right way:** sensor r 0.44 → 0.62 from 60 m to
  30 m.
- **Three causes, in order:**
  - **No internal boundary layer.** At 30 m the first cell is 15 m up, so
    the summit's thin internal boundary layer (the air within metres of
    the ground slowed by it) cannot exist, and the 10 m wind there is the
    fast outer flow logged down.
  - **The wrapped-node wall.** Mirrored velocity without the stress is a
    momentum source on steep and concave ground, which is the lee and
    the summit's edges.
  - **A steady mixing-length closure separates weakly.** The 60 m `les`
    run, which should resolve the separation, drove a jet down the wake
    through the wrapped-node wall, so it says nothing yet.
### The 5090 runs ready to go

`lbm.py` imports only numpy, scipy and torch, takes the runner's
`--data`, and writes to `<data>/runs/lbm/<name>/`, so it runs from the
kit's `code\` as an extra file. `remote.py` will not carry it as it stands:
- `sync` deletes every `code\*.py` that is not in `pipeline/surrogate/`;
- `submit` refuses any script but train, predict and eval.

Two changes on the surrogate side (not made here, the folder is not
Track B's):
1. copy `pipeline/teacher/lbm/lbm.py` to `pipeline/surrogate/lbm.py`;
2. add `"lbm.py"` to `SCRIPTS` in `pipeline/surrogate/remote.py`.

Then:

    py -3.14 pipeline/surrogate/remote.py submit lbm.py -- --area seed-bsb-id --direction 225 --dx 15 --roi 3500 --closure rans --flow-throughs 2 --lattice none --name bsb-rans-15m-225
    py -3.14 pipeline/surrogate/remote.py submit lbm.py -- --area seed-bsb-id --directions 0,22.5,157.5,180,202.5,225,247.5,270,292.5,337.5 --dx 30 --roi 7000 --closure rans --flow-throughs 2 --lattice none --name bsb-rans-30m-10dir

The results come back under `pipeline/raw/surrogate/runs/lbm/<name>/`,
and are compared with:

    py -3.14 pipeline/teacher/lbm/compare_wn.py --run C:/dev/huntapp/pipeline/raw/surrogate/runs/lbm/<name>

- **The 15 m run is the resolution test.** Does the summit come down
  and the sensor r keep rising from 60 m to 30 m to 15 m? It is
  834 × 667 × 176 = 98 M cells, about 22 GB, ~30 k steps: about 50 min
  at ~1 GLUPS.
- **The 10-sector run** puts the butte's whole campaign on `idaho.py`'s
  scoreboard: 650 × 567 × 90 = 33 M cells, 7.4 GB, ~23 k steps a sector,
  about 13 min each, 2.2 h in all.
- **An `les` run waits** for the wrapped-node wall. It would be
  `--closure les --inlet 4000 --flow-throughs 4 --avg-frac 0.5`, at 30 m
  22 M cells, 45 k steps, ~17 min.
- **The ~1 GLUPS is an estimate.** It is 4.7× this card's 0.21, the
  bandwidth ratio (1.79 TB/s against 384 GB/s). The job's log prints the
  measured figure every 1,000 steps.

### The 15 m run on the 5090, 2026-10-12 01:04

The queued run went through the kit: 98 M cells, 29,692 steps, 80 min,
0.60 GLUPS, 20.6 GB peak. Resolution did not fix the physics. Against
WindNinja over the core the speed r rose from 0.45 to 0.56 and the
plain is close (r 0.78), but at the sensors the ratio MAE went from
0.37 to 0.42 with a +0.38 bias: the summit came out at 1.96 of the
reference (measured 1.09, WindNinja 1.03), worse than at 30 m, and the
lee flank at 1.06 (measured 0.80, WindNinja 0.47) with no wake at all:
0.1% of cells under half the ambient against WindNinja's 17%. So the
missing wake and the over-sped summit are the floor and closure, not the
grid, and the next step is the steep-ground wall and the near-ground
stress, not more cells. Step 1 stays open.

### What was learned on the way

The 10 m answer lives in the first cell over the ground, and most of the
night went into the floor. In order:
- **No driving force:** the boundary layer runs down along the fetch.
  Over 30 m flat ground the 10 m wind fell to 0.88 of the inlet's after
  4.5 km and 0.82 after 10.5 km. The forced layer holds it within 0.4 %
  over 12 km.
- **Half-way bounce-back (no-slip), as the brief had it:** at 30 m it
  stalls the first cell, at 0.40 of the inlet's speed on flat ground.
  A log-law wall-function mixing length on that cell made it worse (0.005).
  With τ near ½ a no-slip wall is a momentum sink the eddy viscosity cannot
  repair. Kept as `--floor noslip`.
- **The staircase with specular slip and the drag layer:** right on flat
  ground (fitted z₀ 0.13 m for 0.1), wrong on any slope. Every 1-cell step
  face stops the first layer of air.
  - On the ridge the crest's 10 m wind came out 16 % slow where Taylor &
    Lee give 40 % fast; the foot fell to 0.41 and the lee sawtoothed down
    to 0.14.
  - It is right above about five cells.
  - Kept as `--floor slip`.
- **Bouzidi links with a wall moving at the node's tangential velocity:**
  1.40× in the first cell. Bounce-back returns the node's own
  over-relaxed shear through the wall.
- **The node's moments mirrored in the true ground's plane:** exact on
  flat ground, and it fixes the ridge.
  - It is unstable where the ground wraps a node: on the butte at 60 m it
    blew up in 250 steps.
  - Keeping only the mirrored velocity there is stable, and is today's
    default. It is a momentum source: 1.2× the first cell on flat ground,
    and a jet down the butte's wake under `les`.
  - Taking the staircase's specular links at those nodes instead
    (`Setup.wrapped = "staircase"`) blew up at step 8,000.
- **Recycled turbulence without rescaling** runs away: Mach 0.6 in 3,000
  steps. Rescaled to a surface layer's rms it holds.

### The plan, in GPU-SOLVER.md's order

1. **Neutral terrain (now).** Still to do, in order:
   - **The wrapped-node wall.** A momentum-neutral rule that is also
     stable: the mirrored stress with relaxation, or moments taken from
     the next node up.
   - **The resolution test** (the 15 m job above).
   - **A near-wall model** that carries the internal boundary layer: a
     two-level drag, or the log law from the second cell.
   - **The approach profile from the forecast** (u*, boundary-layer
     depth) instead of a fixed λ and δ.
   - **`les` on the butte's lee**, where WindNinja's shelter is too deep.

   Pass: the kill line below, and the butte gate.
2. **Canopy drag.** F = −c_d a(z)|u|u, already in the code as the `lad`
   drag list.
   - a(z): the point cloud's height strata where LiDAR is fetched, else a
     profile from canopy height × cover with LAI 2–5 by type.
   - With a canopy, z₀ drops to the forest floor's and the sample height
     becomes canopy top + 10 m.
   - Tests:
     - the towers' floor ÷ above-canopy ratios (SCALE-PLAN phase 1: black
       spruce 0.21–0.33, mixedwood 0.20, aspen 0.43, closed hardwood 0.11);
     - Pickle's lake-arm trough and lift, and the camp bog's slot;
     - the 60 Pickle checks.
3. **Buoyancy.** As GPU-SOLVER.md has it:
   - a D3Q7 lattice for potential temperature, with the same eddy
     diffusivity over Pr_t;
   - a Boussinesq force through the same Guo term;
   - a surface heat flux per class (stable −20 W/m², convective +200);
   - an initial θ profile from the forecast;
   - and, new, a Rayleigh damping layer under the lid, since a free-slip
     lid reflects gravity waves.

   Tests: the Salmon River nights and the Searchmont dusk reversal.
4. **Speed and scale.** A fused collide-stream kernel (Triton or CUDA,
   under Linux or WSL2), worth 3–5×. Then nesting (a 30 m region driving a
   3–5 m core) and the 16-direction × 3-class bakes.

**Kill criteria** (GPU-SOLVER.md, kept):
- **Week 1:**
  - bare terrain against WindNinja at 30 m: median |Δdir| ≤ 3° and speed
    r ≥ 0.9;
  - with canopy: the lake-arm trough and lift, and the bog's slot;
  - the 60 Pickle checks: direction within 45° beats 43 %, and speed
    within 2× beats today.
- **Week 2:** 16 directions and a timed core bake.
- **Fail:** stop, and fall back to WindNinja with trees as raised ground
  (SCALE-PLAN B).
- **Today's standing:** the butte at 30 m reads 4.1° and r 0.45.
- **What WindNinja's own field is worth as a reference here:** at the
  sensors it over-shelters the lee and under-reads the plain. So a step-1
  pass should also be judged at the sensors, not only by agreement with
  WindNinja.

### What each step costs on the 5090 (est. ~1 GLUPS, 32 GB ≈ 130 M cells)

| run | lattice | steps | time |
|---|---|---|---|
| butte 30 m, one direction, `rans` | 20–33 M | 18–23 k | 6–13 min |
| butte 15 m, one direction, `rans` | 98 M | 30 k | ~50 min |
| butte 30 m, one direction, `les` (4 flow-throughs, half averaged) | 22 M | 45 k | ~17 min |
| Pickle 3 km core at 5 m, canopy, one direction | 1100 × 800 × 115 = 100 M | 44 k | ~75 min |
| Salmon River 30 m, a stable night (+D3Q7, ×1.4) | ~45 M | 40 k | ~40 min |
| an 11 km SD tile at 20 m, 16 directions, neutral | 825 × 700 × 63 = 36 M | 16 × 33 k | ~5 h |

A fused kernel divides all of these by 3–5.

Against PALM on the same laptop: about 0.1 µs per cell per simulated
second at 10 m on the 5060 (4.7 ns a cell-step, Δt 0.046 s), against
Track A's ~0.3 µs on XEVO's CPU. That is about 3× on this laptop, and
~15× with the 5090, before a fused kernel.

### Inputs, continent-wide

- **Terrain:**
  - HRDEM 1–2 m LiDAR DTM where flown, else MRDEM 30 m (Canada);
  - 3DEP 1 m and 1/3″ (US);
  - ArcticDEM 2 m north of 60°.
- **Canopy:**
  - LiDAR height strata where fetched;
  - GEDI L2B plant-area-volume-density profiles, which are a(z) itself
    (sparse footprints, up to 51.6° N);
  - ETH 10 m and Meta/WRI 1 m canopy height;
  - SCANFI (Canada) and LANDFIRE CH/CC/CBD (US) for cover, type and bulk
    density;
  - MODIS/VIIRS LAI for the column total.
- **Roughness and water:** ESA WorldCover 10 m, NALCMS 30 m, the habitat
  bake's own classes.
- **The air:** HRDPS (2.5 km) and HRRR (3 km), giving the 10 m wind, u*,
  boundary-layer depth and surface heat flux for the inlet profile and
  the stability class; ERA5 for climatologies.

### The gates

Track B is judged by Track A's gates, as written above:
- SCALE-PLAN phase 4's rule;
- Searchmont both ways;
- Big Southern Butte by `idaho.py` (ratio r at least WindNinja's 0.40,
  MAE under 0.35, the over-contrast where an LES should win);
- the Salmon River canyon at night (any r over 0.3).

It adds two of its own:
- **The kill line above.**
- **One more butte mark:** each sensor class (summit, windward, lee,
  plain) within 0.15 of the measured mean ratio. Today it misses the
  summit by 0.7 and the lee by 0.3.
