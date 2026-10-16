"""Vertical stand structure round each flux tower, from NEON's discrete-return LiDAR point
clouds (AOP DP1.30003.001, classified, ~1 km LAZ tiles), for why_floor.py.

    py -3.14 pipeline/towers/aop_structure.py list            # pick flights + tiles, sizes (API calls)
    py -3.14 pipeline/towers/aop_structure.py pull            # download the picked tiles (resumable)
    py -3.14 pipeline/towers/aop_structure.py features        # measure them -> raw/towers/why/aop_structure.csv
    py -3.14 pipeline/towers/aop_structure.py all [SITES...]

Flights: the latest month with a classified tile under the tower (else the one before), the
tiles that touch a disc of R_PICK m round it. Raw tiles land in raw/towers/aop/<SITE>/<month>/,
the pick in raw/towers/aop/<SITE>/manifest.json; the pull stops before the total on disk passes
LIMIT_GB. NEON needs a token (X-API-Token): NEON_TOKEN from the process, else the Windows user
environment; never printed or written. Every API response used is cached under raw/towers/aop/
so a rerun makes no calls.

Locations: each NEON tower (the CHM aop.json tower_xy that canopy_sites.py used), plus towers of
other networks that sit inside a NEON flight: Harvard's EMS tower (HF-EMS, in HARV's flight) and
Poker Flat (AMF-US-Prr, tried against BONA's flight).

Heights: above the cloud's own ground (class 2) gridded at 1 m (cell mean, gaps filled linearly,
nearest at the rim), sampled bilinearly at every return; noise classes 7 and 18 dropped, returns
over neon.chm_cap() (the site's CHM artifact cap) or under -1 m dropped. The NEON DTM of the
same site is compared as a check (median |ground - DTM| within 250 m).

Regions per location: discs of 50, 100 and 250 m, and 8 sectors of 45 deg (centred on the wind
FROM 0, 45, ... deg) from 3 to 250 m. Per region (all returns unless named):
- h: the p90 of a 1 m canopy height grid (max return height per cell) in the region;
  chm_gap = share of those cells under 2 m; chm_sd = their standard deviation;
- band shares of all returns: <0.5, 0.5-2 (bush at nose height), 2-5 (lower trunk space),
  5 m-0.5 h, 0.5 h-h, above h (an empty band when 0.5 h < 5 or h < 5);
- nrd_05_2, nrd_2_5: a band's returns over the returns at or below its top (the pulses that got
  that far: normalised relative density, less shaded by the crowns than a raw share);
  bush_nrd: the bush model's label exactly (build_vegstructure: returns 0.5-3 m / returns -1-3 m
  per 10 m cell, cells with 50+ such returns, averaged);
- cbh10, cbh25: crown base, the height by which 10% / 25% of the returns above 2 m are passed;
  depth10/25 = h - cbh;
- trunk_open = 1 - (returns 1 m to 0.5 h) / (returns above 1 m);
- gap_all = class-2 returns / all returns, lai_all = -ln(gap_all); gap_first, lai_first the same
  over first returns (Beer-Lambert proxies: LAI ~ 2 x -ln P_gap for a spherical leaf);
- density (returns per m2), flight month (NEON's; the clouds carry GPS week time, so no day).
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import re
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[0]
NEON_RAW = ROOT / "raw" / "regimes" / "neon"
AOP = ROOT / "raw" / "towers" / "aop"
WHY = ROOT / "raw" / "towers" / "why"
ROWS = ROOT / "raw" / "towers" / "rows"
API = "https://data.neonscience.org/api/v0"
DP = "DP1.30003.001"
LIMIT_GB = 12.0
R_PICK = 262.0          # m: tiles touching this disc are fetched (250 m + a ground-model margin)
RADII = (50, 100, 250)
SECTOR_R = (3.0, 250.0)
SECTORS = [i * 45 for i in range(8)]
NOISE = (7, 18)
SITES = ("ABBY BART BONA CLBJ DEJU DELA GRSM HARV JERC LENO MLBS ORNL OSBS RMNP SCBI SERC SOAP STEI "
         "TALL TEAK TREE UKFS UNDE WREF YELL").split()
# other networks' towers inside a NEON flight: stem -> parent NEON site
EXTRA = {"HF-EMS": "HARV", "AMF-US-Prr": "BONA"}
TILE_RE = re.compile(r"_(\d{5,7})_(\d{6,8})_classified_point_cloud(_colorized)?\.laz$")


# ---------------------------------------------------------------- API (own small client: no shared log)

def token() -> str:
    t = os.environ.get("NEON_TOKEN")
    if t:
        return t
    import winreg
    return winreg.QueryValueEx(winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment"), "NEON_TOKEN")[0]


class Api:
    def __init__(self) -> None:
        import requests
        self.s = requests.Session()
        self.s.headers["X-API-Token"] = token()
        self.dl = requests.Session()
        self.calls = 0

    def get(self, path: str, cache: Path) -> dict | None:
        if cache.exists():
            return json.loads(cache.read_text())
        for attempt in range(5):
            try:
                r = self.s.get(f"{API}/{path}", timeout=120)
            except Exception as e:  # noqa: BLE001
                print(f"  ! {path}: {type(e).__name__}, retry {attempt + 1}")
                time.sleep(5 * (attempt + 1))
                continue
            self.calls += 1
            rem = r.headers.get("X-Ratelimit-Remaining")
            if rem is not None and int(rem) < 30:
                time.sleep(max(float(r.headers.get("X-Ratelimit-Reset", 10)), 10))
            if r.status_code == 200:
                d = r.json().get("data")
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps(d))
                return d
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(float(r.headers.get("Retry-After", 10 * (attempt + 1))))
                continue
            print(f"  ! {path}: HTTP {r.status_code}")
            return None
        return None

    def fetch(self, url: str, out: Path, size: int | None) -> tuple[str, int]:
        if out.exists() and (size is None or out.stat().st_size == size):
            return "have", out.stat().st_size
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(out.suffix + ".part")
        err = ""
        for attempt in range(4):
            try:
                with self.dl.get(url, timeout=600, stream=True) as g:
                    g.raise_for_status()
                    with open(tmp, "wb") as fh:
                        for ch in g.iter_content(1 << 20):
                            fh.write(ch)
                n = tmp.stat().st_size
                if size is not None and n != size:
                    raise IOError(f"size {n} != {size}")
                tmp.replace(out)
                return "got", n
            except Exception as e:  # noqa: BLE001
                err = f"{type(e).__name__}: {str(e)[:80]}"
                time.sleep(3 * (attempt + 1))
        if tmp.exists():
            tmp.unlink()
        return f"fail ({err})", 0


# ---------------------------------------------------------------- locations

def neon_tower(site: str) -> tuple[float, float, int]:
    a = json.loads((NEON_RAW / site / "DP3.30015.001" / "aop.json").read_text())
    return float(a["tower_xy"][0]), float(a["tower_xy"][1]), int(a["epsg"])


def rows_latlon(stem: str) -> tuple[float, float] | None:
    f = ROWS / f"{stem}.csv.gz"
    if not f.exists():
        return None
    d = pd.read_csv(f, nrows=5, usecols=["lat", "lon"])
    return float(d.lat.iloc[0]), float(d.lon.iloc[0])


def locations(site: str) -> list[tuple[str, float, float]]:
    """(stem, x, y) in the site's UTM: the NEON tower and any other-network tower assigned to it."""
    x, y, epsg = neon_tower(site)
    out = [(f"NEON-{site}", x, y)]
    for stem, parent in EXTRA.items():
        if parent != site:
            continue
        ll = rows_latlon(stem)
        if ll is None:
            continue
        from pyproj import Transformer
        ex, ey = Transformer.from_crs(4326, epsg, always_xy=True).transform(ll[1], ll[0])
        out.append((stem, float(ex), float(ey)))
    return out


