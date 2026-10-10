"""The SD terrain wind: the surrogate net (docs/SURROGATE.md) standing in for
WindNinja's momentum solve, for any area, in seconds instead of a day of
OpenFOAM, written in the same layout build_windcfd.py collect writes so the
microclimate bake takes it the way it takes a momentum run.

The net was trained on WindNinja's runs over the MRDEM at 30 m in UTM, so it
is fed exactly that: the grid prepare() lays out (the area's region plus a
2.5 km buffer, 30 m cells, the same rounding, the wide MRDEM resampled
bilinearly), built here in memory. Never as a kit folder: the WindNinja
runners watch the kit and would start solving any new one. Where the area
has a kit already, its meta.json has to describe the same grid, or the net
would be scored against a different terrain than it was fed.

The net answers along the UTM grid's axes, as WindNinja does, with the
ambient turned by the meridian convergence (fields.py). The app wants east
and north, so the 16 fields are turned to true north before they are
resampled onto the habitat lattice. That is one place this differs from
collect(), which leaves WindNinja's 1-2 degree grid twist in; the other is
that the net's values are cell centres, while collect() reads WindNinja's
corner values as centres (SURROGATE.md §5).

    py -3.14 pipeline/build_windsd.py --area blanchard-river [--run <name>] [--tta] [--device cuda|cpu]

The net is pipeline/raw/surrogate/runs/<run>/ckpt.pt. By default the one
trained with this area held out (hold-<id>), so the SD wind is the honest
out-of-sample one, else the one trained on every area (all). A run counts
once train.py has finished it (its config.json is written at the end; the
checkpoint is saved every 1000 steps while it trains). --tta averages the
eight turns and mirrors of the scene: about 0.4 degrees of turn error for
eight passes, worth it when serving.

Output: pipeline/raw/windsd-<id>.npz, windcfd-<id>.npz's layout (directions,
u<dir>, v<dir>, s<dir>, east and north in units of the regional wind, on
the habitat lattice) plus a meta JSON string naming the net. Where the area
has a WindNinja grid too, the two are compared over the lattice at the end,
the built-in check that the SD grid is the wind it says it is.

    py -3.14 pipeline/build_microclimate.py --area blanchard-river --wind sd
"""

from __future__ import annotations

# area first: it takes --area off sys.argv before argparse sees it
import area  # noqa: F401
from area import ROOT, cached
from common import CACHE_DIR, REGION

import argparse
import hashlib
import json
import math
import os
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import Affine, from_origin
from rasterio.warp import Resampling, reproject

import build_habitat as hb
from build_windcfd import BUFFER_M, CELL_M, DIRECTIONS, area_dir, utm_epsg

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "surrogate"))

from fields import (DATA, REL_SCALE_M, REL_WINDOW, Area, ambient, bearing, fill_dem,  # noqa: E402
                    grid_convergence, pearson, predict_domain, terrain_features, wrap180)

RUNS = DATA / "runs"
SD_VERSION = 1


def rel(p: Path) -> str:
    try:
        return Path(p).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(p)


# ---- the net ---------------------------------------------------------------


def run_state(name: str) -> str | None:
    """None when runs/<name> holds a finished net, else why not."""
    d = RUNS / name
    if not d.exists():
        return "not there"
    if not (d / "ckpt.pt").exists():
        return "no checkpoint yet"
    if not (d / "config.json").exists():
        return "still training: no config.json yet"
    return None


def pick_run(area_id: str, asked: str | None) -> str:
    if asked:
        why = run_state(asked)
        if why:
            raise SystemExit(f"no net to use in {rel(RUNS / asked)}: {why}")
        return asked
    tried = []
    for name in (f"hold-{area_id}", "all"):
        why = run_state(name)
        if why is None:
            return name
        tried.append(f"{rel(RUNS / name)} ({why})")
    raise SystemExit(f"{area_id}: no finished surrogate net: neither " + " nor ".join(tried)
                     + ". Train one (pipeline/surrogate/train.py --holdout <id>, or with no holdout for all) or pass --run")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---- the domain ------------------------------------------------------------


