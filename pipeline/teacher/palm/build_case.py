"""Build a PALM case for the stability teacher (docs/TEACHER.md, Track A):
the static driver (terrain, plant canopy, roughness) and one _p3d namelist
per run, laid out as PALM's JOBS folders so palmrun can take them as they are.

    py -3.14 pipeline/teacher/palm/build_case.py searchmont              # 10 m, 5.12 km
    py -3.14 pipeline/teacher/palm/build_case.py searchmont --dx 20 --nest 10:3000 --npe 8,16
                                                                         # the layout to run: a 20 m root,
                                                                         # a 10 m child over the 3 km core
    py -3.14 pipeline/teacher/palm/build_case.py searchmont --dx 5       # the 5 m box (185 M cells: too big)
    py -3.14 pipeline/teacher/palm/build_case.py searchmont --dx 20 --tag t20 --hours 0.25
                                                                         # a quick test case
    py -3.14 pipeline/teacher/palm/check_driver.py searchmont            # validate what it wrote

Out: pipeline/teacher/palm/<case>/JOBS/<case>_<run>[_<tag>]/INPUT/
        <name>_static   NetCDF static driver (PIDS), the same for every run
        <name>_p3d      the namelist
     pipeline/teacher/palm/<case>/case-<tag>.json   what was built, for palm_to_fields.py
     pipeline/raw/teacher/palm/<case>-1m.npz        the 1 m DTM and canopy height cache

THE GRID. UTM (the case's zone), north-up, aligned to the WindNinja trial's
10 m lattice so a PALM field and a WindNinja field compare cell for cell.
rotation_angle is 0: the grid's north is UTM grid north, which is not true
north (the meridian convergence, +2.2 deg at Searchmont). Coriolis is off
(omega = 0, as in WindNinja) and there is no radiation, so the angle has no
physics to act on; the forecast's true direction is turned onto the grid
here, the way pipeline/surrogate/fields.py does (from d true = from d - gamma
in grid axes), and palm_to_fields.py turns it back.

THE BOUNDARIES. Cyclic both ways, the wind held by the volume flow of the
initial profile (conserve_volume_flow). One static driver then serves every
direction and stability, which is what a teacher needs (16 directions x 3
stabilities per seed site). The price: terrain must be periodic, so the
outer ring (taper_m) is blended to a constant height, and the hill's wake
re-enters upwind after one domain length (5.1 km at Searchmont). The scored
core is the middle 3 km. A non-cyclic inflow with synthetic turbulence is
the alternative (one driver per direction, rotated grid); see TEACHER.md.

TERRAIN. HRDEM 1 m LiDAR DTM (NRCan, OGL-Canada), averaged to the cell.
Fallback (--terrain mrdem): the area's 30 m MRDEM, bilinear.

CANOPY. Leaf area density on PALM's terrain-following levels (zlad):
- where a tree is, and how tall: HRDEM's 1 m DSM minus DTM (the canopy
  height model), small crown gaps closed (3x3 grey closing), trees = pixels
  over 2 m; Fallback (--canopy forest): the habitat grid's FRI stand height
  and crown closure;
- how much leaf a crown carries: the habitat grid's conifer and hardwood
  shares (FRI) at the cell, a closed crown's plant area index of 4.0 for
  conifer, 1.0 for bare hardwood (stems and branches) plus 3.5 more in full
  leaf, times --leaf (the share of hardwood leaves still on; 0.5 for
  10 Oct in Algoma maple country, a guess for the checks to move);
- where in the crown: a beta profile on z/h per pixel, conifer mode 0.4 h
  (alpha 1.8, beta 2.2: foliage to the ground in spruce and fir), hardwood
  mode 0.75 h (alpha 4, beta 2: an open trunk space under the crowns);
- each cell's LAD at level k is the mean over its 1 m pixels of the leaf
  area in [(k-1) dz, k dz] above the ground, over dz.

ROUGHNESS (z0 in the driver, the surface under the resolved canopy): water
0.0002 m, open wetland 0.03, rock and road 0.01, everything else 0.1 (the
forest floor and its shrubs; the trees are the LAD, not z0).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PIPE = ROOT / "pipeline"
CACHE = PIPE / "raw" / "teacher" / "palm"
HRDEM = "https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-lidar/"
sys.path.insert(0, str(PIPE))

# ---------------------------------------------------------------- the cases

# Searchmont, WIND-LEARNING.md "What set it off": the valley floor felt from
# 308 deg under a 152 deg forecast at dusk on 2026-10-10, treetops 500 m SE
# seen from 180; channelled along the valley (249) at midday on 2026-10-11.
CASES = {
    "searchmont": dict(
        area="searchmont",
        point=(46.77744, -84.04824),  # lat, lon: the valley-floor check, 17:33 EDT
        epsg=32616,
        hrdem=["ON-Sault_SteMarie_UTM16_2024-1m", "ON-Sault_SteMarie_UTM17_2024-1m"],
        size_m=5120.0,
        core_m=3000.0,
        taper_m=640.0,
        # the domain's centre 400 m toward 152 deg from the point: the ski hill
        # (crest 1.5 km SSE) and its plateau to 3 km are upwind in the box
        shift=(152.0, 400.0),
        lattice=(721690.0, 5179850.0),  # C:/tmp/wn-trial/searchmont10/dem.tif's corner
        trial_dem="C:/tmp/wn-trial/searchmont10/dem.tif",
        runs={
            # the dusk forecast (HRDPS 17:30 EDT, as trial.py had it): from 151-152, 16.2 km/h
            "neutral": dict(direction=152.0, speed_kph=16.2, stability="neutral",
                            hours=3.0, average_s=3600.0,
                            why="control: the same wind with no stratification; WindNinja's physics with resolved turbulence and canopy"),
            "stable": dict(direction=152.0, speed_kph=16.2, stability="stable",
                           hours=2.5, average_s=1800.0,
                           theta_surface=291.8,  # 17.6 C at the floor (233 m) as potential temperature
                           # an evening inversion over the floor (N ~ 0.025 /s), a stable free atmosphere above
                           theta_gradients=[(0.0, 2.0), (300.0, 0.5)],  # (level m, K per 100 m)
                           # The ground cools at a rate (GABLS's way): each surface starts at the air's
                           # temperature at its height and falls 1 K/h, and the flux follows the
                           # turbulence. Tried 2026-10-11 at 20 m (TEACHER.md): a fixed -0.02 K m/s
                           # flux runs but doubles the cost (PALM's stability iteration at every
                           # surface element).
                           surface="rate", heating_rate=-1.0,
                           surface_heatflux=-0.02,  # K m/s, about -24 W/m2, with --surface flux
                           # the crowns radiate at dusk: canopy-top cooling, KINEMATIC (K m/s). PALM
                           # v25's docs give cthf in W/m2, but its code adds cthf * d(exp(-a LAI))/dz
                           # to the temperature tendency in K/s: the -25 first written here was
                           # -25 K m/s and blew the run up in 10 min. -0.02 K m/s is about -24 W/m2.
                           cthf=-0.02,
                           why="the case: does stable air under the same SSE wind reverse the floor?"),
            # the midday forecast (11:00 EDT 2026-10-11): from 186, 10.4 km/h, clear
            "midday": dict(direction=186.0, speed_kph=10.4, stability="convective",
                           hours=2.5, average_s=1800.0,
                           theta_surface=292.4,
                           theta_gradients=[(0.0, 0.0), (800.0, 1.0)],  # a mixed layer to 800 m, capped
                           surface_heatflux=0.06,  # K m/s, about 70 W/m2 on open ground
                           cthf=0.09,  # K m/s (about 110 W/m2): an October noon's sensible heat at the crowns
                           why="the other half of the test: a southerly by day must channel along the valley (felt 249), not reverse"),
        },
    ),
}

# PAI of a closed crown column (leaf + wood per ground area under the crown)
PAI_CONIFER = 4.0
PAI_HARDWOOD_BARE = 1.0
PAI_HARDWOOD_LEAVES = 3.5
SHAPE = {"conifer": (1.8, 2.2), "hardwood": (4.0, 2.0)}  # beta(alpha, beta) on z/h
TREE_M = 2.0  # a DSM-DTM pixel over this is a crown
DRAG = 0.2  # canopy_drag_coeff (Cescatti and Marcolla 2004; PALM's default is 0.15)

# habitat cover classes (build_habitat.py coverNames)
WATER, OPEN_WET, TREED_WET, CON_DENSE, CON_OPEN, MIXED, HARD, SHRUB, REGEN, ROCK, ROAD = range(1, 12)
Z0 = {WATER: 0.0002, OPEN_WET: 0.03, ROCK: 0.01, ROAD: 0.01}
Z0_DEFAULT = 0.1


# ---------------------------------------------------------------- the grid

def meridian_convergence(epsg: int, lon: float, lat: float) -> float:
    """Degrees from grid north to true north, pyproj's sign (as fields.py)."""
    from pyproj import CRS, Proj
    return float(Proj(CRS.from_epsg(epsg)).get_factors(lon, lat).meridian_convergence)


