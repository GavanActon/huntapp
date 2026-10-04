"""What the Quebec adapters (qc_vectors.py, qc_forest.py) share: the
province's open services, a patient way of asking them, and the GeoJSON
writer. docs/AREAS.md ("Lac Bailey") says what was checked where.

Every answer is kept under pipeline/raw/qc/<id>/ (province-wide downloads
in pipeline/raw/qc/), named by the layer and a hash of the request, so a
rerun reads the cache and asks again only for what failed or changed.
Delete a file, or the folder, to fetch it fresh.

The MRNF ArcGIS server (servicescarto: GRHQ, AQréseau, TRQ) is slow, goes
503 for an hour at a time, and resets connections from python-requests
while urllib gets through, so everything here goes through urllib with
retries and a growing wait. The MRNF and MERN GeoServers and geoegl refuse
browser origins: their layers are baked, never fetched by the app.

Standard library and shapely only: qc_vectors.py runs under py -3.13 (it
needs pyogrio for the TRQ file geodatabase), qc_forest.py under py -3.14.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import math
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import shapely

from area import ID, JURISDICTION
from common import CACHE_DIR, OUT_DIR, REGION

if JURISDICTION != "QC":
    raise SystemExit(f"{REGION['name']} is in {JURISDICTION}: these are Quebec's sources, use the area's own adapters (bake_area.py)")

SHARED = CACHE_DIR / "qc"
CACHE = SHARED / ID
CACHE.mkdir(parents=True, exist_ok=True)

MRNF = "https://servicescarto.mrnf.gouv.qc.ca/pes/rest/services/Territoire"
GRHQ = f"{MRNF}/GRHQ_WMS/MapServer"  # 23 water surfaces, 15 streams at full detail
AQRESEAU = f"{MRNF}/AQreseau_WMS/MapServer"
WETLANDS = "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Biodiversite/MH_potentiels/MapServer/0"
ECOFOR = "https://geoegl.msp.gouv.qc.ca/ws/mffpecofor.fcgi"  # carte écoforestière, WFS and WMS
SMARTFAUNE = "https://servicesvecto3.mern.gouv.qc.ca/geoserver/SmartFaunePub/ows"
TRQ_ZIP = "https://diffusion.mern.gouv.qc.ca/diffusion/RGQ/Vectoriel/Theme/Regional/TRQ/FGDB/TRQ.gdb.zip"

# geoegl answers GeoJSON only to this exact format name (shorter ones give
# an error or GML), and the text is UTF-8 whatever the charset says
ECOFOR_JSON = "application/json; subtype=geojson; charset=iso-8859-1"

UA = {"User-Agent": "huntapp-pipeline/1.0 (area bake)"}
# seconds between tries; the MRNF server's 503 spells last minutes to hours,
# after which a rerun picks up from the cache
WAITS = (5, 10, 20, 40, 60, 90, 120)


def _query(params: dict | None) -> str:
    # %20 for spaces, not '+': geoegl's MapServer wants the format name exact
    return urllib.parse.urlencode(params, quote_via=urllib.parse.quote) if params else ""


def _short(url: str) -> str:
    u = urllib.parse.urlsplit(url)
    return f"{u.netloc}/…/{'/'.join(u.path.rstrip('/').split('/')[-4:])}"


def get(url: str, params: dict | None = None, timeout: float = 180) -> bytes:
    """GET with retries on 5xx, timeouts and dropped connections."""
    full = url + ("?" + _query(params) if params else "")
    for wait in (*WAITS, None):
        try:
            with urllib.request.urlopen(urllib.request.Request(full, headers=UA), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code < 500 or wait is None:
                raise SystemExit(f"{_short(url)}: HTTP {e.code}") from e
            why = f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, http.client.HTTPException) as e:
            if wait is None:
                raise SystemExit(f"{_short(url)}: {e}") from e
            why = type(e).__name__
        print(f"  {why} from {_short(url)}; again in {wait} s")
        time.sleep(wait)
    raise AssertionError("unreachable")


def decode(body: bytes) -> str:
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return body.decode("cp1252", "replace")


def cache_path(name: str, url: str, params: dict | None, ext: str = "json", folder: Path = CACHE) -> Path:
    key = hashlib.sha1(f"{url}?{_query(params)}".encode()).hexdigest()[:10]
    return folder / f"{name}-{key}.{ext}"


def _keep(path: Path, body: bytes) -> None:
    tmp = path.with_name(path.name + ".part")
    tmp.write_bytes(body)
    tmp.replace(path)


def fetch_json(name: str, url: str, params: dict | None = None, timeout: float = 180) -> dict:
    """A JSON answer, from the cache or the server. An ArcGIS error in a 200
    answer (503 'Wait timeout' is the common one) or a MapServer exception
    page is retried like a failed request, and never cached."""
    path = cache_path(name, url, params)
    if path.exists():
        return json.loads(decode(path.read_bytes()))
    for wait in (*WAITS, None):
        body = get(url, params, timeout)
        try:
            j = json.loads(decode(body))
        except ValueError:
            why = "not JSON: " + decode(body[:160]).replace("\n", " ")
        else:
            err = j.get("error") if isinstance(j, dict) else None
            if not err:
                _keep(path, body)
                return j
            why = f"server error {err.get('code')}: {err.get('message')}"
            if 0 < int(err.get("code") or 0) < 500:
                raise SystemExit(f"{name}: {why}")
        if wait is None:
            raise SystemExit(f"{name}: {why}")
        print(f"  {name}: {why}; again in {wait} s")
        time.sleep(wait)
    raise AssertionError("unreachable")


def download(url: str, dest: Path, timeout: float = 600) -> Path:
    """A whole file (a province-wide zip) into the shared cache, once."""
    if dest.exists():
        return dest
    print(f"  downloading {url}")
    _keep(dest, get(url, timeout=timeout))
    print(f"  {dest.name}: {dest.stat().st_size / 1e6:.1f} MB")
    return dest


# ---- the boxes ----------------------------------------------------------------


def box_of(margin_deg: float = 0.0) -> tuple[float, float, float, float]:
    """The area's region as (west, south, east, north), widened by a margin."""
    return (REGION["west"] - margin_deg, REGION["south"] - margin_deg, REGION["east"] + margin_deg, REGION["north"] + margin_deg)


