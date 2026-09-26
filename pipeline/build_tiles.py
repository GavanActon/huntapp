"""Pull a live tile service into a raster PMTiles: the core at full detail,
the wider region at low zoom. This is what makes topo, imagery and the
30 m hillshade work with no signal at camp.

    python pipeline/build_tiles.py topo
    python pipeline/build_tiles.py satellite
    python pipeline/build_tiles.py hillshade-mrdem    # until the LiDAR bake

Tile fetches are cached under pipeline/raw/tiles/<key>/ so a rerun costs
nothing. Be polite: one request at a time, a short pause between.
"""

from __future__ import annotations

import io
import sys
import time
from urllib.parse import urlencode

import numpy as np
import requests
from PIL import Image

from common import CACHE_DIR, CORE, OUT_DIR, REGION, REGION_MAXZOOM, tile_bounds_3857, write_raster_pmtiles

UA = {"User-Agent": "huntapp-pipeline/0.1 (offline camp maps)"}


def wms(base: str, layers: str, fmt: str = "image/png") -> str:
    q = urlencode(
        {
            "SERVICE": "WMS",
            "VERSION": "1.3.0",
            "REQUEST": "GetMap",
            "LAYERS": layers,
            "STYLES": "",
            "FORMAT": fmt,
            "TRANSPARENT": "true",
            "WIDTH": "256",
            "HEIGHT": "256",
            "CRS": "EPSG:3857",
        }
    )
    return f"{base}?{q}&BBOX={{bbox}}"


SERVICES: dict[str, dict] = {
    # hypsography only (contours + spot heights, transparent ground): the
    # full CanTopo render buried the hillshade under its land colours
    "topo": {
        "url": wms("https://maps.geogratis.gc.ca/wms/toporama_en", "hypsography"),
        "attribution": "Toporama © Natural Resources Canada",
        "fmt": "PNG",
        "minz": 8,
        "cache": "topo-hypsography",
    },
    "satellite": {
        "url": "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_Imagery/Ontario_Imagery_Web_Map_Service/MapServer/tile/{z}/{y}/{x}",
        "attribution": "Imagery © Ontario Ministry of Natural Resources",
        "fmt": "JPEG",
        "minz": 9,
    },
    "hillshade-mrdem": {
        "url": wms("https://datacube.services.geo.ca/ows/mrdem", "dtm-hillshade"),
        "attribution": "MRDEM © Natural Resources Canada",
        "fmt": "PNG",
        "minz": 8,
        "out": "hillshade",
    },
}


def in_core(z: int, x: int, y: int) -> bool:
    from common import lat_to_tile, lon_to_tile

    return (
        lon_to_tile(CORE["west"], z) <= x <= lon_to_tile(CORE["east"] - 1e-9, z)
        and lat_to_tile(CORE["north"], z) <= y <= lat_to_tile(CORE["south"] + 1e-9, z)
    )


def main(key: str):
    svc = SERVICES[key]
    out_key = svc.get("out", key)
    cache = CACHE_DIR / "tiles" / svc.get("cache", key)
    cache.mkdir(parents=True, exist_ok=True)
    sess = requests.Session()
    sess.headers.update(UA)

    def fetch(z, x, y) -> bytes | None:
        f = cache / f"{z}_{x}_{y}"
        if f.exists():
            return f.read_bytes() or None
        if "{bbox}" in svc["url"]:
            b = tile_bounds_3857(z, x, y)
            url = svc["url"].replace("{bbox}", f"{b[0]},{b[1]},{b[2]},{b[3]}")
        else:
            url = svc["url"].format(z=z, x=x, y=y)
        for attempt in range(4):
            try:
                r = sess.get(url, timeout=60)
                if r.status_code == 404:
                    f.write_bytes(b"")
                    return None
                r.raise_for_status()
                f.write_bytes(r.content)
                time.sleep(0.15)
                return r.content
            except Exception as e:  # noqa: BLE001
                print(f"  {z}/{x}/{y} retry {attempt + 1}: {e}")
                time.sleep(2 * (attempt + 1))
        return None

    def render(z, x, y):
        # the wider region only to REGION_MAXZOOM; the core to its maxzoom
        if z > REGION_MAXZOOM and not in_core(z, x, y):
            return None
        raw = fetch(z, x, y)
        if not raw:
            return None
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
        a = np.asarray(img)
        if a[..., 3].max() == 0:
            return None
        return a

    write_raster_pmtiles(
        OUT_DIR / f"{out_key}-{REGION['id']}.pmtiles",
        f"{out_key}-{REGION['id']}",
        svc["attribution"],
        svc["minz"],
        CORE["maxzoom"],
        render,
        fmt=svc["fmt"],
    )


if __name__ == "__main__":
    for k in sys.argv[1:] or ["topo"]:
        print(f"== {k}")
        main(k)
