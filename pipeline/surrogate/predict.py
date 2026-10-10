"""Write the surrogate's 16 directions for an area in the dataset's own
layout, so the app pipeline can A/B it against WindNinja's grids with the
same reader: u, v (east, north, / ambient), turb (/ ambient) and
directions, on the area's 30 m UTM grid (row 0 north).

    py -3.14 pipeline/surrogate/predict.py --run foldA --area blanchard-river [--tta]

Output: pipeline/raw/surrogate/pred-<run>-<area>.npz
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from fields import DATA, load_area, predict_domain  # noqa: E402


def main() -> None:
    if "--remote" in sys.argv[1:]:
        # to xonix through the kit (remote.py), which sends runs/<run> along
        import remote
        sys.exit(remote.run("predict.py", [a for a in sys.argv[1:] if a != "--remote"]))

    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--run", required=True)
    ap.add_argument("--area", required=True)
    ap.add_argument("--ckpt", type=Path, default=None)
    ap.add_argument("--tta", action="store_true", help="average the eight D4 turns of the scene")
    ap.add_argument("--device", default=None)
    ap.add_argument("--data", type=Path, default=DATA)
    ap.add_argument("--remote", action="store_true",
                    help="predict on xonix through the kit (remote.py; SURROGATE_KIT names it)")
    args = ap.parse_args()

    import torch
    from train import load_checkpoint

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    ckpt = args.ckpt or args.data / "runs" / args.run / "ckpt.pt"
    model, config = load_checkpoint(ckpt, device)
    area = load_area(args.area, args.data)
    u, v, turb = predict_domain(model, area, area.directions, device=device, tta=args.tta)
    out = args.data / f"pred-{args.run}-{args.area}.npz"
    meta = {"run": args.run, "checkpoint": str(ckpt), "steps": config.get("steps"), "tta": args.tta,
            "train_areas": config.get("train_areas"), "in_sample": args.area in config.get("train_areas", [])}
    np.savez_compressed(out, u=u, v=v, turb=turb, directions=area.directions.astype(np.float32),
                        meta=json.dumps(meta))
    print(f"{out}: {u.shape}")


if __name__ == "__main__":
    main()
