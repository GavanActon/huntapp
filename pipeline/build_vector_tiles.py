"""Bake the baked GeoJSON themes into vector PMTiles, so the map reads
tiles for the view instead of fetching, parsing and indexing whole files
at start-up (the forest stands alone are 5 MB of GeoJSON, which held the
map's load back by seconds on the phone, 2026-10-01).

  forest-<region>.pmtiles   layer `forest`   from forest-<region>.geojson (the
                            area's forest adapter: build_forest.py in Ontario)
                            and `forest_label`, a point per patch of one
                            wood type, in from the zoom its name fits at
  places-<region>.pmtiles   layers wmu, camps, crown, parks, fire, roads
                            from <theme>-<region>.geojson (the area's vector
                            adapter: build_vectors.py in Ontario), less any
                            theme the province's licence keeps out (WITHHELD)

The app's style (mapStyle.ts) already prefers these archives when they
exist (DATA_FILES keys `forest` and `places`, one source-layer per theme)
and keeps the GeoJSON as the fallback. Geometry is simplified per zoom
at half a pixel, clipped to each tile with a buffer, and the property
values are kept as they are (nulls dropped: MVT has no null).

    py -3.14 pipeline/build_vector_tiles.py [forest] [places]
"""

from __future__ import annotations

import gzip
import json
import math
import re
import sys
import time
from collections import defaultdict
from datetime import date

import mapbox_vector_tile
import numpy as np
import shapely
from mapbox_vector_tile.encoder import on_invalid_geometry_make_valid
from rasterio.warp import transform_geom

from area import AREA, BAKE, JURISDICTION, options
from common import OUT_DIR, REGION, region_tiles, tile_bounds_3857
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

MINZOOM = 7  # the map's own minimum zoom
MAXZOOM = 14  # overzoomed above: 0.4 m per MVT unit at z14 here, plenty for z18
EXTENT = 4096
TILE_BUFFER_PX = 64

ARCHIVES: dict[str, list[str]] = {
    "forest": ["forest"],
    "places": ["wmu", "camps", "crown", "parks", "fire", "roads"],
}
# by the province whose adapters made the themes
ATTRIBUTION = {
    "ON": {"forest": "FRI © Ontario Ministry of Natural Resources", "places": "© Ontario MNRF"},
    "QC": {"forest": "Carte écoforestière © Gouvernement du Québec", "places": "© Gouvernement du Québec"},
    "BC": {"forest": "VRI © Province of British Columbia", "places": "© Province of British Columbia"},
}
# Themes a province's archives never carry: only open data goes in a pack,
# and Quebec's hunting zones state no licence (qc_vectors.wmu). Not read
# even if a copy is lying in the area's folder. The archive still names the
# layer, empty, as it names camps and crown where there are none.
WITHHELD = {"QC": {"wmu"}}

# The wood type in words. Zoomed out a stand is a few pixels across and
# the fill's colours alone did not say what grows there, the words only
# came in at z15 (Gavan, 2026-10-04, Scout view). Each stand gets a name,
# the stands of one colour (cover group) are run together into patches,
# and each patch gets label points in its widest parts, written into the
# tiles from the zoom the name fits there: the map names a big spruce flat
# at z11 and a small aspen patch at z14, and never a stand too small to
# hold the word. A label says what most of the ground under it is (aspen
# where aspen leads), else the group's word (hardwood, an aspen and birch
# patch). The lead species (the stand's first code) names conifer and
# hardwood stands, as the heat's reasons do; Quebec's codes are mapped
# onto Ontario's by qc_forest.py.
#
# The colour and the name go by `cover`, the stand's group except on an
# old cut or burn: one OLD_DISTURBANCE_YEARS on is drawn and named as the
# trees grown back on it, as the habitat bake classes it. At Lac Bailey
# nearly every stand is the 1991 burn, and the map was one burn colour
# with the species only in the z15 codes. A younger one stays a cut or a
# burn (the browse); the year stays in the close-in code either way.
OLD_DISTURBANCE_YEARS = 20
CONIFER_NAMES = {
    "Sb": "Black spruce", "Sw": "White spruce", "Sx": "Spruce", "Bf": "Balsam fir",
    "Pj": "Jack pine", "Pw": "White pine", "Pr": "Red pine", "Px": "Pine",
    "Cw": "Cedar", "Ce": "Cedar", "La": "Tamarack", "He": "Hemlock",
    "Pl": "Lodgepole pine", "Fd": "Douglas-fir", "Py": "Ponderosa pine",
}
HARDWOOD_NAMES = {
    "Pt": "Aspen", "Po": "Poplar", "Pb": "Balsam poplar", "Bw": "Birch", "By": "Yellow birch",
    "Hi": "Aspen, birch", "Mr": "Red maple", "Mh": "Sugar maple",
}
GROUP_NAMES = {"conifer": "Conifer", "hardwood": "Hardwood", "mixed": "Mixed", "wetland": "Wetland", "brush": "Brush", "cut": "Cut", "burn": "Burn"}
LABEL_PX_PER_CHAR = 6.8  # the style's 12 px text
LABEL_MIN_PX = 16  # about the text's height and a bit
LABEL_FIT = 0.4  # the widest circle in the patch against the name's width
LABEL_LEAD = 0.6  # the share of the ground under a label one name needs to give it
LABELS_PER_PATCH = 40
SEAM_M = 3  # closes the slivers between neighbouring stands when they are run together


