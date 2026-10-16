"""The nightly loop of the HD wind and scent work (docs/SCENT-TESTSET.md; Gavan, 2026-10-15: "a self
improvement loop on our HD modelling of wind and scent" ... "Sounds good"). One round:

  1. what landed: PALM runs marked DONE since the last round, and whether they're processed;
  2. the scent card (scorecard.py, measure v2) on what hunt-dev serves (origin/main), HD pinned;
  3. the wind: palm_compare.py over every converted run on the same code, ranked by situation
     (stability x water / tree line / slot / forest / open, with the terrain lee by shelter angle),
     direction first (huntapp-ba's finding: width only hides direction error);
  4. the checks card (the felt wind, Pickle's and Searchmont's check sets: within 45 deg, and the honest
     spread's coverage within 1 sd, whose bar is 60-80%) on the same server (app/scripts/checks_card.py);
  5. proposals: the worst situations for the rule builder, and the PALM run that would teach most;
     nothing is queued or shipped by the loop (runs on the owner's word, shipping on Gavan's);
  6. the morning report, pipeline/raw/teacher/palm/loop/reports/<date>.md, and the queue as it stands.

    py -3.14 pipeline/teacher/palm/palm_loop.py                     # the round (task "Groundwind PALM loop", 05:30)
    py -3.14 pipeline/teacher/palm/palm_loop.py --ref HEAD --skip-wind --skip-checks

A round compares with the last one only when it scored the same runs: a run landing changes the card by
itself. One held-out sector either side of the 40 m line is the card's noise (about +-0.04).
"""

from __future__ import annotations

import argparse
import contextlib
import csv
import io
import json
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
import scorecard as sc  # noqa: E402
import palm_status as ps  # noqa: E402

LOOP = ROOT / "pipeline" / "raw" / "teacher" / "palm" / "loop"
REPORTS = LOOP / "reports"   # outside the repo tree: a nightly file there would show up in every session's git status
BASELINE = "8d50465"          # baseline v2 (docs/SCENT-TESTSET.md)
CHECKS = ROOT / "app" / "scripts" / "checks_card.py"   # huntapp-ba's checks card (d3c29b5): replay.py per set, JSON out
TOWERS = ROOT / "pipeline" / "towers" / "towers_card.py"   # huntapp-ba's towers card: forest over open at head height, by pair
FLOOR = ROOT / "pipeline" / "towers" / "why_floor.py"      # huntapp-ba's floor card: in-stand floor/top at NEON towers (--json)
# cases whose palm_compare rows look wrong, kept out of the wind ranking until checked: whitefish (2026-10-16,
# huntapp-ba: the app's speed bimodal 0.46 / 4.9 km/h, speed r 0.00, no reversals; the card's cells there look sound)
WIND_SUSPECT = {"whitefish"}


def landed_since(t0: float) -> list[str]:
    out = []
    for root in ps.RUNS:
        if not root.exists():
            continue
        for d in root.iterdir():
            done = d / "DONE"
            if done.exists() and done.stat().st_mtime > t0:
                out.append(f"{d.name} ({'processed' if (d / 'OUTPUT' / '.post.json').exists() else 'not processed yet'})")
    return sorted(out)


def card(results: list[dict]) -> dict:
    def t2(held):
        return sc.threat2([x for r in results if r["held"] == held for x in r["marks2"]])
    tune, held = t2(False), t2(True)
    sit = defaultdict(list)
    for r in results:
        sit[r["situation"]].extend(r["marks2"])
    return dict(tune=round(tune[4], 2), held=round(held[4], 2), misses=tune[2] + held[2], fa=tune[3] + held[3],
                shade=tune[1] + held[1], by_situation={k: round(sc.threat2(v)[4], 2) for k, v in sorted(sit.items())},
                miss_list=[f"{r['pid']} {r['run'].split('_', 1)[1]} {s}" for r in results
                           for s, m in zip(r["sectors"], r["marks2"]) if m == "M"])


def place(row: dict) -> str:
    def b(k):
        return str(row.get(k, "")).lower() == "true"
    where = "water" if b("water") else "tree line" if b("edge") else "slot" if b("appSlot") else "forest" if b("forest") else "open"
    sx = float(row.get("sx") or 0)
    lee = " in a lee >10°" if sx >= 10 else " in a lee 5-10°" if sx >= 5 else ""
    return f"{row.get('stability', '?')}, {where}{lee}"


