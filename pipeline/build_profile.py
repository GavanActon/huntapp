"""The area's habitat profile: what the scorer has to know about a place
that no one cell of the grid says. Where the trees give out on its ground,
which ecoregion it lies in, whether the north's slower regrowth and rut
calendar apply, and what its stand map can be trusted for. Derived from
the baked habitat grid and one point lookup, and written into the area file
(src/areas/<id>.json, field `profile`), where app/src/spots/profile.ts
reads it. An area without one scores as before: boreal Ontario's rules.

docs/research/reports/Mountain hunt habitat rules.md has the research; the
profile is the plug-in point for the location-aware rules it describes.
Climate normals (ClimateNA), BC's BEC zones, the Yukon's bioclimate zones
and live snow are the next axes; each adds a field here and a reader there.

    py -3.14 pipeline/build_profile.py --area highland-lake
"""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from datetime import date

import numpy as np

import habfile
from area import AREA, BAKE, ID, adapter, set_area_values
from common import OUT_DIR

# cover classes (build_habitat.py)
WATER, OPEN_WET, TREED_WET, CONIFER_DENSE, CONIFER_OPEN, MIXED, HARDWOOD, SHRUB, REGEN, BARREN = 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
TREED = (TREED_WET, CONIFER_DENSE, CONIFER_OPEN, MIXED, HARDWOOD)
OPEN_ABOVE = (OPEN_WET, SHRUB, BARREN)

# the treeline: the 98th percentile of the treed cells' elevations (a few
# outliers above it are krummholz and mapping noise). It is a treeline only
# where the land above it is a real share of the area and mostly open: in
# flat boreal country the top 2% of the trees are just the highest hill.
TREE_PCT = 98
MIN_ALPINE_SHARE = 0.05
MIN_OPEN_ABOVE = 0.6
MIN_TREED = 1000
MIN_FACING = 500

# CEC North American Terrestrial Ecoregions, Level III (2006, v2), by point
CEC_URL = "https://services7.arcgis.com/oF9CDB4lUYF7Um9q/ArcGIS/rest/services/NA_Terrestrial_Ecoregions_Level_3/FeatureServer/3/query"
# Level I regions whose regrowth and calendar are the north's: Tundra,
# Taiga, Northwestern Forested Mountains (the burn-browse peak at 11-30 yr,
# not 10-20; the rut's shoulders as the Alaska and Yukon studies have them)
NORTH_L1 = {"2", "3", "6"}
NORTH_LAT = 57.0
# stand maps that measure shrub height (VRI's SHRUB_HEIGHT, the
# écoforestier's), and ones whose lead species is inferred, not mapped
SHRUB_HEIGHT_MAPS = {"bc.vri", "qc.ecoforestier"}
INFERRED_LEAD = {"ca.scanfi"}


def treeline(hdr: dict, b: dict[str, np.ndarray]) -> dict | None:
    cover = b["cover"]
    elev = b["elev"].astype(np.float64)
    land = (cover != 0) & (cover != WATER)
    treed = np.isin(cover, TREED)
    if treed.sum() < MIN_TREED:
        return None
    t = float(np.percentile(elev[treed], TREE_PCT))
    above = land & (elev > t)
    alpine = above.sum() / max(1, land.sum())
    open_above = float(np.isin(cover[above], OPEN_ABOVE).mean()) if above.any() else 0.0
    print(f"  trees to {t:.0f} m ({TREE_PCT}th percentile); land above it {100 * alpine:.1f}%, {100 * open_above:.0f}% of that open")
    if alpine < MIN_ALPINE_SHARE or open_above < MIN_OPEN_ABOVE:
        print("  no treeline: forest to the tops")
        return None
    out: dict = {
        "m": int(round(t / 10) * 10),
        "alpineShare": round(float(alpine), 3),
        "from": f"the {TREE_PCT}th percentile of the treed cells' elevation in the habitat grid; {100 * alpine:.0f}% of the land is above it, {100 * open_above:.0f}% of that open",
    }
    # by the way the slope faces: the band holds the uphill bearing, the
    # facing is 180° from it (build_habitat.py); north 315-45, south 135-225
    asp = b["aspect"]
    slope = b["slope"]
    facing = (asp.astype(np.float64) * (360 / 250) + 180) % 360
    steep = (asp != 255) & (slope >= 5)
    for name, lo, hi in (("north", 315, 45), ("south", 135, 225)):
        sel = treed & steep & (((facing >= lo) | (facing < hi)) if lo > hi else ((facing >= lo) & (facing < hi)))
        if sel.sum() >= MIN_FACING:
            out[name] = int(round(float(np.percentile(elev[sel], TREE_PCT)) / 10) * 10)
    return out


def ecoregion(lon: float, lat: float) -> dict | None:
    q = urllib.parse.urlencode(
        {"geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": "4326", "spatialRel": "esriSpatialRelIntersects", "outFields": "LEVEL1,NameL1_En,LEVEL2,NameL2_En,LEVEL3,NameL3_En", "returnGeometry": "false", "f": "json"}
    )
    try:
        with urllib.request.urlopen(f"{CEC_URL}?{q}", timeout=60) as r:
            j = json.load(r)
    except Exception as e:  # offline: keep what the file has
        print(f"  ecoregion lookup failed ({e}); keeping the last one")
        return None
    feats = j.get("features") or []
    if not feats:
        return None
    a = feats[0]["attributes"]
    return {"cec1": a["LEVEL1"], "cec2": a["LEVEL2"], "cec3": a["LEVEL3"], "name": a["NameL3_En"], "family": a["NameL2_En"]}


def main() -> None:
    path = OUT_DIR / f"habitat-{ID}.hab"
    if not path.exists():
        sys.exit(f"no {path.name}: bake the habitat grid first")
    hdr, b = habfile.read_hab_raw(path, ["cover", "elev", "aspect", "slope"])
    lon, lat = (float(v) for v in AREA["centre"])
    old = AREA.get("profile") or {}
    eco = ecoregion(lon, lat) or old.get("ecoregion")
    north = lat >= NORTH_LAT or (eco is not None and eco.get("cec1") in NORTH_L1)
    forest = adapter(BAKE, "forest") or ""
    profile = {
        "checked": date.today().isoformat(),
        "treeline": treeline(hdr, b),
        "ecoregion": eco,
        "north": north,
        "stands": {"shrubHeight": forest in SHRUB_HEIGHT_MAPS, "leadSpecies": forest not in INFERRED_LEAD and forest != ""},
    }
    print(f"  {ID}: {json.dumps(profile, ensure_ascii=False)}")
    set_area_values(ID, {"profile": profile})


if __name__ == "__main__":
    main()
