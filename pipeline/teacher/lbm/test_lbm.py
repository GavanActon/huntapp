"""Tests for lbm.py (Track B, step 1). Each prints its numbers and they are
all written to pipeline/raw/teacher/lbm/tests/tests.json, with a figure of
the ridge test.

  links      the terrain's link lists are a bijection: every population that
             would stream out of a solid cell into a fluid one is replaced
             exactly once, smooth, slip and noslip floors.
  flat       a flat channel at 30 m (12 km fetch, 2.7 km lid): the approach
             flow holds its profile (the 10 m wind along the fetch over the
             inlet's) and the floor's drag layer gives the roughness it was
             set to (z0 fitted from the first two cells).
  ridge      a 2D Gaussian ridge, h = 80 m, half-length at half-height L =
             400 m (h/L 0.2, slope at most 8 degrees), 10 m cells, rans
             closure, smooth floor (and the staircase slip floor for
             contrast), against the same lattice with no ridge: the fractional
             speed-up over the crest by height, beside Jackson-Hunt as Taylor &
             Lee (1984) put it for 2D ridges, dS_max = 2 h/L, dS(z) = dS_max
             exp(-3 z/L); the slowdown at the foot; the lee (smooth = one
             minimum, no reversed air at the first cell).
  stability  a 3D hill (300 m, 30 m cells) with the les closure and recycled
             inflow at the chosen Re (1e5) and ten times it, and rans at Re
             1e5: a few thousand steps, finite, the largest Mach, the mass
             drift, and the resolved turbulence at 10 m upwind (les).
  glups      lattice updates per second on this GPU at 13 M cells.

    py -3.14 pipeline/teacher/lbm/test_lbm.py              # all
    py -3.14 pipeline/teacher/lbm/test_lbm.py ridge glups  # some
"""

from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import lbm  # noqa: E402

OUT = HERE.parent.parent / "raw" / "teacher" / "lbm" / "tests"
DEV = "cuda" if torch.cuda.is_available() else "cpu"


def quiet(_msg: str) -> None:
    pass


def test_links() -> dict:
    rng = np.random.default_rng(1)
    Y, X = 24, 64
    yy, xx = np.mgrid[0:Y, 0:X]
    h = 120 * np.exp(-((xx - 32) ** 2 + (yy - 12) ** 2) / (2 * 8 ** 2)) + rng.uniform(0, 40, (Y, X))
    h[:, :8] = 0
    out = {}
    for floor in ("smooth", "slip", "noslip"):
        L = lbm.Lattice(h, lbm.Setup(dx=30, floor=floor, lid_min=600, lid_factor=0, lid_add=0), device=DEV)
        N = L.N
        Z, Yy, Xx = L.shape
        dst = L.dst.cpu().numpy()
        if floor == "smooth" and L.wrap_dst is not None:  # + the wrapped nodes' staircase links
            dst = np.concatenate([dst, L.wrap_dst.cpu().numpy()])
        solid = L.solid.cpu().numpy()
        need = []
        for j in range(1, lbm.Q):
            cx, cy, cz = lbm.C[j]
            sm = np.zeros_like(solid)
            src = np.roll(solid, shift=cy, axis=1)
            zs = slice(max(0, cz), Z - max(0, -cz))
            zd = slice(max(0, -cz), Z - max(0, cz))
            xs = slice(max(0, cx), Xx - max(0, -cx))
            xd = slice(max(0, -cx), Xx - max(0, cx))
            sm[zs, :, xs] = src[zd, :, xd]
            m = (~solid) & sm
            m[:, :, 0] = False
            m[:, :, -1] = False  # the inlet and outlet faces are set by their own conditions
            z, y, x = np.nonzero(m)
            need.append(j * N + (z * Yy + y) * Xx + x)
        need = np.unique(np.concatenate(need))
        inner = dst[(dst % N % Xx != 0) & (dst % N % Xx != Xx - 1)]
        r = {"links": int(len(dst)), "duplicates": int(len(dst) - len(np.unique(dst))),
             "missing": int(len(np.setdiff1d(need, inner))), "extra": int(len(np.setdiff1d(inner, need)))}
        r["pass"] = r["duplicates"] == 0 and r["missing"] == 0 and r["extra"] == 0
        out[floor] = r
        print(f"links {floor}: {r}")
    return out


