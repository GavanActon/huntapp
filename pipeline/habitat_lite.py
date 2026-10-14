"""The habitat bands the ground wind needs, from national rasters alone, in
seconds -> pipeline/raw/habitat-lite-<id>.hab (docs/SD-FAST.md step 2,
docs/REQUESTS.md: the sd-wind job).

build_microclimate reads the habitat grid's cover, height, crown, conifer,
hardwood and lead bands and its lakes, and nothing of the bush model, the
distance bands or the vectors. The full habitat step needs the province's
vectors and stands first, and the bush model's satellite fetches: minutes.
Here the same bands come pixel by pixel, with no polygons:

  NRCan land cover 2020, 30 m     cover classes, the water and its lakes
  SCANFI v2 + CanLaD v1.1, 30 m   stand height, crown closure, conifer share,
                                  lead species, the cuts and burns
                                  (ca_forest.read_all: windows, cached per area)

What it leaves out, the full pass (sd-full) brings, and micro is baked again
on it in seconds: roads (the road class), the wetland vectors (treed
wetland), the provinces' inventories, the fetch over water (micro then takes
a lake's full speed-up from its shore).

    py -3.14 pipeline/habitat_lite.py --area <id>
"""

from __future__ import annotations

import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_habitat as hb  # noqa: E402  (area.py takes --area off the command line)
import ca_forest  # noqa: E402
from common import CACHE_DIR, REGION  # noqa: E402
from habfile import write_hab  # noqa: E402
from rasterio.warp import Resampling  # noqa: E402

YEAR = date.today().year
# SCANFI's species, in ca_forest.SPECIES order, as build_habitat's lead codes
# (1 Sb 2 Pj 3 Sw 4 Bf 5 Cw 6 La 7 Pt 8 Bw): broadleaf reads as aspen, as the
# FRI's Po does; the pines and firs it has no code for are 0
LEAD_OF = {"Sb": 1, "Pj": 2, "Bf": 4, "La": 6, "Hx": 7}


def path() -> Path:
    return CACHE_DIR / f"habitat-lite-{REGION['id']}.hab"


def on_lattice(a: np.ndarray, tr, crs: str, resampling: Resampling, dtype) -> np.ndarray:
    return hb.to_grid({"data": a, "transform": np.array(tuple(tr)[:6]), "crs": crs, "nodata": -1}, resampling, dtype)


