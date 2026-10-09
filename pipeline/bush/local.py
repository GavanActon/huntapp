"""A bush model of an area's own, from labels tapped on the sharp photo
(the app's bush-label tool, ?label=bush): open, low shrub, tall bush and
dense trees, learned from the bush model's satellite features at 10 m and
mapped over the whole area. Where the general model has never seen the
ground, this is what stands in for it (docs/BUSH-MODEL.md, "An area's own
model").

Blanchard River was the first: the general model, trained on LiDAR plots
from Ontario to Atlin to the Northern Rockies' high ground, called it open
to light throughout, the spruce belts along the creeks no thicker than the
parkland round them, and Blanchard sat out past every plot it had (2.3
standard deviations from its nearest, 0.6 between plots). Gavan tapped 536
labels on Esri's 0.5 m photo (2026-10-09); held out a whole patch at a
time, this model gets 75 % of them right (44 % by chance) and thick or not
87 % (AUC 0.84); dense trees 103 of 109, tall bush the weak class, taken
for low shrub more often than not.

    py -3.14 pipeline/bush/local.py --area blanchard-river

Reads  pipeline/bush/labels/<id>.json  ([kind, lon, lat], kinds open, low, tall, dense)
Writes pipeline/raw/bushlocal-<id>.npz (NRD, its spread and the kind at 10 m, the
       area's UTM zone), read by build_habitat.modelled_bush and bush/render.py;
       pipeline/bush/local/<id>.txt and <id>.json (the model and its scores)

A label stands for the 10 m cells within its 20 m patch. The kinds go onto
the bush model's NRD scale (open 0.08, low 0.28, tall 0.55, dense 0.65:
the scale's thick starts at 0.45) by their probabilities, and the spread is
how far the kinds' NRDs scatter under them (1.68 sd, a q20-q80 width).
Esri's photo is only what the labels were tapped on: no pixel of it goes
into the model.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))

from area import cached  # noqa: E402  (first: it takes --area out of argv)
from common import REGION  # noqa: E402

KINDS = ["open", "low", "tall", "dense"]
NRD = np.array([0.08, 0.28, 0.55, 0.65], np.float32)
CELL = 10.0
BLOCK = 1100  # cells a side: an area goes through in a few blocks, each read on its own
PATCH_CELLS = 2  # a label's 20 m patch, in 10 m cells
GROUP_M = 300.0  # labels this close are one patch for the held-out scores
PARAMS = dict(objective="multiclass", num_class=4, learning_rate=0.05, num_leaves=15, min_data_in_leaf=25, feature_fraction=0.7, bagging_fraction=0.8, bagging_freq=1, lambda_l2=2.0, verbose=-1, seed=7, num_threads=8)
ROUNDS = 300
EXCLUDE = ("lat", "lon")  # position: the model would learn the patches, not the ground
LABELS = HERE / "labels"
MODELS = HERE / "local"


def utm_crs(lon: float) -> str:
    return f"EPSG:{32600 + int((lon + 180) // 6) + 1}"


def blocks():
    """The area's region on a 10 m grid in its UTM zone, cut into blocks: (whole grid, [(row0, col0, block grid)])."""
    import features as F
    from rasterio.transform import from_origin
    from rasterio.warp import transform as wtf

    crs = utm_crs((REGION["west"] + REGION["east"]) / 2)
    xs, ys = wtf("EPSG:4326", crs, [REGION["west"], REGION["east"], REGION["west"], REGION["east"]], [REGION["south"], REGION["south"], REGION["north"], REGION["north"]])
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    W, H = int(np.ceil((x1 - x0) / CELL)), int(np.ceil((y1 - y0) / CELL))
    whole = F.Grid(crs, from_origin(x0, y1, CELL, CELL), W, H)
    out = []
    for r0 in range(0, H, BLOCK):
        for c0 in range(0, W, BLOCK):
            h, w = min(BLOCK, H - r0), min(BLOCK, W - c0)
            out.append((r0, c0, F.Grid(crs, from_origin(x0 + c0 * CELL, y1 - r0 * CELL, CELL, CELL), w, h)))
    return whole, out


