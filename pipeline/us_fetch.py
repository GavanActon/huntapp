"""Everything a US area's bake downloads, fetched for it: the standard first step
of a US area (us_area.py), so no one lists tiles by hand again.

Into pipeline/raw/us3dep/<stage>/ (the area's bake.us3dep.stage, else its id):
  ned1/      USGS 3DEP 1 arc-second tiles over the region plus half a degree (the wide 30 m
             DEM: us_terrain.py wide), the newest of each 1° tile
  dem1m/     USGS 3DEP 1 m DEM tiles over the core (HD only: us_terrain.py core)
  lpc/       USGS 3DEP LAZ tiles within --radius-km of the spot (HD only: us_pointcloud.py),
             each checked for the LASF signature (the tile server answers a refused tile with
             an HTML page and status 200) and fetched again when not
  nlcd/      the MRLC WCS clip of NLCD land cover over the region plus a quarter degree
  landfire/  the LANDFIRE Product Service clip (EVT, EVH, EVC, CC, CH, FDist) over the same,
             a job submitted and polled, and the EVT attribute CSV (shared across areas)
  nhd/       the NHDPlus HR GeoPackage of the basin(s) the region is in (TNM lists the HU4
             product by bbox; prd-tnm serves it), shared across areas and copied in
It also writes bake.us3dep.project and .vintage into the area file from the 1 m tiles'
project, and fetch.json with what came from where.

    py -3.14 pipeline/us_fetch.py --area <id> [--sd] [--radius-km 3.2] [--only ned1,nlcd,...]

Public domain sources (USGS, MRLC, LANDFIRE), no login. A download resumes (curl -C -).
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import area  # noqa: E402  (first: it takes --area out of argv)
from common import CORE, REGION, ROOT  # noqa: E402

A = area.load(area.ID)
BAKE = A.get("bake") or {}
STAGE_NAME = (BAKE.get("us3dep") or {}).get("stage") or area.ID
RAW = ROOT / "pipeline" / "raw" / "us3dep" / STAGE_NAME
SHARED = ROOT / "pipeline" / "raw" / "us3dep" / "_shared"
TNM = "https://tnmaccess.nationalmap.gov/api/v1/products"
LFPS = "https://lfps.usgs.gov/api"
LF_LAYERS = "LF2024_EVT;LF2024_EVH;LF2024_EVC;LF2024_CC;LF2024_CH;LF2024_FDist"
EVT_CSV = "https://landfire.gov/sites/default/files/CSV/LF2023/LF23_EVT_240.csv"
NLCD_WCS = "https://www.mrlc.gov/geoserver/mrlc_download/NLCD_2021_Land_Cover_L48/wcs"
WIDE_PAD = 0.5  # us_terrain.py WIDE_PAD_DEG
STAGE_PAD = 0.25  # us_stage.py PAD_DEG
UA = {"User-Agent": "groundwind-bake/1.0 (+https://groundwind.app)"}


def log(s: str) -> None:
    print(s, flush=True)


def get_json(url: str, params: dict, tries: int = 4) -> dict:
    full = url + "?" + urllib.parse.urlencode(params)
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(full, headers=UA), timeout=120) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise SystemExit(f"{url}: {str(e)[:120]}") from e
            time.sleep(5 * (i + 1))
    raise AssertionError


def tnm(dataset: str, box: tuple[float, float, float, float], mx: int = 400, **more) -> list[dict]:
    j = get_json(TNM, {"datasets": dataset, "bbox": ",".join(f"{v:.5f}" for v in box), "max": mx, "outputFormat": "JSON", **more})
    return j.get("items") or []


def curl(url: str, dest: Path, check=None, tries: int = 4) -> bool:
    """Resumable download to dest; `check(path)` says whether what came is right."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0 and (check is None or check(dest)):
        return True
    part = dest.with_suffix(dest.suffix + ".part")
    for i in range(tries):
        rc = subprocess.call(["curl", "-sS", "-L", "--retry", "3", "-C", "-", "--max-time", "3600", "-o", str(part), url])
        if rc == 0 and part.exists() and part.stat().st_size > 0 and (check is None or check(part)):
            part.replace(dest)
            return True
        part.unlink(missing_ok=True)  # an error page or a broken resume: start over
        time.sleep(5 * (i + 1))
    log(f"  FAILED {url}")
    return False


def is_tiff(p: Path) -> bool:
    with open(p, "rb") as f:
        return f.read(4) in (b"II*\x00", b"MM\x00*")


def is_laz(p: Path) -> bool:
    with open(p, "rb") as f:
        return f.read(4) == b"LASF"


def is_zip(p: Path) -> bool:
    with open(p, "rb") as f:
        return f.read(2) == b"PK"