def grid_for(case: dict, dx: float) -> dict:
    from pyproj import Transformer
    lat, lon = case["point"]
    to = Transformer.from_crs(4326, case["epsg"], always_xy=True)
    back = Transformer.from_crs(case["epsg"], 4326, always_xy=True)
    px, py = to.transform(lon, lat)
    b, d = case["shift"]
    cx, cy = px + d * math.sin(math.radians(b)), py + d * math.cos(math.radians(b))
    n = int(round(case["size_m"] / dx))
    lx0, ly0 = case["lattice"]
    # the corner on a 20 m lattice through the trial's 10 m one, so the 5, 10
    # and 20 m grids nest and share one 1 m cache
    step = 20.0
    x0 = lx0 + step * round((cx - case["size_m"] / 2 - lx0) / step)
    y0 = ly0 + step * round((cy - case["size_m"] / 2 - ly0) / step)
    olon, olat = back.transform(x0, y0)
    gamma = meridian_convergence(case["epsg"], *back.transform(x0 + n * dx / 2, y0 + n * dx / 2))
    return dict(dx=dx, nx=n, ny=n, x0=x0, y0=y0, x1=x0 + n * dx, y1=y0 + n * dx,
                point_xy=(px, py), origin_lonlat=(olon, olat), gamma=gamma)


# ---------------------------------------------------------------- inputs