def run_pair(h: np.ndarray, setup: lbm.Setup, steps: int, avg_frac: float = 0.3):
    """The case and the same lattice with flat ground, both averaged."""
    res = []
    nz = None
    for hh in (h, np.zeros_like(h) + h.min()):
        L = lbm.Lattice(hh, setup, device=DEV, log=quiet, nz=nz)
        nz = L.shape[0]
        L.run(steps, avg_from=int(steps * (1 - avg_frac)), avg_every=5, report_every=10 ** 9, check_every=2000)
        res.append(L)
    return res


def test_flat() -> dict:
    Y, X = 4, 400
    s = lbm.Setup(dx=30, lid_min=2700, lid_add=0, lid_factor=0)
    L = lbm.Lattice(np.zeros((Y, X)), s, device=DEV, log=quiet)
    steps = 12000
    L.run(steps, avg_from=steps - 3000, report_every=10 ** 9, check_every=2000)
    mu = L.mean_velocity()
    s10 = (L.sample_at(mu, 10.0)[0, 0] / L.u10).cpu().numpy()
    ux = mu[0, :, 0, :].cpu().numpy()
    k = L.ns_in
    u1, u2 = ux[k, 250], ux[k + 1, 250]
    z1, z2 = 0.5 * s.dx, 1.5 * s.dx
    z0fit = math.exp((u2 * math.log(z1) - u1 * math.log(z2)) / (u2 - u1))
    xs = [50, 100, 150, 200, 250, 300, 350]
    r = {"dx_m": s.dx, "fetch_km": X * s.dx / 1000, "u10_over_inlet_at_km": {f"{x * s.dx / 1000:.1f}": round(float(s10[x]), 3) for x in xs},
         "z0_set": s.z0, "z0_fitted_cells_1_2": round(z0fit, 3),
         "spread_of_u10_along_fetch": round(float(s10[50:351].max() - s10[50:351].min()), 4)}
    r["pass"] = r["spread_of_u10_along_fetch"] < 0.03 and 0.5 * s.z0 < z0fit < 2 * s.z0
    print(f"flat: {r}")
    return r


