"""Quebec's LiDAR point clouds (MRNF, classified LAZ) for an area, for
build_vegstructure.py: bush thickness, shooting lanes and the going grid's
bush.

Quebec publishes its airborne LiDAR as 1 km LAZ tiles, open (CC BY 4.0),
with a tile index on the MRNF GeoServer:

  index  https://servicesvecto3.mern.gouv.qc.ca/geoserver/Index_Telechargement_Lidar_Pub/wfs
         layers IndexTelechargementLidarPlusRecent (the newest survey of
         each piece of ground) and IndexTelechargementLidarHistorique (the
         surveys before it). One feature per tile: TELECHARGEMENT_TUILE
         (the LAZ), PROJET, DATE_ACQUISITION, DENSITE, CLASSIFICATION,
         CODE_EPSG, FORMAT, CAPTEUR, LICENCE. The server answers 403 to a
         request carrying an Origin header (any browser's), so the app can
         never read it: it is baked here.
  tiles  https://diffusion.mern.gouv.qc.ca/diffusion/RGQ/Lidar/<project>/Mtm<z>/Laz/<name>.laz
         named <n>_<EEE><NNNN>F<zz>_DC, the SW corner in km in MTM zone zz
         (NAD83(CSRS); EPSG:2949 for zone 7), heights CGVD28. The server
         honours Range, so a dropped transfer resumes (fetch_resume.py).

Where the two layers both have a tile for a square, the newest flight is
taken. At Lac Bailey that is the 2023 Lac au Brochet project, flown
2024-07-27, and along the core's north edge the 2023 Rivière aux Outardes
project, flown 2024-09-06/14 (both RIEGL, LAZ 1.4), over the 2016
Côte-Nord survey (1.5 pts/m², LAZ 1.2). Both 2024 flights are leaf-on, as
Ontario's SPL was.

The index gives 2.5 pts/m² ("DENSITE", the contract's nominal density);
the tiles measure 5-8 returns/m² over land (median 7), with up to 7
returns a pulse. Classes: 1 unclassified (vegetation and anything else
above ground), 2 ground, 7 noise, 9 water, 17 bridge decks; some tiles
have no water class at all. The vegetation is not split by height and
there is no per-tile DEM, so build_vegstructure.py measures heights against
each tile's own ground returns ("ground": "class" in each row).

The rows list every tile meeting the area's core, which is the frame of the
vegstructure grid; what is downloaded is the area's bake.pointcloud.bbox
(the tiles meeting it), or the whole core with --all. build_vegstructure.py
uses whichever tiles are on disk, so a later run that fetches less never
throws away what an earlier one fetched.

    py -3.14 pipeline/qc_pointcloud.py --area lac-bailey --list   # sizes, nothing fetched
    py -3.14 pipeline/qc_pointcloud.py --area lac-bailey          # the tiles meeting bake.pointcloud.bbox
    py -3.14 pipeline/qc_pointcloud.py --area lac-bailey --all    # every tile in the core

The download server gives 0.3-0.7 MB/s a connection and about 2.5 MB/s
over six: the Lac Bailey core (128 tiles, 6.4 GB) took 42 minutes.

Output: pipeline/raw/pointcloud/<id>/laz/<name>.laz
        pipeline/raw/pointcloud/tiles-<id>.json   one row per tile: name, file, crs, bounds,
                                                  year, source and how to read it
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

from area import BAKE, ID, adapter, options
from common import CACHE_DIR, CORE, REGION
from fetch_resume import download

WFS = "https://servicesvecto3.mern.gouv.qc.ca/geoserver/Index_Telechargement_Lidar_Pub/wfs"
# the newest layer first: it wins a tie on the flight date
LAYERS = ("IndexTelechargementLidarPlusRecent", "IndexTelechargementLidarHistorique")
PC_DIR = CACHE_DIR / "pointcloud"
INDEX = PC_DIR / f"tiles-{ID}.json"
NAME_RE = re.compile(r"^\d+_(\d{3})(\d{4})F(\d\d)_DC$")
CHUNK = 16 * 1024 * 1024  # per ranged GET: a drop costs at most this much
UA = {"User-Agent": "huntapp-pipeline/0.1 (offline camp maps)"}

# How build_vegstructure.py reads these tiles. Noise (7) and bridge decks (17)
# are not vegetation; 18 (high noise) is not in these projects' class lists
# but is LAS's code for it. Water returns (9) are dropped and mark the water.
GROUND = [2]
DROP = [7, 17, 18]
WATER = [9]
# The returns per m² of land a cell needs before build_vegstructure.py gives
# it any value: two fifths of the survey's nominal density, so 1.0 for
# 2.5 pts/m², a hundred returns a 10 m cell, which puts the canopy cover
# within ±0.05. These surveys deliver two to three times their nominal
# over land, so only swath gaps and the dropouts along a shore fall under
# it (Ontario's SPL floor of 5 is a seventh of its ~35, to the same end).
# And they are sparse: a cell with too few returns below 3 m for an
# understory value (under a closed canopy) takes its neighbours'
# (build_vegstructure.py, poolReach).
DENSITY_FLOOR = 0.4


def query(layer: str, box: dict) -> list[dict]:
    """The layer's tiles whose footprint meets a lon/lat box. WFS 1.0.0 takes
    the box as lon/lat (the 1.1/2.0 axis order is lat/lon)."""
    params = {
        "service": "WFS",
        "version": "1.0.0",
        "request": "GetFeature",
        "typeName": f"Index_Telechargement_Lidar_Pub:{layer}",
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "maxFeatures": "10000",
        "BBOX": f"{box['west']},{box['south']},{box['east']},{box['north']},EPSG:4326",
    }
    for attempt in range(6):
        try:
            r = requests.get(WFS, params=params, headers=UA, timeout=120)
            r.raise_for_status()
            return r.json()["features"]
        except Exception as e:  # noqa: BLE001
            print(f"  {layer}: retry {attempt + 1} ({str(e)[:80]})", flush=True)
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f"the LiDAR index ({layer}) did not answer")


def box_in(crs: str, box: dict):
    """A lon/lat box as a polygon in a tile CRS (its edges curve a little)."""
    from pyproj import Transformer
    from shapely.geometry import box as sbox
    from shapely.ops import transform

    t = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    return transform(t.transform, sbox(box["west"], box["south"], box["east"], box["north"]).segmentize(0.001))


def to_row(f: dict) -> dict:
    """One index feature as a tiles-<id>.json row."""
    from pyproj import Transformer

    p = f["properties"]
    name = p["NOM_TUILE"]
    crs = f"EPSG:{int(p['CODE_EPSG'])}"
    g = f["geometry"]
    ring = g["coordinates"][0][0] if g["type"] == "MultiPolygon" else g["coordinates"][0]
    xs, ys = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform([c[0] for c in ring], [c[1] for c in ring])
    bounds = [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))]
    m = NAME_RE.match(name)
    if m and (int(m.group(1)) * 1000, int(m.group(2)) * 1000) != (bounds[0], bounds[1]):
        raise SystemExit(f"{name}: its footprint's corner {bounds[:2]} is not the one its name gives")
    days = sorted(d.strip() for d in p["DATE_ACQUISITION"].split(",") if d.strip())
    licence = "CC BY 4.0" if "CC BY 4.0" in (p.get("LICENCE") or "") else p.get("LICENCE")
    nominal = re.match(r"\s*([\d.,]+)", p.get("DENSITE") or "")
    nominal = float(nominal.group(1).replace(",", ".")) if nominal else 2.5
    return {
        "name": name,
        "file": f"{ID}/laz/{name}.laz",
        "crs": crs,
        "bounds": bounds,
        "year": int(days[-1][:4]),
        "days": days,
        "project": p["PROJET"],
        "source": f"MRNF LiDAR {p['PROJET']}",
        "attribution": "© Gouvernement du Québec (MRNF)",
        "licence": licence,
        "url": p["TELECHARGEMENT_TUILE"],
        "classes": [int(c) for c in str(p["CLASSIFICATION"]).split(",") if c.strip()],
        "density": p.get("DENSITE"),
        "sensor": p.get("CAPTEUR"),
        "format": p.get("FORMAT"),
        "heights": p.get("SYSREF_ALTIMETRIQUE"),
        "ground": "class",
        "groundClasses": GROUND,
        "drop": DROP,
        "water": WATER,
        "minDensity": round(DENSITY_FLOOR * nominal, 2),
        "poolReach": True,
    }


def index() -> list[dict]:
    """Every tile meeting the core, the newest flight of each square, with
    the sizes an earlier run found kept."""
    from shapely.geometry import box as sbox

    best: dict[tuple, dict] = {}
    for rank, layer in enumerate(LAYERS):
        feats = query(layer, CORE)
        print(f"  {layer}: {len(feats)} tiles near the core")
        for f in feats:
            r = to_row(f)
            key = (r["crs"], r["bounds"][0], r["bounds"][1])
            order = (r["days"][-1], -rank)
            if key not in best or order > best[key][0]:
                best[key] = (order, r)
    rows = [r for _, r in best.values()]
    cores = {crs: box_in(crs, CORE) for crs in {r["crs"] for r in rows}}
    rows = [r for r in rows if sbox(*r["bounds"]).intersection(cores[r["crs"]]).area > 0]
    if not rows:
        raise SystemExit(f"no Quebec LiDAR tiles meet {REGION['name']}'s core")
    old = {r["name"]: r for r in json.loads(INDEX.read_text(encoding="utf-8"))} if INDEX.exists() else {}
    for r in rows:
        if "bytes" in old.get(r["name"], {}):
            r["bytes"] = old[r["name"]]["bytes"]
    rows.sort(key=lambda r: (r["crs"], r["bounds"][0], r["bounds"][1]))
    return rows


def head_size(url: str) -> int:
    for attempt in range(6):
        try:
            r = requests.head(url, headers=UA, timeout=60, allow_redirects=True)
            r.raise_for_status()
            return int(r.headers["content-length"])
        except Exception as e:  # noqa: BLE001
            print(f"  HEAD retry {attempt + 1}: {str(e)[:80]}", flush=True)
            time.sleep(3 * (attempt + 1))
    raise SystemExit(f"cannot size {url}")


def ensure_sizes(rows: list[dict], sel: list[dict]) -> None:
    todo = [r for r in sel if "bytes" not in r]
    if todo:
        print(f"sizing {len(todo)} tiles …", flush=True)
        with ThreadPoolExecutor(8) as ex:
            for r, n in zip(todo, ex.map(lambda r: head_size(r["url"]), todo)):
                r["bytes"] = n
    write_index(rows)


def write_index(rows: list[dict]) -> None:
    PC_DIR.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")


def on_disk(r: dict) -> bool:
    p = PC_DIR / r["file"]
    return p.exists() and "bytes" in r and p.stat().st_size == r["bytes"]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--all", action="store_true", help="every tile in the core, not just bake.pointcloud.bbox")
    ap.add_argument("--list", action="store_true", help="print the sizes, download nothing")
    ap.add_argument("--max-gb", type=float, default=15.0, help="refuse a selection bigger than this")
    ap.add_argument("--workers", type=int, default=6, help="downloads at a time")
    args = ap.parse_args(argv)
    if adapter(BAKE, "pointcloud") != "qc.mrnf_laz":
        raise SystemExit(f"{REGION['name']}'s point cloud is not Quebec MRNF LAZ ({adapter(BAKE, 'pointcloud')})")

    print(f"querying the MRNF LiDAR index for {REGION['name']} …", flush=True)
    rows = index()
    write_index(rows)
    bbox = options(BAKE, "pointcloud").get("bbox")
    if args.all or not bbox:
        sel, what = rows, "the core"
    else:
        from shapely.geometry import box as sbox

        boxes = {crs: box_in(crs, bbox) for crs in {r["crs"] for r in rows}}
        sel = [r for r in rows if sbox(*r["bounds"]).intersection(boxes[r["crs"]]).area > 0]
        what = "bake.pointcloud.bbox"
    projects: dict[str, set] = {}
    for r in sel:
        projects.setdefault(r["project"], set()).update(r["days"])
    ensure_sizes(rows, rows if args.list else sel)
    total = sum(r["bytes"] for r in sel)
    have = sum(r["bytes"] for r in sel if on_disk(r))
    print(f"{len(sel)} of the core's {len(rows)} tiles meet {what}: {total / 1e9:.2f} GB, {have / 1e9:.2f} GB already here")
    for p, days in sorted(projects.items()):
        print(f"  {p}: {sum(r['project'] == p for r in sel)} tiles, flown {', '.join(sorted(days))}")
    if args.list:
        print(f"  (the whole core is {sum(r['bytes'] for r in rows) / 1e9:.2f} GB)")
        for r in sel:
            print(f"  {r['name']}  {r['bounds'][0] // 1000}/{r['bounds'][1] // 1000}  {r['bytes'] / 1e6:5.0f} MB  {r['year']}{'  here' if on_disk(r) else ''}")
        return 0
    if (total - have) / 1e9 > args.max_gb:
        raise SystemExit(f"{(total - have) / 1e9:.1f} GB to fetch is over --max-gb {args.max_gb}")

    todo = [r for r in sel if not on_disk(r)]
    t0 = time.time()
    got = 0
    failed = []
    with ThreadPoolExecutor(max(1, args.workers)) as ex:
        futs = {ex.submit(download, r["url"], PC_DIR / r["file"], CHUNK): r for r in todo}
        for i, f in enumerate(as_completed(futs), 1):
            r = futs[f]
            try:
                f.result()
                got += r["bytes"]
                status = "got"
            except (Exception, SystemExit) as e:  # noqa: BLE001  (fetch_resume gives up with SystemExit)
                failed.append(r["name"])
                status = f"FAILED ({str(e)[:60]})"
            rate = got / 1e6 / max(time.time() - t0, 1e-6)
            print(f"  {i}/{len(todo)} {r['name']} {status} · {got / 1e9:.2f} GB new · {rate:.1f} MB/s", flush=True)
    print(f"done in {time.time() - t0:.0f} s: {len(sel) - len(failed)} of {len(sel)} tiles on disk")
    if failed:
        print(f"{len(failed)} failed (rerun to resume them): {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
