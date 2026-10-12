"""The classes of what the air is doing at a hunter's spot, and the model
that weighs them against a check (docs/INVERSE.md).

The state is joint: the ambient direction (the air above the trees, the
fast state, on a 10 deg grid: THETA) and the class (what the place does with
it). The prior is P(class | ambient, the check's parameters) x P(ambient | the
forecast). A felt check's likelihood is its direction, its strength word,
and (when it has them) its swing and its "treetops moving while it's calm
here" flag. A seen check speaks to the ambient only.

Every number the classes use is in TABLE, PRIOR_RULES and the constants
below, and INVERSE.md carries the same table. Hand rules first, from the
physics in MICRO-WIND.md and the regimes in model.ts; nothing here is
fitted.
"""

from __future__ import annotations

import math

import numpy as np

CLASSES = ["coupled", "channelled", "decoupled", "drainage", "upslope", "breeze", "rotor"]
SHORT = {"coupled": "C", "channelled": "CH", "decoupled": "D", "drainage": "K", "upslope": "A", "breeze": "B", "rotor": "R"}
NC = len(CLASSES)
THETA = np.arange(0.0, 360.0, 10.0)  # the ambient FROM, degrees
NT = len(THETA)
GRID = np.arange(0.0, 360.0, 1.0)  # felt directions, for densities and modes

BANDS = ["calm", "drift", "light", "breezy", "windy"]
# windChecks.ts STRENGTH_RANGE, km/h
BAND_RANGE = {"calm": (0.0, 1.0), "drift": (1.0, 2.5), "light": (2.5, 6.0), "breezy": (6.0, 13.0), "windy": (13.0, 1e9)}
# windChecks.ts DIR_SIGMA: how well a puff that hard points
DIR_SIGMA = {"calm": 90.0, "drift": 50.0, "light": 35.0, "breezy": 28.0, "windy": 25.0}
SEEN_DIR_SIGMA = 30.0  # ambientFit.ts
EPS = 0.03  # every class keeps a floor in the prior
STRENGTH_UNIFORM = 0.10  # a strength word misread: spread over the five bands
MEANDER_SHARE = 0.5  # the share of the model's own check-free spread every class sees as meander

# Switches for the sensitivity runs (replay_inverse.py VARIANTS); v1 is the defaults.
CONFIG = {
    "meander": MEANDER_SHARE,  # the per-check noise: this share of the model's check-free spread
    "ambTail": True,  # the station-calibrated tail on the ambient prior
    "canopyMix": False,  # post hoc: under trees the floor's thermal flows are mixed by the head-height wind, not the 10 m wind
    "displayMeander": False,  # the shown wind is the mean flow: the meander widens the cone, it doesn't move its centre
    "display": "mixture",  # the shown wind: the mode of the classes' mixture, or "topClass": the most likely class's own direction
}

# One row per class.
#   sigma: the class's own direction spread (deg); "coupled" adds nothing past the
#          ambient's own doubt (in the THETA prior) and the meander
#   uniform: the share of the direction density spread round the compass
#   speed: the median head-height speed (km/h), see median_kmh; sigLn its log spread
#   swirly: P(the puffs swung 90 deg or more | class)
#   aloft: P(treetops moving while the air here is calm or different | class)
TABLE = {
    "coupled": dict(sigma=15.0, uniform=0.05, sigLn=0.8, swirly=0.20, aloft=0.30,
                    dir="the terrain call for the ambient: the micro grid's momentum solve (stable lid by s)",
                    speed="ambient x momentum ratio x 0.45 open / 0.25 under trees x the app's stable damping"),
    "channelled": dict(sigma=25.0, uniform=0.05, sigLn=0.7, swirly=0.15, aloft=0.40,
                       dir="along the slot's or valley's axis, toward the end the ambient pushes (logistic on cos)",
                       speed="ambient x 0.45"),
    "decoupled": dict(sigma=70.0, uniform=0.50, sigLn=0.9, swirly=0.50, aloft=0.80,
                      dir="half round the compass, half +-70 about the drainage line (else the terrain call)",
                      speed="0.8 km/h"),
    "drainage": dict(sigma=30.0, uniform=0.10, sigLn=0.7, swirly=0.10, aloft=0.60,
                     dir="from uphill: katDir + 180",
                     speed="max(1.2, 0.5 x katSpd)"),
    "upslope": dict(sigma=30.0, uniform=0.10, sigLn=0.7, swirly=0.25, aloft=0.40,
                    dir="from downhill: thAspect (the downslope bearing)",
                    speed="2.5 km/h"),
    "breeze": dict(sigma=35.0, uniform=0.10, sigLn=0.7, swirly=0.15, aloft=0.40,
                   dir="lake breeze from the lake (onshore + 180); land breeze from the land (onshore)",
                   speed="max(2, 0.5 x breezeMax)"),
    "rotor": dict(sigma=45.0, uniform=0.25, sigLn=1.0, swirly=0.60, aloft=0.60,
                  dir="the terrain call for the ambient + 180",
                  speed="ambient x 0.3"),
}

