"""NEON forested towers: pull the 30-min wind and temperature at every tower level plus the
AOP LiDAR around each tower, then write the shared tower rows (floor against top).

Working version of pipeline/raw/regimes/neon/fetch_neon.py (left as it was).

    py -3.14 pipeline/towers/neon.py pull  [SITES...]   # tower files + AOP tiles (resumable)
    py -3.14 pipeline/towers/neon.py tower [SITES...]   # tower files only
    py -3.14 pipeline/towers/neon.py aop   [SITES...]   # AOP CHM + DTM tiles only
    py -3.14 pipeline/towers/neon.py rows  [SITES...]   # raw/towers/rows/NEON-<SITE>.csv.gz

Products (30-min, basic package, Sep-Nov 2017-2025):
  DP1.00001.001  2D wind, every 2D sonic level (2DWSD_30min) + sensor_positions
  DP1.00002.001  single-aspirated air temperature, levels below the top (SAAT_30min) + positions
  DP1.00003.001  triple-aspirated air temperature at the tower top (TAAT_30min) + positions;
                 added because SAAT stops one level short of the top, which at tall stands
                 leaves a single level above the canopy
AOP, latest flight per site: DP3.30015.001 (CHM) and DP3.30024.001 (DTM), the 1 km tiles
that touch a box centred on the tower: 3 km x 3 km for the DTM, 4 km x 4 km for the CHM
(upwind fetch through trees out to 2 km).

Files land in pipeline/raw/regimes/neon/<SITE>/<DP>/<YYYY-MM>/<name>; a file already present
with the listed size is skipped. Progress goes to pipeline/raw/regimes/neon/pull.log.

NEON needs an API token (header X-API-Token) since 2026-06-30: NEON_TOKEN from the process
environment, else from the Windows user environment. It is never printed or written.

Rows (same format as pipeline/towers/rows.py; site = "NEON-<SITE>", t_utc = start of the
half-hour, "2019-09-01T00:30Z"): one per 30 min with both wind speeds present, Sep-Nov.
Floor and top follow fit.py: floor = the lowest level in 1.4-3.1 m, else in 1.0-4.5 m, else
the lowest level over 1 m (flagged); top = the lowest 2D level above 1.1 x canopy height,
else the highest 2D level (flagged). canopy_h = the 90th percentile of the CHM within 100 m
of the tower, the height of the crowns' tops (the all-pixel median under 10% cover; artifacts
over chm_cap() masked), else NEON's DistZaxsCnpy. The plain median reads 0-3 m in open
stands (JERC, SOAP, YELL, BONA) and the tree-pixel median 40% low in spruce, which put the
"top" inside the crowns and disagreed with AmeriFlux's height for the same towers; the p90
is within 15% of NEON's surveyed DistZaxsCnpy at most towers. Both medians are kept in
<SITE>/rows.json and raw/towers/sites/. ta_hi = the highest temperature level (TAAT top); ta_lo = the lowest
level at or above the canopy height that is at least 2 m under ta_hi, else the highest
level below that (the crowns). Wind speeds with
windSpeedFinalQF = 1 are dropped, and their directions with them; windDirFinalQF (mostly the
tower-wake sector) is kept aside in <SITE>/wd_qf.csv.gz, not applied. Directions are
meteorological "from", degrees from north, as NEON publishes them.
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import sys
import threading
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "regimes" / "neon"
ROWS = ROOT / "raw" / "towers" / "rows"
LOG = RAW / "pull.log"
API = "https://data.neonscience.org/api/v0"

SITES = ("BART HARV SCBI SERC OSBS JERC UNDE STEI TREE UKFS ORNL GRSM MLBS TALL DELA LENO "
         "RMNP YELL NIWO WREF ABBY SOAP TEAK BONA DEJU HEAL CLBJ").split()
MONTHS = [f"{y}-{m:02d}" for y in range(2017, 2026) for m in (9, 10, 11)]
TOWER = {"DP1.00001.001": r"2DWSD_30min|sensor_positions",
         "DP1.00002.001": r"SAAT_30min|sensor_positions",
         "DP1.00003.001": r"TAAT_30min|sensor_positions"}
AOP = {"DP3.30015.001": "CHM", "DP3.30024.001": "DTM"}
BOX = {"DP3.30015.001": 2000.0, "DP3.30024.001": 1500.0}   # half-width of the LiDAR box, m (CHM wider: 2 km fetch)
WORKERS = 4           # downloads at once

COLS = ["site", "t_utc", "lat", "lon", "canopy_h", "z_top", "ws_top", "wd_top", "z_floor", "ws_floor",
        "wd_floor", "ta_hi", "z_ta_hi", "ta_lo", "z_ta_lo", "ustar", "h_flux"]

_log_lock = threading.Lock()


def log(msg: str) -> None:
    line = f"{dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    with _log_lock:
        print(line, flush=True)
        RAW.mkdir(parents=True, exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")


def token() -> str:
    t = os.environ.get("NEON_TOKEN")
    if t:
        return t
    import winreg
    return winreg.QueryValueEx(winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment"), "NEON_TOKEN")[0]


class Neon:
    """API calls with the token, rate-limit watching and retries; file downloads in a pool."""

    def __init__(self) -> None:
        self.s = requests.Session()
        self.s.headers["X-API-Token"] = token()
        self.dl = requests.Session()          # file URLs are signed storage links: no token needed
        self.calls = 0

    def get(self, path: str, **params) -> dict | None:
        url = path if path.startswith("http") else f"{API}/{path}"
        for attempt in range(6):
            try:
                r = self.s.get(url, params=params or None, timeout=120)
            except requests.RequestException as e:
                log(f"  ! {path}: {type(e).__name__}, retry {attempt + 1}")
                time.sleep(5 * (attempt + 1)); continue
            self.calls += 1
            rem = r.headers.get("X-Ratelimit-Remaining")
            if rem is not None and int(rem) < 50:
                wait = max(float(r.headers.get("X-Ratelimit-Reset", 10)), 10)
                log(f"  rate limit: {rem} left, waiting {wait:.0f} s")
                time.sleep(wait)
            if r.status_code == 200:
                return r.json().get("data")
            if r.status_code in (429, 500, 502, 503, 504):
                wait = float(r.headers.get("Retry-After", 10 * (attempt + 1)))
                log(f"  ! {path}: HTTP {r.status_code}, waiting {wait:.0f} s")
                time.sleep(wait); continue
            log(f"  ! {path}: HTTP {r.status_code}")
            return None
        log(f"  ! {path}: gave up")
        return None

    def fetch(self, url: str, out: Path, size: int | None) -> tuple[str, int]:
        """Download url to out unless it is already there with the right size."""
        if out.exists() and (size is None or out.stat().st_size == size):
            return "have", out.stat().st_size
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(out.suffix + ".part")
        for attempt in range(4):
            try:
                with self.dl.get(url, timeout=300, stream=True) as g:
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


def available(nn: Neon, dp: str) -> dict[str, list[str]]:
    d = nn.get(f"products/{dp}")
    return {x["siteCode"]: x["availableMonths"] for x in (d or {}).get("siteCodes", [])}


def site_meta(nn: Neon, site: str) -> dict:
    """Site properties (canopy height, displacement, UTM zone) and the tower's own position."""
    f = RAW / site / "site.json"
    if f.exists():
        return json.loads(f.read_text())
    d = nn.get(f"locations/{site}") or {}
    props = {p["locationPropertyName"].replace("Value for ", ""): p["locationPropertyValue"]
             for p in d.get("locationProperties", [])}
    meta = {"site": site, "name": d.get("locationDescription"), "lat": d.get("locationDecimalLatitude"),
            "lon": d.get("locationDecimalLongitude"), "elev": d.get("locationElevation"),
            "utm_zone": props.get("UTM Zone"), "canopy_h": props.get("DistZaxsCnpy"),
            "displacement": props.get("DistZaxsDisp"), "type_eco": props.get("TypeEco"),
            "wind_primary": props.get("AngAzWindPrim"), "wind_secondary": props.get("AngAzWindScnd"),
            "timezone": props.get("Site Timezone")}
    towers = [c for c in d.get("locationChildren", []) if c.startswith("TOWER")]
    if towers:
        t = nn.get(f"locations/{towers[0]}") or {}
        meta.update(tower=towers[0], tower_lat=t.get("locationDecimalLatitude"),
                    tower_lon=t.get("locationDecimalLongitude"), tower_elev=t.get("locationElevation"),
                    tower_utm=(t.get("locationUtmEasting"), t.get("locationUtmNorthing"), t.get("locationUtmZone")))
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(meta, indent=1))
    return meta