def fetch_1m(case_id: str, case: dict, g: dict, refresh: bool = False) -> dict:
    """The 1 m DTM and canopy height over the domain on its own UTM lattice,
    from HRDEM's COGs (EPSG:3979) warped onto it; cached in pipeline/raw."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.vrt import WarpedVRT

    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / f"{case_id}-1m.npz"
    bounds = [g["x0"], g["y0"], g["x1"], g["y1"]]
    if out.exists() and not refresh:
        z = np.load(out)
        if list(z["bounds"]) == bounds:
            return dict(dtm=z["dtm"], chm=z["chm"].astype(np.float32) / 10.0, sources=list(z["sources"]))
    w, h = int(round(g["x1"] - g["x0"])), int(round(g["y1"] - g["y0"]))
    tr = from_origin(g["x0"], g["y1"], 1.0, 1.0)
    dtm = np.full((h, w), np.nan, np.float32)
    dsm = np.full((h, w), np.nan, np.float32)
    used = []
    env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
               GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2", VSI_CACHE="TRUE")
    with rasterio.Env(**env):
        for proj in case["hrdem"]:
            for kind, arr in (("dtm", dtm), ("dsm", dsm)):
                if not np.isnan(arr).any():
                    continue
                t0 = time.time()
                with rasterio.open(f"/vsicurl/{HRDEM}{proj}-{kind}.tif") as src:
                    with WarpedVRT(src, crs=f"EPSG:{case['epsg']}", transform=tr, width=w, height=h,
                                   resampling=Resampling.bilinear, src_nodata=src.nodata, nodata=np.nan) as vrt:
                        a = vrt.read(1, out_dtype="float32")
                a[(a < -1000) | (a > 9000)] = np.nan
                fill = np.isnan(arr) & np.isfinite(a)
                arr[fill] = a[fill]
                print(f"  {proj} {kind}: {fill.mean():.1%} of the box filled · {time.time() - t0:.0f} s", flush=True)
                if fill.any():
                    used.append(f"{proj}-{kind}")
    if np.isnan(dtm).any():
        raise SystemExit(f"HRDEM leaves {np.isnan(dtm).mean():.2%} of the box without ground: use --terrain mrdem")
    chm = np.where(np.isfinite(dsm), np.clip(dsm - dtm, 0, 60), 0).astype(np.float32)
    np.savez_compressed(out, dtm=dtm, chm=np.round(chm * 10).astype(np.uint16), bounds=np.array(bounds), sources=np.array(used))
    return dict(dtm=dtm, chm=chm, sources=used)


def area_habitat(area_id: str):
    """The area's habitat grid (habfile) and its lon/lat lattice, found the
    way area.py finds an area's files (bake.outDir, else areas/<id>)."""
    import habfile
    a = json.loads((ROOT / "app" / "src" / "areas" / f"{area_id}.json").read_text(encoding="utf-8"))
    out_dir = ROOT / (a.get("bake") or {}).get("outDir", f"app/public/data/areas/{area_id}")
    header, bands = habfile.read_hab(out_dir / f"habitat-{area_id}.hab")
    return header, bands


def sample_habitat(header: dict, bands: dict, lon: np.ndarray, lat: np.ndarray, names: list[str]) -> dict:
    c = np.floor((lon - header["west"]) / header["dLon"]).astype(int)
    r = np.floor((header["north"] - lat) / header["dLat"]).astype(int)
    inside = (c >= 0) & (c < header["cols"]) & (r >= 0) & (r < header["rows"])
    if not inside.all():
        raise SystemExit(f"{(~inside).mean():.1%} of the domain is outside the area's habitat grid")
    return {k: bands[k][r, c] for k in names}


# ---------------------------------------------------------------- canopy

def beta_cdf(x: np.ndarray, a: float, b: float) -> np.ndarray:
    from scipy.special import betainc
    return betainc(a, b, np.clip(x, 0.0, 1.0))


def lad_levels(chm: np.ndarray, pai_crown: np.ndarray, conifer_share: np.ndarray, dz: float, nlev: int,
               block: int) -> np.ndarray:
    """LAD (m2/m3) on PALM's levels k = 1..nlev (layer [(k-1) dz, k dz] above
    the ground), each cell the mean over its block x block pixels of the 1 m
    crowns. chm in m at 1 m; pai_crown, conifer_share per cell."""
    ny, nx = pai_crown.shape
    h = chm.reshape(ny, block, nx, block)
    tree = h > TREE_M
    hh = np.where(tree, h, 1.0)
    out = np.zeros((nlev + 1, ny, nx), np.float32)
    cs = conifer_share[:, None, :, None]
    pai = pai_crown[:, None, :, None]
    for k in range(1, nlev + 1):
        lo, hi = (k - 1) * dz / hh, k * dz / hh
        frac = (cs * (beta_cdf(hi, *SHAPE["conifer"]) - beta_cdf(lo, *SHAPE["conifer"]))
                + (1 - cs) * (beta_cdf(hi, *SHAPE["hardwood"]) - beta_cdf(lo, *SHAPE["hardwood"])))
        leaf = np.where(tree, pai * frac, 0.0)  # m2 of plant area per m2 of ground in the layer
        out[k] = (leaf.mean(axis=(1, 3)) / dz).astype(np.float32)
    out[0] = out[1]  # zlad = 0: PALM integrates through it, applies no drag there
    return out


def lad_from_forest(height: np.ndarray, crown: np.ndarray, pai_crown: np.ndarray, conifer_share: np.ndarray,
                    dz: float, nlev: int) -> np.ndarray:
    """The fallback: the FRI stand height and crown closure, one crown per cell."""
    cover = np.clip(crown / 100.0, 0, 1) * (height > TREE_M)
    hh = np.where(height > TREE_M, height, 1.0)
    out = np.zeros((nlev + 1,) + height.shape, np.float32)
    for k in range(1, nlev + 1):
        lo, hi = (k - 1) * dz / hh, k * dz / hh
        frac = (conifer_share * (beta_cdf(hi, *SHAPE["conifer"]) - beta_cdf(lo, *SHAPE["conifer"]))
                + (1 - conifer_share) * (beta_cdf(hi, *SHAPE["hardwood"]) - beta_cdf(lo, *SHAPE["hardwood"])))
        out[k] = (cover * pai_crown * frac / dz).astype(np.float32)
    out[0] = out[1]
    return out


# ---------------------------------------------------------------- the vertical grid

def vertical_grid(dz: float, relief: float) -> dict:
    """dz up to the relief plus 270 m (the stable layer, the lee and the wake
    resolved), stretched to 4 dz over the next 500 m (40 dz when coarser, to
    keep PALM's stretch factor under 1.12), 4 dz on to about 1.6 km above the
    lowest ground. Returns PALM's dz / stretch parameters and nz."""
    start = dz * math.ceil((relief + 270.0) / dz)
    # PALM warns past a stretch factor of 1.12: dz to 4 dz needs about 40 dz of height
    end = start + max(500.0, 40.0 * dz)
    top = max(1600.0, end + 300.0)
    dz2 = 4 * dz
    # PALM's levels, approximately: constant, then geometric to dz2 by `end`, then constant
    zs, z, d = [], dz / 2, dz
    while z < top:
        zs.append(z)
        if z >= end:
            d = dz2
        elif z >= start:
            d = min(dz2, d * 1.08)
        z += d
    return dict(dz=[dz, dz2], start=start, end=end, nz=len(zs), top=round(zs[-1]))