MIN_SHARE = 0.015   # a tile holding less of the 250 m disc than this is left out (saves ~1.9 GB; the sliver is no data)


def disc_share(e0: int, n0: int, x: float, y: float, r: float = 250.0) -> float:
    g = np.mgrid[-r:r:2.0, -r:r:2.0]
    d = np.hypot(g[0], g[1]) <= r
    px, py = x + g[1][d], y + g[0][d]
    return float(((px >= e0) & (px < e0 + 1000) & (py >= n0) & (py < n0 + 1000)).mean())


def touches(e0: int, n0: int, x: float, y: float, r: float) -> bool:
    dx = max(e0 - x, 0, x - (e0 + 1000))
    dy = max(n0 - y, 0, y - (n0 + 1000))
    return dx * dx + dy * dy <= r * r


# ---------------------------------------------------------------- list / pull

def candidate(api: "Api", site: str, m: str, locs: list) -> dict | None:
    """One flight's pick: the classified tiles touching R_PICK round each location, or None
    when no tile lies under the NEON tower."""
    d = api.get(f"data/{DP}/{site}/{m}", AOP / site / f"listing-{m}.json")
    if not d:
        return None
    tiles = {}
    for f in d.get("files", []):
        t = TILE_RE.search(f["name"])
        if not t:
            continue
        key = (int(t.group(1)), int(t.group(2)))
        # one file per tile: the smaller (plain over colorized)
        if key not in tiles or (f.get("size") or 0) < (tiles[key].get("size") or 0):
            tiles[key] = f
    _, x, y = locs[0]
    if not any(e0 <= x < e0 + 1000 and n0 <= y < n0 + 1000 for (e0, n0) in tiles):
        return None
    per_loc = {}
    for stem, x, y in locs:
        ks = [k for k in tiles if touches(k[0], k[1], x, y, R_PICK) and disc_share(k[0], k[1], x, y) >= MIN_SHARE]
        covered = any(e0 <= x < e0 + 1000 and n0 <= y < n0 + 1000 for (e0, n0) in ks)
        per_loc[stem] = dict(x=x, y=y, tiles=[tiles[k]["name"] for k in ks] if covered else [], covered=covered)
    need = sorted({n for v in per_loc.values() for n in v["tiles"]})
    files = {tiles[k]["name"]: dict(url=tiles[k]["url"], size=tiles[k].get("size")) for k in tiles if tiles[k]["name"] in need}
    return dict(site=site, month=m, release=d.get("release"), epsg=neon_tower(site)[2], locations=per_loc,
                files={n: dict(size=v["size"]) for n, v in files.items()},
                bytes=int(sum(v["size"] or 0 for v in files.values())), urls={n: v["url"] for n, v in files.items()})