def rank_wind(csv_path: Path) -> dict:
    groups = defaultdict(lambda: [0, 0, 0, 0])   # n, within 45, PALM reversed, app also reversed
    total = [0, 0]
    with open(csv_path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            g = groups[place(row)]
            ok = float(row["dirApart"]) <= 45
            g[0] += 1
            g[1] += ok
            if str(row["palmRev"]).lower() == "true":
                g[2] += 1
                g[3] += str(row["appRev"]).lower() == "true"
            total[0] += 1
            total[1] += ok
    ranked = sorted(((k, v) for k, v in groups.items() if v[0] >= 50), key=lambda kv: kv[1][1] / kv[1][0])
    return dict(points=total[0], within45=round(total[1] / max(1, total[0]), 3),
                worst=[dict(situation=k, n=v[0], within45=round(v[1] / v[0], 2),
                            reversed_recall=round(v[3] / v[2], 2) if v[2] else None) for k, v in ranked[:6]])


def wind_runs() -> list[str]:
    """Every converted run palm_compare can score: a field npz with its meta (cone_export's *_appcone.npz and
    the particle and band files sit in the same folder and have none: 'all' tripped on them, 2026-10-15)."""
    import numpy as np
    out = []
    for f in sorted(sc.FIELDS.glob("*.npz")):
        n = f.stem
        if n.endswith(("_particles", "_appcone")) or "_scent_" in n or n.startswith("searchmont") or n.endswith(("_t20", "_n40", "_N02")):
            continue
        if n.split("_")[0] in WIND_SUSPECT:
            continue
        try:
            if "meta" in np.load(f, allow_pickle=True).files:
                out.append(n)
        except (OSError, ValueError):
            continue
    # one per case, run and grid: a scent rerun (_scent, _sit2 ...) is the same wind again and would count it twice;
    # the plain run where there is one, else the first rerun
    keep: dict[str, str] = {}
    for n in out:
        key = "_".join(n.split("_")[:3])
        if key not in keep or n == key:
            keep[key] = n
    return sorted(keep.values())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--ref", default="origin/main", help="what to score (default: what hunt-dev serves)")
    ap.add_argument("--skip-card", action="store_true")
    ap.add_argument("--skip-wind", action="store_true")
    ap.add_argument("--skip-checks", action="store_true")
    args = ap.parse_args()
    LOOP.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    state_p = LOOP / "state.json"
    state = json.loads(state_p.read_text(encoding="utf-8")) if state_p.exists() else {}
    t_last = state.get("at", time.time() - 86400)
    now = datetime.now()
    subprocess.run(["git", "fetch", "-q", "origin"], cwd=ROOT)

    landed = landed_since(t_last)
    ts = json.loads((HERE / "testset.json").read_text(encoding="utf-8"))
    m = ts["measure"]
    jobs, pending = sc.jobs_from(ts, None)
    st = sc.prepare(args.ref, [])
    sc.SCORES.mkdir(parents=True, exist_ok=True)
    server = sc.serve()
    url = f"http://localhost:{sc.PORT}/"
    cardv, wind, checks, notes = None, None, None, []
    try:
        if not args.skip_card:
            results = sc.score(jobs, {"base": {}}, url, m["band"], m["trace"], float(m["reach_m"]))
            with contextlib.redirect_stdout(io.StringIO()):
                sc.summary(results, {"base": {}}, st, pending, ts, SimpleNamespace(no_save=False, label="nightly"))
            cardv = card(results)
        if not args.skip_wind:
            out = LOOP / f"wind-{now:%Y-%m-%d}.csv"
            p = subprocess.run([sys.executable, str(ROOT / "app" / "scripts" / "palm_compare.py"), "--url", url,
                                "--runs", ",".join(wind_runs()), "--out", str(out)], cwd=ROOT / "app", capture_output=True, text=True)
            if p.returncode == 0 and out.exists():
                wind = rank_wind(out)
            else:
                tail = (p.stdout + p.stderr).strip().splitlines()
                notes.append("palm_compare failed: " + (tail[-1] if tail else f"exit {p.returncode}"))
        if not args.skip_checks and CHECKS.exists():
            out = LOOP / f"checks-{now:%Y-%m-%d}.json"
            p = subprocess.run([sys.executable, str(CHECKS), "--url", url, "--out", str(out)], cwd=ROOT / "app",
                               capture_output=True, text=True)
            if p.returncode == 0 and out.exists():
                checks = json.loads(out.read_text(encoding="utf-8"))
            else:
                tail = (p.stdout + p.stderr).strip().splitlines()
                notes.append("checks_card failed: " + (tail[-1] if tail else f"exit {p.returncode}"))
    finally:
        server.kill()

    # a round compares with the last one only on the same runs: a run landing changes the card by itself
    scored = sorted(j["run"] for j in jobs)
    same = state.get("runs") == scored
    prev = state.get("card") if same else None
    added = sorted(set(scored) - set(state.get("runs", [])))
    lines = [f"# PALM loop, {now:%Y-%m-%d %H:%M}", "",
             f"Scored **{st['commit']}** ({args.ref}: what hunt-dev serves), HD pinned. Test set v{ts['version']}, "
             f"{len(jobs)} runs scored, {len(pending)} pending.", ""]
    lines += ["## What landed since the last round", ""] + ([f"- {x}" for x in landed] or ["- nothing"]) + [""]
    if cardv:
        def d(k):
            return f" ({cardv[k] - prev[k]:+.2f} on the last round)" if prev and k in prev else ""

        def di(k):
            return f" ({cardv[k] - prev[k]:+d} on the last round)" if prev and k in prev else ""

        ref_note = ("same runs as the last round (one held-out sector, about ±0.04, is noise)" if same else
                    f"**the runs scored changed** ({len(scored)} now; new: {', '.join(added) or 'none'}), so this round is the "
                    f"new reference and nothing is compared (baseline v2 on {BASELINE} scored 8 runs: 0.50 / 0.65, 5 misses)")
        lines += ["## The scent card (v2)", "", f"- {ref_note}",
                  f"- **Tongue threat:** {cardv['tune']:.2f} tune{d('tune')}, {cardv['held']:.2f} held out{d('held')}",
                  f"- **Misses:** {cardv['misses']}{di('misses')}. **Tongue false alarms:** {cardv['fa']}{di('fa')}. "
                  f"**Shade only:** {cardv['shade']}",
                  f"- **Misses by name:** {', '.join(cardv['miss_list']) or 'none'}",
                  "- **Weakest situations:** " + "; ".join(f"{k} {v:.2f}" for k, v in sorted(cardv["by_situation"].items(), key=lambda kv: kv[1])[:4]),
                  ""]
    if wind:
        lines += ["## The wind against PALM (head height, forced to PALM's 10 m air)", "",
                  f"- **Overall:** {wind['within45']:.0%} of {wind['points']:,} points within 45°"
                  + (f" (left out while their rows are checked: {', '.join(sorted(WIND_SUSPECT))})" if WIND_SUSPECT else ""), "",
                  "| situation | points | within 45° | PALM's reversals found |", "|---|---|---|---|"]
        for w in wind["worst"]:
            rr = "-" if w["reversed_recall"] is None else f"{w['reversed_recall']:.0%}"
            lines.append(f"| {w['situation']} | {w['n']:,} | {w['within45']:.0%} | {rr} |")
        lines += [""]
    lines += ["## The checks card (the felt wind)", ""]
    if checks:
        pc = state.get("checks") or {}
        lines += ["| set | checks | within 45° | honest spread within 1 sd (bar 60-80%) | shown within 1 sd |", "|---|---|---|---|---|"]
        for name, s in checks.items():
            if not isinstance(s, dict) or "skipped" in s:
                lines.append(f"| {name} | skipped: {s.get('skipped') if isinstance(s, dict) else s} | | | |")
                continue

            def cd(k, s=s, name=name):
                old = (pc.get(name) or {}).get(k)
                return f" ({s[k] - old:+.0%})" if isinstance(old, (int, float)) and isinstance(s.get(k), (int, float)) else ""
            lines.append(f"| {name} | {s.get('n')} | {s.get('within45', 0):.0%}{cd('within45')} | "
                         f"{s.get('honestWithin1sd', 0):.0%}{cd('honestWithin1sd')} | {s.get('shownWithin1sd', 0):.0%} |")
        lines.append("")
    else:
        lines += ["- not run this round", ""]
    lines += ["## The towers card (forest over open ground at head height, Sep-Nov)", ""]
    towers = None
    if TOWERS.exists():
        tp = LOOP / f"towers-{now:%Y-%m-%d}.json"
        p = subprocess.run([sys.executable, str(TOWERS), "--out", str(tp)], cwd=ROOT, capture_output=True, text=True)
        if p.returncode == 0 and tp.exists():
            towers = json.loads(tp.read_text(encoding="utf-8"))
    rows = towers if isinstance(towers, list) else (towers or {}).get("pairs", [])
    if rows:
        lines += ["| pair | forest / open | n | Sep / Oct / Nov | the app |", "|---|---|---|---|---|"]
        for t in rows:
            bm = t.get("byMonth") or {}

            def month(k, bm=bm):
                v = bm.get(k)
                v = v.get("ratio") if isinstance(v, dict) else v   # {"ratio": r, "n": n}
                return f"{v:.2f}" if isinstance(v, (int, float)) else "-"
            months = " / ".join(month(k) for k in ("9", "10", "11"))
            app = f"{t['app_ratio']:.2f}" if isinstance(t.get("app_ratio"), (int, float)) else (t.get("app_note") or "-")
            lines.append(f"| {t.get('pair')} | {t.get('ratio', 0):.3f} | {t.get('n', 0):,} | {months} | {app} |")
        lines.append("")
    else:
        lines += ["- not run this round", ""]
    lines += ["## The floor against the towers (in-stand floor over canopy top, held out)", ""]
    floor = None
    if FLOOR.exists():
        fp = LOOP / f"floor-{now:%Y-%m-%d}.json"
        p = subprocess.run([sys.executable, str(FLOOR), "--json", str(fp)], cwd=ROOT, capture_output=True, text=True)
        if p.returncode == 0 and fp.exists():
            floor = json.loads(fp.read_text(encoding="utf-8"))
    if floor:
        lines += [f"- {floor.get('towers', '?')} towers; the bar for a floor rule: beat the app now and the constant "
                  f"(beats the app now: {floor.get('beatsAppNow')}, beats the constant: {floor.get('beatsConstant')})",
                  "| rule | within 2× | calm called (the towers measure it) |", "|---|---|---|"]
        for k in ("appNow", "appOld", "constant", "candidate"):
            r = floor.get(k) or {}
            w2, cc, cm = r.get("within2"), r.get("calmCalled"), r.get("calmMeasured")
            w2s = f"{w2:.0%}" if isinstance(w2, (int, float)) else "-"
            calm = (f"{cc:.0%} ({cm:.0%})" if isinstance(cc, (int, float)) and isinstance(cm, (int, float))
                    else f"gap {r['calmGap']:+.2f}" if isinstance(r.get("calmGap"), (int, float)) else "-")
            lines.append(f"| {k} | {w2s} | {calm} |")
        checked = floor.get("refChecked") or {}
        lines += ["", f"- 'Top' is above the canopy, not a forecast 10 m: {len(checked)} towers checked against HRRR/ERA5 so far.", ""]
    else:
        lines += ["- not run this round", ""]
    lines += ["## Proposals (nothing is queued or shipped by the loop)", ""]
    if wind and wind["worst"]:
        top = wind["worst"][:2]
        lines += [f"- **For the rule builder (direction first):** {top[0]['situation']} ({top[0]['within45']:.0%} within 45°)"
                  + (f", then {top[1]['situation']} ({top[1]['within45']:.0%})" if len(top) > 1 else "") + "."]
        lines += [f"- **A PALM run that would teach most:** another {top[0]['situation'].split(',')[0]} run where "
                  f"{top[0]['situation'].split(',', 1)[1].strip()} decides it, with a different wind; booked by the owner "
                  "in the doc's question table before it's queued."]
    else:
        lines += ["- none this round (no wind ranking)"]
    lines += [""]
    if notes:
        lines += ["## Notes", ""] + [f"- {n}" for n in notes] + [""]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        ps.show()
    lines += ["## The queue", "", "```", buf.getvalue().rstrip(), "```", ""]
    rep = REPORTS / f"{now:%Y-%m-%d}.md"
    rep.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    state.update(at=time.time(), ref=st["commit"], runs=scored,
                 card=({k: cardv[k] for k in ("tune", "held", "misses", "fa", "shade")} if cardv else prev),
                 wind=({"within45": wind["within45"]} if wind else state.get("wind")),
                 checks=(checks if checks else state.get("checks")))
    state_p.write_text(json.dumps(state, indent=1), encoding="utf-8")
    print(f"-> {rep}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