def child_vertical(dz_child: float, parent_vg: dict) -> dict:
    """The child: dz_child up to two root cells under where the root starts
    to stretch. PALM wants the root's dz over the child's a whole number at
    every child level (PMC0018), and a top on the stretch line failed it."""
    top = parent_vg["start"] - 2 * parent_vg["dz"][0]
    return dict(dz=[dz_child], start=None, end=None, nz=int(round(top / dz_child)), top=round(top))


def child_grid(g: dict, dx: float, size_m: float, case: dict) -> dict:
    """A child box of size_m centred on the root's centre, its corner and
    size on the root's lattice (PALM's nesting needs both)."""
    from pyproj import Transformer
    pdx = g["dx"]
    size = pdx * round(size_m / pdx)
    cx, cy = (g["x0"] + g["x1"]) / 2, (g["y0"] + g["y1"]) / 2
    x0 = g["x0"] + pdx * round((cx - size / 2 - g["x0"]) / pdx)
    y0 = g["y0"] + pdx * round((cy - size / 2 - g["y0"]) / pdx)
    n = int(round(size / dx))
    back = Transformer.from_crs(case["epsg"], 4326, always_xy=True)
    return dict(dx=dx, nx=n, ny=n, x0=x0, y0=y0, x1=x0 + size, y1=y0 + size, point_xy=g["point_xy"],
                origin_lonlat=back.transform(x0, y0), gamma=g["gamma"], llx=x0 - g["x0"], lly=y0 - g["y0"])


# ---------------------------------------------------------------- the namelists

def profile(speed_ms: float, from_grid_deg: float, z0_eff: float = 1.0, zref: float = 30.0) -> tuple:
    """A neutral log profile through speed_ms at zref above the lowest ground
    (canopy top + 10 m over 20 m trees, WindNinja's 10 m over vegetation),
    held above 500 m: the initial wind and the volume flow kept."""
    ustar = 0.4 * speed_ms / math.log((zref + z0_eff) / z0_eff)
    hs = [0.0, 10.0, 30.0, 60.0, 100.0, 200.0, 300.0, 500.0, 3000.0]
    sp = [0.0] + [ustar / 0.4 * math.log((min(z, 500.0) + z0_eff) / z0_eff) for z in hs[1:]]
    ex, ey = -math.sin(math.radians(from_grid_deg)), -math.cos(math.radians(from_grid_deg))
    return hs, [round(s * ex, 3) for s in sp], [round(s * ey, 3) for s in sp]


def fmt(xs) -> str:
    return ", ".join(f"{x:g}" if isinstance(x, (int, float)) else str(x) for x in xs)


