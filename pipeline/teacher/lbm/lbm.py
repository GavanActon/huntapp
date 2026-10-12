"""A D3Q19 lattice-Boltzmann wind solver over terrain, in torch: Track B of
docs/TEACHER.md (the spec is docs/GPU-SOLVER.md). Step 1 of the spike:
neutral air over bare terrain. The canopy drag term is in the code and off.

One run = one area, one wind direction. The lattice is turned so the wind
blows along +x: the DEM is resampled onto the turned lattice, the inlet is
the upwind face, the outlet the downwind one, the sides are periodic over a
flat buffer, the lid is free-slip. The time-averaged wind is sampled at 10 m
and 2 m above the ground, turned back, and written on the DEM's own grid in
the surrogate's convention (pipeline/surrogate/fields.py): u east and v north
in the grid's axes, divided by the time-mean 10 m speed over the flat ground
upwind.

The scheme
  lattice     D3Q19, populations stored as f - w (single precision keeps its
              digits: rho ~ 1, the departures ~ 1e-3), arrays (q, z, y, x).
  collision   regularised BGK (Latt & Chopard 2006): the post-collision
              populations are rebuilt from rho, j and the second moment, so
              the ghost modes that make plain BGK blow up near tau = 0.5 are
              dropped. Both moment passes are matrix products (cuBLAS).
  closure     an eddy viscosity nu_t = l^2 |S| from the local non-equilibrium
              stress (Hou et al. 1996: tau = (tau0 + sqrt(tau0^2 +
              18 sqrt2 l^2 Q / rho)) / 2). Two mixing lengths:
                les   Smagorinsky with Mason-Thomson wall damping,
                      1/l^2 = 1/(Cs dx)^2 + 1/(kappa (z + z0))^2, Cs 0.16:
                      a large-eddy simulation; wants a turbulent inflow
                      (--recycle) and a long average.
                rans  Blackadar, l = kappa (z + z0) / (1 + kappa (z + z0) /
                      lambda), lambda 80 m: a mixing-length RANS closure. Steady,
                      converges in about two flow-throughs; the like-for-like
                      check against WindNinja's k-epsilon solve, and what the
                      Jackson-Hunt test runs (that theory is a mixing-length one).
  forcing     Guo et al. 2002, written in moment space (the Guo source term
              is exactly a second-order Hermite term, so it folds into the
              rebuilt j and second moment). Drag forces -k |u| u are solved
              semi-implicitly (exact for the cell, stable for any k).
  floor       the roughness is a drag layer in the first fluid cell of every
              column, F = -(kappa / ln(z1 / z0))^2 |u_h| u_h / dz, z1 that
              cell's centre over the ground: the log law's surface stress put
              in as a force (GPU-SOLVER.md's "rough floor handled by a thin
              drag layer"); the wall itself takes no stress (free slip).
              --floor smooth (default): a cell is solid when its centre is
              under the true ground; each population coming out of the
              ground is rebuilt from the air node's own moments mirrored in
              the ground's plane there (normal from the DEM's slope): free
              slip at the true ground, not at a staircase. At nodes the ground
              wraps round (more than 5 wall links) only the mirrored velocity
              is kept, for stability.
              --floor slip: the staircase, specular reflection off its faces.
              Over a slope each 1-cell step face stops the first layer of air
              (the ridge test: the crest's first cell slowed 20 % where it
              should speed up 40 %).
              --floor noslip: half-way bounce-back, no drag layer. At 30 m it
              stalls the first cell (0.4 of the inlet's speed on flat ground).
  canopy      F = -Cd a(z) |u| u per cell (lad, 1/m), off for step 1.
  drive       a forced boundary layer: a body force u*^2 / delta per unit
              mass below delta (500 m) over each column's ground, which
              balances the surface stress, so the approach flow holds its
              profile along the fetch (with no force the boundary layer runs
              down: the 10 m wind falls to 0.88 of the inlet's in 4.5 km of
              flat ground at 30 m). It stands in for the pressure gradient
              and Coriolis that hold a real boundary layer up.
  inlet       non-equilibrium extrapolation (Guo, Zheng & Shi 2002) to the
              boundary layer's equilibrium profile under the mixing-length
              closure (log near the ground, flat from delta); --drive none:
              a log profile held constant above --z-cap. With
              --recycle N (les) the inlet adds the turbulence of the plane N
              cells in, less its mean, rescaled level by level to a neutral
              surface layer's rms (sigma_u, v, w = 2.4, 1.9, 1.25 u*, tapering
              to 0 at delta); valid over the flat inlet buffer.
  outlet      the pressure held (rho = 1), velocity and non-equilibrium
              part extrapolated from the cell before, behind a viscous sponge.
  lid         free-slip (specular), at 3 x relief + 300 m over the lowest
              ground (GPU-SOLVER.md).

Units. Everything runs in lattice units (dx = dt = 1, c_s^2 = 1/3). The inlet
speed at the cap is set by --mach (default 0.1, so u = 0.0577); the 10 m speed
follows from the log profile. The molecular relaxation time comes from a
target lattice Reynolds number, Re = U_cap H_lid / nu0, both in lattice units
(--re, default 1e5): the real Re of the air (~1e9) cannot be had on any
lattice, so nu0 is a stability floor, not physics; the closure carries the
stress (nu_t / nu0 is 10^2-10^3 in the shear layer). The run is neutral and
inviscid in the large, so the answer is the same at any physical speed; the
physical time step is reported for a 22 km/h wind at 10 m (WindNinja's).

    py -3.14 pipeline/teacher/lbm/lbm.py --area seed-bsb-id --direction 225 --dx 60
    py -3.14 pipeline/teacher/lbm/lbm.py --area seed-bsb-id --direction 225 --dx 30 --flow-throughs 2
    py -3.14 pipeline/teacher/lbm/lbm.py --area seed-bsb-id --direction 225 --dx 30 --closure les         --inlet 4000 --flow-throughs 4 --avg-frac 0.5
    py -3.14 pipeline/teacher/lbm/compare_wn.py --run seed-bsb-id-rans-30m-225
    py -3.14 pipeline/teacher/lbm/test_lbm.py

Self-contained (numpy, scipy, torch; matplotlib not needed), so it runs from
the GPU kit's code folder as well: there the runner adds --data <its data>,
the area is read from <data>/<area>.npz and results go to
<data>/runs/lbm/<name>/, which the runner sends back. Here the area comes from
pipeline/raw/surrogate and results go to pipeline/raw/teacher/lbm/<name>/.

Output, <out>/<name>/:
  <area>.npz          u, v (n_dir, R, C) at 10 m on the DEM grid, u2, v2 at 2 m,
                      all / the time-mean 10 m speed over the flat ground upwind,
                      w (10 m), sd (the 10 m speed's standard deviation over
                      the average / the inlet's 10 m speed; les only), dem, core,
                      valid (where the lattice holds the real terrain), the
                      directions, meta (json: the lattice, the parameters, the
                      timings, per direction)
  lattice-<dir>.npz   the time-averaged u, v, w on the turned lattice (float16,
                      lattice axes, / the reference 10 m speed; --lattice low:
                      the levels up to 12 over the highest ground), the
                      column ground index, the geometry (to map it back)
  log-<dir>.json      the run's history: step, time, GLUPS, max Mach, mass
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
DEFAULT_DATA = HERE.parent.parent / "raw" / "surrogate"
DEFAULT_OUT = HERE.parent.parent / "raw" / "teacher" / "lbm"
KAPPA = 0.41
CS2 = 1.0 / 3.0
# the smooth floor: a first fluid centre closer to the ground than this (in
# cells) is treated as this high by the drag layer and the 10 m sampling
D1_MIN = 0.3
WALL_NEQ_MAX_LINKS = 5
U10_KPH = 22.0  # WindNinja's ambient at 10 m, for reporting physical times only

# ---- D3Q19 ---------------------------------------------------------------------
# velocities (cx, cy, cz); arrays are (q, z, y, x)
C = np.array([
    (0, 0, 0),
    (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
    (1, 1, 0), (-1, -1, 0), (1, -1, 0), (-1, 1, 0),
    (1, 0, 1), (-1, 0, -1), (1, 0, -1), (-1, 0, 1),
    (0, 1, 1), (0, -1, -1), (0, 1, -1), (0, -1, 1),
], dtype=np.int64)
Q = len(C)
W = np.array([1 / 3] + [1 / 18] * 6 + [1 / 36] * 12, dtype=np.float64)
OPP = np.array([int(np.where((C == -c).all(1))[0][0]) for c in C])
INDEX = {tuple(c): i for i, c in enumerate(C)}
# the second moment's six components, (a, b) pairs: xx yy zz xy xz yz
PAIRS = [(0, 0), (1, 1), (2, 2), (0, 1), (0, 2), (1, 2)]
IA = [p[0] for p in PAIRS]
IB = [p[1] for p in PAIRS]
PW = [1.0, 1.0, 1.0, 2.0, 2.0, 2.0]  # off-diagonals count twice in P:P


def moment_matrices() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """M (10, 19): rho, j, Pi from populations. E (19, 10): populations
    from (rho, j, Pi) by the second-order Hermite expansion,
    f_i = w_i [rho + c.j / cs2 + H_i : (Pi - rho cs2 I) / (2 cs2^2)].
    mw (10,): the moments of the weights (what f - w storage leaves out)."""
    M = np.zeros((10, Q))
    E = np.zeros((Q, 10))
    for i, c in enumerate(C.astype(np.float64)):
        M[0, i] = 1.0
        M[1:4, i] = c
        for k, (a, b) in enumerate(PAIRS):
            M[4 + k, i] = c[a] * c[b]
        H = np.outer(c, c) - CS2 * np.eye(3)
        E[i, 0] = W[i] * (1.0 - (c @ c - 3 * CS2) / (2 * CS2))
        E[i, 1:4] = W[i] * c / CS2
        for k, (a, b) in enumerate(PAIRS):
            E[i, 4 + k] = W[i] * H[a, b] / (2 * CS2 ** 2) * (1.0 if a == b else 2.0)
    mw = M @ W
    return M, E, mw


# ---- the case: a ground height map on the lattice's columns ---------------------


@dataclass
class Setup:
    dx: float = 30.0            # lattice cell, m (cubic)
    z0: float = 0.1             # roughness length, m (sagebrush plain ~0.05-0.1)
    closure: str = "rans"       # rans | les
    cs: float = 0.16            # Smagorinsky constant (les)
    lam: float = 80.0           # asymptotic mixing length, m (rans; with delta 500 m the inlet reads U(top)/U10 = 2.07,
                                # the geostrophic drag law's G/U10 for z0 0.1 m, neutral, f 1e-4)
    mach: float = 0.1           # inlet Mach at the cap
    z_cap: float = 500.0        # the log profile is held constant above this, m
    re: float = 1e5             # lattice Reynolds number U_cap H_lid / nu0
    floor: str = "smooth"       # smooth: the wall at the true ground (interpolated links), free slip, drag layer
                                # slip: staircase, specular, drag layer | noslip: staircase bounce-back
    lid_factor: float = 3.0     # lid at lid_factor x relief + lid_add over the lowest ground
    lid_add: float = 300.0
    lid_min: float = 0.0        # m, a floor on the lid height (flat tests)
    sponge: int = 24            # outlet sponge, cells
    sponge_nu: float = 0.05     # extra lattice viscosity at the outlet face
    recycle: int = 0            # les: recycle the turbulence of plane x = recycle (0: off)
    wrapped: str = "velocity"   # smooth floor, nodes the ground wraps: velocity | staircase (see _links_smooth)
    drive: str = "bl"           # bl: a force u*^2 / delta below delta balances the surface stress
                                #     (a forced boundary layer in equilibrium); none: the inlet's momentum only
    delta: float = 500.0        # boundary-layer depth, m (drive bl)
    cd: float = 0.2             # canopy drag coefficient (canopy off when lad is None)


@dataclass
class Geometry:
    """Where the lattice sits on the source grid: column (ix, iy) has its
    centre at the ROI centre + (x0 + (ix + .5) dx) e + (y0 + (iy + .5) dx) n,
    e the flow's unit vector and n its left, both in the grid's (east, north)."""
    e: tuple[float, float] = (1.0, 0.0)
    n: tuple[float, float] = (0.0, 1.0)
    x0: float = 0.0
    y0: float = 0.0
    centre_rc: tuple[float, float] = (0.0, 0.0)
    cell: float = 30.0
    base: float = 0.0           # height of the lattice floor (z index 0's bottom), m
    h_flat: float = 0.0


def mixing_length(z: np.ndarray, s: Setup) -> np.ndarray:
    """Blackadar's mixing length over height z (m above the wall), m."""
    zz = np.asarray(z, np.float64) + s.z0
    return KAPPA * zz / (1.0 + KAPPA * zz / s.lam)


