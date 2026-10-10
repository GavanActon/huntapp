"""The surrogate's conventions in one place: the grid, the wind's signs, the
inputs the net sees, the exact D4 augmentation, loading an area's npz and
the whole-domain prediction. model.py, train.py, eval.py and predict.py all
read from here, so a sign is decided once.

The grid is the dataset's (dataset.py): UTM, 30 m, row 0 the north edge,
col 0 the west edge. So +col is +x (east) but +row is SOUTH, and a north
derivative is minus the row derivative. Winds are (u, v) = (east, north),
divided by the 22 km/h ambient. A wind FROM bearing d (degrees clockwise
from north) blows toward d + 180, so the uniform ambient is
(ex, ey) = (-sin d, -cos d) in true-north axes.

But the grid's north is not true north. WindNinja takes the wind direction
as true and turns it onto its UTM grid by the meridian convergence, so in
the dataset's grid axes the ambient from d is the one from d - gamma, gamma
the convergence at the domain's centre (pyproj's meridian_convergence).
The runs show it: over the gentle cores the median turn from the true-north
ambient is the same in all 16 directions and equal to -gamma (Pickle Lake
-1.08 against gamma +1.06, Sault -1.77 against +1.82). Left in, it is a
constant 1-2 degree twist the net cannot see in the terrain, a different
one per area. So Area.amb() gives the ambient in grid axes, and that is what
the net is fed, what du, dv are measured from, and what the scores call the
ambient, for the baselines too.

D4: the momentum solve has no Coriolis and no preferred axis, so the field
over a terrain turned by 90 degrees, or mirrored, is the original field
turned or mirrored the same way, provided the wind vectors and the ambient
are turned with it. Eight copies of every sample for free, and exact: a
quarter turn and a mirror only permute and negate numbers, so nothing is
interpolated and nothing rounds. test_fields.py holds it to that.

    py -3.14 pipeline/surrogate/test_fields.py
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.ndimage import uniform_filter

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "raw" / "surrogate"
AREAS = ["blanchard-river", "highland-lake", "lac-bailey", "pickle-lake", "sault-test"]
CELL_M = 30.0
# The elevation channel is the height above the mean of the 193 x 193 cells
# (5.8 km) round each cell, in hundreds of metres. A local mean, not the
# patch's or the domain's, so a 192-cell training patch and a whole-domain
# pass see the same number at the same cell: the net never learns what the
# patch edge happened to be.
REL_WINDOW = 193
REL_SCALE_M = 100.0
N_IN, N_OUT = 5, 3  # in: rel, gx, gy, ex, ey; out: du, dv, turb


def ambient(direction_deg: float | np.ndarray) -> tuple:
    """The unit wind FROM direction_deg (clockwise from north) as (east,
    north) components: it blows toward direction_deg + 180."""
    d = np.radians(direction_deg)
    return -np.sin(d), -np.cos(d)


def grid_convergence(meta: dict) -> float:
    """Degrees from the grid's north to true north at the domain's centre,
    as pyproj gives it; the dataset's own gridConvergenceDeg when the meta
    carries it (the same number); 0 without either (synthetic data)."""
    if "gridConvergenceDeg" in meta:
        return float(meta["gridConvergenceDeg"])
    try:
        from pyproj import CRS, Proj
        b, epsg = meta["bounds"], int(meta["epsg"])
    except (ImportError, KeyError, TypeError, ValueError):
        return 0.0
    p = Proj(CRS.from_epsg(epsg))
    lon, lat = p(0.5 * (b[0] + b[2]), 0.5 * (b[1] + b[3]), inverse=True)
    return float(p.get_factors(lon, lat).meridian_convergence)


def bearing(u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Compass bearing the air moves TOWARD, degrees clockwise from north.
    Turns are differences of these, so a positive turn is clockwise (the
    wind veering), a negative one counter-clockwise (backing)."""
    return np.degrees(np.arctan2(u, v))


def wrap180(a: np.ndarray) -> np.ndarray:
    return (a + 180.0) % 360.0 - 180.0