def p3d(name: str, case_id: str, run: dict, g: dict, vg: dict, hours: float, nz_do3d: int,
        nest: dict | None = None, child: bool = False) -> str:
    """The namelist of the root domain, or with child=True of the nested
    child (<name>_p3d_N02): its own grid, the multigrid solver (no FFT
    without cyclic boundaries), its boundaries from the root."""
    dx = g["dx"]
    from_grid = run["direction"] - g["gamma"]
    hs, us, vs = profile(run["speed_kph"] / 3.6, from_grid)
    end = hours * 3600.0
    avg = min(run["average_s"], end / 2)
    st = run["stability"]
    lines = [
        f"! {name}{' (nested child, N02)' if child else ''}: PALM {case_id}, {st}, wind from {run['direction']:g} deg true "
        f"({from_grid:.2f} on the UTM grid),",
        f"! {run['speed_kph']:g} km/h at 30 m over the lowest ground. Built by pipeline/teacher/palm/build_case.py.",
        f"! {run['why']}",
    ]
    if nest and not child:
        lines += [
            "&nesting_parameters",
            f"    domain_layouts = 'root',  1, -1, {nest['npe'][0]}, 0.0, 0.0, 0.0,",
            f"                     'core',  2,  1, {nest['npe'][1]}, {nest['llx']:g}, {nest['lly']:g}, 0.0,",
            "    nesting_mode = 'one-way',             ! the root sets the core's boundaries; nothing fed back over the terrain",
            "/",
            "",
        ]
    lines += [
        "&initialization_parameters",
        f"    nx = {g['nx'] - 1}, ny = {g['ny'] - 1}, nz = {vg['nz']},",
        f"    dx = {dx:g}, dy = {dx:g}, dz = {fmt(vg['dz'])},",
    ]
    if not child:
        lines += [
            f"    dz_stretch_level_start = {vg['start']:g},",
            f"    dz_stretch_level_end = {vg['end']:g},",
        ]
    lines += [
        "    topography = 'read_from_file',",
        "    initializing_actions = 'set_constant_profiles',",
    ]
    if not child:
        lines += ["    bc_lr = 'cyclic', bc_ns = 'cyclic',"]
    lines += [
        "    omega = 0.0,                          ! no Coriolis, as WindNinja; the grid's rotation does not matter then",
        f"    uv_heights = {fmt(hs)},",
        f"    u_profile  = {fmt(us)},",
        f"    v_profile  = {fmt(vs)},",
        "    roughness_length = 0.1,               ! where the driver's z0 has no value",
    ]
    if child:
        lines += [
            "    psolver = 'multigrid',",
            "    cycle_mg = 'w',",
            "    mg_cycles = -1,                       ! iterate to residual_limit: 2 cycles left divergence over the terrain and jets at the edge",
        ]
    else:
        lines += [
            "    conserve_volume_flow = .T.,",
            "    conserve_volume_flow_mode = 'initial_profiles',",
            f"    rayleigh_damping_height = {vg['end'] + 100:g},",
            "    rayleigh_damping_factor = 0.01,",
            "    psolver = 'poisfft',",
            "    fft_method = 'fftw',",
        ]
    if st == "neutral":
        lines += ["    neutral = .T.,"]
    else:
        lv, gr = zip(*run["theta_gradients"])
        lines += [
            "    neutral = .F.,",
            f"    pt_surface = {run['theta_surface']:g},",
            f"    pt_vertical_gradient = {fmt(gr)},",
            f"    pt_vertical_gradient_level = {fmt(lv)},",
        ]
        surface = run.get("surface", "flux")
        if surface == "rate":
            lines += [
                "    bc_pt_b = 'dirichlet',",
                f"    pt_surface_heating_rate = {run['heating_rate']:g},   ! K/h: the ground's temperature falls; the flux follows the turbulence",
            ]
        elif surface == "none":
            lines += [
                "    bc_pt_b = 'neumann',",
                "    surface_heatflux = 0.0,               ! stable air from the profile alone: lee waves and rotors, no cold pool",
            ]
        else:
            f = run["surface_heatflux"]
            lines += [
                "    bc_pt_b = 'neumann',",
                f"    surface_heatflux = {f:g},              ! K m/s, the model's bottom (the lowest ground)",
                f"    wall_heatflux = {f:g}, 0.0, 0.0, 0.0, 0.0, 0.0,   ! raised ground: upward faces only, so a stair-stepped slope is not counted twice",
            ]
    lines += [
        "/",
        "",
        "&runtime_parameters",
        f"    end_time = {end:g},",
    ]
    if child and nest:
        # the multigrid wants equal subdomains: the child's rank grid, set (pe_grid checked it divides)
        lines += [f"    npex = {nest['pe_grid'][0]}, npey = {nest['pe_grid'][1]},"]
    lines += [
        "    create_disturbances = .T.,",
        "    dt_disturb = 150.0,",
        "    disturbance_energy_limit = 0.01,",
        "    dt_run_control = 60.0,",
        "    netcdf_data_format = 2,",
        "    interpolate_to_grid_center = .T.,     ! u, v, w on the cell centres: the DEM's lattice",
        "",
        "    ! the field the teacher gives: the mean over the last stretch, near the ground",
        "    data_output = 'u_av', 'v_av', 'w_av', 'e_av',"
        + (" 'theta_av'," if st != "neutral" else ""),
        f"    nz_do3d = {nz_do3d},",
        f"    averaging_interval = {avg:g},",
        f"    dt_data_output_av = {avg:g},",
        f"    skip_time_data_output_av = {end - avg:g},",
        "    dt_averaging_input = 10.0,",
        "",
        "    ! gusts and lulls: the lowest four levels over the ground, every 30 s over the same stretch",
        "    data_output_masks(1,:) = 'u', 'v', 'w',",
        "    mask_k_over_surface(1,:) = 1, 2, 3, 4,",
        "    dt_domask(1) = 30.0,",
        f"    skip_time_domask(1) = {end - avg:g},",
        "",
        "    data_output_pr = '#u', '#v', 'w', 'e', 'w\"u\"', 'w\"v\"'" + (", '#theta', 'w\"theta\"'" if st != "neutral" else "") + ",",
        "    dt_dopr = 600.0,",
        "    averaging_interval_pr = 600.0,",
        "    dt_dots = 60.0,",
        "/",
        "",
        "&plant_canopy_parameters",
        "    canopy_mode = 'read_from_file',",
        f"    canopy_drag_coeff = {DRAG:g},",
    ]
    if st != "neutral" and run.get("cthf"):
        lines += [f"    cthf = {run['cthf']:g},                    ! K m/s at the canopy top (the code's unit; the docs say W/m2)"]
    lines += ["/", ""]
    return "\n".join(lines)


# ---------------------------------------------------------------- the driver

def write_static(path: Path, g: dict, zt: np.ndarray, lad: np.ndarray, z0: np.ndarray, dz: float,
                 epsg: int, meta: dict) -> None:
    from netCDF4 import Dataset
    from pyproj import Transformer
    ny, nx = zt.shape
    nzl = lad.shape[0]
    back = Transformer.from_crs(epsg, 4326, always_xy=True)
    xs = (np.arange(nx) + 0.5) * g["dx"]
    ys = (np.arange(ny) + 0.5) * g["dx"]
    E, N = np.meshgrid(g["x0"] + xs, g["y0"] + ys)
    lon, lat = back.transform(E, N)
    path.parent.mkdir(parents=True, exist_ok=True)
    with Dataset(path, "w", format="NETCDF4") as nc:
        nc.Conventions = "CF-1.7"
        nc.title = f"PALM static driver: {meta['case']} ({g['dx']:g} m)"
        nc.institution = "Groundwind"
        nc.source = "; ".join(meta["sources"])
        nc.history = f"pipeline/teacher/palm/build_case.py {time.strftime('%Y-%m-%d %H:%M')}"
        nc.comment = ("UTM grid north (rotation_angle 0); true north is "
                      f"{g['gamma']:+.3f} deg from it (meridian convergence). Terrain tapered to a constant "
                      f"over the outer {meta['taper_m']:g} m for cyclic boundaries.")
        nc.origin_lat = np.float32(g["origin_lonlat"][1])
        nc.origin_lon = np.float32(g["origin_lonlat"][0])
        nc.origin_x = np.float32(g["x0"])
        nc.origin_y = np.float32(g["y0"])
        nc.origin_z = np.float32(meta["origin_z"])
        nc.rotation_angle = np.float32(0.0)
        nc.origin_time = "2026-10-10 21:30:00 +00"
        nc.createDimension("x", nx)
        nc.createDimension("y", ny)
        nc.createDimension("zlad", nzl)
        v = nc.createVariable("x", "f4", ("x",)); v[:] = xs; v.units = "m"; v.long_name = "distance to origin in x-direction"; v.axis = "X"
        v = nc.createVariable("y", "f4", ("y",)); v[:] = ys; v.units = "m"; v.long_name = "distance to origin in y-direction"; v.axis = "Y"
        v = nc.createVariable("zlad", "f4", ("zlad",)); v[:] = np.r_[0.0, (np.arange(1, nzl) - 0.5) * dz]; v.units = "m"; v.long_name = "height above ground of the canopy levels"; v.axis = "Z"
        v = nc.createVariable("zt", "f4", ("y", "x"), fill_value=-9999.0); v[:] = zt; v.units = "m"; v.long_name = "terrain height above origin_z"; v.res_orig = np.float32(g["dx"])
        v = nc.createVariable("lad", "f4", ("zlad", "y", "x"), fill_value=-9999.0); v[:] = lad; v.units = "m2 m-3"; v.long_name = "leaf area density"
        v = nc.createVariable("z0", "f4", ("y", "x"), fill_value=-9999.0); v[:] = z0; v.units = "m"; v.long_name = "roughness length for momentum"
        v = nc.createVariable("E_UTM", "f8", ("y", "x")); v[:] = E; v.units = "m"; v.long_name = f"easting, EPSG:{epsg}"
        v = nc.createVariable("N_UTM", "f8", ("y", "x")); v[:] = N; v.units = "m"; v.long_name = f"northing, EPSG:{epsg}"
        v = nc.createVariable("lat", "f8", ("y", "x")); v[:] = lat; v.units = "degrees_north"; v.long_name = "latitude"
        v = nc.createVariable("lon", "f8", ("y", "x")); v[:] = lon; v.units = "degrees_east"; v.long_name = "longitude"