def inlet_shape(z: np.ndarray, s: Setup) -> np.ndarray:
    """u / u* at heights z (m over the wall; 0 at and below it).
    drive bl: the forced boundary layer's equilibrium under the mixing-length
    closure, stress u*^2 (1 - z / delta), so du/dz = u* sqrt(1 - z / delta) /
    l(z), started from the log law at dx/2 (the first cell, as the drag layer
    has it): log near the ground, flat from delta. drive none: the log law,
    flat above z_cap."""
    z = np.asarray(z, np.float64)
    out = np.zeros_like(z)
    pos = z > 0
    if s.drive != "bl":
        out[pos] = np.log(np.clip(z[pos], s.z0 * 1.0001, s.z_cap) / s.z0) / KAPPA
        return out
    z1 = 0.5 * s.dx if s.dx > 2 * s.z0 * 10 else 10 * s.z0
    zg = np.concatenate([np.geomspace(s.z0 * 1.0001, z1, 200, endpoint=False),
                         np.linspace(z1, max(s.delta, z.max()) + s.dx, 4000)])
    ug = np.empty_like(zg)
    lo = zg < z1
    ug[lo] = np.log(zg[lo] / s.z0) / KAPPA
    zh = zg[~lo]
    du = np.sqrt(np.clip(1.0 - zh / s.delta, 0, None)) / mixing_length(zh, s)
    ug[~lo] = np.log(z1 / s.z0) / KAPPA + np.concatenate([[0.0], np.cumsum(0.5 * (du[1:] + du[:-1]) * np.diff(zh))])
    out[pos] = np.interp(z[pos], zg, ug)
    return out


