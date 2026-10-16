"""The towers' floor against a forecast's 10 m wind, the reference the app multiplies (the f_top caveat
in why_floor.md): the floor/top rule was fitted on the wind just above the canopy (1.0-1.7 h), but the
app takes its share of the local 10 m wind, and PALM's head height is scored on its 10 m ambient.

    py -3.14 pipeline/towers/ref_wind.py            # fetch what is missing, then score
    py -3.14 pipeline/towers/ref_wind.py --json card.json

For every forest tower in why_floor.py's rows: ERA5's 10 m wind (Open-Meteo archive, 0.25 deg, every
fall the tower has) and HRDPS's (gem_hrdps_continental, Open-Meteo historical forecast, falls 2023 on,
where its domain reaches), hourly, cached in raw/towers/ref/. Each half-hour of the tower is matched
to the nearest hour. With the 10 m wind at --min-u m/s or more:
- top/U10 per tower: how far the wind over the canopy runs above the forecast's 10 m;
- floor/U10 measured, against the app's share as it is (in_stand x 1.5 x (1 - 0.3 s)) and the towers'
  rule (model.ts towerShare: 0.21 e^(1.34 (1 - C)) (1 + 0.31 D off), x (1 - 0.3 s)), both as shares of
  U10; within 2x as the mean over towers, median app/measured.
Written to raw/towers/ref/ref_wind.md and printed.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import why_floor as W  # noqa: E402

REF = HERE.parent / "raw" / "towers" / "ref"
SOURCES = {
    "era5": ("https://archive-api.open-meteo.com/v1/archive", "era5", 2017),
    "hrdps": ("https://historical-forecast-api.open-meteo.com/v1/forecast", "gem_hrdps_continental", 2023),
}


def fetch(src: str, lat: float, lon: float, year: int) -> pd.DataFrame | None:
    """One fall (Sep-Nov) of hourly 10 m wind, m/s, cached."""
    REF.mkdir(parents=True, exist_ok=True)
    path = REF / f"{src}_{lat:.4f}_{lon:.4f}_{year}.csv"
    if path.exists():
        d = pd.read_csv(path)
        return d if len(d) else None
    url, model, _ = SOURCES[src]
    q = (f"{url}?latitude={lat:.5f}&longitude={lon:.5f}&start_date={year}-09-01&end_date={year}-11-30"
         f"&hourly=wind_speed_10m&wind_speed_unit=ms&timezone=GMT&models={model}")
    for attempt in range(5):
        try:
            with urllib.request.urlopen(q, timeout=60) as r:
                j = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code == 400:   # outside the model's domain or its archive: kept as none, not asked again
                pd.DataFrame({"t": [], "u10": []}).to_csv(path, index=False)
                return None
            if attempt == 4:
                print(f"  {src} {lat:.3f},{lon:.3f} {year}: {e}", flush=True)
                return None
            time.sleep(60 if e.code == 429 else 5 * (attempt + 1))
        except Exception as e:  # noqa: BLE001
            if attempt == 4:
                print(f"  {src} {lat:.3f},{lon:.3f} {year}: {e}", flush=True)
                return None
            time.sleep(5 * (attempt + 1))
    h = j.get("hourly") or {}
    key = next((k for k in h if k.startswith("wind_speed_10m")), None)
    d = pd.DataFrame({"t": h.get("time", []), "u10": h.get(key, []) if key else []}).dropna()
    d.to_csv(path, index=False)
    time.sleep(0.3)
    return d if len(d) else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--min-u", type=float, default=1.5, help="the forecast 10 m wind, m/s, over which an hour counts")
    ap.add_argument("--json")
    a = ap.parse_args()
    d, _ = W.load_rows()
    d["hour"] = pd.to_datetime(d.t_mid, utc=True).dt.round("h")
    off = d.leaf_off.values
    C = (d.app_closure.values / 100).clip(0, 1)
    D = d.decid.values if "decid" in d else np.zeros(len(d))
    share = np.minimum(W.CAP, 0.21 * np.exp(1.34 * (1 - C)) * (1 + 0.31 * D * off))
    d["app_rule"] = np.where(d.app_h >= 3, share * (1 - 0.3 * d.app_s.values), d.app_new.values)
    out, card = [], {"minU": a.min_u, "sources": {}}
    for src, (_, _, y0) in SOURCES.items():
        parts = []
        for unit, g in d.groupby("unit"):
            lat, lon = float(g.lat.iloc[0]), float(g.lon.iloc[0])
            years = sorted(y for y in pd.to_datetime(g.t_mid, utc=True).dt.year.unique() if y >= y0)
            fs = [f.assign(year=y) for y in years if (f := fetch(src, lat, lon, int(y))) is not None]
            if not fs:
                continue
            f = pd.concat(fs)
            f["hour"] = pd.to_datetime(f.t, utc=True)
            m = g.merge(f[["hour", "u10"]], on="hour", how="inner")
            m = m[m.u10 >= a.min_u]
            if len(m) < 200:
                continue
            m["floor_u10"] = m.meas * m.ws_top / m.u10
            parts.append(m)
        if not parts:
            continue
        x = pd.concat(parts)
        rows = []
        for unit, m in x.groupby("unit"):
            q_app = m.app_new / m.floor_u10
            q_rule = m.app_rule / m.floor_u10
            rows.append(dict(unit=unit, n=len(m), h=float(m.app_h.iloc[0]), top_u10=float((m.ws_top / m.u10).median()),
                             floor_top=float(m.meas.median()), floor_u10=float(m.floor_u10.median()),
                             app=float(m.app_new.median()), rule=float(m.app_rule.median()),
                             w2_app=float(((q_app >= 0.5) & (q_app <= 2)).mean()), w2_rule=float(((q_rule >= 0.5) & (q_rule <= 2)).mean()),
                             app_over=float(q_app.median()), rule_over=float(q_rule.median())))
        t = pd.DataFrame(rows).sort_values("h")
        # the rule's level in the forecast's terms: its share scaled by k (c0 = 0.21 k), within 2x per k
        sweep = {}
        for k in (0.5, 0.6, 0.7, 0.8, 0.9, 1.0):
            w = [float((((q := m.app_rule * k / m.floor_u10) >= 0.5) & (q <= 2)).mean()) for _, m in x.groupby("unit")]
            sweep[k] = round(float(np.mean(w)), 3)
        summ = dict(towers=len(t), n=int(t.n.sum()), top_u10=round(float(t.top_u10.median()), 2),
                    floor_u10=round(float(t.floor_u10.median()), 3), floor_top=round(float(t.floor_top.median()), 3),
                    within2_app=round(float(t.w2_app.mean()), 3), within2_rule=round(float(t.w2_rule.mean()), 3),
                    app_over_measured=round(float(t.app_over.median()), 2), rule_over_measured=round(float(t.rule_over.median()), 2),
                    rule_scaled_within2=sweep, refChecked=sorted(t.unit))
        card["sources"][src] = summ
        out.append(f"## {src} (U10 >= {a.min_u} m/s)\n")
        out.append(f"{summ}\n")
        out.append(t.to_string(index=False, float_format=lambda v: f"{v:.3g}"))
        out.append("")
    text = "\n".join(out)
    (REF / "ref_wind.md").write_text("# The towers' floor against a forecast's 10 m wind (ref_wind.py)\n\n" + text, encoding="utf-8")
    print(text)
    if a.json:
        Path(a.json).write_text(json.dumps(card, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
