"""One picture per PALM run: the head-height wind over the ground, the way
the surrogate's field holds it. Streamlines at head height coloured by
speed, over the hillshade and the canopy, the forecast's arrow, the box's
own wind, the case's check spots ringed, the scored core dashed.
postprocess.py draws it for every run as it lands (fields/<name>_wind.png).

    py -3.14 pipeline/teacher/palm/draw_wind.py <name> [--out path.png]

Reads pipeline/raw/teacher/palm/fields/<name>.npz (palm_to_fields.py convert)
and the case's grid-<tag>.npz for the canopy and the water.
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

BG = "#0a100b"; INK = "#f1e9d6"; DIM = "#c9c4a9"; FAINT = "#93a58c"; ACC = "#d2a85c"; GRID = "#1f3328"


def draw(name: str, out: Path | None = None) -> Path:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LightSource
    from pyproj import Transformer

    z = np.load(OUT / f"{name}.npz", allow_pickle=False)
    m = json.loads(str(z["meta"]))
    x0, y0, x1, y1 = m["bounds"]; cell = m["cell"]; R, C = int(m["rows"]), int(m["cols"])
    u, v = z["uHead"][0], z["vHead"][0]
    dem = z["dem"]
    case, tag = m["case"], (m.get("domain") or "")
    # the case's grid for the canopy and water: find the one matching this cell size
    grid = None
    for gp in sorted((HERE / case).glob("grid*.npz")):
        g = np.load(gp)
        if g["dem"].shape == dem.shape:
            grid = g; break
    spd = np.hypot(u, v) * 3.6
    fig, ax = plt.subplots(figsize=(9.5, 9.5), facecolor=BG)
    ext = (0, C * cell, 0, R * cell)
    ls = LightSource(315, 45)
    ax.imshow(ls.shade(dem, cmap=plt.get_cmap("Greys_r"), vert_exag=2, blend_mode="overlay", dx=cell, dy=cell), extent=ext, alpha=0.85)
    if grid is not None:
        can = grid["canopy_h"]
        ax.imshow(np.where(can > 2, can, np.nan), extent=ext, cmap="Greens", vmin=-6, vmax=24, alpha=0.45)
        ax.imshow(np.where(grid["water"], 1.0, np.nan), extent=ext, cmap="Blues", vmin=0, vmax=1.5, alpha=0.6)
    xs = (np.arange(C) + 0.5) * cell; ys = (np.arange(R) + 0.5) * cell
    # row 0 north in the field: flip for streamplot's increasing y
    U = u[::-1]; V = v[::-1]; S = spd[::-1]
    vmax = float(np.nanpercentile(spd, 98)) or 1.0
    strm = ax.streamplot(xs, ys, np.nan_to_num(U), np.nan_to_num(V), color=np.nan_to_num(S), cmap="viridis", density=2.2, linewidth=0.9,
                         arrowsize=0.7, norm=plt.Normalize(0, vmax))
    cb = fig.colorbar(strm.lines, ax=ax, fraction=0.03, pad=0.02); cb.set_label("km/h at head height", color=DIM)
    cb.ax.yaxis.set_tick_params(color=DIM); plt.setp(cb.ax.get_yticklabels(), color=DIM); cb.outline.set_edgecolor(GRID)
    # the scored core
    core = m.get("core_m") or None
    ring = m.get("ring_m") or 0
    if ring:
        ax.add_patch(plt.Rectangle((ring, ring), C * cell - 2 * ring, R * cell - 2 * ring, fill=False, ls="--", lw=1, ec=DIM, alpha=0.7))
    # the check spots of the case
    to = Transformer.from_crs(4326, m["epsg"], always_xy=True)
    checks = CHECKS.get(case, {})
    if isinstance(checks, dict):
        checks = checks.get(m.get("stability", "neutral")) or next(iter(checks.values()), [])
    for ck in checks or []:
        X, Y = to.transform(ck["lon"], ck["lat"]); px, py = X - x0, Y - y0
        if 0 < px < C * cell and 0 < py < R * cell:
            ax.plot(px, py, "o", ms=12, mfc="none", mec=ACC, mew=2)
            if ck.get("felt") is not None:
                a = np.radians((ck["felt"] + 180) % 360)   # felt FROM: draw where it goes
                ax.annotate("", (px + 40 * np.sin(a), py + 40 * np.cos(a)), (px, py), arrowprops=dict(arrowstyle="-|>", color=ACC, lw=1.5))
            ax.text(px + 14, py + 10, ck.get("label", ""), color=ACC, fontsize=8)
    # the forecast and the box's own wind
    fc = m.get("forecast") or {}
    amb = m.get("ambient") or {}
    lines = []
    if fc.get("fromDeg") is not None or fc.get("direction") is not None:
        d = fc.get("fromDeg", fc.get("direction")); k = fc.get("kph", fc.get("speed_kph"))
        lines.append(f"forecast from {d:g}" + (f" at {k:g} km/h" if k else ""))
    if amb.get("fromTrue") is not None:
        lines.append(f"the box over the trees: from {amb['fromTrue']:.0f} at {amb.get('speedKph', 0):.1f} km/h")
    ax.text(0.01, 0.99, "\n".join(lines), transform=ax.transAxes, color=INK, fontsize=9.5, va="top", ha="left",
            bbox=dict(boxstyle="round", fc=BG, ec=GRID, alpha=0.85))
    fd = amb.get("fromTrue")
    if fd is not None:
        a = np.radians((fd + 180) % 360); cx, cy = C * cell * 0.9, R * cell * 0.1
        ax.annotate("", (cx + 60 * np.sin(a), cy + 60 * np.cos(a)), (cx, cy), arrowprops=dict(arrowstyle="-|>", color=ACC, lw=2))
    ax.plot([C * cell - 160, C * cell - 60], [40, 40], color="white", lw=2); ax.text(C * cell - 110, 50, "100 m", color="white", ha="center", fontsize=9)
    ax.set_xlim(0, C * cell); ax.set_ylim(0, R * cell); ax.set_aspect("equal"); ax.axis("off")
    ax.set_title(f"{name}: the wind at head height, the mean over the last {m.get('average_s', 0) / 60:.0f} min\n{m.get('stability', '')} air, {cell:g} m cells; green the canopy, blue water; gold rings the field checks, their arrows where the air was felt to go",
                 color=INK, fontsize=10)
    out = out or (OUT / f"{name}_wind.png")
    fig.savefig(out, dpi=110, bbox_inches="tight", facecolor=BG); plt.close(fig)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("name"); ap.add_argument("--out")
    args = ap.parse_args()
    print("->", draw(args.name, Path(args.out) if args.out else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
