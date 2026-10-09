"""Train and test the bush-thickness model (docs/BUSH-MODEL.md): LightGBM
on the 30 m cells of dataset.py, the label the LiDAR's understory NRD,
the features what is seen from space.

The test is spatial, never random: the plots are clustered into K blocks
by position and each block is predicted by a model that never saw it
(grouped K-fold), so the score is for ground the model has not been to.
The three HD areas are held out whole on top of that: each is predicted
by a model trained on the plots alone, Lac Bailey testing the transfer to
Quebec's linear-mode LiDAR. A second model with the national rasters and
terrain only (no imagery, no radar) says what the imagery adds.

Scores: r and RMSE on the cell's NRD, the same at 90 m (3 x 3 cells
pooled), and the AUC for thick (NRD >= THICK) and open (NRD <= OPEN),
the two classes the Spots scorer acts on.

    py -3.14 pipeline/bush/train.py [--quick] [--no-areas-in-final]

Output: pipeline/bush/model/bush_lgbm.txt (the model), bush_q20.txt and
        bush_q80.txt (the 20th and 80th percentile models, the spread),
        model.json (features, scores, what it was trained on).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

BUSH = ROOT / "raw" / "bush"
FEAT = BUSH / "features"
MODEL_DIR = HERE / "model"
THICK, OPEN = 0.45, 0.24  # NRD: thick (the estimate's 0.7) and open (its 0.35), docs/BUSH-MODEL.md
MIN_LAND = 0.75
CATEGORICAL = ["nfiLandcover", "dist_type", "landcover"]
NATIONAL_ONLY = [
    "sp_blackSpruce", "sp_balsamFir", "sp_jackPine", "sp_whiteRedPine", "sp_tamarack", "sp_lodgepolePine", "sp_douglasFir", "sp_ponderosaPine", "sp_otherConiferous", "sp_broadleaf",
    "closure", "height", "age", "nfiLandcover", "dist_type", "since_dist", "landcover", "elev", "slope", "tpi300", "tpi1000", "lat", "lon",
]
K_BLOCKS = 8
EXCLUDE = ("lat", "lon")  # position: 180 plots in, the model without it scored r 0.52 against 0.42 on blocks it never saw
AREA_AS_PLOTS = 40  # an HD area weighs as much as this many plots in the final model
CELLS_PER_PLOT = 81
AREAS = ("pickle-lake", "sault-test", "lac-bailey")
REF_YEAR = 2025


def load(names_filter=None) -> tuple[dict, list[str]]:
    """Every feature file as one table: X, y and the per-cell bookkeeping."""
    files = sorted(FEAT.glob("*.npz"))
    parts = []
    names = None
    for p in files:
        z = np.load(p, allow_pickle=True)
        if names is None:
            names = list(z["names"])
        X = z["X"]
        y = z["nrd"]
        ok = np.isfinite(y) & (z["land"] >= MIN_LAND)
        # a cut or burn after the flight: the label is of a forest that is gone
        since = X[:, names.index("since_dist")]
        dist_year = np.where(since < 99, REF_YEAR - since, 0)
        ok &= ~(dist_year > z["year"])
        # no leaf-on imagery: nothing to see
        ok &= z["s2_n"][:, 0] >= 2
        if not ok.any():
            continue
        src = p.stem
        H, W = z["shape"]
        rr, cc = np.divmod(np.arange(len(y)), int(W))
        parts.append(
            {
                "X": X[ok],
                "y": y[ok],
                "n": z["nrd_n"][ok],
                "height": z["canopy_height"][ok],
                "lon": z["lon"][ok],
                "lat": z["lat"][ok],
                "src": np.full(ok.sum(), src),
                "block90": np.array([f"{src}:{r // 3}:{c // 3}" for r, c in zip(rr[ok], cc[ok])]),
            }
        )
    out = {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}
    out["is_area"] = np.array([s.startswith("area-") for s in out["src"]])
    return out, names


def pooled90(block: np.ndarray, *cols: np.ndarray) -> list[np.ndarray]:
    """Means over the 90 m blocks (3 x 3 cells of one source)."""
    keys, inv = np.unique(block, return_inverse=True)
    cnt = np.bincount(inv)
    return [np.bincount(inv, weights=c) / cnt for c in cols]


def auc(y_true: np.ndarray, score: np.ndarray) -> float:
    from sklearn.metrics import roc_auc_score

    if y_true.all() or not y_true.any():
        return float("nan")
    return float(roc_auc_score(y_true, score))


def scores(y: np.ndarray, p: np.ndarray, block: np.ndarray | None = None) -> dict:
    ok = np.isfinite(p) & np.isfinite(y)
    y, p = y[ok], p[ok]
    out = {
        "n": int(len(y)),
        "r": float(np.corrcoef(y, p)[0, 1]) if len(y) > 2 else float("nan"),
        "rmse": float(np.sqrt(np.mean((y - p) ** 2))),
        "mae": float(np.mean(np.abs(y - p))),
        "bias": float(np.mean(p - y)),
        "auc_thick": auc(y >= THICK, p),
        "auc_open": auc(y <= OPEN, -p),
        "thick_share": float((y >= THICK).mean()),
    }
    if block is not None:
        y9, p9 = pooled90(block[ok], y, p)
        out["r90"] = float(np.corrcoef(y9, p9)[0, 1]) if len(y9) > 2 else float("nan")
        out["rmse90"] = float(np.sqrt(np.mean((y9 - p9) ** 2)))
    return out


def params(quick: bool) -> dict:
    return {
        "objective": "huber",
        "alpha": 0.9,
        "learning_rate": 0.03,
        "num_leaves": 31,
        "min_data_in_leaf": 60,
        "feature_fraction": 0.6,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "lambda_l2": 2.0,
        "max_bin": 255,
        "verbose": -1,
        "num_threads": 8,
        "seed": 11,
    }


def fit(X, y, names, cols, quick, X_val=None, y_val=None, objective=None, alpha=None, w=None):
    import lightgbm as lgb

    idx = [names.index(c) for c in cols]
    cat = [cols.index(c) for c in CATEGORICAL if c in cols]
    p = params(quick)
    if objective:
        p["objective"] = objective
        p["alpha"] = alpha
    rounds = 300 if quick else 2500
    ds = lgb.Dataset(X[:, idx], y, weight=w, feature_name=cols, categorical_feature=cat, free_raw_data=False)
    if X_val is not None:
        dv = lgb.Dataset(X_val[:, idx], y_val, reference=ds)
        m = lgb.train(p, ds, rounds, valid_sets=[dv], callbacks=[lgb.early_stopping(150, verbose=False)])
    else:
        m = lgb.train(p, ds, rounds)
    return m, idx


def predict(m, idx, X):
    return m.predict(X[:, idx], num_iteration=m.best_iteration or None)


def blocks(d: dict) -> np.ndarray:
    """A spatial block per plot cell: the plots clustered by position."""
    from sklearn.cluster import KMeans

    plots = ~d["is_area"]
    srcs, inv = np.unique(d["src"][plots], return_inverse=True)
    cen = np.stack([np.bincount(inv, weights=d["lon"][plots]) / np.bincount(inv), np.bincount(inv, weights=d["lat"][plots]) / np.bincount(inv)], 1)
    km = KMeans(K_BLOCKS, n_init=10, random_state=3).fit(cen * [np.cos(np.radians(49)), 1.0])
    lab = np.full(len(d["y"]), -1)
    lab[plots] = km.labels_[inv]
    return lab


def cv(d: dict, names: list[str], cols: list[str], quick: bool, label: str) -> tuple[dict, np.ndarray]:
    """Grouped K-fold over the plots' spatial blocks: out-of-fold predictions."""
    plots = ~d["is_area"]
    blk = d["block"]
    oof = np.full(len(d["y"]), np.nan)
    t = time.time()
    rounds = []
    for b in sorted(set(blk[plots])):
        tr = plots & (blk != b)
        te = plots & (blk == b)
        # early stopping on a slice of the training blocks, never the test
        hold = tr & (blk == sorted(set(blk[tr]))[0])
        m, idx = fit(d["X"][tr & ~hold], d["y"][tr & ~hold], names, cols, quick, d["X"][hold], d["y"][hold])
        oof[te] = predict(m, idx, d["X"][te])
        rounds.append(m.best_iteration)
    s = scores(d["y"][plots], oof[plots], d["block90"][plots])
    s["rounds"] = rounds
    print(f"  {label}: r {s['r']:.3f} (90 m {s['r90']:.3f}), RMSE {s['rmse']:.3f}, AUC thick {s['auc_thick']:.3f} open {s['auc_open']:.3f}, n {s['n']}, {time.time() - t:.0f} s", flush=True)
    return s, oof


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--no-areas-in-final", action="store_true")
    a = ap.parse_args(argv)
    t0 = time.time()
    d, names = load()
    d["block"] = blocks(d)
    plots = ~d["is_area"]
    n_plots = len(set(d["src"][plots]))
    print(f"{len(d['y'])} cells: {plots.sum()} from {n_plots} plots, {(~plots).sum()} from areas; NRD mean {d['y'].mean():.3f}, thick {(d['y'] >= THICK).mean():.2f}, open {(d['y'] <= OPEN).mean():.2f}")
    for b in range(K_BLOCKS):
        k = plots & (d["block"] == b)
        print(f"  block {b}: {len(set(d['src'][k]))} plots, {k.sum()} cells, lon {d['lon'][k].mean():.1f} lat {d['lat'][k].mean():.1f}")
    report: dict = {"date": str(date.today()), "cells": int(len(d["y"])), "plots": n_plots, "thick_nrd": THICK, "open_nrd": OPEN}

    cols = [c for c in names if c not in EXCLUDE]
    print("cross-validation over spatial blocks of plots")
    report["cv_all"], oof_all = cv(d, names, cols, a.quick, "the model's features")
    report["cv_national"], _ = cv(d, names, [c for c in NATIONAL_ONLY if c not in EXCLUDE], a.quick, "national rasters + terrain only")
    report["cv_no_palsar"], _ = cv(d, names, [c for c in cols if not c.startswith("palsar")], a.quick, "without PALSAR")
    report["cv_with_latlon"], _ = cv(d, names, names, a.quick, "with lat/lon too")
    report["cv_no_snow"], _ = cv(d, names, [c for c in cols if "snow" not in c], a.quick, "without the snow season")
    report["cv_no_texture"], _ = cv(d, names, [c for c in cols if not c.endswith("_nir_sd")], a.quick, "without texture")

    print("per stratum, out of fold (all features)")
    rows = json.loads((BUSH / "plots.json").read_text(encoding="utf-8"))
    if (BUSH / "plots-north.json").exists():  # the northern BC plots (north.py)
        rows += json.loads((BUSH / "plots-north.json").read_text(encoding="utf-8"))
    stratum = {r["plot"]: r["stratum"] for r in rows}
    st = np.array([stratum.get(s, "?") for s in d["src"]])
    report["cv_by_stratum"] = {}
    for s in sorted(set(st[plots])):
        k = plots & (st == s)
        sc = scores(d["y"][k], oof_all[k])
        report["cv_by_stratum"][s] = sc
        print(f"  {s:18s} n {sc['n']:6d}  NRD {d['y'][k].mean():.2f}  r {sc['r']:.2f}  RMSE {sc['rmse']:.3f}  bias {sc['bias']:+.3f}")

    # the northern BC plots (north.py, names bc_*): what the north gets from a
    # model that never left Ontario, and what the folds give it with its own
    # plots in training (a far cluster is its own block, so it is still
    # predicted by a model that never saw it)
    north = plots & np.array([s.startswith("bc_") for s in d["src"]])
    if north.any():
        print(f"the northern plots ({len(set(d['src'][north]))} plots, {north.sum()} cells; NRD mean {d['y'][north].mean():.3f}, thick {(d['y'][north] >= THICK).mean():.2f}, open {(d['y'][north] <= OPEN).mean():.2f})")
        sc = scores(d["y"][north], oof_all[north], d["block90"][north])
        print(f"  in the spatial folds:      r {sc['r']:.3f} (90 m {sc['r90']:.3f})  RMSE {sc['rmse']:.3f}  bias {sc['bias']:+.3f}  AUC thick {sc['auc_thick']:.3f} open {sc['auc_open']:.3f}")
        m_on, idx_on = fit(d["X"][plots & ~north], d["y"][plots & ~north], names, cols, a.quick)
        sc2 = scores(d["y"][north], predict(m_on, idx_on, d["X"][north]), d["block90"][north])
        print(f"  Ontario's plots alone:     r {sc2['r']:.3f} (90 m {sc2['r90']:.3f})  RMSE {sc2['rmse']:.3f}  bias {sc2['bias']:+.3f}  AUC thick {sc2['auc_thick']:.3f} open {sc2['auc_open']:.3f}")
        report["north"] = {"in_folds": sc, "ontario_alone": sc2, "plots": len(set(d["src"][north]))}
    # Atlin's (map sheet 104K, LidarBC's 2021 programme): the coast-to-interior
    # spruce-willow-birch nearest Blanchard River, held out whole. 14 plots
    # there measured thick (NRD 0.48) where the model called Blanchard open
    # (0.15), outvoted by the Peace-Liard's open ground; 88 more were drawn
    # 2026-10-09 (Gavan: "LiDAR training plots from similar high country").
    # Its score held out says whether the rest carry there
    atlin = plots & np.array([s.startswith("bc_104k") for s in d["src"]])
    if atlin.any():
        print(f"Atlin's plots ({len(set(d['src'][atlin]))} plots, {atlin.sum()} cells; NRD mean {d['y'][atlin].mean():.3f}, thick {(d['y'][atlin] >= THICK).mean():.2f}, open {(d['y'][atlin] <= OPEN).mean():.2f})")
        m_x, idx_x = fit(d["X"][plots & ~atlin], d["y"][plots & ~atlin], names, cols, a.quick)
        sc3 = scores(d["y"][atlin], predict(m_x, idx_x, d["X"][atlin]), d["block90"][atlin])
        print(f"  held out whole:            r {sc3['r']:.3f} (90 m {sc3['r90']:.3f})  RMSE {sc3['rmse']:.3f}  bias {sc3['bias']:+.3f}  AUC thick {sc3['auc_thick']:.3f} open {sc3['auc_open']:.3f}")
        sc4 = scores(d["y"][atlin], oof_all[atlin], d["block90"][atlin])
        print(f"  in the spatial folds:      r {sc4['r']:.3f} (90 m {sc4['r90']:.3f})  RMSE {sc4['rmse']:.3f}  bias {sc4['bias']:+.3f}  AUC thick {sc4['auc_thick']:.3f} open {sc4['auc_open']:.3f}")
        report["atlin"] = {"held_out": sc3, "in_folds": sc4, "plots": len(set(d["src"][atlin]))}

    print("the HD areas, held out whole (trained on the plots alone)")
    m_plots, idx = fit(d["X"][plots], d["y"][plots], names, cols, a.quick)
    report["areas"] = {}
    for area in AREAS:
        k = d["src"] == f"area-{area}"
        if not k.any():
            continue
        p = predict(m_plots, idx, d["X"][k])
        sc = scores(d["y"][k], p, d["block90"][k])
        report["areas"][area] = sc
        print(f"  {area:12s} n {sc['n']:7d}  r {sc['r']:.3f} (90 m {sc['r90']:.3f})  RMSE {sc['rmse']:.3f}  bias {sc['bias']:+.3f}  AUC thick {sc['auc_thick']:.3f} open {sc['auc_open']:.3f}  thick share {sc['thick_share']:.2f}")
    # the areas with the other areas also in training (leave one area out)
    report["areas_loo"] = {}
    for area in AREAS:
        k = d["src"] == f"area-{area}"
        if not k.any():
            continue
        tr = ~k
        m, idx2 = fit(d["X"][tr], d["y"][tr], names, cols, a.quick)
        sc = scores(d["y"][k], predict(m, idx2, d["X"][k]), d["block90"][k])
        report["areas_loo"][area] = sc
        print(f"  {area:12s} with the other areas in training: r {sc['r']:.3f} (90 m {sc['r90']:.3f})  RMSE {sc['rmse']:.3f}  bias {sc['bias']:+.3f}")

    print("the final model")
    final = np.ones(len(d["y"]), bool) if not a.no_areas_in_final else plots
    w = np.ones(len(d["y"]), np.float32)
    for area in AREAS:
        k = d["src"] == f"area-{area}"
        if k.any():
            w[k] = min(1.0, AREA_AS_PLOTS * CELLS_PER_PLOT / k.sum())
    m_final, idx = fit(d["X"][final], d["y"][final], names, cols, a.quick, w=w[final])
    imp = sorted(zip(cols, m_final.feature_importance("gain")), key=lambda t: -t[1])
    tot = sum(g for _, g in imp)
    report["importance"] = [(n, float(g / tot)) for n, g in imp]
    print("  top features by gain: " + ", ".join(f"{n} {100 * g / tot:.1f}%" for n, g in imp[:20]))
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    m_final.save_model(str(MODEL_DIR / "bush_lgbm.txt"))
    for q in (0.2, 0.8):
        mq, _ = fit(d["X"][final], d["y"][final], names, cols, a.quick, objective="quantile", alpha=q, w=w[final])
        mq.save_model(str(MODEL_DIR / f"bush_q{int(q * 100)}.txt"))
    report["features"] = cols
    report["table"] = names
    report["trained_on"] = {"plots": n_plots, "areas": [s for s in sorted(set(d["src"][final])) if s.startswith("area-")], "cells": int(final.sum()), "areaWeight": {area: float(w[d["src"] == f"area-{area}"][0]) for area in AREAS if (d["src"] == f"area-{area}").any()}}
    report["seconds"] = time.time() - t0
    (MODEL_DIR / "model.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"saved to {MODEL_DIR} in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