def domain() -> tuple[np.ndarray, int, list[float]]:
    """The DEM build_windcfd.prepare() would write for this area, in memory:
    (dem, epsg, [x0, y0, x1, y1]). The same box, rounding and resampling, so
    the net sees the terrain WindNinja would have."""
    epsg = utm_epsg()
    tr = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    xs, ys = tr.transform(
        [REGION["west"], REGION["east"], REGION["west"], REGION["east"]],
        [REGION["south"], REGION["south"], REGION["north"], REGION["north"]],
    )
    x0 = math.floor((min(xs) - BUFFER_M) / CELL_M) * CELL_M
    x1 = math.ceil((max(xs) + BUFFER_M) / CELL_M) * CELL_M
    y0 = math.floor((min(ys) - BUFFER_M) / CELL_M) * CELL_M
    y1 = math.ceil((max(ys) + BUFFER_M) / CELL_M) * CELL_M
    cols, rows = int((x1 - x0) / CELL_M), int((y1 - y0) / CELL_M)
    src = cached(f"mrdem-wide-{REGION['id']}.npz")
    if not src.exists():
        raise SystemExit(f"{src.name} is not in {src.parent}: run the dem step (build_dem.py) first")
    z = np.load(src, allow_pickle=True)
    dem = np.full((rows, cols), -9999, np.float32)
    reproject(
        z["data"].astype(np.float32), dem,
        src_transform=Affine(*z["transform"][:6]), src_crs=str(z["crs"]), src_nodata=float(z["nodata"]),
        dst_transform=from_origin(x0, y1, CELL_M, CELL_M), dst_crs=f"EPSG:{epsg}", dst_nodata=-9999,
        resampling=Resampling.bilinear,
    )
    holes = int((dem == -9999).sum())
    if holes:
        raise SystemExit(f"the wide MRDEM leaves {holes} cells of the domain empty: fetch it wider first")
    bounds = [x0, y0, x1, y1]
    kit = area_dir()
    if (kit / "meta.json").exists():
        # the kit WindNinja ran on must be this grid, or the comparison at the
        # end (and any training pair) is between two different terrains
        m = json.loads((kit / "meta.json").read_text())
        same = (m["epsg"] == epsg and m["cols"] == cols and m["rows"] == rows
                and all(math.isclose(a, b, abs_tol=1e-6) for a, b in zip(m["bounds"], bounds)))
        if not same:
            raise SystemExit(f"{rel(kit / 'meta.json')} describes EPSG:{m['epsg']} {m['bounds']} {m['cols']}x{m['rows']}, "
                             f"this build EPSG:{epsg} {bounds} {cols}x{rows}: the region box has moved since prepare()")
        if (kit / "dem.tif").exists():
            with rasterio.open(kit / "dem.tif") as d:
                diff = float(np.abs(d.read(1).astype(np.float64) - dem).max())
            # a wide MRDEM fetched again since prepare() can shift a little
            print(f"  kit grid matches; DEM within {diff:.2f} m of the kit's dem.tif"
                  + ("" if diff < 0.5 else " (the wide MRDEM has changed since prepare(): the net sees today's)"))
    return dem, epsg, bounds


# ---- grid axes to true north ------------------------------------------------


def to_true_north(u: np.ndarray, v: np.ndarray, gamma_deg: float) -> tuple[np.ndarray, np.ndarray]:
    """Turn (east, north) components along the UTM grid's axes into true
    east and north. gamma is the meridian convergence, positive when grid
    north lies clockwise of true north (fields.grid_convergence), so a
    true bearing is the grid bearing plus gamma: the vector turns clockwise
    by gamma."""
    g = math.radians(gamma_deg)
    c, s = math.cos(g), math.sin(g)
    return u * c + v * s, -u * s + v * c


def check_rotation(area_: Area) -> None:
    """The ambient the net is fed (grid axes) must come out as the true
    ambient from the same direction, or every SD wind is twisted by gamma."""
    for d in area_.directions:
        ex, ey = area_.amb(float(d))
        tu, tv = to_true_north(np.float64(ex), np.float64(ey), area_.conv)
        want = ambient(float(d))
        err = max(abs(float(tu) - float(want[0])), abs(float(tv) - float(want[1])))
        if err > 1e-6:
            raise SystemExit(f"grid-to-true rotation is wrong: the ambient from {d:g} comes out "
                             f"({float(tu):.6f}, {float(tv):.6f}), want ({float(want[0]):.6f}, {float(want[1]):.6f})")


# ---- onto the lattice -------------------------------------------------------