# The prior's rules in words (INVERSE.md prints these); the code is prior_weights().
PRIOR_RULES = {
    "coupled": "1.0 x (1 - 0.6 S low)",
    "channelled": "1.5 x chan x (1 - 0.3 S); chan = 1 in a slot, else valley depth (cross rise - along rise, 30->100 m) x floor",
    "decoupled": "2.5 x S x max(low, 0.7 floor, 0.4 under trees 8 m+) x mixN + 1.0 x clamp((5 - F)/4)",
    "drainage": "2.0 x S x slope x (a drainage line) x mixN; slope = clamp((thSlope - 0.5)/3)",
    "upslope": "1.5 x heat x (1 - stable) x mixD x slope; heat = sun on the face / 600 W/m2 (model.ts)",
    "breeze": "lake: 1.5 x e^(-shore/500) x clamp((dT - 1)/6) x clamp(sw/500) x [sun > 10] x e^(-max(0, U10 - 10)/10); land: 1.0 x e^(-shore/300) x clamp((-dT - 1)/6) x clear x mixN",
    "rotor": "2.0 x lee(ambient) x clamp((F - 6)/6) x (0.4 + 0.6 S) x (1 - 0.7 Cv); lee = clamp((upwind horizon - 3 deg)/7 deg)",
}


def clamp(v, a=0.0, b=1.0):
    return min(b, max(a, v))


def wrap(a):
    return (np.asarray(a) + 180.0) % 360.0 - 180.0


def angdiff(a, b) -> float:
    return abs(((a - b) % 360.0 + 540.0) % 360.0 - 180.0)


def wn_pdf(x, mu, sigma):
    """Wrapped normal density (per degree) of x about mu, wrapped once each way."""
    d = wrap(np.asarray(x) - np.asarray(mu))
    s = np.maximum(sigma, 1.0)
    k = 1.0 / (s * math.sqrt(2 * math.pi))
    return k * (np.exp(-0.5 * (d / s) ** 2) + np.exp(-0.5 * ((d - 360.0) / s) ** 2) + np.exp(-0.5 * ((d + 360.0) / s) ** 2))


def norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def band_probs(median: float, sig_ln: float) -> dict:
    """P(each strength word) for a lognormal head-height speed, with the misread share."""
    m = max(median, 0.05)
    out = {}
    for b in BANDS:
        lo, hi = BAND_RANGE[b]
        p_hi = 1.0 if hi > 1e8 else norm_cdf((math.log(hi) - math.log(m)) / sig_ln)
        p_lo = 0.0 if lo <= 0 else norm_cdf((math.log(lo) - math.log(m)) / sig_ln)
        out[b] = (1 - STRENGTH_UNIFORM) * (p_hi - p_lo) + STRENGTH_UNIFORM / len(BANDS)
    return out


# ---------------------------------------------------------------- the place's terrain call

