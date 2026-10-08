"""Northern training plots for the bush-thickness model (docs/BUSH-MODEL.md,
"Teaching the model the north"): squares of LidarBC's open leaf-on point
clouds over northern British Columbia, measured the way Ontario's plots
are (plots.py), so the model learns the spruce-willow-birch, the boreal
white spruce and aspen of the Peace and the Liard, and the alpine, which
its Ontario plots never showed it.

The source is the LidarBC point-cloud index (an ArcGIS FeatureServer), each
record a ~1.5 km LAZ tile on the province's object store with the flight
date in its name (bc_094p019_4_3_4_xyes_8_utm10_20240706_20240706.laz:
flown 2024-07-06, leaf-on). North of 56° there are about 35,000 tiles,
2021 (Atlin) and 2024-25 (the Peace to the Liard), UTM 8 and 10, NAD83(CSRS),
classes ground 2, water 9, noise 7, a tile 235 MB and 40 M points: the
whole tile comes down (plain LAZ, no COPC octree to read in part).

    py -3.14 pipeline/bush/north.py sample --n 120 --seed 11      # pipeline/raw/bush/plots-north.json
    py -3.14 pipeline/bush/north.py fetch --max-gb 30 [--workers 3]
    py -3.14 pipeline/bush/north.py measure
    py -3.14 pipeline/bush/north.py status

A plot is a 300 m square at a random place inside its tile, cut out of the
tile with a 20 m rim, its heights above a ground model made from its own
ground returns (build_vegstructure.tile_metrics_class, as Quebec's tiles
are measured), on the tile's own UTM grid. Its metrics.npz goes under
pipeline/raw/bush/plots/<plot>/ like an Ontario plot's, so dataset.py
featurises it the same way; dataset.py reads plots-north.json beside
plots.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))

BUSH = ROOT / "raw" / "bush"
NORTH = BUSH / "north"
TILES = NORTH / "tiles"
PLOTS = BUSH / "plots-north.json"
PLOT_DIR = BUSH / "plots"
INDEX_URL = "https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer/4/query"
UA = {"User-Agent": "huntapp-pipeline/1.0 (bush model plots)"}
PLOT_M = 300.0
MARGIN_M = 40.0  # a plot stays this far inside its tile
RIM_M = 20.0  # cut out round the plot, for the ground model at its edge
CELL = 10.0
# north of 56°: the Atlin tiles (2021) and the Peace-Liard programme (2024-25)
NORTH_BOX = (-139.0, 56.0, -120.0, 60.1)
GROUND, WATER, NOISE = (2,), (9,), (7, 18)
DATE_RE = re.compile(r"_(\d{8})_(\d{8})\.laz$")


# ---- the index -----------------------------------------------------------------


def index(box=NORTH_BOX) -> list[dict]:
    """Every point-cloud tile touching the box: filename, url, year, flight
    date, map tile, projection, and the tile's lon/lat bounds."""
    key = hashlib.sha1(json.dumps(box).encode()).hexdigest()[:10]
    path = NORTH / f"index-{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    rows: list[dict] = []
    offset = 0
    while True:
        q = {
            "geometry": ",".join(str(v) for v in box),
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "filename,s3Url,year,maptile,projection,classes",
            "returnGeometry": "true",
            "outSR": "4326",
            "resultOffset": str(offset),
            "resultRecordCount": "2000",
            "orderByFields": "OBJECTID",
            "f": "json",
        }
        with urllib.request.urlopen(urllib.request.Request(f"{INDEX_URL}?{urllib.parse.urlencode(q)}", headers=UA), timeout=180) as r:
            j = json.loads(r.read())
        feats = j.get("features") or []
        for f in feats:
            a = f["attributes"]
            m = DATE_RE.search(a["filename"] or "")
            xs = [p[0] for ring in f["geometry"]["rings"] for p in ring]
            ys = [p[1] for ring in f["geometry"]["rings"] for p in ring]
            rows.append(
                {
                    "filename": a["filename"],
                    "url": a["s3Url"],
                    "year": int(a["year"]) if a.get("year") else (int(m.group(1)[:4]) if m else None),
                    "date": m.group(1) if m else None,
                    "maptile": a["maptile"],
                    "projection": a["projection"],
                    "classes": a.get("classes"),
                    "lonlat": [min(xs), min(ys), max(xs), max(ys)],
                }
            )
        print(f"  index: {len(rows)} tiles", flush=True)
        # the server pages at its own size (1000) whatever is asked: go on while it says there is more
        if not feats or not j.get("exceededTransferLimit", False):
            break
        offset += len(feats)
    NORTH.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows), encoding="utf-8")
    return rows


