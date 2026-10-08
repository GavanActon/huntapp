"""What is seen from space, on any grid: the predictors of the bush-thickness
model (docs/BUSH-MODEL.md), the same code for a training plot and for an
area's habitat lattice.

A Grid is a target raster (crs, transform, width, height); every source is
read over its footprint and put onto it with rasterio's reproject: average
for continuous layers, nearest for classes. The sources:

  national   SCANFI v2 (ten species' crown shares, closure, height, age,
             NFI land cover) and CanLaD (disturbance type and year), both
             30 m; the MRDEM 30 m DTM (elevation, slope, relief at 300 m
             and 1 km); the 2020 land cover. Read through stage.source, so
             a staged copy serves when one holds the box.
  sentinel2  Sentinel-2 L2A from Earth Search (AWS, no login): for each
             season a per-pixel median of the clear pixels (SCL 4 veg, 5
             bare, 6 water, 7 unclassified; snow kept in the snow season),
             over 2023-2025, in ten bands, plus the within-cell spread of
             NIR at 10 m (texture) for leaf-on and autumn. Four seasons:
             leaf-on (late June to August), autumn leaf-off (mid October
             to November, the canopy bare over any evergreen understory),
             spring leaf-off (late April to May) and snow (mid February to
             early April, shrubs dark on a bright floor).
  palsar     JAXA's ALOS PALSAR-2 annual mosaic (Planetary Computer): HH
             and HV in dB, the latest two years averaged. L-band answers
             to woody volume, stems included.
  derived    indices (NDVI, NDMI, NBR, NDRE) per season, leaf-off minus
             leaf-on differences, years since disturbance, lat and lon.

features(grid) returns {name: float32 array} with NaN where a source has
nothing; feature_names() the model's column order.
"""

from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import array_bounds
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import stage  # noqa: E402

GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF,.jp2",
    GDAL_HTTP_MULTIRANGE="YES",
    GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES",
    GDAL_HTTP_MAX_RETRY="6",
    GDAL_HTTP_RETRY_DELAY="2",
    VSI_CACHE="TRUE",
    VSI_CACHE_SIZE="50000000",
)

S2_BANDS = ("blue", "green", "red", "rededge1", "rededge2", "rededge3", "nir", "nir08", "swir16", "swir22")
S2_YEARS = (2023, 2024, 2025)
# season: (month-day start, month-day end, keep snow)
SEASONS = {"leafon": ("06-20", "08-31", False), "autumn": ("10-12", "11-25", False), "spring": ("04-20", "05-28", False), "snow": ("02-15", "04-05", True)}
TEXTURE_SEASONS = ("leafon", "autumn")
S2_SCALE = 1e-4
SCENES_PER_SEASON = 6
SCL_CANDIDATES = 14  # the least cloudy scenes of a season whose masks are read
MIN_CLEAR = 0.15  # a scene's share of the grid that must be clear to be used
CLEAR = (4, 5, 6, 7)
SNOW = 11
SPECIES = ("blackSpruce", "balsamFir", "jackPine", "whiteRedPine", "tamarack", "lodgepolePine", "douglasFir", "ponderosaPine", "otherConiferous", "broadleaf")
CATEGORICAL = ("nfiLandcover", "dist_type", "landcover")
REF_YEAR = 2025
THREADS = 24