def taper(a: np.ndarray, width_cells: int, value: float) -> np.ndarray:
    """Blend a toward value over the outer width_cells cells (cosine), so
    the field is periodic at the edges."""
    ny, nx = a.shape
    def w1(n):
        # cells from the edge: the outer two exactly at value, then a cosine to 1
        d = np.minimum(np.arange(n), n - 1 - np.arange(n)).astype(np.float64)
        ramp = 0.5 - 0.5 * np.cos(np.pi * np.clip(d - 2, 0, None) / (width_cells - 2))
        return np.where(d < 2, 0.0, np.where(d >= width_cells, 1.0, ramp))
    w = np.minimum.outer(w1(ny), w1(nx))
    return value + w * (a - value)


def cell_fields(case: dict, g: dict, args, one: dict | None, root: dict) -> dict:
    """Terrain, canopy and roughness on grid g, a box inside the root's
    (the 1 m cache covers the root)."""
    dx, nx, ny = g["dx"], g["nx"], g["ny"]
    block = int(round(dx))
    sources = []
    if one is not None:
        r0, c0 = int(round(root["y1"] - g["y1"])), int(round(g["x0"] - root["x0"]))
        h, w = int(round(g["y1"] - g["y0"])), int(round(g["x1"] - g["x0"]))
        dtm1, chm1 = one["dtm"][r0:r0 + h, c0:c0 + w], one["chm"][r0:r0 + h, c0:c0 + w]
        sources += [f"HRDEM 1 m LiDAR ({', '.join(one['sources'])}), NRCan, OGL-Canada"]
    if args.terrain == "hrdem":
        dtm = dtm1.reshape(ny, block, nx, block).mean(axis=(1, 3))
    else:
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.transform import from_origin
        from rasterio.warp import reproject
        z = np.load(PIPE / "raw" / f"mrdem-{case['area']}.npz")
        dtm = np.zeros((ny, nx), np.float32)
        reproject(z["data"], dtm, src_transform=rasterio.Affine(*z["transform"]), src_crs=str(z["crs"]),
                  dst_transform=from_origin(g["x0"], g["y1"], dx, dx), dst_crs=f"EPSG:{case['epsg']}",
                  resampling=Resampling.bilinear, src_nodata=float(z["nodata"]))
        sources += ["MRDEM 30 m, NRCan, OGL-Canada"]

    # the habitat at each cell centre (FRI composition, cover class)
    from pyproj import Transformer
    back = Transformer.from_crs(case["epsg"], 4326, always_xy=True)
    xs = g["x0"] + (np.arange(nx) + 0.5) * dx
    ys = g["y1"] - (np.arange(ny) + 0.5) * dx  # north row first
    E, N = np.meshgrid(xs, ys)
    lon, lat = back.transform(E, N)
    header, bands = area_habitat(case["area"])
    hab = sample_habitat(header, bands, lon, lat, ["cover", "height", "crown", "conifer", "hardwood"])
    sources += [f"habitat grid of area {case['area']} (FRI stands, OMNRF, OGL-Ontario)"]
    cover = hab["cover"].astype(int)
    con, hw = hab["conifer"].astype(np.float32), hab["hardwood"].astype(np.float32)
    tot = con + hw
    # no composition from the map: half and half, or the class's lean
    lean = np.select([cover == CON_DENSE, cover == CON_OPEN, cover == TREED_WET, cover == HARD],
                     [0.9, 0.9, 0.9, 0.1], 0.5)
    conifer_share = np.where(tot > 0, con / np.maximum(tot, 1), lean).astype(np.float32)
    pai_crown = (conifer_share * PAI_CONIFER
                 + (1 - conifer_share) * (PAI_HARDWOOD_BARE + args.leaf * PAI_HARDWOOD_LEAVES)).astype(np.float32)
    water = cover == WATER

    if args.canopy == "chm":
        import warnings
        from scipy.ndimage import grey_closing
        chm = grey_closing(chm1, size=(3, 3))
        hmax = float(np.percentile(chm[chm > TREE_M], 99.9)) if (chm > TREE_M).any() else 0.0
        nlev = max(1, int(math.ceil(min(hmax, 45.0) / dx)))
        chm = np.minimum(chm, nlev * dx)
        lad = lad_levels(chm, pai_crown, conifer_share, dx, nlev, block)
        cover_frac = (chm > TREE_M).reshape(ny, block, nx, block).mean(axis=(1, 3))
        tree_h = np.where(chm > TREE_M, chm, np.nan).reshape(ny, block, nx, block)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # cells with no tree
            canopy_h = np.nan_to_num(np.nanpercentile(tree_h.transpose(0, 2, 1, 3).reshape(ny, nx, -1), 90, axis=2))
    else:
        height, crown = hab["height"].astype(np.float32), hab["crown"].astype(np.float32)
        nlev = max(1, int(math.ceil(min(float(height.max()), 45.0) / dx)))
        lad = lad_from_forest(np.minimum(height, nlev * dx), crown, pai_crown, conifer_share, dx, nlev)
        cover_frac = np.clip(crown / 100, 0, 1) * (height > TREE_M)
        canopy_h = np.where(height > TREE_M, height, 0.0)
    lad[:, water] = 0.0

    # roughness under the canopy
    z0 = np.full((ny, nx), Z0_DEFAULT, np.float32)
    for k, v in Z0.items():
        z0[cover == k] = v
    return dict(dtm=dtm.astype(np.float64), lad=lad, z0=z0, cover_frac=cover_frac, canopy_h=canopy_h, water=water,
                conifer_share=conifer_share, nlev=nlev, sources=sources, dx=dx)


