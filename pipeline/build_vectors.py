"""Pull the region's vector layers off Land Information Ontario's ArcGIS REST
services into GeoJSON files under app/public/data/, paging past the
server's record limit. Roads alone are ~9,400 segments here.

The app reads these directly as GeoJSON sources when present (see
mapStyle.ts); a later step can pack them into one vector PMTiles with
tippecanoe (`tippecanoe -o places-<region>.pmtiles -L camps:camps.geojson …`).

    python pipeline/build_vectors.py            # the default set
    python pipeline/build_vectors.py bake       # everything an area bake reads: the default set and the habitat inputs
    python pipeline/build_vectors.py roads wmu  # just these

LIO is Ontario's: an area in another province gets its vectors from its own
adapter (bake_area.py picks it).
"""

from __future__ import annotations

import json
import sys
import time
from urllib.parse import urlencode

import requests

from area import JURISDICTION
from common import OUT_DIR, REGION

LIO = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA"

# name -> (service, layer id, where, outFields)
LAYERS: dict[str, tuple[str, int, str, str]] = {
    "wmu": ("LIO_Open05", 5, "1=1", "OFFICIAL_NAME"),
    "camps": (
        "LIO_Open08",
        33,
        "PURPOSE_OF_DISPOSITION LIKE '%Camp%' OR PURPOSE_OF_DISPOSITION LIKE '%Cottage%' OR PURPOSE_OF_DISPOSITION LIKE '%Lodge%'",
        "CLASS_SUBTYPE,PURPOSE_OF_DISPOSITION,SITE_NAME,LOCATION_DESCR,AREA_IN_HA",
    ),
    "dispositions": ("LIO_Open08", 33, "1=1", "CLASS_SUBTYPE,PURPOSE_OF_DISPOSITION,SITE_NAME,LOCATION_DESCR,AREA_IN_HA"),
    "crown": ("LIO_Open08", 35, "1=1", "TITLE_HOLDER_TYPE,CROWN_RESERVATION_TYPE"),
    "unpatented": ("LIO_Open08", 34, "1=1", "SURVEY_LOCATION_IDENT,AREA_IN_HA"),
    "parks": ("LIO_Open03", 4, "1=1", "PROTECTED_AREA_NAME_ENG,PROVINCIAL_PARK_CLASS_ENG"),
    "reserves": ("LIO_Open03", 2, "1=1", "PROTECTED_AREA_NAME_ENG"),
    "bathy": ("LIO_Open01", 30, "1=1", "DEPTH,SURVEY_DATE,SURVEY_METHOD"),
    "bathy_index": ("LIO_Open01", 31, "1=1", "*"),
    "fire": ("LIO_Open09", 28, "1=1", "FIRE_YEAR,FIRE_TYPE_CODE,FIRE_FINAL_SIZE,FIRE_START_DATE"),
    "roads": (
        "LIO_Open09",
        18,
        "1=1",
        "ROAD_NAME,STATUS,PASSABLE_IND,GATE_IND,BERM_IND,ROAD_USE,FMP_ROAD_CLASS,SURFACE_TYPE,YEAR_CONSTRUCTED,YEAR_DECOMMISSIONED,MAINTENANCE_LEVEL",
    ),
    "road_barriers": ("LIO_Open09", 22, "1=1", "*"),
    "contours": ("LIO_Open01", 29, "1=1", "ELEVATION"),
    "waterbody": ("LIO_Open01", 25, "1=1", "OFFICIAL_NAME_LABEL,WATERBODY_TYPE,PERMANENCY"),
    "watercourse": ("LIO_Open01", 26, "1=1", "OFFICIAL_NAME_LABEL,WATERCOURSE_TYPE,PERMANENCY"),
    "wetland": ("LIO_Open01", 15, "1=1", "WETLAND_TYPE,DOMINANT_VEG_FORM,DOMINANT_VEG_SPECIES,PERCENT_OPEN_WATER"),
    "ara": ("LIO_Open07", 2, "1=1", "OFFICIAL_WATERBODY_NAME,WATERBODY_LID,FISH_SPECIES_SUMMARY,THERMAL_REGIME,SURFACE_AREA,MAXIMUM_DEPTH,MEAN_DEPTH,SECCHI_DEPTH"),
    "bma": ("LIO_Open10", 23, "1=1", "*"),
    "trapline": ("LIO_Open10", 24, "1=1", "*"),
    "fmz": ("LIO_Open07", 14, "1=1", "*"),
    "clupa": ("LIO_Open06", 5, "1=1", "*"),
    "fishing_access": ("LIO_Open07", 15, "1=1", "*"),
    "trails": ("LIO_Open04", 19, "1=1", "*"),
    "rail": ("LIO_Open04", 18, "1=1", "*"),
}

# the small set the app expects as places-<region> when packed as PMTiles
DEFAULT = ["wmu", "camps", "crown", "parks", "bathy", "bathy_index", "fire", "roads", "fishing_access", "trails", "rail", "bma", "trapline", "fmz"]
# what the habitat, going, contour and lake bakes read on top of that
HABITAT = ["waterbody", "watercourse", "wetland", "ara"]


def fetch_layer(service: str, layer: int, where: str, out_fields: str) -> dict:
    base = f"{LIO}/{service}/MapServer/{layer}"
    for attempt in range(5):
        try:
            meta = requests.get(base, params={"f": "pjson"}, timeout=60).json()
            break
        except Exception as e:  # noqa: BLE001  (the LIO front end drops TLS now and then)
            print(f"  meta retry {attempt + 1}: {e}")
            time.sleep(2 * (attempt + 1))
    else:
        raise SystemExit("layer metadata unreachable")
    page = int(meta.get("maxRecordCount", 1000))
    features = []
    offset = 0
    while True:
        q = {
            "where": where,
            "geometry": f"{REGION['west']},{REGION['south']},{REGION['east']},{REGION['north']}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": out_fields,
            "outSR": "4326",
            "f": "geojson",
            "resultOffset": str(offset),
            "resultRecordCount": str(page),
        }
        url = f"{base}/query?{urlencode(q)}"
        for attempt in range(4):
            try:
                r = requests.get(url, timeout=180)
                r.raise_for_status()
                j = r.json()
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 3:
                    raise
                print(f"  retry {attempt + 1}: {e}")
                time.sleep(2 * (attempt + 1))
        if "error" in j:
            raise SystemExit(f"  server error: {j['error']}")
        got = j.get("features", [])
        features.extend(got)
        print(f"  {meta.get('name')}: {len(features)} features")
        if len(got) < page or not j.get("properties", {}).get("exceededTransferLimit", len(got) == page):
            break
        offset += page
    return {"type": "FeatureCollection", "name": meta.get("name"), "features": features}


def main(names: list[str]):
    if JURISDICTION != "ON":
        raise SystemExit(f"{REGION['name']} is in {JURISDICTION}: LIO covers Ontario only, use the area's own vector adapter (bake_area.py)")
    if names == ["bake"]:
        names = HABITAT + DEFAULT
    for name in names:
        service, layer, where, fields = LAYERS[name]
        print(f"== {name} ({service}/{layer})")
        fc = fetch_layer(service, layer, where, fields)
        path = OUT_DIR / f"{name}-{REGION['id']}.geojson"
        path.write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
        print(f"wrote {path.name} ({path.stat().st_size / 1e6:.2f} MB, {len(fc['features'])} features)")


if __name__ == "__main__":
    main(sys.argv[1:] or DEFAULT)