@dataclass
class Grid:
    crs: str
    transform: rasterio.Affine
    width: int
    height: int

    @property
    def shape(self):
        return (self.height, self.width)

    def bounds(self):
        return array_bounds(self.height, self.width, self.transform)

    def lonlat_box(self, pad: float = 0.0):
        b = transform_bounds(self.crs, "EPSG:4326", *self.bounds(), densify_pts=21)
        return (b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad)

    def coarsened(self, k: int) -> "Grid":
        """The same frame at k times the cell."""
        t = self.transform
        return Grid(self.crs, rasterio.Affine(t.a * k, t.b, t.c, t.d, t.e * k, t.f), self.width // k, self.height // k)


def onto(src: np.ndarray, src_transform, src_crs, grid: Grid, categorical: bool, nodata=np.nan) -> np.ndarray:
    """One array onto the grid. Continuous layers average (or go bilinear
    when the source is as coarse as the grid); classes take the nearest."""
    out = np.full(grid.shape, nodata, dtype=np.float32 if not categorical else np.float32)
    if categorical:
        rs = Resampling.nearest
    else:
        sx = abs(src_transform.a)
        if src_crs == grid.crs:
            rs = Resampling.average if sx < abs(grid.transform.a) * 0.9 else Resampling.bilinear
        else:
            rs = Resampling.average
    reproject(src.astype(np.float32), out, src_transform=src_transform, src_crs=src_crs, dst_transform=grid.transform, dst_crs=grid.crs, src_nodata=np.nan, dst_nodata=nodata, resampling=rs)
    return out


def read_window(path: str, grid: Grid, pad_px: int = 2):
    """A source's pixels over the grid's footprint (a rim of pad_px around),
    with their transform and crs. None when the source does not reach."""
    with rasterio.Env(**GDAL_ENV), rasterio.open(path) as ds:
        b = transform_bounds(grid.crs, ds.crs, *grid.bounds(), densify_pts=21)
        w = from_bounds(*b, ds.transform).round_offsets().round_lengths()
        col0 = int(w.col_off) - pad_px
        row0 = int(w.row_off) - pad_px
        col1 = int(w.col_off + w.width) + pad_px
        row1 = int(w.row_off + w.height) + pad_px
        col0c, row0c = max(0, col0), max(0, row0)
        col1c, row1c = min(ds.width, col1), min(ds.height, row1)
        if col1c <= col0c or row1c <= row0c:
            return None
        win = rasterio.windows.Window(col0c, row0c, col1c - col0c, row1c - row0c)
        a = ds.read(1, window=win).astype(np.float32)
        if ds.nodata is not None:
            a[a == ds.nodata] = np.nan
        return a, ds.window_transform(win), ds.crs, ds


# ---- national rasters ----------------------------------------------------------


def national(grid: Grid) -> dict[str, np.ndarray]:
    src = stage.sources()
    box = grid.lonlat_box(0.02)
    out: dict[str, np.ndarray] = {}

    def one(name):
        path = stage.source(src[name], box)
        got = read_window(path, grid, pad_px=40 if name == "mrdem" else 2)
        if got is None:
            return name, None
        a, tr, crs, _ = got
        return name, (a, tr, crs)

    names = [f"sp_{s}" for s in SPECIES] + ["closure", "height", "age", "nfiLandcover", "dist_type", "dist_year", "landcover", "mrdem"]
    with ThreadPoolExecutor(8) as ex:
        got = dict(ex.map(one, names))
    for name, v in got.items():
        if name == "mrdem":
            continue
        if v is None:
            out[name] = np.full(grid.shape, np.nan, np.float32)
            continue
        a, tr, crs = v
        out[name] = onto(a, tr, str(crs), grid, categorical=name in CATEGORICAL)
    # terrain, worked out on the DEM's own grid and put onto ours
    v = got["mrdem"]
    if v is None:
        for k in ("elev", "slope", "tpi300", "tpi1000"):
            out[k] = np.full(grid.shape, np.nan, np.float32)
    else:
        dem, tr, crs = v
        px = abs(tr.a)  # the MRDEM is in lon/lat: metres per pixel at this latitude
        lat_c = (grid.lonlat_box()[1] + grid.lonlat_box()[3]) / 2
        m_per_px_x = px * 111_320 * np.cos(np.radians(lat_c)) if str(crs).upper().endswith("4326") else px
        m_per_px_y = abs(tr.e) * 111_320 if str(crs).upper().endswith("4326") else abs(tr.e)
        f = np.nan_to_num(dem, nan=float(np.nanmean(dem)) if np.isfinite(dem).any() else 0.0)
        gy, gx = np.gradient(f, m_per_px_y, m_per_px_x)
        slope = np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)
        tpi = {}
        for name, radius_m in (("tpi300", 300), ("tpi1000", 1000)):
            k = max(3, int(round(2 * radius_m / m_per_px_x)) | 1)
            tpi[name] = (f - ndimage.uniform_filter(f, k, mode="nearest")).astype(np.float32)
        for name, a in (("elev", dem), ("slope", slope), ("tpi300", tpi["tpi300"]), ("tpi1000", tpi["tpi1000"])):
            out[name] = onto(a, tr, str(crs), grid, categorical=False)
    return out


# ---- Sentinel-2 ----------------------------------------------------------------


def s2_items(grid: Grid) -> list:
    import pystac_client

    cat = pystac_client.Client.open("https://earth-search.aws.element84.com/v1")
    box = grid.lonlat_box(0.001)
    items = []
    for y in S2_YEARS:
        s = cat.search(collections=["sentinel-2-l2a"], bbox=list(box), datetime=f"{y}-02-01/{y}-11-30", query={"eo:cloud_cover": {"lt": 75}}, max_items=400)
        items.extend(s.items())
    return items


def season_of(item) -> str | None:
    md = item.datetime.strftime("%m-%d")
    for name, (a, b, _) in SEASONS.items():
        if a <= md <= b:
            return name
    return None