def canopy_summary(fd: dict) -> dict:
    lai = fd["lad"][1:].sum(axis=0) * fd["dx"]
    ch = fd["canopy_h"]
    return dict(cover_mean=float(fd["cover_frac"].mean()), lai_mean=float(lai.mean()), lai_p90=float(np.percentile(lai, 90)),
                height_p90_mean=float(ch[ch > 0].mean()) if (ch > 0).any() else 0.0)


def save_grid(path: Path, fd: dict, zt: np.ndarray, origin_z: float) -> None:
    """The cell properties palm_to_fields.py needs, row 0 north (the DEM's way)."""
    np.savez_compressed(path, dem=fd["dtm"].astype(np.float32), dem_model=(zt + origin_z).astype(np.float32),
                        canopy_h=fd["canopy_h"].astype(np.float32), cover=fd["cover_frac"].astype(np.float32),
                        z0=fd["z0"], water=fd["water"], lai=(fd["lad"][1:].sum(axis=0) * fd["dx"]).astype(np.float32))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("case", choices=sorted(CASES))
    ap.add_argument("--dx", type=float, default=10.0, help="grid spacing, m (5, 10 or 20); the root's with --nest")
    ap.add_argument("--nest", default="", help="dx:size of a nested child over the core, e.g. 10:3000 (with --dx 20)")
    ap.add_argument("--npe", default="8,16", help="MPI ranks for the root and the child with --nest (their sum is palmrun's -X)")
    ap.add_argument("--leaf", type=float, default=0.5, help="share of hardwood leaves still on (0 bare .. 1 full)")
    ap.add_argument("--terrain", choices=["hrdem", "mrdem"], default="hrdem")
    ap.add_argument("--canopy", choices=["chm", "forest"], default="chm")
    ap.add_argument("--runs", default="", help="comma list of the case's runs (default all)")
    ap.add_argument("--hours", type=float, default=0.0, help="override every run's length (a quick test)")
    ap.add_argument("--tag", default="", help="suffix for the run names and case-<tag>.json (test builds)")
    ap.add_argument("--refresh", action="store_true", help="fetch the 1 m HRDEM again")
    ap.add_argument("--surface", choices=["flux", "rate", "none"], default="",
                    help="the stratified runs' ground: a fixed heat flux (the runs' default), a cooling/heating rate, or none")
    ap.add_argument("--rate", type=float, default=-1.0, help="K/h with --surface rate")
    ap.add_argument("--cthf", default="", help="canopy-top heat flux, K m/s (kinematic, whatever PALM's docs say), or 'none'")
    args = ap.parse_args()
    case = CASES[args.case]
    t0 = time.time()
    g = grid_for(case, args.dx)
    dx, nx, ny = g["dx"], g["nx"], g["ny"]
    print(f"{args.case}: {nx} x {ny} cells of {dx:g} m, EPSG:{case['epsg']} "
          f"[{g['x0']:.0f}, {g['y0']:.0f}, {g['x1']:.0f}, {g['y1']:.0f}], convergence {g['gamma']:+.3f} deg")

    one = fetch_1m(args.case, case, g, args.refresh) if (args.terrain == "hrdem" or args.canopy == "chm") else None
    f = cell_fields(case, g, args, one, g)
    dtm, lad, z0 = f["dtm"], f["lad"], f["z0"]

    # ---- periodic: the outer ring to a constant
    tw = int(round(case["taper_m"] / dx))
    ring = np.ones((ny, nx), bool); ring[tw:-tw, tw:-tw] = False
    edge = float(np.median(dtm[ring]))
    dtm_t = taper(dtm, tw, edge)
    origin_z = float(dtm_t.min())
    zt = (dtm_t - origin_z).astype(np.float32)
    relief = float(zt.max())
    vg = vertical_grid(dx, relief)
    nlev = f["nlev"]
    # 3d output up to the highest ground + the tallest canopy + 40 m
    nz_do3d = int(math.ceil((relief + nlev * dx + 40.0) / dx)) + 1
    meta = dict(case=args.case, sources=f["sources"], taper_m=case["taper_m"], origin_z=origin_z)

    # ---- the nested child over the core
    nest = None
    if args.nest:
        cdx, csize = (float(v) for v in args.nest.split(":"))
        gc = child_grid(g, cdx, csize, case)
        clear = case["taper_m"] + 4 * dx  # PALM wants 4 root cells clear of the root's edge; keep clear of the taper too
        if min(gc["x0"] - g["x0"], g["x1"] - gc["x1"], gc["y0"] - g["y0"], g["y1"] - gc["y1"]) < clear:
            raise SystemExit(f"the child box reaches into the root's tapered ring: keep it under {case['size_m'] - 2 * clear:g} m")
        fc = cell_fields(case, gc, args, one, g)
        zt_c = (fc["dtm"] - origin_z).astype(np.float32)
        if zt_c.min() < 0:
            raise SystemExit("the child's ground dips under the root's lowest: PALM would shift every domain")
        vgc = child_vertical(cdx, vg)
        if vgc["top"] < float(zt_c.max()) + 200:
            raise SystemExit(f"the child's top ({vgc['top']} m) is under 200 m over its highest ground")
        nz_do3d_c = int(math.ceil((float(zt_c.max()) + fc["nlev"] * cdx + 40.0) / cdx)) + 1
        npe = [int(v) for v in args.npe.split(",")]
        # PALM's multigrid refuses unequal subdomains: the child's ranks as a grid that divides its cells
        grids = [(a, npe[1] // a) for a in range(1, npe[1] + 1) if npe[1] % a == 0
                 and gc["nx"] % a == 0 and gc["ny"] % (npe[1] // a) == 0]
        if not grids:
            raise SystemExit(f"{npe[1]} ranks do not split the child's {gc['nx']} x {gc['ny']} cells evenly: pick another --npe")
        pe_grid = min(grids, key=lambda g2: abs(g2[0] - g2[1]))
        nest = dict(npe=npe, pe_grid=pe_grid, llx=gc["llx"], lly=gc["lly"], grid=gc, vertical=vgc, nz_do3d=nz_do3d_c, fields=fc, zt=zt_c)
        print(f"  child: {gc['nx']} x {gc['ny']} x {vgc['nz']} cells of {cdx:g} m at ({gc['llx']:g}, {gc['lly']:g}) in the root, "
              f"top {vgc['top']} m; ranks {npe[0]} + {npe[1]} = {sum(npe)}")

    # ---- write: PALM wants the south row first
    out_case = HERE / args.case
    tag = f"_{args.tag}" if args.tag else ""
    runs = [r for r in (args.runs.split(",") if args.runs else case["runs"])]
    names, run_infos = [], {}
    for r in runs:
        run = dict(case["runs"][r])
        if run["stability"] != "neutral":
            if args.surface:
                run["surface"] = args.surface
                run["heating_rate"] = args.rate
            if args.cthf:
                run["cthf"] = None if args.cthf == "none" else float(args.cthf)
        name = f"{args.case}_{r}{tag}"
        inp = out_case / "JOBS" / name / "INPUT"
        for old in inp.glob(f"{name}_*_N02"):
            old.unlink()  # a child left from an earlier build would be run
        write_static(inp / f"{name}_static", g, zt[::-1].copy(), lad[:, ::-1].copy(), z0[::-1].copy(), dx, case["epsg"], meta)
        hours = args.hours or run["hours"]
        (inp / f"{name}_p3d").write_text(p3d(name, args.case, run, g, vg, hours, nz_do3d, nest), encoding="utf-8", newline="\n")
        if nest:
            fc, gc = nest["fields"], nest["grid"]
            write_static(inp / f"{name}_static_N02", gc, nest["zt"][::-1].copy(), fc["lad"][:, ::-1].copy(),
                         fc["z0"][::-1].copy(), gc["dx"], case["epsg"], dict(meta, taper_m=0.0))
            (inp / f"{name}_p3d_N02").write_text(
                p3d(name, args.case, run, gc, nest["vertical"], hours, nest["nz_do3d"], nest, child=True),
                encoding="utf-8", newline="\n")
        names.append(name)
        run_infos[name] = run

    sfx = f"-{args.tag}" if args.tag else ""
    info = dict(
        case=args.case, tag=args.tag, built=time.strftime("%Y-%m-%d %H:%M"), epsg=case["epsg"], dx=dx, nx=nx, ny=ny,
        bounds=[g["x0"], g["y0"], g["x1"], g["y1"]], gridConvergenceDeg=g["gamma"],
        origin_lonlat=list(g["origin_lonlat"]), origin_z=origin_z, relief_m=relief, taper_m=case["taper_m"],
        core_m=case["core_m"], centre=[(g["x0"] + g["x1"]) / 2, (g["y0"] + g["y1"]) / 2], point_xy=list(g["point_xy"]),
        point_latlon=list(case["point"]), vertical=vg, nz_do3d=nz_do3d, canopy_levels=nlev, leaf=args.leaf,
        terrain=args.terrain, canopy=args.canopy, sources=f["sources"], runs=run_infos,
        canopy_summary=canopy_summary(f), trial_dem=case.get("trial_dem"),
    )
    save_grid(out_case / f"grid{sfx}.npz", f, zt, origin_z)
    if nest:
        fc, gc = nest["fields"], nest["grid"]
        info["nest"] = dict(domain="N02", dx=gc["dx"], nx=gc["nx"], ny=gc["ny"], bounds=[gc["x0"], gc["y0"], gc["x1"], gc["y1"]],
                            llx=gc["llx"], lly=gc["lly"], vertical=nest["vertical"], nz_do3d=nest["nz_do3d"], npe=nest["npe"],
                            canopy_levels=fc["nlev"], canopy_summary=canopy_summary(fc),
                            centre=[(gc["x0"] + gc["x1"]) / 2, (gc["y0"] + gc["y1"]) / 2])
        save_grid(out_case / f"grid{sfx}-N02.npz", fc, nest["zt"], origin_z)
    (out_case / f"case{sfx}.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    cs = info["canopy_summary"]
    print(f"  terrain {dtm.min():.0f}-{dtm.max():.0f} m, relief in the model {relief:.0f} m (ring tapered to {edge:.0f} m over {case['taper_m']:g} m)")
    print(f"  canopy: cover {cs['cover_mean']:.0%}, LAI mean {cs['lai_mean']:.2f} (p90 {cs['lai_p90']:.2f}), "
          f"{nlev} levels of {dx:g} m; conifer share {f['conifer_share'].mean():.0%}, leaf {args.leaf:g}")
    print(f"  vertical: {vg['nz']} levels, {dx:g} m to {vg['start']:g} m, stretched to {vg['dz'][1]:g} m by {vg['end']:g} m, top ~{vg['top']} m")
    print(f"  runs: {', '.join(names)} -> {out_case / 'JOBS'} · {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
