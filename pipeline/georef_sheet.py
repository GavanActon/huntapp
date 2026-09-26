"""Georeference a CanMatrix2 "print ready" NTS scan by its neatline.

The scans on ftp.maps.canada.ca carry no geotransform, but a 1:50 000 NTS
sheet's neatline is bounded by known meridians and parallels (042C13 is
86.0–85.5 W, 48.75–49.0 N). The neatline is the outermost long dark
rectangle inside the border; its four corners become ground control points
and the sheet is written out as a GeoTIFF in EPSG:4326 with an affine fit.
Good to a few tens of metres, which is what a 1970s map is anyway.

    python pipeline/georef_sheet.py raw/sheets/042c13_02.tif 042C13
    python pipeline/georef_sheet.py raw/sheets/042c14_02.tif 042C14
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.control import GroundControlPoint
from rasterio.transform import from_gcps

Image.MAX_IMAGE_PIXELS = None


def nts_50k_bounds(sheet: str) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a 1:50k NTS sheet, e.g. 042C13."""
    sheet = sheet.upper()
    series = int(sheet[:3])  # 042
    block = sheet[3]  # C
    num = int(sheet[4:6])  # 13
    # 1:1M block corners (west, south) for the Ontario belt
    table = {30: (-80, 40), 31: (-80, 44), 32: (-80, 48), 40: (-88, 40), 41: (-88, 44), 42: (-88, 48), 52: (-96, 48)}
    if series not in table:
        raise SystemExit(f"add series {series} to the table")
    blk_w, blk_s = table[series]
    # 1:250k blocks A–P: 4 columns (2° each) × 4 rows (1° each), A at SE, snake
    idx = ord(block) - ord('A')
    row = idx // 4
    # even rows (A–D, I–L) run east→west, odd rows west→east; count from the east
    col_e = idx % 4 if row % 2 == 0 else 3 - idx % 4
    w250 = blk_w + 8 - 2 * (col_e + 1)
    s250 = blk_s + row
    # 1:50k sheets 1–16 inside: 4 columns (0.5° each) × 4 rows (0.25° each), 1 at SE, snake
    i = num - 1
    r = i // 4
    c_e = i % 4 if r % 2 == 0 else 3 - i % 4
    w = w250 + 2 - 0.5 * (c_e + 1)
    s = s250 + 0.25 * r
    return (w, s, w + 0.5, s + 0.25)


def find_neatline(rgb: np.ndarray) -> tuple[int, int, int, int]:
    """(left, top, right, bottom) pixel edges of the map face.

    The face is tinted (the green of the bush, blue lakes, contour ink);
    the margins are white paper with a little black text. The face is where
    most pixels per column (row) are not white, and its outer edges are the
    neatline to within a pixel or two of skew."""
    h, w, _ = rgb.shape
    lo = rgb.min(axis=2)
    hi = rgb.max(axis=2)
    tinted = (lo < 232) | ((hi.astype(np.int16) - lo.astype(np.int16)) > 10)
    col_frac = tinted[int(h * 0.25) : int(h * 0.75), :].mean(axis=0)
    row_frac = tinted[:, int(w * 0.25) : int(w * 0.75)].mean(axis=1)
    thr = 0.5
    cols = np.where(col_frac > thr)[0]
    rows = np.where(row_frac > thr)[0]
    if len(cols) < 2 or len(rows) < 2:
        raise SystemExit(f"map face not found (cols {len(cols)}, rows {len(rows)}); lower thr")

    def longest_run(idx: np.ndarray) -> tuple[int, int]:
        breaks = np.where(np.diff(idx) > 40)[0]
        starts = np.r_[0, breaks + 1]
        ends = np.r_[breaks, len(idx) - 1]
        k = int(np.argmax(idx[ends] - idx[starts]))
        return int(idx[starts[k]]), int(idx[ends[k]])

    left, right = longest_run(cols)
    top, bottom = longest_run(rows)
    return left, top, right, bottom


def main(path: str, sheet: str):
    west, south, east, north = nts_50k_bounds(sheet)
    print(f"{sheet}: {west}..{east} W, {south}..{north} N")
    img = Image.open(path)
    rgb = np.asarray(img.convert("RGB"))
    gray = np.asarray(img.convert("L"))
    left, top, right, bottom = find_neatline(rgb)
    print(f"neatline px: left {left} top {top} right {right} bottom {bottom} of {gray.shape[1]}x{gray.shape[0]}")
    # a check image: the face box drawn on a small copy
    small = img.convert("RGB").resize((gray.shape[1] // 8, gray.shape[0] // 8))
    from PIL import ImageDraw
    ImageDraw.Draw(small).rectangle([left // 8, top // 8, right // 8, bottom // 8], outline=(255, 0, 0), width=2)
    small.save(Path(path).with_name(f"{sheet.lower()}_check.png"))
    gcps = [
        GroundControlPoint(row=top, col=left, x=west, y=north),
        GroundControlPoint(row=top, col=right, x=east, y=north),
        GroundControlPoint(row=bottom, col=right, x=east, y=south),
        GroundControlPoint(row=bottom, col=left, x=west, y=south),
    ]
    transform = from_gcps(gcps)
    out = Path(path).with_name(f"{sheet.lower()}_geo.tif")
    # crop to the neatline plus a hair, so the margins never draw on the map
    crop = rgb[top:bottom, left:right]
    with rasterio.open(
        out,
        "w",
        driver="GTiff",
        height=crop.shape[0],
        width=crop.shape[1],
        count=3,
        dtype="uint8",
        crs="EPSG:4326",
        transform=transform * rasterio.Affine.translation(left, top),
        compress="deflate",
        tiled=True,
    ) as dst:
        for b in range(3):
            dst.write(crop[..., b], b + 1)
    print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