def newest_per_tile(items: list[dict], key_re: str) -> list[dict]:
    best: dict[str, tuple[str, dict]] = {}
    for it in items:
        u = it.get("downloadURL") or ""
        m = re.search(key_re, u)
        if not m:
            continue
        d = re.search(r"(\d{8})", u)
        stamp = d.group(1) if d else "0"
        if m.group(1) not in best or stamp > best[m.group(1)][0]:
            best[m.group(1)] = (stamp, it)
    return [v[1] for v in best.values()]


def km_from(lon: float, lat: float, b: dict) -> float:
    import math

    cx, cy = (b["minX"] + b["maxX"]) / 2, (b["minY"] + b["maxY"]) / 2
    return math.hypot((cx - lon) * 111.32 * math.cos(math.radians(lat)), (cy - lat) * 111.32)


def ned1(report: dict) -> None:
    box = (REGION["west"] - WIDE_PAD, REGION["south"] - WIDE_PAD, REGION["east"] + WIDE_PAD, REGION["north"] + WIDE_PAD)
    items = newest_per_tile(tnm("National Elevation Dataset (NED) 1 arc-second", box), r"/(n\d\dw\d\d\d)/")
    log(f"ned1: {len(items)} tiles")
    # the 1° tiles are shared across areas (50 MB each): fetched once into _shared, copied into the stage
    got = []
    for it in items:
        name = it["downloadURL"].rsplit("/", 1)[-1]
        if curl(it["downloadURL"], SHARED / "ned1" / name, is_tiff):
            (RAW / "ned1").mkdir(parents=True, exist_ok=True)
            if not (RAW / "ned1" / name).exists():
                shutil.copy2(SHARED / "ned1" / name, RAW / "ned1" / name)
            got.append(name)
    report["ned1"] = got


def dem1m(report: dict) -> None:
    box = (CORE["west"] - 0.01, CORE["south"] - 0.01, CORE["east"] + 0.01, CORE["north"] + 0.01)
    items = tnm("Digital Elevation Model (DEM) 1 meter", box, prodFormats="GeoTIFF")
    log(f"dem1m: {len(items)} tiles")
    got = []
    projects = set()
    for it in items:
        u = it["downloadURL"]
        if curl(u, RAW / "dem1m" / u.rsplit("/", 1)[-1], is_tiff):
            got.append(u.rsplit("/", 1)[-1])
            m = re.search(r"/Projects/([^/]+)/", u)
            if m:
                projects.add(m.group(1))
    report["dem1m"] = got
    report["dem1mProjects"] = sorted(projects)


def lpc(report: dict, radius_km: float) -> None:
    lon, lat = A["centre"]
    box = (CORE["west"], CORE["south"], CORE["east"], CORE["north"])
    items = [it for it in tnm("Lidar Point Cloud (LPC)", box, mx=1000) if it.get("boundingBox") and km_from(lon, lat, it["boundingBox"]) <= radius_km]
    log(f"lpc: {len(items)} tiles within {radius_km} km, {sum(it.get('sizeInBytes') or 0 for it in items) / 1e6:.0f} MB")
    got = []
    units = set()
    for it in items:
        u = it["downloadURL"]
        if curl(u, RAW / "lpc" / u.rsplit("/", 1)[-1], is_laz, tries=6):
            got.append(u.rsplit("/", 1)[-1])
            m = re.search(r"/Projects/([^/]+)/([^/]+)/LAZ/", u)
            if m:
                units.add(f"{m.group(1)} ({m.group(2)})")
    (RAW / "tnm-lidar-lpc.json").write_text(json.dumps(items, indent=1), encoding="utf-8")
    report["lpc"] = got
    report["lpcUnits"] = sorted(units)


def nlcd(report: dict) -> None:
    box = (REGION["west"] - STAGE_PAD, REGION["south"] - STAGE_PAD, REGION["east"] + STAGE_PAD, REGION["north"] + STAGE_PAD)
    url = (
        f"{NLCD_WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=NLCD_2021_Land_Cover_L48"
        f"&subset=Long({box[0]:.4f},{box[2]:.4f})&subset=Lat({box[1]:.4f},{box[3]:.4f})"
        "&subsettingCrs=http://www.opengis.net/def/crs/EPSG/0/4326&format=image/geotiff"
    )
    ok = curl(url, RAW / "nlcd" / "nlcd_2021_lc.tif", is_tiff, tries=5)
    log(f"nlcd: {'ok' if ok else 'FAILED'}")
    report["nlcd"] = "NLCD 2021 Land Cover (MRLC WCS)" if ok else None


