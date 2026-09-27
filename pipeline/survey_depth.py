"""Lake depth from the MNR survey sheets, by counting contours.

The camp lakes were surveyed in 1978-79 and only the paper sheets survive
(georef_lake_sheet.py fits each scan to the real shoreline and writes the
ink as an RGBA GeoTIFF). The sheets are drawn at a 2 m contour interval,
so a point's depth follows from how many contour lines lie between it and
the shore, with no need to read the hand-written numbers:

  1. the ink inside the lake is split into the thick shoreline and the
     thin contours; small gaps in the contours are closed and the numbers
     (small blobs) are kept as ink, so they bridge the gaps they sit in;
  2. the water between the lines falls into regions; a region touching
     the shore is level 0, and each line crossed inward adds one level
     (a breadth-first walk over the region adjacency graph);
  3. every contour pixel takes the depth of the line it is (2 m x the
     deeper side's level), the shore is 0, and the water between is filled
     by harmonic (Laplace) interpolation, so the surface passes through
     every surveyed line and bends smoothly between them;
  4. the innermost regions (the holes) rise past their last contour toward
     the sheet's maximum depth, by distance from their edge.

Output per lake: a float32 GeoTIFF of depth in metres at 5 m, NaN on land,
beside the sheet (raw/bathy/<id>_depth.tif), which build_habitat.py reads
in place of its shore-distance estimate and build_depth_bands.py contours.

    python pipeline/survey_depth.py --all          # the camp's three sheets
    python pipeline/survey_depth.py raw/bathy/16-6042-54219_geo.tif "Pickle Lake" --max 15.4 --debug

Order: build_habitat.py (lake outlines) -> georef_lake_sheet.py -> this ->
build_habitat.py again (it picks the depth rasters up) -> build_depth_bands.py.

Checked against what the province records independently (the mean was
never an input): Pickle comes out at a 3.4-3.6 m mean against ARA's 3.6 m,
Ketchup 2.2 m against 2.5 m, and each maximum is the sheet's own sounding.
Known limits: a hump ringed by one contour reads as a hole (the count
cannot tell up from down; the sheets mark few humps), and lines too faint
to detect are bridged by the interpolation, so read shallow near them.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import struct
from collections import deque
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_bounds
from scipy import ndimage
from scipy.signal import fftconvolve
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve

from common import OUT_DIR, REGION

INTERVAL_M = 2.0

# The camp's sheets: id, lake, the maximum depth printed or sounded on the
# sheet (m), and the contour depths when not every 2 m. Ketchup draws a 1 m
# line first, but on the scan it runs into the shoreline stroke and is
# mostly lost, so counting in plain 2 m steps matches the lake better
# (mean 2.2 m against the province's 2.5 m; with the 1 m line, 1.5 m).
#
# Pins: (x, y, depth m) with x, y as fractions of the georeferenced sheet
# (<id>_geo.tif), each a hand-written label read off the scan, fixing the
# stroke it sits on. Only where the count goes wrong: shoals, mostly.
SHEETS = [
    (
        "16-6042-54219",
        "Pickle Lake",
        15.4,
        None,
        [
            # the south-west bay: 2 m line, a 4 m ring, and a shoal ringed at 2 m
            (0.2160, 0.7255, 2.0),
            (0.2672, 0.6948, 4.0),
            (0.2756, 0.7025, 4.0),
            # east of it: "6 4 2", a small 6 m hole and the lines to shore
            (0.2871, 0.7144, 6.0),
            (0.2922, 0.7155, 4.0),
            (0.2992, 0.7214, 2.0),
        ],
    ),
    (
        "16-6097-54195",
        "McGill Lake",
        15.1,
        None,
        [
            # the labelled lines, north to south
            (0.4500, 0.3276, 2.0),
            (0.4673, 0.3467, 4.0),
            (0.5782, 0.3232, 8.0),
            (0.4736, 0.3968, 10.0),  # a 10 m hole inside the 8 m line
            (0.4468, 0.4087, 8.0),
            (0.5855, 0.4033, 6.0),
            (0.5445, 0.4383, 4.0),
            (0.3877, 0.4683, 6.0),
            (0.5264, 0.5115, 2.0),
            (0.3977, 0.5206, 10.0),
            (0.4059, 0.5271, 6.0),
            (0.3055, 0.5386, 4.0),
            (0.3605, 0.5736, 8.0),
            # shoals ringed at 2 m: the small one west of centre (its larger
            # neighbour is drawn too lightly to detect, so the fill bridges
            # it at 2-4 m), and the ring round the rocks east
            (0.4023, 0.4123, 2.0),
            (0.5105, 0.4953, 2.0),
        ],
    ),
    ("16-6034-54164", "Ketchup Lake", 12.9, None, []),
]
BATHY_DIR = Path(__file__).parent / "raw" / "bathy"
OUT_RES_M = 5.0


def habitat_lake(name: str):
    raw = gzip.open(OUT_DIR / f"habitat-{REGION['id']}.hab", "rb").read()
    n = struct.unpack("<I", raw[:4])[0]
    h = json.loads(raw[4 : 4 + n])
    lake = next((l for l in h["lakes"] if (l.get("name") or "").lower() == name.lower()), None)
    if not lake:
        raise SystemExit(f"{name}: not in the habitat lakes")
    b = next(b for b in h["bands"] if b["name"] == "lakeId")
    band = np.frombuffer(raw, dtype=np.dtype(b["dtype"]), count=h["cols"] * h["rows"], offset=4 + n + b["offset"]).reshape(h["rows"], h["cols"])
    return band == lake["id"], h, lake


def lake_on_grid(lake30: np.ndarray, h: dict, bounds, W: int, H: int) -> np.ndarray:
    """The habitat lake mask resampled onto a W x H grid over bounds."""
    xs = bounds.left + (np.arange(W) + 0.5) * (bounds.right - bounds.left) / W
    ys = bounds.top - (np.arange(H) + 0.5) * (bounds.top - bounds.bottom) / H
    cols = np.floor((xs - h["west"]) / h["dLon"]).astype(int)
    rows = np.floor((h["north"] - ys) / h["dLat"]).astype(int)
    ok_c = (cols >= 0) & (cols < h["cols"])
    ok_r = (rows >= 0) & (rows < h["rows"])
    out = np.zeros((H, W), bool)
    sub = lake30[np.clip(rows, 0, h["rows"] - 1)][:, np.clip(cols, 0, h["cols"] - 1)]
    out[:] = sub & ok_r[:, None] & ok_c[None, :]
    return out


def disk(r: int) -> np.ndarray:
    y, x = np.ogrid[-r : r + 1, -r : r + 1]
    return x * x + y * y <= r * r


def line_response(alpha: np.ndarray, L: int = 17, angles: int = 16) -> np.ndarray:
    """Best mean ink along an L-pixel segment through each pixel, over
    `angles` directions, minus the local mean."""
    r = L // 2
    best = np.zeros_like(alpha)
    for th in np.linspace(0, np.pi, angles, endpoint=False):
        k = np.zeros((L, L), np.float32)
        for t in np.linspace(-r, r, 4 * L):
            k[int(round(r + t * np.sin(th))), int(round(r + t * np.cos(th)))] = 1
        np.maximum(best, fftconvolve(alpha, k / k.sum(), mode="same"), out=best)
    return best - ndimage.uniform_filter(alpha, size=L)


def straight_features(ink: np.ndarray, min_len_px: int = 250, width_px: int = 4) -> np.ndarray:
    """The sheet's straight rules (a township boundary, a sounding
    transect): a Hough peak far above what any curved contour gives.
    Returns a mask of ink to drop."""
    ys, xs = np.nonzero(ink)
    out = np.zeros_like(ink)
    if len(ys) == 0:
        return out
    H, W = ink.shape
    diag = int(math.hypot(H, W)) + 1
    for th in np.radians(np.arange(0, 180, 0.5)):
        c, s_ = math.cos(th), math.sin(th)
        rho = np.round(xs * c + ys * s_).astype(np.int64) + diag
        hist = np.bincount(rho // 2, minlength=diag + 1)
        # a spike, not a plateau: contours running along a long lake raise
        # whole neighbourhoods of bins; a ruled line raises one or two
        local = ndimage.median_filter(hist.astype(np.float32), size=31)
        for pk in np.nonzero((hist >= min_len_px) & (hist >= 3 * np.maximum(local, 10)))[0]:
            on = np.abs(rho - (pk * 2 + 1)) <= width_px
            # a rule, not a crowd: its pixels must spread along the line
            along = xs[on] * -s_ + ys[on] * c
            if along.max() - along.min() < min_len_px * 1.2:
                continue
            out[ys[on], xs[on]] = True
    return out


def ink_masks(alpha: np.ndarray, lake: np.ndarray, px_m: float):
    """The drawn shoreline, the search area, and the contour lines."""
    # the thin contours are faint in the scan: below ~25 they break up
    ink = alpha > 20
    # the shoreline: the thick ink. An opening keeps only strokes wider
    # than the contours; the big runs are the shore
    # The pen widths are fixed on paper, so the test is in metres: at
    # 1 m/px a contour is as many pixels wide as the shoreline is at 1.4
    r_open = max(2, int(round(3.4 / px_m)))
    thick = ndimage.binary_opening(ink, structure=disk(r_open))
    lab, n = ndimage.label(thick, structure=np.ones((3, 3)))
    if n:
        sizes = ndimage.sum(thick, lab, range(1, n + 1))
        thick = np.isin(lab, np.nonzero(sizes >= max(200, 0.02 * sizes.max()))[0] + 1)
    thick = ndimage.binary_dilation(thick, structure=disk(r_open))
    # the search area: the real outline grown a little (the 30 m outline is
    # blocky and cuts across the sheet's own shore), minus the drawn shore
    grow = max(1, int(round(45 / px_m)))
    near = ndimage.binary_dilation(lake, structure=disk(grow))
    # the contours: a line detector, not a threshold. Some basins are drawn
    # so faintly that any threshold low enough to keep their lines keeps
    # the paper's dust too; averaged along a short segment at the right
    # angle a pen line stands out and scattered dust does not
    thin = (line_response(alpha.astype(np.float32)) > 8) & (alpha > 6) & near & ~thick
    thin &= ~straight_features(thin)
    # paper speckle: the scan's dirty patches are dust of a few pixels
    # and a contour is a long run: keep ink whose extent spans at least
    # ~35 m. (Not a compactness test: where nested lines touch on a steep
    # bank they make one big connected network, which is not dust)
    tl, tn = ndimage.label(thin, structure=np.ones((3, 3)))
    if tn:
        tsz = np.bincount(tl.ravel(), minlength=tn + 1)
        span = np.zeros(tn + 1)
        for i, sl in enumerate(ndimage.find_objects(tl), start=1):
            if sl is not None:
                span[i] = math.hypot(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start)
        keep = (tsz >= max(40, int(60 / px_m))) & (span >= 35 / px_m)
        keep[0] = False
        thin = keep[tl]
    # no gap closing: the count below is local, so a break in a line costs
    # nothing, while closing would weld the tightly packed lines of a steep
    # bank into one and undercount the deep holes. A 3x3 dilation keeps a
    # one-pixel diagonal stroke from being stepped over by a transect
    lines = ndimage.binary_dilation(thin, structure=np.ones((3, 3)))
    return thick, near, lines & near & ~thick, thin


def fragment_levels(lines: np.ndarray, shore: np.ndarray, px_m: float, samples: int = 80, seed: int = 0):
    """Label each contour fragment with its level (1 = the 2 m line).

    Hand-drawn contours rarely close, so the water between them does not
    fall into clean zones. Locally the count is reliable though: from a
    point on a line, walk straight to the nearest shore and count the
    other lines crossed. The median over many points along the line is
    its level minus one; a break somewhere else in the lake cannot move it.
    Small fragments (the hand-written numbers, stray marks) are neither
    counted nor labelled."""
    frag, nf = ndimage.label(lines, structure=np.ones((3, 3)))
    sizes = np.bincount(frag.ravel(), minlength=nf + 1)
    big = sizes >= int(40 / px_m) * 3  # ~40 m of pen stroke
    big[0] = False
    frag_big = np.where(big[frag], frag, 0)
    _, (iy, ix) = ndimage.distance_transform_edt(~shore, return_indices=True)
    rng = np.random.default_rng(seed)
    level = np.zeros(nf + 1, np.int32)
    objs = ndimage.find_objects(frag_big)
    for fid in np.nonzero(big)[0]:
        sl = objs[fid - 1]
        if sl is None:
            continue
        yy, xx = np.nonzero(frag_big[sl] == fid)
        yy = yy + sl[0].start
        xx = xx + sl[1].start
        pick = rng.choice(len(yy), size=min(samples, len(yy)), replace=False)
        counts = []
        for k in pick:
            y0, x0 = yy[k], xx[k]
            y1, x1 = iy[y0, x0], ix[y0, x0]
            n = int(max(abs(y1 - y0), abs(x1 - x0))) + 1
            ty = np.round(np.linspace(y0, y1, n)).astype(int)
            tx = np.round(np.linspace(x0, x1, n)).astype(int)
            seen = set(frag_big[ty, tx].tolist())
            seen.discard(0)
            seen.discard(int(fid))
            counts.append(len(seen))
        level[fid] = int(np.median(counts)) + 1
    return frag_big, level


def point_levels(thin: np.ndarray, shore: np.ndarray, px_m: float = 1.0, every: int = 3, max_len_px: int = 900, min_gap_m: float = 1.6):
    """Level at sampled points on the pen strokes, by counting strokes.

    Connected fragments are not enough: on a steep bank the 4, 6 and 8 m
    lines touch and fuse into one blob. So each sample walks straight to
    its nearest shore in half-pixel steps and counts the separate strokes
    it enters (off-ink to on-ink), which does not care what touches what.
    Returns (ys, xs, level) for the samples."""
    ys, xs = np.nonzero(thin)
    keep = ((ys + xs) % every) == 0
    ys, xs = ys[keep], xs[keep]
    _, (iy, ix) = ndimage.distance_transform_edt(~shore, return_indices=True)
    ty, tx = iy[ys, xs], ix[ys, xs]
    L = np.hypot(ty - ys, tx - xs)
    ok = L <= max_len_px
    ys, xs, ty, tx, L = ys[ok], xs[ok], ty[ok], tx[ok], L[ok]
    H, W = thin.shape
    lev = np.ones(len(ys), np.int32)
    B = 4000
    for s0 in range(0, len(ys), B):
        sl = slice(s0, s0 + B)
        n = int(np.ceil(L[sl].max() * 2)) + 2
        t = np.linspace(0, 1, n)[None, :]
        py = np.clip(np.round(ys[sl, None] + (ty[sl, None] - ys[sl, None]) * t).astype(int), 0, H - 1)
        px = np.clip(np.round(xs[sl, None] + (tx[sl, None] - xs[sl, None]) * t).astype(int), 0, W - 1)
        on = thin[py, px]
        # one pen stroke can be detected as two ragged edges: an off-ink
        # gap shorter than min_gap_m does not start a new line. (Contours
        # on the steepest banks here are still ~4 m apart)
        g = max(1, int(round(min_gap_m / px_m * 2)))  # samples are 0.5 px apart
        c = np.cumsum(on, axis=1, dtype=np.int32)
        c = np.pad(c, ((0, 0), (1, 0)))
        before = c[:, 1:] - c[:, np.maximum(np.arange(n) - g + 1, 0)] > 0
        after = c[:, np.minimum(np.arange(n) + g, n)] - c[:, np.arange(n)] > 0
        on = on | (before & after)
        # leave the stroke we start on before counting
        started = np.cumsum(~on, axis=1) > 0
        rising = on[:, 1:] & ~on[:, :-1] & started[:, 1:]
        lev[sl] = rising.sum(axis=1) + 1
    return ys, xs, lev


def harmonic(fixed: np.ndarray, values: np.ndarray, domain: np.ndarray) -> np.ndarray:
    """Solve Laplace on `domain` with Dirichlet values where `fixed`."""
    H, W = domain.shape
    unknown = domain & ~fixed
    idx = -np.ones((H, W), np.int64)
    n = int(unknown.sum())
    idx[unknown] = np.arange(n)
    ys, xs = np.nonzero(unknown)
    rows, cols, data = [np.arange(n)], [np.arange(n)], [np.zeros(n)]
    b = np.zeros(n)
    deg = np.zeros(n)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = ys + dy, xs + dx
        ok = (ny >= 0) & (ny < H) & (nx >= 0) & (nx < W)
        ny, nx = np.where(ok, ny, 0), np.where(ok, nx, 0)
        inside = ok & domain[ny, nx]
        deg += inside
        nb_unknown = inside & unknown[ny, nx]
        nb_fixed = inside & fixed[ny, nx]
        rows.append(np.nonzero(nb_unknown)[0])
        cols.append(idx[ny[nb_unknown], nx[nb_unknown]])
        data.append(-np.ones(int(nb_unknown.sum())))
        b[nb_fixed] += values[ny[nb_fixed], nx[nb_fixed]]
    data[0] = np.maximum(deg, 1)
    A = coo_matrix((np.concatenate(data), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n)).tocsr()
    sol = spsolve(A, b)
    out = values.astype(np.float64).copy()
    out[unknown] = sol
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tif", nargs="?")
    ap.add_argument("name", nargs="?")
    ap.add_argument("--all", action="store_true", help="every sheet in SHEETS")
    ap.add_argument("--max", type=float, default=None, help="the sheet's maximum depth, m")
    ap.add_argument("--levels", default=None, help="the sheet's contour depths from the shore in, m, e.g. 1,2,4,6 (default: every 2 m)")
    ap.add_argument("--debug", action="store_true")
    a = ap.parse_args()
    if a.all:
        for sid, name, dmax, levels, pins in SHEETS:
            run(BATHY_DIR / f"{sid}_geo.tif", name, dmax, levels, a.debug, pins)
        return
    if not (a.tif and a.name):
        ap.error("a sheet and a lake name, or --all")
    pins = next((p for sid, n, _, _, p in SHEETS if n.lower() == (a.name or "").lower()), [])
    run(Path(a.tif), a.name, a.max, a.levels, a.debug, pins)


def run(tif: Path, name: str, max_m: float | None, levels: str | None, debug: bool, pins=None):
    a = argparse.Namespace(name=name, max=max_m, levels=levels, debug=debug, pins=pins or [])
    lake30, h, lk = habitat_lake(a.name)
    dmax = a.max or lk.get("maxDepth")
    with rasterio.open(tif) as ds:
        alpha = ds.read(4)
        bounds = ds.bounds
        W, H = ds.width, ds.height
    lat0 = (bounds.top + bounds.bottom) / 2
    mx = 111320 * math.cos(math.radians(lat0))
    px_m = (bounds.right - bounds.left) / W * mx
    lake = lake_on_grid(lake30, h, bounds, W, H)
    thick, near, lines, thin = ink_masks(alpha, lake, px_m)
    shore = thick | ~near
    sy, sx, slev = point_levels(thin, shore, px_m)

    # work at ~OUT_RES_M: block-reduce. A cell on a line takes that line's
    # depth (the deepest line in the cell); a cell on the drawn shore is 0
    f = max(1, int(round(OUT_RES_M / px_m)))
    Hs, Ws = H // f, W // f
    crop = lambda arr: arr[: Hs * f, : Ws * f].reshape(Hs, f, Ws, f)  # noqa: E731
    near_s = crop(near).mean(axis=(1, 3)) > 0.5
    shore_s = crop(thick).any(axis=(1, 3)) | (near_s & ~ndimage.binary_erosion(near_s))
    # the k-th line from shore is at levels[k-1] m: every 2 m unless the
    # sheet says otherwise
    seq = [float(v) for v in a.levels.split(",")] if a.levels else []

    def line_depth(k: int) -> float:
        if k <= 0:
            return 0.0
        if k <= len(seq):
            return seq[k - 1]
        last = seq[-1] if seq else 0.0
        return last + (k - len(seq)) * INTERVAL_M

    lut = np.array([line_depth(k) for k in range(int(slev.max()) + 2)])
    sm = lut[slev].astype(np.float32)
    # pins: a hand-written label read off the sheet fixes the whole stroke
    # it sits on. Counting cannot tell a shoal's ring from a hole's (both
    # are one more line in from the shore); the label can
    if a.pins:
        comp, _ = ndimage.label(thin, structure=np.ones((3, 3)))
        _, (iy, ix) = ndimage.distance_transform_edt(~thin, return_indices=True)
        scomp = comp[sy, sx]
        for fx, fy, depth_m in a.pins:
            px_, py_ = int(fx * W), int(fy * H)
            ny, nx = iy[py_, px_], ix[py_, px_]
            if math.hypot(ny - py_, nx - px_) * px_m > 25:
                print(f"  pin {depth_m} m at ({fx:.3f}, {fy:.3f}): no stroke within 25 m, ignored")
                continue
            cid_ = comp[ny, nx]
            on_comp = scomp == cid_
            if on_comp.sum() <= 3000:
                # a ring or a line on its own: the whole stroke
                sel = on_comp
            else:
                # the lines of a steep bank touch into one network: re-label
                # only this line, the samples nearby that counted the same
                # number of lines to shore as the pin's own spot
                dd = np.hypot(sy - py_, sx - px_) * px_m
                k0 = slev[np.argmin(np.where(on_comp, dd, np.inf))]
                sel = on_comp & (dd <= 400) & (slev == k0)
            sm[sel] = depth_m
            print(f"  pin {depth_m:g} m: {int(sel.sum())} samples")

    # each cell on a stroke takes the median depth of its samples: a
    # transect that crossed a hand-written number is outvoted
    cy, cx = sy // f, sx // f
    okc = (cy < Hs) & (cx < Ws)
    cid = (cy * Ws + cx)[okc]
    order = np.argsort(cid, kind="stable")
    cid_s, m_s = cid[order], sm[okc][order]
    uniq, start = np.unique(cid_s, return_index=True)
    line_m = np.zeros(Hs * Ws, np.float32)
    for u, b0, b1 in zip(uniq, start, list(start[1:]) + [len(cid_s)]):
        line_m[u] = float(np.median(m_s[b0:b1]))
    line_m = line_m.reshape(Hs, Ws)
    # and agrees with its neighbours along the line (a 3x3 median of the
    # stroke cells), so one bad cell cannot dent a contour
    med = ndimage.generic_filter(line_m, lambda w: np.median(w[w > 0]) if (w > 0).any() else 0, size=3)
    line_m = np.where(line_m > 0, med, 0).astype(np.float32)
    line_lev = (line_m > 0).astype(np.int32)  # "on a line"
    # no line is deeper than the sheet's own maximum
    if dmax:
        line_m = np.minimum(line_m, dmax)
    top_m = float(line_m.max())
    print(f"{a.name}: {px_m:.2f} m/px · {len(slev)} samples · deepest line {top_m:.0f} m · sheet max {dmax} m")
    fixed = shore_s.copy()
    vals = np.zeros((Hs, Ws))
    on_line = (line_lev > 0) & ~shore_s & near_s
    fixed |= on_line
    vals[on_line] = line_m[on_line]
    depth = harmonic(fixed & near_s, vals, near_s)

    # the holes and the shoals: water ringed by one line value would sit
    # flat at it. Where the water beyond the ring is shallower it is a hole,
    # and rises past the ring by most of an interval (to the sheet maximum
    # in the deepest one); where the water beyond is deeper it is a shoal,
    # and its top comes up by up to a metre. By distance from the ring
    free = near_s & ~fixed
    lab_s, nl = ndimage.label(free)
    ring_all = ndimage.binary_dilation(free, structure=np.ones((3, 3))) & fixed
    for i in range(1, nl + 1):
        m = lab_s == i
        if m.sum() < 6:
            continue
        ring = ndimage.binary_dilation(m, structure=np.ones((3, 3))) & ring_all
        rv = vals[ring]
        if not len(rv) or rv.min() <= 0 or rv.min() != rv.max():
            continue
        base = float(rv.min())
        beyond = ndimage.binary_dilation(m | ring, iterations=4) & ~(m | ring) & near_s
        outside = float(np.median(depth[beyond])) if beyond.any() else 0.0
        d = ndimage.distance_transform_edt(m)
        if outside > base + 0.25:
            depth[m] = base - min(1.0, base * 0.5) * (d[m] / d.max()) ** 0.6
            continue
        rise = max(0.5, (dmax or base + 1) - base) if base >= top_m else min(INTERVAL_M * 0.9, max(0.0, (dmax or base + INTERVAL_M) - base))
        depth[m] = base + rise * (d[m] / d.max()) ** 0.6

    lake_s = crop(lake).mean(axis=(1, 3)) > 0.5
    depth[~near_s] = np.nan
    depth = np.clip(depth, 0, dmax or None)
    out = tif.with_name(tif.stem.replace("_geo", "") + "_depth.tif")
    tr = from_bounds(bounds.left, bounds.top - Hs * f * (bounds.top - bounds.bottom) / H, bounds.left + Ws * f * (bounds.right - bounds.left) / W, bounds.top, Ws, Hs)
    with rasterio.open(out, "w", driver="GTiff", width=Ws, height=Hs, count=1, dtype="float32", crs="EPSG:4326", transform=tr, nodata=np.nan, compress="deflate") as ds:
        ds.write(depth.astype(np.float32), 1)
        ds.update_tags(lake=a.name, source=tif.name, levels=a.levels or f"every {INTERVAL_M} m", max_m=str(dmax))
    wet = depth[lake_s]
    print(f"  wrote {out.name} · {Ws}x{Hs} at {f * px_m:.1f} m · mean {np.nanmean(wet):.1f} m · max {np.nanmax(wet):.1f} m")
    if a.debug:
        from PIL import Image

        # banded at the sheet's interval, so it reads against the scan
        v = np.nan_to_num(np.floor(depth / INTERVAL_M) * INTERVAL_M / (dmax or np.nanmax(wet)), nan=-1)
        img = np.full((Hs, Ws, 3), 255, np.uint8)
        wetm = v >= 0
        img[wetm] = (np.stack([230 - 210 * v[wetm], 240 - 190 * v[wetm], 250 - 120 * v[wetm]], -1)).clip(0, 255).astype(np.uint8)
        img[on_line] = (0, 0, 0)
        Image.fromarray(img).save(out.with_suffix(".png"))


if __name__ == "__main__":
    main()
