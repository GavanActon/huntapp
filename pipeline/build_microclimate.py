"""The microclimate grid: what the ground does to the wind, on the habitat
grid's 30 m lattice, so the phone can turn one HRDPS wind into the air a
hunter actually feels at head height in a bog, a spruce stand or a lake
shore. Everything here is static: the hour, the sun, the forecast and the
stability are applied in the browser (app/src/weather/micro/).

Inputs:
  raw/mrdem-<region>.npz              NRCan MRDEM 30 m DTM (via rasters.fetch)
  data/habitat-<region>.hab           cover, stand height, crown closure, the
                                      composition (conifer, hardwood, lead
                                      species), and canopySrc where the point
                                      cloud measured height and closure
                                      (build_habitat.measured_canopy)

Four parts, one per layer of docs/MICRO-WIND.md:

1. TERRAIN AND ROUGHNESS (mass-consistent downscaling, Sherman 1978; the
   idea behind WindNinja's conservation-of-mass solver). The air between
   the ground and a lid is a layer of depth H; the first guess u0 is the
   regional wind, uniform; the answer is the closest field to u0 that
   conserves mass in the layer: u = u0 + grad(l), div(H grad l) =
   -div(H u0). Hills thin the layer and the air speeds over or goes round.
   The local roughness (log law through a 60 m blending height: lakes and
   bogs fast, forest slow; z0 by cover class, or from the point cloud's
   height and closure where it measured) scales the result afterwards,
   outside the solve, since that extra air comes down from above, not in
   from the sides.
   Two lids: NEUTRAL (250 m, air goes over) and STABLE (50 m over the
   valleys, air goes round and channels). The
   operator is linear in u0, so a wind from the east and one from the north
   are the only solves: any direction is cos*east + sin*north. That is
   eight small bands for every wind the forecast can bring.

2. THERMALS. Cold air drains down the terrain smoothed to ~100 m and pools
   in closed depressions (priority-flood fill depth); downslope bearing,
   a potential drainage speed from slope and upslope contributing area,
   and the smoothed slope and aspect for daytime upslope flow.

3. LAKES. The bearing a lake breeze blows toward (onshore) near every big
   lake; a land breeze is the reverse.

4. CANOPY. The head-height (2 m) fraction of the local 10 m wind, from
   stand height and closure (log profile to the canopy top, exponential
   decay inside it: Cionco 1965), and tree height for edge shelter. The
   fraction twice: in leaf, and with the leaves down (the hardwood and larch
   share of the closure thinned to bare crowns), which the browser blends
   between by the season.

Output: app/public/data/micro-<region>.hab, the habitat file's format
(gzip of u32 header length · JSON header · bands), same lattice.

    python pipeline/build_microclimate.py
"""

from __future__ import annotations

import gzip
import heapq
import json
import math
import struct
import time
from datetime import date

import numpy as np
from scipy import ndimage, sparse
from scipy.sparse.linalg import splu

import build_habitat as hb
from area import SCRATCH
from common import CACHE_DIR, OUT_DIR, REGION

ROWS, COLS = hb.ROWS, hb.COLS
DX, DY = hb.DX_M, hb.DY_M
G = 9.81

# habitat cover classes
WATER, OPEN_WET, TREED_WET, CON_DENSE, CON_OPEN, MIXED, HARD, SHRUB, REGEN, BARREN, ROAD = 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11

Z0_REF = 0.5  # the boreal mosaic the regional 10 m wind stands over, m
Z_BLEND = 60.0  # roughness no longer matters above this, m
LID_NEUTRAL = 250.0  # layer depth over the large-scale terrain, m
LID_STABLE = 50.0
BASIS_SCALE = 1 / 60  # int8 basis bands: value * scale


def read_hab(path) -> tuple[dict, dict[str, np.ndarray]]:
    raw = gzip.decompress(path.read_bytes())
    hlen = struct.unpack("<I", raw[:4])[0]
    header = json.loads(raw[4 : 4 + hlen])
    base = 4 + hlen
    n = header["cols"] * header["rows"]
    bands = {}
    for b in header["bands"]:
        dt = np.dtype(b["dtype"])
        a = np.frombuffer(raw, dtype=dt, count=n, offset=base + b["offset"]).reshape(header["rows"], header["cols"])
        bands[b["name"]] = a.astype(np.float32) * b["scale"]
    return header, bands


