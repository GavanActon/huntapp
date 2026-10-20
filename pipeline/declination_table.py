"""The compass declination over Canada as a table the app can read with no network (app/src/areas/declination.ts):
WMM through pygeomag on a 2° lattice, read bilinearly by a location the app makes from a box (areas/runtime.ts),
where the pipeline's bake_area.py declination() never ran. Off by a few tenths of a degree between the knots,
which a hand compass never sees.

    py -3.14 pipeline/declination_table.py
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from pygeomag import GeoMag

LAT0, LAT1, LON0, LON1, STEP = 40, 84, -142, -52, 2
OUT = Path(__file__).resolve().parents[1] / "app" / "src" / "areas" / "declination.ts"


def main() -> None:
    today = date.today()
    year = today.year + (today.timetuple().tm_yday - 1) / 365.25
    gm = GeoMag()
    lats = list(range(LAT0, LAT1 + 1, STEP))
    lons = list(range(LON0, LON1 + 1, STEP))
    rows = [[round(float(gm.calculate(glat=la, glon=lo, alt=0, time=year).d), 1) for lo in lons] for la in lats]
    body = ",\n".join("  [" + ", ".join(f"{v:g}" for v in r) + "]" for r in rows)
    OUT.write_text(
        f"""/** The compass declination over Canada, degrees, west negative: WMM at {year:.1f} on a {STEP}° lattice
 *  (pipeline/declination_table.py), for a location the app makes itself (areas/runtime.ts). No imports. */

const LAT0 = {LAT0}
const LON0 = {LON0}
const STEP = {STEP}
// rows south to north, {LAT0}° to {LAT1}°; columns west to east, {LON0}° to {LON1}°
const D: number[][] = [
{body},
]

/** The declination at a point, bilinear between the knots, held at the table's edge. */
export function declinationAt(lon: number, lat: number): number {{
  const fy = Math.min(D.length - 1.0001, Math.max(0, (lat - LAT0) / STEP))
  const fx = Math.min(D[0].length - 1.0001, Math.max(0, (lon - LON0) / STEP))
  const y = Math.floor(fy)
  const x = Math.floor(fx)
  const ty = fy - y
  const tx = fx - x
  const v = (D[y][x] * (1 - tx) + D[y][x + 1] * tx) * (1 - ty) + (D[y + 1][x] * (1 - tx) + D[y + 1][x + 1] * tx) * ty
  return Math.round(v * 10) / 10
}}
""",
        encoding="utf-8",
    )
    print(f"{OUT}: {len(lats)}×{len(lons)} at {year:.2f}")


if __name__ == "__main__":
    main()