def coupled_dir(r: dict, theta: float) -> tuple[float, float]:
    """The app's 10 m terrain wind for an ambient from theta (model.ts
    momentumAt, blended toward the stable lid by s): FROM bearing and speed
    ratio. Without a solve, the neutral lid."""
    s = r["stable"]
    te, tn = math.sin(math.radians(theta + 180)), math.cos(math.radians(theta + 180))  # a unit wind's motion
    (sUe, sVe), (sUn, sVn) = r["lidStable"]
    se, sn = sUe * te + sUn * tn, sVe * te + sVn * tn
    mom = r.get("momentum")
    if mom:
        x = (theta % 360) / 22.5
        k0 = int(x) % 16
        k1 = (k0 + 1) % 16
        t = x - int(x)
        me = mn = 0.0
        for k, w, deg in ((k0, 1 - t, t * 22.5), (k1, t, (t - 1) * 22.5)):
            u, v = mom[k]
            c, sn_ = math.cos(math.radians(deg)), math.sin(math.radians(deg))
            me += w * (u * c + v * sn_)
            mn += w * (-u * sn_ + v * c)
    else:
        (nUe, nVe), (nUn, nVn) = r["lidNeutral"]
        me, mn = nUe * te + nUn * tn, nVe * te + nVn * tn
    e, n = (1 - s) * me + s * se, (1 - s) * mn + s * sn
    return (math.degrees(math.atan2(e, n)) + 180.0) % 360.0, math.hypot(e, n)


def drivers(r: dict) -> dict:
    """The parameters the priors read, from a params.json record."""
    F = float(r["forecastKmh"])
    S = max(r["stable"], 0.6 * cool_of(r))
    low = max(clamp(r["pool"] / 1.5), clamp(-r["rel"] / 6))
    floor = max(clamp(-r["rel"] / 6), 0.8 if (r["landform"] in ("valley", "flat") and r["thSlope"] < 3) else 0.0)
    _, ratio = coupled_dir(r, float(r["forecastDir"]))
    U10 = F * ratio
    # what mixes the floor's own thermal flows away: the 10 m wind, or (post hoc
    # switch) under trees the head-height wind, taken as 3x the baked canopy
    # fraction (the GPX checks felt 3-4x the head-height speed the app called)
    Umix = U10 * min(1.0, 3.0 * r["canopy"]) if (CONFIG["canopyMix"] and r["treeH"] >= 8) else U10
    t = r["terrain"]
    slot = r.get("slot")
    valley = clamp((t["valleyDepth"] - 30) / 70) * floor
    chan = 1.0 if slot else valley
    axis = slot["axis"] if slot else t["valleyAxis"]
    heat = 0.0
    if r["sunEl"] > 3 and r["sw"] > 80 and r["thAspect"] is not None:
        sl = math.radians(r["thSlope"])
        el = math.radians(r["sunEl"])
        cos_inc = math.sin(el) * math.cos(sl) + math.cos(el) * math.sin(sl) * math.cos(math.radians(r["sunAz"] - r["thAspect"]))
        heat = r["sw"] * max(0.0, cos_inc) / max(0.15, math.sin(el))
    dT = r["t2"] - r["waterC"]
    return dict(
        F=F, S=S, Cv=r["convective"], stable=r["stable"], low=low, floor=floor, U10=U10, ratio=ratio,
        mixN=math.exp(-max(0.0, Umix - 5) / 8), mixD=math.exp(-max(0.0, Umix - 8) / 10),
        chan=chan, axis=axis, slope=clamp((r["thSlope"] - 0.5) / 3), heat=clamp(heat / 600), dT=dT,
        trees=r["treeH"] >= 8, openCell=r["treeH"] < 2,
    )


def cool_of(r: dict) -> float:
    """model.ts: clear-sky cooling once the sun is under 10 deg."""
    el = r["sunEl"]
    f = 1.0 if el < 0 else (10 - el) / 10 if el < 10 else 0.0
    return (1 - r["cloud"] / 100) ** 1.5 * f


def lee_of(r: dict, theta: float) -> float:
    h = r["terrain"]["hUp"][int(round(theta / 10.0)) % 36]
    return clamp((h - 3.0) / 7.0)


