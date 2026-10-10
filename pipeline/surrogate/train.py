"""Train the surrogate (model.py) on WindNinja's momentum fields, with one
area held out whole, so the score at the end is for terrain the net has
never seen.

A sample is a random 192 x 192 patch (5.8 km) of one training area, one of
its 16 directions, and one of the eight D4 turns and mirrors (fields.d4,
exact). The loss is the mean squared error of (du, dv), the departure from
the ambient, plus half that of the turbulence, both over the dataset's
valid cells only (the 20 cells at the domain edge are where WindNinja's
inflow is still settling) and the turbulence only where WindNinja wrote it.
AdamW at 1e-3 after a short warm-up, cosine down to 1e-5, batch 16, bf16,
and an exponential moving average of the weights, which is what gets
scored and saved for use.

Every 1000 steps the averaged net runs over the whole held-out domain for
two directions and prints the core's mean turn error against WindNinja, so
the run shows whether it generalises while it trains, not only at the end.

    py -3.14 pipeline/surrogate/train.py --holdout blanchard-river --name foldA --minutes 25
    py -3.14 pipeline/surrogate/train.py --holdout highland-lake --name foldB --steps 12000

Inputs:  pipeline/raw/surrogate/<area>.npz (dataset.py)
Output:  pipeline/raw/surrogate/runs/<name>/ckpt.pt (weights, averaged
         weights, config), log.jsonl (loss and held-out checks), config.json
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import queue
import sys
import threading
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

if __name__ == "__main__" and "--remote" in sys.argv[1:]:
    # to xonix through the kit (remote.py), before torch takes its seconds to load here
    import remote
    sys.exit(remote.run("train.py", [a for a in sys.argv[1:] if a != "--remote"]))

import torch  # noqa: E402

from fields import (AREAS, DATA, N_IN, REL_SCALE_M, REL_WINDOW, Area, bearing, d4,  # noqa: E402
                    direction_index, load_area, predict_domain, wrap180)
from model import WIDTHS, UNet, n_params  # noqa: E402

PATCH = 192
BATCH = 16
LR, LR_END, WARMUP = 1e-3, 1e-5, 300
TURB_WEIGHT = 0.5
EMA_DECAY = 0.999
WATCH_DIRS = (45.0, 270.0)
WATCH_EVERY = 1000
MIN_VALID = 0.5  # a patch that is mostly domain edge teaches the inflow, not the terrain


class Sampler:
    """Random (area, direction, patch, D4 element) samples, built on the
    CPU in a background thread while the GPU trains on the last batch."""

    def __init__(self, areas: list[Area], patch: int, batch: int, seed: int, pin: bool = True):
        self.areas, self.patch, self.batch, self.pin = areas, patch, batch, pin
        self.rng = np.random.default_rng(seed)
        for a in areas:
            if min(a.shape) < patch:
                raise ValueError(f"{a.name} {a.shape} is smaller than the {patch} patch")
            # cells WindNinja wrote a wind to, per direction
            a.uv_ok = a.valid[None] & np.isfinite(a.u) & np.isfinite(a.v)  # type: ignore[attr-defined]
        self.q: queue.Queue = queue.Queue(maxsize=6)
        self._stop = False
        self.thread = threading.Thread(target=self._fill, daemon=True)
        self.thread.start()

    def sample(self, x: np.ndarray, y: np.ndarray, m: np.ndarray) -> None:
        rng, P = self.rng, self.patch
        a = self.areas[rng.integers(len(self.areas))]
        i = int(rng.integers(len(a.directions)))
        R, C = a.shape
        for _ in range(10):
            r0, c0 = int(rng.integers(0, R - P + 1)), int(rng.integers(0, C - P + 1))
            if a.valid[r0:r0 + P, c0:c0 + P].mean() >= MIN_VALID:
                break
        sl = (slice(r0, r0 + P), slice(c0, c0 + P))
        scal = np.stack([a.rel[sl], a.uv_ok[i][sl].astype(np.float32), a.turb[i][sl]])
        vecs = [(a.gx[sl], a.gy[sl]), (a.u[i][sl], a.v[i][sl])]
        ex, ey = a.amb(float(a.directions[i]))
        k, flip = int(rng.integers(4)), bool(rng.integers(2))
        scal, ((gx, gy), (u, v)), ex, ey = d4(k, flip, scal, vecs, float(ex), float(ey))
        rel, ok, turb = scal
        x[0], x[1], x[2], x[3], x[4] = rel, gx, gy, ex, ey
        ok = ok > 0.5
        y[0] = np.where(ok, u - ex, 0.0)
        y[1] = np.where(ok, v - ey, 0.0)
        tok = ok & np.isfinite(turb)
        y[2] = np.where(tok, turb, 0.0)
        m[0], m[1] = ok, tok

    def _make(self):
        B, P = self.batch, self.patch
        x = np.empty((B, N_IN, P, P), np.float32)
        y = np.empty((B, 3, P, P), np.float32)
        m = np.empty((B, 2, P, P), np.float32)
        for b in range(B):
            self.sample(x[b], y[b], m[b])
        out = (torch.from_numpy(x), torch.from_numpy(y), torch.from_numpy(m))
        return tuple(t.pin_memory() for t in out) if self.pin else out

    def _fill(self):
        while not self._stop:
            self.q.put(self._make())

    def next(self):
        return self.q.get()

    def stop(self):
        self._stop = True


def masked_loss(pred: torch.Tensor, y: torch.Tensor, m: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    pred = pred.float()
    m_uv, m_t = m[:, 0:1], m[:, 1:2]
    se_uv = ((pred[:, :2] - y[:, :2]) ** 2 * m_uv).sum() / (2 * m_uv.sum()).clamp(min=1)
    se_t = ((pred[:, 2:3] - y[:, 2:3]) ** 2 * m_t).sum() / m_t.sum().clamp(min=1)
    return se_uv + TURB_WEIGHT * se_t, se_uv, se_t


def lr_at(step: int, total: int) -> float:
    if step < WARMUP:
        return LR * (step + 1) / WARMUP
    t = min(1.0, (step - WARMUP) / max(1, total - WARMUP))
    return LR_END + 0.5 * (LR - LR_END) * (1 + math.cos(math.pi * t))


def watch(model: torch.nn.Module, area: Area, device: str) -> dict:
    """The held-out core's turn error for a couple of directions, one
    whole-domain pass each."""
    pu, pv, _ = predict_domain(model, area, WATCH_DIRS, device=device, batch=len(WATCH_DIRS))
    out = {}
    m = area.core & area.valid
    errs = []
    for j, d in enumerate(WATCH_DIRS):
        i = direction_index(area, d)
        e = wrap180(bearing(pu[j], pv[j]) - bearing(area.u[i], area.v[i]))
        ok = m & np.isfinite(e)
        out[f"turn_mae_{int(d):03d}"] = float(np.abs(e[ok]).mean())
        errs.append(np.abs(e[ok]))
    out["turn_mae"] = float(np.concatenate(errs).mean())
    return out


def save(path: Path, model, ema, config: dict, step: int) -> None:
    torch.save({"model": model.state_dict(), "ema": ema.state_dict(), "config": config, "step": step}, path)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--holdout", default=None, help="area left out of training and watched")
    ap.add_argument("--areas", nargs="*", default=None, help="training areas (default: all but the holdout)")
    ap.add_argument("--name", default=None)
    ap.add_argument("--steps", type=int, default=12000)
    ap.add_argument("--minutes", type=float, default=None, help="train for this long instead of --steps")
    ap.add_argument("--batch", type=int, default=BATCH)
    ap.add_argument("--patch", type=int, default=PATCH)
    ap.add_argument("--widths", type=int, nargs="*", default=list(WIDTHS))
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--data", type=Path, default=DATA)
    ap.add_argument("--remote", action="store_true",
                    help="train on xonix through the kit (remote.py; SURROGATE_KIT names it)")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    torch.backends.cudnn.benchmark = True
    names = args.areas or [a for a in AREAS if a != args.holdout]
    name = args.name or (f"hold-{args.holdout}" if args.holdout else "all")
    run = args.data / "runs" / name
    run.mkdir(parents=True, exist_ok=True)
    cuda = args.device.startswith("cuda")

    t0 = time.time()
    areas = [load_area(n, args.data) for n in names]
    hold = load_area(args.holdout, args.data) if args.holdout else None
    print(f"loaded {', '.join(f'{a.name} {a.shape}' for a in areas)}"
          + (f"; holding out {hold.name} {hold.shape}" if hold else "") + f" ({time.time() - t0:.0f} s)")

    model = UNet(widths=tuple(args.widths)).to(args.device)
    ema = copy.deepcopy(model).eval()
    for p in ema.parameters():
        p.requires_grad_(False)
    config = {
        "widths": list(args.widths), "rel_window": REL_WINDOW, "rel_scale_m": REL_SCALE_M,
        "train_areas": names, "holdout": args.holdout, "patch": args.patch, "batch": args.batch,
        "seed": args.seed, "params": n_params(model), "lr": [LR, LR_END], "ema": EMA_DECAY,
        "turb_weight": TURB_WEIGHT, "ambient_axes": "grid",
        "convergence": {a.name: a.conv for a in areas + ([hold] if hold else [])},
    }
    print(f"{n_params(model) / 1e6:.2f} M parameters on {args.device}; run {run}")
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)
    sampler = Sampler(areas, args.patch, args.batch, args.seed, pin=cuda)
    log = open(run / "log.jsonl", "a", encoding="utf-8")

    total = args.steps
    budget = args.minutes * 60 if args.minutes else None
    start = time.time()
    run_loss = []
    ema_p, model_p = list(ema.parameters()), list(model.parameters())
    step = 0
    while step < total:
        if budget and step == 60:
            # the schedule wants the length up front: time 50 steps after
            # cuDNN has settled and fit the rest into the budget
            rate = (time.time() - t_rate) / 50
            total = max(step + 100, int((budget - (time.time() - start)) / (rate * 1.04)) + step)
            print(f"  {rate * 1000:.0f} ms a step: {total} steps fit {args.minutes:g} min")
        if budget and step == 10:
            t_rate = time.time()
        for g in opt.param_groups:
            g["lr"] = lr_at(step, total)
        x, y, m = (t.to(args.device, non_blocking=True) for t in sampler.next())
        with torch.autocast(device_type="cuda" if cuda else "cpu", dtype=torch.bfloat16, enabled=cuda):
            pred = model(x)
        loss, l_uv, l_t = masked_loss(pred, y, m)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        with torch.no_grad():
            d = min(EMA_DECAY, (1 + step) / (10 + step))
            torch._foreach_lerp_(ema_p, model_p, 1 - d)
        step += 1
        run_loss.append((loss.detach(), l_uv.detach(), l_t.detach()))
        if step % 100 == 0 or step == total:
            vals = torch.stack([torch.stack(r) for r in run_loss]).mean(0).tolist()
            run_loss = []
            el = time.time() - start
            rec = {"step": step, "loss": vals[0], "loss_uv": vals[1], "loss_turb": vals[2],
                   "lr": opt.param_groups[0]["lr"], "minutes": el / 60}
            if cuda:
                rec["gpu_gb"] = torch.cuda.max_memory_allocated() / 2**30
            msg = (f"step {step:6d}/{total}  loss {vals[0]:.5f} (uv {vals[1]:.5f} turb {vals[2]:.5f})  "
                   f"lr {rec['lr']:.1e}  {el / 60:5.1f} min")
            if cuda:
                msg += f"  gpu {rec['gpu_gb']:.2f} GB"
            if hold is not None and (step % WATCH_EVERY == 0 or step == total):
                w = watch(ema, hold, args.device)
                rec["holdout"] = w
                msg += "  | " + hold.name + " core turn MAE " + "  ".join(
                    f"{k[-3:]}: {v:.1f}" for k, v in w.items() if k != "turn_mae") + f"  all {w['turn_mae']:.2f} deg"
            print(msg, flush=True)
            log.write(json.dumps(rec) + "\n")
            log.flush()
            if step % WATCH_EVERY == 0 or step == total:
                config.update(steps=step, minutes=el / 60)
                save(run / "ckpt.pt", model, ema, config, step)
    sampler.stop()
    config.update(steps=step, minutes=(time.time() - start) / 60)
    if cuda:
        config["gpu_gb_peak"] = torch.cuda.max_memory_allocated() / 2**30
    save(run / "ckpt.pt", model, ema, config, step)
    (run / "config.json").write_text(json.dumps(config, indent=2))
    print(f"done: {step} steps in {config['minutes']:.1f} min -> {run / 'ckpt.pt'}")


def load_checkpoint(path: Path, device: str, which: str = "ema") -> tuple[UNet, dict]:
    ck = torch.load(path, map_location=device, weights_only=False)
    model = UNet(widths=tuple(ck["config"]["widths"])).to(device)
    model.load_state_dict(ck[which])
    model.eval()
    return model, ck["config"]


if __name__ == "__main__":
    main()