# ---------------------------------------------------------------- roughness

def known_height(height: np.ndarray, src: np.ndarray | None) -> np.ndarray:
    """Where a stand's height is a value: over 0, or anything the point cloud
    measured (src, the habitat's canopySrc, is 1), where 0 m is open ground it
    found. Only the forest map's 0 is a height it did not give, which the
    class table and the canopy fill in (6 m for a treed wetland, 12 m for a
    stand): read as that, a measured open bog was a 6 m wall of trees."""
    return height > 0 if src is None else (height > 0) | (src == 1)


def roughness(cover: np.ndarray, height: np.ndarray, crown: np.ndarray | None = None, src: np.ndarray | None = None) -> np.ndarray:
    """Aerodynamic roughness length z0 (m) per cell: the cover class's, or
    where the point cloud measured the stand (src, the habitat's canopySrc,
    is 1) from the height and closure it measured (docs/MICRO-WIND-LIDAR.md,
    phase 3). With no src, or no crown (the class's z0, which the
    head-height fraction reads), the class table alone, on the heights src
    says are known."""
    z0 = np.full(cover.shape, 0.1, dtype=np.float32)
    tall = np.isin(cover, (TREED_WET, CON_DENSE, CON_OPEN, MIXED, HARD))
    h = np.where(known_height(height, src), height, np.where(cover == TREED_WET, 6.0, 12.0))
    z0[tall] = np.clip(0.1 * h[tall], 0.3, 2.5)
    z0[cover == WATER] = 0.0002
    z0[cover == OPEN_WET] = 0.03
    z0[np.isin(cover, (SHRUB, REGEN))] = 0.2
    z0[np.isin(cover, (BARREN, ROAD))] = 0.05
    if src is None or crown is None:
        return z0
    # The table gives a stand 0.1 h whatever its closure, and every cell of a
    # class one z0. Measured, a closed tall stand stays near 0.1 h and an open
    # one goes to about half that, and under 3 m it is scrub on open ground.
    # Water keeps its own, whatever the point cloud saw over it.
    lidar = (src == 1) & (cover != WATER)
    cc = crown / 100
    measured = np.where(height >= 3, np.clip(height * (0.05 + 0.10 * cc), 0.05, 2.5), np.clip(0.03 + 0.05 * height, 0.03, 0.2))
    return np.where(lidar, measured, z0).astype(np.float32)


def measured_roughness(z0: np.ndarray, table: np.ndarray, cover: np.ndarray, src: np.ndarray, names: list[str]) -> str:
    """The point cloud's z0 against the table's, by cover class, over the
    land cells it measured: the line the bake prints."""
    lidar = (src == 1) & (cover != WATER)
    parts = []
    for k, name in enumerate(names):
        m = lidar & (cover == k)
        if m.sum() < 10:
            continue
        p10, p90 = np.percentile(z0[m], (10, 90))
        parts.append(f"{name} {z0[m].mean():.2f} ({p10:.2f}–{p90:.2f}) against {table[m].mean():.2f}")
    return f"  z0 from the point cloud on {lidar.sum()} land cells, mean m by cover class (p10–p90) against the table's: " + "; ".join(parts)


def speed_ratio(z0: np.ndarray) -> np.ndarray:
    """Local 10 m wind over the regional 10 m wind, from the log law through
    a blending height where the two agree. Roughness takes a few hundred
    metres of fetch to take hold, so ln z0 is smoothed first."""
    lz = ndimage.gaussian_filter(np.log(z0), 3)
    z0s = np.exp(lz)
    ref = math.log(Z_BLEND / Z0_REF) / math.log(10 / Z0_REF)
    return (np.log(10 / z0s) / np.log(Z_BLEND / z0s) * ref).astype(np.float64)


# ---------------------------------------------------------------- mass-consistent solve

