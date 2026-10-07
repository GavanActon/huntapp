"""Local copies of the national 30 m rasters, so bakes read them from disk.

Every bake reads windows of the same national COGs over HTTP: the MRDEM and
the land cover (rasters.py, build_hillshade.py) and SCANFI and CanLaD
(ca_forest.py). From here that is about 3 MB/s and minutes a read, which is
fine for an area now and then and far too slow for a province of tiles
(tiles.py). So a box is read once, into pipeline/raw/stage/<name>/, one
GeoTIFF per source, on the source's own pixel grid. A bake then asks
`source(url, box)` and gets the local file when one covers its box, else
the URL as before. Because the copy is pixel-aligned with the source, a
window read from it gives the same pixels a window of the source would.

    py -3.14 pipeline/stage.py fetch --name pilot --box -85.95 48.75 -85.25 49.12
    py -3.14 pipeline/stage.py fetch --name on-north --box -95.25 44.2 -75.7 52.5
    py -3.14 pipeline/stage.py list

A fetch reads 2048 px blocks, 8 at a time, and records each block it has
written in a sidecar, so a stopped fetch picks up where it was. A layer is
done when its <layer>.tif.done appears.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STAGE = ROOT / "raw" / "stage"

GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
    GDAL_HTTP_MULTIRANGE="YES",
    GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES",
    GDAL_HTTP_MAX_RETRY="8",
    GDAL_HTTP_RETRY_DELAY="3",
    CPL_VSIL_CURL_CHUNK_SIZE="4194304",
)


def sources() -> dict[str, str]:
    """Every national raster a bake reads, by a short name."""
    sys.path.insert(0, str(ROOT))
    scanfi = "https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/SCANFI/v2/SCANFI_{kind}_{layer}_{year}_v2_20260119.tif"
    canlad = (
        "https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/canlad_including_insect_defoliation/v1.1/"
        "Latest_filtered_CAN_20260508/canlad_1985_2025_latest_{layer}_v1_1_20260508.tif"
    )
    species = ["blackSpruce", "balsamFir", "jackPine", "whiteRedPine", "tamarack", "lodgepolePine", "douglasFir", "ponderosaPine", "otherConiferous", "broadleaf"]
    out = {f"sp_{k}": scanfi.format(kind="spsCC", layer=k, year=2025) for k in species}
    for k in ("nfiLandcover", "closure", "height"):
        out[k] = scanfi.format(kind="att", layer=k, year=2025)
    out["age"] = scanfi.format(kind="age", layer="median", year=2025)
    out["dist_type"] = canlad.format(layer="type")
    out["dist_year"] = canlad.format(layer="start_year")
    out["mrdem"] = "https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif"
    out["landcover"] = "https://datacube-prod-data-public.s3.ca-central-1.amazonaws.com/store/land/landcover/landcover-2020-classification.tif"
    return out


# ---- lookup: what a bake calls --------------------------------------------

_index: list[dict] | None = None


def _load_index() -> list[dict]:
    global _index
    if _index is None:
        _index = []
        for p in sorted(STAGE.glob("*/index.json")):
            try:
                ix = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            for layer, e in ix.get("layers", {}).items():
                tif = p.parent / f"{layer}.tif"
                if (p.parent / f"{layer}.tif.done").exists():
                    _index.append({"url": e["url"], "path": str(tif), "box": ix["box"], "stage": p.parent.name})
    return _index


def source(url: str, box: tuple[float, float, float, float] | None = None) -> str:
    """What rasterio should open for `url` when reading `box` (lon/lat west,
    south, east, north): a staged copy that holds the box, else the URL over
    HTTP. The smallest staged copy that fits wins."""
    if os.environ.get("HUNTAPP_NO_STAGE"):
        return f"/vsicurl/{url}"
    fits = [
        e
        for e in _load_index()
        if e["url"] == url and (box is None or (e["box"][0] <= box[0] and e["box"][1] <= box[1] and e["box"][2] >= box[2] and e["box"][3] >= box[3]))
    ]
    if not fits:
        return f"/vsicurl/{url}"
    e = min(fits, key=lambda e: (e["box"][2] - e["box"][0]) * (e["box"][3] - e["box"][1]))
    return e["path"]


# ---- fetch: making a staged copy ------------------------------------------

BLOCK = 2048


def fetch_layer(name: str, url: str, box: tuple[float, float, float, float], out_dir: Path, threads: int) -> None:
    import numpy as np
    import rasterio
    from rasterio.warp import transform_bounds
    from rasterio.windows import Window, from_bounds

    tif = out_dir / f"{name}.tif"
    done = out_dir / f"{name}.tif.done"
    if done.exists():
        print(f"{name}: done already")
        return
    blocks_file = out_dir / f"{name}.tif.blocks"
    t0 = time.time()
    with rasterio.Env(**GDAL_ENV), rasterio.open(f"/vsicurl/{url}") as src:
        b = transform_bounds("EPSG:4326", src.crs, *box, densify_pts=41)
        # whole source pixels, inside the source: the copy shares its grid
        w = from_bounds(*b, src.transform).round_offsets(op="floor").round_lengths(op="ceil")
        col0, row0 = max(0, int(w.col_off)), max(0, int(w.row_off))
        col1, row1 = min(src.width, int(w.col_off + w.width)), min(src.height, int(w.row_off + w.height))
        win = Window(col0, row0, col1 - col0, row1 - row0)
        profile = {
            "driver": "GTiff",
            "width": int(win.width),
            "height": int(win.height),
            "count": 1,
            "dtype": src.dtypes[0],
            "crs": src.crs,
            "transform": src.window_transform(win),
            "nodata": src.nodata,
            "tiled": True,
            "blockxsize": 512,
            "blockysize": 512,
            "compress": "deflate",
            "predictor": 3 if np.dtype(src.dtypes[0]).kind == "f" else 2,
            "zlevel": 6,
            "BIGTIFF": "YES",
            "num_threads": "ALL_CPUS",
        }
    jobs = [(r, c) for r in range(0, int(win.height), BLOCK) for c in range(0, int(win.width), BLOCK)]
    have: set[tuple[int, int]] = set()
    if tif.exists() and blocks_file.exists():
        have = {tuple(x) for x in json.loads(blocks_file.read_text())}
    else:
        tif.unlink(missing_ok=True)
        with rasterio.open(tif, "w", **profile):
            pass
    todo = [j for j in jobs if j not in have]
    print(f"{name}: {win.width} x {win.height} px, {len(jobs)} blocks, {len(todo)} to read", flush=True)

    local = threading.local()

    def read(job):
        r, c = job
        if not hasattr(local, "ds"):
            local.env = rasterio.Env(**GDAL_ENV)
            local.env.__enter__()
            local.ds = rasterio.open(f"/vsicurl/{url}")
        h, wd = min(BLOCK, int(win.height) - r), min(BLOCK, int(win.width) - c)
        for attempt in range(6):
            try:
                return job, local.ds.read(1, window=Window(col0 + c, row0 + r, wd, h))
            except rasterio.errors.RasterioIOError as e:
                print(f"  {name} {job}: retry {attempt + 1} ({str(e)[:80]})", flush=True)
                time.sleep(5 * (attempt + 1))
        raise SystemExit(f"{name}: block {job} would not read")

    n = 0
    with rasterio.open(tif, "r+") as dst, ThreadPoolExecutor(threads) as ex:
        futures = [ex.submit(read, j) for j in todo]
        for f in as_completed(futures):
            (r, c), a = f.result()
            dst.write(a, 1, window=Window(c, r, a.shape[1], a.shape[0]))
            have.add((r, c))
            n += 1
            if n % 20 == 0 or n == len(todo):
                blocks_file.write_text(json.dumps(sorted(have)))
                rate = n / max(1e-6, time.time() - t0)
                print(f"  {name}: {len(have)}/{len(jobs)} blocks, {rate * 60:.1f}/min, {(len(todo) - n) / max(rate, 1e-6) / 60:.0f} min left", flush=True)
    blocks_file.unlink(missing_ok=True)
    done.write_text(time.strftime("%Y-%m-%d %H:%M"))
    print(f"{name}: {tif.stat().st_size / 1e9:.2f} GB in {(time.time() - t0) / 60:.1f} min", flush=True)


def fetch(name: str, box: tuple[float, float, float, float], layers: list[str] | None, threads: int) -> None:
    out_dir = STAGE / name
    out_dir.mkdir(parents=True, exist_ok=True)
    src = sources()
    chosen = layers or list(src)
    ix_path = out_dir / "index.json"
    ix = json.loads(ix_path.read_text(encoding="utf-8")) if ix_path.exists() else {"box": list(box), "layers": {}}
    if [round(v, 6) for v in ix["box"]] != [round(v, 6) for v in box]:
        raise SystemExit(f"stage {name!r} was made for the box {ix['box']}: use another name, or delete {out_dir}")
    for layer in chosen:
        ix["layers"][layer] = {"url": src[layer]}
    ix_path.write_text(json.dumps(ix, indent=1), encoding="utf-8")
    t0 = time.time()
    for layer in chosen:
        fetch_layer(layer, src[layer], box, out_dir, threads)
    print(f"stage {name}: {len(chosen)} layers in {(time.time() - t0) / 60:.1f} min")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--name", required=True)
    f.add_argument("--box", type=float, nargs=4, required=True, metavar=("W", "S", "E", "N"))
    f.add_argument("--layers", nargs="*")
    f.add_argument("--threads", type=int, default=8)
    sub.add_parser("list")
    args = ap.parse_args()
    if args.cmd == "fetch":
        fetch(args.name, tuple(args.box), args.layers, args.threads)
    else:
        for p in sorted(STAGE.glob("*/index.json")):
            ix = json.loads(p.read_text(encoding="utf-8"))
            done = [k for k in ix["layers"] if (p.parent / f"{k}.tif.done").exists()]
            size = sum(q.stat().st_size for q in p.parent.glob("*.tif")) / 1e9
            print(f"{p.parent.name}: box {ix['box']}, {len(done)}/{len(ix['layers'])} layers done, {size:.1f} GB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