def gradients(dem: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """dz/dx (east) and dz/dy (north), dimensionless. np.gradient's row
    derivative points south, so dz/dy is its negative. Central differences
    inside, one-sided at the edges, both of which change sign exactly under
    a mirror, which is what lets test 4 compare bit for bit."""
    gx = np.gradient(dem, CELL_M, axis=-1)
    gy = -np.gradient(dem, CELL_M, axis=-2)
    return gx, gy


def relative_elevation(dem: np.ndarray) -> np.ndarray:
    local = uniform_filter(dem.astype(np.float64), REL_WINDOW, mode="reflect")
    return ((dem - local) / REL_SCALE_M).astype(np.float32)


def slope_deg(dem: np.ndarray) -> np.ndarray:
    gx, gy = gradients(dem)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def terrain_features(dem: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(rel, gx, gy) over the whole domain, float32. Computed once per area;
    a patch crops them and turns (gx, gy) as a vector, which test 4 shows is
    the same as recomputing them from the turned DEM."""
    dem = np.asarray(dem, np.float32)
    gx, gy = gradients(dem)
    return relative_elevation(dem), gx.astype(np.float32), gy.astype(np.float32)


# ---- D4 -------------------------------------------------------------------
#
# Image side: np.rot90(a, k, axes=(-2, -1)) turns the picture k quarter turns
# COUNTER-CLOCKWISE as drawn north up (row 0 at the top, col 0 on the left);
# the mirror is np.flip(a, axis=-1), west and east swapped. The group element
# (k, flip) mirrors first, then turns.
#
# Vector side, in (east, north): a counter-clockwise quarter turn takes
# (x, y) to (-y, x); the west-east mirror takes (x, y) to (-x, y). Only
# swaps and negations, so the transform is exact in floating point.


def _is_torch(a) -> bool:
    return type(a).__module__.startswith("torch")


def _img(a, k: int, flip: bool):
    if _is_torch(a):
        import torch
        if flip:
            a = torch.flip(a, dims=(-1,))
        return torch.rot90(a, k, dims=(-2, -1)) if k else a
    if flip:
        a = np.flip(a, axis=-1)
    return np.rot90(a, k, axes=(-2, -1)) if k else a


def _vec(x, y, k: int, flip: bool):
    if flip:
        x = -x
    if k == 1:
        return -y, x
    if k == 2:
        return -x, -y
    if k == 3:
        return y, -x
    return x, y


def d4(k: int, flip: bool, dem, vec_fields: list[tuple], ex, ey):
    """Apply the D4 element (k quarter turns counter-clockwise, after a
    west-east mirror if flip) to a scene: dem is any scalar field or stack of
    them (..., R, C) (elevation, turbulence, masks), vec_fields a list of
    (east, north) pairs of (..., R, C) arrays (winds, slopes), (ex, ey) the
    ambient. Works on numpy arrays (returns views; copy before torch) and on
    torch tensors. Returns (dem, vec_fields, ex, ey) transformed."""
    k = int(k) % 4
    flip = bool(flip)
    dem_t = _img(dem, k, flip)
    vecs_t = []
    for x, y in vec_fields:
        vecs_t.append(_vec(_img(x, k, flip), _img(y, k, flip), k, flip))
    ex_t, ey_t = _vec(ex, ey, k, flip)
    return dem_t, vecs_t, ex_t, ey_t


def d4_inverse(k: int, flip: bool, dem, vec_fields: list[tuple], ex, ey):
    """Undo d4(k, flip, ...): turn back, then mirror back."""
    dem, vecs, ex, ey = d4(-int(k), False, dem, vec_fields, ex, ey)
    if flip:
        dem, vecs, ex, ey = d4(0, True, dem, vecs, ex, ey)
    return dem, vecs, ex, ey


D4_ELEMENTS = [(k, f) for f in (False, True) for k in range(4)]


# ---- areas ----------------------------------------------------------------


@dataclass
class Area:
    name: str
    dem: np.ndarray            # (R, C) metres
    u: np.ndarray              # (16, R, C) east / ambient
    v: np.ndarray              # (16, R, C) north / ambient
    turb: np.ndarray           # (16, R, C) fluctuation / ambient, NaN missing
    directions: np.ndarray     # (16,) FROM, degrees
    core: np.ndarray           # (R, C) bool
    valid: np.ndarray          # (R, C) bool
    meta: dict = field(default_factory=dict)
    conv: float = 0.0          # meridian convergence, degrees (grid_convergence)
    rel: np.ndarray | None = None
    gx: np.ndarray | None = None
    gy: np.ndarray | None = None

    @property
    def shape(self) -> tuple[int, int]:
        return self.dem.shape

    def amb(self, direction_deg: float) -> tuple[float, float]:
        """WindNinja's ambient from direction_deg (true) in the grid's axes."""
        ex, ey = ambient(float(direction_deg) - self.conv)
        return float(ex), float(ey)


def fill_dem(dem: np.ndarray) -> np.ndarray:
    dem = np.asarray(dem, np.float32)
    if not np.isfinite(dem).all():
        dem = np.where(np.isfinite(dem), dem, np.nanmean(dem)).astype(np.float32)
    return dem


def load_area(name: str, data: Path = DATA, features: bool = True) -> Area:
    z = np.load(Path(data) / f"{name}.npz", allow_pickle=False)
    meta = {}
    if "meta" in z.files:
        try:
            meta = json.loads(str(z["meta"]))
        except (ValueError, TypeError):
            meta = {}
    a = Area(
        name=name,
        dem=fill_dem(z["dem"]),
        u=z["u"].astype(np.float32, copy=False),
        v=z["v"].astype(np.float32, copy=False),
        turb=z["turb"].astype(np.float32, copy=False),
        directions=z["directions"].astype(np.float32),
        core=z["core"].astype(bool),
        valid=z["valid"].astype(bool),
        meta=meta,
        conv=grid_convergence(meta),
    )
    if features:
        a.rel, a.gx, a.gy = terrain_features(a.dem)
    return a


def load_baseline(name: str, data: Path = DATA) -> dict[str, np.ndarray] | None:
    p = Path(data) / f"baseline-{name}.npz"
    if not p.exists():
        return None
    z = np.load(p)
    return {k: z[k].astype(np.float32) for k in z.files}


def baseline_field(b: dict[str, np.ndarray], lid: str, direction_deg: float,
                   conv: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """The mass-consistent solve is linear in the ambient, so a wind from d
    is ex times the toward-east solve plus ey times the toward-north one.
    Its basis is in grid axes, so it gets the same grid-frame ambient as the
    net (conv, Area.conv)."""
    ex, ey = ambient(direction_deg - conv)
    u = ex * b[f"{lid}_ue"] + ey * b[f"{lid}_un"]
    v = ex * b[f"{lid}_ve"] + ey * b[f"{lid}_vn"]
    return u.astype(np.float32), v.astype(np.float32)


# ---- whole-domain prediction ----------------------------------------------


def input_stack(rel: np.ndarray, gx: np.ndarray, gy: np.ndarray, ex: float, ey: float) -> np.ndarray:
    """(5, R, C) float32: the order the net was trained on."""
    R, C = rel.shape[-2:]
    return np.stack([rel, gx, gy, np.full((R, C), ex, np.float32), np.full((R, C), ey, np.float32)]).astype(np.float32)


def predict_domain(model, area: Area, directions: list[float] | np.ndarray, device: str = "cuda",
                   batch: int = 4, tta: bool = False) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The net over the whole domain, one pass per direction (the U-Net pads
    to a multiple of 16 and crops). With tta, the eight D4 copies of the
    scene are each predicted and turned back and averaged, which makes the
    answer exactly symmetric. Returns u, v, turb, each (len(directions), R, C)."""
    import torch

    dirs = [float(d) for d in directions]
    R, C = area.shape
    out_u = np.empty((len(dirs), R, C), np.float32)
    out_v = np.empty_like(out_u)
    out_t = np.empty_like(out_u)
    elements = D4_ELEMENTS if tta else [(0, False)]
    was_training = model.training
    model.eval()
    dtype = torch.bfloat16 if str(device).startswith("cuda") else torch.float32
    with torch.no_grad():
        rel = torch.from_numpy(area.rel).to(device)
        gx = torch.from_numpy(area.gx).to(device)
        gy = torch.from_numpy(area.gy).to(device)
        for s in range(0, len(dirs), batch):
            chunk = dirs[s:s + batch]
            acc_u = acc_v = acc_t = None
            for k, flip in elements:
                xs = []
                amb = []
                for d in chunk:
                    ex, ey = area.amb(d)
                    rel_t, ((gx_t, gy_t),), ex_t, ey_t = d4(k, flip, rel, [(gx, gy)], float(ex), float(ey))
                    ones = torch.ones_like(rel_t)
                    xs.append(torch.stack([rel_t, gx_t, gy_t, ones * ex_t, ones * ey_t]))
                    amb.append((ex_t, ey_t))
                x = torch.stack(xs)
                with torch.autocast(device_type="cuda" if str(device).startswith("cuda") else "cpu",
                                    dtype=dtype, enabled=str(device).startswith("cuda")):
                    y = model(x).float()
                ex_b = torch.tensor([a[0] for a in amb], device=device).view(-1, 1, 1)
                ey_b = torch.tensor([a[1] for a in amb], device=device).view(-1, 1, 1)
                pu, pv = ex_b + y[:, 0], ey_b + y[:, 1]
                tb, ((pu, pv),), _, _ = d4_inverse(k, flip, y[:, 2], [(pu, pv)], 0.0, 0.0)
                if acc_u is None:
                    acc_u, acc_v, acc_t = pu.clone(), pv.clone(), tb.clone()
                else:
                    acc_u += pu
                    acc_v += pv
                    acc_t += tb
            n = len(elements)
            out_u[s:s + len(chunk)] = (acc_u / n).cpu().numpy()
            out_v[s:s + len(chunk)] = (acc_v / n).cpu().numpy()
            out_t[s:s + len(chunk)] = np.maximum((acc_t / n).cpu().numpy(), 0.0)
    if was_training:
        model.train()
    return out_u, out_v, out_t


def direction_index(area: Area, direction_deg: float) -> int:
    diff = np.abs(wrap180(area.directions - direction_deg))
    i = int(np.argmin(diff))
    if diff[i] > 1e-3:
        raise ValueError(f"{area.name} has no direction {direction_deg}")
    return i


def pearson(a: np.ndarray, b: np.ndarray) -> float:
    a = np.asarray(a, np.float64)
    b = np.asarray(b, np.float64)
    if a.size < 3:
        return math.nan
    a = a - a.mean()
    b = b - b.mean()
    den = math.sqrt(float((a * a).sum()) * float((b * b).sum()))
    return float((a * b).sum() / den) if den > 0 else math.nan