def attribution(name: str) -> str:
    # an area whose stands are not the province's (ca_forest.py's inferred ones) names its own
    own = options(BAKE, "forest").get("attribution") if name == "forest" else None
    return own or ATTRIBUTION.get(JURISDICTION, {}).get(name) or AREA.get("attribution", {}).get("vectors", "")


def load_theme(theme: str) -> tuple[list[shapely.Geometry], list[dict]]:
    """A theme's features in EPSG:3857, with their properties (nulls dropped)."""
    path = OUT_DIR / f"{theme}-{REGION['id']}.geojson"
    if not path.exists():
        print(f"  {theme}: no {path.name}, skipped")
        return [], []
    fc = json.loads(path.read_text(encoding="utf-8"))
    geoms: list[shapely.Geometry] = []
    props: list[dict] = []
    for f in fc.get("features", []):
        g = f.get("geometry")
        if not g:
            continue
        try:
            m = shapely.from_geojson(json.dumps(transform_geom("EPSG:4326", "EPSG:3857", g)))
        except Exception as e:  # a ring the projection cannot take
            print(f"  {theme}: a feature skipped · {e}")
            continue
        if m is None or m.is_empty:
            continue
        if not m.is_valid:
            m = shapely.make_valid(m)
        geoms.append(m)
        props.append({k: v for k, v in (f.get("properties") or {}).items() if v is not None})
    print(f"  {theme}: {len(geoms)} features")
    return geoms, props


def stand_cover(p: dict) -> str | None:
    """The group the map draws a stand as: an old cut or burn with a
    composition as its trees, by the habitat bake's conifer shares."""
    group = p.get("group")
    year = p.get("dep") or p.get("year")
    conif, hard = p.get("conif") or 0, p.get("hard") or 0
    if group in ("cut", "burn") and year and date.today().year - year >= OLD_DISTURBANCE_YEARS and conif + hard > 0:
        return "conifer" if conif >= 70 else "hardwood" if conif <= 30 else "mixed"
    return group


def stand_name(p: dict) -> str | None:
    """A stand's wood type in a word or two; none for water and the rest."""
    group = p.get("cover")
    if group in ("cut", "burn"):
        year = p.get("dep") or p.get("year")
        return f"{group.capitalize()} {year}" if year else group.capitalize()
    m = re.match(r"[A-Z][a-z]?", p.get("species") or "")
    lead = m.group(0) if m else ""
    if group == "conifer":
        return CONIFER_NAMES.get(lead, "Conifer")
    if group == "hardwood":
        return HARDWOOD_NAMES.get(lead, "Hardwood")
    return GROUP_NAMES.get(group)


def forest_labels(geoms: list[shapely.Geometry], props: list[dict]) -> tuple[list[shapely.Geometry], list[dict]]:
    """Names the stands (a `cover` and a `name` on each, for the fill and
    the close-in label) and returns the patch label points, each with the
    zoom it comes in at."""
    by_group: dict[str, list[int]] = defaultdict(list)
    for i, p in enumerate(props):
        if cover := stand_cover(p):
            p["cover"] = cover
        name = stand_name(p)
        if name:
            p["name"] = name
            by_group[p["cover"]].append(i)
    z0_px_m = 2 * math.pi * 6378137.0 / 256

    def r_fit(name: str) -> float:
        """The circle a name needs at z0, in 3857 m: halve once a zoom."""
        return max(LABEL_MIN_PX, LABEL_FIT * len(name) * LABEL_PX_PER_CHAR) * z0_px_m / 2

    # nothing narrower than the shortest name's circle at the deepest baked zoom
    r_floor = LABEL_MIN_PX * z0_px_m / 2 / 2**MAXZOOM
    points: list[shapely.Geometry] = []
    out: list[dict] = []
    for cover, ids in by_group.items():
        gs = np.array([geoms[i] for i in ids], dtype=object)
        names = [props[i]["name"] for i in ids]
        tree = shapely.STRtree(gs)
        patch = shapely.buffer(shapely.union_all(shapely.buffer(gs, SEAM_M)), -SEAM_M)
        for part in shapely.get_parts(patch):
            # the widest spot first, then the next widest clear of it, so a
            # big patch is named more than once as it grows on the screen
            for _ in range(LABELS_PER_PATCH):
                if part.is_empty:
                    break
                mic = shapely.maximum_inscribed_circle(part, tolerance=5)
                r = mic.length
                if r < r_floor:
                    break
                c = shapely.get_point(mic, 0)
                disc = c.buffer(r)
                part = part.difference(c.buffer(2 * r))
                near = tree.query(disc)
                share: dict[str, float] = defaultdict(float)
                for j, a in zip(near, shapely.area(shapely.intersection(disc, gs[near]))):
                    share[names[j]] += a
                total = sum(share.values()) or 1
                lead, a = max(share.items(), key=lambda kv: kv[1], default=(GROUP_NAMES[cover], 0))
                name = lead if a / total >= LABEL_LEAD else GROUP_NAMES[cover]
                minz = max(MINZOOM, math.ceil(math.log2(r_fit(name) / r)))
                if minz > MAXZOOM:
                    continue
                points.append(c)
                out.append({"name": name, "cover": cover, "r": round(r), "minz": minz})
    by_z = defaultdict(int)
    for p in out:
        by_z[p["minz"]] += 1
    print(f"  forest_label: {len(out)} points, in from " + ", ".join(f"z{z}: {n}" for z, n in sorted(by_z.items())))
    return points, out


