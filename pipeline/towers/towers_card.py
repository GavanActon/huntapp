"""The towers card for the nightly loop (docs/SCENT-TESTSET.md): forest over open at head height at
the forest/open pairs (pairs.py), as one small JSON, the way app/scripts/checks_card.py gives the
checks.

    py -3.14 pipeline/towers/towers_card.py [--out card.json]

Per pair: the median of ws_forest / ws_open over intervals with the open wind at --min-open m/s or
more (a vane that moves; below it the forest gauge mostly reads its stall), n, and the same by hour
band (night, dawn/dusk, day by sun elevation) and by fall month. app_ratio is the app's own forest
over open at the same two points, which needs the app run there (an SD bake round each pair and the
ground wind at the gauges, as palm_compare does for PALM's boxes): null, with app_note saying so,
until that is built. The gauges' caveats travel with each pair (stalls, sheltered clearings, an
open gauge at 7 m).
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
PAIRS = HERE.parent / "raw" / "towers" / "pairs"
NOTES = {
    "MARCELL-S2-BOG": "forest S2 under aspen-birch-fir vs Bog Lake open fen, both 3 m; the cleanest open reference. R.M. Young 05103 vanes stall near 1 m/s: S2 under 1 m/s 98% of Sep-Nov, so only windy hours speak.",
    "MARCELL-S2-NADP": "S2 vs the NADP clearing, both 3 m; the clearing is sheltered itself (open wind 1.5+ m/s only 2% of intervals).",
    "MARMOT-UPPERFOREST-UPPERCLEARING": "spruce-fir forest 2.77 m vs a wind-sheltered clearing 2.85 m (Fang et al. 2019).",
    "MARMOT-LEVELFOREST-HAYMEADOW": "lodgepole forest 2.45 m (sonic, ~0.25 m/s floor) vs Hay Meadow open at 7 m (a log profile puts head-height ratios ~1.2x these).",
}


def sun_band(t: pd.Series, lat: float, lon: float) -> pd.Series:
    """night below -6 deg, dawn/dusk -6 to 10, day above (NOAA low-accuracy sun)."""
    tt = pd.to_datetime(t, utc=True) + pd.to_timedelta(7.5, unit="min")
    doy = tt.dt.dayofyear.to_numpy()
    hr = (tt.dt.hour + tt.dt.minute / 60).to_numpy()
    g = 2 * math.pi / 365 * (doy - 1 + (hr - 12) / 24)
    decl = 0.006918 - 0.399912 * np.cos(g) + 0.070257 * np.sin(g) - 0.006758 * np.cos(2 * g) + 0.000907 * np.sin(2 * g)
    eqt = 229.18 * (0.000075 + 0.001868 * np.cos(g) - 0.032077 * np.sin(g) - 0.014615 * np.cos(2 * g) - 0.040849 * np.sin(2 * g))
    ha = np.radians(((hr * 60 + eqt + 4 * lon) / 4) - 180)
    la = np.radians(lat)
    el = np.degrees(np.arcsin(np.sin(la) * np.sin(decl) + np.cos(la) * np.cos(decl) * np.cos(ha)))
    return pd.Series(np.where(el < -6, "night", np.where(el < 10, "dawn/dusk", "day")), index=t.index)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--min-open", type=float, default=1.5, help="the open wind, m/s, over which an interval counts")
    ap.add_argument("--out")
    args = ap.parse_args()
    card = {"minOpen": args.min_open, "pairs": []}
    for f in sorted(PAIRS.glob("*.csv.gz")):
        d = pd.read_csv(f)
        name = f.name.removesuffix(".csv.gz")
        d = d[(d.ws_open >= args.min_open) & d.ws_forest.notna()]
        if d.empty:
            continue
        r = d.ws_forest / d.ws_open
        band = sun_band(d.t_utc, float(d.lat.iloc[0]), float(d.lon.iloc[0]))
        month = pd.to_datetime(d.t_utc, utc=True).dt.month
        card["pairs"].append({
            "pair": name,
            "openKind": str(d.open_kind.iloc[0]),
            "zForest": float(d.z_forest.median()), "zOpen": float(d.z_open.median()),
            "ratio": round(float(r.median()), 3),
            "n": int(len(r)),
            "years": f"{pd.to_datetime(d.t_utc).dt.year.min()}-{pd.to_datetime(d.t_utc).dt.year.max()}",
            "byBand": {b: {"ratio": round(float(r[band == b].median()), 3), "n": int((band == b).sum())} for b in ("night", "dawn/dusk", "day") if (band == b).any()},
            "byMonth": {str(m): {"ratio": round(float(r[month == m].median()), 3), "n": int((month == m).sum())} for m in (9, 10, 11) if (month == m).any()},
            "app_ratio": None,
            "app_note": "pending: the app run at the two gauges (SD bake round the pair + groundWind at each point)",
            "note": NOTES.get(name, ""),
        })
    text = json.dumps(card, indent=1)
    print(text)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
