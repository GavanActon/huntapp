"""The bush-thickness model at work: eye-level understory for an area with
no point cloud, predicted from what is seen from space (docs/BUSH-MODEL.md).

modelled(grid) runs features.py on the habitat lattice and the LightGBM
models in pipeline/bush/model/ over it: the understory NRD (0.5-3 m, the
LiDAR's measure) per cell, and its 20th and 80th percentiles, whose gap
is how sure the model is there. to_estimate() puts an NRD on the forest-map
estimate's 0-1 scale, the one the Spots scorer and the app read (thick at
0.7, open at 0.35), by the fixed curve NRD_TO_ESTIMATE: the HD areas'
calibrations (build_going.monotone_fit) put the estimate's 0.7 at NRD
0.44-0.59, and the understory map's own classes start "thick" at 0.45
(build_vegstructure.RAMP), so 0.45 it is. calib_header() is the same
curve as a bushCalib list, so build_going.py reads the NRD straight back
instead of guessing it through Pickle Lake's calibration.

    py -3.14 pipeline/bush/predict.py --area <id>      # a check: predicts the area's lattice and prints the shares
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

MODEL_DIR = HERE / "model"
# (NRD, estimate): piecewise linear, both ways monotone
NRD_TO_ESTIMATE = [(0.0, 0.0), (0.15, 0.20), (0.30, 0.45), (0.45, 0.70), (0.60, 0.85), (0.75, 0.95), (1.0, 1.0)]


def available() -> bool:
    return (MODEL_DIR / "bush_lgbm.txt").exists()


def to_estimate(nrd: np.ndarray) -> np.ndarray:
    xs, ys = zip(*NRD_TO_ESTIMATE)
    return np.interp(nrd, xs, ys).astype(np.float32)


def calib_header(cells: np.ndarray | None = None) -> list[list]:
    """bushCalib as build_going.py reads it: (estimate value, the NRD it
    stands for, cells), one row per knot of the curve."""
    n = int(cells.size) if cells is not None else 1000
    return [[float(e), float(v), max(1, n // len(NRD_TO_ESTIMATE))] for v, e in NRD_TO_ESTIMATE]


def modelled(grid, verbose: bool = True) -> dict:
    """NRD, its 20th and 80th percentiles and the model's notes, on the grid."""
    import lightgbm as lgb

    import features as F

    meta = json.loads((MODEL_DIR / "model.json").read_text(encoding="utf-8"))
    t0 = time.time()
    f = F.features(grid, verbose=verbose)
    table = F.table(f)
    names = F.feature_names()
    missing = [c for c in meta["features"] if c not in names]
    if missing:
        raise SystemExit(f"the model wants features features.py no longer makes ({missing}): train again")
    X = table[:, [names.index(c) for c in meta["features"]]]
    out = {}
    for key, fn in (("nrd", "bush_lgbm.txt"), ("q20", "bush_q20.txt"), ("q80", "bush_q80.txt")):
        m = lgb.Booster(model_file=str(MODEL_DIR / fn))
        out[key] = np.clip(m.predict(X), 0, 1).astype(np.float32).reshape(grid.shape)
    # no leaf-on imagery, no prediction
    seen = f["leafon_n"] >= 2
    for k in out:
        out[k][~seen] = np.nan
    out["notes"] = {
        "bushModel": {
            "trained": meta["date"],
            "plots": meta["plots"],
            "areas": meta.get("trained_on", {}).get("areas", []),
            "cvR": round(meta["cv_all"]["r"], 3),
            "cvR90m": round(meta["cv_all"].get("r90", float("nan")), 3),
            "cvAucThick": round(meta["cv_all"]["auc_thick"], 3),
            "s2Scenes": {s: int(np.nanmedian(f[f"{s}_n"])) for s in F.SEASONS},
            "seconds": round(time.time() - t0),
        }
    }
    if verbose:
        n = out["nrd"]
        ok = np.isfinite(n)
        print(f"  bush model: NRD mean {np.nanmean(n):.3f}, thick (>= 0.45) {100 * (n[ok] >= 0.45).mean():.0f}%, open (<= 0.24) {100 * (n[ok] <= 0.24).mean():.0f}%, spread q80-q20 median {np.nanmedian(out['q80'] - out['q20']):.3f}, {100 * ok.mean():.0f}% of cells seen, {time.time() - t0:.0f} s", flush=True)
    return out


def main(argv=None) -> None:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--area", required=True)
    a = ap.parse_args(argv)
    sys.argv = [sys.argv[0], "--area", a.area]
    sys.path.insert(0, str(HERE.parent))
    import rasterio

    import build_habitat as bh
    import features as F

    g = F.Grid("EPSG:4326", bh.TRANSFORM, bh.COLS, bh.ROWS)
    out = modelled(g)
    print(json.dumps(out["notes"], indent=1))


if __name__ == "__main__":
    main()