class Lattice:
    """The solver. h: (Y, X) ground height in metres on the lattice's
    columns (any datum); the lattice floor is at min(h) - dx so every column
    has a solid cell under it. A cell is solid when its centre is below the
    ground. zw (Y, X) is where the wall is, in cell-centre index units: the
    true ground for the smooth floor, the staircase's face (half a cell
    under the first fluid centre) for slip and noslip."""

    def __init__(self, h: np.ndarray, setup: Setup, device: str = "cuda", lad: np.ndarray | None = None,
                 nz: int | None = None, chunk_cells: int = 4_000_000, seed: int = 0, log=print):
        self.s = s = setup
        self.log = log
        self.device = dev = torch.device(device)
        h = np.asarray(h, np.float64)
        Y, X = h.shape
        dx = s.dx
        relief = float(h.max() - h.min())
        self.base = float(h.min() - 1.0 * dx)
        gcol = (h - self.base) / dx - 0.5                  # the ground, in cell-centre index units
        ns = np.maximum(np.ceil(gcol).astype(np.int64), 1)  # first fluid cell per column
        self.gcol = gcol
        zw = gcol.copy() if s.floor == "smooth" else ns - 0.5
        self.zw_np = zw
        self.zw = torch.from_numpy(zw.astype(np.float32)).to(dev)
        lid = max(s.lid_factor * relief + s.lid_add, s.lid_min)
        if nz is None:
            nz = int(math.ceil((h.min() + lid - self.base) / dx))
        Z = nz
        if ns.max() >= Z - 4:
            raise ValueError(f"the lid ({Z} cells) is too close to the highest ground ({ns.max()} cells)")
        self.shape = (Z, Y, X)
        self.N = N = Z * Y * X
        self.ns_np = ns
        self.ns = torch.from_numpy(ns).to(dev)
        self.h_lid_cells = Z - int(ns.min())  # fluid depth over the lowest ground

        # inlet: the profile over the inlet column's ground (the inlet face is flat)
        ns_in = int(np.median(ns[:, 0]))
        self.ns_in = ns_in
        zw_in = float(np.median(zw[:, 0]))
        z_ag = (np.arange(Z) - zw_in) * dx                 # m above the inlet's wall
        self.u_max = s.mach * math.sqrt(CS2)
        shape = inlet_shape(z_ag, s)                       # u / u*, 0 in the solid
        top = float(shape.max())
        self.ustar = self.u_max / top
        self.u10 = self.ustar * float(inlet_shape(np.array([10.0]), s)[0])
        prof = self.ustar * shape
        prof[np.arange(Z) < ns_in] = 0.0
        self.profile_np = prof
        self.profile = torch.tensor(prof, dtype=torch.float32, device=dev)
        taper = np.sqrt(np.clip(1.0 - z_ag / max(s.delta, dx), 0.0, 1.0)) * (np.arange(Z) >= ns_in)
        tgt = np.stack([2.4 * taper, 1.9 * taper, 1.25 * taper]) * self.ustar
        self.recycle_target = torch.tensor(tgt, dtype=torch.float32, device=dev).view(3, Z, 1)

        # relaxation
        self.nu0 = self.u_max * self.h_lid_cells / s.re
        self.tau0 = 0.5 + self.nu0 / CS2
        self.dt_phys = self.u10 * dx / (U10_KPH / 3.6)

        # mixing length per cell, lattice units, from the height above the wall
        k_idx = np.arange(Z)[:, None, None]
        fluid_np = k_idx >= ns[None]
        zc = np.where(fluid_np, (k_idx - zw[None]) * dx, dx)  # m over the wall, (Z, Y, X)
        zz = np.maximum(zc, 0.0) + s.z0
        if s.closure == "rans":
            ell = KAPPA * zz / (1.0 + KAPPA * zz / s.lam)
        elif s.closure == "les":
            ell = 1.0 / np.sqrt(1.0 / (s.cs * dx) ** 2 + 1.0 / (KAPPA * zz) ** 2)
        else:
            raise ValueError(s.closure)
        l2 = np.where(fluid_np, (ell / dx) ** 2, 0.0).astype(np.float32)
        self.l2K = torch.from_numpy(l2.reshape(-1)).to(dev).mul_(18.0 * math.sqrt(2.0))
        del zc, zz, ell, l2
        self.solid = torch.from_numpy(~fluid_np).to(dev)
        del fluid_np

        # sponge: extra viscosity rising to sponge_nu at the outlet
        sp = np.zeros(X, np.float32)
        if s.sponge > 0:
            r = np.clip((np.arange(X) - (X - 1 - s.sponge)) / s.sponge, 0, 1)
            sp = (s.sponge_nu / CS2 * r ** 2).astype(np.float32)
        self.sponge = torch.from_numpy(sp).to(dev)
        self.has_sponge = bool(sp.any())

        # moment matrices
        M, E, mw = moment_matrices()
        f32 = torch.float32
        self.M = torch.tensor(M, dtype=f32, device=dev)
        self.E = torch.tensor(E, dtype=f32, device=dev)
        self.mw = torch.tensor(mw, dtype=f32, device=dev).view(10, 1)
        self.w = torch.tensor(W, dtype=f32, device=dev).view(Q, 1)
        # P:P counts the off-diagonals twice: the norm of P scaled by these
        self._pws = torch.tensor([1, 1, 1, math.sqrt(2), math.sqrt(2), math.sqrt(2)], dtype=f32, device=dev).view(6, 1)

        # forces: the wall drag layer, the canopy, the body force
        self.drag = []  # (flat idx int64 sorted, k float32, horizontal-only)
        if s.floor in ("slip", "smooth"):
            yy, xx = np.mgrid[0:Y, 0:X]
            idx = ((ns * Y + yy) * X + xx).reshape(-1)
            d1 = np.clip((ns - zw) * dx, D1_MIN * dx, dx).reshape(-1)   # the first centre over the wall
            kw = (KAPPA / np.log(d1 / s.z0)) ** 2
            order = np.argsort(idx)
            self.drag.append((torch.from_numpy(idx[order]).to(dev),
                              torch.from_numpy(kw[order].astype(np.float32)).to(dev), True))
            self.k_wall = float(np.median(kw))
        else:
            self.k_wall = 0.0
        if lad is not None:
            # canopy: lad (Z, Y, X) leaf area density, 1/m; k = Cd a dx in lattice units
            lad = np.asarray(lad, np.float32).reshape(-1)
            idx = np.nonzero(lad > 0)[0]
            self.drag.append((torch.from_numpy(idx).to(dev),
                              torch.from_numpy((s.cd * lad[idx] * dx).astype(np.float32)).to(dev), False))
        self.ax = None
        if s.drive == "bl":
            # u*^2 / delta per unit mass below delta (lattice units), by height over each column's wall
            k_idx = torch.arange(Z, device=dev).view(Z, 1, 1)
            zc = (k_idx - self.zw.view(1, Y, X)) * dx
            fl = k_idx >= self.ns.view(1, Y, X)
            self.ax = torch.where(fl & (zc < s.delta), self.ustar ** 2 / (s.delta / dx), 0.0)                 .to(torch.float32).reshape(-1)
            del zc
        elif s.drive != "none":
            raise ValueError(s.drive)

        # chunks: z slabs
        YX = Y * X
        per = max(1, chunk_cells // YX)
        self.chunks = [(z0 * YX, min(Z, z0 + per) * YX) for z0 in range(0, Z, per)]
        self.chunk_drag = []
        for a, b in self.chunks:
            items = []
            for idx, k, horiz in self.drag:
                lo = int(torch.searchsorted(idx, torch.tensor([a], device=dev)))
                hi = int(torch.searchsorted(idx, torch.tensor([b], device=dev)))
                if hi > lo:
                    items.append((idx[lo:hi] - a, k[lo:hi], horiz))
            self.chunk_drag.append(items)
        self.chunk_has_ax = [bool(self.ax[a:b].any()) if self.ax is not None else False for a, b in self.chunks]

        # populations
        self.g = torch.zeros((Q, Z, Y, X), dtype=f32, device=dev)
        self.gp = torch.empty_like(self.g)
        self.g2 = self.g.view(Q, N)
        self.gp2 = self.gp.view(Q, N)
        self._links(s.floor)
        self._lid()
        self._initial(seed)
        self.acc = None
        self.n_acc = 0
        self.step_count = 0
        self.history = []

    # -- setup ------------------------------------------------------------------

    def _solid_at(self, c) -> torch.Tensor:
        """solid(x + c) at every x: y periodic, below the floor solid, above
        the lid and beyond the inlet and outlet faces not."""
        Z, Y, X = self.shape
        cx, cy, cz = (int(v) for v in c)
        s = self.solid
        if cy:
            s = torch.roll(s, shifts=-cy, dims=1)
        out = torch.zeros_like(s)
        zs = slice(max(0, -cz), Z - max(0, cz))
        zd = slice(max(0, cz), Z - max(0, -cz))
        xs = slice(max(0, -cx), X - max(0, cx))
        xd = slice(max(0, cx), X - max(0, -cx))
        out[zs, :, xs] = s[zd, :, xd]
        if cz < 0:
            out[0] = True
        return out

    def _flat(self, z, y, x):
        Z, Y, X = self.shape
        return (z * Y + y) * X + x

    def _links(self, floor: str) -> None:  # noqa: C901
        """The populations that meet the terrain, as one gather and one
        scatter: src (direction, cell) post-collision goes to dst (direction,
        cell) after streaming. Face links reverse (bounce-back). Edge links
        reflect specularly off the face the staircase shows them (slip), or
        reverse (noslip); at a concave or convex corner they reverse."""
        Z, Y, X = self.shape
        fluid = ~self.solid
        src_l, dst_l = [], []
        for i in range(1, Q):
            c = C[i]
            hit = fluid & self._solid_at(c)
            nz_axes = [a for a in range(3) if c[a] != 0]
            if len(nz_axes) == 1 or floor == "noslip":  # smooth: the slip rules, for its wrapped nodes
                cases = [(hit, OPP[i], (0, 0, 0))]
            else:
                a, b = nz_axes
                ca = np.zeros(3, np.int64); ca[a] = c[a]
                cb = np.zeros(3, np.int64); cb[b] = c[b]
                sa, sb = self._solid_at(ca), self._solid_at(cb)
                spec_b = hit & sb & ~sa  # the face normal to axis b: flip b, land at x + ca
                spec_a = hit & sa & ~sb  # normal to axis a: flip a, land at x + cb
                back = hit & ~(spec_b | spec_a)
                fb = c.copy(); fb[b] = -fb[b]
                fa = c.copy(); fa[a] = -fa[a]
                cases = [(back, OPP[i], (0, 0, 0)), (spec_b, INDEX[tuple(fb)], tuple(ca)),
                         (spec_a, INDEX[tuple(fa)], tuple(cb))]
            for mask, j, shift in cases:
                z, y, x = torch.nonzero(mask, as_tuple=True)
                if z.numel() == 0:
                    continue
                zt, yt, xt = z + int(shift[2]), (y + int(shift[1])) % Y, x + int(shift[0])
                keep = (xt >= 0) & (xt < X) & (zt >= 0) & (zt < Z)
                src_l.append(i * self.N + self._flat(z[keep], y[keep], x[keep]))
                dst_l.append(int(j) * self.N + self._flat(zt[keep], yt[keep], xt[keep]))
        self.src = torch.cat(src_l)
        self.dst = torch.cat(dst_l)
        self.src2 = None
        self.n_links = int(self.src.numel())
        if floor == "smooth":
            self._links_smooth()

    def _links_smooth(self) -> None:
        """A free-slip wall at the true ground, for any slope: every
        population that streams out of the ground into an air node x is
        rebuilt from x's own post-collision moments mirrored in the ground's
        plane there (the normal n from the ground's slope, not the
        staircase's faces): the velocity loses its part along n, the
        non-equilibrium stress P becomes R P R with R = I - 2 n n^T (the
        normal-tangential shear flips sign, so no stress crosses the wall),
        and f = f_eq(rho, u_t) + w H : (R P R) / (2 cs2^2). On flat ground this
        is specular reflection; on a slope the step faces no longer stop the
        air (a population sent back off a step face is the one in balance
        with air moving along the slope). The stress is the drag layer's.

        Tried first and dropped (2026-10-11): half-way bounce-back (no-slip)
        stalls the first cell at 30 m (0.4 of the inlet's speed; 0.005 with a
        log-law wall function on its mixing length), and Bouzidi bounce-back
        with a wall moving at the node's tangential velocity sends the
        node's own shear back through the wall, which with tau near 1/2
        pushes the first cell to 1.4.

        Nodes the ground wraps round (more than 5 wall links; a flat floor
        has 5, and on the butte at 60 m about one wall node in five has more)
        cannot take the mirrored stress: rebuilt from themselves, it feeds back
        on itself and blows up on the butte's 30-45 degree slopes within 250
        steps. Setup.wrapped says what they do instead:
          velocity (default): the mirrored velocity alone. Stable (30 m and
                    60 m rans to the end), but a momentum source: on flat ground
                    the same rule runs the first cell 1.2x fast, and with les
                    it drives a jet down the butte's wake. So steep and
                    concave ground reads too fast near the wall: the first
                    thing to fix.
          staircase: the staircase's specular links (momentum-neutral). On the
                    butte at 60 m rans it went unstable at step 8000."""
        Z, Y, X = self.shape
        fluid = ~self.solid
        slip_src, slip_dst = self.src, self.dst
        dst_dir, nodes = [], []
        for i in range(1, Q):
            hit = fluid & self._solid_at(C[i])
            z, y, x = torch.nonzero(hit, as_tuple=True)
            if z.numel() == 0:
                continue
            dst_dir.append(torch.full_like(z, int(OPP[i])))
            nodes.append(self._flat(z, y, x))
        dst_dir = torch.cat(dst_dir)
        nodes = torch.cat(nodes)
        dst_all = dst_dir * self.N + nodes
        _, inv = torch.unique(nodes, return_inverse=True)
        per = torch.bincount(inv)[inv]                     # wall links at each link's node
        wrapped = per > WALL_NEQ_MAX_LINKS
        if self.s.wrapped != "staircase":
            # wrapped nodes keep the mirrored velocity only (wall_neq 0): stable,
            # but a momentum source there (see the docstring)
            self.wrap_dst = self.wrap_src = None
            self.bnode, self.link_node = torch.unique(nodes, return_inverse=True)
            self.dst = dst_all
            self.link_E = self.E[dst_dir].t().contiguous()
            self.wall_neq = (torch.bincount(self.link_node, minlength=self.bnode.numel())
                             <= WALL_NEQ_MAX_LINKS).float()
            self.src = None
            self.src2 = None
            self.n_links = int(dst_all.numel())
            self.n_wrapped = int(wrapped.sum())
            self._normals()
            return
        # wrapped nodes: the staircase's specular links that land on them
        order = torch.argsort(slip_dst)
        sd, ss = slip_dst[order], slip_src[order]
        pos = torch.searchsorted(sd, dst_all[wrapped])
        assert bool((sd[pos] == dst_all[wrapped]).all()), "the slip and smooth link sets differ"
        self.wrap_dst = dst_all[wrapped]
        self.wrap_src = ss[pos]
        keep = ~wrapped
        dst_dir, nodes = dst_dir[keep], nodes[keep]
        self.bnode, self.link_node = torch.unique(nodes, return_inverse=True)
        self.dst = dst_dir * self.N + nodes
        self.link_E = self.E[dst_dir].t().contiguous()       # (10, links): each link's row of E
        self.src = None
        self.src2 = None
        self.n_links = int(dst_all.numel())
        self.n_wrapped = int(wrapped.sum())
        self.wall_neq = torch.ones(self.bnode.numel(), device=self.device)
        self._normals()

    def _normals(self) -> None:
        Z, Y, X = self.shape
        # the ground's normal at each wall node, lattice axes (x, y, z)
        gy_, gx_ = np.gradient(self.gcol)
        nrm = np.stack([-gx_, -gy_, np.ones_like(gx_)])
        nrm /= np.linalg.norm(nrm, axis=0, keepdims=True)
        yx = (self.bnode % (Y * X)).cpu().numpy()
        nb = nrm.reshape(3, -1)[:, yx]
        n = torch.from_numpy(nb.astype(np.float32)).to(self.device)
        self.bnode_n = n
        # R = I - 2 n n^T per node, (nb, 3, 3)
        self.bnode_R = torch.eye(3, device=self.device).unsqueeze(0) - 2.0 * n.t().unsqueeze(2) * n.t().unsqueeze(1)

    def _wall_smooth(self, g: torch.Tensor, gp: torch.Tensor) -> None:
        gb = gp.view(Q, -1)[:, self.bnode]
        mb = torch.addmm(self.mw, self.M, gb)               # true moments, post-collision
        rho = mb[0]
        u = mb[1:4] / rho
        n = self.bnode_n
        ut = u - (u * n).sum(0, keepdim=True) * n
        # post-collision non-equilibrium stress, full tensor (nb, 3, 3)
        P = mb[4:10] - rho * u[IA] * u[IB]
        P[0:3] -= rho * CS2
        Pm = torch.empty((P.shape[1], 3, 3), device=self.device)
        for k, (a, b) in enumerate(PAIRS):
            Pm[:, a, b] = P[k]
            Pm[:, b, a] = P[k]
        R = self.bnode_R
        Pr = R @ Pm @ R
        m = torch.empty((10, P.shape[1]), device=self.device)
        m[0] = rho - 1.0
        m[1:4] = rho * ut
        for k, (a, b) in enumerate(PAIRS):
            m[4 + k] = rho * ut[a] * ut[b] + self.wall_neq * Pr[:, a, b]
        m[4:7] += (rho - 1.0) * CS2                          # shifted: Pi - cs2 I
        vals = (self.link_E * m[:, self.link_node]).sum(0)
        gv = g.view(-1)
        gv[self.dst] = vals
        if self.wrap_dst is not None:
            gv[self.wrap_dst] = gp.view(-1)[self.wrap_src]

    def _lid(self) -> None:
        self.lid_pairs = []
        for i in range(1, Q):
            cx, cy, cz = C[i]
            if cz == -1:
                self.lid_pairs.append((i, INDEX[(cx, cy, 1)], int(cx), int(cy)))

    def feq_from(self, rho: torch.Tensor, u: torch.Tensor) -> torch.Tensor:
        """(19, n) populations (as f - w) at equilibrium, rho (n,), u (3, n)."""
        m = torch.empty((10, rho.numel()), dtype=torch.float32, device=self.device)
        m[0] = rho
        m[1:4] = rho * u
        m[4:10] = rho * u[IA] * u[IB]
        m[4:7] += rho * CS2
        return torch.addmm(-self.w, self.E, m)

    def _initial(self, seed: int) -> None:
        """The inlet profile everywhere, by height above each column's wall;
        rest in the solid. For les, eddy-sized noise (about 6 cells, trilinear
        from a coarse random field) in the lower layer to start the turbulence."""
        Z, Y, X = self.shape
        dev = self.device
        k = torch.arange(Z, device=dev).view(Z, 1, 1)
        rel = k - self.ns.view(1, Y, X)
        # the inlet's profile by height over each column's wall
        zin = ((k - self.zw.view(1, Y, X)) * self.s.dx).reshape(-1).contiguous()
        zprof = torch.from_numpy(((np.arange(Z) - float(np.median(self.zw_np[:, 0]))) * self.s.dx)
                                 .astype(np.float32)).to(dev)
        idx = torch.searchsorted(zprof, zin).clamp(1, Z - 1)
        za, zb = zprof[idx - 1], zprof[idx]
        t = ((zin - za) / (zb - za)).clamp(0, 1)
        prof_full = (self.profile[idx - 1] * (1 - t) + self.profile[idx] * t).view(Z, Y, X)
        prof_full = torch.where(rel >= 0, prof_full, torch.zeros((), device=dev))
        del zin, idx, za, zb, t
        noise = None
        if self.s.closure == "les":
            gen = torch.Generator(device=dev).manual_seed(seed)
            coarse = torch.randn((1, 3, Z // 6 + 2, Y // 6 + 2, X // 6 + 2), device=dev, generator=gen)
            noise = torch.nn.functional.interpolate(coarse, size=(Z, Y, X), mode="trilinear", align_corners=True)[0]
            noise /= noise.std()
            # in the lowest third of the lid height, fading up
            frac = (rel.float() / max(self.h_lid_cells, 1)).clamp(0, 1)
            noise *= (0.2 * self.u10) * torch.clamp(1.0 - 3.0 * frac, 0, 1)
            noise = noise.reshape(3, -1)
        for a, b in self.chunks:
            n = b - a
            u = torch.zeros((3, n), device=dev)
            u[0] = prof_full.view(-1)[a:b]
            if noise is not None:
                u += noise[:, a:b] * (u[0] > 0)
            self.gp2[:, a:b] = self.feq_from(torch.ones(n, device=dev), u)
        self.g.copy_(self.gp)
        self.g.masked_fill_(self.solid.unsqueeze(0), 0.0)
        self.probe_x = max(2, X // 8)

    # -- one step ---------------------------------------------------------------

    def _collide(self, accumulate: bool) -> None:
        """Regularised BGK + eddy viscosity + Guo forcing, chunk by chunk.
        With f - w storage the moments come out shifted: m0 = rho - 1, the
        second moment's diagonal less cs2; the rebuilt populations need the
        same shift, which E applied to the shifted moments gives exactly
        (E @ mw = w), so neither matrix product carries a bias."""
        t0 = self.tau0
        t0sq = t0 * t0
        X = self.shape[2]
        for ci, (a, b) in enumerate(self.chunks):
            n = b - a
            m = torch.einsum("mq,qn->mn", self.M, self.g2[:, a:b])  # (10, n), shifted (einsum: ~20% faster than mm here)
            drho = m[0]
            rho = drho + 1.0
            inv = torch.reciprocal(rho)
            u = m[1:4] * inv                               # j / rho
            axc = self.ax[a:b] if (self.ax is not None and self.chunk_has_ax[ci]) else None
            if axc is not None:
                u[0].add_(axc, alpha=0.5)
            acc_terms = []
            for idx, k, horiz in self.chunk_drag[ci]:
                us = u[:, idx]
                if horiz:
                    vh = us[:2]
                    sp = torch.sqrt(vh[0] * vh[0] + vh[1] * vh[1])
                    um = (torch.sqrt(1.0 + 2.0 * k * sp) - 1.0) / k
                    uh = vh / (1.0 + 0.5 * k * um)
                    ad = torch.zeros_like(us)
                    ad[:2] = -(k * um) * uh
                    us = torch.cat([uh, us[2:3]], 0)
                else:
                    sp = torch.sqrt((us * us).sum(0))
                    um = (torch.sqrt(1.0 + 2.0 * k * sp) - 1.0) / k
                    us = us / (1.0 + 0.5 * k * um)
                    ad = -(k * um) * us
                u[:, idx] = us
                acc_terms.append((idx, ad))
            uu = torch.empty((6, n), dtype=torch.float32, device=self.device)
            torch.mul(u, u, out=uu[0:3])
            torch.mul(u[0], u[1], out=uu[3])
            torch.mul(u[0], u[2], out=uu[4])
            torch.mul(u[1], u[2], out=uu[5])
            # the non-equilibrium second moment: Pi - rho cs2 I - rho uu
            P = m[4:10]
            P.addcmul_(rho, uu, value=-1.0)
            P[0:3].sub_(drho, alpha=CS2)
            # Guo: the physical one is the raw one + rho (u a + a u) / 2
            if axc is not None:
                rax = rho * axc
                P[0].addcmul_(rax, u[0])
                P[3].addcmul_(rax, u[1], value=0.5)
                P[4].addcmul_(rax, u[2], value=0.5)
            syms = []
            for idx, ad in acc_terms:
                us = u[:, idx]
                sym = rho[idx] * (0.5 * (us[IA] * ad[IB] + ad[IA] * us[IB]))
                P[:, idx] += sym
                syms.append(sym)
            # tau = (tau0 + sqrt(tau0^2 + 18 sqrt2 l^2 Q / rho)) / 2 + sponge; om1 = 1 - 1 / tau
            om1 = torch.linalg.vector_norm(P * self._pws, dim=0)
            om1.mul_(inv).mul_(self.l2K[a:b]).add_(t0sq).sqrt_().add_(t0).mul_(0.5)
            if self.has_sponge:
                om1.view(-1, X).add_(self.sponge)
            om1.reciprocal_().neg_().add_(1.0)
            # post-collision: Pi* - cs2 I = (rho - 1) cs2 I + rho uu + (1 - 1/tau) P (+ Guo)
            P.mul_(om1)
            P.addcmul_(rho, uu)
            P[0:3].add_(drho, alpha=CS2)
            torch.mul(u, rho, out=m[1:4])
            if axc is not None:
                P[0].addcmul_(rax, u[0])
                P[3].addcmul_(rax, u[1], value=0.5)
                P[4].addcmul_(rax, u[2], value=0.5)
                m[1].add_(rax, alpha=0.5)
            for (idx, ad), sym in zip(acc_terms, syms):
                P[:, idx] += sym
                m[1:4, idx] += (0.5 * rho[idx]) * ad
            torch.mm(self.E, m, out=self.gp2[:, a:b])
            if accumulate:
                self.acc[0:3, a:b] += u
                self.acc[3:6, a:b].addcmul_(u, u)

    def _stream(self) -> None:
        g, gp = self.g, self.gp
        g[0] = gp[0]
        for i in range(1, Q):
            cx, cy, cz = (int(v) for v in C[i])
            dz = slice(1, None) if cz == 1 else slice(0, -1) if cz == -1 else slice(None)
            sz = slice(0, -1) if cz == 1 else slice(1, None) if cz == -1 else slice(None)
            dxs = slice(1, None) if cx == 1 else slice(0, -1) if cx == -1 else slice(None)
            sxs = slice(0, -1) if cx == 1 else slice(1, None) if cx == -1 else slice(None)
            if cy == 0:
                g[i, dz, :, dxs] = gp[i, sz, :, sxs]
            elif cy == 1:
                g[i, dz, 1:, dxs] = gp[i, sz, :-1, sxs]
                g[i, dz, 0:1, dxs] = gp[i, sz, -1:, sxs]
            else:
                g[i, dz, :-1, dxs] = gp[i, sz, 1:, sxs]
                g[i, dz, -1:, dxs] = gp[i, sz, 0:1, sxs]

    def _boundaries(self) -> None:
        g, gp = self.g, self.gp
        # terrain
        if self.src is None:
            self._wall_smooth(g, gp)
        else:
            gv, gpv = g.view(-1), gp.view(-1)
            gv[self.dst] = gpv[self.src]
        # lid: specular
        for i_down, i_up, cx, cy in self.lid_pairs:
            g[i_down, -1] = torch.roll(gp[i_up, -1], shifts=(cy, cx), dims=(0, 1))
        # inlet: non-equilibrium extrapolation to the profile (+ recycled turbulence)
        Z, Y, X = self.shape
        g1 = g[:, :, :, 1].reshape(Q, -1)
        m1 = torch.addmm(self.mw, self.M, g1)
        rho1 = m1[0]
        u1 = m1[1:4] / rho1
        uin = torch.zeros_like(u1)
        uin[0] = self.profile.view(Z, 1).expand(Z, Y).reshape(-1)
        if self.s.recycle:
            gr = g[:, :, :, self.s.recycle].reshape(Q, -1)
            mr = torch.addmm(self.mw, self.M, gr)
            ur = (mr[1:4] / mr[0]).view(3, Z, Y)
            fl = ur - ur.mean(dim=2, keepdim=True)
            fl = torch.where(self.profile.view(1, Z, 1) > 0, fl, torch.zeros((), device=fl.device))
            # rescaled per level to the neutral surface layer's rms (2.4, 1.9, 1.25 u*,
            # tapering to 0 at delta), never more than 1.5x up: unscaled, the loop's
            # gain is over 1 and the inflow runs away (Mach 0.6 in 3000 steps)
            rms = torch.sqrt((fl * fl).mean(dim=2, keepdim=True)).clamp_min(1e-9)
            fac = (self.recycle_target / rms).clamp(max=1.5)
            uin += (fl * fac).reshape(3, -1)
        g0 = self.feq_from(rho1, uin) + g1 - self.feq_from(rho1, u1)
        fluid0 = (~self.solid[:, :, 0]).reshape(1, -1)
        g[:, :, :, 0] = torch.where(fluid0, g0, g[:, :, :, 0].reshape(Q, -1)).view(Q, Z, Y)
        # outlet: the pressure held (rho = 1), the velocity and the non-equilibrium
        # part carried from the cell before (non-equilibrium extrapolation again)
        gn = g[:, :, :, -2].reshape(Q, -1)
        mn = torch.addmm(self.mw, self.M, gn)
        un = mn[1:4] / mn[0]
        gout = self.feq_from(torch.ones_like(mn[0]), un) + gn - self.feq_from(mn[0], un)
        fluidn = (~self.solid[:, :, -1]).reshape(1, -1)
        g[:, :, :, -1] = torch.where(fluidn, gout, g[:, :, :, -1].reshape(Q, -1)).view(Q, Z, Y)

    def run(self, steps: int, avg_from: int | None = None, avg_every: int = 5, report_every: int = 500,
            check_every: int = 500) -> dict:
        """steps more steps; averaging from step avg_from (absolute) every
        avg_every steps. Returns the timing summary."""
        if avg_from is not None and self.acc is None:
            self.acc = torch.zeros((6, self.N), dtype=torch.float32, device=self.device)
        sync = torch.cuda.synchronize if self.device.type == "cuda" else (lambda: None)
        sync()
        t0 = time.perf_counter()
        t_last, s_last = t0, self.step_count
        for _ in range(steps):
            st = self.step_count
            accumulate = avg_from is not None and st >= avg_from and (st - avg_from) % avg_every == 0
            self._collide(accumulate)
            self._stream()
            self._boundaries()
            if accumulate:
                self.n_acc += 1
            self.step_count += 1
            if self.step_count % 250 == 0:
                self.g.masked_fill_(self.solid.unsqueeze(0), 0.0)
            if self.step_count % check_every == 0 or self.step_count % report_every == 0:
                sync()
                now = time.perf_counter()
                rate = (self.step_count - s_last) / max(now - t_last, 1e-9)
                diag = self.diagnostics()
                diag.update(step=self.step_count, wall_s=round(now - t0, 2), steps_per_s=round(rate, 2),
                            glups=round(rate * self.N / 1e9, 4))
                self.history.append(diag)
                if self.step_count % report_every == 0:
                    self.log(f"step {self.step_count:6d}  {rate:6.1f} steps/s  {diag['glups']:.3f} GLUPS  "
                             f"Ma max {diag['mach_max']:.3f}  mass {diag['mass_dev']:+.2e}  "
                             f"u10/inlet {diag['u10_flat']:.3f}")
                if not diag["finite"]:
                    raise FloatingPointError(f"non-finite populations at step {self.step_count}")
                t_last, s_last = now, self.step_count
        sync()
        dt = time.perf_counter() - t0
        return {"steps": steps, "seconds": dt, "glups": steps * self.N / dt / 1e9}

    # -- reading it -------------------------------------------------------------

    @torch.no_grad()
    def diagnostics(self) -> dict:
        Z, Y, X = self.shape
        fluid = ~self.solid
        zero = torch.zeros((), device=self.device)
        dev_rho = torch.where(fluid, self.g.sum(0), zero)
        finite = bool(torch.isfinite(dev_rho).all())
        mass_dev = float(dev_rho.sum() / fluid.sum())
        # the fastest air: a sample of the field (every 4th x column, to keep it cheap)
        gs = self.g[:, :, :, ::4].reshape(Q, -1)
        m = torch.addmm(self.mw, self.M, gs)
        sp = torch.sqrt((m[1:4] ** 2).sum(0)) / m[0]
        sp = torch.where(fluid[:, :, ::4].reshape(-1), sp, zero)
        mach = float(sp.max() / math.sqrt(CS2))
        # the 10 m speed at the probe column (over the flat inlet run) / the inlet's
        xi = self.probe_x
        gcol = self.g[:, :, :, xi].reshape(Q, -1)
        mc = torch.addmm(self.mw, self.M, gcol)
        uc = (mc[1:4] / mc[0]).view(3, Z, Y, 1)
        u10c = self.sample_at(uc, 10.0, self.zw[:, xi:xi + 1], self.ns[:, xi:xi + 1])
        u10 = float(torch.sqrt(u10c[0] ** 2 + u10c[1] ** 2).mean())
        return {"finite": finite, "mass_dev": mass_dev, "mach_max": mach, "u10_flat": u10 / self.u10}

    @torch.no_grad()
    def mean_velocity(self) -> torch.Tensor:
        """(3, Z, Y, X) the time-averaged velocity, lattice axes and units."""
        if self.acc is None or self.n_acc == 0:
            raise RuntimeError("nothing averaged")
        return (self.acc[0:3] / self.n_acc).view(3, *self.shape)

    @torch.no_grad()
    def velocity_sd(self) -> torch.Tensor:
        """(Z, Y, X) the standard deviation of the horizontal speed about its
        mean, from the components' variances (a gust measure, les)."""
        mu = self.acc[0:3] / self.n_acc
        var = (self.acc[3:5] / self.n_acc - mu[0:2] ** 2).clamp_min(0).sum(0)
        return torch.sqrt(var).view(*self.shape)

    @torch.no_grad()
    def instantaneous_velocity(self) -> torch.Tensor:
        m = torch.addmm(self.mw, self.M, self.g2)
        return (m[1:4] / m[0]).view(3, *self.shape)

    @torch.no_grad()
    def sample_at(self, field: torch.Tensor, height_m: float, zw: torch.Tensor | None = None,
                  ns: torch.Tensor | None = None) -> torch.Tensor:
        """field (c, Z, Y', X') at height_m over each column's wall (zw, the
        lattice's by default): below the first fluid centre the log law with
        z0 carries that cell's value down; above, linear between cell
        centres. (c, Y', X')."""
        Z = field.shape[1]
        dx, z0 = self.s.dx, self.s.z0
        zw = self.zw if zw is None else zw
        ns = self.ns if ns is None else ns
        c, _, Yp, Xp = field.shape
        zi = zw + height_m / dx                                  # target, cell-centre index units
        below = zi < ns
        d1 = ((ns - zw) * dx).clamp(min=max(D1_MIN * dx, 3 * z0), max=dx)  # first centre over the wall, m
        fac = math.log(max(height_m, 1.01 * z0) / z0) / torch.log(d1 / z0)
        k0 = torch.floor(zi).long().clamp(0, Z - 2)
        k0 = torch.maximum(k0, ns)
        t = (zi - k0).clamp(0, 1)
        k1 = (k0 + 1).clamp(max=Z - 1)
        ex = lambda k: k.view(1, 1, Yp, Xp).expand(c, 1, Yp, Xp)  # noqa: E731
        first = torch.gather(field, 1, ex(ns)).squeeze(1)
        lin = torch.gather(field, 1, ex(k0)).squeeze(1) * (1 - t) + torch.gather(field, 1, ex(k1)).squeeze(1) * t
        return torch.where(below, first * fac, lin)

    def summary(self) -> dict:
        Z, Y, X = self.shape
        return {"shape_zyx": [Z, Y, X], "cells": self.N, "dx_m": self.s.dx, "tau0": self.tau0, "nu0": self.nu0,
                "re_lattice": self.s.re, "u_cap": self.u_max, "u10_inlet": self.u10, "ustar": self.ustar,
                "mach_cap": self.s.mach, "k_wall": self.k_wall, "dt_s_at_22kph": self.dt_phys,
                "lid_cells_over_lowest_ground": self.h_lid_cells, "links": self.n_links,
                "ns_inlet": self.ns_in, "setup": asdict(self.s)}


# ---- the real case: a DEM area, turned to the wind ------------------------------


def ambient(direction_deg: float) -> tuple[float, float]:
    """The unit wind FROM direction_deg as (east, north): fields.ambient."""
    d = math.radians(direction_deg)
    return -math.sin(d), -math.cos(d)


def load_area(path: Path) -> dict:
    z = np.load(path, allow_pickle=False)
    meta = json.loads(str(z["meta"])) if "meta" in z.files else {}
    dem = z["dem"].astype(np.float64)
    if not np.isfinite(dem).all():
        dem = np.where(np.isfinite(dem), dem, np.nanmean(dem))
    out = {"dem": dem, "meta": meta, "core": z["core"].astype(bool), "valid": z["valid"].astype(bool),
           "directions": z["directions"].astype(np.float64)}
    out["conv"] = float(meta.get("gridConvergenceDeg", 0.0))
    out["cell"] = float(meta.get("cell", 30.0))
    return out


def smooth_ramp(d: np.ndarray, flat: float, ramp: float) -> np.ndarray:
    """0 within `flat` of an edge (d = distance from it), rising by a cosine
    to 1 over `ramp`."""
    t = np.clip((d - flat) / max(ramp, 1e-9), 0, 1)
    return 0.5 - 0.5 * np.cos(np.pi * t)


def turned_case(area: dict, direction_deg: float, dx: float, centre_rc: tuple[float, float],
                roi_m: float, inlet_m: float, outlet_m: float, side_m: float,
                flat_in_m: float, ramp_m: float) -> tuple[np.ndarray, Geometry, np.ndarray]:
    """The ground under the turned lattice. The wind from direction_deg
    (true) is, in the grid's axes, the one from direction_deg - conv
    (fields.Area.amb). Returns h (Y, X) in metres, the geometry, and the
    real-terrain weight (1 where the DEM is used unblended)."""
    from scipy.ndimage import map_coordinates, uniform_filter

    dem, cell = area["dem"], area["cell"]
    ee, en = ambient(direction_deg - area["conv"])
    e = (ee, en)
    n = (-en, ee)
    x0 = -(roi_m + inlet_m)
    x1 = roi_m + outlet_m
    y0 = -(roi_m + side_m)
    y1 = roi_m + side_m
    X = int(math.ceil((x1 - x0) / dx))
    Y = int(math.ceil((y1 - y0) / dx))
    xs = x0 + (np.arange(X) + 0.5) * dx
    ys = y0 + (np.arange(Y) + 0.5) * dx
    XS, YS = np.meshgrid(xs, ys)
    de = XS * e[0] + YS * n[0]
    dn = XS * e[1] + YS * n[1]
    col = centre_rc[1] + de / cell
    row = centre_rc[0] - dn / cell
    src = dem
    if dx > cell * 1.01:
        src = uniform_filter(dem, size=max(1, int(round(dx / cell))), mode="nearest")
    R, Cn = dem.shape
    inside = (row >= 0) & (row <= R - 1) & (col >= 0) & (col <= Cn - 1)
    hs = map_coordinates(src, [row, col], order=1, mode="nearest")
    # blend to flat: inlet (with a flat run for the recycling), sides, outlet
    w_in = smooth_ramp(XS - x0, flat_in_m, ramp_m)
    w_out = smooth_ramp(x1 - XS, 0.3 * outlet_m, 0.5 * outlet_m)
    w_side = smooth_ramp(np.minimum(YS - y0, y1 - YS), 0.25 * side_m, 0.6 * side_m)
    # the DEM's own edge: fade over 600 m before it runs out
    dist_edge = np.minimum.reduce([row, col, R - 1 - row, Cn - 1 - col]) * cell
    w_dem = smooth_ramp(dist_edge, 0.0, 600.0) * inside
    wt = w_in * w_out * w_side * w_dem
    ring = (wt < 0.5) & inside
    h_flat = float(np.median(hs[ring])) if ring.any() else float(np.median(hs))
    h = h_flat + wt * (hs - h_flat)
    geo = Geometry(e=e, n=n, x0=x0, y0=y0, centre_rc=tuple(float(v) for v in centre_rc), cell=cell,
                   h_flat=h_flat)
    return h, geo, wt


def to_grid(fields_lat: np.ndarray, geo: Geometry, dx: float, shape: tuple[int, int],
            vector: bool = True) -> np.ndarray:
    """Lattice-plane fields (c, Y, X) back onto the source grid (c, R, C):
    bilinear, NaN outside. With vector, fields_lat[0:2] are (along, left)
    components and come back as (east, north)."""
    from scipy.ndimage import map_coordinates

    R, Cn = shape
    rr, cc = np.mgrid[0:R, 0:Cn].astype(np.float64)
    de = (cc - geo.centre_rc[1]) * geo.cell
    dn = (geo.centre_rc[0] - rr) * geo.cell
    xs = de * geo.e[0] + dn * geo.e[1]
    ys = de * geo.n[0] + dn * geo.n[1]
    ix = (xs - geo.x0) / dx - 0.5
    iy = (ys - geo.y0) / dx - 0.5
    Yl, Xl = fields_lat.shape[-2:]
    inside = (ix >= 0) & (ix <= Xl - 1) & (iy >= 0) & (iy <= Yl - 1)
    out = np.empty((fields_lat.shape[0], R, Cn), np.float64)
    for k in range(fields_lat.shape[0]):
        out[k] = map_coordinates(np.asarray(fields_lat[k], np.float64), [iy, ix], order=1, mode="nearest")
    if vector:
        a, b = out[0].copy(), out[1].copy()
        out[0] = a * geo.e[0] + b * geo.n[0]
        out[1] = a * geo.e[1] + b * geo.n[1]
    out[:, ~inside] = np.nan
    return out


def run_direction(area: dict, direction: float, args, setup: Setup, out_dir: Path, log=print) -> dict:
    dev = args.device
    R, Cn = area["dem"].shape
    if args.centre:
        centre = tuple(float(v) for v in args.centre.split(","))
    else:
        centre = ((R - 1) / 2.0, (Cn - 1) / 2.0)
    h, geo, wt = turned_case(area, direction, setup.dx, centre, args.roi, args.inlet, args.outlet, args.side,
                             args.flat_in, args.ramp)
    t_setup = time.perf_counter()
    lat = Lattice(h, setup, device=dev, chunk_cells=args.chunk, log=log)
    geo.base = lat.base
    t_setup = time.perf_counter() - t_setup
    Z, Y, X = lat.shape
    info = lat.summary()
    log(f"direction {direction:g}: lattice {X} x {Y} x {Z} = {lat.N / 1e6:.1f} M cells at {setup.dx:g} m, "
        f"tau0 {lat.tau0:.6f}, u10 {lat.u10:.4f}, dt {lat.dt_phys:.3f} s, {lat.n_links} terrain links, "
        f"setup {t_setup:.1f} s")
    if dev.startswith("cuda"):
        log(f"  GPU memory after setup: {torch.cuda.memory_allocated() / 2**30:.2f} GB")
    steps = args.steps
    if steps <= 0:
        # flow-throughs at the mean inlet speed
        umean = float(np.mean(lat.profile_np[lat.ns_in:]))
        steps = int(args.flow_throughs * X / umean)
    avg_from = int(steps * (1.0 - args.avg_frac))
    t0 = time.perf_counter()
    timing = lat.run(steps, avg_from=avg_from, avg_every=args.avg_every, report_every=args.report)
    wall = time.perf_counter() - t0
    peak = torch.cuda.max_memory_allocated() / 2**30 if dev.startswith("cuda") else float("nan")
    log(f"  {steps} steps in {wall / 60:.1f} min, {timing['glups']:.3f} GLUPS, peak GPU memory {peak:.2f} GB")

    mean = lat.mean_velocity()
    raw10 = lat.sample_at(mean, 10.0)
    # the reference: the time-mean 10 m speed over the flat ground upwind (the
    # probe column), what WindNinja's ambient means; the inlet's own is kept too
    u_ref = float(torch.sqrt(raw10[0, :, lat.probe_x] ** 2 + raw10[1, :, lat.probe_x] ** 2).mean())
    log(f"  10 m speed over the flat ground upwind: {u_ref / lat.u10:.3f} x the inlet's")
    s10 = raw10 / u_ref
    s2 = lat.sample_at(mean, 2.0) / u_ref
    sd = lat.sample_at(lat.velocity_sd().unsqueeze(0), 10.0)[0] / u_ref if setup.closure == "les" else None
    g10 = to_grid(s10.cpu().numpy(), geo, setup.dx, (R, Cn))
    g2 = to_grid(s2.cpu().numpy(), geo, setup.dx, (R, Cn))
    gsd = to_grid(sd.cpu().numpy()[None], geo, setup.dx, (R, Cn), vector=False)[0] if sd is not None else None
    wt_grid = to_grid(wt[None], geo, setup.dx, (R, Cn), vector=False)[0]
    valid = np.isfinite(g10[0]) & (wt_grid > 0.999)
    # the lattice field, for whoever wants the third dimension
    tag = f"{direction:05.1f}"
    if args.lattice != "none":
        top = Z if args.lattice == "full" else min(Z, int(lat.ns_np.max()) + 12)
        np.savez_compressed(out_dir / f"lattice-{tag}.npz",
                        u=(mean[:, :top].cpu().numpy() / u_ref).astype(np.float16), ns=lat.ns_np.astype(np.int16),
                        h=h.astype(np.float32), weight=wt.astype(np.float32), levels=np.int32(top),
                        geometry=json.dumps(asdict(geo)), summary=json.dumps(info))
    (out_dir / f"log-{tag}.json").write_text(json.dumps({"summary": info, "timing": timing,
                                                         "history": lat.history}, indent=1))
    res = {"u": g10[0], "v": g10[1], "w": g10[2], "u2": g2[0], "v2": g2[1], "sd": gsd, "valid": valid,
           "info": dict(info, steps=steps, avg_from=avg_from, n_avg=lat.n_acc, wall_s=wall, glups=timing["glups"],
                        u10_ref=u_ref, u10_ref_over_inlet=u_ref / lat.u10,
                        peak_gb=peak, geometry=asdict(geo), direction=direction)}
    del lat, mean
    if dev.startswith("cuda"):
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
    return res


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--area", default="seed-bsb-id")
    ap.add_argument("--data", type=Path, default=None,
                    help="where <area>.npz is (default pipeline/raw/surrogate); given (as the GPU kit's runner "
                         "does), results go to <data>/runs/lbm/<name>")
    ap.add_argument("--out", type=Path, default=None, help="results root (default pipeline/raw/teacher/lbm)")
    ap.add_argument("--name", default=None, help="the run's folder under runs/lbm (default from the arguments)")
    ap.add_argument("--direction", type=float, default=225.0, help="wind FROM, degrees true")
    ap.add_argument("--directions", default=None, help="'all' (the area's 16) or a comma list; overrides --direction")
    ap.add_argument("--dx", type=float, default=30.0)
    ap.add_argument("--closure", choices=["rans", "les"], default="rans")
    ap.add_argument("--floor", choices=["smooth", "slip", "noslip"], default="smooth")
    ap.add_argument("--z0", type=float, default=0.1)
    ap.add_argument("--drive", choices=["bl", "none"], default="bl")
    ap.add_argument("--delta", type=float, default=500.0, help="boundary-layer depth for --drive bl, m")
    ap.add_argument("--mach", type=float, default=0.1)
    ap.add_argument("--re", type=float, default=1e5)
    ap.add_argument("--cs", type=float, default=0.16)
    ap.add_argument("--recycle", type=int, default=-1, help="les: recycle plane, cells (default: 100 cells in for les)")
    ap.add_argument("--centre", default=None, help="row,col of the region's centre on the DEM grid (default its middle)")
    ap.add_argument("--roi", type=float, default=5000.0, help="radius of the region kept, m")
    ap.add_argument("--inlet", type=float, default=2500.0, help="upwind buffer, m")
    ap.add_argument("--outlet", type=float, default=3000.0, help="downwind buffer, m")
    ap.add_argument("--side", type=float, default=1500.0, help="lateral buffer, m")
    ap.add_argument("--flat-in", type=float, default=None, help="flat run at the inlet, m (default: buffer / 2, or the recycle run + 300 m)")
    ap.add_argument("--ramp", type=float, default=None, help="flat-to-terrain ramp, m (default: the rest of the inlet buffer)")
    ap.add_argument("--steps", type=int, default=0, help="0: --flow-throughs at the inlet's mean speed")
    ap.add_argument("--flow-throughs", type=float, default=2.5)
    ap.add_argument("--avg-frac", type=float, default=0.3, help="average over the last fraction of the steps")
    ap.add_argument("--avg-every", type=int, default=5)
    ap.add_argument("--report", type=int, default=1000)
    ap.add_argument("--chunk", type=int, default=4_000_000, help="cells per collision chunk (GPU memory)")
    ap.add_argument("--lattice", choices=["low", "full", "none"], default="low",
                    help="the 3D mean field saved per direction: the levels up to 12 over the highest ground, all, none")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args(argv)

    if args.closure == "les" and args.recycle < 0:
        args.recycle = 100
    args.recycle = max(args.recycle, 0)
    if args.flat_in is None:
        args.flat_in = max(0.5 * args.inlet, (args.recycle + 10) * args.dx)
    if args.ramp is None:
        args.ramp = max(args.inlet - args.flat_in, 300.0)
    if args.flat_in + 0.5 * args.ramp > args.inlet + args.roi:
        raise SystemExit("the inlet's flat run and ramp eat into the region: widen --inlet")
    setup = Setup(dx=args.dx, z0=args.z0, closure=args.closure, cs=args.cs, mach=args.mach, re=args.re,
                  floor=args.floor, recycle=args.recycle, drive=args.drive, delta=args.delta)

    if args.out is None:
        args.out = (args.data / "runs" / "lbm") if args.data is not None else DEFAULT_OUT
    if args.data is None:
        args.data = DEFAULT_DATA
    area = load_area(Path(args.data) / f"{args.area}.npz")
    if args.directions == "all":
        dirs = [float(d) for d in area["directions"]]
    elif args.directions:
        dirs = [float(d) for d in args.directions.split(",")]
    else:
        dirs = [args.direction]
    name = args.name or f"{args.area}-{args.closure}-{args.dx:g}m-" + ("all" if len(dirs) > 2 else "-".join(f"{d:g}" for d in dirs))
    out_dir = Path(args.out) / name
    out_dir.mkdir(parents=True, exist_ok=True)
    logf = open(out_dir / "run.log", "a", encoding="utf-8")

    def log(msg: str) -> None:
        line = f"{time.strftime('%H:%M:%S')} {msg}"
        print(line, flush=True)
        logf.write(line + "\n")
        logf.flush()

    log(f"lbm.py {' '.join(sys.argv[1:] if argv is None else argv)}")
    if args.device.startswith("cuda"):
        log(f"device {torch.cuda.get_device_name(0)}, {torch.cuda.mem_get_info()[1] / 2**30:.1f} GB")
    R, Cn = area["dem"].shape
    n = len(dirs)
    U = np.full((n, R, Cn), np.nan, np.float32)
    V, Wf, U2, V2, SD = (np.full_like(U, np.nan) for _ in range(5))
    valid_all = np.ones((R, Cn), bool)
    infos = []
    for k, d in enumerate(dirs):
        r = run_direction(area, d, args, setup, out_dir, log)
        U[k], V[k], Wf[k], U2[k], V2[k] = r["u"], r["v"], r["w"], r["u2"], r["v2"]
        if r["sd"] is not None:
            SD[k] = r["sd"]
        valid_all &= r["valid"]
        infos.append(r["info"])
        meta = {"area": args.area, "source": area["meta"], "directions": dirs[:k + 1], "runs": infos,
                "convention": "u, v: east, north in the DEM grid's axes, / the inlet speed at 10 m over flat "
                              "ground (as fields.py); w the same; u2, v2 at 2 m; sd the 10 m speed's standard "
                              "deviation (les)", "args": vars(args) | {"data": str(args.data)}}
        np.savez_compressed(out_dir / f"{args.area}.npz", u=U[:k + 1], v=V[:k + 1], w=Wf[:k + 1], u2=U2[:k + 1],
                            v2=V2[:k + 1], sd=SD[:k + 1], dem=area["dem"].astype(np.float32), core=area["core"],
                            valid=valid_all, directions=np.array(dirs[:k + 1], np.float32),
                            meta=json.dumps(meta, default=str))
        log(f"  wrote {out_dir / (args.area + '.npz')} ({k + 1}/{n})")
    logf.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
