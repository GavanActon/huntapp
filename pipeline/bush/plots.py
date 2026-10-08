"""Training plots for the bush-thickness model (docs/BUSH-MODEL.md): small
squares of Ontario's leaf-on LiDAR, chosen across the province, fetched in
part and measured the way an HD area is.

Ontario's FRI leaf-on SPL LiDAR covers 452,122 one-km tiles (the whole
managed forest, flown 2018-2025, every flight leaf-on). The model learns
the eye-level understory from what is seen from space, so its labels come
from here: for each plot, a PLOT_M square wholly inside one tile, the
COPC nodes meeting it are fetched (fetch_pointcloud.band_plan/fetch_band,
complete points over the square, nothing thinned) with the tile's 0.5 m
DEM, and the square's 10 m cells are measured with build_vegstructure's
own histogram and metrics (understory NRD 0.5-3 m, canopy height and
cover, density), so a plot's label is exactly an HD area's.

Plots are chosen in two stages. `sample` draws candidate squares at random
over the tiles, reads what the staged national rasters (stage.py: SCANFI,
CanLaD, land cover) say of each, and keeps a stratified pick: the strata
are years since a cut or burn, SCANFI's cover and lead species, and a
latitude band, each stratum capped so the young cuts, the shrub and the
wetlands the forest is short of are not swamped by mature spruce. The
pick is pipeline/raw/bush/plots.json; nothing is fetched yet.

    py -3.14 pipeline/bush/plots.py sample --n 320 --seed 7
    py -3.14 pipeline/bush/plots.py fetch --max-gb 40 [--workers 6]
    py -3.14 pipeline/bush/plots.py measure
    py -3.14 pipeline/bush/plots.py status

Output: pipeline/raw/bush/plots.json, pipeline/raw/bush/plots/<plot>/
        (<tile>.band.laz, <tile>_DEM.tif, metrics.npz with the 10 m grids
        in the tile's UTM CRS, transform, crs).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

BUSH = ROOT / "raw" / "bush"
PLOTS = BUSH / "plots.json"
PLOT_DIR = BUSH / "plots"
INDEX = ROOT / "raw" / "pointcloud" / "fri-index" / "tiles.npz"
PLOT_M = 300.0  # a plot's side: 30 x 30 cells of 10 m, 10 x 10 of 30 m
MARGIN_M = 20.0  # a plot stays this far inside its tile
UTM_EPSG = {15: 3159, 16: 3160, 17: 2958, 18: 2959}
LAZ_URL = "https://download.fri.mnrf.gov.on.ca/api/api/Download/laz/utm{zone}/{name}.copc.laz"
DEM_URL = "https://download.fri.mnrf.gov.on.ca/api/api/Download/geohub_compressed_dem/utm{zone}/{name}_DEM.tif"
STRATUM_NAMES = {
    10: "cut/burn 0-3 yr",
    11: "cut/burn 4-8",
    12: "cut/burn 9-25",
    13: "cut/burn 26-40",
    14: "cut/burn 40+",
    20: "spruce",
    21: "jack pine",
    22: "fir",
    23: "broadleaf",
    24: "white/red pine",
    25: "other conifer",
    26: "tamarack",
    27: "hardwood (>=50%)",
    31: "bryoid",
    32: "herb",
    33: "rock",
    34: "shrub",
    38: "bare",
}


def load_index() -> dict:
    z = np.load(INDEX)
    return {k: z[k] for k in z.files}


def plot_name(tile: str, ox: int, oy: int) -> str:
    return f"{tile}_{ox}_{oy}"


def tile_row(name: str, zone: int, x0: int, y0: int, year: int) -> dict:
    """A fetch_pointcloud index row for a tile, built from its name."""
    return {
        "Tilename": name,
        "Download_LAZ": LAZ_URL.format(zone=zone, name=name),
        "Download_DEM": DEM_URL.format(zone=zone, name=name),
        "zone": int(zone),
        "x0": int(x0),
        "y0": int(y0),
        "year": int(year),
    }


# ---- sample ------------------------------------------------------------------

STRATA_LAYERS = ("nfiLandcover", "closure", "height", "age", "dist_type", "dist_year", "landcover", "sp_blackSpruce", "sp_jackPine", "sp_balsamFir", "sp_broadleaf", "sp_whiteRedPine", "sp_otherConiferous", "sp_tamarack")


def strata_of(lons: np.ndarray, lats: np.ndarray) -> dict[str, np.ndarray]:
    """What the national rasters say at each candidate's centre: SCANFI
    cover class, closure, height, age, the species shares, CanLaD's
    disturbance type and year, the 2020 land cover."""
    import rasterio
    from rasterio.warp import transform as tf

    import stage

    src = stage.sources()
    box = (float(lons.min()) - 0.01, float(lats.min()) - 0.01, float(lons.max()) + 0.01, float(lats.max()) + 0.01)
    out = {}
    for k in STRATA_LAYERS:
        with rasterio.open(stage.source(src[k], box)) as ds:
            xs, ys = tf("EPSG:4326", ds.crs, lons.tolist(), lats.tolist())
            vals = np.array([v[0] for v in ds.sample(zip(xs, ys))], dtype=np.float32)
            if ds.nodata is not None:
                vals[vals == ds.nodata] = np.nan
        out[k] = vals
    return out


def sample(n: int, seed: int, candidates: int) -> None:
    rng = np.random.default_rng(seed)
    ix = load_index()
    N = len(ix["name"])
    pick = rng.choice(N, size=min(candidates, N), replace=False)
    inner = 1000 - PLOT_M - 2 * MARGIN_M
    ox = (MARGIN_M + rng.random(len(pick)) * inner).astype(int)
    oy = (MARGIN_M + rng.random(len(pick)) * inner).astype(int)
    from pyproj import Transformer

    lon = np.zeros(len(pick))
    lat = np.zeros(len(pick))
    for z in np.unique(ix["zone"][pick]):
        k = ix["zone"][pick] == z
        tr = Transformer.from_crs(f"EPSG:{UTM_EPSG[int(z)]}", "EPSG:4326", always_xy=True)
        lon[k], lat[k] = tr.transform(ix["x0"][pick][k] + ox[k] + PLOT_M / 2, ix["y0"][pick][k] + oy[k] + PLOT_M / 2)
    print(f"{len(pick)} candidate squares; reading the national rasters at each ...", flush=True)
    t = time.time()
    s = strata_of(lon, lat)
    print(f"  {time.time() - t:.0f} s")
    year = ix["year"][pick].astype(int)
    # years between the cut or burn and the flight (negative: after it)
    dist = np.where(np.isfinite(s["dist_year"]) & (s["dist_year"] > 1900), year - s["dist_year"], np.nan)
    since = np.full(len(pick), 5, int)  # 5: no disturbance on record
    since[(dist >= -1) & (dist <= 3)] = 0
    since[(dist > 3) & (dist <= 8)] = 1
    since[(dist > 8) & (dist <= 25)] = 2
    since[(dist > 25) & (dist <= 40)] = 3
    since[dist > 40] = 4
    since[dist < -1] = 6  # cut or burnt after the flight: a label of a forest that is gone
    # SCANFI's NFI land cover: 1 bryoid 2 herbs 3 rock 4 shrub 5 treed broadleaf 6 treed conifer 7 treed mixed 8 water
    cover = np.nan_to_num(s["nfiLandcover"], nan=0).astype(int)
    treed = np.isin(cover, (5, 6, 7))
    sp = np.stack([np.nan_to_num(s[k]) for k in ("sp_blackSpruce", "sp_jackPine", "sp_balsamFir", "sp_broadleaf", "sp_whiteRedPine", "sp_otherConiferous", "sp_tamarack")])
    lead = np.where(sp.sum(0) > 0, sp.argmax(0), 7)
    hard = np.nan_to_num(s["sp_broadleaf"]) >= 50
    latband = np.digitize(lat, [46.5, 48.5, 50.0])
    keep = (since != 6) & (cover != 8) & (cover != 0)
    key = np.where(treed, np.where(since < 5, 10 + since, 20 + np.where(hard, 7, lead)), 30 + cover)
    print(f"  {keep.sum()} usable candidates")
    # quotas by stratum, as shares of n: the regrowth sequence and the
    # non-treed classes are rare on the ground and over-drawn here; within a
    # stratum the latitude bands are filled in turn
    quota = {10: 0.09, 11: 0.09, 12: 0.10, 13: 0.09, 14: 0.03, 20: 0.09, 21: 0.07, 22: 0.05, 23: 0.05, 24: 0.03, 25: 0.03, 26: 0.03, 27: 0.09, 31: 0.02, 32: 0.04, 33: 0.02, 34: 0.07, 38: 0.01}
    chosen: list[int] = []
    short = 0
    for k, q in quota.items():
        want = int(round(q * n))
        bands = [rng.permutation(np.flatnonzero(keep & (key == k) & (latband == b))).tolist() for b in range(4)]
        got: list[int] = []
        while len(got) < want and any(bands):
            for b in bands:
                if b and len(got) < want:
                    got.append(b.pop())
        if len(got) < want:
            print(f"  stratum {STRATUM_NAMES.get(k, k)}: {len(got)} of {want} wanted")
            short += want - len(got)
        chosen.extend(got)
    if short:  # top up from the mature treed strata, at random
        pool = [i for i in np.flatnonzero(keep & treed & (since == 5)) if i not in set(chosen)]
        chosen.extend(rng.choice(pool, size=min(short, len(pool)), replace=False).tolist())
    chosen = sorted(set(chosen))
    rows = []
    for i in chosen:
        j = int(pick[i])
        rows.append(
            {
                "plot": plot_name(str(ix["name"][j]), int(ox[i]), int(oy[i])),
                "tile": tile_row(str(ix["name"][j]), int(ix["zone"][j]), int(ix["x0"][j]), int(ix["y0"][j]), int(ix["year"][j])),
                "x0": int(ix["x0"][j] + ox[i]),
                "y0": int(ix["y0"][j] + oy[i]),
                "side_m": PLOT_M,
                "crs": f"EPSG:{UTM_EPSG[int(ix['zone'][j])]}",
                "lon": round(float(lon[i]), 5),
                "lat": round(float(lat[i]), 5),
                "year": int(year[i]),
                "stratum": STRATUM_NAMES.get(int(key[i]), str(int(key[i]))),
                "latband": int(latband[i]),
                "scanfi": {k: (None if not np.isfinite(s[k][i]) else round(float(s[k][i]), 1)) for k in ("nfiLandcover", "closure", "height", "age", "dist_type", "dist_year", "landcover")},
            }
        )
    BUSH.mkdir(parents=True, exist_ok=True)
    PLOTS.write_text(json.dumps(rows, indent=1), encoding="utf-8")
    from collections import Counter

    print(f"{len(rows)} plots -> {PLOTS}")
    for k, c in sorted(Counter(r["stratum"] for r in rows).items()):
        print(f"  {c:4d}  {k}")
    for k, c in sorted(Counter(r["latband"] for r in rows).items()):
        print(f"  lat band {k}: {c}")


# ---- fetch -------------------------------------------------------------------


def plot_dir(r: dict) -> Path:
    return PLOT_DIR / r["plot"]


def fetched(r: dict) -> bool:
    d = plot_dir(r)
    return (d / f"{r['tile']['Tilename']}.band.laz").exists() and (d / f"{r['tile']['Tilename']}_DEM.tif").exists()


def fetch(max_gb: float, workers: int, limit: int | None, list_only: bool) -> None:
    import fetch_pointcloud as fp
    from shapely.geometry import box

    rows = json.loads(PLOTS.read_text(encoding="utf-8"))
    todo = [r for r in rows if not fetched(r)]
    if limit:
        todo = todo[:limit]
    print(f"{len(rows)} plots, {sum(fetched(r) for r in rows)} fetched, {len(todo)} to fetch")
    if not todo:
        return
    t0 = time.time()
    got = 0
    for i, r in enumerate(todo):
        d = plot_dir(r)
        d.mkdir(parents=True, exist_ok=True)
        tr = r["tile"]
        sq = box(r["x0"], r["y0"], r["x0"] + r["side_m"], r["y0"] + r["side_m"])
        try:
            plan = fp.band_plan(tr, sq)
        except SystemExit as e:
            print(f"  {r['plot']}: no index ({e}); skipped", flush=True)
            continue
        dem_bytes = fp.head_size(tr["Download_DEM"])
        print(f"[{i + 1}/{len(todo)}] {r['plot']} ({r['stratum']}, {r['lat']:.2f}N) · {plan['bytes'] / 1e6:.0f} MB of points in {len(plan['nodes'])} nodes · DEM {dem_bytes / 1e6:.0f} MB", flush=True)
        if list_only:
            got += plan["bytes"] + dem_bytes
            continue
        if (got + plan["bytes"] + dem_bytes) / 1e9 > max_gb:
            print(f"stopping at --max-gb {max_gb}")
            break
        fp.download(tr["Download_DEM"], d / f"{tr['Tilename']}_DEM.tif", dem_bytes)
        # the signed blob URL lapses on a slow tile (400/403 on a range): plan
        # again for a fresh one and carry on; the batches fetched so far are kept
        for attempt in range(4):
            try:
                got += fp.fetch_band(tr, plan, d / f"{tr['Tilename']}.band.laz", workers) + dem_bytes
                break
            except SystemExit as e:
                if attempt == 3:
                    print(f"  {r['plot']}: gave up ({e}); next plot", flush=True)
                    break
                print(f"  {r['plot']}: {e}; signing the url again", flush=True)
                time.sleep(5)
                plan = fp.band_plan(tr, sq)
        el = time.time() - t0
        print(f"  done · {got / 1e6:.0f} MB in {el:.0f} s ({got / 1e6 / max(el, 1):.1f} MB/s)", flush=True)
    print(f"{'would fetch' if list_only else 'fetched'} {got / 1e9:.2f} GB")


# ---- measure -----------------------------------------------------------------


def measure_one(r: dict) -> dict:
    """The plot's 10 m metric grids, from its band LAZ and DEM, exactly as
    build_vegstructure.tile_metrics_dem measures a tile, cut to the square,
    with the floors an area applies (density, land share, returns reaching
    3 m)."""
    import build_vegstructure as bv
    from rasterio.transform import from_origin

    d = plot_dir(r)
    name = r["tile"]["Tilename"]
    tb = (r["tile"]["x0"], r["tile"]["y0"], r["tile"]["x0"] + 1000, r["tile"]["y0"] + 1000)
    t = {"laz": d / f"{name}.band.laz", "dem": d / f"{name}_DEM.tif", "bounds": tb, "drop": bv.NOISE}
    m = bv.tile_metrics_dem(t)
    # the tile's 10 m cells wholly inside the square (the fetch kept those
    # alone); a square not on the 10 m lattice loses a row and a column
    c0 = int(np.ceil((r["x0"] - tb[0]) / bv.CELL))
    c1 = int(np.floor((r["x0"] + r["side_m"] - tb[0]) / bv.CELL))
    r0 = int(np.ceil((tb[3] - (r["y0"] + r["side_m"])) / bv.CELL))
    r1 = int(np.floor((tb[3] - r["y0"]) / bv.CELL))
    sl = (slice(r0, r1), slice(c0, c1))
    x_w, y_n = tb[0] + c0 * bv.CELL, tb[3] - r0 * bv.CELL
    out: dict = {}
    for k in ("density", "canopy_height", "canopy_cover", "understory", "understory_pad", "water_frac", "n_reach"):
        out[k] = np.array(m[k][sl], dtype=np.float32)
    out["strata"] = m["strata"][(slice(None),) + sl]
    land = (1 - out["water_frac"]) >= bv.MIN_LAND
    ok = land & (out["density"] >= bv.MIN_DENSITY)
    reach = ok & (out["n_reach"] >= bv.MIN_REACH)
    out["understory"][~reach] = np.nan
    out["understory_pad"][~reach] = np.nan
    for k in ("canopy_height", "canopy_cover", "density"):
        out[k][~ok] = np.nan
    out["transform"] = np.array(from_origin(x_w, y_n, bv.CELL, bv.CELL))[:6]
    out["crs"] = np.array(r["crs"])
    out["raw_points"] = m["raw_points"]
    np.savez_compressed(d / "metrics.npz", **out)
    u = out["understory"]
    h = out["canopy_height"]
    return {"plot": r["plot"], "cells": int(np.isfinite(u).sum()), "nrd": float(np.nanmean(u)) if np.isfinite(u).any() else None, "height": float(np.nanmean(h)) if np.isfinite(h).any() else None}


def measure(redo: bool) -> None:
    rows = json.loads(PLOTS.read_text(encoding="utf-8"))
    todo = [r for r in rows if fetched(r) and (redo or not (plot_dir(r) / "metrics.npz").exists())]
    print(f"{len(todo)} plots to measure")
    t0 = time.time()
    for i, r in enumerate(todo):
        s = measure_one(r)
        nrd = "-" if s["nrd"] is None else f"{s['nrd']:.3f}"
        ht = "-" if s["height"] is None else f"{s['height']:.1f} m"
        print(f"[{i + 1}/{len(todo)}] {s['plot']} ({r['stratum']}): {s['cells']} cells, NRD {nrd}, height {ht} · {time.time() - t0:.0f} s", flush=True)


def status() -> None:
    rows = json.loads(PLOTS.read_text(encoding="utf-8"))
    f = sum(fetched(r) for r in rows)
    m = sum((plot_dir(r) / "metrics.npz").exists() for r in rows)
    print(f"{len(rows)} plots, {f} fetched, {m} measured")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sample")
    s.add_argument("--n", type=int, default=320)
    s.add_argument("--seed", type=int, default=7)
    s.add_argument("--candidates", type=int, default=6000)
    f = sub.add_parser("fetch")
    f.add_argument("--max-gb", type=float, default=40.0)
    f.add_argument("--workers", type=int, default=6)
    f.add_argument("--limit", type=int)
    f.add_argument("--list", action="store_true")
    m = sub.add_parser("measure")
    m.add_argument("--redo", action="store_true")
    sub.add_parser("status")
    a = ap.parse_args(argv)
    if a.cmd == "sample":
        sample(a.n, a.seed, a.candidates)
    elif a.cmd == "fetch":
        fetch(a.max_gb, a.workers, a.limit, a.list)
    elif a.cmd == "measure":
        measure(a.redo)
    else:
        status()


if __name__ == "__main__":
    main()
