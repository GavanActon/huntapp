"""Georeference an MNR historic lake survey sheet by fitting its shoreline
to the lake's real outline, and write it as a transparent-ink GeoTIFF.

The sheets (https://www.publicdocs.mnr.gov.on.ca/mirb/Bathymetry/<WBY_LID>.jpg,
listed by the Historic Bathymetry Index feature service) are true-shape
drawings of one lake with no coordinates. The lake's outline is known from
the habitat bake (lakeId band, 30 m). So:

  1. the scan's shoreline is its thick ink: an opening drops the thin
     contours, streams and frame; small blobs (text) are dropped by size;
  2. a similarity transform (scale, rotation, shift; no mirror) is fitted
     by chamfer matching: the mean distance from the scan's shoreline
     points to the real lake edge, minimised by a coarse rotation sweep
     and a local refinement. Gaps in the drawn shoreline do not matter;
  3. the scan is written as RGBA in EPSG:4326 at half resolution: paper
     transparent, ink pale blue with opacity by darkness, masked to the
     real lake (dilated a little), so the 1978 contours and depth numbers
     draw over the map and nothing else.

    python pipeline/georef_lake_sheet.py raw/bathy/16-6042-54219.jpg "Pickle Lake"
    python pipeline/georef_lake_sheet.py raw/bathy/16-6097-54195.jpg "McGill Lake" --north-up
"""

from __future__ import annotations

import gzip
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from scipy import ndimage

import habfile
from common import OUT_DIR, REGION

Image.MAX_IMAGE_PIXELS = None
FIT_PX = 1400  # long side of the scan used for fitting
OUT_SCALE = 0.5  # output resolution relative to the scan


def habitat_lake(name: str):
    h, raw = habfile.read_hab_raw(OUT_DIR / f"habitat-{REGION['id']}.hab", ("lakeId",))
    lake = next((l for l in h["lakes"] if (l.get("name") or "").lower() == name.lower()), None)
    if not lake:
        raise SystemExit(f"{name}: not in the habitat lakes")
    return raw["lakeId"] == lake["id"], h, lake


def shoreline_points(gray: np.ndarray) -> np.ndarray:
    """(x, y) of the scan's thick ink in long connected runs, y up."""
    ink = gray < 150
    thick = ndimage.binary_opening(ink, structure=np.ones((2, 2)))
    lab, nlab = ndimage.label(thick, structure=np.ones((3, 3)))
    sizes = ndimage.sum(thick, lab, range(1, nlab + 1))
    # the shoreline is the big run; streams and text are the small ones.
    # --all-ink keeps every run of 25 px or more (a broken shoreline)
    floor = 25 if '--all-ink' in sys.argv else max(25, 0.08 * sizes.max())
    keep = np.isin(lab, np.nonzero(sizes >= floor)[0] + 1)
    ys, xs = np.nonzero(keep)
    return np.vstack([xs.astype(float), -ys.astype(float)])