def labels() -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    p = LABELS / f"{REGION['id']}.json"
    if not p.exists():
        raise SystemExit(f"no labels for {REGION['id']} ({p}): tap some in the app's bush-label tool (?label=bush) first")
    j = json.loads(p.read_text(encoding="utf-8"))
    rows = j["labels"]
    return np.array([KINDS.index(r[0]) for r in rows]), np.array([r[1] for r in rows]), np.array([r[2] for r in rows]), j


def groups(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    from scipy.cluster.hierarchy import fcluster, linkage

    xy = np.c_[(lon - lon.mean()) * 111320 * np.cos(np.radians(lat.mean())), (lat - lat.mean()) * 111320]
    return fcluster(linkage(xy, "single"), GROUP_M, "distance")


def main() -> None:
    import features as F
    import lightgbm as lgb
    from pyproj import Transformer
    from sklearn.metrics import confusion_matrix, roc_auc_score
    from sklearn.model_selection import GroupKFold

    t0 = time.time()
    kind, lon, lat, meta = labels()
    grp = groups(lon, lat)
    whole, parts = blocks()
    H, W = whole.shape
    print(f"{REGION['id']}: {len(kind)} labels in {len(np.unique(grp))} patches; the area at 10 m is {W} x {H} in {len(parts)} blocks ({whole.crs})", flush=True)
    ex, ny = Transformer.from_crs("EPSG:4326", whole.crs, always_xy=True).transform(lon, lat)
    inv = ~whole.transform
    lab_rc = [tuple(int(v) for v in inv * (x, y))[::-1] for x, y in zip(ex, ny)]
    names = None
    tmp = cached(f"bushlocal-tmp-{REGION['id']}")
    tmp.mkdir(parents=True, exist_ok=True)
    rows, ys, gs, lid = [], [], [], []
    # pass 1: each block's features, kept on disk; the labels' cells out of them
    for b, (r0, c0, g) in enumerate(parts):
        f = F.features(g, verbose=False)
        tab = F.table(f).astype(np.float32)
        seen = (f["leafon_n"] >= 2).ravel()
        names = F.feature_names()
        np.save(tmp / f"b{b}.npy", tab)
        np.save(tmp / f"b{b}-seen.npy", seen)
        h, w = g.shape
        for i, (r, c) in enumerate(lab_rc):
            for dr in range(-PATCH_CELLS, PATCH_CELLS + 1):
                for dc in range(-PATCH_CELLS, PATCH_CELLS + 1):
                    if dr * dr + dc * dc > PATCH_CELLS * PATCH_CELLS:
                        continue
                    rr, cc = r + dr - r0, c + dc - c0
                    if 0 <= rr < h and 0 <= cc < w and seen[rr * w + cc]:
                        rows.append(tab[rr * w + cc])
                        ys.append(kind[i])
                        gs.append(grp[i])
                        lid.append(i)
        print(f"  block {b + 1}/{len(parts)}: {w} x {h} · {time.time() - t0:.0f} s", flush=True)
    keep = [i for i, n in enumerate(names) if n not in EXCLUDE]
    Xt = np.array(rows)[:, keep]
    ys, gs, lid = np.array(ys), np.array(gs), np.array(lid)
    print(f"  {len(np.unique(lid))} labels on {len(ys)} cells; kinds {dict(zip(KINDS, np.bincount(ys, minlength=4).tolist()))}")

    # held out a whole patch at a time
    oof = np.zeros((len(ys), 4))
    for tr, te in GroupKFold(n_splits=min(5, len(np.unique(gs)))).split(Xt, ys, gs):
        m = lgb.train(PARAMS, lgb.Dataset(Xt[tr], ys[tr]), ROUNDS)
        oof[te] = m.predict(Xt[te])
    labs = np.unique(lid)
    pl = np.array([oof[lid == i].mean(0) for i in labs])
    yl = np.array([ys[lid == i][0] for i in labs])
    cm = confusion_matrix(yl, pl.argmax(1), labels=range(4))
    scores = {
        "labels": int(len(labs)),
        "accuracy": round(float(np.mean(pl.argmax(1) == yl)), 3),
        "chance": round(float(np.bincount(yl).max() / len(yl)), 3),
        "thickAuc": round(float(roc_auc_score(yl >= 2, pl[:, 2] + pl[:, 3])), 3),
        "thickRight": round(float(np.mean(((pl[:, 2] + pl[:, 3]) >= 0.5) == (yl >= 2))), 3),
        "openAuc": round(float(roc_auc_score(yl == 0, pl[:, 0])), 3),
        "confusion": {k: dict(zip(KINDS, cm[i].tolist())) for i, k in enumerate(KINDS)},
    }
    print(f"  held out by patch: {scores['accuracy']:.0%} right (chance {scores['chance']:.0%}), thick or not {scores['thickRight']:.0%} (AUC {scores['thickAuc']:.2f}), open AUC {scores['openAuc']:.2f}")
    for k in KINDS:
        print(f"    {k:>5s}: " + ", ".join(f"{v} {n}" for n, v in scores["confusion"][k].items()))

    # the model on every label, then pass 2: the area
    m = lgb.train(PARAMS, lgb.Dataset(Xt, ys), ROUNDS)
    MODELS.mkdir(parents=True, exist_ok=True)
    m.save_model(str(MODELS / f"{REGION['id']}.txt"))
    nrd = np.full((H, W), np.nan, np.float32)
    spread = np.full((H, W), np.nan, np.float32)
    kinds = np.full((H, W), 255, np.uint8)
    for b, (r0, c0, g) in enumerate(parts):
        tab = np.load(tmp / f"b{b}.npy")
        seen = np.load(tmp / f"b{b}-seen.npy")
        h, w = g.shape
        p = np.full((h * w, 4), np.nan, np.float32)
        ok = np.flatnonzero(seen)
        if ok.size:
            p[ok] = m.predict(tab[ok][:, keep])
        e = p @ NRD
        sd = np.sqrt(np.clip(p @ (NRD**2) - e**2, 0, None))
        nrd[r0 : r0 + h, c0 : c0 + w] = e.reshape(h, w)
        spread[r0 : r0 + h, c0 : c0 + w] = (1.68 * sd).reshape(h, w)
        kinds[r0 : r0 + h, c0 : c0 + w] = np.where(np.isfinite(p[:, 0]), np.nan_to_num(p).argmax(1), 255).reshape(h, w)
        (tmp / f"b{b}.npy").unlink()
        (tmp / f"b{b}-seen.npy").unlink()
    tmp.rmdir()
    k = kinds[kinds < 4]
    share = {n: round(float(np.mean(k == i)), 3) for i, n in enumerate(KINDS)}
    notes = {
        "local": True,
        "labels": int(len(labs)),
        "labelSource": meta.get("source", ""),
        "trained": time.strftime("%Y-%m-%d"),
        "scores": scores,
        "kinds": share,
        "features": [names[i] for i in keep],
    }
    np.savez_compressed(cached(f"bushlocal-{REGION['id']}.npz"), nrd=nrd, spread=spread, kind=kinds, transform=np.array(tuple(whole.transform)[:6]), crs=np.array(whole.crs), notes=np.array(json.dumps(notes)))
    (MODELS / f"{REGION['id']}.json").write_text(json.dumps({k: v for k, v in notes.items() if k != "features"} | {"features": notes["features"], "kindsNrd": dict(zip(KINDS, NRD.tolist()))}, indent=1), encoding="utf-8")
    print(f"  the area: NRD mean {np.nanmean(nrd):.3f}; " + ", ".join(f"{n} {v:.0%}" for n, v in share.items()) + f" · {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
