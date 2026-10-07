# Spec: a GPU wind engine for North America

Status: plan, 2026-10-06. Nothing built. Decided with Gavan: WindNinja
(MICRO-WIND.md §2) cannot scale to a continent and cannot hold trees or
stability; a GPU lattice-Boltzmann solver can. Spike first, kill criteria
first. Machine: xonix (24 GB VRAM).

## What it must do

One run = one area box, one direction, one stability class. Output: the
mean wind at canopy top / 10 m over open ground on the area's lattice, plus
the gust ratio and direction spread per cell, in the same bands the app
reads today (`mU/mV<dir>`, `mT<dir>`), so the app does not change.

## Physics, in the order they are added

1. **Neutral flow over terrain.** D3Q19 LBM, single precision, BGK or
   cumulant collision (cumulant is stabler at high Re; try BGK first),
   Smagorinsky subgrid (Cs 0.1–0.17). Terrain: half-way bounce-back on the
   DTM, with a wall-function-free rough floor handled by a thin drag layer
   (z0 per cell → equivalent drag in the lowest 2 cells).
2. **Canopy drag.** Per cell, force F = −c_d · a(z) · |u| · u, c_d ≈ 0.2,
   a(z) = leaf area density from the point cloud's 10 m height strata
   (`vegstructure` `strata`, now unused by the wind), else a triangular
   profile from canopy height × cover (LAI 2–5 by type).
3. **Inflow.** Log profile at the upwind face (u* from the 10 m forecast,
   z0 from the upwind land), synthetic turbulence (e.g. a recycling plane
   100 cells in). Outflow: zero-gradient. Lid: free-slip at 3× the tallest
   relief + 300 m. Lateral: periodic if the domain is padded, else
   zero-gradient.
4. **Buoyancy.** A second D3Q7 lattice for potential temperature,
   Boussinesq force, surface flux prescribed per class (stable: −20 W/m²,
   convective: +200). Gives the drainage and the daytime canopy inversion
   from physics instead of rules. Classes: stable, neutral, convective.
5. **Nesting.** Region at 20–30 m drives a core at 3–5 m through its
   boundary faces (one-way).

## Grid and cost (xonix, 24 GB)

| box | cell | cells | VRAM | steps | time / direction |
|---|---|---|---|---|---|
| 3 km core | 3 m | 1000² × 80 | ~8 GB | 20k | ~10 min |
| 11 km SD tile | 10 m | 1100² × 40 | ~5 GB | 15k | ~5 min |
| region 20 km | 30 m | 700² × 30 | ~1.5 GB | 10k | ~2 min |

Time steps: Δt from Ma ≈ 0.05 → u_lattice 0.05; 22 km/h at 3 m cells ⇒
Δt ≈ 0.025 s; 20k steps ≈ 8 min of real flow, average the last half.
Reference GPU rate ~1 GLUPS; measure it on day one.

## Spike (two weeks) and kill criteria

- Week 1: steps 1–2, Pickle core, 4 directions. Checks:
  - bare terrain vs WindNinja 31 m: median |Δdir| ≤ 3°, speed r ≥ 0.9;
  - with canopy: the lake-arm case (48.95427,-85.56700) shows the trough
    and the lift; the camp bog's slot channels;
  - against the 60 Pickle checks (field-data/hunt-log-2026-10-06.gpx):
    direction within 45° beats today's 43 %, speed within 2× beats today.
- Week 2: step 3 properly, 16 directions, time a full core bake. Decide.
- Fail ⇒ stop; fall back to trees-as-raised-ground + per-face z0 in
  WindNinja (memory: huntapp-granular-edges).

## Validation tiers (before any national bake)

| tier | data |
|---|---|
| terrain + openings | RAWS (6 m, wildland clearings, US), ECCC stations |
| woods floor | flux towers with in-canopy profiles (BOREAS/BERMS, AmeriFlux boreal); Gavan's checks, esp. `aloft` |
| forecast | nothing to prove; HRDPS/HRRR already station-tuned |

## Inputs, continent-wide

- Terrain: HRDEM (CA), 3DEP 1–10 m (US), MRDEM/3DEP 30 m fallback.
- Canopy: LiDAR strata where fetched; else ETH/GEDI 10 m height +
  SCANFI (CA) / LANDFIRE (US) cover and type.
- Water, roads, wetlands: as the habitat bake has them.

## Code

- Python, PyTorch + CUDA (native Windows works on xonix; JAX would want
  WSL2). Own kernels: streaming by `torch.roll`, collision fused in a
  TorchScript or Triton kernel if roll is too slow. Candidate base: XLB
  (Apache-2). Not FluidX3D (no commercial use).
- `pipeline/windlbm/`: `domain.py` (box, DTM, canopy, z0), `lbm.py`
  (lattice, collide, stream, forces), `bc.py`, `run.py` (per direction,
  writes u/v/σ at the sample height), `collect.py` (onto the lattice as
  `build_windcfd.collect` does, so `build_microclimate` is unchanged).
- Keep WindNinja as the bare-terrain reference only.

## Open questions

- Sample height: canopy top + 10 m over forest vs 10 m over open; the
  roughness ratio step in build_microclimate must change to match.
- How the floor layer (MICRO-WIND.md §4) takes a canopy-top wind instead
  of a 10 m wind; coupling from the `aloft` checks.
- Stability classes vs continuous: 3 classes × 16 directions = 48 runs per
  area; fine on GPU, 3× the .hab size.