def pull_tower(nn: Neon, sites: list[str], pool: cf.ThreadPoolExecutor) -> None:
    avail = {dp: available(nn, dp) for dp in TOWER}
    for site in sites:
        months = [m for m in MONTHS if m in avail["DP1.00001.001"].get(site, [])]
        if not months:
            log(f"{site}: no 2D wind in Sep-Nov 2017-2025, dropped"); continue
        site_meta(nn, site)
        man_f = RAW / site / "manifest.json"
        man = json.loads(man_f.read_text()) if man_f.exists() else {}
        jobs, n_list = [], 0
        for dp, pat in TOWER.items():
            for m in months:
                if m not in avail[dp].get(site, []):
                    continue
                key = f"{dp}/{m}"
                if man.get(key, {}).get("complete"):
                    continue
                d = nn.get(f"data/{dp}/{site}/{m}", package="basic"); n_list += 1
                if d is None:
                    continue
                files = [f for f in d["files"] if re.search(pat, f["name"])]
                man[key] = {"release": d.get("release"), "files": [f["name"] for f in files], "complete": not files}
                for f in files:
                    jobs.append((key, pool.submit(nn.fetch, f["url"], RAW / site / dp / m / f["name"], f.get("size"))))
        got = have = 0; bytes_ = 0; fails = []
        done_keys: dict[str, bool] = {}
        for key, fut in jobs:
            status, n = fut.result()
            if status == "got": got += 1; bytes_ += n
            elif status == "have": have += 1
            else: fails.append(f"{key}: {status}")
            done_keys[key] = done_keys.get(key, True) and status in ("got", "have")
        for key, ok in done_keys.items():
            man[key]["complete"] = ok
        man_f.write_text(json.dumps(man, indent=1))
        rel = sorted({v.get("release") for v in man.values() if v.get("release")})
        log(f"{site}: {len(months)} months, {n_list} listings, {got} files new ({bytes_ / 1e6:.1f} MB), "
            f"{have} had, {len(fails)} failed; releases {', '.join(rel)}; API calls so far {nn.calls}")
        for f in fails[:10]:
            log(f"  ! {site} {f}")


