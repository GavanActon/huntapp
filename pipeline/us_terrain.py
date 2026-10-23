"""US terrain for an area, in the forms every bake step reads, so the Canadian
steps run unchanged: USGS 3DEP in place of NRCan's MRDEM and HRDEM.

  pipeline/raw/stage/us-<id>/mrdem.tif     the wide 30 m DEM, from the 3DEP 1 arc-second
                                           tiles, on the MRDEM's own CRS (EPSG:3979) at 30 m,
                                           registered in the stage index under the MRDEM's URL
                                           (stage.py source): rasters.py, build_dem.py,
                                           build_hillshade.py, bush/features.py and the SD
                                           wind read it where they would read the MRDEM
  pipeline/raw/lidar-<id>.npz              the core's 1 m DEM from the 3DEP 1 m tiles, in their
                                           own CRS (UTM), the cache build_hillshade.fetch_core
                                           returns first: hillshade, dem, contours, going and
                                           the coverage report read it

The tiles come from the National Map (tnmaccess.nationalmap.gov; staged on
prd-tnm.s3.amazonaws.com), public domain, listed and downloaded beforehand
into pipeline/raw/us3dep/<stage>/{ned1,dem1m}/ (the area's bake.us3dep.stage,
else its id). Run after the downloads, before the bake:

    py -3.14 pipeline/us_terrain.py --area cadillac
    py -3.14 pipeline/us_terrain.py --area cadillac --only wide|core

A stage is kept once made; --force remakes it.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.merge import merge
from rasterio.warp import calculate_default_transform, reproject, transform_bounds
from rasterio.windows import from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parent))
import area  # noqa: E402  (first: it takes --area out of argv)
from common import CACHE_DIR, CORE, REGION, ROOT  # noqa: E402
from rasters import MRDEM  # noqa: E402

BAKE = area.load(area.ID).get("bake") or {}
STAGE_NAME = (BAKE.get("us3dep") or {}).get("stage") or area.ID
RAW = ROOT / "pipeline" / "raw" / "us3dep" / STAGE_NAME
STAGE = ROOT / "pipeline" / "raw" / "stage" / f"us-{area.ID}"
MRDEM_CRS = "EPSG:3979"
MRDEM_M = 30.0
# build_hillshade.MARGIN_DEG: the core's margin the LiDAR cache must hold
MARGIN_DEG = 0.004
# how far past the region the wide DEM goes: build_dem reads the region's z10 tiles plus 0.02°,
# sd_wind pads 4.5 km; a z10 tile is 0.35° wide, so half a degree each way holds it all
WIDE_PAD_DEG = 0.5


def tifs(sub: str) -> list[Path]:
    out = sorted((RAW / sub).glob("*.tif"))
    if not out:
        raise SystemExit(f"no {sub} tiles in {RAW / sub}: download them first (the TNM lists in {RAW})")
    return out


def wide(force: bool) -> None:
    """The stage's mrdem.tif: the 1 arc-second tiles merged, clipped to the region plus the pad,
    and warped onto the MRDEM's CRS at 30 m."""
    STAGE.mkdir(parents=True, exist_ok=True)
    tif = STAGE / "mrdem.tif"
    done = STAGE / "mrdem.tif.done"
    box = (REGION["west"] - WIDE_PAD_DEG, REGION["south"] - WIDE_PAD_DEG, REGION["east"] + WIDE_PAD_DEG, REGION["north"] + WIDE_PAD_DEG)
    if done.exists() and not force:
        print(f"wide: {tif.name} done already")
    else:
        t = time.time()
        srcs = [rasterio.open(p) for p in tifs("ned1")]
        print(f"wide: merging {len(srcs)} 1 arc-second tiles over {[round(v, 3) for v in box]}")
        nodata = srcs[0].nodata if srcs[0].nodata is not None else -999999.0
        arr, tr = merge(srcs, bounds=box, nodata=nodata, resampling=Resampling.bilinear)
        crs = srcs[0].crs
        for s in srcs:
            s.close()
        a = arr[0].astype(np.float32)
        a[a == nodata] = np.nan
        # onto the MRDEM's grid: EPSG:3979 at 30 m, so every reader sees the pixel size it expects
        dst_tr, w, h = calculate_default_transform(crs, MRDEM_CRS, a.shape[1], a.shape[0], *rasterio.transform.array_bounds(a.shape[0], a.shape[1], tr)[:4], resolution=(MRDEM_M, MRDEM_M))
        out = np.full((h, w), np.nan, dtype=np.float32)
        reproject(a, out, src_transform=tr, src_crs=crs, src_nodata=np.nan, dst_transform=dst_tr, dst_crs=MRDEM_CRS, dst_nodata=np.nan, resampling=Resampling.bilinear)
        ND = -32767.0
        out[~np.isfinite(out)] = ND
        profile = {
            "driver": "GTiff", "width": w, "height": h, "count": 1, "dtype": "float32", "crs": MRDEM_CRS, "transform": dst_tr, "nodata": ND,
            "tiled": True, "blockxsize": 512, "blockysize": 512, "compress": "deflate", "predictor": 3, "zlevel": 6,
        }
        tif.unlink(missing_ok=True)
        with rasterio.open(tif, "w", **profile) as dst:
            dst.write(out, 1)
        done.write_text("", encoding="utf-8")
        print(f"  {out.shape} at {MRDEM_M:g} m, {int((out == ND).sum())} nodata px, in {time.time() - t:.0f} s -> {tif}")
    ix_path = STAGE / "index.json"
    ix = json.loads(ix_path.read_text(encoding="utf-8")) if ix_path.exists() else {"box": list(box), "layers": {}}
    ix["box"] = list(box)
    ix["layers"]["mrdem"] = {"url": MRDEM, "source": "USGS 3DEP 1 arc-second DEM, warped to the MRDEM's grid (EPSG:3979, 30 m)", "tiles": [p.name for p in tifs("ned1")]}
    ix_path.write_text(json.dumps(ix, indent=1), encoding="utf-8")
    print(f"  stage index: {ix_path} (mrdem -> {MRDEM.rsplit('/', 1)[-1]})")


