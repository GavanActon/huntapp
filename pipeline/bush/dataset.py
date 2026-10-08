"""The training table for the bush-thickness model: every measured plot and
every HD area, as 30 m cells with their LiDAR labels and satellite features.

A plot's 10 m metrics (plots.py measure) are pooled 3 x 3 into 30 m cells:
the label is the mean understory NRD of the cells that have one (at least
5 of the 9, else no label), with the mean plant area density, canopy
height and cover, the land share and the LiDAR year beside it. The
features (features.py) are read on the same 30 m grid. The three HD areas
go in the same way from their vegstructure grids, each as one block, so
the model can be tested on whole areas it never saw, Lac Bailey's Quebec
linear-mode LiDAR among them.

    py -3.14 pipeline/bush/dataset.py plots [--watch]   # the plots measured so far; --watch keeps going until all are done
    py -3.14 pipeline/bush/dataset.py area pickle-lake   # one HD area
    py -3.14 pipeline/bush/dataset.py status

Output: pipeline/raw/bush/features/<plot>.npz and area-<id>.npz, each with
        X (cells x features), the label arrays, lon, lat, and the grid.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import rasterio

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))

BUSH = ROOT / "raw" / "bush"
FEAT = BUSH / "features"
MIN_CELLS = 5  # of 9 with an understory value
AREA_YEARS = {"pickle-lake": 2021, "sault-test": 2021, "lac-bailey": 2024}
PARALLEL = 4


def pool3(a: np.ndarray, fn=np.nanmean) -> np.ndarray:
    H, W = a.shape[-2], a.shape[-1]
    H3, W3 = (H // 3) * 3, (W // 3) * 3
    b = a[..., :H3, :W3].reshape(*a.shape[:-2], H3 // 3, 3, W3 // 3, 3)
    with np.errstate(all="ignore"):
        return fn(b, axis=(-3, -1))


def labels_from(z: dict, year: int) -> dict[str, np.ndarray]:
    """30 m labels from a 10 m metrics bundle (plots' metrics.npz or an
    area's vegstructure npz, which share their keys)."""
    u = np.array(z["understory"], np.float32)
    nod = float(z["nodata"]) if "nodata" in z else None  # an area's npz marks nodata; a plot's uses NaN
    fin = np.isfinite(u) & ((u != nod) if nod is not None else True)
    u = np.where(fin, u, np.nan)
    n = pool3(fin.astype(np.float32), np.sum)
    out = {"nrd": pool3(u), "nrd_n": n}
    for k, name in (("understory_pad", "pad"), ("canopy_height", "canopy_height"), ("canopy_cover", "canopy_cover"), ("density", "density")):
        a = np.array(z[k], np.float32)
        a = np.where(np.isfinite(a) & ((a != nod) if nod is not None else True) & (a >= 0), a, np.nan)
        out[name] = pool3(a)
    wf = np.array(z["water_frac"], np.float32)
    wf = np.where(np.isfinite(wf) & (wf >= 0), wf, np.nan)
    out["land"] = 1 - np.nan_to_num(pool3(wf), nan=0.0)
    out["nrd"][n < MIN_CELLS] = np.nan
    out["year"] = np.full(out["nrd"].shape, year, np.float32)
    return out


def grid30(z: dict):
    import features as F

    tr = rasterio.Affine(*z["transform"])
    H, W = np.array(z["understory"]).shape
    g10 = F.Grid(str(z["crs"]), tr, W, H)
    return g10.coarsened(3)


def build_one(name: str, metrics_path: Path, year: int, out_path: Path, verbose: bool = False) -> dict:
    import features as F

    z = np.load(metrics_path, allow_pickle=True)
    zd = {k: z[k] for k in z.files}
    g = grid30(zd)
    lab = labels_from(zd, year)
    t = time.time()
    f = F.features(g, verbose=verbose)
    X = F.table(f)
    FEAT.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out_path,
        X=X,
        names=np.array(F.feature_names()),
        lon=f["lon"].ravel(),
        lat=f["lat"].ravel(),
        crs=np.array(g.crs),
        transform=np.array(g.transform)[:6],
        shape=np.array(g.shape),
        s2_n=np.stack([f[f"{s}_n"].ravel() for s in F.SEASONS], 1),
        **{k: v.ravel() for k, v in lab.items()},
    )
    ok = np.isfinite(lab["nrd"])
    return {"name": name, "cells": int(ok.sum()), "nrd": float(np.nanmean(lab["nrd"])) if ok.any() else None, "seconds": time.time() - t}


