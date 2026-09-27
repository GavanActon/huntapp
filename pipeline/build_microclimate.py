"""The microclimate grid: what the ground does to the wind, on the habitat
grid's 30 m lattice, so the phone can turn one HRDPS wind into the air a
hunter actually feels at head height in a bog, a spruce stand or a lake
shore. Everything here is static: the hour, the sun, the forecast and the
stability are applied in the browser (app/src/weather/micro/).

Inputs:
  raw/mrdem-<region>.npz              NRCan MRDEM 30 m DTM (via rasters.fetch)
  data/habitat-<region>.hab           cover, stand height, crown closure

Four parts, one per layer of docs/MICRO-WIND.md:

1. TERRAIN AND ROUGHNESS (mass-consistent downscaling, Sherman 1978; the
   idea behind WindNinja's conservation-of-mass solver). The air between
   the ground and a lid is a layer of depth H; the first guess u0 is the
   regional wind scaled by local roughness (log law through a 60 m blending
   height); the answer is the closest field to u0 that conserves mass in
   the layer: u = u0 + grad(l), div(H grad l) = -div(H u0). Hills thin the
   layer and the air speeds over or goes round; lakes and bogs are smooth,
   so flux crowds onto them. Two lids: NEUTRAL (250 m, air goes over) and
   STABLE (50 m over the valleys, air goes round and channels). The
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
   decay inside it: Cionco 1965), and tree height for edge shelter.

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
from common import OUT_DIR, REGION

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

def roughness(cover: np.ndarray, height: np.ndarray) -> np.ndarray:
    """Aerodynamic roughness length z0 (m) per cell."""
    z0 = np.full(cover.shape, 0.1, dtype=np.float32)
    tall = np.isin(cover, (TREED_WET, CON_DENSE, CON_OPEN, MIXED, HARD))
    h = np.where(height > 0, height, np.where(cover == TREED_WET, 6.0, 12.0))
    z0[tall] = np.clip(0.1 * h[tall], 0.3, 2.5)
    z0[cover == WATER] = 0.0002
    z0[cover == OPEN_WET] = 0.03
    z0[np.isin(cover, (SHRUB, REGEN))] = 0.2
    z0[np.isin(cover, (BARREN, ROAD))] = 0.05
    return z0


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


def divergence(H: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """div(H (u, v)) on cell centres; u east, v NORTH (rows run north→south)."""
    fx = np.pad(H * u, ((0, 0), (1, 1)), mode="edge")
    fy = np.pad(H * v, ((1, 1), (0, 0)), mode="edge")
    dfx = (fx[:, 2:] - fx[:, :-2]) / (2 * DX)
    dfy = (fy[:-2, :] - fy[2:, :]) / (2 * DY)  # north is row - 1
    return dfx + dfy


def gradient(l: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lp = np.pad(l, 1, mode="constant")  # l = 0 outside
    gx = (lp[1:-1, 2:] - lp[1:-1, :-2]) / (2 * DX)
    gy = (lp[:-2, 1:-1] - lp[2:, 1:-1]) / (2 * DY)  # d/d(north)
    return gx, gy


def solve_basis(dem: np.ndarray, s: np.ndarray, lid: float, big_sigma: float) -> list[np.ndarray]:
    """Two solves (a unit wind toward the east and one toward the north);
    returns [ue, ve, un, vn]: the local wind vector for each, in units of
    the regional 10 m wind."""
    large = ndimage.gaussian_filter(dem, big_sigma)
    H = np.clip(lid + (large - dem), 0.2 * lid, None)
    A = layer_operator(H)
    t = time.time()
    lu = splu(A, permc_spec="COLAMD")
    print(f"    operator factorised · {time.time() - t:.0f}s")
    out = []
    for ex, ey in ((1.0, 0.0), (0.0, 1.0)):
        u0 = s * ex
        v0 = s * ey
        rhs = -divergence(H, u0, v0).ravel()
        l = lu.solve(rhs).reshape(ROWS, COLS)
        gx, gy = gradient(l)
        u, v = u0 + gx, v0 + gy
        res = np.abs(divergence(H, u, v)[2:-2, 2:-2]).mean() / (np.abs(divergence(H, u0, v0)[2:-2, 2:-2]).mean() + 1e-12)
        print(f"    unit wind toward {'east' if ex else 'north'} · residual divergence {res:.3f} of the first guess · speed {np.hypot(u, v).min():.2f}–{np.hypot(u, v).max():.2f}")
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


def main() -> None:
    t0 = time.time()
    print(f"microclimate on the habitat lattice {COLS}×{ROWS} ({DX:.0f}×{DY:.0f} m)")
    header, hab = read_hab(OUT_DIR / f"habitat-{REGION['id']}.hab")
    assert header["cols"] == COLS and header["rows"] == ROWS, "habitat grid does not match build_habitat.py"
    cover = hab["cover"].astype(np.uint8)
    height = hab["height"]
    crown = hab["crown"]
    conifer = hab["conifer"]
    water = cover == WATER

    dem = hb.to_grid(hb.fetch("mrdem"), hb.Resampling.bilinear, np.float32).astype(np.float64)
    dem = np.where(dem < -1000, np.nan, dem)
    dem = np.where(np.isnan(dem), np.nanmedian(dem), dem)

    # ---- 1. terrain and roughness ----
    z0 = roughness(cover, height)
    s = speed_ratio(z0)
    print(f"  roughness speed ratio {s.min():.2f}–{s.max():.2f} (lakes fast, forest slow) · {time.time() - t0:.0f}s")
    print("  neutral layer (air goes over the hills)")
    neutral = solve_basis(dem, s, LID_NEUTRAL, big_sigma=100)  # ~3 km
    print("  stable layer (air goes round and down the valleys)")
    stable = solve_basis(dem, s, LID_STABLE, big_sigma=35)  # ~1 km
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
    sin_a = np.sin(np.radians(np.maximum(th_slope, 0.3)))
    fetch_f = 0.6 + 0.4 * np.clip(np.log10(acc) / 3, 0, 1)
    kat = 2.2 * np.sqrt(sin_a) * fetch_f
    in_pool = pool > 0.3
    kat = np.where(in_pool, 0.12, kat)  # pooled air creeps to the outlet
    kat_brg = np.where(in_pool | (th_slope < 0.5), route_brg, down_brg)
    kat[water] = 0.1
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

    # ---- 4. canopy ----
    tall = np.isin(cover, (TREED_WET, CON_DENSE, CON_OPEN, MIXED, HARD))
    h = np.where(tall, np.where(height > 0, height, np.where(cover == TREED_WET, 6.0, 12.0)), 0.0)
    h = np.where(h < 3, 0, h)
    # open ground: log profile 2 m over 10 m
    z0l = np.maximum(z0, 0.01)
    f_open = np.log(2 / z0l) / np.log(10 / z0l)
    # in a stand: log profile down to the top (d = 0.67 h), then the
    # canopy's exponential decay; the attenuation coefficient grows with
    # closure and with conifer (Cionco 1965: 1–4 across canopies)
    zc0 = np.maximum(0.1 * h, 0.3)
    d = 0.67 * h
    f_top = np.log(np.maximum(h - d, 0.5) / zc0) / np.log(10 / zc0)
    a = 1.0 + 2.2 * np.clip(crown / 100, 0.2, 1) + 0.6 * np.clip(conifer / 100, 0, 1)
    f_in = f_top * np.exp(-a * (1 - 2 / np.maximum(h, 2.1)))
    canopy = np.where(h > 0, f_in, f_open)
    canopy = np.clip(canopy, 0.04, 0.95)
    print(f"  canopy: head-height fraction {canopy[h > 0].mean():.2f} in stands, {canopy[(h == 0) & ~water].mean():.2f} in the open · {time.time() - t0:.0f}s")

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
        ("canopy", np.round(canopy * 250).astype(np.uint8), 1 / 250, "head-height (2 m) fraction of the local 10 m wind"),
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
        "model": {"z0Ref": Z0_REF, "zBlend": Z_BLEND, "lidNeutral": LID_NEUTRAL, "lidStable": LID_STABLE},
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
    np.savez_compressed(hb.CACHE_DIR / f"micro-debug-{REGION['id']}.npz", dem=dem.astype(np.float32), pool=pool, kat=kat.astype(np.float32), canopy=canopy.astype(np.float32), s=s.astype(np.float32), **{f"n{i}": a.astype(np.float32) for i, a in enumerate(neutral)}, **{f"s{i}": a.astype(np.float32) for i, a in enumerate(stable)})


if __name__ == "__main__":
    main()