def lattice_sampler(epsg: int, bounds: list[float], shape: tuple[int, int]):
    """Bilinear from the domain's cell centres onto the habitat lattice's,
    clamped at the domain edge, as collect() samples (the surrogate's values
    are cell centres, so no half-cell shift)."""
    tr = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    rr, cc = np.mgrid[0:hb.ROWS, 0:hb.COLS]
    lon = hb.W + (cc + 0.5) * hb.D_LON
    lat = hb.N - (rr + 0.5) * hb.D_LAT
    x, y = tr.transform(lon, lat)
    x0, y1 = bounds[0], bounds[3]
    R, C = shape
    fc = (x - x0) / CELL_M - 0.5
    fr = (y1 - y) / CELL_M - 0.5
    c0 = np.clip(np.floor(fc).astype(int), 0, C - 2)
    r0 = np.clip(np.floor(fr).astype(int), 0, R - 2)
    tx = np.clip(fc - c0, 0, 1)
    ty = np.clip(fr - r0, 0, 1)

    def at(a: np.ndarray) -> np.ndarray:
        return ((a[r0, c0] * (1 - tx) + a[r0, c0 + 1] * tx) * (1 - ty)
                + (a[r0 + 1, c0] * (1 - tx) + a[r0 + 1, c0 + 1] * tx) * ty).astype(np.float32)

    return at


# ---- the check against WindNinja --------------------------------------------


def compare(bands: dict[str, np.ndarray], dirs: list[float], gamma: float) -> None:
    """The SD grid against the area's WindNinja grid, over the lattice, all
    16 directions pooled, as surrogate/eval.py defines the numbers: the turn
    error is bearing(SD) - bearing(HD); turn r is between their turns away
    from the ambient; speeds in units of the regional wind. collect() leaves
    WindNinja's components along the grid's axes, so they are turned to
    true north here first; its half-cell shift is still in them."""
    p = CACHE_DIR / f"windcfd-{REGION['id']}.npz"
    if not p.exists():
        print(f"  no WindNinja grid ({p.name}) to compare with")
        return
    z = np.load(p)
    cols = {k: [] for k in ("err", "tp", "tt", "sp", "st")}
    n_dirs = 0
    for d in dirs:
        ku, kv = f"u{d:05.1f}", f"v{d:05.1f}"
        if ku not in z.files or kv not in z.files:
            continue
        hu, hv = to_true_north(z[ku].astype(np.float64), z[kv].astype(np.float64), gamma)
        su, sv = bands[ku].astype(np.float64), bands[kv].astype(np.float64)
        ok = np.isfinite(hu) & np.isfinite(hv) & np.isfinite(su) & np.isfinite(sv)
        b_a = float(bearing(*ambient(d)))
        b_h, b_s = bearing(hu[ok], hv[ok]), bearing(su[ok], sv[ok])
        cols["err"].append(wrap180(b_s - b_h))
        cols["tp"].append(wrap180(b_s - b_a))
        cols["tt"].append(wrap180(b_h - b_a))
        cols["sp"].append(np.hypot(su[ok], sv[ok]))
        cols["st"].append(np.hypot(hu[ok], hv[ok]))
        n_dirs += 1
    if not n_dirs:
        print(f"  {p.name} has none of the 16 directions to compare with")
        return
    c = {k: np.concatenate(v) for k, v in cols.items()}
    a = np.abs(c["err"])
    print(f"  against WindNinja ({p.name}, turned to true north), {n_dirs} directions pooled over the lattice:")
    print(f"    turn MAE     {a.mean():.1f}°")
    print(f"    turn median  {np.median(a):.1f}°")
    print(f"    turn r       {pearson(c['tp'], c['tt']):.2f}")
    print(f"    speed MAE    {np.abs(c['sp'] - c['st']).mean():.3f} of the regional wind")
    print(f"    speed r      {pearson(c['sp'], c['st']):.2f}")


