"""The Yukon's vector layers for an area, in the normal forms the app and the
bakes read: the same file and property names the Ontario adapter
(build_vectors.py) takes straight off LIO. Everything is from GeoYukon's
ArcGIS services, under the Open Government Licence - Yukon, except the
CanVec water (OGL-Canada) that GeoYukon serves.

  waterbody-<id>.geojson    CanVec 1:50 000 waterbodies: WATERBODY_TYPE Lake |
                            Pond | River, OFFICIAL_NAME_LABEL, PERMANENCY
  watercourse-<id>.geojson  CanVec 1:50 000 watercourses: WATERCOURSE_TYPE Stream
  wetland-<id>.geojson      none open at this scale near the Yukon areas so far:
                            written empty, so the bakes that read it run
  roads-<id>.geojson        the Yukon Road Network, and the access roads, trails
                            and cut lines digitised off 2014-16 SPOT imagery
                            (surface disturbance lines): ROAD_NAME, KIND
  fire-<id>.geojson         Yukon fire history: FIRE_YEAR, FIRE_FINAL_SIZE
  wmu-<id>.geojson          game management subzones: OFFICIAL_NAME '4-09'
                            (the layer holds only the id, 409; generalised,
                            not for legal use)
  crown-<id>.geojson        First Nation settlement land (the map's "Private
                            land"): FIRST_NATION_NAME, SL_CATEGORY (A, B, Fee
                            simple), PARCEL_DESIGNATOR. Category A needs the
                            First Nation's permission to hunt on.

    py -3.14 pipeline/yt_vectors.py --area highland-lake           # every layer
    py -3.14 pipeline/yt_vectors.py --area highland-lake fire wmu  # just these

Answers are cached under pipeline/raw/yt/<id>/, so a rerun asks nothing.
The server is in Yukon Albers; every query asks for lon/lat in and out.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import shapely

sys.path.insert(0, str(Path(__file__).resolve().parent))
import area  # noqa: E402  (first: it takes --area out of argv)
from common import CACHE_DIR, OUT_DIR, REGION  # noqa: E402

if area.JURISDICTION != "YT":
    raise SystemExit(f"{REGION['name']} is in {area.JURISDICTION}: these are the Yukon's sources")

GY = "https://mapservices.gov.yk.ca/arcgis/rest/services/GeoYukon"
LAYERS = {
    "waterbody": f"{GY}/GY_Basemap/MapServer/38",
    "watercourse": f"{GY}/GY_Basemap/MapServer/29",
    "roads": f"{GY}/GY_Transportation/MapServer/60",
    "disturbance": f"{GY}/GY_EnvironmentalMonitoring/MapServer/29",
    "fire": f"{GY}/GY_EmergencyManagement/MapServer/14",
    "wmu": f"{GY}/GY_AdministrativeBoundaries/MapServer/7",
    "crown": f"{GY}/GY_FirstNations/MapServer/17",
}
CACHE = CACHE_DIR / "yt" / area.ID
UA = {"User-Agent": "huntapp-pipeline/1.0 (area bake)"}
# CanVec's water_definition codes
WATER_TYPE = {83: "Lake", 86: "Pond", 87: "Lake", 91: "River", 88: "River", 89: "River"}
# the surface disturbance lines that are a way through the bush
WAYS = ("road", "trail", "cutline", "cut line", "access")


def get_json(name: str, url: str, params: dict) -> dict:
    key = hashlib.sha1((url + "?" + urllib.parse.urlencode(sorted(params.items()))).encode()).hexdigest()[:12]
    path = CACHE / f"{name}-{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    full = url + "?" + urllib.parse.urlencode(params)
    for wait in (5, 15, 30, 60, 120):
        try:
            with urllib.request.urlopen(urllib.request.Request(full, headers=UA), timeout=240) as r:
                body = r.read()
            j = json.loads(body)
            if "error" in j:
                raise RuntimeError(j["error"])
            CACHE.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            return j
        except Exception as e:  # noqa: BLE001
            print(f"  {name}: {str(e)[:100]}; again in {wait} s")
            time.sleep(wait)
    raise SystemExit(f"{name}: the server would not answer ({url})")


def query(name: str, layer: str, fields: str = "*") -> list[dict]:
    """Every feature touching the region, as GeoJSON in lon/lat, page by page."""
    w, s, e, n = REGION["west"], REGION["south"], REGION["east"], REGION["north"]
    feats: list[dict] = []
    offset = 0
    while True:
        j = get_json(
            f"{name}-{offset}",
            f"{LAYERS[layer]}/query",
            {
                "where": "1=1",
                "geometry": f"{w},{s},{e},{n}",
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "spatialRel": "esriSpatialRelIntersects",
                "outFields": fields,
                "outSR": "4326",
                "orderByFields": "OBJECTID",
                "f": "geojson",
                "resultOffset": str(offset),
                "resultRecordCount": "1000",
            },
        )
        got = j.get("features") or []
        feats.extend(got)
        if not got or not ((j.get("properties") or {}).get("exceededTransferLimit") or j.get("exceededTransferLimit")):
            break
        offset += len(got)
    print(f"  {name}: {len(feats)} features")
    return feats


def tidy(g):
    if g is None or g.is_empty:
        return None
    if not g.is_valid:
        g = shapely.make_valid(g)
    g = shapely.set_precision(g, 0.000001)
    return None if g.is_empty else g


def shapes(feats: list[dict]):
    for f in feats:
        g = tidy(shapely.geometry.shape(f["geometry"])) if f.get("geometry") else None
        if g is not None:
            yield g, f.get("properties") or {}


def write(theme: str, feats: list[dict], name: str, source: str, licence: str = "OGL-Yukon") -> None:
    path = OUT_DIR / f"{theme}-{area.ID}.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "name": name, "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path.name} ({path.stat().st_size / 1e6:.2f} MB, {len(feats)} features)")
    area.note_source(path.name, source=source, licence=licence)


def feature(g, props: dict) -> dict:
    return {"type": "Feature", "geometry": json.loads(shapely.to_geojson(g)), "properties": props}


def _name(*vals) -> str | None:
    for v in vals:
        if isinstance(v, str) and v.strip() and v.strip().lower() not in ("null", "none"):
            return v.strip()
    return None


def waterbody() -> None:
    out = []
    for g, p in shapes(query("waterbody", "waterbody", "WATER_DEFINITION,PERMANENCY,NAME_EN,NAME_LK1_EN,NAME_OTHER")):
        kind = WATER_TYPE.get(p.get("WATER_DEFINITION"))
        if kind is None:
            continue
        out.append(feature(g, {"WATERBODY_TYPE": kind, "OFFICIAL_NAME_LABEL": _name(p.get("NAME_EN"), p.get("NAME_LK1_EN"), p.get("NAME_OTHER")), "PERMANENCY": "Intermittent" if p.get("PERMANENCY") == 60 else "Permanent"}))
    write("waterbody", out, "CanVec 1:50 000 waterbodies (GeoYukon)", "CanVec 1:50 000 waterbodies, via GeoYukon", "OGL-Canada")


def watercourse() -> None:
    out = [feature(g, {"WATERCOURSE_TYPE": "Stream", "OFFICIAL_NAME_LABEL": _name(p.get("NAME_EN"))}) for g, p in shapes(query("watercourse", "watercourse", "NAME_EN,PERMANENCY"))]
    write("watercourse", out, "CanVec 1:50 000 watercourses (GeoYukon)", "CanVec 1:50 000 watercourses, via GeoYukon", "OGL-Canada")


def wetland() -> None:
    write("wetland", [], "none open at this scale", "none open at this scale here (CanVec and the Yukon wetlands have none near)")


def roads() -> None:
    out = [feature(g, {"ROAD_NAME": _name(p.get("ROUTE_NAME_1_EN"), p.get("STREET_NAME")), "KIND": _name(p.get("ROAD_TYPE")) or "road"}) for g, p in shapes(query("roads", "roads"))]
    kept = 0
    for g, p in shapes(query("disturbance", "disturbance", "TYPE_INDUSTRY,TYPE_DISTURBANCE,IMAGE_DATE")):
        kind = (p.get("TYPE_DISTURBANCE") or "").strip()
        if any(w in kind.lower() for w in WAYS):
            out.append(feature(g, {"ROAD_NAME": None, "KIND": kind}))
            kept += 1
    print(f"  {kept} access roads, trails and cut lines off the surface disturbance lines")
    write("roads", out, "Yukon Road Network and surface disturbance lines (GeoYukon)", "Yukon Road Network and surface disturbance lines (access roads, trails, cut lines), GeoYukon")


def fire() -> None:
    out = []
    for g, p in shapes(query("fire", "fire", "FIRE_YEAR,FIRE_NUMBER,AREA_HECTARES")):
        if p.get("FIRE_YEAR"):
            out.append(feature(g, {"FIRE_YEAR": int(p["FIRE_YEAR"]), "FIRE_TYPE_CODE": None, "FIRE_FINAL_SIZE": round(float(p.get("AREA_HECTARES") or 0), 1)}))
    years = sorted({f["properties"]["FIRE_YEAR"] for f in out})
    print(f"  burns: {', '.join(map(str, years))}")
    write("fire", out, "Yukon fire history (GeoYukon)", "Yukon fire history, Wildland Fire Management, GeoYukon")


def wmu() -> None:
    out = []
    for g, p in shapes(query("wmu", "wmu")):
        i = p.get("GAME_MGMT_AREA_ID")
        if i:
            out.append(feature(g, {"OFFICIAL_NAME": f"{int(i) // 100}-{int(i) % 100:02d}"}))
    print(f"  subzones: {', '.join(sorted(f['properties']['OFFICIAL_NAME'] for f in out))}")
    write("wmu", out, "Game management subzones (GeoYukon; generalised, not for legal use)", "Game Management Areas 250k (subzones), GeoYukon; generalised, not for legal use")


def crown() -> None:
    out = []
    for g, p in shapes(query("settlement", "crown", "FIRST_NATION_NAME,FN_NAME_CODE,SL_CATEGORY,PARCEL_DESIGNATOR,SL_DESIGNATION")):
        if shapely.get_dimensions(g) != 2:
            continue
        out.append(feature(g, {k: _name(p.get(k)) for k in ("FIRST_NATION_NAME", "SL_CATEGORY", "PARCEL_DESIGNATOR", "SL_DESIGNATION")}))
    cats: dict = {}
    for f in out:
        cats[f["properties"]["SL_CATEGORY"]] = cats.get(f["properties"]["SL_CATEGORY"], 0) + 1
    print(f"  settlement land parcels by category: {cats}")
    write("crown", out, "First Nation settlement land (GeoYukon)", "First Nation Settlement Lands, GeoYukon")


THEMES = {"waterbody": waterbody, "watercourse": watercourse, "wetland": wetland, "roads": roads, "fire": fire, "wmu": wmu, "crown": crown}


def main() -> int:
    asked = [a for a in sys.argv[1:] if not a.startswith("-")] or list(THEMES)
    for t in asked:
        if t not in THEMES:
            raise SystemExit(f"no layer {t!r}; the layers are {', '.join(THEMES)}")
    for t in asked:
        print(f"{t}:")
        THEMES[t]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