def prior_weights(r: dict, d: dict, palm: dict | None = None) -> np.ndarray:
    """P(class | ambient, parameters) as unnormalised weights, (NC, NT)."""
    w = np.zeros((NC, NT))
    F, S = d["F"], d["S"]
    w[0, :] = 1.0 * (1 - 0.6 * S * d["low"])
    w[1, :] = 1.5 * d["chan"] * (1 - 0.3 * S)
    low_d = max(d["low"], 0.7 * d["floor"], 0.4 if d["trees"] else 0.0)
    w[2, :] = 2.5 * S * low_d * d["mixN"] + 1.0 * clamp((5 - F) / 4)
    w[3, :] = 2.0 * S * d["slope"] * (1.0 if r["katDir"] is not None else 0.0) * d["mixN"]
    w[4, :] = 1.5 * d["heat"] * (1 - d["stable"]) * d["mixD"] * d["slope"]
    lake = land = 0.0
    if r["onshore"] is not None:
        lake = 1.5 * math.exp(-r["shoreDist"] / 500) * clamp((d["dT"] - 1) / 6) * clamp(r["sw"] / 500) * (1.0 if r["sunEl"] > 10 else 0.0) * math.exp(-max(0.0, d["U10"] - 10) / 10)
        land = 1.0 * math.exp(-r["shoreDist"] / 300) * clamp((-d["dT"] - 1) / 6) * (1 - r["cloud"] / 100) * d["mixN"]
    w[5, :] = lake + land
    wind_g = clamp((F - 6) / 6)
    for j, th in enumerate(THETA):
        w[6, j] = 2.0 * lee_of(r, th) * wind_g * (0.4 + 0.6 * S) * (1 - 0.7 * d["Cv"])
    if palm:
        # PALM's stable run as evidence: how often its floor reversed here, and how dead it was
        w[6, :] += 2.0 * palm["reversedShare"]
        w[2, :] += 2.0 * clamp(1 - palm["headKph"] / max(0.3 * F, 0.5))
    return w + EPS


# P(ambient | forecast): a core about the forecast and a tail round the compass.
# Calibrated on the station scoreboard (WIND-LEARNING.md: HRDPS within 45 deg
# 88% of station-hours at 5 km/h and up, median miss 14 deg): 85% N(0, 17) +
# 15% uniform gives 88% and ~14 deg. Below 8 km/h the stations say nothing
# (they were scored from 5 km/h), so the core widens and the tail grows.
AMB_SIGMA_STRONG = 17.0
AMB_TAIL_STRONG = 0.15


def theta_prior(r: dict) -> np.ndarray:
    """P(ambient): the forecast's direction, its doubt growing as it weakens."""
    F = float(r["forecastKmh"])
    weak = clamp((8.0 - F) / 6.0)
    sig = AMB_SIGMA_STRONG + 15.0 * weak
    tail = (AMB_TAIL_STRONG + 0.15 * weak) if CONFIG["ambTail"] else 0.0
    p = (1 - tail) * wn_pdf(THETA, float(r["forecastDir"]), sig) * 10.0 + tail / NT
    return p / p.sum()


def breeze_from(r: dict, d: dict) -> float | None:
    if r["onshore"] is None:
        return None
    lake = d["dT"] > 1 and r["sunEl"] > 10
    return (r["onshore"] + 180.0) % 360.0 if lake else r["onshore"]