def tower_xy(site: str) -> tuple[float, float] | None:
    """Tower reference position from the 2D wind sensor_positions file (latest), else site.json."""
    sp = sorted((RAW / site / "DP1.00001.001").glob("*/*sensor_positions*.csv"))
    if sp:
        p = pd.read_csv(sp[-1])
        la = next((c for c in ("locationReferenceLatitude", "referenceLatitude") if c in p), None)
        lo = next((c for c in ("locationReferenceLongitude", "referenceLongitude") if c in p), None)
        if la and lo and p[la].notna().any():
            return float(p[la].dropna().iloc[-1]), float(p[lo].dropna().iloc[-1])
    f = RAW / site / "site.json"
    if f.exists():
        m = json.loads(f.read_text())
        if m.get("tower_lat"):
            return m["tower_lat"], m["tower_lon"]
    return None


def pull_aop(nn: Neon, sites: list[str], pool: cf.ThreadPoolExecutor) -> None:
    from pyproj import Transformer
    avail = {dp: available(nn, dp) for dp in AOP}
    for site in sites:
        meta = site_meta(nn, site)
        ll = tower_xy(site)
        if ll is None:
            log(f"{site} AOP: no tower position, skipped"); continue
        zone = meta.get("utm_zone") or ""
        zm = re.match(r"(\d+)([NS]?)", zone)
        if not zm:
            log(f"{site} AOP: no UTM zone, skipped"); continue
        epsg = (32600 if zm.group(2) != "S" else 32700) + int(zm.group(1))
        x, y = Transformer.from_crs(4326, epsg, always_xy=True).transform(ll[1], ll[0])
        for dp, kind in AOP.items():
            months = list(reversed(avail[dp].get(site, [])))
            if not months:
                log(f"{site} {kind}: not available"); continue
            for m in months[:4]:                       # latest flight, else the one before
                d = nn.get(f"data/{dp}/{site}/{m}")
                if d is None:
                    continue
                tiles = []
                for f in d["files"]:
                    t = re.search(rf"_(\d+)_(\d+)_{kind}\.tif$", f["name"])
                    if t:
                        e0, n0 = int(t.group(1)), int(t.group(2))
                        if e0 < x + BOX[dp] and e0 + 1000 > x - BOX[dp] and n0 < y + BOX[dp] and n0 + 1000 > y - BOX[dp]:
                            tiles.append((f, e0, n0))
                has_centre = any(e0 <= x < e0 + 1000 and n0 <= y < n0 + 1000 for _, e0, n0 in tiles)
                if not has_centre:
                    log(f"{site} {kind} {m}: {len(tiles)} tiles near the tower but none under it; trying an older flight")
                    continue
                futs = [pool.submit(nn.fetch, f["url"], RAW / site / dp / m / f["name"], f.get("size")) for f, _, _ in tiles]
                res = [fu.result() for fu in futs]
                got = sum(r[0] == "got" for r in res); had = sum(r[0] == "have" for r in res)
                mb = sum(r[1] for r in res if r[0] == "got") / 1e6
                bad = [r[0] for r in res if r[0] not in ("got", "have")]
                (RAW / site / dp / "aop.json").write_text(json.dumps(
                    {"month": m, "release": d.get("release"), "epsg": epsg, "tower_xy": [x, y],
                     "tiles": [f["name"] for f, _, _ in tiles]}, indent=1))
                log(f"{site} {kind} {m} ({d.get('release')}): {len(tiles)} tiles, {got} new ({mb:.1f} MB), "
                    f"{had} had, {len(bad)} failed")
                break
            else:
                log(f"{site} {kind}: no flight with a tile under the tower")


