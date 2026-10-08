"""The coverage index: for every tile of the SD lattice over Canada's hunting
range, what the ground there can have, read off the catalogues rather
than looked up when someone taps (docs/EXPLORE.md). The Explore view
colours its grid by it, and the tile card reads its layers off it.

    py -3.14 pipeline/coverage.py [--box W S E N] [--out DIR] [--no-pmtiles]

Per tile (tiles.py's lattice, t-<i>-<j>):
  prov     the province or territory the tile's centre is in (Natural Earth
           50 m admin-1; a tile whose centre is in no province is left out)
  lidar    the newest 1 m HRDEM LiDAR project's year over the tile, 0 for
           none (NRCan's STAC, collection hrdem-lidar; the item geometry is
           the project's extent, a little coarse at the edges)
  lidarN   how many projects meet it
  project  the newest project's id
  stands   where the stands would come from: an FRI FIMv2 2D package by
           its inventory year in Ontario (the GeoHub FRI_v2_Boundaries
           layer), the carte écoforestière south of 52° N in Quebec (an
           estimate of its extent), the VRI in British Columbia, else the
           national SCANFI maps
  water    the water and roads adapter: LIO (ON), GRHQ and AQréseau (QC),
           FWA and DRA (BC), GeoYukon and CanVec (YT), else the national
           layers, not wired yet
  grade    1 SD only, 2 HD possible (1 m LiDAR), 3 HD with inventory stands
  baked    hd or sd where an area of the app already covers the tile's
           centre (app/src/areas/*.json with a micro grid), else empty

Outputs under --out (pipeline/raw/coverage): tiles-ca.geojson, a stats
table on the console, and coverage-ca.pmtiles with layer `tiles` at
z6–z10 and `blocks` (1° squares: tiles, the share with LiDAR, the share
with inventory stands) at z2–z6, both in EPSG:3857 as the map reads them.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import sys
import time
from collections import defaultdict
from datetime import date
from pathlib import Path

import mapbox_vector_tile
import requests
import shapely
from mapbox_vector_tile.encoder import on_invalid_geometry_make_valid
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from tiles import D_LAT, D_LON, LAT0, LON0, TILE_COLS, TILE_ROWS, tile_box, tile_id, tiles_in  # noqa: E402

STAC_SEARCH = "https://datacube.services.geo.ca/stac/api/search"
FRI_BOUNDS = "https://services9.arcgis.com/a03W7iZ8T3s5vB7p/arcgis/rest/services/FRI_v2_Boundaries/FeatureServer/0/query"
NE_ADMIN1 = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson"
# Canada's hunting range, roughly: the provinces and the Yukon, to 66° N
DEFAULT_BOX = (-141.0, 42.0, -52.0, 66.0)
QC_ECOFOR_NORTH = 52.0
WATER_BY_PROV = {"ON": "LIO", "QC": "GRHQ, AQréseau", "BC": "FWA, DRA", "YT": "GeoYukon, CanVec"}
STANDS_BY_PROV = {"QC": "écoforestière", "BC": "VRI"}
EXTENT = 4096
TILES_Z = (6, 10)
BLOCKS_Z = (2, 6)


def fetch_json(url: str, params: dict | None = None, tries: int = 5) -> dict:
    for attempt in range(tries):
        try:
            r = requests.get(url, params=params, timeout=90)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            print(f"  retry {attempt + 1} on {url.split('?')[0][-50:]}: {str(e)[:80]}", flush=True)
            time.sleep(3 * (attempt + 1))
    raise SystemExit(f"could not fetch {url}")


def cached_json(name: str, out: Path, make) -> dict:
    """A catalogue fetched once a day: the file under out/catalogues/."""
    p = out / "catalogues" / name
    if p.exists() and (time.time() - p.stat().st_mtime) < 86400:
        return json.loads(p.read_text(encoding="utf-8"))
    j = make()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(j), encoding="utf-8")
    return j


def hrdem_projects(box: tuple[float, float, float, float], out: Path) -> dict:
    def make():
        bbox = ",".join(str(v) for v in box)
        feats = []
        url, params = STAC_SEARCH, {"collections": "hrdem-lidar", "bbox": bbox, "limit": 100}
        while url:
            j = fetch_json(url, params)
            feats += j.get("features", [])
            nxt = next((l for l in j.get("links", []) if l.get("rel") == "next"), None)
            url, params = (nxt["href"], None) if nxt else (None, None)
            print(f"  HRDEM projects: {len(feats)} so far", flush=True)
        return {"type": "FeatureCollection", "features": feats}

    return cached_json("hrdem-lidar.json", out, make)


def fri_packages(out: Path) -> dict:
    def make():
        return fetch_json(FRI_BOUNDS, {"where": "1=1", "outFields": "FMU_NAME,Data_2D,Year,Data_3D", "outSR": "4326", "returnGeometry": "true", "f": "geojson"})

    return cached_json("fri-v2-boundaries.json", out, make)


def provinces(out: Path) -> dict:
    return cached_json("ne-admin1.json", out, lambda: fetch_json(NE_ADMIN1))


def baked_areas() -> list[dict]:
    """The app's areas with a micro grid: the box each covers and its level."""
    areas = []
    for p in sorted((ROOT / "app" / "src" / "areas").glob("*.json")):
        try:
            a = json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        cov = (a.get("coverage") or {}).get("grids", {})
        if not cov.get("micro", {}).get("file"):
            continue
        pm = (a.get("coverage") or {}).get("pmtiles", {})
        hd = bool(pm.get("hillshadeLidar", {}).get("file")) or (a.get("bake") or {}).get("lidar") != "none" and bool((a.get("bake") or {}).get("hrdem"))
        c = a["core"]
        areas.append({"id": a["id"], "level": "hd" if hd else "sd", "geom": shapely.box(c["west"], c["south"], c["east"], c["north"])})
    return areas


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--box", type=float, nargs=4, metavar=("W", "S", "E", "N"), default=list(DEFAULT_BOX))
    ap.add_argument("--out", default=str(HERE / "raw" / "coverage"))
    ap.add_argument("--no-pmtiles", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    box = tuple(args.box)
    t0 = time.time()

    # ---- the catalogues
    ne = provinces(out)
    prov_geoms, prov_codes = [], []
    for f in ne["features"]:
        pr = f.get("properties", {})
        if pr.get("iso_a2") != "CA" and pr.get("adm0_a3") != "CAN":
            continue
        code = (pr.get("iso_3166_2") or "").split("-")[-1]
        prov_geoms.append(shapely.geometry.shape(f["geometry"]))
        prov_codes.append(code)
    prov_tree = shapely.STRtree(prov_geoms)
    print(f"provinces: {len(prov_geoms)} from Natural Earth", flush=True)

    hr = hrdem_projects(box, out)
    hr_geoms, hr_props = [], []
    for f in hr["features"]:
        try:
            g = shapely.geometry.shape(f["geometry"])
        except Exception:  # noqa: BLE001
            continue
        year = int((f.get("properties", {}).get("datetime") or "0000")[:4] or 0)
        hr_geoms.append(g)
        hr_props.append({"id": f.get("id", ""), "year": year})
    hr_tree = shapely.STRtree(hr_geoms)
    print(f"HRDEM LiDAR projects over the box: {len(hr_geoms)}", flush=True)

    fri = fri_packages(out)
    fri_geoms, fri_props = [], []
    for f in fri.get("features", []):
        pr = f.get("properties", {})
        if not pr.get("Data_2D"):
            continue
        fri_geoms.append(shapely.geometry.shape(f["geometry"]))
        fri_props.append({"fmu": pr.get("FMU_NAME", ""), "year": pr.get("Year")})
    fri_tree = shapely.STRtree(fri_geoms)
    print(f"FRI FIMv2 2D packages: {len(fri_geoms)} of {len(fri.get('features', []))} units", flush=True)

    areas = baked_areas()
    area_tree = shapely.STRtree([a["geom"] for a in areas])
    print(f"baked areas: {', '.join(a['id'] + ' (' + a['level'] + ')' for a in areas)}", flush=True)

    # ---- the tiles
    ids = tiles_in(box)
    print(f"lattice over the box: {len(ids)} tiles", flush=True)
    feats = []
    blocks: dict[tuple[int, int], dict] = defaultdict(lambda: {"n": 0, "lidar": 0, "inv": 0})
    for i, j in ids:
        b = tile_box(i, j)
        cx, cy = (b["west"] + b["east"]) / 2, (b["south"] + b["north"]) / 2
        pt = shapely.Point(cx, cy)
        hit = [k for k in prov_tree.query(pt) if prov_geoms[k].contains(pt)]
        if not hit:
            continue
        prov = prov_codes[hit[0]]
        poly = shapely.box(b["west"], b["south"], b["east"], b["north"])
        pk = [k for k in hr_tree.query(poly) if hr_geoms[k].intersects(poly)]
        lidar = max((hr_props[k]["year"] for k in pk), default=0)
        project = max(((hr_props[k]["year"], hr_props[k]["id"]) for k in pk), default=(0, ""))[1]
        stands = "SCANFI"
        if prov == "ON":
            fk = [k for k in fri_tree.query(poly) if fri_geoms[k].intersects(poly)]
            if fk:
                yr = max((fri_props[k]["year"] or 0) for k in fk)
                stands = f"FRI {yr}" if yr else "FRI"
        elif prov == "QC" and cy < QC_ECOFOR_NORTH:
            stands = STANDS_BY_PROV["QC"]
        elif prov in STANDS_BY_PROV:
            stands = STANDS_BY_PROV[prov]
        inv = stands != "SCANFI"
        grade = 3 if lidar and inv else 2 if lidar else 1
        ak = [k for k in area_tree.query(pt) if areas[k]["geom"].contains(pt)]
        baked = areas[ak[0]]["level"] if ak else ""
        props = {
            "id": tile_id(i, j),
            "i": i,
            "j": j,
            "prov": prov,
            "lidar": lidar,
            "lidarN": len(pk),
            "project": project,
            "stands": stands,
            "water": WATER_BY_PROV.get(prov, "national, not wired"),
            "grade": grade,
            "baked": baked,
        }
        feats.append({"type": "Feature", "geometry": shapely.geometry.mapping(poly), "properties": props})
        bk = (math.floor(cx), math.floor(cy))
        blocks[bk]["n"] += 1
        blocks[bk]["lidar"] += 1 if lidar else 0
        blocks[bk]["inv"] += 1 if inv else 0
    print(f"tiles in a province: {len(feats)} · {time.time() - t0:.0f} s", flush=True)

    gj = out / "tiles-ca.geojson"
    gj.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    print(f"wrote {gj} ({gj.stat().st_size / 1e6:.1f} MB)")

    # ---- the stats
    by: dict[str, dict] = defaultdict(lambda: {"n": 0, "lidar": 0, "inv": 0, "both": 0})
    for f in feats:
        p = f["properties"]
        d = by[p["prov"]]
        d["n"] += 1
        d["lidar"] += 1 if p["lidar"] else 0
        d["inv"] += 1 if p["stands"] != "SCANFI" else 0
        d["both"] += 1 if p["grade"] == 3 else 0
    print("\nprov   tiles   1 m LiDAR   inventory stands   both")
    for prov, d in sorted(by.items(), key=lambda kv: -kv[1]["n"]):
        print(f"{prov:4} {d['n']:7d}   {100 * d['lidar'] / d['n']:6.0f}%   {100 * d['inv'] / d['n']:9.0f}%   {100 * d['both'] / d['n']:6.0f}%")
    tot = sum(d["n"] for d in by.values())
    print(f"all  {tot:7d}   {100 * sum(d['lidar'] for d in by.values()) / tot:6.0f}%   {100 * sum(d['inv'] for d in by.values()) / tot:9.0f}%   {100 * sum(d['both'] for d in by.values()) / tot:6.0f}%")
    years = defaultdict(int)
    for f in feats:
        if f["properties"]["lidar"]:
            years[f["properties"]["lidar"]] += 1
    print("LiDAR by year of the newest project: " + ", ".join(f"{y}: {n}" for y, n in sorted(years.items())))

    if args.no_pmtiles:
        return 0
    write_pmtiles(out / "coverage-ca.pmtiles", feats, blocks, box)
    return 0


def to_3857(lon: float, lat: float) -> tuple[float, float]:
    r = 6378137.0
    return math.radians(lon) * r, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * r


def box_3857(w: float, s: float, e: float, n: float) -> shapely.Geometry:
    x0, y0 = to_3857(w, s)
    x1, y1 = to_3857(e, n)
    return shapely.box(x0, y0, x1, y1)


def tile_bounds_3857(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2**z
    size = 2 * math.pi * 6378137.0
    minx = -size / 2 + x * size / n
    maxy = size / 2 - y * size / n
    return minx, maxy - size / n, minx + size / n, maxy


def write_pmtiles(path: Path, feats: list[dict], blocks: dict, box: tuple[float, float, float, float]) -> None:
    t0 = time.time()
    tile_geoms = [box_3857(*shapely.geometry.shape(f["geometry"]).bounds) for f in feats]
    tile_props = [f["properties"] for f in feats]
    tile_tree = shapely.STRtree(tile_geoms)
    block_geoms, block_props = [], []
    for (bx, by_), d in blocks.items():
        block_geoms.append(box_3857(bx, by_, bx + 1, by_ + 1))
        block_props.append({"lon": bx, "lat": by_, "n": d["n"], "lidar": round(d["lidar"] / d["n"], 2), "inv": round(d["inv"] / d["n"], 2)})
    block_tree = shapely.STRtree(block_geoms)
    w, s, e, n = box
    count, total = 0, 0

    def tiles_at(z: int):
        size = 2 * math.pi * 6378137.0
        x0w, y0n = to_3857(w, n)
        x1e, y1s = to_3857(e, s)
        tx0 = int((x0w + size / 2) / (size / 2**z))
        tx1 = int((x1e + size / 2) / (size / 2**z))
        ty0 = int((size / 2 - y0n) / (size / 2**z))
        ty1 = int((size / 2 - y1s) / (size / 2**z))
        return [(x, y) for x in range(tx0, tx1 + 1) for y in range(ty0, ty1 + 1)]

    with open(path, "wb") as f:
        writer = Writer(f)
        for z in range(BLOCKS_Z[0], TILES_Z[1] + 1):
            for x, y in tiles_at(z):
                minx, miny, maxx, maxy = tile_bounds_3857(z, x, y)
                pad = (maxx - minx) * 8 / EXTENT
                q = shapely.box(minx - pad, miny - pad, maxx + pad, maxy + pad)
                layers = []
                if BLOCKS_Z[0] <= z <= BLOCKS_Z[1]:
                    fs = [{"geometry": shapely.clip_by_rect(block_geoms[k], minx - pad, miny - pad, maxx + pad, maxy + pad), "properties": block_props[k]} for k in block_tree.query(q)]
                    fs = [ft for ft in fs if not ft["geometry"].is_empty]
                    if fs:
                        layers.append({"name": "blocks", "features": fs})
                if TILES_Z[0] <= z <= TILES_Z[1]:
                    fs = [{"geometry": shapely.clip_by_rect(tile_geoms[k], minx - pad, miny - pad, maxx + pad, maxy + pad), "properties": tile_props[k]} for k in tile_tree.query(q)]
                    fs = [ft for ft in fs if not ft["geometry"].is_empty]
                    if fs:
                        layers.append({"name": "tiles", "features": fs})
                if not layers:
                    continue
                pbf = mapbox_vector_tile.encode(layers, default_options={"quantize_bounds": (minx, miny, maxx, maxy), "extents": EXTENT, "on_invalid_geometry": on_invalid_geometry_make_valid})
                data = gzip.compress(pbf, 6)
                writer.write_tile(zxy_to_tileid(z, x, y), data)
                count += 1
                total += len(data)
            print(f"  z{z}: {count} tiles, {total / 1e6:.1f} MB so far", flush=True)
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_lon_e7": int(w * 1e7),
                "min_lat_e7": int(s * 1e7),
                "max_lon_e7": int(e * 1e7),
                "max_lat_e7": int(n * 1e7),
                "min_zoom": BLOCKS_Z[0],
                "max_zoom": TILES_Z[1],
                "center_zoom": 5,
                "center_lon_e7": int((w + e) / 2 * 1e7),
                "center_lat_e7": int((s + n) / 2 * 1e7),
            },
            {
                "name": path.stem,
                "attribution": "Coverage from NRCan HRDEM, Ontario GeoHub FRI, Natural Earth",
                "generated": date.today().isoformat(),
                "vector_layers": [
                    {"id": "blocks", "minzoom": BLOCKS_Z[0], "maxzoom": BLOCKS_Z[1], "fields": {}},
                    {"id": "tiles", "minzoom": TILES_Z[0], "maxzoom": TILES_Z[1], "fields": {}},
                ],
            },
        )
    print(f"wrote {path.name} ({path.stat().st_size / 1e6:.1f} MB, {count} tiles, {time.time() - t0:.0f} s)")


if __name__ == "__main__":
    sys.exit(main())
