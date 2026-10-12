"""The wind atlas: every site the surrogate learned from, as WindNinja solved
it (HD) and as the net predicts it (SD), for a page that draws both as
moving streaks over satellite imagery (atlas/index.html; Gavan, 2026-10-11:
"just want to stream the wind over Sat their locations to get a sense of
what it looks like").

    py -3.14 pipeline/surrogate/atlas.py [--only seed-gorge-or] [--upload]

For each built dataset (pipeline/raw/surrogate/<site>.npz: the 30 m UTM
grid, WindNinja's u and v for a unit wind from each of 16 directions), the
net's answer on the same grid, eight-way averaged: the net that held the
site out where there is one (hold-<id>, else seed2-hold-<id>), so its SD is
what a stranger's area would get; else the serving net (all), trained on
the site itself, and marked in-sample.

Writes pipeline/raw/atlas/:
  sites.json                 id, name, what the site teaches, centre, the
                             grid's four corners (lon, lat), size, the net
                             and held-out or in-sample, relief
  <site>/<dir>-hd.png        WindNinja: R = u, G = v along the grid's own
  <site>/<dir>-sd.png        axes (columns east, rows south), 127.5 +
                             50 * ratio of the ambient, B = 255 where the
                             solve has a value
  index.html                 copied from pipeline/surrogate/atlas/

The grid's axes are UTM's; the page moves the streaks in grid cells and
maps cells to lon/lat through the four corners, so the meridian
convergence (a few degrees) is carried by the corners, not the vectors.

--upload copies it all to R2 under atlas/ (data.groundwind.app/atlas/index.html).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer

HERE = Path(__file__).resolve().parent
PIPE = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(PIPE))

from fields import DATA, load_area, predict_domain  # noqa: E402

OUT = PIPE / "raw" / "atlas"
RUNS = DATA / "runs"
SCALE = 50.0  # ratio of the ambient to bytes: ±2.55 fits


def nets_for(site: str) -> tuple[str, bool]:
    """The net to show as SD, and whether it held the site out: of the
    finished nets that held it out, the one trained on the most areas;
    else the serving net (all)."""
    best: tuple[int, str] | None = None
    for c in RUNS.glob("*/config.json"):
        cfg = json.loads(c.read_text())
        if cfg.get("holdout") == site and (c.parent / "ckpt.pt").exists():
            n = len(cfg.get("train_areas") or [])
            if not best or n > best[0]:
                best = (n, c.parent.name)
    return (best[1], True) if best else ("all", False)


def site_names() -> dict[str, dict]:
    import seed

    out = {s[0]: {"name": s[1], "teaches": s[6], "game": s[7]} for s in seed.SITES}
    for p in (PIPE.parent / "app" / "src" / "areas").glob("*.json"):
        a = json.loads(p.read_text(encoding="utf-8"))
        out[a["id"]] = {"name": a["name"], "teaches": "home area", "game": ""}
    return out


def to_png(u: np.ndarray, v: np.ndarray, valid: np.ndarray, path: Path) -> None:
    r = np.clip(np.round(127.5 + SCALE * np.nan_to_num(u)), 0, 255).astype(np.uint8)
    g = np.clip(np.round(127.5 + SCALE * np.nan_to_num(v)), 0, 255).astype(np.uint8)
    b = np.where(valid & np.isfinite(u) & np.isfinite(v), 255, 0).astype(np.uint8)
    Image.fromarray(np.dstack([r, g, b]), "RGB").save(path, optimize=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", action="append", help="just these sites")
    ap.add_argument("--upload", action="store_true", help="copy the atlas to R2 under atlas/")
    ap.add_argument("--skip-build", action="store_true", help="--upload what is on disk")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    sites = sorted(p.stem for p in DATA.glob("*.npz") if not p.stem.startswith(("baseline-", "pred-")))
    if args.only:
        sites = [s for s in sites if s in args.only]
    names = site_names()
    index_path = OUT / "sites.json"
    index = {s["id"]: s for s in json.loads(index_path.read_text())} if index_path.exists() else {}
    if not args.skip_build:
        import torch
        from train import load_checkpoint

        device = "cuda" if torch.cuda.is_available() else "cpu"
        models: dict[str, object] = {}
        for site in sites:
            t0 = time.time()
            a = load_area(site)
            dirs = [float(d) for d in a.directions]
            net, held = nets_for(site)
            if net not in models:
                models[net] = load_checkpoint(RUNS / net / "ckpt.pt", device)[0]
            pu, pv, _ = predict_domain(models[net], a, dirs, device=device, tta=True)
            d = OUT / site
            d.mkdir(exist_ok=True)
            for k, deg in enumerate(dirs):
                to_png(a.u[k], a.v[k], a.valid, d / f"{deg:05.1f}-hd.png")
                to_png(pu[k], pv[k], a.valid, d / f"{deg:05.1f}-sd.png")
            m = a.meta
            x0, y0, x1, y1 = m["bounds"]
            t = Transformer.from_crs(int(m["epsg"]), 4326, always_xy=True)
            corners = [list(map(lambda q: round(q, 6), t.transform(x, y))) for x, y in ((x0, y1), (x1, y1), (x1, y0), (x0, y0))]
            cx, cy = t.transform((x0 + x1) / 2, (y0 + y1) / 2)
            dem = a.dem[a.valid] if a.valid.any() else a.dem
            info = names.get(site, {"name": site, "teaches": "", "game": ""})
            index[site] = {
                "id": site, **info, "centre": [round(cx, 5), round(cy, 5)], "corners": corners,
                "cols": int(a.u.shape[2]), "rows": int(a.u.shape[1]), "cellM": 30, "epsg": int(m["epsg"]),
                "net": net, "heldOut": held, "relief": int(round(float(np.nanmax(dem) - np.nanmin(dem)))),
                "directions": dirs, "scale": SCALE,
            }
            index_path.write_text(json.dumps(sorted(index.values(), key=lambda s: s["name"]), indent=1))
            print(f"  {site}: {a.u.shape[2]}x{a.u.shape[1]}, SD by {net} ({'held out' if held else 'in-sample'}) · {time.time() - t0:.0f} s", flush=True)
    shutil.copy(HERE / "atlas" / "index.html", OUT / "index.html")
    if args.upload:
        sys.path.insert(0, str(PIPE / "stations"))
        from collect import R2_BUCKET, r2_client

        c = r2_client()
        files = [p for p in OUT.rglob("*") if p.is_file() and p.suffix in (".png", ".json", ".html")]
        types = {".png": "image/png", ".json": "application/json", ".html": "text/html; charset=utf-8"}
        for k, p in enumerate(files):
            key = "atlas/" + p.relative_to(OUT).as_posix()
            extra = {"ContentType": types.get(p.suffix, "application/octet-stream")}
            if p.suffix == ".html" or p.name == "sites.json":
                extra["CacheControl"] = "no-cache"
            c.upload_file(str(p), R2_BUCKET, key, ExtraArgs=extra)
            if (k + 1) % 200 == 0:
                print(f"  uploaded {k + 1}/{len(files)}", flush=True)
        print(f"uploaded {len(files)} files: https://data.groundwind.app/atlas/index.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