# ---- main ------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--run", default=None, help="the net, runs/<run>/ckpt.pt (default: hold-<id>, else all)")
    ap.add_argument("--tta", action="store_true", help="average the eight D4 turns of the scene")
    ap.add_argument("--device", default=None, choices=["cuda", "cpu"])
    args = ap.parse_args()

    t0 = time.time()
    area_id = REGION["id"]
    run = pick_run(area_id, args.run)
    try:
        import torch
    except ImportError:
        raise SystemExit(f"torch is not installed for {sys.executable}: the surrogate needs it "
                         "(pip install torch --index-url https://download.pytorch.org/whl/cu128)")
    from train import load_checkpoint

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    ckpt = RUNS / run / "ckpt.pt"
    model, config = load_checkpoint(ckpt, device)
    # the inputs are made by fields.py's constants: a net trained on other
    # ones, or fed a true-north ambient, would be answering another question
    if config.get("ambient_axes") != "grid":
        raise SystemExit(f"{rel(ckpt)} was trained with ambient_axes={config.get('ambient_axes')!r}: only grid-axis nets serve")
    if config.get("rel_window", REL_WINDOW) != REL_WINDOW or config.get("rel_scale_m", REL_SCALE_M) != REL_SCALE_M:
        raise SystemExit(f"{rel(ckpt)} was trained on a different elevation channel than fields.py makes")
    train_areas = list(config.get("train_areas") or [])
    in_sample = area_id in train_areas
    print(f"{area_id}: net {run} ({config.get('steps')} steps, trained on {', '.join(train_areas) or '?'}"
          f"{'; this area is IN its training set' if in_sample else ''}) on {device}{', 8-way TTA' if args.tta else ''}")

    dem, epsg, bounds = domain()
    R, C = dem.shape
    dirs = [float(d) for d in DIRECTIONS]
    meta = {"epsg": epsg, "bounds": bounds}
    zeros = np.zeros((len(dirs), R, C), np.float32)
    dom = Area(name=area_id, dem=fill_dem(dem), u=zeros, v=zeros, turb=zeros,
               directions=np.array(dirs, np.float32), core=np.ones((R, C), bool), valid=np.ones((R, C), bool),
               meta=meta, conv=grid_convergence(meta))
    dom.rel, dom.gx, dom.gy = terrain_features(dom.dem)
    check_rotation(dom)
    print(f"  domain {C}x{R} cells of {CELL_M:.0f} m in EPSG:{epsg}, meridian convergence {dom.conv:+.3f}° · {time.time() - t0:.0f}s")

    t1 = time.time()
    pu, pv, pt = predict_domain(model, dom, dirs, device=device, tta=args.tta)
    tu, tv = to_true_north(pu, pv, dom.conv)
    print(f"  predicted {len(dirs)} directions in {time.time() - t1:.1f}s")

    at = lattice_sampler(epsg, bounds, (R, C))
    bands: dict[str, np.ndarray] = {}
    turb_ok = True
    for i, d in enumerate(dirs):
        bands[f"u{d:05.1f}"] = at(tu[i])
        bands[f"v{d:05.1f}"] = at(tv[i])
        s = at(pt[i])
        turb_ok &= bool(np.isfinite(s).all())
        bands[f"s{d:05.1f}"] = s
    if not turb_ok:
        # all or nothing, as collect() and the browser take it
        print("  the net's turbulence is not finite everywhere: left out")
        for d in dirs:
            del bands[f"s{d:05.1f}"]

    info = {
        "area": area_id, "run": run, "checkpoint": rel(ckpt), "sha256": sha256(ckpt),
        "steps": config.get("steps"), "train_areas": train_areas, "in_sample": in_sample, "tta": bool(args.tta),
        "generated": date.today().isoformat(), "convergence_deg": round(dom.conv, 4),
        "surrogate": "U-Net", "sdVersion": SD_VERSION,
    }
    out = CACHE_DIR / f"windsd-{area_id}.npz"
    tmp = out.with_name(out.name + ".part")
    # written aside and renamed: the micro-sd step must never read half a file
    with open(tmp, "wb") as f:
        np.savez_compressed(f, directions=np.array(dirs, np.float32), meta=np.array(json.dumps(info)), **bands)
    os.replace(tmp, out)
    sp = np.hypot(bands[f"u{dirs[0]:05.1f}"], bands[f"v{dirs[0]:05.1f}"])
    tn = (f" · turbulence {np.percentile(bands[f's{dirs[0]:05.1f}'], 50):.2f} of the regional wind (median)"
          if turb_ok else " · no turbulence")
    print(f"{area_id}: {len(dirs)} directions onto {hb.COLS}×{hb.ROWS} · speed {np.percentile(sp, 5):.2f}–"
          f"{np.percentile(sp, 95):.2f} of the regional wind{tn} · {rel(out)} ({out.stat().st_size / 1e6:.1f} MB)")
    compare(bands, dirs, dom.conv)
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