# ---------------------------------------------------------------- rows

def aop_files(site: str, dp: str) -> list[Path]:
    """The tiles of the flight recorded in <dp>/aop.json (other flights may sit beside it)."""
    f = RAW / site / dp / "aop.json"
    if not f.exists():
        return []
    m = json.loads(f.read_text())
    return sorted(RAW / site / dp / m["month"] / t for t in m["tiles"] if (RAW / site / dp / m["month"] / t).exists())


def _positions(site: str, dp: str) -> pd.DataFrame:
    """Position history from the newest-published sensor_positions file: it carries the full
    history, and older publications use other column names and some heights corrected since
    (SERC's level 2 read 0.29 m in the 2022 files, 3.81 m now)."""
    fs = list((RAW / site / dp).glob("*/*sensor_positions*.csv"))
    if not fs:
        return pd.DataFrame()
    def stamp(f: Path) -> str:
        m = re.search(r"sensor_positions\.(\d{8}T\d{6}Z)", f.name)
        return m.group(1) if m else ""
    p = pd.read_csv(max(fs, key=stamp), dtype={"HOR.VER": str})
    s0 = "positionStartDateTime" if "positionStartDateTime" in p else "start"
    s1 = "positionEndDateTime" if "positionEndDateTime" in p else "end"
    p["start"] = pd.to_datetime(p[s0], utc=True, errors="coerce")
    p["end"] = pd.to_datetime(p[s1], utc=True, errors="coerce")
    p = p[p["HOR.VER"].str.startswith("000.")]
    return p[["HOR.VER", "start", "end", "zOffset"]].drop_duplicates().sort_values(["HOR.VER", "start"])


def _z_series(pos: pd.DataFrame, hv: str, idx: pd.DatetimeIndex) -> pd.Series:
    """Height of one level at each time, from its position periods."""
    z = pd.Series(np.nan, index=idx)
    p = pos[pos["HOR.VER"] == hv]
    for _, r in p.iterrows():
        m = np.ones(len(idx), bool)
        if pd.notna(r.start):
            m &= idx >= r.start
        if pd.notna(r.end):
            m &= idx <= r.end
        z[m] = r.zOffset
    if len(p):
        z = z.fillna(float(p.zOffset.iloc[0]))
    return z