def main() -> int:
    t0 = time.time()
    print(f"habitat (lite) on the lattice {hb.COLS}×{hb.ROWS} ({hb.DX_M:.0f}×{hb.DY_M:.0f} m) over {REGION['name']}")
    lc = hb.to_grid(hb.fetch("landcover"), Resampling.nearest, np.uint8)
    a, tr, crs = ca_forest.read_all()
    _, sp, conif, _ = ca_forest.classify(a)
    codes = list(ca_forest.SPECIES.values())
    lead_px = np.zeros(sp.shape[1:], np.int16)
    total = sp.sum(0)
    top = sp.argmax(0)
    for i, c in enumerate(codes):
        if c in LEAD_OF:
            lead_px[(top == i) & (total > 0)] = LEAD_OF[c]
    print(f"  rasters read · {time.time() - t0:.0f}s")

    # SCANFI's own land cover says where the trees are: its groups make a pixel cut or
    # burned since 1985 a 'cut' or 'burn' and drop it from the stands, which would leave
    # a 35-year-old regrowth with no height. A cut or burn counts only while young (REGEN).
    lc_s = a["nfiLandcover"]
    treed_px = np.isin(lc_s, ca_forest.LC_TREED).astype(np.int16)
    kind_by_class = np.select([lc_s == 6, lc_s == 5], [85, 10], 50).astype(np.int16)
    conif_px = np.where(total > 0, conif, kind_by_class).astype(np.int16)
    event = (a["dist_year"] > 0) & np.isin(a["dist_type"], ca_forest.CANLAD_FIRE + ca_forest.CANLAD_HARVEST)
    event_year = np.where(event, a["dist_year"], 0).astype(np.int16)

    near, lin = Resampling.nearest, Resampling.bilinear
    is_for = on_lattice(treed_px, tr, crs, near, np.int16) == 1
    s_water = on_lattice((lc_s == ca_forest.LC_WATER).astype(np.int16), tr, crs, near, np.int16) == 1
    s_brush = on_lattice((lc_s == ca_forest.LC_SHRUB).astype(np.int16), tr, crs, near, np.int16) == 1
    lead = on_lattice(lead_px, tr, crs, near, np.int16)
    con = on_lattice(conif_px, tr, crs, near, np.int16)
    ht = on_lattice(a["height"], tr, crs, lin, np.float32)
    cc = on_lattice(a["closure"], tr, crs, lin, np.float32)
    dyear = on_lattice(event_year, tr, crs, near, np.int16)

    f_ht = np.where(is_for & (ht > 0), ht, 0).round().clip(0, 255).astype(np.uint8)
    f_cc = np.where(is_for & (cc > 0), cc, 0).round().clip(0, 100).astype(np.uint8)
    f_conif = np.where(is_for, con, 0).clip(0, 100).astype(np.uint8)
    f_hard = np.where(is_for, 100 - f_conif, 0).astype(np.uint8)
    f_lead = np.where(is_for, lead, 0).astype(np.uint8)
    dist_age = np.where(dyear > 0, YEAR - dyear.astype(int), 255).clip(0, 255)

    # the cover classes as build_habitat names them, with SCANFI's pixels in the stands' place
    cover = np.zeros((hb.ROWS, hb.COLS), np.uint8)
    cover[is_for & (f_conif >= 70) & (f_cc < 60)] = hb.CONIFER_OPEN
    cover[is_for & (f_conif >= 70) & (f_cc >= 60)] = hb.CONIFER_DENSE
    cover[is_for & (f_conif < 70) & (f_conif > 30)] = hb.MIXED
    cover[is_for & (f_conif <= 30)] = hb.HARDWOOD
    cover[~is_for & np.isin(lc, (1, 2))] = hb.CONIFER_DENSE  # no stand: the land cover only
    cover[~is_for & (lc == 6)] = hb.MIXED
    cover[~is_for & (lc == 5)] = hb.HARDWOOD
    cover[(cover == 0) & (s_brush | np.isin(lc, hb.LC_SHRUB))] = hb.SHRUB
    cover[(cover == 0) & (lc == hb.LC_WETLAND)] = hb.OPEN_WET
    cover[(cover == 0) & np.isin(lc, hb.LC_BARREN)] = hb.BARREN
    cover[(cover == 0) & (lc == hb.LC_GRASS)] = hb.SHRUB
    cover[dist_age <= 5] = hb.REGEN
    water = (lc == hb.LC_WATER) | s_water
    cover[water] = hb.WATER

    # the lakes: each body of water, with its area (micro reads those of 20 ha or more)
    lake_id, n = ndimage.label(water, structure=np.ones((3, 3)))
    cell_ha = hb.DX_M * hb.DY_M / 1e4
    sizes = np.bincount(lake_id.ravel(), minlength=n + 1)
    lakes = [{"id": i, "areaHa": round(float(sizes[i] * cell_ha), 1)} for i in range(1, n + 1)]
    lake_id = lake_id.clip(0, 65535).astype(np.uint16)

    bands = [
        ("cover", cover, 1, "cover class, see coverNames (lite: land cover 2020 + SCANFI pixels, no roads or wetland vectors)"),
        ("height", f_ht, 1, "stand height m (SCANFI v2)"),
        ("crown", f_cc, 1, "crown closure % (SCANFI v2)"),
        ("conifer", f_conif, 1, "conifer % of composition (SCANFI v2)"),
        ("hardwood", f_hard, 1, "hardwood % of composition (SCANFI v2)"),
        ("lead", f_lead, 1, "leading species: 1 Sb 2 Pj 3 Sw 4 Bf 5 Cw 6 La 7 Pt 8 Bw (SCANFI v2: broadleaf as 7)"),
        ("lakeId", lake_id, 1, "lake index into lakes[] (0 land)"),
    ]
    header = {
        "region": REGION["id"],
        "generated": date.today().isoformat(),
        "lite": True,
        "cols": hb.COLS,
        "rows": hb.ROWS,
        "west": hb.W,
        "north": hb.N,
        "dLon": hb.D_LON,
        "dLat": hb.D_LAT,
        "cellM": [round(hb.DX_M, 1), round(hb.DY_M, 1)],
        "coverNames": hb.COVER_NAMES,
        "landformNames": hb.LANDFORM_NAMES,
        "lakes": lakes,
        "bands": [],
    }
    out = path()
    w = write_hab(out, header, bands)
    shares = {hb.COVER_NAMES[i]: round(float((cover == i).mean()), 3) for i in range(len(hb.COVER_NAMES)) if (cover == i).any()}
    print(f"  cover {shares}")
    print(f"  {sum(1 for l in lakes if l['areaHa'] >= 20)} lakes of 20 ha or more, of {len(lakes)} waters")
    print(f"wrote {out.name}: {w['size'] / 1e6:.2f} MB, {w['bands']} bands · {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
