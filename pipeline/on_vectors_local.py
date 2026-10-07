"""Ontario's vector themes from LIO's province-wide downloads, cut to the area.

build_vectors.py asks LIO's ArcGIS server for each theme over the area's
box. That is fine for an area now and then; for a province of SD tiles
(tiles.py) it is thousands of paged queries against a front end that drops
TLS now and then. LIO also publishes every theme as one file geodatabase
for the whole province (Packages/fgdb/<CODE>.zip on ws.gisetl.lrc.gov.on.ca,
OGL-Ontario), so those are downloaded once into pipeline/raw/stage/lio/ and
unzipped, and this reads each by the area's box through its spatial index.

The output is what build_vectors.py writes: <theme>-<area>.geojson in
OUT_DIR, the features that meet the box (not clipped), the same fields.
Roads are the passable ones only, as the server serves them. The packages
are NAD83 (EPSG:4269), the server's GeoJSON WGS84: the two differ by about
a metre here, so the coordinates are taken as they are.

    py -3.13 pipeline/on_vectors_local.py --area t-629-411 waterbody wetland roads

Needs pyogrio (py -3.13).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import area  # noqa: F401  (first: it takes --area out of argv)
from area import OUT_DIR, REGION

import numpy as np
import pyogrio.raw
import shapely

LIO_DIR = Path(__file__).resolve().parent / "raw" / "stage" / "lio"

# theme -> (package code, feature class, where, fields): the fields are
# build_vectors.py's outFields for the theme
THEMES: dict[str, tuple[str, str, str | None, list[str]]] = {
    "waterbody": ("OHNWBDY", "OHN_WATERBODY", None, ["OFFICIAL_NAME_LABEL", "WATERBODY_TYPE", "PERMANENCY"]),
    "watercourse": ("OHNWCRS", "OHN_WATERCOURSE", None, ["OFFICIAL_NAME_LABEL", "WATERCOURSE_TYPE", "PERMANENCY"]),
    "wetland": ("WETLAND", "WETLAND", None, ["WETLAND_TYPE", "DOMINANT_VEG_FORM", "DOMINANT_VEG_SPECIES", "PERCENT_OPEN_WATER"]),
    "roads": (
        "MNRRDSEG",
        "MNRF_ROAD_SEGMENT",
        "PASSABLE_IND = 'Yes'",
        ["ROAD_NAME", "STATUS", "PASSABLE_IND", "GATE_IND", "BERM_IND", "ROAD_USE", "FMP_ROAD_CLASS", "SURFACE_TYPE", "YEAR_CONSTRUCTED", "YEAR_DECOMMISSIONED", "MAINTENANCE_LEVEL"],
    ),
    "fire": ("FIREDSTB", "FIRE_DISTURBANCE_AREA", None, ["FIRE_YEAR", "FIRE_TYPE_CODE", "FIRE_FINAL_SIZE", "FIRE_START_DATE"]),
    "wmu": ("WILDADMU", "WILDLIFE_MGMT_UNIT", None, ["OFFICIAL_NAME"]),
}


def gdb(code: str) -> Path:
    """The unzipped package: raw/stage/lio/<CODE>/Non_Sensitive.gdb."""
    return LIO_DIR / code / "Non_Sensitive.gdb"


def have(theme: str) -> bool:
    return theme in THEMES and gdb(THEMES[theme][0]).exists()


def value(v):
    """A field value as the server's GeoJSON gives it: dates as epoch ms."""
    if isinstance(v, np.datetime64):
        return None if np.isnat(v) else int(v.astype("datetime64[ms]").astype(np.int64))
    if isinstance(v, np.generic):
        v = v.item()
    if isinstance(v, float):
        if v != v:  # a null double
            return None
        if v.is_integer():  # the server writes 270, not 270.0
            return int(v)
    return v


def read(theme: str) -> dict:
    code, layer, where, fields = THEMES[theme]
    box = (REGION["west"], REGION["south"], REGION["east"], REGION["north"])
    meta, _, geom, cols = pyogrio.raw.read(str(gdb(code)), layer=layer, bbox=box, where=where, columns=fields, force_2d=True)
    names = list(meta["fields"])
    shapes = shapely.from_wkb(geom)
    feats = []
    for k, g in enumerate(shapes):
        if g is None:
            continue
        props = {n: value(cols[i][k]) for i, n in enumerate(names)}
        feats.append({"type": "Feature", "properties": props, "geometry": json.loads(shapely.to_geojson(g))})
    return {"type": "FeatureCollection", "name": layer, "features": feats}


def main(names: list[str]) -> int:
    missing = [n for n in names if not have(n)]
    if missing:
        raise SystemExit(f"not staged: {', '.join(missing)} (download Packages/fgdb/<CODE>.zip into {LIO_DIR} and unzip it to <CODE>/)")
    for name in names:
        t = time.time()
        fc = read(name)
        path = OUT_DIR / f"{name}-{REGION['id']}.geojson"
        path.write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
        print(f"wrote {path.name} ({path.stat().st_size / 1e6:.2f} MB, {len(fc['features'])} features) · {time.time() - t:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:] or list(THEMES)))