def ridge_case(floor: str, steps: int = 22000) -> dict:
    dx, Hh, Lh = 10.0, 80.0, 400.0
    sigma = Lh / math.sqrt(2 * math.log(2))
    Y, X = 4, 480
    xc = 180
    x = (np.arange(X) + 0.5) * dx
    h1 = Hh * np.exp(-((x - (xc + 0.5) * dx) ** 2) / (2 * sigma ** 2))
    h = np.repeat(h1[None], Y, 0)
    s = lbm.Setup(dx=dx, z0=0.1, closure="rans", floor=floor, lid_min=2000, lid_factor=0, lid_add=0)
    t0 = time.perf_counter()
    Lh_, Lf = run_pair(h, s, steps)
    wall = time.perf_counter() - t0
    mh = Lh_.mean_velocity()[:, :, 0, :].cpu().numpy()  # (3, Z, X)
    mf = Lf.mean_velocity()[:, :, 0, :].cpu().numpy()
    nsh = Lh_.ns_np[0]
    nsf = Lf.ns_np[0]
    crest_cells = [i for i in range(X) if nsh[i] == nsh.max()]
    crest = crest_cells[len(crest_cells) // 2]
    zs, dS, tl = [], [], []
    for k in range(0, 40):
        # heights over the wall at the crest and on the flat run (the same: 80 m is 8 cells)
        z = (nsh[crest] + k - Lh_.zw_np[0, crest]) * dx
        uh = math.hypot(mh[0, nsh[crest] + k, crest], mh[2, nsh[crest] + k, crest])
        uf = math.hypot(mf[0, nsf[crest] + k, crest], mf[2, nsf[crest] + k, crest])
        zs.append(z)
        dS.append(uh / uf - 1)
        tl.append(2 * Hh / Lh * math.exp(-3 * z / Lh))
    s10h = Lh_.sample_at(Lh_.mean_velocity(), 10.0)[:, 0].cpu().numpy()
    s10f = Lf.sample_at(Lf.mean_velocity(), 10.0)[:, 0].cpu().numpy()
    ratio = np.hypot(s10h[0], s10h[2]) / np.hypot(s10f[0], s10f[2])
    first_ux = np.array([mh[0, nsh[i], i] for i in range(X)])
    lee = slice(crest, X - 30)
    rl = ratio[lee]
    # minima that matter: lower by 0.005 than the most of the 10 cells either side
    minima = 0
    for j in range(10, len(rl) - 10):
        if rl[j] == rl[j - 10:j + 11].min() and min(rl[j - 10:j].max(), rl[j + 1:j + 11].max()) - rl[j] > 0.005:
            minima += 1
    i_min = crest + int(np.argmin(rl))
    up = slice(60, crest)
    r = {"floor": floor, "dx_m": dx, "h_m": Hh, "L_m": Lh, "h_over_L": Hh / Lh, "lattice": list(Lh_.shape),
         "steps": steps, "wall_s": round(wall, 1), "lid_m": Lh_.h_lid_cells * dx,
         "blockage_h_over_lid": round(Hh / (Lh_.h_lid_cells * dx), 3),
         "dS_crest_by_height": {f"{z:.0f}": round(v, 3) for z, v in zip(zs[:12], dS[:12])},
         "taylor_lee_by_height": {f"{z:.0f}": round(v, 3) for z, v in zip(zs[:12], tl[:12])},
         "dS_10m_crest": round(float(ratio[crest] - 1), 3), "dS_max_guideline": 2 * Hh / Lh,
         "windward_foot_min_ratio_10m": round(float(ratio[up].min()), 3),
         "lee_min_ratio_10m": round(float(rl.min()), 3), "lee_min_at_L": round((i_min - crest) * dx / Lh, 2),
         "lee_local_minima": minima, "reversed_first_cell": bool((first_ux < 0).any())}
    r["pass"] = (0.6 * 2 * Hh / Lh <= max(dS[:2]) <= 1.4 * 2 * Hh / Lh) and minima == 1 and not r["reversed_first_cell"]
    r["_curves"] = {"x": x.tolist(), "h": h1.tolist(), "ratio": ratio.tolist(), "z": zs, "dS": dS, "tl": tl,
                    "crest": crest}
    print(f"ridge {floor}: " + json.dumps({k: v for k, v in r.items() if k != "_curves"}))
    return r


def test_ridge() -> dict:
    out = {f: ridge_case(f) for f in ("smooth", "slip")}
    figure_ridge(out, OUT / "test-ridge.png")
    for v in out.values():
        v.pop("_curves")
    out["pass"] = out["smooth"]["pass"]
    return out


def figure_ridge(out: dict, path: Path) -> None:
    import plotstyle as ps
    import matplotlib.pyplot as plt
    ps.apply()
    fig, ax = plt.subplots(1, 2, figsize=(10.5, 3.9), gridspec_kw={"width_ratios": [1.6, 1]})
    names = {"smooth": "smooth floor (wall at the true ground)", "slip": "staircase floor"}
    a, b = ax
    cs = out["smooth"]["_curves"]
    Lh = out["smooth"]["L_m"]
    Hh = out["smooth"]["h_m"]
    x = np.array(cs["x"])
    xr = (x - x[cs["crest"]]) / Lh
    a.axhline(1.0, color=ps.GRID, lw=1)
    a.fill_between(xr, 0.0, np.array(cs["h"]) / Hh * 0.3, color="#e4e3df", lw=0, label="the ridge (shape)")
    for k, (f, c) in enumerate(out.items()):
        cv = c["_curves"]
        a.plot(xr, cv["ratio"], color=ps.SERIES[k], label=names[f])
        b.plot(cv["dS"], cv["z"], color=ps.SERIES[k], marker="o", ms=3.5, lw=1.6, label=names[f])
    b.plot(cs["tl"], cs["z"], color=ps.INK2, ls="--", lw=1.4, label="Taylor & Lee: 2h/L exp(-3z/L)")
    a.set_xlim(-3, 4)
    a.set_ylim(0, 1.6)
    a.set_xlabel("distance from the crest / L")
    a.set_ylabel("10 m speed / flat run's")
    a.set_title("Speed at 10 m along the ridge (h/L = 0.2)", loc="left")
    a.legend(loc="upper right", fontsize=8)
    b.axvline(0, color=ps.GRID, lw=1)
    b.set_ylim(0, 200)
    b.set_xlim(-0.4, 0.6)
    b.set_xlabel("fractional speed-up over the crest")
    b.set_ylabel("height over the ground, m")
    b.set_title("Speed-up over the crest by height", loc="left")
    b.legend(loc="upper right", fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def test_stability() -> dict:
    out = {}
    Y, X = 96, 192
    dx = 30.0
    yy, xx = np.mgrid[0:Y, 0:X]
    h = 300.0 * np.exp(-(((xx - 110) * dx) ** 2 + ((yy - 48) * dx) ** 2) / (2 * 450.0 ** 2))
    for name, closure, re, recycle in [("les Re 1e5", "les", 1e5, 40), ("les Re 1e6", "les", 1e6, 40),
                                       ("rans Re 1e5", "rans", 1e5, 0)]:
        s = lbm.Setup(dx=dx, closure=closure, re=re, recycle=recycle)
        L = lbm.Lattice(h, s, device=DEV, log=quiet)
        L.probe_x = 30
        steps = 5000
        t0 = time.perf_counter()
        ok, err = True, None
        try:
            L.run(steps, avg_from=steps - 2000, avg_every=2, report_every=10 ** 9, check_every=250)
        except FloatingPointError as e:
            ok, err = False, str(e)
        wall = time.perf_counter() - t0
        hist = L.history
        r = {"lattice": list(L.shape), "tau0": L.tau0, "steps": L.step_count, "finite": ok, "error": err,
             "mach_max": round(max(hh["mach_max"] for hh in hist), 3),
             "mass_drift_max": float(max(abs(hh["mass_dev"]) for hh in hist)),
             "u10_probe_over_inlet_last": round(hist[-1]["u10_flat"], 3), "wall_s": round(wall, 1)}
        if ok and closure == "les":
            sd = L.sample_at(L.velocity_sd().unsqueeze(0), 10.0)[0][:, L.probe_x]
            mu = L.sample_at(L.mean_velocity(), 10.0)[0][:, L.probe_x]
            r["turbulence_intensity_10m_upwind"] = round(float((sd / mu).mean()), 3)
            sd2 = L.sample_at(L.velocity_sd().unsqueeze(0), 10.0)[0]
            mu2 = torch.sqrt((L.sample_at(L.mean_velocity(), 10.0)[0:2] ** 2).sum(0))
            r["turbulence_intensity_10m_lee"] = round(float((sd2 / mu2)[40:56, 125:150].mean()), 3)
        r["pass"] = ok and r["mach_max"] < 0.3 and r["mass_drift_max"] < 1e-2
        out[name] = r
        print(f"stability {name}: {r}")
        del L
        torch.cuda.empty_cache()
    return out


def test_glups() -> dict:
    out = {"device": torch.cuda.get_device_name(0) if DEV == "cuda" else "cpu"}
    Y, X = 400, 400
    yy, xx = np.mgrid[0:Y, 0:X]
    h = 600 * np.exp(-((xx - X / 2) ** 2 + (yy - Y / 2) ** 2) / (2 * (X / 10) ** 2))
    for closure in ("rans", "les"):
        torch.cuda.reset_peak_memory_stats()
        L = lbm.Lattice(h, lbm.Setup(dx=30, closure=closure, lid_min=2400, lid_add=0, lid_factor=0), device=DEV, log=quiet)
        L.run(20, report_every=10 ** 9, check_every=10 ** 9)
        r = L.run(300, avg_from=L.step_count, avg_every=5, report_every=10 ** 9, check_every=10 ** 9)
        peak = torch.cuda.max_memory_allocated() / 2 ** 30
        out[closure] = {"cells_M": round(L.N / 1e6, 2), "glups": round(r["glups"], 3),
                        "steps_per_s": round(300 / r["seconds"], 1), "peak_GB": round(peak, 2),
                        "bytes_per_cell": round(peak * 2 ** 30 / L.N)}
        print(f"glups {closure}: {out[closure]}")
        del L
        torch.cuda.empty_cache()
    return out


TESTS = {"links": test_links, "flat": test_flat, "ridge": test_ridge, "stability": test_stability, "glups": test_glups}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    names = sys.argv[1:] or list(TESTS)
    path = OUT / "tests.json"
    results = json.loads(path.read_text()) if path.exists() else {}
    for n in names:
        t = time.perf_counter()
        results[n] = TESTS[n]()
        results[n + "_s"] = round(time.perf_counter() - t, 1)
        path.write_text(json.dumps(results, indent=1, default=str))
    print(f"wrote {path}")
    bad = [n for n in names if isinstance(results[n], dict) and results[n].get("pass") is False]
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
