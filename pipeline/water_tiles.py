r"""Tiles that are all water leave the SD bake queue unless a neighbour has land (Gavan, 2026-10-17:
"there's big areas that are fully water, we don't need those unless they are adjacent to land").

    py -3.14 pipeline/water_tiles.py --queue pipeline/raw/windtiles/queue.txt --batches pipeline/raw/windcfd/sdtiles/xonix
    py -3.14 pipeline/water_tiles.py ... --apply       # rewrite the queue and the batch files not yet taken

One decimated read of NRCan's 2020 land cover (rasters.LANDCOVER, EPSG:3979, 30 m) over the queue's extent at
about 1 km a pixel, then each tile's land share (classes 1-17 and 19; 18 is water, 0 is outside the data). A tile
is water when its land share is under LAND_MIN; it is skipped when it is water and none of the eight tiles round
it has land, so a block under a shoreline keeps all four tiles. The skipped ids go to <queue dir>/skipped-water.txt.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import tiles as lattice  # noqa: E402
from rasters import LANDCOVER  # noqa: E402

LAND_MIN = 0.005      # under this share of land cells, the tile is water
DECIMATE = 32         # 30 m -> ~1 km a pixel: ~11 x 11 pixels a tile, enough to tell all-water
WATER, NODATA = 18, 0


def read_ids(queue: Path, batches: Path | None) -> tuple[list[str], dict[Path, list[str]]]:
    q = [ln.split("\t")[0].strip() for ln in queue.read_text(encoding="utf-8").splitlines() if ln.strip()]
    b: dict[Path, list[str]] = {}
    if batches and batches.exists():
        for f in sorted(batches.glob("batch-*.txt")):
            b[f] = [ln.split("\t")[0].strip() for ln in f.read_text(encoding="utf-8").splitlines() if ln.strip()]
    return q, b


def land_shares(ids: set[str]) -> dict[str, float]:
    """Each tile's land share, and its neighbours', from one decimated read of the land cover."""
    cells = {lattice.parse_id(t) for t in ids}
    around = {(i + di, j + dj) for i, j in cells for di in (-1, 0, 1) for dj in (-1, 0, 1)}
    boxes = {c: lattice.tile_box(*c) for c in around}
    west = min(b["west"] for b in boxes.values()) - 0.2
    east = max(b["east"] for b in boxes.values()) + 0.2
    south = min(b["south"] for b in boxes.values()) - 0.2
    north = max(b["north"] for b in boxes.values()) + 0.2
    t0 = time.time()
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="6", GDAL_HTTP_RETRY_DELAY="2"):
        with rasterio.open(f"/vsicurl/{LANDCOVER}") as src:
            b = transform_bounds("EPSG:4326", src.crs, west, south, east, north)
            w = from_bounds(*b, src.transform).round_offsets().round_lengths()
            h, wd = int(w.height) // DECIMATE, int(w.width) // DECIMATE
            arr = src.read(1, window=w, out_shape=(h, wd))
            tr = src.window_transform(w) * rasterio.Affine.scale(w.width / wd, w.height / h)
            crs = src.crs
    print(f"land cover {arr.shape} at ~{abs(tr.a):.0f} m over {len(around)} tiles' ground in {time.time() - t0:.0f} s", flush=True)
    land = (arr != WATER) & (arr != NODATA)
    out: dict[str, float] = {}
    for c, box in boxes.items():
        bb = transform_bounds("EPSG:4326", crs, box["west"], box["south"], box["east"], box["north"])
        ww = from_bounds(*bb, tr)
        r0, r1 = max(0, int(ww.row_off)), min(land.shape[0], int(ww.row_off + ww.height) + 1)
        c0, c1 = max(0, int(ww.col_off)), min(land.shape[1], int(ww.col_off + ww.width) + 1)
        sub = land[r0:r1, c0:c1]
        out[lattice.tile_id(*c)] = float(sub.mean()) if sub.size else 0.0
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--queue", required=True)
    ap.add_argument("--batches", help="xonix's batch files folder: the batch-*.txt not yet taken are filtered too")
    ap.add_argument("--apply", action="store_true", help="rewrite the queue and the batch files (default: report only)")
    a = ap.parse_args()
    queue = Path(a.queue)
    q, batches = read_ids(queue, Path(a.batches) if a.batches else None)
    ids = set(q) | {t for v in batches.values() for t in v}
    share = land_shares(ids)
    skipped: list[str] = []
    for t in sorted(ids):
        if share[t] >= LAND_MIN:
            continue
        i, j = lattice.parse_id(t)
        if any(share.get(lattice.tile_id(i + di, j + dj), 0.0) >= LAND_MIN for di in (-1, 0, 1) for dj in (-1, 0, 1) if (di, dj) != (0, 0)):
            continue
        skipped.append(t)
    water_kept = [t for t in ids if share[t] < LAND_MIN and t not in skipped]
    print(f"{len(ids)} tiles: {len(skipped)} all water with no land next door (skipped), {len(water_kept)} all water next to land (kept)")
    nq = [ln for ln in queue.read_text(encoding="utf-8").splitlines() if ln.strip() and ln.split("\t")[0].strip() not in set(skipped)]
    print(f"queue {len(q)} -> {len(nq)}")
    for f, v in batches.items():
        keep = [t for t in v if t not in set(skipped)]
        if len(keep) != len(v):
            print(f"  {f.name}: {len(v)} -> {len(keep)}")
    if a.apply:
        (queue.parent / "skipped-water.txt").write_text("\n".join(skipped) + "\n", encoding="utf-8", newline="\n")
        queue.write_text("\n".join(nq) + "\n", encoding="utf-8", newline="\n")
        for f, v in batches.items():
            lines = [ln for ln in f.read_text(encoding="utf-8").splitlines() if ln.strip() and ln.split("\t")[0].strip() not in set(skipped)]
            f.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        print(f"applied; skipped ids in {queue.parent / 'skipped-water.txt'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