def source_of(r: dict):
    """The module that fetches and measures a plot: plots.py for Ontario's
    COPC tiles, north.py for LidarBC's (plots-north.json)."""
    if r.get("source") == "lidarbc":
        import north as N

        return N
    import plots as P

    return P


def all_plots() -> list[dict]:
    """Ontario's plots and the northern ones, in one list."""
    import north as N
    import plots as P

    rows = json.loads(P.PLOTS.read_text(encoding="utf-8")) if P.PLOTS.exists() else []
    if N.PLOTS.exists():
        rows += json.loads(N.PLOTS.read_text(encoding="utf-8"))
    return rows


def plot_job(r: dict) -> dict:
    S = source_of(r)
    return build_one(r["plot"], S.plot_dir(r) / "metrics.npz", r["year"], FEAT / f"{r['plot']}.npz")


def do_plots(watch: bool) -> None:
    rows = all_plots()
    t0 = time.time()
    done = 0
    while True:
        # measure what is fetched and not measured, then featurise what is measured and not featurised
        for r in rows:
            P = source_of(r)
            if P.fetched(r) and not (P.plot_dir(r) / "metrics.npz").exists():
                try:
                    s = P.measure_one(r)
                    print(f"measured {s['plot']}: {s['cells']} cells, NRD {s['nrd'] if s['nrd'] is None else round(s['nrd'], 3)}", flush=True)
                except Exception as e:  # noqa: BLE001
                    print(f"measure failed {r['plot']}: {str(e)[:100]}", flush=True)
        todo = [r for r in rows if (source_of(r).plot_dir(r) / "metrics.npz").exists() and not (FEAT / f"{r['plot']}.npz").exists()]
        if todo:
            with ProcessPoolExecutor(PARALLEL) as ex:
                futs = {ex.submit(plot_job, r): r for r in todo}
                for fu in as_completed(futs):
                    r = futs[fu]
                    try:
                        s = fu.result()
                        done += 1
                        nrd = "-" if s["nrd"] is None else f"{s['nrd']:.3f}"
                        print(f"[{done}] {s['name']} ({r['stratum']}): {s['cells']} labelled cells, NRD {nrd}, {s['seconds']:.0f} s · {time.time() - t0:.0f} s", flush=True)
                    except Exception as e:  # noqa: BLE001
                        print(f"features failed {r['plot']}: {str(e)[:120]}", flush=True)
        have = sum((FEAT / f"{r['plot']}.npz").exists() for r in rows)
        if not watch or have >= len(rows):
            break
        fetch_done = (BUSH / "fetch.log").exists() and "fetched " in (BUSH / "fetch.log").read_text(encoding="utf-8", errors="ignore")[-400:]
        if fetch_done and not todo and have == sum(source_of(r).fetched(r) for r in rows):
            break
        time.sleep(60)
    print(f"{sum((FEAT / f'{r['plot']}.npz').exists() for r in rows)} of {len(rows)} plots have features")


def do_area(area_id: str) -> None:
    src = ROOT / "raw" / f"vegstructure-{area_id}.npz"
    s = build_one(f"area-{area_id}", src, AREA_YEARS[area_id], FEAT / f"area-{area_id}.npz", verbose=True)
    print(f"{s['name']}: {s['cells']} labelled cells, NRD {s['nrd']:.3f}, {s['seconds']:.0f} s")


def status() -> None:
    rows = all_plots()
    f = sum(source_of(r).fetched(r) for r in rows)
    m = sum((source_of(r).plot_dir(r) / "metrics.npz").exists() for r in rows)
    x = sum((FEAT / f"{r['plot']}.npz").exists() for r in rows)
    areas = sorted(p.name for p in FEAT.glob("area-*.npz")) if FEAT.exists() else []
    print(f"{len(rows)} plots: {f} fetched, {m} measured, {x} with features; areas: {areas}")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plots")
    p.add_argument("--watch", action="store_true")
    a = sub.add_parser("area")
    a.add_argument("id")
    sub.add_parser("status")
    args = ap.parse_args(argv)
    if args.cmd == "plots":
        do_plots(args.watch)
    elif args.cmd == "area":
        do_area(args.id)
    else:
        status()


if __name__ == "__main__":
    main()
