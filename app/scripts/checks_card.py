"""The checks card: the app's ground wind against the wind checks felt in the field, in the numbers the
scent and wind rules are judged by (docs/SCENT-TESTSET.md, the bar's checks side):

  - direction: the share of checks whose felt direction is within 45° of the app's call;
  - the honest spread's coverage: the share within 1 sd of hypot(place, model, forecast) (model.ts
    Spread, the pale shade's width), 68% when the spread is calibrated, the bar 60-80%;
  - the shown sigma's coverage, for reference;
  - n of each (checks with a felt direction and a call).

Pickle Lake's 60 checks (GPX, 2026-10-06) tune; Searchmont's 16 (huntapp-d1's JSON, 2026-10-11) are held
out. The files hold real positions and stay out of the repo: pass them, or keep them at the defaults.

    py -3.14 scripts/checks_card.py --url http://localhost:5251/ --out card.json
    py -3.14 scripts/checks_card.py --url http://localhost:5231/ --pickle <gpx> --searchmont <json>

Runs scripts/replay.py once per set (its HD pin and archived forecasts) and reads its CSV.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PICKLE = os.environ.get("HUNTAPP_CHECKS_PICKLE", str(Path.home() / ".claude/projects/c--dev-huntapp/field-data/hunt-log-2026-10-06.gpx"))
SEARCHMONT = os.environ.get("HUNTAPP_CHECKS_SEARCHMONT", str(HERE.parent.parent / "pipeline/raw/replay/checks-d1-2026-10-11.json"))


def wrap(a: float) -> float:
    return abs((a + 180) % 360 - 180)


def num(v: str | None) -> float | None:
    try:
        return None if v in (None, "", "None") else float(v)
    except ValueError:
        return None


def card(rows: list[dict]) -> dict:
    """The numbers for one set, from replay's CSV rows."""
    d = [r for r in rows if num(r.get("feltDirFrom")) is not None and num(r.get("newDirFrom")) is not None]
    err = [wrap(num(r["feltDirFrom"]) - num(r["newDirFrom"])) for r in d]
    out: dict = {"n": len(d), "checks": len(rows)}
    if not d:
        return out
    out["within45"] = round(sum(e <= 45 for e in err) / len(d), 3)
    out["medianApart"] = round(sorted(err)[len(err) // 2], 1)
    sig = [num(r.get("newSigma")) for r in d]
    if all(s is not None for s in sig):
        out["shownWithin1sd"] = round(sum(e <= s for e, s in zip(err, sig)) / len(d), 3)
    parts = [(num(r.get("spreadPlace")), num(r.get("spreadModel")), num(r.get("spreadFcst"))) for r in d]
    ok = [(e, p) for e, p in zip(err, parts) if None not in p]
    if ok:
        out["honestN"] = len(ok)
        out["honestWithin1sd"] = round(sum(e <= math.hypot(*p) for e, p in ok) / len(ok), 3)
        out["honestWithin2sd"] = round(sum(e <= 2 * math.hypot(*p) for e, p in ok) / len(ok), 3)
    return out


def run_set(name: str, path: str, url: str, extra: list[str]) -> dict:
    if not Path(path).exists():
        return {"skipped": f"no checks file at {path}"}
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / f"{name}.csv"
        cmd = [sys.executable, str(HERE / "replay.py"), path, "--url", url, "--out", str(out), *extra]
        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        p = subprocess.run(cmd, cwd=str(HERE.parent), capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
        if p.returncode != 0 or not out.exists():
            return {"error": (p.stderr or p.stdout)[-800:]}
        rows = list(csv.DictReader(open(out, encoding="utf-8")))
    return card(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--url", default="http://localhost:5195/", help="the quiet dev server (the app's root)")
    ap.add_argument("--pickle", default=PICKLE, help="Pickle Lake's checks (GPX); env HUNTAPP_CHECKS_PICKLE")
    ap.add_argument("--searchmont", default=SEARCHMONT, help="Searchmont's checks (JSON); env HUNTAPP_CHECKS_SEARCHMONT")
    ap.add_argument("--replay-arg", action="append", default=[], help="passed on to replay.py (e.g. --lee '{...}'), repeatable")
    ap.add_argument("--out", help="write the card as JSON here (printed either way)")
    args = ap.parse_args()
    base = args.url.rstrip("/") + "/"
    res = {
        "url": base,
        "pickle": run_set("pickle", args.pickle, base, args.replay_arg),
        "searchmont": run_set("searchmont", args.searchmont, base + "?area=searchmont", args.replay_arg),
    }
    text = json.dumps(res, indent=1)
    print(text)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