def write_archive(name: str, themes: list[str]) -> None:
    out = OUT_DIR / f"{name}-{REGION['id']}.pmtiles"
    withheld = WITHHELD.get(JURISDICTION, set())
    for t in sorted(withheld & set(themes)):
        print(f"  {t}: not openly licensed here, left out")
    loaded = {t: load_theme(t) for t in themes if t not in withheld}
    loaded = {t: v for t, v in loaded.items() if v[0]}
    if not loaded:
        print(f"{name}: nothing to bake")
        return
    if "forest" in loaded:
        loaded["forest_label"] = forest_labels(*loaded["forest"])
    trees = {t: shapely.STRtree(g) for t, (g, _) in loaded.items()}
    count, total = 0, 0
    t0 = time.time()
    with open(out, "wb") as f:
        writer = Writer(f)
        for z in range(MINZOOM, MAXZOOM + 1):
            px_m = 2 * math.pi * 6378137.0 / (2**z * 256)
            tol = px_m * 0.5
            simplified = {t: [shapely.simplify(g, tol, preserve_topology=True) for g in geoms] for t, (geoms, _) in loaded.items()}
            for _, x, y in region_tiles(z):
                minx, miny, maxx, maxy = tile_bounds_3857(z, x, y)
                buf = (maxx - minx) * TILE_BUFFER_PX / EXTENT
                layers = []
                for t, (geoms, props) in loaded.items():
                    idx = trees[t].query(shapely.box(minx - buf, miny - buf, maxx + buf, maxy + buf))
                    feats = []
                    for i in idx:
                        # a label point waits for the zoom its name fits at
                        if props[i].get("minz", MINZOOM) > z:
                            continue
                        g = shapely.clip_by_rect(simplified[t][i], minx - buf, miny - buf, maxx + buf, maxy + buf)
                        if g.is_empty:
                            continue
                        # a sliver under a pixel across at this zoom is noise
                        if g.geom_type in ("Polygon", "MultiPolygon") and g.area < px_m * px_m:
                            continue
                        feats.append({"geometry": g, "properties": props[i]})
                    if feats:
                        layers.append({"name": t, "features": feats})
                if not layers:
                    continue
                pbf = mapbox_vector_tile.encode(
                    layers,
                    default_options={
                        "quantize_bounds": (minx, miny, maxx, maxy),
                        "extents": EXTENT,
                        "on_invalid_geometry": on_invalid_geometry_make_valid,
                    },
                )
                data = gzip.compress(pbf, 6)
                writer.write_tile(zxy_to_tileid(z, x, y), data)
                count += 1
                total += len(data)
            print(f"  z{z}: {count} tiles, {total / 1e6:.1f} MB so far")
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_lon_e7": int(REGION["west"] * 1e7),
                "min_lat_e7": int(REGION["south"] * 1e7),
                "max_lon_e7": int(REGION["east"] * 1e7),
                "max_lat_e7": int(REGION["north"] * 1e7),
                "min_zoom": MINZOOM,
                "max_zoom": MAXZOOM,
                "center_zoom": 11,
                "center_lon_e7": int((REGION["west"] + REGION["east"]) / 2 * 1e7),
                "center_lat_e7": int((REGION["south"] + REGION["north"]) / 2 * 1e7),
            },
            {
                "name": out.stem,
                "attribution": attribution(name),
                # every theme asked for, even one with nothing in it (crown
                # land here): the style names them all as source-layers,
                # and MapLibre reports a layer the metadata does not list
                "vector_layers": [{"id": t, "minzoom": MINZOOM, "maxzoom": MAXZOOM, "fields": {}} for t in [*themes, *(["forest_label"] if "forest" in themes else [])]],
            },
        )
    print(f"wrote {out.name} ({out.stat().st_size / 1e6:.1f} MB, {count} tiles, {time.time() - t0:.0f} s)")


def main(names: list[str]) -> None:
    for name in names or list(ARCHIVES):
        if name not in ARCHIVES:
            raise SystemExit(f"unknown archive {name}; one of {', '.join(ARCHIVES)}")
        print(f"{name}:")
        write_archive(name, ARCHIVES[name])


if __name__ == "__main__":
    main(sys.argv[1:])
