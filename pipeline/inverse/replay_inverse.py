"""Replay every check through the classes (docs/INVERSE.md).

    py -3.14 pipeline/inverse/build_params.py      # first: params.json
    py -3.14 pipeline/inverse/replay_inverse.py

For each felt check:
- check-free: the prior from its parameters (and the treetops, when a seen
  check is within 30 min and 1 km): the wind the phone would show before
  any felt check;
- causal: the same with the earlier felt checks of the sit (same spot,
  400 m, 90 min: class and ambient; 400 m to 2.5 km: the ambient only);
- loo: the other checks of the hour both ways, like app/scripts/replay.py
  --loo, so it sits beside the app's blend and fit like for like;
- memory: causal plus the classes other days' checks here found, in the same
  situation (the class-based key, and the app's key of today for contrast);
- palm: causal with PALM's stable Searchmont run in the prior (the dusk
  checks only);
- after the check: the posterior, the class it picks, whether it would say
  "check again", and the Sharpen ask (the observation worth the most bits).

Writes pipeline/raw/inverse/replay.csv, replay.md and summary.json.
"""

from __future__ import annotations

import csv
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from classes import (  # noqa: E402
    CONFIG,
    BAND_RANGE,
    BANDS,
    CLASSES,
    NC,
    NT,
    PRIOR_RULES,
    SHORT,
    TABLE,
    THETA,
    CheckModel,
    angdiff,
    coupled_dir,
    info_gain,
    seen_loglik,
)
from build_params import AREAS as AREA_DIRS, RAW, ROOT as ROOT_DIR, TZ, metres, sun_position  # noqa: E402
from habfile import read_hab  # noqa: E402

SAME_M = 400.0  # a check speaks for the class within this
AMB_M = 2500.0  # and for the ambient within this
WIN_MIN = 90.0  # a sit's window
TAU_MIN = 60.0
LEN_M = 150.0
SEEN_WIN = 30.0  # the brief's window for the treetops beside a floor check
CHECK_AGAIN_RATIO = 0.5  # second class at half the first's posterior or more
CHECK_AGAIN_DEG = 45.0  # and the two would show the wind 45 deg or more apart
SHARPEN_MIN_BITS = 0.15
MEMORY_GAMMA = 1.0
MEMORY_ALPHA = 0.5
MEMORY_LEN = 100.0
MEMORY_MAX_M = 400.0


def sigma_models(P: list[dict]) -> dict:
    """The model's own spread at each check with no checks in: the first check
    of its sit carries it (the call saved with a later one carries the blend's
    quarrel); the GPX's from the 2026-10-07 baseline replay (raw rules)."""
    out = {}
    felt = [r for r in P if not r["seen"]]
    for r in felt:
        if r["set"] == "gpx":
            out[r["id"]] = r.get("baseSigma") or 45.0
            continue
        cur = r
        while True:
            prev = [o for o in felt if o["set"] == "d1" and 0 < cur["ts"] - o["ts"] <= 3 * 3600_000 and metres(cur["lat"], cur["lon"], o["lat"], o["lon"]) <= SAME_M]
            if not prev:
                break
            cur = max(prev, key=lambda o: o["ts"])
        out[r["id"]] = cur.get("loggedSigma") or 45.0
    return out


def day_part(r: dict) -> str:
    """The app's situation key's day part (model.ts, the place's memory)."""
    el = r["sunEl"]
    if el < -6:
        return "night"
    if el < 8:
        return "morning" if datetime.fromtimestamp(r["ts"] / 1000, TZ).hour < 12 else "evening"
    return "day"


def stab_bin(m: CheckModel) -> str:
    if m.d["S"] >= 0.4:
        return "stable"
    if m.d["Cv"] >= 0.3:
        return "convective"
    return "neutral"


def speed_bin(F: float) -> str:
    return "weak" if F < 8 else "moderate" if F <= 20 else "strong"


def same_situation(a: dict, ma: CheckModel, b: dict, mb: CheckModel, key: str) -> float:
    """Likeness of two checks' situations, 0..1."""
    dd = angdiff(a["forecastDir"], b["forecastDir"])
    if key == "app":
        # forecast within 45 (full within 15), speed within x2.5 (full within x1.5), same day part
        if dd > 45 or day_part(a) != day_part(b):
            return 0.0
        q = max(a["forecastKmh"], 0.5) / max(b["forecastKmh"], 0.5)
        lr = abs(math.log(q))
        if lr > math.log(2.5):
            return 0.0
        f_dir = 1.0 if dd <= 15 else 1 - (dd - 15) / 30
        f_spd = 1.0 if lr <= math.log(1.5) else 1 - (lr - math.log(1.5)) / (math.log(2.5) - math.log(1.5))
        return f_dir * f_spd
    # the class key: the stability class, the ambient's sector, the speed band
    if dd > 45 or stab_bin(ma) != stab_bin(mb) or speed_bin(a["forecastKmh"]) != speed_bin(b["forecastKmh"]):
        return 0.0
    return 1.0 if dd <= 22.5 else 1 - (dd - 22.5) / 22.5


def normalise(logp: np.ndarray) -> np.ndarray:
    p = np.exp(logp - logp.max())
    return p / p.sum()


def amb_loglik(m: CheckModel, ll: np.ndarray) -> np.ndarray:
    """A felt check far off speaks for the ambient only: its likelihood with the class summed out under its own prior."""
    pc = m.prior / m.prior.sum(axis=0, keepdims=True)
    return np.log((pc * np.exp(ll)).sum(axis=0) + 1e-300)


