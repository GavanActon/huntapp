"""The canopy round each tower, at two grades, for the floor model and the terrain model.

    py -3.14 pipeline/towers/canopy_sites.py            # every NEON site with an AOP CHM
    py -3.14 pipeline/towers/canopy_sites.py BART HARV

Writes raw/towers/sites/NEON-<SITE>.json, and the same under the AmeriFlux names of the NEON
mirrors (AMF-US-xBN = BONA, ...), named as the rows' site column is, so the floor model can
join on it.

HD grade (NEON AOP, the flight recorded in raw/regimes/neon/<SITE>/<DP>/aop.json):
- CHM at 1 m, a 4 km square on the tower, artifacts over neon.chm_cap() masked: canopy height
  (median, p90, median of the tree pixels > 2 m) and closure (share > 2 m) within 50, 100 and
  250 m; edge = the distance from the tower to the nearest opening (a connected patch of
  CHM < 2 m of at least 0.1 ha, 8-connected); upwind fetch through trees for 16 bearings
  (the wind FROM 0, 22.5, ... deg) = the distance walked upwind until the first opening at
  least 30 m across (a 30 m disc fits in CHM < 2 m), capped at 2 km. A ray that leaves the
  data first gives a lower bound (fetch_censored).
- DTM: slope, aspect and TPI from neon_look.terrain (plane fit within 150 m).
SD grade (products the map has everywhere):
- height: ETH Global Canopy Height 2020, 10 m (Lang et al. 2023), windowed reads of its
  3-degree COGs on ETH's libdrive (no whole-tile download);
- closure: Hansen Global Forest Change GFC-2024-v1.12 treecover2000, 30 m, windowed reads
  from Google Cloud Storage, with lossyear (loss 2001-2024 set to 0 cover) as a second copy;
- the same height, closure, edge and fetch stats on those grids, resampled (nearest) to the
  tower's UTM at 10 m (ETH) and 30 m (Hansen). Openings: ETH height < 2 m; Hansen cover < 10%.
"""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import neon  # noqa: E402
import neon_look  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "raw" / "towers" / "sites"
RAW = neon.RAW
RADII = (50, 100, 250)
OPEN_H = 2.0            # m: CHM under this is open
EDGE_AREA = 1000.0      # m2: an opening for the edge distance (0.1 ha)
FETCH_W = 30.0          # m: an opening across for the fetch
FETCH_CAP = 2000.0      # m
BEARINGS = [i * 22.5 for i in range(16)]
AMF = {"BONA": "US-xBN", "DEJU": "US-xDJ", "HARV": "US-xHA", "RMNP": "US-xRM", "STEI": "US-xST",
       "TREE": "US-xTR", "UNDE": "US-xUN"}
ETH_URL = ("https://libdrive.ethz.ch/index.php/s/cO8or7iOe5dT2Rt/download?path=%2F3deg_cogs"
           "&files=ETH_GlobalCanopyHeight_10m_2020_{tile}_Map.tif")
HANSEN_URL = ("https://storage.googleapis.com/earthenginepartners-hansen/GFC-2024-v1.12/"
              "Hansen_GFC-2024-v1.12_{layer}_{tile}.tif")
GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", VSI_CACHE="TRUE", GDAL_HTTP_MULTIRANGE="YES",
                GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES", GDAL_HTTP_TIMEOUT="120", GDAL_HTTP_MAX_RETRY="4",
                GDAL_HTTP_RETRY_DELAY="5")


# ---------------------------------------------------------------- grid statistics