def tiles(box: tuple[float, float, float, float], size_deg: float) -> list[tuple[float, float, float, float]]:
    """The box cut into a grid of tiles no bigger than size_deg a side."""
    w, s, e, n = box
    nx, ny = max(1, math.ceil((e - w) / size_deg - 1e-9)), max(1, math.ceil((n - s) / size_deg - 1e-9))
    dx, dy = (e - w) / nx, (n - s) / ny
    return [(round(w + i * dx, 6), round(s + j * dy, 6), round(w + (i + 1) * dx, 6), round(s + (j + 1) * dy, 6)) for j in range(ny) for i in range(nx)]


# ---- the services -------------------------------------------------------------


def arcgis(name: str, layer_url: str, box: tuple[float, float, float, float], fields: str = "*", where: str = "1=1", page: int = 1000) -> list[dict]:
    """Every feature of an ArcGIS layer that touches the box, as GeoJSON in
    lon/lat, page by page past the server's record limit (2000 on these)."""
    w, s, e, n = box
    feats: list[dict] = []
    offset = 0
    while True:
        q = {
            "where": where,
            "geometry": f"{w},{s},{e},{n}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": fields,
            "outSR": "4326",
            "orderByFields": "OBJECTID",  # pages stay put between requests
            "f": "geojson",
            "resultOffset": str(offset),
            "resultRecordCount": str(page),
        }
        j = fetch_json(f"{name}-{offset}", f"{layer_url}/query", q)
        got = j.get("features") or []
        feats.extend(got)
        more = (j.get("properties") or {}).get("exceededTransferLimit") or j.get("exceededTransferLimit")
        if not got or not more:
            break
        offset += len(got)
    print(f"  {name}: {len(feats)} features")
    return feats


def ecofor(typename: str, box: tuple[float, float, float, float], tile_deg: float | None = None) -> list[dict]:
    """A carte écoforestière layer (ms:ori_pee_close_scale, ms:ca_feu_close_scale
    …) over the box. The WFS (1.0.0, the version that takes a lon/lat bbox)
    has no paging, so a big box is asked for in tiles. Polygons come back
    whole, not cut at the tile, so they are kept once each by ogc_fid."""
    seen: dict[int, dict] = {}
    parts = tiles(box, tile_deg) if tile_deg else [box]
    for k, (w, s, e, n) in enumerate(parts):
        q = {"service": "WFS", "version": "1.0.0", "request": "GetFeature", "typeName": typename, "bbox": f"{w},{s},{e},{n}", "outputFormat": ECOFOR_JSON}
        t = time.time()
        fc = fetch_json(typename.split(":")[-1], ECOFOR, q, timeout=600)
        for f in fc.get("features") or []:
            seen.setdefault(int(f["properties"]["ogc_fid"]), f)
        if len(parts) > 1:
            print(f"  {typename}: tile {k + 1}/{len(parts)}, {len(seen)} so far ({time.time() - t:.0f} s)")
    print(f"  {typename}: {len(seen)} features")
    return list(seen.values())


# ---- writing --------------------------------------------------------------------


def tidy(g, simplify_deg: float = 0.0):
    """A geometry made valid, optionally simplified, on a 1e-6° grid (about
    0.1 m: the precision the other bakes write), or None when nothing is left."""
    if g is None or g.is_empty:
        return None
    poly = shapely.get_dimensions(g) == 2
    if poly and not g.is_valid:
        g = shapely.make_valid(g)
    if simplify_deg:
        g = shapely.simplify(g, simplify_deg, preserve_topology=True)
    g = shapely.set_precision(g, 0.000001)
    if poly and g.geom_type == "GeometryCollection":  # make_valid can leave stray points and lines
        parts = [p for p in shapely.get_parts(g) if p.geom_type in ("Polygon", "MultiPolygon")]
        g = shapely.union_all(parts) if parts else None
    return None if g is None or g.is_empty else g


def feature(g, props: dict) -> dict:
    return {"type": "Feature", "geometry": json.loads(shapely.to_geojson(g)), "properties": props}


def write_geojson(theme: str, feats: list[dict], name: str, folder: Path | None = None) -> Path:
    """<theme>-<id>.geojson into the area's folder (or another), compact, names kept in UTF-8."""
    path = (folder or OUT_DIR) / f"{theme}-{ID}.geojson"
    fc = {"type": "FeatureCollection", "name": name, "features": feats}
    path.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path.name} ({path.stat().st_size / 1e6:.2f} MB, {len(feats)} features)")
    return path


def year_of(v) -> int | None:
    """A plausible event year out of a text field ('1991'), else None. 1900
    is a placeholder in the cut layer, not a date."""
    try:
        y = int(str(v).strip()[:4])
    except ValueError:
        return None
    return y if 1900 < y <= time.localtime().tm_year + 1 else None