def landfire(report: dict) -> None:
    out = RAW / "landfire"
    out.mkdir(parents=True, exist_ok=True)
    csv_shared = SHARED / "LF23_EVT_240.csv"
    if curl(EVT_CSV, csv_shared):
        shutil.copy2(csv_shared, out / csv_shared.name)
    if list(out.glob("*.tif")):
        log("landfire: clip is there already")
        report["landfire"] = "LF2024 EVT/EVH/EVC/CC/CH/FDist (LFPS)"
        return
    box = (REGION["west"] - STAGE_PAD, REGION["south"] - STAGE_PAD, REGION["east"] + STAGE_PAD, REGION["north"] + STAGE_PAD)
    j = get_json(f"{LFPS}/job/submit", {"Email": "bake@groundwind.app", "Layer_List": LF_LAYERS, "Area_of_Interest": f"{box[0]:.3f} {box[1]:.3f} {box[2]:.3f} {box[3]:.3f}", "Output_Projection": "4326"})
    job = j.get("jobId")
    if not job:
        raise SystemExit(f"LFPS would not take the job: {str(j)[:200]}")
    log(f"landfire: job {job} submitted")
    t0 = time.time()
    while True:
        st = get_json(f"{LFPS}/job/status", {"JobId": job})
        s = st.get("status")
        if s == "Succeeded":
            break
        if s in ("Failed", "Cancelled") or time.time() - t0 > 1800:
            raise SystemExit(f"LFPS job {job}: {s}; {str(st.get('messages'))[-300:]}")
        time.sleep(15)
    url = st.get("outputFile")
    z = out / f"{job}.zip"
    if not curl(url, z, is_zip):
        raise SystemExit("the LANDFIRE zip did not come")
    with zipfile.ZipFile(z) as zf:
        zf.extractall(out)
    log(f"landfire: {[p.name for p in out.glob('*.tif')]}")
    report["landfire"] = "LF2024 EVT/EVH/EVC/CC/CH/FDist (LFPS)"


def nhd(report: dict) -> None:
    box = (REGION["west"], REGION["south"], REGION["east"], REGION["north"])
    items = [it for it in tnm("National Hydrography Dataset Plus High Resolution (NHDPlus HR)", box, mx=50) if "GPKG" in (it.get("downloadURL") or "") and "_HU4_" in it["downloadURL"]]
    if not items:
        raise SystemExit("TNM lists no NHDPlus HR HU4 GeoPackage over the region")
    got = []
    for it in items:
        u = it["downloadURL"]
        name = u.rsplit("/", 1)[-1]
        if curl(u, SHARED / "nhd" / name, is_zip):
            (RAW / "nhd").mkdir(parents=True, exist_ok=True)
            if not (RAW / "nhd" / name).exists():
                shutil.copy2(SHARED / "nhd" / name, RAW / "nhd" / name)
            got.append(name)
    log(f"nhd: {got}")
    report["nhd"] = got


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sd", action="store_true", help="an SD area: no 1 m DEM, no point cloud")
    ap.add_argument("--radius-km", type=float, default=3.2, help="point-cloud tiles within this of the spot")
    ap.add_argument("--only", help="a comma list of: ned1,dem1m,lpc,nlcd,landfire,nhd")
    args = ap.parse_args()
    sd = args.sd or BAKE.get("wind") == "sd" or BAKE.get("lidar") == "none"
    steps = [s for s in (args.only.split(",") if args.only else ["ned1", "nlcd", "landfire", "nhd"] + ([] if sd else ["dem1m", "lpc"]))]
    RAW.mkdir(parents=True, exist_ok=True)
    report: dict = {"area": area.ID, "stage": STAGE_NAME, "sd": sd, "at": time.strftime("%Y-%m-%d %H:%M")}
    t0 = time.time()
    log(f"{REGION['name']} ({area.ID}): fetching {', '.join(steps)} into {RAW}")
    for s in steps:
        {"ned1": ned1, "dem1m": dem1m, "lpc": lambda r: lpc(r, args.radius_km), "nlcd": nlcd, "landfire": landfire, "nhd": nhd}[s](report)
    (RAW / "fetch.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    # the LiDAR project's name into the area file, for the coverage report's words
    if report.get("dem1mProjects"):
        proj = ", ".join(report["dem1mProjects"])
        yr = re.search(r"(20\d\d|19\d\d)", proj)
        area.set_area_values(area.ID, {"bake.us3dep.project": proj, "bake.us3dep.vintage": f"flown {yr.group(1)}" if yr else None})
        log(f"area file: us3dep.project = {proj}")
    log(f"done in {(time.time() - t0) / 60:.0f} min")
    return 0


if __name__ == "__main__":
    sys.exit(main())