# deciduous share (floor.DECID) under which an April flight still shows the stand in leaf
EVERGREEN = {"JERC", "OSBS", "WREF", "ABBY", "TEAK", "SOAP", "YELL", "RMNP", "BONA", "DEJU"}
SITE_CAP_GB = 0.65     # per site: the latest leaf-on flight at or under this, else the smallest of the last LOOK
LOOK = 3


def leaf_on_month(site: str, m: str) -> bool:
    mo = int(m[5:7])
    return 5 <= mo <= 9 or (mo == 4 and site in EVERGREEN)


def do_list(sites: list[str]) -> None:
    """Per site: the latest leaf-on flight (May-Sep; April only in evergreen stands) whose tiles
    come to SITE_CAP_GB or less, else the smallest of the latest LOOK leaf-on flights: the
    newest flights' denser clouds would take the pull past LIMIT_GB (20 GB for the latest of
    every site, listed 2026-10-16)."""
    api = Api()
    prod = api.get(f"products/{DP}", AOP / "products.json")
    avail = {x["siteCode"]: x["availableMonths"] for x in (prod or {}).get("siteCodes", [])}
    total = 0
    for site in sites:
        months = [m for m in sorted(avail.get(site, []), reverse=True) if leaf_on_month(site, m)]
        locs = locations(site)
        cands = []
        for m in months[:LOOK]:
            c = candidate(api, site, m, locs)
            if c is None:
                print(f"{site} {m}: no classified tile under the tower")
                continue
            cands.append(c)
            if c["bytes"] <= SITE_CAP_GB * 1e9:
                break
        if not cands:
            print(f"{site}: no usable flight")
            continue
        fit = [c for c in cands if c["bytes"] <= SITE_CAP_GB * 1e9]
        picked = fit[0] if fit else min(cands, key=lambda c: c["bytes"])
        picked["why"] = ("latest leaf-on flight" if picked is cands[0] else
                         f"latest leaf-on flight {cands[0]['month']} is {cands[0]['bytes'] / 1e9:.2f} GB; "
                         + ("the latest at or under the site cap" if fit else "the smallest of the last few"))
        picked["considered"] = {c["month"]: round(c["bytes"] / 1e9, 3) for c in cands}
        urls = picked.pop("urls")
        (AOP / site / f"urls-{picked['month']}.json").write_text(json.dumps(urls))
        (AOP / site / "manifest.json").write_text(json.dumps(picked, indent=1))
        total += picked["bytes"]
        print(f"{site} {picked['month']} ({picked['release']}): {len(picked['files'])} tiles, "
              f"{picked['bytes'] / 1e9:.2f} GB [{picked['why']}]; " + "; ".join(
                  f"{s} {'covered' if v['covered'] else 'NOT covered'}" for s, v in picked["locations"].items()))
    print(f"total to fetch {total / 1e9:.2f} GB, {api.calls} API calls this run")