def read_asset(item, band: str, grid: Grid, categorical: bool):
    """One asset of a scene onto the grid, in reflectance (or class values).
    None when the read fails or nothing of the scene is on the grid."""
    for attempt in range(3):
        try:
            got = read_window(item.assets[band].href, grid, pad_px=2)
            if got is None:
                return None
            a, tr, crs, _ = got
            if not categorical:
                # Earth Search's COGs carry no BOA offset (a forest's blue reads
                # DN ~300, not ~1300), whatever raster:bands says: scale only
                a = a * S2_SCALE
            return onto(a, tr, str(crs), grid, categorical=categorical)
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                print(f"    {item.id} {band}: {str(e)[:80]}", flush=True)
                return None
            time.sleep(2)


def sentinel2(grid: Grid, verbose: bool = True) -> dict[str, np.ndarray]:
    t0 = time.time()
    items = s2_items(grid)
    by_season: dict[str, list] = {k: [] for k in SEASONS}
    for it in items:
        s = season_of(it)
        if s:
            by_season[s].append(it)
    if verbose:
        print(f"  S2: {len(items)} scenes, " + ", ".join(f"{k} {len(v)}" for k, v in by_season.items()) + f" ({time.time() - t0:.0f} s)", flush=True)
    out: dict[str, np.ndarray] = {}
    with ThreadPoolExecutor(THREADS) as ex:
        for season, its in by_season.items():
            keep_snow = SEASONS[season][2]
            # the clear share of each scene over the grid, from its SCL (the
            # least cloudy by the scene's own cloud cover first)
            its = sorted(its, key=lambda it: it.properties.get("eo:cloud_cover", 100))[:SCL_CANDIDATES]
            scls = list(ex.map(lambda it: read_asset(it, "scl", grid, categorical=True), its))
            scored = []
            for it, scl in zip(its, scls):
                if scl is None:
                    continue
                good = np.isin(scl, CLEAR) | (keep_snow & (scl == SNOW))
                share = float(good.mean())
                if share >= MIN_CLEAR:
                    scored.append((share, it, good))
            scored.sort(key=lambda t: -t[0])
            scored = scored[:SCENES_PER_SEASON]
            if verbose:
                print(f"    {season}: {len(scored)} usable scenes " + " ".join(f"{it.datetime:%y%m%d}:{s:.2f}" for s, it, _ in scored), flush=True)
            n = len(scored)
            if n == 0:
                for b in S2_BANDS:
                    out[f"{season}_{b}"] = np.full(grid.shape, np.nan, np.float32)
                out[f"{season}_n"] = np.zeros(grid.shape, np.float32)
                if season in TEXTURE_SEASONS:
                    out[f"{season}_nir_sd"] = np.full(grid.shape, np.nan, np.float32)
                continue
            jobs = [(i, b) for i in range(n) for b in S2_BANDS]
            reads = list(ex.map(lambda j: read_asset(scored[j[0]][1], j[1], grid, categorical=False), jobs))
            stack = np.full((n, len(S2_BANDS)) + grid.shape, np.nan, np.float32)
            for (i, b), a in zip(jobs, reads):
                if a is not None:
                    a = a.copy()
                    a[~scored[i][2]] = np.nan
                    stack[i, S2_BANDS.index(b)] = a
            with np.errstate(all="ignore"):
                med = np.nanmedian(stack, axis=0)
            for bi, b in enumerate(S2_BANDS):
                out[f"{season}_{b}"] = med[bi]
            out[f"{season}_n"] = np.isfinite(stack[:, S2_BANDS.index("nir")]).sum(0).astype(np.float32)
            if season in TEXTURE_SEASONS:
                # the spread of NIR at 10 m within each cell: sqrt(E[x^2] - E[x]^2) per scene, then the median
                fine = Grid(grid.crs, rasterio.Affine(grid.transform.a / 3, 0, grid.transform.c, 0, grid.transform.e / 3, grid.transform.f), grid.width * 3, grid.height * 3)
                nirs = list(ex.map(lambda i: read_asset(scored[i][1], "nir", fine, categorical=False), range(n)))
                sds = np.full((n,) + grid.shape, np.nan, np.float32)
                for i, a in enumerate(nirs):
                    if a is None:
                        continue
                    a = a.reshape(grid.height, 3, grid.width, 3)
                    m = np.nanmean(a, axis=(1, 3))
                    m2 = np.nanmean(a * a, axis=(1, 3))
                    sd = np.sqrt(np.maximum(m2 - m * m, 0))
                    sd[~scored[i][2]] = np.nan
                    sds[i] = sd
                with np.errstate(all="ignore"):
                    out[f"{season}_nir_sd"] = np.nanmedian(sds, axis=0)
    if verbose:
        print(f"  S2 done in {time.time() - t0:.0f} s", flush=True)
    return out


# ---- PALSAR --------------------------------------------------------------------