def main(path: str, name: str):
    lake_mask, h, lake = habitat_lake(name)
    lat0 = h["north"] - h["rows"] * h["dLat"] / 2
    mx = 111320 * math.cos(math.radians(lat0))
    my = 110540
    cellx, celly = h["dLon"] * mx, h["dLat"] * my

    # the real lake's edge, and the distance (m) from every cell to it
    edge = lake_mask & ~ndimage.binary_erosion(lake_mask)
    dist_cells = ndimage.distance_transform_edt(~edge, sampling=(celly, cellx))
    ey, ex = np.nonzero(edge)
    EX, EY = ex * cellx, -ey * celly  # metres, y up, origin NW corner
    ecx, ecy = EX.mean(), EY.mean()

    img = Image.open(path).convert("L")
    W, H = img.size
    f = FIT_PX / max(W, H)
    small = np.asarray(img.resize((int(W * f), int(H * f)), Image.LANCZOS))
    P = shoreline_points(small)
    pcx, pcy = P[0].mean(), P[1].mean()
    Pc = P - np.array([[pcx], [pcy]])

    # scale from the spread of the two outlines
    s0 = math.sqrt(((EX - ecx) ** 2 + (EY - ecy) ** 2).mean()) / math.sqrt((Pc**2).sum(axis=0).mean())

    def cost(theta: float, s: float, dx: float, dy: float) -> float:
        c, si = math.cos(theta), math.sin(theta)
        X = s * (c * Pc[0] - si * Pc[1]) + ecx + dx
        Y = s * (si * Pc[0] + c * Pc[1]) + ecy + dy
        col = np.clip(np.round(X / cellx).astype(int), 0, h["cols"] - 1)
        row = np.clip(np.round(-Y / celly).astype(int), 0, h["rows"] - 1)
        d = dist_cells[row, col]
        # robust: points far off (a stream, a stray blob) count capped
        return float(np.minimum(d, 300).mean())

    north_up = '--north-up' in sys.argv
    if north_up:
        # the sheet has a north arrow pointing up: scale from the north-south
        # extent (robust to inner contours), rotation within a few degrees
        ext = lambda v: np.percentile(v, 98) - np.percentile(v, 2)  # noqa: E731
        s0 = ext(EY) / ext(P[1])
    best = (1e18, 0.0, s0, 0.0, 0.0)
    for deg in (range(-10, 11, 1) if north_up else range(0, 360, 3)):
        for sm in ((0.95, 1.0, 1.05) if north_up else (0.9, 1.0, 1.1)):
            t = math.radians(deg)
            v = cost(t, s0 * sm, 0, 0)
            if v < best[0]:
                best = (v, t, s0 * sm, 0.0, 0.0)
    for step_deg, step_s, step_m in [(1.5, 0.03, 60), (0.5, 0.01, 20), (0.15, 0.003, 6), (0.05, 0.001, 2)]:
        improved = True
        while improved:
            improved = False
            v0, t0, s1, dx0, dy0 = best
            cands = [
                (t0 + math.radians(step_deg), s1, dx0, dy0),
                (t0 - math.radians(step_deg), s1, dx0, dy0),
                (t0, s1 * (1 + step_s), dx0, dy0),
                (t0, s1 * (1 - step_s), dx0, dy0),
                (t0, s1, dx0 + step_m, dy0),
                (t0, s1, dx0 - step_m, dy0),
                (t0, s1, dx0, dy0 + step_m),
                (t0, s1, dx0, dy0 - step_m),
            ]
            for cand in cands:
                v = cost(*cand)
                if v < best[0] - 1e-3:
                    best = (v, *cand)
                    improved = True
    v, theta, s, dx, dy = best
    print(f"{name}: mean shoreline miss {v:.0f} m · rotation {math.degrees(theta):.1f}° · {s * f:.3f} m per scan px")

    c, si = math.cos(theta), math.sin(theta)

    def to_m(col: float, row: float):
        px, py = col * f - pcx, -(row * f) - pcy
        return s * (c * px - si * py) + ecx + dx, s * (si * px + c * py) + ecy + dy

    west, north = h["west"], h["north"]
    lon = lambda X: west + X / mx  # noqa: E731
    lat = lambda Y: north + Y / my  # noqa: E731
    # output at OUT_SCALE: output pixel (i, j) = scan pixel (i/OUT_SCALE, j/OUT_SCALE)
    k = 1 / OUT_SCALE
    X0, Y0 = to_m(0, 0)
    X1, Y1 = to_m(k, 0)
    X2, Y2 = to_m(0, k)
    transform = rasterio.Affine(lon(X1) - lon(X0), lon(X2) - lon(X0), lon(X0), lat(Y1) - lat(Y0), lat(Y2) - lat(Y0), lat(Y0))

    Wo, Ho = int(W * OUT_SCALE), int(H * OUT_SCALE)
    full = np.asarray(img.resize((Wo, Ho), Image.LANCZOS)).astype(np.float32)
    # which output pixels land on the (slightly dilated) real lake
    lake_d = ndimage.binary_dilation(lake_mask, iterations=2)
    jj, ii = np.mgrid[0:Ho, 0:Wo]
    lon_px = transform.c + transform.a * (ii + 0.5) + transform.b * (jj + 0.5)
    lat_px = transform.f + transform.d * (ii + 0.5) + transform.e * (jj + 0.5)
    col = np.clip(((lon_px - west) / h["dLon"]).astype(int), 0, h["cols"] - 1)
    row = np.clip(((north - lat_px) / h["dLat"]).astype(int), 0, h["rows"] - 1)
    on_lake = lake_d[row, col]
    paper = float(np.percentile(full, 60))
    dark = np.clip((paper - full) / max(1.0, paper - 60), 0, 1)
    alpha = (np.where(on_lake, dark, 0) * 255).astype(np.uint8)
    rgb = np.empty((Ho, Wo, 3), np.uint8)
    rgb[...] = (205, 232, 250)
    out = Path(path).with_name(Path(path).stem + "_geo.tif")
    with rasterio.open(out, "w", driver="GTiff", width=Wo, height=Ho, count=4, dtype="uint8", crs="EPSG:4326", transform=transform, compress="deflate", tiled=True) as dst:
        for b in range(3):
            dst.write(rgb[..., b], b + 1)
        dst.write(alpha, 4)
    print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB)")

    # check image: real lake in blue, fitted scan shoreline in red
    chk = np.zeros((h["rows"], h["cols"], 3), np.uint8)
    chk[lake_mask] = (40, 90, 170)
    X = s * (c * Pc[0] - si * Pc[1]) + ecx + dx
    Y = s * (si * Pc[0] + c * Pc[1]) + ecy + dy
    cc = np.round(X / cellx).astype(int)
    rr = np.round(-Y / celly).astype(int)
    ok = (cc >= 0) & (cc < h["cols"]) & (rr >= 0) & (rr < h["rows"])
    chk[rr[ok], cc[ok]] = (255, 80, 80)
    ys, xs = np.nonzero(lake_mask)
    pad = 20
    crop = chk[max(0, ys.min() - pad) : ys.max() + pad, max(0, xs.min() - pad) : xs.max() + pad]
    Image.fromarray(crop).resize((crop.shape[1] * 3, crop.shape[0] * 3), Image.NEAREST).save(Path(path).with_name(Path(path).stem + "_fit.png"))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    main(args[0], args[1])