def on_disk() -> int:
    return sum(f.stat().st_size for f in AOP.rglob("*.laz"))


def do_pull(sites: list[str]) -> None:
    api = None
    for site in sites:
        mf = AOP / site / "manifest.json"
        if not mf.exists():
            continue
        man = json.loads(mf.read_text())
        urls_f = AOP / site / f"urls-{man['month']}.json"
        for name, v in man["files"].items():
            out = AOP / site / man["month"] / name
            if out.exists() and out.stat().st_size == v["size"]:
                continue
            if (on_disk() + (v["size"] or 0)) / 1e9 > LIMIT_GB:
                print(f"STOP: {name} would take the AOP folder past {LIMIT_GB} GB ({on_disk() / 1e9:.2f} GB now)")
                return
            if api is None:
                api = Api()
            urls = json.loads(urls_f.read_text())
            t0 = time.time()
            st, n = api.fetch(urls[name], out, v["size"])
            if st.startswith("fail"):
                # signed url expired: list again (one call) and retry once
                (AOP / site / f"listing-{man['month']}.json").unlink(missing_ok=True)
                d = api.get(f"data/{DP}/{site}/{man['month']}", AOP / site / f"listing-{man['month']}.json")
                fresh = {f["name"]: f["url"] for f in (d or {}).get("files", []) if f["name"] in man["files"]}
                urls_f.write_text(json.dumps(fresh))
                st, n = api.fetch(fresh.get(name, ""), out, v["size"])
            print(f"{site} {name}: {st} {n / 1e6:.0f} MB in {time.time() - t0:.0f} s; folder {on_disk() / 1e9:.2f} GB", flush=True)
    print(f"AOP folder {on_disk() / 1e9:.2f} GB")


# ---------------------------------------------------------------- measuring

def read_disc(files: list[Path], x: float, y: float, r: float) -> dict:
    import laspy
    keep = {k: [] for k in ("x", "y", "z", "c", "rn", "nr", "t")}
    for f in files:
        with laspy.open(f) as fh:
            adj = bool(fh.header.global_encoding.gps_time_type) if hasattr(fh.header.global_encoding, "gps_time_type") else True
            for ch in fh.chunk_iterator(4_000_000):
                px, py = np.asarray(ch.x), np.asarray(ch.y)
                m = (px - x) ** 2 + (py - y) ** 2 <= r * r
                if not m.any():
                    continue
                c = np.asarray(ch.classification)[m]
                ok = ~np.isin(c, NOISE) & ~np.asarray(ch.withheld, dtype=bool)[m]
                keep["x"].append(px[m][ok]); keep["y"].append(py[m][ok]); keep["z"].append(np.asarray(ch.z)[m][ok])
                keep["c"].append(c[ok]); keep["rn"].append(np.asarray(ch.return_number)[m][ok])
                keep["nr"].append(np.asarray(ch.number_of_returns)[m][ok])
                if "gps_time" in ch.point_format.dimension_names:
                    keep["t"].append(np.asarray(ch.gps_time)[m][ok][::200])
    out = {k: (np.concatenate(v) if v else np.array([])) for k, v in keep.items()}
    out["adjusted_gps"] = adj
    return out


