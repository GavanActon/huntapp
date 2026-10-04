"""Historical topo for the area: NRCan's CanMatrix2 scans of its 1:50 000
NTS sheets (bake.nts in the area file), fetched, georeferenced by their
neatlines (georef_sheet.py) and baked into historical-<id>.pmtiles
(build_raster.py), z9-15.

The scans come as zips at a fixed address per sheet. The zips, the scans
and the georeferenced sheets are kept in pipeline/raw/sheets/, so a rerun
only rebakes the tiles. A sheet already georeferenced is used as it is, as
the README's hand-run steps left Pickle Lake's.

    py -3.14 pipeline/build_historical.py --area lac-bailey
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import build_raster
import georef_sheet
from area import BAKE, ID, note_source
from common import CACHE_DIR, REGION
from fetch_resume import download

CANMATRIX = "https://ftp.maps.canada.ca/pub/nrcan_rncan/raster/canmatrix2/50k_tif"
SHEETS_DIR = CACHE_DIR / "sheets"


def scan(sheet: str) -> Path:
    """The sheet's scan (e.g. 022f05_03.tif), fetched and unzipped if not here."""
    s = sheet.lower()
    have = sorted(p for p in SHEETS_DIR.glob(f"{s}_*.tif") if not p.stem.endswith("_geo"))
    if have:
        return have[-1]
    zpath = SHEETS_DIR / f"canmatrix2_{s}_tif.zip"
    if not zpath.exists():
        url = f"{CANMATRIX}/{s[:3]}/{s[3]}/{zpath.name}"
        print(f"fetching {url}")
        download(url, zpath)
    with zipfile.ZipFile(zpath) as z:
        tifs = [m for m in z.infolist() if m.filename.lower().endswith(".tif")]
        if not tifs:
            raise SystemExit(f"{zpath.name} has no scan in it")
        best = max(tifs, key=lambda m: m.file_size)
        z.extract(best, SHEETS_DIR)
    return SHEETS_DIR / best.filename


def main() -> None:
    sheets = [s.upper() for s in BAKE.get("nts") or []]
    if not sheets:
        raise SystemExit(f"{REGION['name']} lists no NTS sheets (bake.nts)")
    SHEETS_DIR.mkdir(parents=True, exist_ok=True)
    geo = []
    for sheet in sheets:
        g = SHEETS_DIR / f"{sheet.lower()}_geo.tif"
        if not g.exists():
            georef_sheet.main(str(scan(sheet)), sheet)
        geo.append(str(g))
    build_raster.main(["historical", *geo, "--minz", "9", "--maxz", "15", "--attribution", "© Natural Resources Canada"])
    note_source(f"historical-{ID}.pmtiles", source=f"CanMatrix2 1:50 000 NTS scans, NRCan: {', '.join(sheets)}", licence="OGL-Canada")


if __name__ == "__main__":
    main()