def class_shape(r: dict, d: dict) -> list[list[tuple[float, float, float]]]:
    """For each class and ambient: the direction mixture as (weight, centre, sigma)
    components (the uniform share apart), plus each class's median speed."""
    comps = [[None] * NT for _ in range(NC)]
    kat_from = (r["katDir"] + 180.0) % 360.0 if r["katDir"] is not None else None
    up_from = r["thAspect"]
    brz = breeze_from(r, d)
    for j, th in enumerate(THETA):
        cd, _ = coupled_dir(r, th)
        comps[0][j] = [(1.0, cd, TABLE["coupled"]["sigma"])]
        if d["chan"] > 0 or r.get("slot"):
            q = math.cos(math.radians(th - d["axis"]))
            w1 = 1.0 / (1.0 + math.exp(-4.0 * q))
            sig = TABLE["channelled"]["sigma"] + (25.0 if (r.get("slot") and r["slot"]["width"] < 5 * r["slot"]["wall"]) else 0.0)
            comps[1][j] = [(w1, d["axis"], sig), (1 - w1, (d["axis"] + 180) % 360, sig)]
        else:
            comps[1][j] = [(1.0, cd, TABLE["channelled"]["sigma"])]
        comps[2][j] = [(1.0, kat_from if kat_from is not None else cd, TABLE["decoupled"]["sigma"])]
        comps[3][j] = [(1.0, kat_from if kat_from is not None else cd, TABLE["drainage"]["sigma"])]
        comps[4][j] = [(1.0, up_from if up_from is not None else cd, TABLE["upslope"]["sigma"])]
        comps[5][j] = [(1.0, brz if brz is not None else cd, TABLE["breeze"]["sigma"])]
        comps[6][j] = [(1.0, (cd + 180) % 360, TABLE["rotor"]["sigma"])]
    return comps


def median_kmh(r: dict, d: dict) -> np.ndarray:
    F = d["F"]
    S = d["S"]
    damp = (1 - 0.3 * S) * (1 - 0.7 * S * d["low"])
    return np.array([
        F * d["ratio"] * (0.45 if d["openCell"] else 0.25) * damp,
        F * 0.45,
        0.8,
        max(1.2, 0.5 * r["katSpd"] * 3.6),
        2.5,
        max(2.0, 0.5 * r["breezeMax"] * 3.6),
        F * 0.3,
    ])


# ---------------------------------------------------------------- one check's model

class CheckModel:
    """A check's prior, its observation model and its likelihood over (class, ambient)."""

    def __init__(self, r: dict, sigma_model: float, palm: dict | None = None):
        self.r = r
        self.d = drivers(r)
        self.palm = palm
        w = prior_weights(r, self.d, palm)
        pc = w / w.sum(axis=0, keepdims=True)  # P(class | ambient)
        self.prior = pc * theta_prior(r)[None, :]
        self.prior /= self.prior.sum()
        self.comps = class_shape(r, self.d)
        self.median = median_kmh(r, self.d)
        self.sigma_m = CONFIG["meander"] * min(110.0, max(15.0, sigma_model))
        self.bands = [band_probs(self.median[c], TABLE[CLASSES[c]]["sigLn"]) for c in range(NC)]

    def dir_density(self, x, extra_sigma: float = 0.0, meander: bool = True) -> np.ndarray:
        """The density of a felt direction x (scalar or array) per (class, ambient)."""
        x = np.atleast_1d(np.asarray(x, dtype=float))
        out = np.zeros((NC, NT, x.size))
        sm2 = self.sigma_m ** 2 if meander else 0.0
        for c in range(NC):
            u = TABLE[CLASSES[c]]["uniform"]
            for j in range(NT):
                dens = np.zeros(x.size)
                for wgt, mu, sg in self.comps[c][j]:
                    dens += wgt * wn_pdf(x, mu, math.sqrt(sg * sg + sm2 + extra_sigma ** 2))
                out[c, j] = (1 - u) * dens + u / 360.0
        return out

    def obs_sigma(self, strength: str, swing: float, quant: float) -> float:
        return math.sqrt(DIR_SIGMA.get(strength, 35.0) ** 2 + (swing / 2.0) ** 2 + quant ** 2)

    def loglik(self, ck: dict) -> np.ndarray:
        """log P(this felt check | class, ambient), (NC, NT)."""
        ll = np.zeros((NC, NT))
        if ck["dirFrom"] is not None:
            ll += np.log(self.dir_density(ck["dirFrom"], self.obs_sigma(ck["strength"], ck.get("swingDeg") or 0, ck.get("quantDeg") or 0))[:, :, 0])
        ll += np.log(np.array([self.bands[c][ck["strength"]] for c in range(NC)]))[:, None]
        sw = swing_of(ck)
        if sw is not None:
            p = np.array([TABLE[k]["swirly"] for k in CLASSES])
            ll += np.log(p if sw >= 90 else 1 - p)[:, None]
        if ck.get("aloft") is not None:
            p = np.array([TABLE[k]["aloft"] for k in CLASSES])
            ll += np.log(p if ck["aloft"] else 1 - p)[:, None]
        return ll

    def predictive(self, post: np.ndarray) -> np.ndarray:
        """The direction density the phone would believe (no reading error): on GRID."""
        dens = self.dir_density(GRID, meander=CONFIG["displayMeander"])  # (NC, NT, 360)
        p = (post[:, :, None] * dens).sum(axis=(0, 1))
        return p / p.sum()

    def class_mode(self, post: np.ndarray, c: int) -> float:
        dens = self.dir_density(GRID, meander=CONFIG["displayMeander"])[c]
        pc = post[c] / max(post[c].sum(), 1e-300)
        return float(GRID[int(np.argmax((pc[:, None] * dens).sum(axis=0)))])

    def speed_band(self, post: np.ndarray) -> str:
        pc = post.sum(axis=1)
        pb = {b: sum(pc[c] * self.bands[c][b] for c in range(NC)) for b in BANDS}
        return max(pb, key=pb.get)