def ground_grid(px, py, pz, cls, x0, y0, n, res=1.0):
    """1 m ground from class-2 returns: cell means, gaps filled linearly, nearest at the rim."""
    from scipy.interpolate import griddata
    g = cls == 2
    ix = ((px[g] - x0) / res).astype(int)
    iy = ((py[g] - y0) / res).astype(int)
    ok = (ix >= 0) & (ix < n) & (iy >= 0) & (iy < n)
    s = np.zeros((n, n)); c = np.zeros((n, n))
    np.add.at(s, (iy[ok], ix[ok]), pz[g][ok])
    np.add.at(c, (iy[ok], ix[ok]), 1)
    G = np.where(c > 0, s / np.maximum(c, 1), np.nan)
    have = np.isfinite(G)
    if have.all():
        return G, 1.0
    yy, xx = np.nonzero(have)
    # thin the known cells for speed: every cell is fine up to ~300k
    step = max(1, int(len(yy) // 300000))
    pts = np.c_[yy[::step], xx[::step]]
    vals = G[have][::step]
    my, mx = np.nonzero(~have)
    fill = griddata(pts, vals, np.c_[my, mx], method="linear")
    bad = ~np.isfinite(fill)
    if bad.any():
        fill[bad] = griddata(pts, vals, np.c_[my[bad], mx[bad]], method="nearest")
    G[my, mx] = fill
    return G, float(have.mean())


def bilinear(G, x0, y0, px, py, res=1.0):
    from scipy.ndimage import map_coordinates
    return map_coordinates(G, [(py - y0) / res - 0.5, (px - x0) / res - 0.5], order=1, mode="nearest")


def dtm_check(site: str, x: float, y: float, G: np.ndarray, x0: float, y0: float, n: int) -> dict:
    import rasterio
    a = NEON_RAW / site / "DP3.30024.001" / "aop.json"
    if not a.exists():
        return {}
    m = json.loads(a.read_text())
    diffs = []
    for t in m["tiles"]:
        f = NEON_RAW / site / "DP3.30024.001" / m["month"] / t
        if not f.exists():
            continue
        with rasterio.open(f) as r:
            b = r.bounds
            if b.right < x - 250 or b.left > x + 250 or b.top < y - 250 or b.bottom > y + 250:
                continue
            D = r.read(1).astype(float)
            if r.nodata is not None:
                D[D == r.nodata] = np.nan
            # cell centres of our grid inside this tile
            cx = x0 + np.arange(n) + 0.5
            cy = y0 + np.arange(n) + 0.5
            XX, YY = np.meshgrid(cx, cy)
            inside = (XX > b.left) & (XX < b.right) & (YY > b.bottom) & (YY < b.top) & ((XX - x) ** 2 + (YY - y) ** 2 <= 250 ** 2)
            cols = ((XX[inside] - b.left) / r.res[0]).astype(int)
            rows = ((b.top - YY[inside]) / r.res[1]).astype(int)
            dv = D[rows, cols]
            diffs.append(G[inside] - dv)
    if not diffs:
        return {}
    dd = np.concatenate(diffs)
    dd = dd[np.isfinite(dd)]
    return dict(dtm_month=m["month"], dtm_med_diff=round(float(np.median(dd)), 3),
                dtm_med_absdiff=round(float(np.median(np.abs(dd))), 3))


def measure(hag, cls, rn, inreg, chm_cells, area_m2, bush_cells) -> dict:
    """Features over one region: hag/cls/rn of its returns (inreg mask), its 1 m CHM cells, its 10 m bush cells."""
    z = hag[inreg]
    c = cls[inreg]
    first = rn[inreg] == 1
    n = len(z)
    out = dict(n_returns=int(n), density=round(n / area_m2, 2))
    if n < 200:
        return out
    cv = chm_cells[np.isfinite(chm_cells)]
    h = float(np.percentile(cv, 90)) if cv.size else np.nan
    out.update(h=h, chm_gap=float((cv < 2).mean()) if cv.size else np.nan,
               chm_sd=float(cv.std()) if cv.size else np.nan, chm_mean=float(cv.mean()) if cv.size else np.nan)
    e3, e4 = max(5.0, 0.5 * h), max(5.0, h)
    edges = [-np.inf, 0.5, 2.0, 5.0, e3, e4, np.inf]
    names = ["b_0_05", "b_05_2", "b_2_5", "b_5_halfh", "b_halfh_h", "b_above_h"]
    cnt = np.histogram(z, bins=edges)[0]
    for k, v in zip(names, cnt):
        out[k] = float(v / n)
    below = lambda t: float((z < t).sum())
    out["nrd_05_2"] = float(((z >= 0.5) & (z < 2)).sum() / max(below(2), 1))
    out["nrd_2_5"] = float(((z >= 2) & (z < 5)).sum() / max(below(5), 1))
    out["nrd_05_3"] = float(((z >= 0.5) & (z < 3)).sum() / max(below(3), 1))
    out["bush_nrd"] = float(np.nanmean(bush_cells)) if np.isfinite(bush_cells).any() else np.nan
    up = z[z > 2]
    if up.size >= 50:
        out["cbh10"], out["cbh25"] = (float(v) for v in np.quantile(up, [0.10, 0.25]))
        out["depth10"], out["depth25"] = h - out["cbh10"], h - out["cbh25"]
        out["cbh25_rel"] = out["cbh25"] / h if h > 0 else np.nan
    a1 = (z >= 1).sum()
    out["trunk_open"] = float(1 - ((z >= 1) & (z < 0.5 * h)).sum() / a1) if a1 and 0.5 * h > 1 else np.nan
    g_all = (c == 2).sum() / n
    out["gap_all"] = float(g_all)
    out["lai_all"] = float(-np.log(max(g_all, 1e-3)))
    nf = first.sum()
    if nf:
        g1 = ((c == 2) & first).sum() / nf
        out["gap_first"] = float(g1)
        out["lai_first"] = float(-np.log(max(g1, 1e-3)))
    return out


def gps_date(t: np.ndarray, adjusted: bool) -> str | None:
    if t.size == 0:
        return None
    s = float(np.median(t)) + (1e9 if adjusted else 0)
    if not adjusted and s < 7 * 86400:  # GPS week seconds: no date
        return None
    return (dt.datetime(1980, 1, 6) + dt.timedelta(seconds=s)).strftime("%Y-%m-%d")


def do_features(sites: list[str]) -> pd.DataFrame:
    sys.path.insert(0, str(HERE))
    import neon
    rows = []
    for site in sites:
        mf = AOP / site / "manifest.json"
        if not mf.exists():
            continue
        man = json.loads(mf.read_text())
        cap = neon.chm_cap(site)
        for stem, loc in man["locations"].items():
            if not loc["covered"]:
                print(f"{stem}: not inside {site}'s flight")
                continue
            files = [AOP / site / man["month"] / n for n in loc["tiles"]]
            if not all(f.exists() for f in files):
                print(f"{stem}: tiles missing, skipped")
                continue
            t0 = time.time()
            x, y = loc["x"], loc["y"]
            P = read_disc(files, x, y, R_PICK)
            # a tile can be named for a square the flight only partly covers (US-Prr sits under BONA's box edge)
            near = np.hypot(P["x"] - x, P["y"] - y) <= 50
            cells50 = len(np.unique((P["x"][near] - x + 50).astype(int) * 101 + (P["y"][near] - y + 50).astype(int)))
            if cells50 < 0.8 * math.pi * 50 ** 2 or (P["c"] == 2).sum() < 1000:
                print(f"{stem}: the flight covers {cells50 / (math.pi * 2500):.0%} of the 50 m disc, skipped")
                continue
            n = int(2 * R_PICK)
            x0, y0 = x - R_PICK, y - R_PICK
            G, gcov = ground_grid(P["x"], P["y"], P["z"], P["c"], x0, y0, n)
            hag = P["z"] - bilinear(G, x0, y0, P["x"], P["y"])
            ok = (hag >= -1) & (hag <= cap)
            for k in ("x", "y", "z", "c", "rn", "nr"):
                P[k] = P[k][ok]
            hag = hag[ok]
            dx, dy = P["x"] - x, P["y"] - y
            dist = np.hypot(dx, dy)
            brg = np.degrees(np.arctan2(dx, dy)) % 360
            # 1 m CHM: max return height per cell
            ix = np.clip(((P["x"] - x0)).astype(int), 0, n - 1)
            iy = np.clip(((P["y"] - y0)).astype(int), 0, n - 1)
            chm = np.full(n * n, -np.inf)
            np.maximum.at(chm, iy * n + ix, hag)
            chm = chm.reshape(n, n)
            chm[~np.isfinite(chm)] = np.nan
            chm = np.maximum(chm, 0)
            cxx = x0 + np.arange(n) + 0.5 - x
            cyy = y0 + np.arange(n) + 0.5 - y
            CX, CY = np.meshgrid(cxx, cyy)
            cd = np.hypot(CX, CY)
            cb = np.degrees(np.arctan2(CX, CY)) % 360
            # 10 m bush cells (build_vegstructure's understory: 0.5-3 / -1-3, 50+ returns)
            nb = n // 10
            bx = np.clip((P["x"] - x0) // 10, 0, nb - 1).astype(int)
            by = np.clip((P["y"] - y0) // 10, 0, nb - 1).astype(int)
            reach = np.bincount(by * nb + bx, weights=(hag < 3), minlength=nb * nb)
            layer = np.bincount(by * nb + bx, weights=(hag >= 0.5) & (hag < 3), minlength=nb * nb)
            bush = np.where(reach >= 50, layer / np.maximum(reach, 1), np.nan).reshape(nb, nb)
            bcx = x0 + (np.arange(nb) + 0.5) * 10 - x
            bcy = y0 + (np.arange(nb) + 0.5) * 10 - y
            BX, BY = np.meshgrid(bcx, bcy)
            bd = np.hypot(BX, BY)
            bbrg = np.degrees(np.arctan2(BX, BY)) % 360
            date = gps_date(P["t"], P["adjusted_gps"])
            chk = dtm_check(site, x, y, G, x0, y0, n)
            base = dict(stem=stem, site=site, flight_month=man["month"], flight_date=date, release=man["release"],
                        tiles=len(files), ground_cover=round(gcov, 3), **chk)

            def sec_mask(b, s0, r0, r1, dd):
                return (np.abs(((b - s0 + 180) % 360) - 180) <= 22.5) & (dd >= r0) & (dd <= r1)
            for r in RADII:
                m = dist <= r
                rows.append(dict(base, region=f"r{r}", **measure(hag, P["c"], P["rn"], m, chm[cd <= r],
                                                                    math.pi * r * r, bush[bd <= r])))
            for s in SECTORS:
                m = sec_mask(brg, s, *SECTOR_R, dist)
                area = math.pi * (SECTOR_R[1] ** 2 - SECTOR_R[0] ** 2) / 8
                rows.append(dict(base, region=f"s{s}", **measure(hag, P["c"], P["rn"], m,
                                                                 chm[sec_mask(cb, s, *SECTOR_R, cd)], area,
                                                                 bush[sec_mask(bbrg, s, *SECTOR_R, bd)])))
            r100 = rows[-10]
            print(f"{stem} {man['month']} ({date}): {len(hag) / 1e6:.1f} M returns, ground cells {gcov:.0%}, "
                  f"DTM diff {chk.get('dtm_med_diff')} m | r100 h {r100.get('h', np.nan):.1f} gap {r100.get('chm_gap', np.nan):.2f} "
                  f"b05_2 {r100.get('b_05_2', np.nan):.3f} nrd05_2 {r100.get('nrd_05_2', np.nan):.2f} cbh25 {r100.get('cbh25', np.nan):.1f} "
                  f"trunk_open {r100.get('trunk_open', np.nan):.2f} lai {r100.get('lai_first', np.nan):.2f} | {time.time() - t0:.0f} s", flush=True)
    df = pd.DataFrame(rows)
    WHY.mkdir(parents=True, exist_ok=True)
    if len(df):
        prev = WHY / "aop_structure.csv"
        if prev.exists() and sites != SITES:
            old = pd.read_csv(prev)
            df = pd.concat([old[~old.site.isin(sites)], df], ignore_index=True)
        df.to_csv(prev, index=False, float_format="%.4g")
    return df


def main() -> None:
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x00004000)
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    sites = [s.upper() for s in sys.argv[2:]] or SITES
    if cmd in ("list", "all"):
        do_list(sites)
    if cmd in ("pull", "all"):
        do_pull(sites)
    if cmd in ("features", "all"):
        do_features(sites)


if __name__ == "__main__":
    main()