def grid_stats(H: np.ndarray, x0: float, y1: float, res: float, tx: float, ty: float, open_mask: np.ndarray,
               value: str = "height") -> dict:
    """Height (or cover) by radius, edge distance and the 16-bearing fetch on one grid.
    H: values (NaN = no data); open_mask: True where open; x0/y1: the grid's left/top edge."""
    from scipy import ndimage
    ny, nx = H.shape
    xs = x0 + (np.arange(nx) + 0.5) * res - tx
    ys = y1 - (np.arange(ny) + 0.5) * res - ty
    D = np.hypot(xs[None, :], ys[:, None]).astype(np.float32)
    ok = np.isfinite(H)
    out: dict = {"res_m": res, "by_radius": {}}
    for r in RADII:
        m = (D <= r) & ok
        v = H[m].astype(float)
        if v.size == 0:
            out["by_radius"][str(r)] = None; continue
        if value == "height":
            t = v[v > OPEN_H]
            out["by_radius"][str(r)] = {"median": round(float(np.median(v)), 2), "p90": round(float(np.percentile(v, 90)), 2),
                                        "tree_median": round(float(np.median(t)), 2) if t.size else None,
                                        "closure": round(float((v > OPEN_H).mean()), 3),
                                        "valid": round(float(m.sum() / max((D <= r).sum(), 1)), 3)}
        else:                              # percent cover
            out["by_radius"][str(r)] = {"closure": round(float(v.mean() / 100), 3),
                                        "share_over_50pct": round(float((v >= 50).mean()), 3),
                                        "valid": round(float(m.sum() / max((D <= r).sum(), 1)), 3)}
    op = open_mask & ok
    # edge: nearest connected opening of >= EDGE_AREA
    lab, n = ndimage.label(op, structure=np.ones((3, 3), bool))
    if n:
        area = ndimage.sum(op, lab, index=np.arange(1, n + 1)) * res * res
        keep = np.r_[False, area >= EDGE_AREA]
        big = keep[lab]
        out["edge_m"] = round(float(D[big].min()), 1) if big.any() else None
    else:
        out["edge_m"] = None
    if out["edge_m"] is None:
        out["edge_note"] = f"no opening of {EDGE_AREA / 1e4:.1f} ha within the grid (> {float(D[ok].max()):.0f} m)"
    edt = ndimage.distance_transform_edt(op) * res
    # the same with gaps narrower than 10 m left out: in sparse stands the gaps between crowns
    # join into one "opening" that runs through the stand, and edge_m reads ~0
    c10 = op & (edt >= 5.0)
    w10 = (ndimage.distance_transform_edt(~c10) * res <= 5.0) if c10.any() else np.zeros_like(op)
    lab, n = ndimage.label(w10, structure=np.ones((3, 3), bool))
    out["edge_m_10m_wide"] = None
    if n:
        area = ndimage.sum(w10, lab, index=np.arange(1, n + 1)) * res * res
        big = np.r_[False, area >= EDGE_AREA][lab]
        out["edge_m_10m_wide"] = round(float(D[big].min()), 1) if big.any() else None
    # fetch: first opening >= FETCH_W across along each upwind bearing
    centres = op & (edt >= FETCH_W / 2)
    wide = ndimage.distance_transform_edt(~centres) * res <= FETCH_W / 2 if centres.any() else np.zeros_like(op)
    fetch, cens = {}, {}
    step = res / 2
    for b in BEARINGS:
        s, c = math.sin(math.radians(b)), math.cos(math.radians(b))
        f, why = None, None
        for d in np.arange(0.0, FETCH_CAP + step, step):
            col = int(math.floor((tx + d * s - x0) / res)); row = int(math.floor((y1 - (ty + d * c)) / res))
            if not (0 <= row < ny and 0 <= col < nx):
                f, why = (FETCH_CAP, "cap") if d >= FETCH_CAP - res else (float(d), "grid edge"); break
            if not ok[row, col]:
                f, why = float(d), "no data"; break
            if wide[row, col]:
                f = float(d); break
        if f is None:
            f, why = FETCH_CAP, "cap"
        fetch[f"{b:g}"] = round(f, 1)
        if why:
            cens[f"{b:g}"] = why
    out["fetch_m"] = fetch
    out["fetch_censored"] = cens
    out["tower_in_opening"] = bool(wide[int((y1 - ty) // res), int((tx - x0) // res)])
    return out


# ---------------------------------------------------------------- SD products

def _eth_tiles(w, s, e, n):
    out = []
    for la in range(int(math.floor(s / 3) * 3), int(math.floor(n / 3) * 3) + 1, 3):
        for lo in range(int(math.floor(w / 3) * 3), int(math.floor(e / 3) * 3) + 1, 3):
            out.append(f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}")
    return out


def _hansen_tiles(w, s, e, n):
    out = []
    for la in range(int(math.ceil(s / 10) * 10), int(math.ceil(n / 10) * 10) + 1, 10):
        for lo in range(int(math.floor(w / 10) * 10), int(math.floor(e / 10) * 10) + 1, 10):
            out.append(f"{abs(la):02d}{'N' if la >= 0 else 'S'}_{abs(lo):03d}{'E' if lo >= 0 else 'W'}")
    return out


def sd_grid(urls: list[str], crs, tx: float, ty: float, half: float, res: float, nodata=None) -> np.ndarray:
    """Read the windows of global EPSG:4326 rasters that cover a square on the tower and resample
    them (nearest) onto the tower's UTM grid."""
    import rasterio
    from rasterio.warp import reproject, Resampling, transform_bounds
    from rasterio.windows import from_bounds
    from rasterio.transform import from_origin
    n = int(round(2 * half / res))
    dst = np.full((n, n), np.nan, dtype=np.float32)
    dtr = from_origin(tx - half, ty + half, res, res)
    w, s, e, nn = transform_bounds(crs, "EPSG:4326", tx - half, ty - half, tx + half, ty + half)
    pad = 0.002
    with rasterio.Env(**GDAL_ENV):
        for u in urls:
            try:
                with rasterio.open("/vsicurl/" + u) as r:
                    b = r.bounds
                    ww, ss, ee, nb = max(w - pad, b.left), max(s - pad, b.bottom), min(e + pad, b.right), min(nn + pad, b.top)
                    if ww >= ee or ss >= nb:
                        continue
                    win = from_bounds(ww, ss, ee, nb, r.transform).round_offsets().round_lengths()
                    a = r.read(1, window=win).astype(np.float32)
                    nd = nodata if nodata is not None else r.nodata
                    if nd is not None:
                        a[a == nd] = np.nan
                    tmp = np.full_like(dst, np.nan)
                    reproject(a, tmp, src_transform=r.window_transform(win), src_crs=r.crs, src_nodata=np.nan,
                              dst_transform=dtr, dst_crs=crs, dst_nodata=np.nan, resampling=Resampling.nearest)
                    dst = np.where(np.isfinite(tmp), tmp, dst)
            except Exception as ex:  # noqa: BLE001
                print("   SD read failed:", u.split("/")[-1][-60:], type(ex).__name__, str(ex)[:120])
    return dst


# ---------------------------------------------------------------- per site

def site_file(site: str) -> dict | None:
    rows = json.loads((RAW / site / "rows.json").read_text()) if (RAW / site / "rows.json").exists() else {}
    meta = json.loads((RAW / site / "site.json").read_text()) if (RAW / site / "site.json").exists() else {}
    aopc = RAW / site / "DP3.30015.001" / "aop.json"
    aopd = RAW / site / "DP3.30024.001" / "aop.json"
    if not aopc.exists():
        print(site, "no CHM"); return None
    ac = json.loads(aopc.read_text())
    ad = json.loads(aopd.read_text()) if aopd.exists() else {}
    lat, lon = rows.get("lat") or meta.get("tower_lat"), rows.get("lon") or meta.get("tower_lon")
    t0 = time.time()
    m = neon.chm_mosaic(site, half=2000.0)
    Z, x0, y1, res, tx, ty, crs = m
    hd = grid_stats(Z, x0, y1, res, tx, ty, Z < OPEN_H)
    hd["source"] = (f"NEON AOP DP3.30015.001 CHM 1 m, flight {ac['month']} ({ac.get('release')}), "
                    f"{len(ac['tiles'])} tiles, 4 km square; artifacts over {neon.chm_cap(site):.1f} m masked")
    hd["data_cover_2km"] = round(float(np.isfinite(Z).mean()), 3)
    ter = neon_look.terrain(site, lat, lon)
    if ter and "r150" in ter:
        hd["terrain"] = {"source": f"NEON AOP DP3.30024.001 DTM 1 m (5 m means), flight {ad.get('month')} ({ad.get('release')})",
                         "slope_deg": ter["r150"]["slope"], "aspect_deg": ter["r150"]["downslope"],
                         "upslope_deg": ter["r150"]["upslope"],
                         "note": "plane fit within 150 m; aspect = the way the ground falls (faces); upslope = aspect + 180",
                         "slope_by_radius": {k[1:]: ter[k]["slope"] for k in ("r75", "r150", "r300", "r500", "r1000") if k in ter},
                         "aspect_by_radius": {k[1:]: ter[k]["downslope"] for k in ("r75", "r150", "r300", "r500", "r1000") if k in ter},
                         "tpi500_m": ter.get("tpi500"), "tpi1000_m": ter.get("tpi1000"), "tpi500_z": ter.get("tpi500_z"),
                         "relief1000_m": ter.get("relief1000")}
    t1 = time.time()
    # SD
    from rasterio.warp import transform_bounds
    half = 2200.0
    bb = transform_bounds(crs, "EPSG:4326", tx - half, ty - half, tx + half, ty + half)
    eth_tiles = _eth_tiles(*bb)
    han_tiles = _hansen_tiles(*bb)
    cache = RAW / site / "sd_grids.npz"
    if cache.exists():
        g = np.load(cache); H10, TC, LY = g["eth"], g["tc"], g["ly"]
    else:
        H10 = sd_grid([ETH_URL.format(tile=t) for t in eth_tiles], crs, tx, ty, half, 10.0, nodata=255)
        TC = sd_grid([HANSEN_URL.format(layer="treecover2000", tile=t) for t in han_tiles], crs, tx, ty, half, 30.0)
        LY = sd_grid([HANSEN_URL.format(layer="lossyear", tile=t) for t in han_tiles], crs, tx, ty, half, 30.0)
        if np.isfinite(H10).any() or np.isfinite(TC).any():
            np.savez_compressed(cache, eth=H10, tc=TC, ly=LY)
    x0s, y1s = tx - half, ty + half
    sd: dict = {"height_source": "ETH Global Canopy Height 2020, 10 m (Lang et al. 2023, Nat. Ecol. Evol.); "
                                 f"COG tiles {', '.join(eth_tiles)} read by window from libdrive.ethz.ch (share cO8or7iOe5dT2Rt, 3deg_cogs)",
                "closure_source": "Hansen et al. Global Forest Change GFC-2024-v1.12 treecover2000 and lossyear, 30 m; "
                                  f"tiles {', '.join(han_tiles)} read by window from storage.googleapis.com/earthenginepartners-hansen"}
    if np.isfinite(H10).any():
        sd["eth_height"] = grid_stats(H10, x0s, y1s, 10.0, tx, ty, H10 < OPEN_H)
    else:
        sd["eth_height"] = None; sd["height_note"] = "ETH canopy height not readable"
    if np.isfinite(TC).any():
        TCL = np.where((LY >= 1) & (LY <= 24), 0.0, TC).astype(np.float32)
        sd["hansen_treecover2000"] = grid_stats(TC, x0s, y1s, 30.0, tx, ty, TC < 10, value="cover")
        sd["hansen_after_loss"] = grid_stats(TCL, x0s, y1s, 30.0, tx, ty, TCL < 10, value="cover")
        r250 = (np.hypot(*np.meshgrid((np.arange(TC.shape[1]) + .5) * 30 - half, (np.arange(TC.shape[0]) + .5) * 30 - half)) <= 250)
        ly = LY[r250 & np.isfinite(LY)]
        sd["hansen_loss_within_250m"] = {"share": round(float(((ly >= 1) & (ly <= 24)).mean()), 3) if ly.size else None,
                                         "years": sorted({2000 + int(v) for v in np.unique(ly) if 1 <= v <= 24})}
    out = {"site": f"NEON-{site}", "neon_site": site, "name": meta.get("name"), "lat": lat, "lon": lon,
           "elev_m": meta.get("tower_elev") or meta.get("elev"), "stand": neon_look.STAND.get(site),
           "neon_canopy_h": meta.get("canopy_h"), "rows_canopy_h": rows.get("canopy_h"), "rows_canopy_src": rows.get("canopy_src"),
           "floor_z": rows.get("floor"), "top_z": rows.get("top"),
           "hd": hd, "sd": sd,
           "definitions": {"open": f"CHM < {OPEN_H} m (HD, ETH); Hansen cover < 10%", "edge_area_m2": EDGE_AREA,
                           "edge_m_10m_wide": "edge distance counting only openings at least 10 m across (sparse stands)",
                           "fetch_opening_across_m": FETCH_W, "fetch_cap_m": FETCH_CAP,
                           "fetch_bearing": "wind FROM, deg true; distance walked upwind from the tower",
                           "closure": "share of pixels > 2 m (height grids) or mean percent cover / 100 (Hansen)"},
           "written": time.strftime("%Y-%m-%d %H:%M")}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"NEON-{site}.json").write_text(json.dumps(out, indent=1))
    if site in AMF:
        a = dict(out, site=f"AMF-{AMF[site]}", same_tower_as=f"NEON-{site}",
                 note="AmeriFlux mirror of the NEON tower; canopy from NEON's AOP and the global products at the same point. "
                      "The AMF rows carry their own canopy_h (BIF HEIGHTC / fit.py); use these stats in its place if they differ.")
        (OUT / f"AMF-{AMF[site]}.json").write_text(json.dumps(a, indent=1))
    h = hd["by_radius"]["100"]; e = (sd.get("eth_height") or {}).get("by_radius", {}).get("100") or {}
    hc = (sd.get("hansen_treecover2000") or {}).get("by_radius", {}).get("100") or {}
    print(f"{site}: HD r100 tree {h['tree_median']} m, closure {h['closure']}, edge {hd['edge_m']} m, "
          f"fetch median {np.median(list(hd['fetch_m'].values())):.0f} m | SD ETH r100 median {e.get('median')} m, "
          f"closure {e.get('closure')}, edge {(sd.get('eth_height') or {}).get('edge_m')} | Hansen r100 {hc.get('closure')} "
          f"| {t1 - t0:.0f} s HD, {time.time() - t1:.0f} s SD")
    return out


def main() -> None:
    sites = [s.upper() for s in sys.argv[1:]] or sorted(p.parent.parent.name for p in RAW.glob("*/DP3.30015.001/aop.json"))
    for s in sites:
        try:
            site_file(s)
        except Exception as e:  # noqa: BLE001
            import traceback; traceback.print_exc()
            print(s, "failed:", type(e).__name__, e)


if __name__ == "__main__":
    main()
