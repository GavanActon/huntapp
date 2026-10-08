"""Imagery where no province publishes any (adapter ca.s2summer): a leaf-on
Sentinel-2 composite of the region, 10 m, as satellite-<id>.pmtiles.

Blanchard River, BC, had no imagery at all: the province's open orthos stop
east of 134° W, the Yukon's mosaic at the border. Gavan, 2026-10-08: "summer
is better than none". Sentinel-2 L2A scenes from Earth Search (AWS, no
login; the bush model's own source, pipeline/bush/features.py) over the
leaf-on window (20 June to 31 August) of the last three summers, the least
cloudy first, each masked by its scene classification, and the per-pixel
median of the clear pixels in red, green and blue: haze, cloud shadow and
a stray early snow drop out of a median. Gaps the clear scenes never saw
take the nearest seen pixel. The reflectance goes to 8 bits with a gentle
gamma so the dark conifer reads, and build_raster.py cuts the Web Mercator
JPEG tiles, the region to zoom 14 (10 m is about zoom 13 at 60° N; the map
over-zooms the rest). Free to use, with the Copernicus credit.

    py -3.14 pipeline/s2_imagery.py --area blanchard-river
"""

from __future__ import annotations

import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds
from scipy.ndimage import distance_transform_edt

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent / "bush"))
import area  # noqa: E402  (first: it takes --area out of argv)
import features as F  # noqa: E402
from common import CACHE_DIR, CORE, OUT_DIR, REGION  # noqa: E402

PX_M = 10.0
MARGIN_DEG = 0.01
CANDIDATES = 30  # the least cloudy leaf-on scenes whose masks are read
SCENES = 12  # the clearest of those that go into the median
MAXZ = 14
BANDS = ("red", "green", "blue")
# reflectance to 8 bits: full white at this reflectance, lifted by the gamma
WHITE = 0.28
GAMMA = 1.0 / 1.5


def grid() -> F.Grid:
    w, s, e, n = transform_bounds("EPSG:4326", "EPSG:3857", REGION["west"] - MARGIN_DEG, REGION["south"] - MARGIN_DEG, REGION["east"] + MARGIN_DEG, REGION["north"] + MARGIN_DEG)
    W, H = math.ceil((e - w) / PX_M), math.ceil((n - s) / PX_M)
    return F.Grid("EPSG:3857", from_origin(w, n, PX_M, PX_M), W, H)


def composite(g: F.Grid) -> tuple[np.ndarray, np.ndarray, list]:
    """(rgb reflectance (3, H, W), scenes per pixel, the scenes used)."""
    t0 = time.time()
    items = [it for it in F.s2_items(g) if F.season_of(it) == "leafon"]
    items.sort(key=lambda it: it.properties.get("eo:cloud_cover", 100))
    cand = items[:CANDIDATES]
    print(f"  {len(items)} leaf-on scenes {F.S2_YEARS[0]}-{F.S2_YEARS[-1]}; masks of the {len(cand)} least cloudy ... ({time.time() - t0:.0f} s)", flush=True)
    with ThreadPoolExecutor(F.THREADS) as ex:
        scls = list(ex.map(lambda it: F.read_asset(it, "scl", g, categorical=True), cand))
        scored = []
        for it, scl in zip(cand, scls):
            if scl is None:
                continue
            good = np.isin(scl, F.CLEAR) | (scl == F.SNOW)  # summer snowfields are ground here, not a mask
            share = float(good.mean())
            if share >= F.MIN_CLEAR:
                scored.append((share, it, good))
        scored.sort(key=lambda t: -t[0])
        scored = scored[:SCENES]
        print("  using " + " ".join(f"{it.datetime:%Y-%m-%d}:{s:.2f}" for s, it, _ in scored), flush=True)
        n = len(scored)
        if not n:
            raise SystemExit("no clear leaf-on Sentinel-2 scene over the region")
        jobs = [(i, b) for i in range(n) for b in BANDS]
        reads = list(ex.map(lambda j: F.read_asset(scored[j[0]][1], j[1], g, categorical=False), jobs))
    stack = np.full((n, len(BANDS)) + g.shape, np.nan, np.float32)
    for (i, b), a in zip(jobs, reads):
        if a is not None:
            a = a.copy()
            a[~scored[i][2]] = np.nan
            stack[i, BANDS.index(b)] = a
    with np.errstate(all="ignore"):
        rgb = np.nanmedian(stack, axis=0)
    seen = np.isfinite(stack[:, 0]).sum(0)
    print(f"  median of {n} scenes · {time.time() - t0:.0f} s · pixels never clear: {100 * (seen == 0).mean():.1f}%", flush=True)
    gap = ~np.isfinite(rgb[0])
    if gap.any() and not gap.all():
        _, (iy, ix) = distance_transform_edt(gap, return_indices=True)
        rgb = rgb[:, iy, ix]
    return rgb, seen, [it for _, it, _ in scored]


def to_rgb8(rgb: np.ndarray) -> np.ndarray:
    v = np.clip(np.nan_to_num(rgb) / WHITE, 0, 1) ** GAMMA
    return (v * 255 + 0.5).astype(np.uint8)


def main() -> int:
    g = grid()
    print(f"Sentinel-2 leaf-on composite over {REGION['name']}: {g.width}x{g.height} px at {PX_M:g} m (EPSG:3857)")
    rgb, seen, scenes = composite(g)
    out8 = to_rgb8(rgb)
    tif = CACHE_DIR / "s2" / f"satellite-{area.ID}.tif"
    tif.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(tif, "w", driver="GTiff", width=g.width, height=g.height, count=3, dtype="uint8", crs=g.crs, transform=g.transform, compress="deflate", photometric="RGB") as dst:
        dst.write(out8)
    print(f"  wrote {tif.name}")
    years = sorted({it.datetime.year for it in scenes})
    vintage = f"summers {years[0]}-{years[-1]}" if len(years) > 1 else f"summer {years[0]}"
    credit = f"Contains modified Copernicus Sentinel data {years[0]}-{years[-1]}"
    import build_raster

    build_raster.main(["satellite", str(tif), "--minz", "9", "--maxz", str(min(MAXZ, CORE["maxzoom"])), "--jpeg", "--all", "--attribution", credit])
    area.note_source(
        f"satellite-{area.ID}.pmtiles",
        source=f"Sentinel-2 L2A leaf-on median composite, 10 m, {len(scenes)} scenes (Earth Search, AWS); no provincial imagery here",
        licence="Copernicus Sentinel data: free and open, credit required",
        vintage=vintage,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
