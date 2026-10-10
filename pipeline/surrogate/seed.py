"""The seed set (SURROGATE.md §4.2): WindNinja kits for places the paid areas
will never reach on their own, so the net sees every kind of ground before it
serves SD there. One kit per site in build_windcfd.prepare's shape: a 10 km
core and 2.5 km round it, 30 m in UTM, dem.tif + meta.json. Terrain only, as
the teacher is today: MRDEM 30 m DTM in Canada, USGS 3DEP (bare earth,
resampled to 30 m by its image service) in the US and Alaska.

The kits go to a staging folder, not the shared kit, so the runners don't
start them until they are moved in (a watching runner picks up any folder
with a meta.json). Batch 1 carries priority -1 and batch 2 -2, so in the kit
they still queue behind any area (priority 0).

    py -3.14 pipeline/surrogate/seed.py                 # every site
    py -3.14 pipeline/surrogate/seed.py --batch 1
    py -3.14 pipeline/surrogate/seed.py --only seed-bsb-id --out <dir>

Chosen 2026-10-09 (chat with Gavan) for landform, cover, water, climate and
game the six areas don't have; the measured ones (Big Southern Butte, Salmon
River Canyon: WindNinja's own field campaigns; NEON towers) also judge the
teacher.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from build_windcfd import BUFFER_M, CELL_M, DIRECTIONS, SPEED_KPH, mesh_count  # noqa: E402
from rasters import MRDEM  # noqa: E402

OUT = HERE.parent / "raw" / "windcfd-seed"
CORE_M = 10_000.0
USGS = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"

# id, name, lat, lon, country, batch, what it teaches, game, measured wind
SITES = [
    ("seed-bsb-id", "Big Southern Butte, ID", 43.396, -113.022, "us", 1,
     "isolated 800 m mountain, sagebrush", "mule deer, pronghorn", "50+ sensors at 3.3 m (WindNinja field campaign, Zenodo 8226638)"),
    ("seed-salmon-id", "Salmon River Canyon above Riggins, ID", 45.43, -116.22, "us", 1,
     "550 m east-west canyon", "elk, mule deer", "sodars, sonics, stations (same campaign)"),
    ("seed-rothrock-pa", "Ridge-and-Valley, Rothrock SF, PA", 40.70, -77.80, "us", 1,
     "parallel ridges, hardwood, channelling", "whitetail", ""),
    ("seed-driftless-wi", "Driftless coulees, Buffalo Co., WI", 44.35, -91.75, "us", 1,
     "steep coulees in farmland, drainage", "whitetail", ""),
    ("seed-breaks-mt", "Missouri Breaks, MT", 47.62, -108.30, "us", 1,
     "badlands breaks 300 m below flat plains", "elk, mule deer", ""),
    ("seed-mogollon-az", "Mogollon Rim, AZ", 34.33, -110.95, "us", 1,
     "600 m escarpment, ponderosa plateau, monsoon thermals", "elk", ""),
    ("seed-porcupine-ab", "Porcupine Hills, AB", 49.85, -114.05, "ca", 1,
     "chinook foothills, grass and fir", "elk, mule deer", ""),
    ("seed-peace-ab", "Peace River valley, AB", 56.23, -117.30, "ca", 1,
     "250 m valley cut in a flat farm-boreal plateau", "moose, whitetail", ""),
    ("seed-berms-sk", "Boreal Plain by the BERMS towers, SK", 53.63, -106.20, "ca", 1,
     "flat jack pine and aspen sand plain", "moose, whitetail, elk", "flux towers (top level only)"),
    ("seed-matane-qc", "Reserve faunique de Matane, QC", 48.78, -66.98, "ca", 1,
     "Appalachian plateau, deep valleys", "moose", ""),
    ("seed-sayward-bc", "Sayward forest, Vancouver Island, BC", 50.30, -125.80, "ca", 1,
     "logged rainforest, steep, sea breeze", "blacktail, Roosevelt elk", ""),
    ("seed-wref-wa", "Wind River, WA (NEON WREF)", 45.82, -121.95, "us", 1,
     "60 m Douglas-fir canopy, Cascades", "elk, blacktail", "NEON tower, wind at several heights in the canopy"),
    ("seed-benezette-pa", "Pennsylvania Wilds, Benezette, PA", 41.32, -78.38, "us", 2,
     "dissected plateau, deep hollows", "elk, whitetail", ""),
    ("seed-bart-nh", "White Mountains, NH (NEON BART)", 44.06, -71.29, "us", 2,
     "northern hardwood hills", "whitetail, moose", "NEON tower"),
    ("seed-capebreton-ns", "Cape Breton Highlands edge, NS", 46.60, -60.75, "ca", 2,
     "plateau and canyons, Atlantic wind", "moose", ""),
    ("seed-topsails-nl", "Gaff Topsails barrens, NL", 49.15, -56.60, "ca", 2,
     "open barrens, stunted spruce", "moose", ""),
    ("seed-pike-il", "Pike County, IL", 39.60, -90.85, "us", 2,
     "flat farmland, river-bluff timber", "whitetail", ""),
    ("seed-buffalo-ar", "Buffalo River, Ozarks, AR", 36.05, -93.35, "us", 2,
     "hollows, oak-hickory", "elk, whitetail", ""),
    ("seed-sandhills-ne", "Nebraska Sandhills", 42.10, -101.00, "us", 2,
     "grass-covered dunes", "mule deer, whitetail", ""),
    ("seed-sasklanding-sk", "South Saskatchewan coulees, SK", 50.65, -107.95, "ca", 2,
     "prairie coulees off a big river", "mule deer, whitetail", ""),
    ("seed-riding-mb", "Riding Mountain escarpment, MB", 50.70, -99.60, "ca", 2,
     "400 m escarpment over aspen parkland", "elk, moose, whitetail", ""),
    ("seed-nipigon-on", "Nipigon cuestas, ON", 48.95, -88.25, "ca", 2,
     "flat-topped mesas with cliffs by Lake Superior", "moose", ""),
    ("seed-tall-al", "Talladega, AL (NEON TALL)", 32.95, -87.39, "us", 2,
     "southern pine and hardwood hills", "whitetail", "NEON tower"),
    ("seed-hillcountry-tx", "Texas Hill Country", 30.05, -99.35, "us", 2,
     "dry juniper-oak savanna hills", "whitetail", ""),
    ("seed-kamloops-bc", "Lac du Bois grasslands, Kamloops, BC", 50.78, -120.42, "ca", 2,
     "open dry slopes, strong thermals", "mule deer, bighorn", ""),
    ("seed-kootenay-bc", "East Kootenay trench, BC", 49.80, -115.70, "ca", 2,
     "wide trench between ranges", "elk, whitetail, mule deer", ""),
    ("seed-rmnp-co", "Colorado Front Range (NEON RMNP)", 40.28, -105.55, "us", 2,
     "lodgepole, front range", "elk", "NEON tower"),
    ("seed-gorge-or", "Columbia River Gorge, OR/WA", 45.70, -121.50, "us", 2,
     "gorge gap winds", "elk, blacktail", "WFIP2 field campaign"),
    ("seed-pokerflat-ak", "Poker Flat, AK (US-Prr)", 65.1237, -147.4876, "us", 2,
     "black spruce on permafrost, rolling uplands", "moose", "10-level tower 1.5-16 m"),
    ("seed-dempster-yt", "Dempster Highway, Blackstone uplands, YT", 64.60, -138.30, "ca", 2,
     "treeless valleys, tundra", "caribou, moose", ""),
]


def utm_epsg(lat: float, lon: float) -> int:
    return (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1


def grid(lat: float, lon: float) -> tuple[int, float, float, int, int]:
    """The kit's grid: the core centred on the site plus the buffer, snapped
    to 30 m, as build_windcfd.prepare does for an area."""
    from pyproj import Transformer
    epsg = utm_epsg(lat, lon)
    x, y = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True).transform(lon, lat)
    half = CORE_M / 2 + BUFFER_M
    x0 = math.floor((x - half) / CELL_M) * CELL_M
    x1 = math.ceil((x + half) / CELL_M) * CELL_M
    y0 = math.floor((y - half) / CELL_M) * CELL_M
    y1 = math.ceil((y + half) / CELL_M) * CELL_M
    return epsg, x0, y1, int((x1 - x0) / CELL_M), int((y1 - y0) / CELL_M)


def onto(src: np.ndarray, src_t, src_crs, nodata, epsg, x0, y1, cols, rows) -> np.ndarray:
    dst = np.full((rows, cols), -9999, np.float32)
    reproject(src.astype(np.float32), dst, src_transform=src_t, src_crs=src_crs, src_nodata=nodata,
              dst_transform=from_origin(x0, y1, CELL_M, CELL_M), dst_crs=f"EPSG:{epsg}", dst_nodata=-9999,
              resampling=Resampling.bilinear)
    return dst


def fetch_mrdem(epsg, x0, y1, cols, rows) -> np.ndarray:
    box = (x0, y1 - rows * CELL_M, x0 + cols * CELL_M, y1)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                      GDAL_HTTP_MAX_RETRY="6", GDAL_HTTP_RETRY_DELAY="2"):
        with rasterio.open("/vsicurl/" + MRDEM) as src:
            b = transform_bounds(f"EPSG:{epsg}", src.crs, *box, densify_pts=21)
            pad = 4 * abs(src.transform.a)
            w = from_bounds(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad, src.transform).round_offsets().round_lengths()
            arr = src.read(1, window=w)
            return onto(arr, src.window_transform(w), src.crs, src.nodata, epsg, x0, y1, cols, rows)


def fetch_3dep(epsg, x0, y1, cols, rows) -> np.ndarray:
    # asked straight in the kit's grid; reprojected onto it anyway in case the
    # service snaps the box
    q = {"bbox": f"{x0},{y1 - rows * CELL_M},{x0 + cols * CELL_M},{y1}", "bboxSR": epsg, "imageSR": epsg,
         "size": f"{cols},{rows}", "format": "tiff", "pixelType": "F32", "noDataInterpretation": "esriNoDataMatchAny",
         "interpolation": "RSP_BilinearInterpolation", "f": "image"}
    url = USGS + "?" + urllib.parse.urlencode(q)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = r.read()
            break
        except Exception as e:  # the service drops the odd request
            if attempt == 4:
                raise
            print(f"  3DEP retry {attempt + 1}: {e}")
            time.sleep(5 * (attempt + 1))
    with MemoryFile(io.BytesIO(data)) as mf, mf.open() as src:
        arr = src.read(1)
        return onto(arr, src.transform, src.crs, src.nodata, epsg, x0, y1, cols, rows)


def bake(site: tuple, out_root: Path) -> dict:
    sid, name, lat, lon, country, batch, teaches, game, measured = site
    epsg, x0, y1, cols, rows = grid(lat, lon)
    dem = (fetch_mrdem if country == "ca" else fetch_3dep)(epsg, x0, y1, cols, rows)
    # sea, or a hole: sea level, counted, so a coast or a gap is plain in the summary
    holes = int((dem <= -9000).sum())
    dem[dem <= -9000] = 0.0
    lo, hi = float(dem.min()), float(dem.max())
    gy, gx = np.gradient(dem, CELL_M)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    mesh, res, ground = mesh_count(cols * CELL_M, rows * CELL_M, hi - lo)
    out = out_root / sid
    out.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out / "dem.tif", "w", driver="GTiff", height=rows, width=cols, count=1, dtype="float32",
                       crs=f"EPSG:{epsg}", transform=from_origin(x0, y1, CELL_M, CELL_M), nodata=-9999,
                       compress="deflate") as d:
        d.write(dem, 1)
    meta = {"area": sid, "epsg": epsg, "bounds": [x0, y1 - rows * CELL_M, x0 + cols * CELL_M, y1], "cols": cols,
            "rows": rows, "meshCount": mesh, "groundCellM": round(res, 1), "groundCells": ground,
            "speedKph": SPEED_KPH, "directions": DIRECTIONS, "priority": -batch,
            "seed": {"name": name, "lat": lat, "lon": lon, "country": country, "batch": batch, "teaches": teaches,
                     "game": game, "measured": measured, "dem": "MRDEM 30 m DTM" if country == "ca" else "USGS 3DEP"}}
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    return {"id": sid, "batch": batch, "relief": round(hi - lo), "slopeP50": round(float(np.median(slope)), 1),
            "slopeP90": round(float(np.percentile(slope, 90)), 1), "sea": holes, "mesh": mesh}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--batch", type=int, choices=[1, 2])
    p.add_argument("--only", nargs="+", help="site ids")
    p.add_argument("--out", type=Path, default=OUT, help=f"default {OUT} (not the shared kit)")
    a = p.parse_args()
    sites = [s for s in SITES if (a.batch is None or s[5] == a.batch) and (not a.only or s[0] in a.only)]
    rows = []
    for s in sites:
        t = time.time()
        try:
            r = bake(s, a.out)
        except Exception as e:
            print(f"{s[0]}: FAILED {e}")
            continue
        rows.append(r)
        print(f"{r['id']:<22} batch {r['batch']}  relief {r['relief']:>5} m  slope p50 {r['slopeP50']:>4}° "
              f"p90 {r['slopeP90']:>4}°  sea {r['sea']:>6}  mesh {r['mesh']:>9,}  ({time.time() - t:.0f} s)")
    summary = a.out / "sites.json"
    old = json.loads(summary.read_text()) if summary.exists() else {}
    old.update({r["id"]: r for r in rows})
    summary.write_text(json.dumps(old, indent=1))
    print(f"{len(rows)}/{len(sites)} kits in {a.out}; {sum(r['mesh'] for r in rows):,} mesh cells a direction")


if __name__ == "__main__":
    main()
