"""Draw PALM runs of a case side by side in the surrogate's field convention:
one row per converted run, the floor's turn from the ambient, the share of
the averaging window the floor ran reversed, and the treetops' turn, with the
case's checks ringed and the scored core dashed. For looking at what a run
did where a hunter stood, beside the numbers palm_to_fields.py score gives.

    py -3.14 pipeline/teacher/palm/draw_runs.py searchmont [run ...] [--out path.png]

Reads pipeline/raw/teacher/palm/fields/<run>.npz (palm_to_fields.py convert)
and the checks in palm_to_fields.CHECKS; writes fields/<case>-runs.png.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from palm_to_fields import CHECKS, OUT  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("case")
    ap.add_argument("runs", nargs="*", help="run names (default: every converted run of the case)")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LightSource, TwoSlopeNorm
    from pyproj import Transformer

    runs = a.runs or sorted(p.stem for p in OUT.glob(f"{a.case}_*.npz"))
    if not runs:
        raise SystemExit(f"no converted runs of {a.case} in {OUT}")
    checks = [c for group in CHECKS.get(a.case, {}).values() for c in group]
    seen = set()
    checks = [c for c in checks if not (c["label"] in seen or seen.add(c["label"]))]
    fig, axes = plt.subplots(len(runs), 3, figsize=(16, 5.2 * len(runs)), squeeze=False)
    for row, run in enumerate(runs):
        z = np.load(OUT / f"{run}.npz")
        meta = json.loads(str(z["meta"]))
        dem = z["dem"]
        R, C = dem.shape
        dx = float(meta.get("cell", 10.0))
        bx = meta["bounds"]
        amb = float(z["directions"][0])
        amb_kmh = float(meta["ambient"]["speedKph"])
        tr = Transformer.from_crs("EPSG:4326", f"EPSG:{meta['epsg']}", always_xy=True)
        pts = []
        for c in checks:
            x, y = tr.transform(c["lon"], c["lat"])
            pts.append((c["label"], (bx[3] - y) / dx, (x - bx[0]) / dx, c.get("felt")))

        def turn(u, v):
            toward = (np.degrees(np.arctan2(u, v)) + 360) % 360
            return (toward - (amb + 180) + 540) % 360 - 180

        ext = [0, C * dx / 1000, R * dx / 1000, 0]
        shade = LightSource(azdeg=315, altdeg=45).hillshade(dem.astype(float), vert_exag=2, dx=dx, dy=dx)
        panels = [
            ("floor (0–10 m): turn from the ambient", turn(z["uHead"][0], z["vHead"][0]), "RdBu_r", TwoSlopeNorm(0, -180, 180), "°"),
            ("share of the window the floor ran reversed", z["reversedHead"][0], "magma", None, ""),
            ("treetops (canopy + 10 m): turn from the ambient", turn(z["u"][0], z["v"][0]), "RdBu_r", TwoSlopeNorm(0, -180, 180), "°"),
        ]
        for col, (title, field, cmap, norm, unit) in enumerate(panels):
            ax = axes[row][col]
            ax.imshow(shade, cmap="gray", extent=ext, vmin=0, vmax=1)
            kw = dict(norm=norm) if norm is not None else dict(vmin=0, vmax=0.7)
            im = ax.imshow(field, cmap=cmap, alpha=0.65, extent=ext, **kw)
            plt.colorbar(im, ax=ax, fraction=0.04, label=unit)
            for label, r, c, felt in pts:
                ax.plot(c * dx / 1000, r * dx / 1000, "o", ms=9, mfc="none", mec="yellow", mew=2)
                if col == 0:
                    ax.annotate(f"{label}" + (f": felt {felt}°" if felt else ""), (c * dx / 1000, r * dx / 1000),
                                xytext=(7, -11), textcoords="offset points", color="yellow", fontsize=8, fontweight="bold")
            rr, cc = np.where(z["core"])
            ax.add_patch(plt.Rectangle((cc.min() * dx / 1000, rr.min() * dx / 1000), (cc.max() - cc.min()) * dx / 1000,
                                       (rr.max() - rr.min()) * dx / 1000, fill=False, ec="white", lw=0.8, ls="--"))
            ax.set_xticks([]); ax.set_yticks([])
            ax.set_title(f"{run}: {title}" if col == 0 else title, fontsize=10)
        axes[row][0].set_ylabel(f"{meta.get('stability', '')}: ambient {amb:.0f}° at {amb_kmh:.1f} km/h", fontsize=10)
    fig.suptitle(f"{a.case}: PALM runs at {dx:g} m, the checks ringed, the scored core dashed", fontsize=12)
    plt.tight_layout()
    out = a.out or OUT / f"{a.case}-runs.png"
    plt.savefig(out, dpi=100)
    print("wrote", out)


if __name__ == "__main__":
    main()