def band_of(kmh) -> str | None:
    if kmh is None or kmh == "":
        return None
    for b in BANDS:
        lo, hi = BAND_RANGE[b]
        if lo <= float(kmh) < hi:
            return b
    return "windy"


def mode_of(m: CheckModel, post: np.ndarray) -> float:
    """The wind the phone would show for a belief: the mixture's mode (v1), or the most likely class's own."""
    from classes import GRID

    if CONFIG["display"] == "topClass":
        return m.class_mode(post, int(np.argmax(post.sum(axis=1))))
    return float(GRID[int(np.argmax(m.predictive(post)))])


def run(write: bool = True) -> dict:
    P = json.loads((RAW / "params.json").read_text(encoding="utf-8"))
    sig = sigma_models(P)
    felt = [r for r in P if not r["seen"]]
    seen = [r for r in P if r["seen"]]
    models = {r["id"]: CheckModel(r, sig[r["id"]]) for r in felt}
    lls = {r["id"]: models[r["id"]].loglik(r) for r in felt}
    seen_ll = {s["id"]: seen_loglik(s) for s in seen}
    # each check's own posterior class, for the memory
    own_post = {}
    for r in felt:
        m = models[r["id"]]
        own_post[r["id"]] = normalise(np.log(m.prior) + lls[r["id"]]).sum(axis=1)

    rows = []
    for r in felt:
        k = r["id"]
        m = models[k]
        base = np.log(m.prior)

        def with_seen(lp, win):
            used = []
            for s in seen:
                dmin = abs(r["ts"] - s["ts"]) / 60_000
                if dmin <= win and metres(r["lat"], r["lon"], s["lat"], s["lon"]) <= 1000:
                    lp = lp + seen_ll[s["id"]][None, :]
                    used.append(s["id"])
            return lp, used

        def with_sit(lp, both_ways: bool):
            n = 0
            for o in felt:
                if o["id"] == k or o["ts"] == r["ts"]:
                    continue
                dt = (r["ts"] - o["ts"]) / 60_000
                if (dt <= 0 and not both_ways) or abs(dt) > WIN_MIN:
                    continue
                d = metres(r["lat"], r["lon"], o["lat"], o["lon"])
                w_t = math.exp(-abs(dt) / TAU_MIN)
                if d <= SAME_M:
                    lp = lp + w_t * math.exp(-d / LEN_M) * lls[o["id"]]
                    n += 1
                elif d <= AMB_M:
                    lp = lp + (w_t * math.exp(-d / AMB_M) * amb_loglik(models[o["id"]], lls[o["id"]]))[None, :]
                    n += 1
            return lp, n

        def with_memory(lp, key: str):
            acc = np.zeros(NC)
            wsum = 0.0
            for o in felt:
                if datetime.fromtimestamp(o["ts"] / 1000, TZ).date() == datetime.fromtimestamp(r["ts"] / 1000, TZ).date():
                    continue
                d = metres(r["lat"], r["lon"], o["lat"], o["lon"])
                if d > MEMORY_MAX_M:
                    continue
                like = same_situation(r, m, o, models[o["id"]], key)
                if like <= 0:
                    continue
                w = like * math.exp(-d / MEMORY_LEN)
                acc += w * own_post[o["id"]]
                wsum += w
            if wsum <= 0:
                return lp, 0.0
            mem = (MEMORY_ALPHA + acc) / (MEMORY_ALPHA * NC + wsum)
            return lp + MEMORY_GAMMA * np.log(mem)[:, None], wsum

        lp0, seen_used = with_seen(base, SEEN_WIN)
        lp60, seen60 = with_seen(base, 60.0)
        p_free = normalise(lp0)
        p_free60 = normalise(lp60)
        lpc, n_sit = with_sit(lp0, False)
        p_causal = normalise(lpc)
        lpl, n_loo = with_sit(lp0, True)
        p_loo = normalise(lpl)
        lpm, mem_w = with_memory(lpc, "class")
        p_mem = normalise(lpm)
        lpa, mem_w_app = with_memory(lpc, "app")
        p_mem_app = normalise(lpa)
        # PALM's stable run: the dusk of 2026-10-10 under the SSE forecast it was run for
        palm = (r.get("palm") or {}).get("searchmont_stable")
        p_palm = None
        palm_model = None
        if palm and r["local"].startswith("2026-10-10") and angdiff(r["forecastDir"], 152) <= 30:
            palm_model = CheckModel(r, sig[k], palm=palm)
            lpp, _ = with_seen(np.log(palm_model.prior), SEEN_WIN)
            lpp, _ = with_sit(lpp, False)
            p_palm = normalise(lpp)
        # after the check
        post = normalise(lpc + lls[k])
        pc = post.sum(axis=1)
        order = np.argsort(-pc)
        c1, c2 = int(order[0]), int(order[1])
        m1, m2 = m.class_mode(post, c1), m.class_mode(post, c2)
        ratio = pc[c2] / pc[c1]
        b1 = BANDS.index(max(m.bands[c1], key=m.bands[c1].get))
        b2 = BANDS.index(max(m.bands[c2], key=m.bands[c2].get))
        again_margin = ratio >= CHECK_AGAIN_RATIO
        again = again_margin and (angdiff(m1, m2) >= CHECK_AGAIN_DEG or abs(b1 - b2) >= 2)
        ig = info_gain(m, post)
        ask = max(ig, key=ig.get)
        sharpen = ask if (again or max(ig.values()) >= SHARPEN_MIN_BITS) else ""

        pf = p_free.sum(axis=1)
        row = {
            "id": k,
            "set": r["set"],
            "area": r["area"],
            "place": r["place"],
            "local": r["local"],
            "feltDir": r["dirFrom"],
            "feltStrength": r["strength"],
            "puffs": r["puffs"],
            "swing": r.get("swingDeg") or "",
            "forecastDir": round(r["forecastDir"]),
            "forecastKmh": round(r["forecastKmh"], 1),
            "forecastSrc": r["forecastSrc"],
            "stable": round(r["stable"], 2),
            "S": round(m.d["S"], 2),
            "convective": round(r["convective"], 2),
            "dTheta": round(r["dTheta"], 2),
            "ri": round(r["ri"], 2),
            "sunEl": round(r["sunEl"], 1),
            "minFromSunset": round(r["minFromSunset"]) if r["minFromSunset"] is not None else "",
            "stabBin": stab_bin(m),
            "aloftKmh": round(m.d["above"]["aloft"], 1),
            "aloftSrc": m.d["above"]["aloftSrc"],
            "riAbove": round(m.d["above"]["ri"], 2),
            "smearRow": m.d["above"]["row"] if m.d["canopyFloor"] else "",
            "sloped": round(m.d["sloped"], 2),
            "treeH": round(r["treeH"]),
            "rel": r["rel"],
            "landform": r["landform"],
            "slot": "y" if r.get("slot") else "",
            "chan": round(m.d["chan"], 2),
            "hUpFc": round(r["terrain"]["hUp"][int(round(r["forecastDir"] / 10)) % 36], 1),
            "sigmaModel": round(sig[k]),
            "terrainDir": round(coupled_dir(r, r["forecastDir"])[0]),
            "loggedDir": None if r["loggedDir"] is None else round(r["loggedDir"]),
            "loggedRegime": r.get("loggedRegime", ""),
            "rawDir": r.get("rawDir"),
            "rawRegime": r.get("rawRegime", ""),
            "blendDir": r.get("blendDir"),
            "fitDir": r.get("fitDir"),
            "priorTop": CLASSES[int(np.argmax(pf))],
            "priorP": round(float(pf.max()), 2),
            "prior": " ".join(f"{SHORT[CLASSES[c]]}{pf[c]:.2f}" for c in np.argsort(-pf)[:3]),
            "freeDir": round(mode_of(m, p_free)),
            "free60Dir": round(mode_of(m, p_free60)),
            "seenUsed": ",".join(seen_used),
            "seen60": ",".join(seen60),
            "causalDir": round(mode_of(m, p_causal)),
            "nSit": n_sit,
            "looDir": round(mode_of(m, p_loo)),
            "nLoo": n_loo,
            "memDir": round(mode_of(m, p_mem)),
            "memW": round(mem_w, 2),
            "memAppDir": round(mode_of(m, p_mem_app)),
            "memAppW": round(mem_w_app, 2),
            "palmDir": round(mode_of(palm_model, p_palm)) if p_palm is not None else "",
            "palmPrior": " ".join(f"{SHORT[CLASSES[c]]}{p_palm.sum(axis=1)[c]:.2f}" for c in np.argsort(-p_palm.sum(axis=1))[:3]) if p_palm is not None else "",
            "palmPost": " ".join(f"{SHORT[CLASSES[c]]}{pp[c]:.2f}" for c in np.argsort(-pp)[:3]) if (p_palm is not None and (pp := normalise(np.log(p_palm) + lls[k]).sum(axis=1)) is not None) else "",
            "speedBand": m.speed_band(p_causal),
            "freeBand": m.speed_band(p_free),
            "rawBand": band_of(r.get("rawKmh")),
            "loggedBand": band_of(r.get("loggedKmh")),
            "lat": r["lat"],
            "lon": r["lon"],
            "ts": r["ts"],
            "postClass": CLASSES[c1],
            "postP": round(float(pc[c1]), 2),
            "post2": CLASSES[c2],
            "post2P": round(float(pc[c2]), 2),
            "post": " ".join(f"{SHORT[CLASSES[c]]}{pc[c]:.2f}" for c in order[:3]),
            "postDir": round(mode_of(m, post)),
            "againMargin": "y" if again_margin else "",
            "checkAgain": "y" if again else "",
            "sharpen": sharpen,
            "bitsPuff": round(ig["puff"], 2),
            "bitsTreetops": round(ig["treetops"], 2),
        }
        rows.append(row)

    # ---------------------------------------------------------------- scores
    def miss(a, b):
        return None if a is None or b is None or b == "" else angdiff(float(a), float(b))

    SOURCES = [
        ("forecast", "forecastDir"),
        ("terrain call (grid, forecast in)", "terrainDir"),
        ("app logged (at the time)", "loggedDir"),
        ("app raw rules (replay)", "rawDir"),
        ("app blend (replay, others of the day)", "blendDir"),
        ("app fit + blend (replay)", "fitDir"),
        ("classes: check-free", "freeDir"),
        ("classes: causal sit", "causalDir"),
        ("classes: hour both ways (like the blend)", "looDir"),
        ("classes: causal + memory (class key)", "memDir"),
        ("classes: causal + memory (app key)", "memAppDir"),
    ]

    def score(sub, col):
        ms = [miss(x["feltDir"], x[col]) for x in sub]
        ms = [v for v in ms if v is not None]
        if not ms:
            return None
        return {"n": len(ms), "within45": sum(v <= 45 for v in ms) / len(ms), "median": statistics.median(ms)}

    directional = [x for x in rows if x["feltDir"] is not None]
    groups = {
        "all": directional,
        "Pickle (GPX, 8-point)": [x for x in directional if x["set"] == "gpx"],
        "Searchmont": [x for x in directional if x["area"] == "searchmont"],
        "Searchmont ridge": [x for x in directional if x["place"] == "searchmont top"],
        "Searchmont floor": [x for x in directional if x["place"] == "searchmont floor"],
        "Sault test": [x for x in directional if x["area"] == "sault-test"],
        "Pickle low sun (under 12°)": [x for x in directional if x["set"] == "gpx" and float(x["sunEl"]) < 12],
        "stable (S >= 0.4)": [x for x in directional if x["stabBin"] == "stable"],
        "convective": [x for x in directional if x["stabBin"] == "convective"],
        "neutral": [x for x in directional if x["stabBin"] == "neutral"],
    }
    table = {g: {name: score(sub, col) for name, col in SOURCES} for g, sub in groups.items()}

    # by the class the posterior picks
    by_class = {}
    for c in CLASSES:
        sub = [x for x in directional if x["postClass"] == c]
        if sub:
            by_class[c] = {"n": len(sub), **{name: score(sub, col) for name, col in SOURCES if col in ("forecastDir", "loggedDir", "rawDir", "blendDir", "freeDir", "causalDir", "looDir")}}
    by_prior = Counter(x["priorTop"] for x in rows)
    by_post = Counter(x["postClass"] for x in rows)
    cross = defaultdict(Counter)
    for x in rows:
        cross[x["rawRegime"] or x["loggedRegime"] or "-"][x["postClass"]] += 1
    again_n = sum(x["checkAgain"] == "y" for x in rows)
    margin_n = sum(x["againMargin"] == "y" for x in rows)
    sharpen_n = Counter(x["sharpen"] for x in rows if x["sharpen"])
    # head to head, like for like: (classes column, app column)
    def h2h(ca, cb):
        win, lose, both, neither = [], [], 0, 0
        for x in directional:
            a, b = miss(x["feltDir"], x[ca]), miss(x["feltDir"], x[cb])
            if a is None or b is None:
                continue
            if a <= 45 < b:
                win.append(x)
            elif b <= 45 < a:
                lose.append(x)
            elif a <= 45:
                both += 1
            else:
                neither += 1
        return {"win": len(win), "lose": len(lose), "both": both, "neither": neither,
                "wins": [(x["local"], x["place"], x["feltDir"], x[ca], x[cb], x["postClass"]) for x in win],
                "losses": [(x["local"], x["place"], x["feltDir"], x[ca], x[cb], x["postClass"]) for x in lose]}

    heads = {
        "check-free vs app raw rules": h2h("freeDir", "rawDir"),
        "check-free vs forecast": h2h("freeDir", "forecastDir"),
        "causal sit vs app logged": h2h("causalDir", "loggedDir"),
        "hour both ways vs app blend": h2h("looDir", "blendDir"),
        "hour both ways vs app fit": h2h("looDir", "fitDir"),
    }

    # the noise floor: two felt checks at one spot within 5 minutes, and the puffs of one check
    pairs = []
    for i, a in enumerate(directional):
        for b in directional[i + 1:]:
            if abs(a["ts"] - b["ts"]) <= 5 * 60_000 and metres(a["lat"], a["lon"], b["lat"], b["lon"]) <= 100:
                pairs.append(angdiff(a["feltDir"], b["feltDir"]))
    for r in felt:
        ds = [d for d in (r.get("dirs") or []) if d is not None]
        for i, a in enumerate(ds):
            for b in ds[i + 1:]:
                pairs.append(angdiff(a, b))
    noise = {"pairs": len(pairs), "within45": (sum(v <= 45 for v in pairs) / len(pairs)) if pairs else None, "median": statistics.median(pairs) if pairs else None, "misses": sorted(round(v) for v in pairs)}

    # speed: the felt word against each call's band, within one band
    for x in rows:
        x["forecastBand"] = band_of(x["forecastKmh"])

    def band_score(col):
        ok = n = exact = 0
        for x in rows:
            b = x[col]
            if not b:
                continue
            n += 1
            d = abs(BANDS.index(b) - BANDS.index(x["feltStrength"]))
            ok += d <= 1
            exact += d == 0
        return {"n": n, "within1": ok / n if n else None, "exact": exact / n if n else None}

    speed = {"forecast (10 m)": band_score("forecastBand"), "app raw rules": band_score("rawBand"), "app logged": band_score("loggedBand"), "classes check-free": band_score("freeBand"), "classes causal": band_score("speedBand")}

    # did a "check again" resolve on the next check here (within 20 min, 150 m)?
    resolved = unresolved = no_next = 0
    for i, x in enumerate(rows):
        if x["checkAgain"] != "y":
            continue
        nxt = [y for y in rows[i + 1:] if 0 < y["ts"] - x["ts"] <= 20 * 60_000 and metres(x["lat"], x["lon"], y["lat"], y["lon"]) <= 150]
        if not nxt:
            no_next += 1
            continue
        y = nxt[0]
        if y["post2P"] / max(y["postP"], 1e-9) < CHECK_AGAIN_RATIO:
            resolved += 1
        else:
            unresolved += 1
    again_followup = {"resolved": resolved, "stillAmbiguous": unresolved, "noNextCheck": no_next}
    palm_rows = [x for x in rows if x["palmDir"] != ""]

    summary = {
        "n": len(P),
        "felt": len(felt),
        "seen": len(seen),
        "directional": len(directional),
        "table": table,
        "byClass": by_class,
        "priorTop": dict(by_prior),
        "postClass": dict(by_post),
        "appRegimeVsClass": {k: dict(v) for k, v in cross.items()},
        "checkAgain": again_n,
        "checkAgainMarginOnly": margin_n,
        "checkAgainFollowup": again_followup,
        "sharpen": dict(sharpen_n),
        "headToHead": heads,
        "noiseFloor": noise,
        "speed": speed,
        "palm": [{k2: x[k2] for k2 in ("id", "local", "feltDir", "feltStrength", "prior", "palmPrior", "freeDir", "free60Dir", "seen60", "causalDir", "palmDir", "post", "palmPost")} for x in palm_rows],
        "config": dict(CONFIG),
        "constants": {"SAME_M": SAME_M, "AMB_M": AMB_M, "WIN_MIN": WIN_MIN, "TAU_MIN": TAU_MIN, "LEN_M": LEN_M, "SEEN_WIN": SEEN_WIN, "CHECK_AGAIN_RATIO": CHECK_AGAIN_RATIO, "CHECK_AGAIN_DEG": CHECK_AGAIN_DEG, "SHARPEN_MIN_BITS": SHARPEN_MIN_BITS, "MEMORY_GAMMA": MEMORY_GAMMA},
    }
    if not write:
        return summary
    pair_res, pair_md = pair_speed(rows, P)
    summary["pairSpeed"] = pair_res
    (RAW / "summary.json").write_text(json.dumps(summary, indent=1, default=str), encoding="utf-8")

    out_cols = [c for c in rows[0].keys() if c not in ("lat", "lon")]
    with open(RAW / "replay.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=out_cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    # ---------------------------------------------------------------- markdown
    def fmt(v):
        return "" if v is None or v == "" else (f"{v:.0f}" if isinstance(v, float) else str(v))

    md = ["# Inverse replay: every check through the classes", "", f"{len(P)} checks: {len(felt)} felt, {len(seen)} seen; {len(directional)} felt with a direction. Generated by pipeline/inverse/replay_inverse.py.", ""]
    md += ["## Agreement with the felt direction (within 45°, median miss)", ""]
    md += ["| | " + " | ".join(groups) + " |", "|---|" + "---|" * len(groups)]
    for name, _ in SOURCES:
        cells = []
        for g in groups:
            sc = table[g][name]
            cells.append("" if not sc else f"{sc['within45'] * 100:.0f}% · {sc['median']:.0f}° (n {sc['n']})")
        md.append(f"| {name} | " + " | ".join(cells) + " |")
    md += ["", f"Noise floor (two felt readings at one spot within 5 min, or two puffs of one check): {noise['pairs']} pairs, {noise['within45'] * 100:.0f}% within 45°, median {noise['median']:.0f}°.", ""]
    md += [f"Check again (top two within {CHECK_AGAIN_RATIO:.0%} and {CHECK_AGAIN_DEG:.0f}° apart, after the check): {again_n} of {len(rows)}; on the margin alone: {margin_n}. Followed by a check within 20 min: {again_followup}. Sharpen asks: {dict(sharpen_n)}.", ""]
    md += ["## Head to head (within 45°: classes only / app only / both / neither)", ""]
    for k2, v in heads.items():
        md.append(f"- {k2}: {v['win']} / {v['lose']} / {v['both']} / {v['neither']}")
    md += ["", "## Speed (felt word against each call's band)", ""]
    for k2, v in speed.items():
        md.append(f"- {k2}: within one band {v['within1'] * 100:.0f}%, exact {v['exact'] * 100:.0f}% (n {v['n']})")
    md += ["", "## Per check", "", "Directions are FROM, degrees. prior/post: the top three classes (C coupled, CH channelled, D decoupled, K drainage, A upslope, B breeze, R rotor).", ""]
    cols = ["local", "place", "feltDir", "feltStrength", "forecastDir", "forecastKmh", "stabBin", "loggedDir", "rawDir", "blendDir", "fitDir", "freeDir", "causalDir", "looDir", "memDir", "prior", "post", "checkAgain", "sharpen"]
    md.append("| " + " | ".join(cols) + " |")
    md.append("|" + "---|" * len(cols))
    for x in rows:
        md.append("| " + " | ".join(fmt(x[c]) for c in cols) + " |")
    md += pair_md
    (RAW / "replay.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    # console
    print(f"{len(rows)} felt checks scored ({len(directional)} with a direction)")
    for g in ("all", "Pickle (GPX, 8-point)", "Pickle low sun (under 12°)", "Searchmont", "Searchmont ridge", "Searchmont floor", "Sault test", "stable (S >= 0.4)", "convective", "neutral"):
        print(f"\n{g}")
        for name, _ in SOURCES:
            sc = table[g][name]
            if sc:
                print(f"  {name:44s} {sc['within45'] * 100:4.0f}%  median {sc['median']:5.0f}  n {sc['n']}")
    print(f"\nnoise floor {noise}")
    print(f"check again {again_n}/{len(rows)} (margin only {margin_n}); followup {again_followup}; sharpen {dict(sharpen_n)}")
    print("prior top:", dict(by_prior))
    print("post class:", dict(by_post))
    for k2, v in heads.items():
        print(f"{k2}: win {v['win']} lose {v['lose']} both {v['both']} neither {v['neither']}")
    print("speed:", {k2: (round(v["within1"], 2), round(v["exact"], 2)) for k2, v in speed.items()})
    for p_ in summary["palm"]:
        print("palm:", p_)
    return summary


# ---------------------------------------------------------------- the speed-fix pair (offline variant)
#
# The station thread's corrected speed above the canopy (pipeline/raw/inverse/pair-speed.csv:
# wsTop, the open 10 m speed carried to just above the canopy by the bake's roughness ratio;
# wsTopAlt = corrected10Kmh / 3.6, a lower bound) fed to the tower floor model (LightGBM,
# pipeline/raw/towers/floor-models/sd_calm.txt and sd_logratio.txt, trained in
# pipeline/towers/floor.py on SMEAR II, NEON and AmeriFlux towers). Head-height speed =
# wsTop x exp(logratio) x 3.6 km/h; the band is calm where p_calm >= 0.5, else the speed's.
# Direction untouched. The canopy features are floor.py's SD grade: ETH Global Canopy Height
# 2020 (10 m) and Hansen GFC-2024 cover after loss (30 m), read the way
# pipeline/towers/canopy_sites.py reads them, at each check.

FLOOR_MODELS = ROOT_DIR / "pipeline" / "raw" / "towers" / "floor-models"
PAIR_CSV = RAW / "pair-speed.csv"
SD_CANOPY = RAW / "sd-canopy.json"
PAIR_CALM_P = 0.5


def sd_canopy(P: list[dict]) -> dict:
    """ETH height and Hansen closure stats at each check (floor.py grade_of), cached."""
    cache = json.loads(SD_CANOPY.read_text(encoding="utf-8")) if SD_CANOPY.exists() else {}
    todo = [r for r in P if r["id"] not in cache]
    if not todo:
        return cache
    sys.path.insert(0, str(ROOT_DIR / "pipeline" / "towers"))
    import canopy_sites as cs
    from pyproj import Transformer
    from rasterio.crs import CRS

    crs = CRS.from_epsg(32616)  # every check is in UTM 16N (-90 to -84)
    fwd = Transformer.from_crs(4326, 32616, always_xy=True)
    inv = Transformer.from_crs(32616, 4326, always_xy=True)
    half = 2600.0
    clusters: dict[tuple, list[dict]] = defaultdict(list)
    for r in todo:
        x, y = fwd.transform(r["lon"], r["lat"])
        clusters[(round(x / 2500.0), round(y / 2500.0))].append(r)
    for key, rs in clusters.items():
        xs = [fwd.transform(r["lon"], r["lat"]) for r in rs]
        tx, ty = float(np.mean([p[0] for p in xs])), float(np.mean([p[1] for p in xs]))
        w, s = inv.transform(tx - half, ty - half)
        e, n = inv.transform(tx + half, ty + half)
        print(f"  SD canopy: {len(rs)} checks round {n:.3f},{w:.3f}")
        H10 = cs.sd_grid([cs.ETH_URL.format(tile=t) for t in cs._eth_tiles(w, s, e, n)], crs, tx, ty, half, 10.0, nodata=255)
        TC = cs.sd_grid([cs.HANSEN_URL.format(layer="treecover2000", tile=t) for t in cs._hansen_tiles(w, s, e, n)], crs, tx, ty, half, 30.0)
        LY = cs.sd_grid([cs.HANSEN_URL.format(layer="lossyear", tile=t) for t in cs._hansen_tiles(w, s, e, n)], crs, tx, ty, half, 30.0)
        TCL = np.where((LY >= 1) & (LY <= 24), 0.0, TC).astype(np.float32)
        for r, (px, py) in zip(rs, xs):
            rec = {"source": "ETH 2020 10 m + Hansen GFC-2024 after loss 30 m"}
            if np.isfinite(H10).any():
                eth = cs.grid_stats(H10, tx - half, ty + half, 10.0, px, py, H10 < cs.OPEN_H)
                r100 = eth["by_radius"].get("100") or {}
                rec.update(h=r100.get("p90"), h_med=r100.get("tree_median"), edge_m=eth.get("edge_m"),
                           in_opening=float(bool(eth.get("tower_in_opening"))), fetch=eth.get("fetch_m"))
            if np.isfinite(TCL).any():
                han = cs.grid_stats(TCL, tx - half, ty + half, 30.0, px, py, TCL < 10, value="cover")
                rec.update(closure100=(han["by_radius"].get("100") or {}).get("closure"),
                           closure250=(han["by_radius"].get("250") or {}).get("closure"))
            cache[r["id"]] = rec
        SD_CANOPY.write_text(json.dumps(cache, indent=1), encoding="utf-8")
    return cache


def hours_since(ms: float, lat: float, lon: float) -> tuple[float, float]:
    """Hours since the last sunrise and the last sunset (upper limb, -0.833 deg), NaN past 30 h (floor.py)."""
    rise = sset = float("nan")
    prev = sun_position(ms, lat, lon)[0] + 0.833
    t = ms
    for _ in range(int(30 * 12)):
        t -= 300_000
        e = sun_position(t, lat, lon)[0] + 0.833
        # going back in time: below then above (now) is a rise; above then below is a set
        if e < 0 <= prev and math.isnan(rise):
            rise = (ms - t) / 3_600_000
        if e >= 0 > prev and math.isnan(sset):
            sset = (ms - t) / 3_600_000
        if not (math.isnan(rise) or math.isnan(sset)):
            break
        prev = e
    return rise, sset


def rose_at_bearing(fetch: dict | None, wd: float) -> float:
    if not fetch:
        return float("nan")
    v = sorted((float(k) % 360, float(x)) for k, x in fetch.items())
    if len(v) != 16:
        return float("nan")
    r = [x for _, x in v] + [v[0][1]]
    x = (wd % 360) / 22.5
    i = int(x) % 16
    f = x - int(x)
    return r[i] * (1 - f) + r[i + 1] * f


def pair_speed(rows: list[dict], P: list[dict]) -> tuple[dict, list[str]]:
    """The speed-fix pair's head-height speed and band per check, and the band scores."""
    import lightgbm as lgb

    if not PAIR_CSV.exists():
        return {}, []
    pair = {r["id"]: r for r in csv.DictReader(open(PAIR_CSV, encoding="utf-8"))}
    calm_m = lgb.Booster(model_file=str(FLOOR_MODELS / "sd_calm.txt"))
    lr_m = lgb.Booster(model_file=str(FLOOR_MODELS / "sd_logratio.txt"))
    feats = calm_m.feature_name()
    assert feats == lr_m.feature_name()
    byid = {r["id"]: r for r in P}
    can = sd_canopy([byid[x["id"]] for x in rows if x["id"] in pair])
    hab = {}
    for area, d in AREA_DIRS.items():
        hab[area] = read_hab(d / f"habitat-{area}.hab", want=["hardwood", "conifer"])[1]

    def num(v):
        try:
            x = float(v)
            return x if math.isfinite(x) else float("nan")
        except (TypeError, ValueError):
            return float("nan")

    X, X_alt, ids = [], [], []
    for x in rows:
        pr = pair.get(x["id"])
        if pr is None:
            continue
        r = byid[x["id"]]
        c = can.get(x["id"], {})
        rr, cc = r["cell"]
        hw, cf = float(hab[r["area"]]["hardwood"][rr, cc]), float(hab[r["area"]]["conifer"][rr, cc])
        decid = hw / (hw + cf) if hw + cf > 0 else float("nan")
        rise, sset = hours_since(r["ts"], r["lat"], r["lon"])
        wd = num(pr["sd10Dir"])
        slope = float(r["thSlope"])
        wvd = abs(((wd + 180 - r["thAspect"]) + 180) % 360 - 180) if (r["thAspect"] is not None and slope > 0 and math.isfinite(wd)) else float("nan")
        h = num(c.get("h"))
        f = dict(
            zeta_grad=float("nan"), cls_grad=num(pr["clsGrad"]), sun=float(r["sunEl"]),
            h_since_sunset=sset, h_since_sunrise=rise,
            month=datetime.fromtimestamp(r["ts"] / 1000, timezone.utc).month,
            decid=decid, slope=slope, wind_vs_downslope=wvd,
            sd_h=h, sd_h_med=num(c.get("h_med")), sd_closure100=num(c.get("closure100")), sd_closure250=num(c.get("closure250")),
            sd_edge_m=num(c.get("edge_m")), sd_fetch_up=rose_at_bearing(c.get("fetch"), wd), sd_in_opening=num(c.get("in_opening")),
            sd_ztop_rel=1.3, sd_zfloor_rel=(2.0 / h) if h > 0 else float("nan"),
        )
        X.append([num(pr["wsTop"]) if k == "ws_top" else f[k] for k in feats])
        X_alt.append([num(pr["wsTopAlt"]) if k == "ws_top" else f[k] for k in feats])
        ids.append(x["id"])
        x["sdH"] = None if not math.isfinite(h) else round(h, 1)
        x["sdClosure100"] = c.get("closure100")
    out = {}
    for tag, M in (("pair", np.array(X, float)), ("pairAlt", np.array(X_alt, float))):
        pc = calm_m.predict(M)
        lr = lr_m.predict(M)
        top = M[:, feats.index("ws_top")]
        kmh = top * np.exp(lr) * 3.6
        for i, k in enumerate(ids):
            out.setdefault(k, {})
            out[k][f"{tag}Kmh"] = round(float(kmh[i]), 2)
            out[k][f"{tag}PCalm"] = round(float(pc[i]), 2)
            out[k][f"{tag}Band"] = "calm" if pc[i] >= PAIR_CALM_P else band_of(kmh[i])
            out[k][f"{tag}SpeedBand"] = band_of(kmh[i])
    for x in rows:
        x.update(out.get(x["id"], {"pairKmh": "", "pairPCalm": "", "pairBand": "", "pairSpeedBand": "", "pairAltKmh": "", "pairAltPCalm": "", "pairAltBand": "", "pairAltSpeedBand": ""}))
        x["fitBand"] = band_of(byid[x["id"]].get("fitKmh"))

    scored = [x for x in rows if x["id"] in out]
    # under a stand by the area's own grid (ETH's p90 within 100 m is 5 m+ at every check: the trees round an opening count)
    forest = [x for x in scored if float(x["treeH"]) >= 8]
    opened = [x for x in scored if float(x["treeH"]) < 8]

    def bscore(sub, col):
        n = ok = ex = 0
        for x in sub:
            b = x.get(col)
            if not b:
                continue
            n += 1
            d = abs(BANDS.index(b) - BANDS.index(x["feltStrength"]))
            ok += d <= 1
            ex += d == 0
        return {"n": n, "within1": ok / n if n else None, "exact": ex / n if n else None}

    cols = [("app logged", "loggedBand"), ("app fit + blend (replay)", "fitBand"), ("classes v3 check-free", "freeBand"),
            ("classes v3 causal", "speedBand"), ("pair, wsTop", "pairBand"), ("pair, wsTop, speed only (no p_calm)", "pairSpeedBand"),
            ("pair, wsTopAlt", "pairAltBand"), ("pair, wsTopAlt, speed only", "pairAltSpeedBand")]
    groups = {"all": scored, "under stands (treeH 8 m+)": forest, "open (treeH under 8 m)": opened, "Pickle": [x for x in scored if x["set"] == "gpx"], "Searchmont + Sault": [x for x in scored if x["set"] == "d1"]}
    res = {g: {name: bscore(sub, col) for name, col in cols} for g, sub in groups.items()}
    felt_calm = [x for x in scored if x["feltStrength"] == "calm"]
    res["calmHits"] = {name: sum(1 for x in felt_calm if x.get(col) == "calm") for name, col in cols}
    res["calmCalls"] = {name: sum(1 for x in scored if x.get(col) == "calm") for name, col in cols}
    res["nFeltCalm"] = len(felt_calm)
    res["bandCounts"] = {name: dict(Counter(x.get(col) for x in scored)) for name, col in cols}
    res["bandCounts"]["felt"] = dict(Counter(x["feltStrength"] for x in scored))
    md = ["", "## The speed-fix pair (speed bands only; direction untouched)", "",
          f"{len(scored)} felt checks with a pair row, {len(forest)} under stands of 8 m or more (the area grid's treeH). Within one band / exact.", "",
          "| | " + " | ".join(groups) + " |", "|---|" + "---|" * len(groups)]
    for name, _ in cols:
        md.append(f"| {name} | " + " | ".join(f"{res[g][name]['within1'] * 100:.0f}% / {res[g][name]['exact'] * 100:.0f}% (n {res[g][name]['n']})" if res[g][name]["n"] else "" for g in groups) + " |")
    md += ["", f"Felt calm {len(felt_calm)}: called calm by " + ", ".join(f"{k} {v}" for k, v in res["calmHits"].items()) + ".", ""]
    return res, md


# The sensitivity runs: v1 is the table as designed before the replay; the
# rest change one thing each. "post hoc" marks a change thought of after
# seeing the replay, to be judged on new checks, not these.
VARIANTS = [
    ("v3: NEON median under canopy, slopes drain (as run)", {}),
    ("v2: SMEAR II under canopy (the sheltered bound)", {"floor": "smear", "slopeDrain": False}),
    ("v1: the hand rules", {"floor": "hand"}),
    ("v3 without the slope drainage rule", {"slopeDrain": False}),
    ("v3, the 5 m/s rule on HRDPS 10 m, not 80 m", {"topWind": "10m"}),
    ("v3, post hoc: the stable rows only after sunset", {"stableNightOnly": True}),
    ("no meander noise (every check speaks fully)", {"meander": 0.0}),
    ("meander = the model's full spread", {"meander": 1.0}),
    ("ambient prior without the station tail", {"ambTail": False}),
    ("post hoc: canopy shelters the floor's thermal flows", {"canopyMix": True}),
    ("the shown wind blurred by the meander (the first run's display)", {"displayMeander": True}),
    ("post hoc: the shown wind is the most likely class's own", {"display": "topClass"}),
]


def main() -> None:
    base = dict(CONFIG)
    sens = []
    for name, over in VARIANTS[1:]:
        CONFIG.clear()
        CONFIG.update(base, **over)
        sens.append((name, run(write=False)))
    CONFIG.clear()
    CONFIG.update(base)
    print("=" * 70)
    v1 = run(write=True)
    sens.insert(0, (VARIANTS[0][0], v1))
    lines = ["", "## Sensitivity (one change each; within 45° on all directional checks)", "", "| variant | check-free | causal sit | hour both ways | check again | Pickle check-free | Pickle low sun check-free | Pickle low sun causal | Searchmont check-free |", "|---|---|---|---|---|---|---|---|---|"]
    for name, sm in sens:
        t = sm["table"]

        def f(g, k):
            return f"{t[g][k]['within45'] * 100:.0f}%"

        lines.append(f"| {name} | {f('all', 'classes: check-free')} | {f('all', 'classes: causal sit')} | {f('all', 'classes: hour both ways (like the blend)')} | {sm['checkAgain']} | {f('Pickle (GPX, 8-point)', 'classes: check-free')} | {f('Pickle low sun (under 12°)', 'classes: check-free')} | {f('Pickle low sun (under 12°)', 'classes: causal sit')} | {f('Searchmont', 'classes: check-free')} |")
    with open(RAW / "replay.md", "a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    sj = json.loads((RAW / "summary.json").read_text(encoding="utf-8"))
    sj["sensitivity"] = {name: {"table": sm["table"]["all"], "checkAgain": sm["checkAgain"], "postClass": sm["postClass"]} for name, sm in sens}
    (RAW / "summary.json").write_text(json.dumps(sj, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