def layer_operator(H: np.ndarray):
    """The 5-point finite-volume operator div(H grad .) with l = 0 on the
    edge (air flows in and out freely there)."""
    n = ROWS * COLS
    idx = np.arange(n).reshape(ROWS, COLS)
    hx = 0.5 * (H[:, :-1] + H[:, 1:])  # east faces
    hy = 0.5 * (H[:-1, :] + H[1:, :])  # south faces
    ax = hx / DX**2
    ay = hy / DY**2
    diag = np.zeros((ROWS, COLS))
    diag[:, :-1] += ax
    diag[:, 1:] += ax
    diag[:-1, :] += ay
    diag[1:, :] += ay
    # boundary faces to the l = 0 ghost ring
    diag[:, 0] += H[:, 0] / DX**2
    diag[:, -1] += H[:, -1] / DX**2
    diag[0, :] += H[0, :] / DY**2
    diag[-1, :] += H[-1, :] / DY**2
    rows = [idx.ravel(), idx[:, :-1].ravel(), idx[:, 1:].ravel(), idx[:-1, :].ravel(), idx[1:, :].ravel()]
    cols = [idx.ravel(), idx[:, 1:].ravel(), idx[:, :-1].ravel(), idx[1:, :].ravel(), idx[:-1, :].ravel()]
    vals = [-diag.ravel(), ax.ravel(), ax.ravel(), ay.ravel(), ay.ravel()]
    return sparse.csc_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n))


def face_h(a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """A cell field averaged onto the faces: x faces (ROWS, COLS+1) west to
    east, y faces (ROWS+1, COLS) north to south; edge faces take the edge
    cell's value."""
    ax = np.empty((ROWS, COLS + 1))
    ax[:, 1:-1] = 0.5 * (a[:, :-1] + a[:, 1:])
    ax[:, 0], ax[:, -1] = a[:, 0], a[:, -1]
    ay = np.empty((ROWS + 1, COLS))
    ay[1:-1, :] = 0.5 * (a[:-1, :] + a[1:, :])
    ay[0, :], ay[-1, :] = a[0, :], a[-1, :]
    return ax, ay


def face_div(fx: np.ndarray, fy: np.ndarray) -> np.ndarray:
    """Net outflow per cell from face fluxes (fy positive toward north)."""
    return (fx[:, 1:] - fx[:, :-1]) / DX + (fy[:-1, :] - fy[1:, :]) / DY


def face_grad(l: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lp = np.pad(l, 1, mode="constant")  # l = 0 outside
    gx = (lp[1:-1, 1:] - lp[1:-1, :-1]) / DX
    gy = (lp[:-1, 1:-1] - lp[1:, 1:-1]) / DY  # toward north
    return gx, gy


def solve_basis(dem: np.ndarray, s: np.ndarray, lid: float, big_sigma: float) -> list[np.ndarray]:
    """Two solves (a unit wind toward the east and one toward the north);
    returns [ue, ve, un, vn]: the local wind vector for each, in units of
    the regional 10 m wind, on cell centres."""
    large = ndimage.gaussian_filter(dem, big_sigma)
    H = np.clip(lid + (large - dem), 0.2 * lid, None)
    print(f"    layer depth {H.min():.0f}–{H.max():.0f} m")
    A = layer_operator(H)
    hx, hy = face_h(H)
    sx, sy = face_h(s)
    t = time.time()
    lu = splu(A, permc_spec="COLAMD")
    print(f"    operator factorised · {time.time() - t:.0f}s")
    out = []
    for ex, ey in ((1.0, 0.0), (0.0, 1.0)):
        u0x, v0y = sx * ex, sy * ey  # the first guess's normal velocity on each face
        div0 = face_div(hx * u0x, hy * v0y)
        l = lu.solve(-div0.ravel()).reshape(ROWS, COLS)
        gx, gy = face_grad(l)
        ux, vy = u0x + gx, v0y + gy
        res = np.abs(face_div(hx * ux, hy * vy)).mean() / (np.abs(div0).mean() + 1e-12)
        # back to the centres; the tangential part of the first guess is
        # carried as it was, plus the averaged correction
        u = 0.5 * (ux[:, :-1] + ux[:, 1:])
        v = 0.5 * (vy[:-1, :] + vy[1:, :])
        spd = np.hypot(u, v)
        print(f"    unit wind toward {'east' if ex else 'north'} · divergence left {res:.1e} of the first guess · speed {spd.min():.2f}–{spd.max():.2f}")
        out += [u, v]
    return out


# ---------------------------------------------------------------- thermals

def priority_flood(z: np.ndarray) -> np.ndarray:
    """Barnes et al. 2014 priority-flood depression filling with a tiny
    epsilon so every filled cell still drains to the edge."""
    filled = z.astype(np.float64).copy()
    done = np.zeros(z.shape, dtype=bool)
    heap: list[tuple[float, int, int]] = []
    for r in range(ROWS):
        for c in (0, COLS - 1):
            heapq.heappush(heap, (filled[r, c], r, c))
            done[r, c] = True
    for c in range(1, COLS - 1):
        for r in (0, ROWS - 1):
            heapq.heappush(heap, (filled[r, c], r, c))
            done[r, c] = True
    eps = 1e-4
    nbrs = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))
    while heap:
        zc, r, c = heapq.heappop(heap)
        for dr, dc in nbrs:
            rr, cc = r + dr, c + dc
            if rr < 0 or cc < 0 or rr >= ROWS or cc >= COLS or done[rr, cc]:
                continue
            done[rr, cc] = True
            if filled[rr, cc] <= zc:
                filled[rr, cc] = zc + eps
            heapq.heappush(heap, (filled[rr, cc], rr, cc))
    return filled


