"""What British Columbia's adapters share: the province's open WFS (the BC
Geographic Warehouse through openmaps.gov.bc.ca, GeoServer), fetched by
layer over the area's region and cached, and the small helpers that turn
its features into the normal forms the bakes read.

Every layer here is under the Open Government Licence - British Columbia
unless a function says otherwise. The server wants its bounding box as
lon,lat for EPSG:4326 (not the WFS 2.0 lat,lon order), and leaves the
geometry out of an answer whose propertyName does not name GEOMETRY.
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

ID = area.ID
WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs"
CACHE = CACHE_DIR / "bc" / ID
UA = {"User-Agent": "huntapp-pipeline/1.0 (area bake)"}
OGL_BC = "OGL-BC"
PAGE = 5000
WAITS = (5, 15, 30, 60, 120)


def box_of(margin_deg: float = 0.0) -> tuple[float, float, float, float]:
    return (REGION["west"] - margin_deg, REGION["south"] - margin_deg, REGION["east"] + margin_deg, REGION["north"] + margin_deg)


def _get(url: str, name: str) -> bytes:
    key = hashlib.sha1(url.encode()).hexdigest()[:12]
    path = CACHE / f"{name}-{key}.json"
    if path.exists():
        return path.read_bytes()
    for wait in WAITS:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
                body = r.read()
            j = json.loads(body)
            if "features" not in j:
                raise RuntimeError(str(j)[:200])
            CACHE.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            return body
        except Exception as e:  # noqa: BLE001
            print(f"  {name}: {str(e)[:120]}; again in {wait} s")
            time.sleep(wait)
    raise SystemExit(f"{name}: the server would not answer ({url[:160]})")


def geometry_column(layer: str) -> str:
    """The layer's geometry column (GEOMETRY on most, SHAPE on some, the
    fire perimeters among them), from DescribeFeatureType, cached."""
    name = layer.split(".")[-1].lower()
    path = CACHE / f"{name}-schema.xml"
    if not path.exists():
        q = {"service": "WFS", "version": "2.0.0", "request": "DescribeFeatureType", "typeName": f"pub:{layer}"}
        with urllib.request.urlopen(urllib.request.Request(f"{WFS}?{urllib.parse.urlencode(q)}", headers=UA), timeout=120) as r:
            body = r.read()
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    schema = path.read_text(encoding="utf-8", errors="replace")
    for col in ("GEOMETRY", "SHAPE"):
        if f'name="{col}"' in schema:
            return col
    return "GEOMETRY"


def wfs(layer: str, fields: str | None = None, box: tuple[float, float, float, float] | None = None, cql: str | None = None) -> list[dict]:
    """Every feature of pub:<layer> touching the box (the region), as GeoJSON
    in lon/lat, page by page. `fields` narrows the properties (the geometry
    column is always asked for)."""
    w, s, e, n = box or box_of()
    name = layer.split(".")[-1].lower()
    geom = geometry_column(layer) if fields else "GEOMETRY"
    feats: list[dict] = []
    start = 0
    while True:
        q = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeName": f"pub:{layer}",
            "outputFormat": "application/json",
            "srsName": "EPSG:4326",
            "bbox": f"{w},{s},{e},{n},EPSG:4326",
            "count": str(PAGE),
            "startIndex": str(start),
            "sortBy": "OBJECTID",
        }
        if fields:
            q["propertyName"] = ",".join(dict.fromkeys([*fields.split(","), geom]))
        if cql:
            q["CQL_FILTER"] = cql
        j = json.loads(_get(f"{WFS}?{urllib.parse.urlencode(q)}", f"{name}-{start}"))
        got = j.get("features") or []
        feats.extend(got)
        if len(got) < PAGE:
            break
        start += len(got)
    print(f"  {name}: {len(feats)} features")
    return feats


def tidy(g, simplify_deg: float = 0.0):
    """A geometry made valid, optionally simplified, on a 1e-6° grid, or None."""
    if g is None or g.is_empty:
        return None
    poly = shapely.get_dimensions(g) == 2
    if poly and not g.is_valid:
        g = shapely.make_valid(g)
    if simplify_deg:
        g = shapely.simplify(g, simplify_deg, preserve_topology=True)
    g = shapely.set_precision(g, 0.000001)
    if poly and g.geom_type == "GeometryCollection":
        parts = [p for p in shapely.get_parts(g) if p.geom_type in ("Polygon", "MultiPolygon")]
        g = shapely.union_all(parts) if parts else None
    return None if g is None or g.is_empty else g


def shapes(feats: list[dict], clip=None):
    """(geometry, properties) for each feature with one, tidied, and cut to
    `clip` when given (a province-wide polygon need not come whole)."""
    for f in feats:
        g = tidy(shapely.geometry.shape(f["geometry"])) if f.get("geometry") else None
        if g is not None and clip is not None:
            g = tidy(g.intersection(clip))
        if g is not None:
            yield g, f.get("properties") or {}


def feature(g, props: dict) -> dict:
    return {"type": "Feature", "geometry": json.loads(shapely.to_geojson(g)), "properties": props}


def write(theme: str, feats: list[dict], name: str, source: str, licence: str = OGL_BC, **more) -> Path:
    """<theme>-<id>.geojson into the area's folder, and its provenance."""
    path = OUT_DIR / f"{theme}-{ID}.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "name": name, "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path.name} ({path.stat().st_size / 1e6:.2f} MB, {len(feats)} features)")
    area.note_source(path.name, source=source, licence=licence, **more)
    return path


def name_of(*vals) -> str | None:
    for v in vals:
        if isinstance(v, str) and v.strip() and v.strip().lower() not in ("null", "none", "unsigned"):
            return v.strip()
    return None


def year_of(v) -> int | None:
    """The year in a WFS date ('2014-08-10Z'), a number, or None."""
    if v is None:
        return None
    s = str(v).strip()
    return int(s[:4]) if len(s) >= 4 and s[:4].isdigit() else None