def core(force: bool) -> None:
    """lidar-<id>.npz: the 1 m tiles merged over the core plus its margin, in the tiles' own CRS."""
    cache = CACHE_DIR / f"lidar-{REGION['id']}.npz"
    if cache.exists() and not force:
        print(f"core: {cache.name} is there already (--force to remake it)")
        return
    t = time.time()
    paths = tifs("dem1m")
    srcs = [rasterio.open(p) for p in paths]
    crs = srcs[0].crs
    for s in srcs[1:]:
        if s.crs != crs:
            raise SystemExit(f"{Path(s.name).name} is in {s.crs}, the first tile in {crs}: one CRS per stage")
    box = (CORE["west"] - MARGIN_DEG, CORE["south"] - MARGIN_DEG, CORE["east"] + MARGIN_DEG, CORE["north"] + MARGIN_DEG)
    b = transform_bounds("EPSG:4326", crs, *box, densify_pts=21)
    nodata = srcs[0].nodata if srcs[0].nodata is not None else -999999.0
    print(f"core: merging {len(srcs)} 1 m tiles over the core plus {MARGIN_DEG}° in {crs}")
    arr, tr = merge(srcs, bounds=b, nodata=nodata)
    res = srcs[0].res
    for s in srcs:
        s.close()
    elev = arr[0].astype(np.float32)
    ND = -32767.0
    bad = (elev == nodata) | ~np.isfinite(elev)
    elev[bad] = ND
    np.savez_compressed(cache, elev=elev, transform=np.array(tr)[:6], crs=crs.to_string(), nodata=ND, sources=np.array([p.name for p in paths]), feather_m=0.0)
    print(f"  {elev.shape} at {res[0]:g} m, nodata px {int(bad.sum())} ({bad.mean() * 100:.2f}%), in {time.time() - t:.0f} s -> {cache.name}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=["wide", "core"])
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    print(f"{REGION['name']} ({area.ID}): 3DEP tiles from {RAW}")
    if args.only in (None, "wide"):
        wide(args.force)
    if args.only in (None, "core"):
        core(args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
