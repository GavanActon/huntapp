"""Check a PALM case built by build_case.py before it goes to xonix, and
print a summary: the static driver against PIDS and against its _p3d, no
NaN or fill where PALM forbids one, the domain's bounds against the check
points, the terrain against the 10 m DEM the WindNinja trial ran on, and the
canopy where the treetops were seen.

    py -3.14 pipeline/teacher/palm/check_driver.py searchmont
    py -3.14 pipeline/teacher/palm/check_driver.py searchmont --tag t20

Exit status 1 if any check fails. PALM itself is the last check: a short run
reads everything (README.md, "Test it here first").
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
MANDATORY_ATTRS = ["origin_lat", "origin_lon", "origin_x", "origin_y", "origin_z", "rotation_angle"]
# Gavan's checks at Searchmont (WIND-LEARNING.md; C:/tmp/wn-trial/trial.py): label, lat, lon, felt from
CHECKS = {
    "searchmont": [
        ("dusk floor 17:33, felt 308", 46.77744, -84.04824, 308),
        ("dusk treetops 18:24, seen 180", 46.77371, -84.04476, 180),
        ("midday floor 10:58, felt 249", 46.77327, -84.04020, 249),
        ("midday top 419 m, felt 185", 46.76627, -84.03590, 185),
    ],
}

fails: list[str] = []


def check(ok: bool, what: str) -> bool:
    print(f"  [{'ok' if ok else 'FAIL'}] {what}")
    if not ok:
        fails.append(what)
    return ok


def namelist_ints(text: str, key: str) -> list[float]:
    m = re.search(rf"(?<![\w(]){key}\s*=\s*([^!\n]+)", text)
    if not m:
        return []
    return [float(x) for x in re.findall(r"-?\d+\.?\d*(?:[eE]-?\d+)?", m.group(1))]


def main() -> None:
    from netCDF4 import Dataset
    from pyproj import Transformer

    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("case")
    ap.add_argument("--tag", default="")
    args = ap.parse_args()
    info_path = HERE / args.case / f"case{('-' + args.tag) if args.tag else ''}.json"
    info = json.loads(info_path.read_text(encoding="utf-8"))
    print(f"{args.case} ({info_path.name}, built {info['built']}): {info['nx']} x {info['ny']} x {info['dx']:g} m, "
          f"EPSG:{info['epsg']}, bounds {[round(b) for b in info['bounds']]}")
    to = Transformer.from_crs(4326, info["epsg"], always_xy=True)
    x0, y0, x1, y1 = info["bounds"]
    cx, cy = info["centre"]
    half = info["core_m"] / 2

    zt0 = None
    for name, run in info["runs"].items():
        inp = HERE / args.case / "JOBS" / name / "INPUT"
        st, pp = inp / f"{name}_static", inp / f"{name}_p3d"
        print(f"\n{name} ({run['stability']}, from {run['direction']:g} at {run['speed_kph']:g} km/h)")
        if not (check(st.exists(), f"{st.name} exists") and check(pp.exists(), f"{pp.name} exists")):
            continue
        text = pp.read_text(encoding="utf-8")
        nx = int(namelist_ints(text, "nx")[0]); ny = int(namelist_ints(text, "ny")[0]); nz = int(namelist_ints(text, "nz")[0])
        dx = namelist_ints(text, "dx")[0]
        with Dataset(st) as nc:
            attrs = {a: nc.getncattr(a) for a in nc.ncattrs()}
            check(all(a in attrs for a in MANDATORY_ATTRS), "PIDS global attributes: " + ", ".join(f"{a}={attrs.get(a)!s:.10}" for a in MANDATORY_ATTRS))
            check(nc.dimensions["x"].size == nx + 1 and nc.dimensions["y"].size == ny + 1,
                  f"x, y = {nc.dimensions['x'].size}, {nc.dimensions['y'].size} = nx+1, ny+1 of the _p3d ({nx + 1}, {ny + 1})")
            xs, ys = nc["x"][:], nc["y"][:]
            check(np.allclose(np.diff(xs), dx) and np.allclose(np.diff(ys), dx) and abs(xs[0] - dx / 2) < 1e-3,
                  f"x, y cell centres every {dx:g} m from {dx / 2:g}")
            zt = np.ma.filled(nc["zt"][:], np.nan)
            lad = np.ma.filled(nc["lad"][:], np.nan)
            z0 = np.ma.filled(nc["z0"][:], np.nan)
            zlad = nc["zlad"][:]
            E, N = nc["E_UTM"][:], nc["N_UTM"][:]
        check(np.isfinite(zt).all(), "zt: no NaN, no fill (PIDS forbids fill in zt)")
        check(float(np.nanmin(zt)) == 0.0, f"zt from 0 to {np.nanmax(zt):.1f} m above origin_z {attrs['origin_z']:.1f} m")
        check(np.isfinite(lad).all() and (lad >= 0).all(), f"lad: {lad.shape} (zlad, y, x), finite, >= 0, max {lad.max():.2f} m2/m3")
        check(zlad[0] == 0.0 and np.allclose(np.diff(zlad[1:]), dx) and abs(zlad[1] - dx / 2) < 1e-3,
              f"zlad = 0 then the cell centres {', '.join(f'{z:g}' for z in zlad[1:])} m")
        check(np.isfinite(z0).all() and (z0 > 0).all() and (z0 < 0.5 * dx).all(),
              f"z0 in ({z0.min():g}, {z0.max():g}) m, under half the first level")
        check(np.allclose(zt[0], zt[-1]) and np.allclose(zt[:, 0], zt[:, -1]),
              f"terrain periodic: edges at {zt[0, 0]:.1f} m all round (cyclic boundaries)")
        lai = lad[1:].sum(axis=0) * dx
        check(0.0 < lai.mean() < 8.0, f"LAI mean {lai.mean():.2f}, p90 {np.percentile(lai, 90):.2f}, max {lai.max():.2f}")
        top = info["vertical"]["top"]
        check(top > zt.max() + 600, f"domain top ~{top} m over the lowest ground, {top - zt.max():.0f} m over the highest")
        check(abs(E[0, 0] - (x0 + dx / 2)) < 1e-3 and abs(N[-1, -1] - (y1 - dx / 2)) < 1e-3,
              "E_UTM, N_UTM: row 0 the south edge, as PIDS has it")
        if zt0 is None:
            zt0 = zt
        else:
            check(np.array_equal(zt, zt0), "the same terrain as the case's first run")
        # a nested child (build_case.py --nest)
        stc, ppc = inp / f"{name}_static_N02", inp / f"{name}_p3d_N02"
        nest = info.get("nest")
        if nest or stc.exists():
            if not (check(stc.exists() and ppc.exists() and bool(nest), "nested child: driver, namelist and case.json agree it exists")):
                continue
            tc = ppc.read_text(encoding="utf-8")
            cnx, cny = int(namelist_ints(tc, "nx")[0]), int(namelist_ints(tc, "ny")[0])
            cdx = namelist_ints(tc, "dx")[0]
            with Dataset(stc) as nc:
                cattrs = {a: nc.getncattr(a) for a in nc.ncattrs()}
                czt = np.ma.filled(nc["zt"][:], np.nan)
                clad = np.ma.filled(nc["lad"][:], np.nan)
                csz = (nc.dimensions["y"].size, nc.dimensions["x"].size)
            check(csz == (cny + 1, cnx + 1), f"child: {csz[1]} x {csz[0]} cells of {cdx:g} m = its _p3d_N02")
            check(np.isfinite(czt).all() and czt.min() >= 0 and np.isfinite(clad).all(),
                  f"child: zt {czt.min():.1f}-{czt.max():.1f} m, no NaN; lad finite")
            check(abs(cattrs["origin_z"] - attrs["origin_z"]) < 1e-3, "child: the root's origin_z (PALM shifts all domains by one minimum)")
            llx, lly = cattrs["origin_x"] - attrs["origin_x"], cattrs["origin_y"] - attrs["origin_y"]
            dl = re.search(r"'core',\s*2,\s*1,\s*\d+,\s*([\d.]+),\s*([\d.]+)", text)
            check(dl is not None and abs(float(dl.group(1)) - llx) < 1e-3 and abs(float(dl.group(2)) - lly) < 1e-3
                  and llx % dx == 0 and lly % dx == 0,
                  f"child: corner ({llx:g}, {lly:g}) in the root, on its {dx:g} m lattice, as domain_layouts has it")
            top = namelist_ints(tc, "nz")[0] * cdx
            check(top < info["vertical"]["start"], f"child top {top:g} m under the root's stretching ({info['vertical']['start']:g} m)")

    # ---- where the checks sit
    print("\nthe check points in the domain")
    trial = None
    if info.get("trial_dem") and Path(info["trial_dem"]).exists():
        import rasterio
        trial = rasterio.open(info["trial_dem"])
    for label, lat, lon, felt in CHECKS.get(args.case, []):
        x, y = to.transform(lon, lat)
        inside = x0 < x < x1 and y0 < y < y1
        incore = abs(x - cx) < half and abs(y - cy) < half
        i, j = int((x - x0) // info["dx"]), int((y - y0) // info["dx"])
        msg = f"{label}: E {x:.0f} N {y:.0f}, {'in the core' if incore else 'in the domain' if inside else 'OUTSIDE'}"
        if inside and zt0 is not None:
            zm = zt0[j, i] + info["origin_z"]
            msg += f"; ground {zm:.1f} m"
            if trial is not None:
                r, c = trial.index(x, y)
                zt_trial = float(trial.read(1, window=((r, r + 1), (c, c + 1)))[0, 0])
                msg += f" (trial DEM {zt_trial:.1f}, diff {zm - zt_trial:+.1f})"
                check(abs(zm - zt_trial) < 3.0 + 0.5 * info["dx"], msg)
                continue
        check(incore, msg)
    if trial is not None and zt0 is not None:
        # the whole terrain against the trial's 10 m DEM where they overlap (away from the taper)
        tw = int(info["taper_m"] / info["dx"])
        inner = zt0[tw:-tw, tw:-tw] + info["origin_z"]
        xs = x0 + (np.arange(tw, info["nx"] - tw) + 0.5) * info["dx"]
        ys = y0 + (np.arange(tw, info["ny"] - tw) + 0.5) * info["dx"]
        rows = [trial.index(xs[0], y)[0] for y in ys]
        cols = [trial.index(x, ys[0])[1] for x in xs]
        t = trial.read(1)[np.ix_(rows, cols)]
        d = inner - t
        check(np.median(np.abs(d)) < 1.0 + 0.1 * info["dx"],
              f"terrain inside the taper vs the trial's 10 m DEM: median |diff| {np.median(np.abs(d)):.2f} m, "
              f"p99 {np.percentile(np.abs(d), 99):.1f} m (PALM then rounds it to {info['dx']:g} m steps)")
    cs = info["canopy_summary"]
    print(f"\ncanopy: cover {cs['cover_mean']:.0%}, LAI mean {cs['lai_mean']:.2f}, tall-tree height (p90 per cell) {cs['height_p90_mean']:.1f} m; "
          f"leaf {info['leaf']:g}; sources: {'; '.join(info['sources'])}")
    print(f"vertical: {info['vertical']}; 3d output to level {info['nz_do3d']}")
    print(f"\n{'ALL CHECKS PASS' if not fails else f'{len(fails)} FAILED: ' + '; '.join(fails)}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