def d8_accumulation(filled: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """D8 steepest-descent receivers on the filled surface and the upslope
    contributing area in cells. Returns (acc, bearing toward receiver)."""
    nbrs = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    dist = [DY, math.hypot(DX, DY), DX, math.hypot(DX, DY), DY, math.hypot(DX, DY), DX, math.hypot(DX, DY)]
    pad = np.pad(filled, 1, mode="edge")
    best = np.zeros(filled.shape)
    rec = np.full(filled.shape, -1, dtype=np.int8)
    for k, ((dr, dc), d) in enumerate(zip(nbrs, dist)):
        drop = (filled - pad[1 + dr : 1 + dr + ROWS, 1 + dc : 1 + dc + COLS]) / d
        m = drop > best
        best[m] = drop[m]
        rec[m] = k
    order = np.argsort(filled, axis=None)[::-1]
    acc = np.ones(ROWS * COLS)
    rec_f = rec.ravel()
    for i in order:
        k = rec_f[i]
        if k < 0:
            continue
        r, c = divmod(int(i), COLS)
        dr, dc = nbrs[k]
        rr, cc = r + dr, c + dc
        if 0 <= rr < ROWS and 0 <= cc < COLS:
            acc[rr * COLS + cc] += acc[i]
    # bearing toward the receiver (0 = N, clockwise)
    brg = np.array([math.degrees(math.atan2(dc * DX, -dr * DY)) % 360 for dr, dc in nbrs])
    bearing = np.where(rec >= 0, brg[np.clip(rec, 0, 7)], np.nan)
    return acc.reshape(ROWS, COLS), bearing


def q_bearing(b: np.ndarray, none_mask: np.ndarray) -> np.ndarray:
    return np.where(none_mask | ~np.isfinite(b), 255, np.round(np.nan_to_num(b) % 360 / 360 * 250) % 250).astype(np.uint8)


# ---------------------------------------------------------------- canopy

# The closure a bare aspen or birch crown keeps of its closure in leaf: its
# branches and stems. Leafless, a stand's plant area index is its wood's: 0.9–1.2
# in a mature silver birch stand against 3.6–5.8 in full leaf (Lang & Pisek 2019,
# Forestry Studies 70, hemispherical photos), 0.5 against about 5.6 in an Ontario
# maple–aspen forest (Neumann, den Hartog & Shaw 1989, Agric. For. Meteorol. 45).
# Seen from above as cover (Beer's law, G 0.5, the way closure is measured) that
# leaves 0.2–0.5 of the cover in leaf; this is the middle. A first guess, for the
# wind checks to move (docs/MICRO-WIND.md, Next steps 5).
BARE = 0.35
# Tamarack drops its needles too, but the habitat names only a stand's leading
# species, not its share. Larch-led stands are about 60 % larch on both forest
# maps (Pickle Lake's 41: median 60 %, mean 63 %; Lac Bailey's two, 55 and 65 %).
# Larch further down a stand's list counts as conifer, in leaf all year.
LARCH_LED = 0.6
# A stand the forest map gives no composition is one the 2020 land cover alone
# named (build_habitat.py), and its classes say the leaf type: needleleaf and
# broadleaf forest are three quarters or more of their kind, mixed forest
# neither. Each takes its class's middle, as qc_forest.py does for a cover type.
CLASS_HARDWOOD = {CON_DENSE: 0.1, MIXED: 0.5, HARD: 0.9}


def in_stand(h: np.ndarray, crown: np.ndarray, conifer: np.ndarray) -> np.ndarray:
    """The head-height (2 m) fraction of the local 10 m wind in a stand h m
    tall: log profile down to the top (d = 0.67 h), then the canopy's
    exponential decay; the attenuation coefficient grows with the closure and
    the conifer share, both in % (Cionco 1965: 1–4 across canopies)."""
    zc0 = np.maximum(0.1 * h, 0.3)
    d = 0.67 * h
    f_top = np.log(np.maximum(h - d, 0.5) / zc0) / np.log(10 / zc0)
    a = 1.0 + 2.2 * np.clip(crown / 100, 0.2, 1) + 0.6 * np.clip(conifer / 100, 0, 1)
    return f_top * np.exp(-a * (1 - 2 / np.maximum(h, 2.1)))


def leaves_down(cover: np.ndarray, crown: np.ndarray, conifer: np.ndarray, hardwood: np.ndarray, lead: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The closure (%) and the conifer still in leaf (%) once the leaves are
    down. A stand's deciduous share is its hardwood, plus the larch in a
    larch-led stand, or its class's where the map gave no composition, and
    that share of the closure thins to the bare crowns' BARE. Open ground,
    water and a treed wetland of no known make-up keep their own."""
    larch = np.where(lead == hb.LEAD_LA, np.minimum(LARCH_LED, conifer / 100), 0)
    hw = np.clip(hardwood / 100 + larch, 0, 1)
    unknown = (conifer + hardwood) == 0
    for k, share in CLASS_HARDWOOD.items():
        hw = np.where(unknown & (cover == k), share, hw)
    return crown * (1 - hw * (1 - BARE)), conifer - 100 * larch


def leaves_down_report(canopy: np.ndarray, bare: np.ndarray, crown: np.ndarray, crown_bare: np.ndarray, conifer: np.ndarray, cover: np.ndarray, h: np.ndarray, names: list[str]) -> str:
    """The head-height fraction in leaf and with the leaves down over the
    stands, by cover class, with the closure each reads and, for scale, an
    open stand's (closure at the coefficient's 0.2 floor) of the same height
    and conifer: the line the bake prints."""
    open_stand = np.clip(in_stand(h, np.zeros_like(crown), conifer), 0.04, 0.95)
    parts = []
    for k in (TREED_WET, CON_DENSE, CON_OPEN, MIXED, HARD):
        m = (cover == k) & (h > 0)
        if m.sum() < 10:
            continue
        parts.append(f"{names[k]} {canopy[m].mean():.3f}->{bare[m].mean():.3f} (closure {crown[m].mean():.0f}->{crown_bare[m].mean():.0f}%, open {open_stand[m].mean():.3f})")
    return f"  canopy with the leaves down (bare crowns keep {BARE:g} of their closure), in stands by cover class, in leaf->bare: " + "; ".join(parts)


def main() -> None:
    t0 = time.time()
    print(f"microclimate on the habitat lattice {COLS}×{ROWS} ({DX:.0f}×{DY:.0f} m)")
    header, hab = read_hab(OUT_DIR / f"habitat-{REGION['id']}.hab")
    assert header["cols"] == COLS and header["rows"] == ROWS, "habitat grid does not match build_habitat.py"
    cover = hab["cover"].astype(np.uint8)
    height = hab["height"]
    crown = hab["crown"]
    conifer = hab["conifer"]
    src = hab.get("canopySrc")  # 1 where height and crown are the point cloud's; none in an area without one
    water = cover == WATER

    dem = hb.to_grid(hb.fetch("mrdem"), hb.Resampling.bilinear, np.float32).astype(np.float64)
    dem = np.where(dem < -1000, np.nan, dem)
    dem = np.where(np.isnan(dem), np.nanmedian(dem), dem)

    # ---- 1. terrain and roughness ----
    z0_class = roughness(cover, height, src=src)
    z0 = roughness(cover, height, crown, src)
    if src is not None:
        print(measured_roughness(z0, z0_class, cover, src, header["coverNames"]))
    s = speed_ratio(z0)
    print(f"  roughness speed ratio {s.min():.2f}–{s.max():.2f} (lakes fast, forest slow) · {time.time() - t0:.0f}s")
    # The solve sees the terrain only (a uniform first guess), and the
    # roughness speed ratio is put on afterwards. With the ratio in the first
    # guess, a lake's speed-up had to be fed by air pulled in sideways across
    # the shore, and the wind bent toward the upwind shore and off the
    # downwind one; the air really comes down from above (an internal
    # boundary layer), which a layer this thin cannot carry. Measured
    # 2026-10-01: three quarters of the neutral turning was that artefact.
    ones = np.ones_like(s)
    print("  neutral layer (air goes over the hills)")
    neutral = [a * s for a in solve_basis(dem, ones, LID_NEUTRAL, big_sigma=100)]  # ~3 km
    print("  stable layer (air goes round and down the valleys)")
    stable = [a * s for a in solve_basis(dem, ones, LID_STABLE, big_sigma=35)]  # ~1 km
    print(f"  solved · {time.time() - t0:.0f}s")

    # ---- 2. thermals ----
    zs = ndimage.gaussian_filter(dem, 1.7)  # cold air ignores 30 m bumps
    filled = priority_flood(zs)
    pool = (filled - zs).astype(np.float32)
    pool[water] = 0  # a lake surface is its own level; cold air spreads over it
    acc, route_brg = d8_accumulation(filled)
    gy, gx = np.gradient(zs, DY, DX)
    th_slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    down_brg = (np.degrees(np.arctan2(-gx, gy)) + 360) % 360  # downslope: -grad; +row is south
    # potential drainage speed, m/s, for a strong inversion (scaled in the
    # browser by the forecast's): Prandtl-type sqrt(sin slope), growing
    # with the fetch of cold air draining in from upslope
    # (Mahrt 1982; shallow drainage on 1–5° slopes runs ~0.3–1.5 m/s)
    sin_a = np.sin(np.radians(np.maximum(th_slope, 0.3)))
    fetch_f = 0.6 + 0.4 * np.clip(np.log10(acc) / 3, 0, 1)
    kat = 3.0 * np.sqrt(sin_a) * fetch_f
    in_pool = pool > 0.3
    flat = in_pool | (th_slope < 1.0) | water
    ke = np.where(flat, 0, kat * np.sin(np.radians(down_brg)))
    kn = np.where(flat, 0, kat * np.cos(np.radians(down_brg)))
    # flat ground (bogs, pools, lake surfaces) takes the inflow from the
    # slopes round it: the smoothed drainage vectors, strong at the edges,
    # cancelling in the middle, plus a slow creep toward the outlet
    kes = ndimage.gaussian_filter(ke, 3)
    kns = ndimage.gaussian_filter(kn, 3)
    creep = np.where(in_pool, 0.1, 0.06)
    rb = np.radians(np.nan_to_num(route_brg))
    ke = np.where(flat, kes + creep * np.sin(rb), ke)
    kn = np.where(flat, kns + creep * np.cos(rb), kn)
    kat = np.hypot(ke, kn)
    kat_brg = (np.degrees(np.arctan2(ke, kn)) + 360) % 360
    # how low a spot sits in the ~500 m around it: where the cold layer
    # settles and stays put under a light wind
    rel = zs - ndimage.uniform_filter(zs, size=33)
    print(f"  drainage: {int(in_pool.sum())} pooled cells ({in_pool.mean() * 100:.1f}%), deepest pool {pool.max():.1f} m · {time.time() - t0:.0f}s")

    # ---- 3. lakes: onshore bearing near lakes over ~20 ha ----
    lake_id = hab["lakeId"].astype(int)
    lakes = {l["id"]: l for l in header["lakes"]}
    big = np.isin(lake_id, [i for i, l in lakes.items() if l["areaHa"] >= 20])
    if big.any():
        d_big, (ir, ic) = ndimage.distance_transform_edt(~big, sampling=(DY, DX), return_indices=True)
        rr, cc = np.indices((ROWS, COLS))
        onshore = (np.degrees(np.arctan2((cc - ic) * DX, (ir - rr) * DY)) + 360) % 360  # from the lake toward the cell
        # over the water: toward the nearest land
        d_land, (lr, lc) = ndimage.distance_transform_edt(big, sampling=(DY, DX), return_indices=True)
        to_land = (np.degrees(np.arctan2((lc - cc) * DX, (rr - lr) * DY)) + 360) % 360
        onshore = np.where(big, to_land, onshore)
        shore_d = np.where(big, d_land, d_big)
    else:
        onshore = np.zeros((ROWS, COLS))
        shore_d = np.full((ROWS, COLS), 1e6)
    # the breeze a lake can drive: ~1 m/s off a pond, ~2.5 m/s off a 10 km²
    # lake (Crosman & Horel 2010); on a peninsula or an island the breezes
    # from each side meet and rise, so little of it moves across the ground
    lake_km2 = np.zeros((ROWS, COLS))
    if big.any():
        area = np.zeros(lake_id.max() + 1)
        for lid, l in lakes.items():
            area[lid] = l["areaHa"] / 100
        near_lake = lake_id[ir, ic]
        lake_km2 = area[near_lake]
    land_frac = ndimage.uniform_filter((~water).astype(np.float64), size=21)
    penin = np.clip((land_frac - 0.3) / 0.4, 0.15, 1)
    breeze_max = (1.0 + 1.5 * np.clip(lake_km2 / 10, 0, 1)) * np.where(water, 1, penin)

    # ---- 4. canopy ----
    tall = np.isin(cover, (TREED_WET, CON_DENSE, CON_OPEN, MIXED, HARD))
    h = np.where(tall, np.where(known_height(height, src), height, np.where(cover == TREED_WET, 6.0, 12.0)), 0.0)
    h = np.where(h < 3, 0, h)
    # open ground: log profile 2 m over 10 m, on the class's z0. The law holds
    # only where the roughness is well under 2 m. Where the point cloud finds
    # trees in a cell its class calls open (most of Pickle Lake's measured
    # open wetland is 10 m at half cover: wetland on the wetland map, no FRI
    # stand), the measured z0 near 1 m cut the head-height wind to about a
    # third, to half at the cell checked on 2026-09-29 (which felt breezy to
    # windy), and from 2 m up put it at the floor. The measured z0 is the
    # speed ratio's.
    z0l = np.maximum(z0_class, 0.01)
    f_open = np.log(2 / z0l) / np.log(10 / z0l)
    canopy = np.where(h > 0, in_stand(h, crown, conifer), f_open)
    canopy = np.clip(canopy, 0.04, 0.95)
    print(f"  canopy: head-height fraction {canopy[h > 0].mean():.2f} in stands, {canopy[(h == 0) & ~water].mean():.2f} in the open · {time.time() - t0:.0f}s")
    # The same with the leaves down. The closure is leaf-on, the point cloud's
    # (both flown in leaf) and the forest maps' (photographed in summer)
    # alike, and a hunt runs on past leaf drop, when a hardwood stand lets far
    # more of the wind through. The browser blends canopy toward this by the
    # season. Open ground keeps its fraction. The roughness above (z0, the
    # speed ratio) stays leaf-on: docs/MICRO-WIND.md, Limits.
    crown_bare, evergreen = leaves_down(cover, crown, conifer, hab["hardwood"], hab["lead"])
    canopy_bare = np.clip(np.where(h > 0, in_stand(h, crown_bare, evergreen), f_open), 0.04, 0.95)
    assert (canopy_bare >= canopy).all(), "leaves down must not shelter a stand more than leaves on"
    print(leaves_down_report(canopy, canopy_bare, crown, crown_bare, conifer, cover, h, header["coverNames"]))

    # ---- assemble ----
    def qb(a):
        return np.clip(np.round(a / BASIS_SCALE), -127, 127).astype(np.int8)

    bands: list[tuple[str, np.ndarray, float, str]] = [
        ("nUe", qb(neutral[0]), BASIS_SCALE, "neutral: east component for a unit wind toward the east"),
        ("nVe", qb(neutral[1]), BASIS_SCALE, "neutral: north component for a unit wind toward the east"),
        ("nUn", qb(neutral[2]), BASIS_SCALE, "neutral: east component for a unit wind toward the north"),
        ("nVn", qb(neutral[3]), BASIS_SCALE, "neutral: north component for a unit wind toward the north"),
        ("sUe", qb(stable[0]), BASIS_SCALE, "stable: east component for a unit wind toward the east"),
        ("sVe", qb(stable[1]), BASIS_SCALE, "stable: north component for a unit wind toward the east"),
        ("sUn", qb(stable[2]), BASIS_SCALE, "stable: east component for a unit wind toward the north"),
        ("sVn", qb(stable[3]), BASIS_SCALE, "stable: north component for a unit wind toward the north"),
        ("katDir", q_bearing(kat_brg, np.zeros_like(water)), 360 / 250, "cold-air drainage bearing it flows TOWARD (255 none)"),
        ("katSpd", np.clip(np.round(kat * 100), 0, 255).astype(np.uint8), 0.01, "potential drainage speed m/s under a strong inversion"),
        ("pool", np.clip(np.round(pool * 10), 0, 255).astype(np.uint8), 0.1, "cold-air pool depth m (closed depression fill)"),
        ("drainAcc", np.clip(np.round(np.log10(acc) * 50), 0, 255).astype(np.uint8), 0.02, "log10 upslope contributing cells"),
        ("thSlope", np.clip(np.round(th_slope * 10), 0, 255).astype(np.uint8), 0.1, "slope of the ~100 m terrain, degrees"),
        ("thAspect", q_bearing(down_brg, th_slope < 0.5), 360 / 250, "downslope bearing of the ~100 m terrain (255 flat)"),
        ("onshore", q_bearing(onshore, shore_d > 3000), 360 / 250, "bearing a lake breeze blows toward here (255 far from a big lake)"),
        ("shoreDist", np.clip(np.round(shore_d / 20), 0, 255).astype(np.uint8), 20, "m to the shore of a lake over 20 ha (×20)"),
        ("breezeMax", np.clip(np.round(breeze_max * 100), 0, 255).astype(np.uint8), 0.01, "strongest lake breeze the nearest big lake drives here, m/s"),
        ("rel", np.clip(np.round(rel * 2), -127, 127).astype(np.int8), 0.5, "height over the ~500 m around, m (negative = low ground)"),
        ("canopy", np.round(canopy * 250).astype(np.uint8), 1 / 250, "head-height (2 m) fraction of the local 10 m wind"),
        (
            "canopyBare",
            np.round(canopy_bare * 250).astype(np.uint8),
            1 / 250,
            f"head-height (2 m) fraction of the local 10 m wind with the leaves down: the hardwood and larch share of the closure thinned to bare crowns ({BARE:g} of it); the browser blends canopy toward it after leaf drop",
        ),
        ("treeH", np.clip(np.round(h), 0, 255).astype(np.uint8), 1, "stand height m (0 open)"),
    ]
    out_header = {
        "region": REGION["id"],
        "generated": date.today().isoformat(),
        "cols": COLS,
        "rows": ROWS,
        "west": hb.W,
        "north": hb.N,
        "dLon": hb.D_LON,
        "dLat": hb.D_LAT,
        "cellM": [round(DX, 1), round(DY, 1)],
        "coverNames": header["coverNames"],
        "landformNames": header["landformNames"],
        "lakes": [],
        "model": {"z0Ref": Z0_REF, "zBlend": Z_BLEND, "lidNeutral": LID_NEUTRAL, "lidStable": LID_STABLE, "bare": BARE, "larchLed": LARCH_LED},
        "bands": [],
    }
    payload = bytearray()
    for name, arr, scale, meaning in bands:
        arr = np.ascontiguousarray(arr)
        out_header["bands"].append({"name": name, "dtype": str(arr.dtype), "scale": scale, "offset": len(payload), "meaning": meaning})
        payload += arr.tobytes()
    hj = json.dumps(out_header, separators=(",", ":")).encode("utf-8")
    raw = struct.pack("<I", len(hj)) + hj + bytes(payload)
    out = OUT_DIR / f"micro-{REGION['id']}.hab"
    out.write_bytes(gzip.compress(raw, 9))
    print(f"wrote {out.name}: {len(raw) / 1e6:.1f} MB raw, {out.stat().st_size / 1e6:.2f} MB gzipped, {len(bands)} bands · {time.time() - t0:.0f}s")
    # the solve's raw fields, for looking into it; a scratch run keeps its own
    np.savez_compressed((OUT_DIR if SCRATCH else CACHE_DIR) / f"micro-debug-{REGION['id']}.npz", dem=dem.astype(np.float32), pool=pool, kat=kat.astype(np.float32), rel=rel.astype(np.float32), breeze=breeze_max.astype(np.float32), canopy=canopy.astype(np.float32), canopyBare=canopy_bare.astype(np.float32), s=s.astype(np.float32), **{f"n{i}": a.astype(np.float32) for i, a in enumerate(neutral)}, **{f"s{i}": a.astype(np.float32) for i, a in enumerate(stable)})


if __name__ == "__main__":
    main()