def swing_of(ck: dict) -> float | None:
    """The arc the puffs spanned (or the swing said), or None for one quiet puff."""
    dirs = [d for d in (ck.get("dirs") or []) if d is not None]
    sw = ck.get("swingDeg") or 0
    if len(dirs) >= 2:
        for a in dirs:
            for b in dirs:
                sw = max(sw, angdiff(a, b))
        return sw
    return sw if sw else None


def seen_loglik(ck: dict) -> np.ndarray:
    """log P(the treetops seen | ambient), (NT,): the class doesn't enter."""
    p = 0.95 * wn_pdf(THETA, ck["dirFrom"], SEEN_DIR_SIGMA) + 0.05 / 360.0
    return np.log(p)


def entropy(p) -> float:
    p = np.asarray(p, float)
    p = p[p > 0]
    return float(-(p * np.log2(p)).sum())


def info_gain(m: CheckModel, post: np.ndarray) -> dict:
    """Bits about the class from one more observation, two kinds:
    - puff: another felt check here (direction in 10 deg bins x strength word);
    - treetops: the air above the trees seen (direction in 10 deg bins), which
      pins the ambient and so splits the classes that need a different one."""
    pc = post.sum(axis=1)
    h0 = entropy(pc)
    bins = np.arange(5.0, 360.0, 10.0)
    out = {}
    # puff: P(o | c, th) = dir(bin) x band
    dd = m.dir_density(bins, DIR_SIGMA["light"]) * 10.0  # (NC, NT, 36)
    dd /= dd.sum(axis=2, keepdims=True)
    bands = np.array([[m.bands[c][b] for b in BANDS] for c in range(NC)])  # (NC, 5)
    po_c = np.einsum("ct,ctk,cb->ckb", post, dd, bands)  # joint P(c, o)
    po = po_c.sum(axis=0)
    hc_o = 0.0
    for k in range(po.shape[0]):
        for b in range(po.shape[1]):
            if po[k, b] > 1e-12:
                hc_o += po[k, b] * entropy(po_c[:, k, b] / po[k, b])
    out["puff"] = h0 - hc_o
    # treetops: P(o | th)
    st = wn_pdf(bins[None, :], THETA[:, None], SEEN_DIR_SIGMA) * 10.0  # (NT, 36)
    st /= st.sum(axis=1, keepdims=True)
    po_c = np.einsum("ct,tk->ck", post, st)
    po = po_c.sum(axis=0)
    hc_o = sum(po[k] * entropy(po_c[:, k] / po[k]) for k in range(len(po)) if po[k] > 1e-12)
    out["treetops"] = h0 - hc_o
    return out