def palsar(grid: Grid) -> dict[str, np.ndarray]:
    import planetary_computer as pc
    import pystac_client

    out = {k: np.full(grid.shape, np.nan, np.float32) for k in ("palsar_hh", "palsar_hv")}
    try:
        cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
        items = list(cat.search(collections=["alos-palsar-mosaic"], bbox=list(grid.lonlat_box(0.001)), datetime="2019-01-01/2024-12-31").items())
    except Exception as e:  # noqa: BLE001
        print(f"  PALSAR search failed: {str(e)[:80]}")
        return out
    years = sorted({it.datetime.year for it in items}, reverse=True)[:2]
    its = [it for it in items if it.datetime.year in years]
    for pol in ("HH", "HV"):
        acc = []
        for it in its:
            try:
                got = read_window(it.assets[pol].href, grid, pad_px=2)
            except Exception as e:  # noqa: BLE001
                print(f"  PALSAR {it.id} {pol}: {str(e)[:80]}")
                continue
            if got is None:
                continue
            a, tr, crs, _ = got
            a[a <= 1] = np.nan  # 0 and 1 are no data
            db = (10 * np.log10(a * a) - 83.0).astype(np.float32)
            acc.append(onto(db, tr, str(crs), grid, categorical=False))
        if acc:
            with np.errstate(all="ignore"):
                out[f"palsar_{pol.lower()}"] = np.nanmean(np.stack(acc), axis=0)
    return out


# ---- all together ----------------------------------------------------------------


def derived(f: dict[str, np.ndarray], grid: Grid) -> None:
    def nd(a, b):
        with np.errstate(all="ignore"):
            return ((a - b) / (a + b)).astype(np.float32)

    for s in SEASONS:
        if f"{s}_nir" in f:
            f[f"{s}_ndvi"] = nd(f[f"{s}_nir"], f[f"{s}_red"])
            f[f"{s}_ndmi"] = nd(f[f"{s}_nir"], f[f"{s}_swir16"])
            f[f"{s}_nbr"] = nd(f[f"{s}_nir"], f[f"{s}_swir22"])
            f[f"{s}_ndre"] = nd(f[f"{s}_nir"], f[f"{s}_rededge1"])
    for s in ("autumn", "spring", "snow"):
        for b in ("ndvi", "nir", "red", "swir16"):
            if f"{s}_{b}" in f and f"leafon_{b}" in f:
                f[f"d_{s}_{b}"] = f[f"{s}_{b}"] - f[f"leafon_{b}"]
    if "palsar_hh" in f:
        f["palsar_ratio"] = f["palsar_hv"] - f["palsar_hh"]
    dy = f["dist_year"]
    f["since_dist"] = np.where(np.isfinite(dy) & (dy > 1900), REF_YEAR - dy, 99).astype(np.float32)
    rows, cols = np.indices(grid.shape)
    xs, ys = rasterio.transform.xy(grid.transform, rows.ravel(), cols.ravel(), offset="center")
    from rasterio.warp import transform as tf

    lon, lat = tf(grid.crs, "EPSG:4326", xs, ys)
    f["lon"] = np.array(lon, np.float32).reshape(grid.shape)
    f["lat"] = np.array(lat, np.float32).reshape(grid.shape)


def features(grid: Grid, verbose: bool = True) -> dict[str, np.ndarray]:
    t0 = time.time()
    f = national(grid)
    if verbose:
        print(f"  national rasters in {time.time() - t0:.0f} s", flush=True)
    f.update(sentinel2(grid, verbose))
    t1 = time.time()
    f.update(palsar(grid))
    if verbose:
        print(f"  PALSAR in {time.time() - t1:.0f} s", flush=True)
    derived(f, grid)
    return f


def feature_names(f: dict[str, np.ndarray] | None = None) -> list[str]:
    """The model's columns, in order: everything but the per-season scene counts."""
    base = [f"sp_{s}" for s in SPECIES] + ["closure", "height", "age", "nfiLandcover", "dist_type", "since_dist", "landcover", "elev", "slope", "tpi300", "tpi1000"]
    for s in SEASONS:
        base += [f"{s}_{b}" for b in S2_BANDS] + [f"{s}_{i}" for i in ("ndvi", "ndmi", "nbr", "ndre")]
    for s in TEXTURE_SEASONS:
        base.append(f"{s}_nir_sd")
    for s in ("autumn", "spring", "snow"):
        base += [f"d_{s}_{b}" for b in ("ndvi", "nir", "red", "swir16")]
    base += ["palsar_hh", "palsar_hv", "palsar_ratio", "lat", "lon"]
    return base


def table(f: dict[str, np.ndarray]) -> np.ndarray:
    """The features as a (cells, columns) float32 table, row-major over the grid."""
    names = feature_names()
    n = f[names[0]].size
    return np.stack([np.asarray(f[k], np.float32).reshape(n) if k in f else np.full(n, np.nan, np.float32) for k in names], axis=1)
