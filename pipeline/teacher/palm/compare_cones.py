"""The harness's picture: the app's cone beside PALM's plume for the same
sits and hour, in the one measure (how often a nose gets scent, reach by
sector in three bands). docs/SCENT-TEACHER.md.

    py -3.14 pipeline/teacher/palm/compare_cones.py \
        --palm pipeline/raw/teacher/palm/fields/pickle-bogstrip_b232_4m_sit_scent.json \
        --app  pipeline/raw/teacher/palm/fields/pickle-bogstrip_b232_appcone.json \
        --match "1=position 1" --match "2=position 2" --match "3=Gavan's sit 30 Sep, winded, bull S 1.5" \
        --out site/media/winded-strip-compare.png

Each --match pairs an app sit's name with the start of a PALM source's name.
Prints a table of reach by band and sector for both and draws the pair of
roses per sit: app on the left, PALM on the right.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

BG = "#0a100b"; INK = "#f1e9d6"; DIM = "#c9c4a9"; GRID = "#1f3328"
BANDS = [("0.03", "#2a7fb0", 0.45, "now and then"), ("0.15", "#4fc7ff", 0.7, "some minutes"), ("0.5", "#e9f9ff", 0.95, "most minutes")]


def rose(ax, rs: dict, title: str, rmax: float) -> None:
    ax.set_facecolor(BG); ax.set_theta_zero_location("N"); ax.set_theta_direction(-1)
    sect = sorted(rs, key=int); th = np.radians([int(s) + 22.5 for s in sect]); w = np.radians(45) * 0.92
    for band, col, a, label in BANDS:
        ax.bar(th, [rs[s][band] for s in sect], width=w, color=col, alpha=a, edgecolor=BG, lw=0.6, label=label)
    ax.set_rmax(rmax); ax.set_rticks([100, 200, 300] if rmax >= 300 else [50, 100, 150]); ax.set_rlabel_position(200)
    ax.set_yticklabels([f"{t} m" for t in ax.get_yticks()], color=DIM, fontsize=7)
    ax.set_xticks(np.radians([0, 90, 180, 270])); ax.set_xticklabels(["N", "E", "S", "W"], color=INK, fontsize=10)
    ax.grid(color=GRID); ax.spines["polar"].set_color(GRID); ax.set_title(title, color=INK, fontsize=10, pad=10)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--palm", required=True); ap.add_argument("--app", required=True)
    ap.add_argument("--match", action="append", required=True, help="appname=palm source name prefix")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    P = json.loads(Path(args.palm).read_text(encoding="utf-8"))["sources"]
    A = json.loads(Path(args.app).read_text(encoding="utf-8"))["sits"]
    pairs = []
    for m in args.match:
        an, _, pp = m.partition("=")
        ps = next((s for s in P.values() if s["source"]["name"].startswith(pp)), None)
        if an not in A or ps is None:
            print(f"no match for {m}: app has {list(A)}, palm has {[s['source']['name'] for s in P.values()]}"); continue
        pairs.append((an, A[an], ps))
    print(f"{'sit':4} {'side':5} " + " ".join(f"{s:>9}" for s in ("N", "NE", "E", "SE", "S", "SW", "W", "NW")) + "   some-minutes reach by sector, m")
    for an, a, p in pairs:
        for side, rs in (("app", a["reach_by_sector"]), ("palm", p["reach_by_sector"])):
            print(f"{an:4} {side:5} " + " ".join(f"{rs[f'{k:03d}']['0.15']:9.0f}" for k in range(0, 360, 45)))
    import matplotlib
    matplotlib.use("Agg"); import matplotlib.pyplot as plt
    n = len(pairs); fig = plt.figure(figsize=(7.2, 3.6 * n), facecolor=BG)
    rmax = max(max(v["0.03"] for v in a["reach_by_sector"].values()) for _, a, p in pairs for a in (a, p)) if pairs else 300
    rmax = 150 if rmax <= 150 else 300 if rmax <= 300 else 450
    for i, (an, a, p) in enumerate(pairs):
        ax1 = fig.add_subplot(n, 2, 2 * i + 1, projection="polar"); ax2 = fig.add_subplot(n, 2, 2 * i + 2, projection="polar")
        rose(ax1, a["reach_by_sector"], f"sit {an}: the app's cone", rmax); rose(ax2, p["reach_by_sector"], f"sit {an}: PALM's plume", rmax)
        if i == 0:
            ax1.legend(loc="upper left", bbox_to_anchor=(-0.35, 1.25), frameon=False, labelcolor=DIM, fontsize=8)
    fig.suptitle("How far scent carries, by direction, in three bands of how often a nose gets it\nthe app's cone (left) against the physics model (right), same sits, same hour", color=INK, fontsize=11, y=0.995)
    fig.tight_layout(rect=(0, 0, 1, 0.96)); fig.savefig(args.out, dpi=130, facecolor=BG, bbox_inches="tight"); print("->", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