# ---- sample ----------------------------------------------------------------------


def plot_name(r: dict, fx: float, fy: float) -> str:
    return f"bc_{r['maptile']}_{int(fx * 1000):03d}_{int(fy * 1000):03d}"


def sample(n: int, seed: int, candidates: int, per_tile: int, box=NORTH_BOX, append: bool = False, undated_ok: bool = False) -> None:
    """`box` narrows the draw (Atlin's 2021 tiles: --box -134 58.5 -133.3 58.9,
    the spruce-willow-birch nearest Blanchard River); `append` adds the
    batch to plots-north.json instead of replacing it; `undated_ok` keeps
    tiles whose names carry no flight dates (the 2021 programme, whose
    report gives 2021-06-26 to 2021-09-10 for the whole of it: leaf-on)."""
    import plots as P

    rng = np.random.default_rng(seed)
    tiles = [t for t in index(tuple(box)) if t["url"] and (t["date"] or (undated_ok and t["year"]))]
    # leaf-on flights only: a window (start_end in the name) that starts in
    # June or later and ends by mid-September, before the aspen and willow drop
    def leaf_on(t: dict) -> bool:
        m = DATE_RE.search(t["filename"] or "")
        if not m:
            return not t["date"]  # undated: let through only when undated_ok did above
        start, end = m.group(1), m.group(2)
        return "0601" <= start[4:] and end[4:] <= "0915"

    tiles = [t for t in tiles if leaf_on(t)]
    print(f"{len(tiles)} leaf-on tiles in the box")
    # the candidates come in clusters: PER_TILE squares in each of a few
    # hundred tiles, in map order, so the national rasters (read over HTTP,
    # no staged copy up here) are walked block by block, not point by point
    # across 1,000 km
    PER_TILE = 8
    tile_pick = rng.choice(len(tiles), size=min(max(1, candidates // PER_TILE), len(tiles)), replace=False)
    tile_pick = tile_pick[np.lexsort(([tiles[i]["lonlat"][1] for i in tile_pick], [tiles[i]["lonlat"][0] for i in tile_pick]))]
    pick = np.repeat(tile_pick, PER_TILE)
    fx = rng.random(len(pick))
    fy = rng.random(len(pick))
    lon = np.array([tiles[i]["lonlat"][0] + fx[k] * (tiles[i]["lonlat"][2] - tiles[i]["lonlat"][0]) for k, i in enumerate(pick)])
    lat = np.array([tiles[i]["lonlat"][1] + fy[k] * (tiles[i]["lonlat"][3] - tiles[i]["lonlat"][1]) for k, i in enumerate(pick)])
    year = np.array([tiles[i]["year"] for i in pick], int)
    print(f"{len(pick)} candidate squares; reading the national rasters at each ...", flush=True)
    t = time.time()
    s = P.strata_of(lon, lat)
    print(f"  {time.time() - t:.0f} s")
    dist = np.where(np.isfinite(s["dist_year"]) & (s["dist_year"] > 1900), year - s["dist_year"], np.nan)
    since = np.full(len(pick), 5, int)
    since[(dist >= -1) & (dist <= 3)] = 0
    since[(dist > 3) & (dist <= 8)] = 1
    since[(dist > 8) & (dist <= 25)] = 2
    since[(dist > 25) & (dist <= 40)] = 3
    since[dist > 40] = 4
    since[dist < -1] = 6
    cover = np.nan_to_num(s["nfiLandcover"], nan=0).astype(int)
    treed = np.isin(cover, (5, 6, 7))
    sp = np.stack([np.nan_to_num(s[k]) for k in ("sp_blackSpruce", "sp_jackPine", "sp_balsamFir", "sp_broadleaf", "sp_whiteRedPine", "sp_otherConiferous", "sp_tamarack")])
    lead = np.where(sp.sum(0) > 0, sp.argmax(0), 7)
    hard = np.nan_to_num(s["sp_broadleaf"]) >= 50
    # bands by latitude: 56-57 (the Peace), 57-58, 58-59 (Atlin, the Liard), 59+
    latband = np.digitize(lat, [57.0, 58.0, 59.0])
    keep = (since != 6) & (cover != 8) & (cover != 0)
    key = np.where(treed, np.where(since < 5, 10 + since, 20 + np.where(hard, 7, lead)), 30 + cover)
    print(f"  {keep.sum()} usable candidates")
    # the same quotas as Ontario's, with the open classes (shrub, herb, bryoid,
    # rock) drawn harder: they are what the north has and the south lacks
    quota = {10: 0.07, 11: 0.07, 12: 0.08, 13: 0.07, 14: 0.03, 20: 0.08, 21: 0.02, 22: 0.06, 23: 0.05, 24: 0.01, 25: 0.06, 26: 0.03, 27: 0.09, 31: 0.05, 32: 0.06, 33: 0.04, 34: 0.12, 38: 0.01}
    chosen: list[int] = []
    used: Counter = Counter()
    short = 0

    def take(i: int) -> bool:
        t = tiles[pick[i]]["filename"]
        if used[t] >= per_tile:
            return False
        used[t] += 1
        chosen.append(i)
        return True

    for k, q in quota.items():
        want = int(round(q * n))
        bands = [rng.permutation(np.flatnonzero(keep & (key == k) & (latband == b))).tolist() for b in range(4)]
        got = 0
        while got < want and any(bands):
            for b in bands:
                while b and got < want:
                    if take(b.pop()):
                        got += 1
                        break
        if got < want:
            print(f"  stratum {P.STRATUM_NAMES.get(k, k)}: {got} of {want} wanted")
            short += want - got
    if short:
        pool = [i for i in rng.permutation(np.flatnonzero(keep & treed & (since == 5))) if i not in set(chosen)]
        for i in pool:
            if short <= 0:
                break
            if take(int(i)):
                short -= 1
    chosen = sorted(set(chosen))
    rows = []
    for i in chosen:
        t = tiles[pick[i]]
        rows.append(
            {
                "plot": plot_name(t, fx[i], fy[i]),
                "source": "lidarbc",
                "tile": {"Tilename": Path(t["filename"]).stem, "url": t["url"], "year": t["year"], "date": t["date"], "maptile": t["maptile"], "projection": t["projection"]},
                "fx": round(float(fx[i]), 4),
                "fy": round(float(fy[i]), 4),
                "side_m": PLOT_M,
                "crs": None,
                "lon": round(float(lon[i]), 5),
                "lat": round(float(lat[i]), 5),
                "year": int(year[i]),
                "stratum": P.STRATUM_NAMES.get(int(key[i]), str(int(key[i]))),
                "latband": int(latband[i]),
                "scanfi": {k: (None if not np.isfinite(s[k][i]) else round(float(s[k][i]), 1)) for k in ("nfiLandcover", "closure", "height", "age", "dist_type", "dist_year", "landcover")},
            }
        )
    BUSH.mkdir(parents=True, exist_ok=True)
    if append and PLOTS.exists():
        old = json.loads(PLOTS.read_text(encoding="utf-8"))
        have = {r["plot"] for r in old}
        rows = old + [r for r in rows if r["plot"] not in have]
    PLOTS.write_text(json.dumps(rows, indent=1), encoding="utf-8")
    print(f"{len(rows)} plots in {len(used)} tiles -> {PLOTS}")
    for k, c in sorted(Counter(r["stratum"] for r in rows).items()):
        print(f"  {c:4d}  {k}")
    for k, c in sorted(Counter(r["latband"] for r in rows).items()):
        print(f"  lat band {k}: {c}")
    print(f"  tiles to fetch: {len(used)} x ~235 MB, about {len(used) * 0.235:.0f} GB")


# ---- fetch -------------------------------------------------------------------------


def tile_path(r: dict) -> Path:
    return TILES / f"{r['tile']['Tilename']}.laz"


def plot_dir(r: dict) -> Path:
    return PLOT_DIR / r["plot"]


def fetched(r: dict) -> bool:
    return tile_path(r).exists()


def download(url: str, dest: Path) -> int:
    """A resumable download (Range from the .part's end). Returns the bytes added."""
    part = dest.with_suffix(".part")
    have = part.stat().st_size if part.exists() else 0
    req = urllib.request.Request(url, headers={**UA, **({"Range": f"bytes={have}-"} if have else {})})
    added = 0
    with urllib.request.urlopen(req, timeout=300) as r, open(part, "ab" if have else "wb") as f:
        if have and r.status != 206:  # the server ignored the range: start over
            f.seek(0)
            f.truncate()
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
            added += len(b)
    part.replace(dest)
    return added


def fetch(max_gb: float, workers: int, limit: int | None, list_only: bool) -> None:
    rows = json.loads(PLOTS.read_text(encoding="utf-8"))
    todo: dict[str, dict] = {}
    for r in rows:
        if not fetched(r):
            todo.setdefault(r["tile"]["Tilename"], r)
    items = list(todo.values())[: limit or None]
    print(f"{len(items)} tiles to fetch (about {len(items) * 0.235:.1f} GB; cap {max_gb} GB)")
    if list_only:
        for r in items:
            print(f"  {r['tile']['url']}")
        return
    TILES.mkdir(parents=True, exist_ok=True)
    total = 0
    t0 = time.time()
    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(download, r["tile"]["url"], tile_path(r)): r for r in items}
        for fu in as_completed(futs):
            r = futs[fu]
            try:
                n = fu.result()
            except Exception as e:  # noqa: BLE001
                print(f"  failed {r['tile']['Tilename']}: {str(e)[:100]}", flush=True)
                continue
            total += n
            print(f"  {r['tile']['Tilename']} {n / 1e6:.0f} MB · {total / 1e9:.1f} GB · {time.time() - t0:.0f} s", flush=True)
            if total / 1e9 >= max_gb:
                print("  cap reached; the rest another time")
                ex.shutdown(cancel_futures=True)
                break


# ---- measure ---------------------------------------------------------------------------


def horizontal_epsg(crs) -> int | None:
    """The horizontal part of the LAZ's CRS (a compound CRS carries the vertical too)."""
    if crs is None:
        return None
    parts = getattr(crs, "sub_crs_list", None) or []
    for c in parts:
        e = c.to_epsg()
        if e and not c.is_vertical:
            return e
    return crs.to_epsg()


def measure_one(r: dict) -> dict:
    """Cut the plot (with its rim) out of the tile into its own LAZ, measure
    it with build_vegstructure.tile_metrics_class, keep the plot's cells."""
    import laspy

    import build_vegstructure as bv
    from rasterio.transform import from_origin

    src = tile_path(r)
    with laspy.open(src) as f:
        h = f.header
        epsg = horizontal_epsg(h.parse_crs())
        minx, miny = float(h.mins[0]), float(h.mins[1])
        maxx, maxy = float(h.maxs[0]), float(h.maxs[1])
    if not epsg:
        raise RuntimeError("no CRS in the LAZ header")
    inner_w, inner_h = maxx - minx - PLOT_M - 2 * MARGIN_M, maxy - miny - PLOT_M - 2 * MARGIN_M
    x0 = np.floor((minx + MARGIN_M + r["fx"] * max(inner_w, 0)) / CELL) * CELL
    y0 = np.floor((miny + MARGIN_M + r["fy"] * max(inner_h, 0)) / CELL) * CELL
    box = (x0 - RIM_M, y0 - RIM_M, x0 + PLOT_M + RIM_M, y0 + PLOT_M + RIM_M)
    d = plot_dir(r)
    d.mkdir(parents=True, exist_ok=True)
    cut = d / f"{r['tile']['Tilename']}.plot.laz"
    if not cut.exists():
        with laspy.open(src) as f, laspy.open(cut, mode="w", header=f.header) as w:
            for pts in f.chunk_iterator(2_000_000):
                x, y = np.asarray(pts.x), np.asarray(pts.y)
                k = (x >= box[0]) & (x < box[2]) & (y >= box[1]) & (y < box[3])
                if k.any():
                    w.write_points(pts[k])
    t = {"laz": cut, "bounds": box, "drop": NOISE, "groundClasses": GROUND, "water": WATER}
    m = bv.tile_metrics_class(t, np.zeros((0, 3)))
    k = int(RIM_M / CELL)
    sl = (slice(k, -k), slice(k, -k))
    out: dict = {}
    for key in ("density", "canopy_height", "canopy_cover", "understory", "understory_pad", "water_frac", "n_reach"):
        out[key] = np.array(m[key][sl], dtype=np.float32)
    if "strata" in m:
        out["strata"] = m["strata"][(slice(None),) + sl]
    land = (1 - out["water_frac"]) >= bv.MIN_LAND
    ok = land & (out["density"] >= bv.MIN_DENSITY)
    reach = ok & (out["n_reach"] >= bv.MIN_REACH)
    out["understory"][~reach] = np.nan
    out["understory_pad"][~reach] = np.nan
    for key in ("canopy_height", "canopy_cover", "density"):
        out[key][~ok] = np.nan
    out["transform"] = np.array(from_origin(x0, y0 + PLOT_M, CELL, CELL))[:6]
    out["crs"] = np.array(f"EPSG:{epsg}")
    out["raw_points"] = m.get("raw_points", 0)
    np.savez_compressed(d / "metrics.npz", **out)
    r["crs"] = f"EPSG:{epsg}"
    r["x0"], r["y0"] = float(x0), float(y0)
    u, hgt = out["understory"], out["canopy_height"]
    return {"plot": r["plot"], "cells": int(np.isfinite(u).sum()), "nrd": float(np.nanmean(u)) if np.isfinite(u).any() else None, "height": float(np.nanmean(hgt)) if np.isfinite(hgt).any() else None}


def measure(redo: bool) -> None:
    rows = json.loads(PLOTS.read_text(encoding="utf-8"))
    todo = [r for r in rows if fetched(r) and (redo or not (plot_dir(r) / "metrics.npz").exists())]
    print(f"{len(todo)} plots to measure")
    t0 = time.time()
    for i, r in enumerate(todo):
        try:
            s = measure_one(r)
        except Exception as e:  # noqa: BLE001
            print(f"[{i + 1}/{len(todo)}] {r['plot']} failed: {str(e)[:120]}", flush=True)
            continue
        nrd = "-" if s["nrd"] is None else f"{s['nrd']:.3f}"
        ht = "-" if s["height"] is None else f"{s['height']:.1f} m"
        print(f"[{i + 1}/{len(todo)}] {s['plot']} ({r['stratum']}): {s['cells']} cells, NRD {nrd}, height {ht} · {time.time() - t0:.0f} s", flush=True)
    PLOTS.write_text(json.dumps(rows, indent=1), encoding="utf-8")  # the crs and corner filled in


def status() -> None:
    rows = json.loads(PLOTS.read_text(encoding="utf-8"))
    f = sum(fetched(r) for r in rows)
    m = sum((plot_dir(r) / "metrics.npz").exists() for r in rows)
    print(f"{len(rows)} plots, {f} fetched, {m} measured")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sample")
    s.add_argument("--n", type=int, default=120)
    s.add_argument("--seed", type=int, default=11)
    s.add_argument("--candidates", type=int, default=1500)
    s.add_argument("--per-tile", type=int, default=2)
    s.add_argument("--box", type=float, nargs=4, metavar=("W", "S", "E", "N"), default=list(NORTH_BOX))
    s.add_argument("--append", action="store_true")
    s.add_argument("--undated-ok", action="store_true")
    f = sub.add_parser("fetch")
    f.add_argument("--max-gb", type=float, default=30.0)
    f.add_argument("--workers", type=int, default=3)
    f.add_argument("--limit", type=int)
    f.add_argument("--list", action="store_true")
    m = sub.add_parser("measure")
    m.add_argument("--redo", action="store_true")
    sub.add_parser("status")
    a = ap.parse_args(argv)
    if a.cmd == "sample":
        sample(a.n, a.seed, a.candidates, a.per_tile, a.box, a.append, a.undated_ok)
    elif a.cmd == "fetch":
        fetch(a.max_gb, a.workers, a.limit, a.list)
    elif a.cmd == "measure":
        measure(a.redo)
    else:
        status()


if __name__ == "__main__":
    main()