def _read_levels(site: str, dp: str, kind: str, cols: list[str]) -> dict[str, pd.DataFrame]:
    """{HOR.VER: frame indexed by start time} over all fetched months, tower HOR 000 only."""
    out: dict[str, list[pd.DataFrame]] = {}
    for f in sorted((RAW / site / dp).glob(f"*/*{kind}_30min*.csv")):
        m = re.search(r"\.(\d{3})\.(\d{3})\.030\." + kind, f.name)
        if not m or m.group(1) != "000":
            continue
        hv = f"{m.group(1)}.{m.group(2)}"
        d = pd.read_csv(f, usecols=lambda c: c in ["startDateTime"] + cols)
        d.index = pd.to_datetime(d.pop("startDateTime"), utc=True)
        out.setdefault(hv, []).append(d)
    return {hv: pd.concat(v).sort_index().loc[lambda x: ~x.index.duplicated()] for hv, v in out.items()}


def chm_cap(site: str) -> float:
    """Height above which a CHM pixel is an artifact (cloud, birds, the tower, wires): the larger
    of 1.3 x the 99th percentile over the whole box and 2 x NEON's canopy height. DEJU's 2025
    flight has a patch of 15-60 m pixels by the tower in a 6 m spruce stand."""
    import rasterio
    vals = []
    for f in aop_files(site, "DP3.30015.001"):
        with rasterio.open(f) as r:
            a = r.read(1, out_shape=(r.height // 10, r.width // 10)).astype(float)
            vals.append(a[a > -1])
    if not vals:
        return np.inf
    meta_f = RAW / site / "site.json"
    neon_h = 0.0
    if meta_f.exists():
        try:
            neon_h = float(json.loads(meta_f.read_text()).get("canopy_h") or 0)
        except ValueError:
            pass
    return float(max(1.3 * np.percentile(np.concatenate(vals), 99), 2 * neon_h, 5.0))


def chm_mosaic(site: str, half: float = 2000.0):
    """CHM at 1 m in a (2 half) m square on the tower, artifacts above chm_cap() set to NaN.
    Returns (array, x0, y_top, res, tower_x, tower_y, crs) or None."""
    import rasterio
    am = RAW / site / "DP3.30015.001" / "aop.json"
    fs = aop_files(site, "DP3.30015.001")
    if not fs or not am.exists():
        return None
    tx, ty = json.loads(am.read_text())["tower_xy"]
    x0, y1 = np.floor(tx - half), np.ceil(ty + half)
    n = int(round(2 * half))
    Z = np.full((n, n), np.nan, dtype=np.float32)
    crs = None
    for f in fs:
        with rasterio.open(f) as r:
            crs = r.crs
            a = r.read(1).astype(np.float32)
            a[a < -1] = np.nan
            if r.nodata is not None:
                a[a == r.nodata] = np.nan
            b = r.bounds
            c0, r0 = int(round(b.left - x0)), int(round(y1 - b.top))
            rs, cs = max(r0, 0), max(c0, 0)
            re_, ce = min(r0 + a.shape[0], n), min(c0 + a.shape[1], n)
            if re_ > rs and ce > cs:
                Z[rs:re_, cs:ce] = a[rs - r0:re_ - r0, cs - c0:ce - c0]
    cap = chm_cap(site)
    Z[Z > cap] = np.nan
    return Z, float(x0), float(y1), 1.0, float(tx), float(ty), crs


def chm_canopy(site: str, lat: float, lon: float, radius: float = 100.0) -> dict | None:
    """CHM within radius of the tower (artifacts masked): the median of the tree pixels (> 2 m),
    the all-pixel median and spread, and the cover over 2 m."""
    m = chm_mosaic(site, half=radius + 5)
    if m is None:
        return None
    Z, x0, y1, res, tx, ty, _ = m
    yy, xx = np.mgrid[0:Z.shape[0], 0:Z.shape[1]]
    sel = ((x0 + xx + 0.5 - tx) ** 2 + (y1 - yy - 0.5 - ty) ** 2 <= radius ** 2) & np.isfinite(Z)
    v = Z[sel].astype(float)
    if v.size < 100:
        return None
    t = v[v > 2]
    return {"tree_median": float(np.median(t)) if t.size else None, "median": float(np.median(v)),
            "p75": float(np.percentile(v, 75)), "p90": float(np.percentile(v, 90)),
            "cover_2m": float((v > 2).mean()), "n": int(v.size), "artifact_cap": chm_cap(site)}


def _pick_wind(lv: list[tuple[str, float]], hc: float | None) -> tuple:
    """Floor and top for one configuration of levels [(HOR.VER, z)], fit.py's rule."""
    lv = sorted(lv, key=lambda kv: kv[1]); notes = []
    band = [kv for kv in lv if 1.4 <= kv[1] <= 3.1] or [kv for kv in lv if 1.0 <= kv[1] <= 4.5]
    if band:
        fhv, zf = band[0]
    else:
        over = [kv for kv in lv if kv[1] > 1.0]
        fhv, zf = over[0] if over else (None, np.nan)
        notes.append(f"no level in 1-4.5 m; floor = lowest over 1 m ({zf:.2f} m)")
    above = [kv for kv in lv if hc is not None and kv[1] > 1.1 * hc and kv[1] > (zf if fhv else 0)]
    if above:
        thv, zt = above[0]
    else:
        thv, zt = lv[-1]
        notes.append(f"no 2D level above 1.1 x canopy ({hc:.1f} m); top = highest 2D level ({zt:.2f} m)")
    return fhv, zf, thv, zt, notes


def _pick_ta(lv: list, hc: float | None):
    """ta_hi = the highest level; ta_lo = the lowest at or above the canopy and >= 2 m under it,
    else the highest one >= 2 m under it (the crowns)."""
    if not lv:
        return None, None
    order = sorted(lv, key=lambda kv: kv[1])
    hi = order[-1]
    rest = [kv for kv in order[:-1] if kv[1] <= hi[1] - 2]
    above_c = [kv for kv in rest if hc is not None and kv[1] >= hc]
    lo = above_c[0] if above_c else (rest[-1] if rest else None)
    return hi, lo


def build_rows(site: str) -> dict | None:
    meta_f = RAW / site / "site.json"
    meta = json.loads(meta_f.read_text()) if meta_f.exists() else {}
    wpos = _positions(site, "DP1.00001.001")
    wind = _read_levels(site, "DP1.00001.001", "2DWSD",
                        ["windSpeedMean", "windSpeedFinalQF", "windDirMean", "windDirFinalQF"])
    if not wind or wpos.empty:
        print(site, "no wind files"); return None
    ll = tower_xy(site)
    lat, lon = ll if ll else (meta.get("lat"), meta.get("lon"))

    chm = chm_canopy(site, lat, lon)
    if chm:
        if chm["cover_2m"] >= 0.1:
            hc, hc_src = chm["p90"], "CHM p90 within 100 m (canopy top)"
        else:
            hc, hc_src = chm["median"], "CHM median within 100 m (under 10% tree cover)"
    else:
        hc = float(meta["canopy_h"]) if meta.get("canopy_h") not in (None, "NA") else None
        hc_src = "NEON DistZaxsCnpy" if hc is not None else "none"

    idx = pd.DatetimeIndex(sorted(set().union(*[w.index for w in wind.values()])))
    idx = idx[idx.month.isin((9, 10, 11))]
    hvs = sorted(wind)
    # Direction is kept wherever the speed passes: NEON's windDirFinalQF is mostly the
    # distorted-flow (tower wake) sector, ~120 deg wide at some floor booms, and dropping it
    # would censor exactly the half-hours when the floor follows a top from that side. The
    # flags go to <SITE>/wd_qf.csv.gz for a strict reading.
    W = {hv: wind[hv].reindex(idx) for hv in hvs}
    ws = pd.DataFrame({hv: W[hv].windSpeedMean.where(W[hv].windSpeedFinalQF != 1) for hv in hvs})
    wd = pd.DataFrame({hv: W[hv].windDirMean.where(W[hv].windSpeedFinalQF != 1) for hv in hvs})
    wq = pd.DataFrame({hv: W[hv].windDirFinalQF for hv in hvs})
    Zw = pd.DataFrame({hv: _z_series(wpos, hv, idx) for hv in hvs}).round(2)

    # temperature levels: SAAT (below the top) + TAAT (top)
    tpos = {"SAAT": _positions(site, "DP1.00002.001"), "TAAT": _positions(site, "DP1.00003.001")}
    temps = {("SAAT", hv): d for hv, d in _read_levels(site, "DP1.00002.001", "SAAT", ["tempSingleMean", "finalQF"]).items()}
    temps.update({("TAAT", hv): d for hv, d in _read_levels(site, "DP1.00003.001", "TAAT", ["tempTripleMean", "finalQF"]).items()})
    tkeys = [k for k in temps if not tpos[k[0]].empty]
    TA, Zt = {}, {}
    for k in tkeys:
        d = temps[k].reindex(idx)
        TA[k] = d["tempTripleMean" if k[0] == "TAAT" else "tempSingleMean"].where(d["finalQF"] != 1).values
        Zt[k] = _z_series(tpos[k[0]], k[1], idx).round(2).values

    cols = {c: np.full(len(idx), np.nan) for c in ("z_top", "ws_top", "wd_top", "qf_top", "z_floor", "ws_floor",
                                                    "wd_floor", "qf_floor", "ta_hi", "z_ta_hi", "ta_lo", "z_ta_lo")}
    configs = []
    wkey = pd.Series(list(map(tuple, Zw.values)), index=idx)
    for key in sorted(set(wkey)):
        pos_i = np.flatnonzero((wkey == key).values)
        fhv, zf, thv, zt, notes = _pick_wind(list(zip(hvs, key)), hc)
        if fhv is None or fhv == thv:
            continue
        for c, (frame, hv) in {"ws_top": (ws, thv), "wd_top": (wd, thv), "qf_top": (wq, thv), "ws_floor": (ws, fhv),
                               "wd_floor": (wd, fhv), "qf_floor": (wq, fhv)}.items():
            cols[c][pos_i] = frame[hv].values[pos_i]
        cols["z_top"][pos_i] = zt; cols["z_floor"][pos_i] = zf
        configs.append({"from": str(idx[pos_i].min())[:10], "to": str(idx[pos_i].max())[:10], "halfhours": int(len(pos_i)),
                        "levels": dict(zip(hvs, map(float, key))), "floor": [fhv, zf], "top": [thv, zt], "notes": notes})
    tconf = []
    if tkeys:
        tkey = pd.Series(list(zip(*[Zt[k] for k in tkeys])), index=idx)
        for key in sorted(set(tkey)):
            pos_i = np.flatnonzero((tkey == key).values)
            hi, lo = _pick_ta(list(zip(tkeys, key)), hc)
            for name, kz in (("ta_hi", hi), ("ta_lo", lo)):
                if kz is None:
                    continue
                cols[name][pos_i] = TA[kz[0]][pos_i]
                cols["z_" + name][pos_i] = kz[1]
            tconf.append({"from": str(idx[pos_i].min())[:10], "to": str(idx[pos_i].max())[:10], "halfhours": int(len(pos_i)),
                          "ta_hi": [" ".join(hi[0]), float(hi[1])] if hi else None,
                          "ta_lo": [" ".join(lo[0]), float(lo[1])] if lo else None})
    df = pd.DataFrame(cols, index=idx)
    n_all = int((df[["z_top", "z_floor"]].notna().all(axis=1)).sum())
    df = df[df.ws_top.notna() & df.ws_floor.notna()]
    out = pd.DataFrame({
        "site": f"NEON-{site}",
        "t_utc": df.index.strftime("%Y-%m-%dT%H:%MZ"),
        "lat": round(lat, 6), "lon": round(lon, 6),
        "canopy_h": round(hc, 2) if hc is not None else np.nan,
        "z_top": df.z_top.values, "ws_top": df.ws_top.values, "wd_top": df.wd_top.values,
        "z_floor": df.z_floor.values, "ws_floor": df.ws_floor.values, "wd_floor": df.wd_floor.values,
        "ta_hi": df.ta_hi.values, "z_ta_hi": df.z_ta_hi.values,
        "ta_lo": df.ta_lo.values, "z_ta_lo": df.z_ta_lo.values,
        "ustar": np.nan, "h_flux": np.nan})[COLS]
    for c, n in (("lat", 6), ("lon", 6), ("canopy_h", 2), ("z_top", 2), ("z_floor", 2), ("z_ta_hi", 2), ("z_ta_lo", 2),
                 ("ws_top", 2), ("ws_floor", 2), ("wd_top", 1), ("wd_floor", 1), ("ta_hi", 3), ("ta_lo", 3)):
        out[c] = out[c].astype(float).round(n)
    ROWS.mkdir(parents=True, exist_ok=True)
    out.to_csv(ROWS / f"NEON-{site}.csv.gz", index=False)
    pd.DataFrame({"t_utc": out.t_utc.values, "wd_top_qf": df.qf_top.values, "wd_floor_qf": df.qf_floor.values}).to_csv(
        RAW / site / "wd_qf.csv.gz", index=False)
    main_cfg = max(configs, key=lambda c: c["halfhours"]) if configs else {}
    main_t = max(tconf, key=lambda c: c["halfhours"]) if tconf else {}
    notes = sorted({n for c in configs for n in c["notes"]})
    info = {"site": site, "lat": lat, "lon": lon, "canopy_h": hc, "canopy_src": hc_src, "chm": chm,
            "canopy_neon": meta.get("canopy_h"),
            "wind_levels": main_cfg.get("levels"), "floor": main_cfg.get("floor"), "top": main_cfg.get("top"),
            "temp_levels": {" ".join(k): float(Zt[k][-1]) for k in tkeys},
            "ta_hi": main_t.get("ta_hi"), "ta_lo": main_t.get("ta_lo"),
            "floor_note": "; ".join(n for n in notes if n.startswith("no level")),
            "top_note": "; ".join(n for n in notes if n.startswith("no 2D")),
            "configs": configs, "ta_configs": tconf,
            "height_changes": {hv: sorted(set(Zw[hv].dropna())) for hv in hvs if Zw[hv].nunique() > 1},
            "rows": int(len(out)), "pairs_before_qc": n_all,
            "wd_flagged": {"top": float((df.qf_top == 1).mean()), "floor": float((df.qf_floor == 1).mean())},
            "ta_present": float(out.ta_hi.notna().mul(out.ta_lo.notna()).mean()) if len(out) else 0.0,
            "years": sorted(int(y) for y in set(df.index.year))}
    (RAW / site / "rows.json").write_text(json.dumps(info, indent=1, default=str))
    zf_set = sorted(set(out.z_floor.dropna())); zt_set = sorted(set(out.z_top.dropna()))
    print(f"{site}: {len(out)} rows, canopy {hc if hc is None else round(hc, 1)} m ({hc_src}), floor {zf_set} m, "
          f"top {zt_set} m, ta {info['ta_lo'] and info['ta_lo'][1]}/{info['ta_hi'] and info['ta_hi'][1]} m; "
          f"{len(configs)} level configs; {'; '.join(notes)}")
    return info


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "pull"
    sites = [s.upper() for s in sys.argv[2:]] or SITES
    if cmd == "rows":
        for s in sites:
            try:
                build_rows(s)
            except Exception as e:  # noqa: BLE001
                print(s, "rows failed:", type(e).__name__, e)
        return
    nn = Neon()
    t0 = time.time()
    log(f"== {cmd} {' '.join(sites)}")
    with cf.ThreadPoolExecutor(WORKERS) as pool:
        if cmd in ("pull", "tower"):
            pull_tower(nn, sites, pool)
        if cmd in ("pull", "aop"):
            pull_aop(nn, sites, pool)
    log(f"== {cmd} done in {(time.time() - t0) / 60:.1f} min, {nn.calls} API calls")


if __name__ == "__main__":
    main()
