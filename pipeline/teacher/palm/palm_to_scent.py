"""The scent a PALM run carried, read back into the app's own measure
(docs/SCENT-TEACHER.md): every run built by build_case.py releases up to ten
passive particle groups (one per source); this turns PALM's binary particle
output into

  <run>_particles.npz   every write: t, x, y, z (m from the domain's SW corner,
                        z over the lowest ground), origin, group, age
  <run>_scent.json      per source: the how-often bands' reach by sector, the
                        plume's bearing and width with distance, the vertical
                        spread, the share under the canopy, and the
                        intermittency at fixed distances
  <run>_scent_<k>.npz   per source: the how-often grid (share of minutes a
                        nose gets noticeable scent) on the app's 10 m grid,
                        row 0 north, plus the minute-by-minute nose-height
                        concentration
  <run>_scent.png       the bands of every source over the terrain

    py -3.14 pipeline/teacher/palm/palm_to_scent.py read pickle-slot pickle-slot_s186_4m --tag 4m
    py -3.14 pipeline/teacher/palm/palm_to_scent.py bands pickle-slot pickle-slot_s186_4m --tag 4m
    py -3.14 pipeline/teacher/palm/palm_to_scent.py selftest

The binary format (lagrangian_particle_model_mod.f90, lpm_data_output_particles,
unit 85): per rank a Fortran unformatted sequential file, each write a record
of simulated_time (one double), a record of prt_count (ignored), then one
record per grid cell holding that cell's particle_type array. particle_type is
20 doubles, two int32, one int64, a logical, two int32: 188 bytes, unpadded
(gfortran, x86-64; measured on the first run). Five header records open the
file. The reader checks the layout against the record lengths.

The how-often measure is the app's (scent.ts oftenGrid): a minute is
noticeable at a cell when its nose-height concentration is at least NOSE of
what a steady minute gives the plume's core 20-40 m out; the bands are the
share of minutes: most (>= 50%), some (>= 15%), now and then (>= 3%).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
RAW = HERE.parents[1] / "raw" / "teacher" / "palm"
FIELDS = RAW / "fields"
NOSE = 0.055            # scent.ts NOSE
NOSE_H = 1.0            # a deer's nose, m over the ground
NOSE_BAND = 2.5         # particles this far up still count for a nose (the app's reflected puff at 1 m)
BANDS = [0.5, 0.15, 0.03]
CELL = 10.0             # the app's scent grid
REC_SIZE = 188          # bytes per particle_type (gfortran packs the derived type: no tail padding)

PARTICLE_DT = np.dtype([
    ("aux1", "<f8"), ("aux2", "<f8"), ("radius", "<f8"), ("age", "<f8"), ("age_m", "<f8"), ("dt_sum", "<f8"),
    ("e_m", "<f8"), ("origin_x", "<f8"), ("origin_y", "<f8"), ("origin_z", "<f8"), ("rvar1", "<f8"), ("rvar2", "<f8"),
    ("rvar3", "<f8"), ("speed_x", "<f8"), ("speed_y", "<f8"), ("speed_z", "<f8"), ("weight", "<f8"),
    ("x", "<f8"), ("y", "<f8"), ("z", "<f8"), ("class", "<i4"), ("group", "<i4"), ("id", "<i8"),
    ("mask", "<i4"), ("block_nr", "<i4"), ("io_id", "<i4"),
])
HEADER_RECORDS = 5      # check_open writes five records when unit 85 is first opened (a version string, grid bounds...)
assert PARTICLE_DT.itemsize == REC_SIZE


# ---------------------------------------------------------------- reading

def records(path: Path):
    """Fortran unformatted sequential records: (4-byte length, payload, 4-byte length)."""
    data = np.fromfile(path, np.uint8)
    pos, n = 0, len(data)
    while pos + 4 <= n:
        ln = int(data[pos:pos + 4].view("<i4")[0])
        if ln < 0 or pos + 8 + ln > n:
            raise ValueError(f"{path.name}: bad record length {ln} at byte {pos}")
        yield data[pos + 4:pos + 4 + ln]
        pos += 8 + ln


def read_rank(path: Path) -> list[tuple[float, np.ndarray]]:
    """[(time, particles)] for one rank's file."""
    out, cur_t, parts, expect_count = [], None, [], False
    for i, rec in enumerate(records(path)):
        if i < HEADER_RECORDS:
            continue
        if expect_count:
            expect_count = False  # prt_count: the counts per cell, which the particles carry themselves
            continue
        if len(rec) == 8:
            if cur_t is not None:
                out.append((cur_t, np.concatenate(parts) if parts else np.zeros(0, PARTICLE_DT)))
            cur_t, parts, expect_count = float(rec.view("<f8")[0]), [], True
            continue
        if len(rec) % REC_SIZE:
            raise ValueError(f"{path.name}: a record of {len(rec)} bytes is not whole particles of {REC_SIZE}")
        parts.append(rec.view(PARTICLE_DT))
    if cur_t is not None:
        out.append((cur_t, np.concatenate(parts) if parts else np.zeros(0, PARTICLE_DT)))
    return out


def read(args) -> None:
    info, run = load_run(args.case, args.run, args.tag)
    out_dir = Path(args.output) if args.output else HERE / args.case / "JOBS" / args.run / "OUTPUT"
    folder = find_prt(out_dir, args.prefix or args.run)
    name = args.as_name or args.run
    if folder is None:
        raise SystemExit(f"no particle output under {out_dir} (<run>_prt_bin/ or PARTICLE_DATA/)")
    files = sorted(p for p in folder.iterdir() if p.is_file())
    # a half-copied run (the link broke, 2026-10-15) has fewer rank files than PEs: refuse, never read part of it
    for cpu in sorted((out_dir.parent / "MONITORING").glob("*_cpu*")):
        for line in cpu.read_text(encoding="utf-8", errors="replace").splitlines()[:8]:
            if "CPU measures for" in line:
                pes = int(line.split("for")[1].split("PEs")[0])
                if len(files) < pes:
                    raise SystemExit(f"{folder.name}: {len(files)} rank files of {pes} PEs: the copy is not complete")
        break
    by_t: dict[float, list[np.ndarray]] = {}
    for fp in files:
        for t, parts in read_rank(fp):
            by_t.setdefault(round(t, 3), []).append(parts)
    times = sorted(by_t)
    allp = [np.concatenate(by_t[t]) for t in times]
    keep = [p[p["mask"] != 0] for p in allp]
    n = [len(p) for p in keep]
    print(f"{args.run}: {len(files)} rank files, {len(times)} writes from {times[0]:.0f} to {times[-1]:.0f} s, "
          f"{min(n)}-{max(n)} particles alive, groups {sorted(set(int(g) for p in keep for g in np.unique(p['group'])))}")
    to = Path(args.to) if args.to else FIELDS   # --to: next to the run on xonix, so only this file crosses the link
    to.mkdir(parents=True, exist_ok=True)
    T = np.repeat(np.array(times, np.float32), n)
    cat = np.concatenate(keep)
    np.savez_compressed(to / f"{name}_particles.npz", t=T,
                        x=cat["x"].astype(np.float32), y=cat["y"].astype(np.float32), z=cat["z"].astype(np.float32),
                        ox=cat["origin_x"].astype(np.float32), oy=cat["origin_y"].astype(np.float32),
                        oz=cat["origin_z"].astype(np.float32), group=cat["group"].astype(np.int16),
                        age=cat["age"].astype(np.float32), times=np.array(times, np.float64))
    print(f"  -> {to / (name + '_particles.npz')}")


def find_prt(out_dir: Path, run: str) -> Path | None:
    """palmrun copies PARTICLE_DATA out as <run>_prt_bin.<cycle>/ (per-rank files _000000...)."""
    cands = sorted(out_dir.glob(f"{run}_prt_bin*")) + [out_dir / "PARTICLE_DATA", out_dir]
    for cand in cands:
        if cand.is_dir() and any(p.is_file() and p.name.startswith("_") for p in cand.iterdir()):
            return cand
    return None


def sources_from_particles(P, listed: list[dict], dem_model, canopy_h, dx, size, nx, ny) -> list[dict]:
    """One source per particle group, at the median origin of its unwrapped rows (a wrapped particle's
    origin is shifted by the box; the median ignores it); the height from origin_z over the model ground."""
    out = []
    for k in sorted(int(g) for g in np.unique(P["group"])):
        m = P["group"] == k
        # the most common origin (to 1 m): wrapped rows carry origins shifted by the box, and with a wind
        # along the box more than half the rows can be wrapped, so a median would land on a shifted one
        key = np.round(P["ox"][m]).astype(np.int32) * 100000 + np.round(P["oy"][m]).astype(np.int32)
        vals, counts = np.unique(key, return_counts=True); best = vals[np.argmax(counts)]
        near = m.copy(); near[m] = key == best
        ox, oy = float(np.median(P["ox"][near])), float(np.median(P["oy"][near]))
        c = min(nx - 1, max(0, int(ox / dx))); r = min(ny - 1, max(0, int((size - oy) / dx)))
        # origin_z is the namelist's psb (height over the cell's ground with seed_follows_topography), not an absolute z
        h = float(np.median(P["oz"][near]))
        h = 5.0 if abs(h - 5.0) < 1.5 else (1.5 if abs(h - 1.5) < 1.5 else round(h, 1))
        match = next((sv for sv in listed if math.hypot(sv["x"] - ox, sv["y"] - oy) < 3.0 and abs(sv["h"] - h) < 1.0), None)
        label = match["name"] if match else f"group {k} at ({ox:.0f}, {oy:.0f}) {h:g} m"
        out.append(dict(name=label, x=round(ox, 1), y=round(oy, 1), h=h, group=k, ground_m=round(float(dem_model[r, c]), 1),
                        canopy_m=round(float(canopy_h[r, c]), 1), water=bool(canopy_h[r, c] == 0 and dem_model[r, c] <= 0.05),
                        listed=bool(match)))
    return out


def load_run(case: str, run: str, tag: str) -> tuple[dict, dict]:
    sfx = f"-{tag}" if tag else ""
    info = json.loads((HERE / case / f"case{sfx}.json").read_text(encoding="utf-8"))
    if run not in info["runs"]:
        raise SystemExit(f"{run} is not a run of {case}{sfx}: {', '.join(info['runs'])}")
    return info, info["runs"][run]


# ---------------------------------------------------------------- the bands

def bands(args) -> None:
    info, run = load_run(args.case, args.run, args.tag)
    sfx = f"-{args.tag}" if args.tag else ""
    grid = np.load(HERE / args.case / f"grid{sfx}.npz")
    dem_model = grid["dem_model"].astype(np.float64) - info["origin_z"]   # row 0 north, m over the lowest ground
    canopy_h = grid["canopy_h"].astype(np.float64)
    dx = info["dx"]; nx, ny = info["nx"], info["ny"]
    size = nx * dx
    name = args.as_name or args.run
    P = np.load(FIELDS / f"{name}_particles.npz")
    # the sources from the particles themselves (each carries its origin), so a case rebuilt while the run
    # waited in a queue cannot mislabel it; the case's list only lends names to groups it still has
    sources = sources_from_particles(P, run.get("scent") or [], dem_model, canopy_h, dx, size, nx, ny)
    times = P["times"]; t_all = P["t"]
    end = run["hours"] * 3600.0; avg = min(run["average_s"], end / 2)
    win = (t_all >= end - avg - 1e-6)
    print(f"{args.run}: {len(times)} writes, {int(win.sum())} particle rows in the {avg:g} s window, {len(sources)} sources")

    # cell lookups (row 0 north)
    def ground_at(x, y):
        c = np.clip((x / dx).astype(int), 0, nx - 1); r = np.clip(((size - y) / dx).astype(int), 0, ny - 1)
        return dem_model[r, c], canopy_h[r, c]

    G = int(round(size / CELL)); summary = {}
    minutes = np.arange(end - avg, end, 60.0)
    fig_layers = []
    for sv in sources:
        k = sv["group"]
        sel = win & (P["group"] == k)
        # a particle that went out through a cyclic edge and came back in carries an origin shifted by the
        # box (PALM moves origin_x/y with it): those have left the place, drop them (runs before the
        # lateral 'absorb' of 2026-10-14 are full of them)
        wrapped = np.hypot(P["ox"] - sv["x"], P["oy"] - sv["y"]) > 3.0
        n_wrapped = int((sel & wrapped).sum()); sel &= ~wrapped
        x, y, z, t = P["x"][sel], P["y"][sel], P["z"][sel], t_all[sel]
        if len(x) == 0:
            print(f"  {k} {sv['name']}: no particles"); continue
        g0, ch = ground_at(x, y); agl = z - g0
        nose = agl <= NOSE_BAND
        # minute-by-minute nose-height concentration on the 10 m grid: particles per cell per write, averaged over the minute
        conc = np.zeros((len(minutes), G, G), np.float32)
        c = np.clip((x / CELL).astype(int), 0, G - 1); r = np.clip(((size - y) / CELL).astype(int), 0, G - 1)
        mi = np.clip(((t - minutes[0]) / 60.0).astype(int), 0, len(minutes) - 1)
        writes_per_min = max(1, int(round(60.0 / float(np.median(np.diff(times))))))
        np.add.at(conc, (mi[nose], r[nose], c[nose]), 1.0 / writes_per_min)
        # the core: the steady level 20-40 m out, as scent.ts takes it (not the source cell's spike)
        sx, sy = sv["x"], sv["y"]
        cc, rr = np.meshgrid(np.arange(G) * CELL + CELL / 2, size - (np.arange(G) * CELL + CELL / 2))
        dist = np.hypot(cc - sx, rr - sy)
        mean = conc.mean(axis=0)
        ring = (dist >= 20) & (dist <= 40)
        core = float(mean[ring].max()) if ring.any() and mean[ring].max() > 0 else float(mean.max())
        often = (conc >= NOSE * core).mean(axis=0) if core > 0 else np.zeros((G, G), np.float32)
        # reach by band and by sector (the app's card: how far it stays noticeable, by direction)
        bearing = (np.degrees(np.arctan2(cc - sx, rr - sy)) + 360) % 360
        sectors = {}
        for s0 in range(0, 360, 45):
            m = (bearing >= s0) & (bearing < s0 + 45) & (dist > CELL)
            sectors[f"{s0:03d}"] = {f"{b:g}": (float(dist[m & (often >= b)].max()) if (m & (often >= b)).any() else 0.0) for b in BANDS}
        # the plume with distance: bearing of the centroid, lateral width, vertical spread, canopy share
        with_dist = {}
        for d0, d1 in ((10, 30), (30, 60), (60, 120), (120, 240), (240, 480)):
            pd = np.hypot(x - sx, y - sy); m = (pd >= d0) & (pd < d1)
            if m.sum() < 20:
                continue
            bx, by = (x[m] - sx).mean(), (y[m] - sy).mean()
            brg = (math.degrees(math.atan2(bx, by)) + 360) % 360
            along = np.array([math.sin(math.radians(brg)), math.cos(math.radians(brg))])
            across = (x[m] - sx) * along[1] - (y[m] - sy) * along[0]
            with_dist[f"{d0}-{d1}"] = dict(toward=round(brg), sigma_y=round(float(across.std()), 1),
                                           sigma_z=round(float(agl[m].std()), 1), z_mean=round(float(agl[m].mean()), 1),
                                           under_canopy=round(float((agl[m] < ch[m]).mean()), 2), n=int(m.sum()))
        # intermittency: at the centroid's bearing, the share of writes with any nose-height particle in the 10 m cell
        inter = {}
        for d in (20, 50, 100, 200):
            key = next((k2 for k2 in with_dist if int(k2.split("-")[0]) <= d < int(k2.split("-")[1])), None)
            if key is None:
                continue
            brg = math.radians(with_dist[key]["toward"])
            tx, ty = sx + d * math.sin(brg), sy + d * math.cos(brg)
            cx_, ry_ = int(tx / CELL), int((size - ty) / CELL)
            if not (0 <= cx_ < G and 0 <= ry_ < G):
                continue
            hit = nose & (c == cx_) & (r == ry_)
            inter[str(d)] = round(float(len(np.unique(t[hit])) / max(1, len(np.unique(t)))), 3)
        summary[str(k)] = dict(source=sv, core_per_write=round(core, 4), particles=int(len(x)), wrapped_dropped=n_wrapped,
                               reach_by_sector=sectors, with_distance=with_dist, intermittency=inter,
                               area_ha={f"{b:g}": round(float((often >= b).sum()) * CELL * CELL / 1e4, 2) for b in BANDS})
        np.savez_compressed(FIELDS / f"{name}_scent_{k}.npz", often=often.astype(np.float32), conc=conc, minutes=minutes,
                            cell=CELL, source=np.array([sx, sy, sv["h"]]))
        fig_layers.append((k, sv, often))
        far = max(v["0.15"] for v in sectors.values())
        print(f"  {k} {sv['name']}: {len(x)} rows ({n_wrapped} wrapped through a cyclic edge dropped), some-minutes reach {far:.0f} m, toward "
              + ", ".join(f"{k2}: {v['toward']:03d}" for k2, v in with_dist.items()))
    (FIELDS / f"{name}_scent.json").write_text(json.dumps(dict(run=args.run, name=name, nose=NOSE, bands=BANDS, cell=CELL,
                                                                    sources=summary), indent=1), encoding="utf-8")
    draw(name, info, grid, fig_layers, size)
    print(f"  -> {FIELDS / (name + '_scent.json')}, _scent_<k>.npz, _scent.png")


def draw(run: str, info: dict, grid, layers, size: float) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LightSource
    dem = grid["dem"].astype(np.float64)
    fig, ax = plt.subplots(figsize=(9, 9), facecolor="#08140f")
    ls = LightSource(315, 45)
    rgb = ls.shade(dem, cmap=plt.get_cmap("Greys_r"), vert_exag=1.5, blend_mode="overlay", dx=info["dx"], dy=info["dx"])
    ax.imshow(rgb, extent=(0, size, 0, size), alpha=0.9)
    water = grid["water"]
    ax.imshow(np.where(water, 1.0, np.nan), extent=(0, size, 0, size), cmap="Blues", vmin=0, vmax=1.6, alpha=0.5)
    cols = plt.get_cmap("tab10")
    for k, sv, often in layers:
        G = often.shape[0]
        for b, a in zip(BANDS, (0.55, 0.32, 0.16)):
            ax.contourf(np.linspace(0, size, G, endpoint=False) + size / G / 2, size - (np.linspace(0, size, G, endpoint=False) + size / G / 2),
                        often, levels=[b, 1.01], colors=[cols(k % 10)], alpha=a)
        ax.plot(sv["x"], sv["y"], "o", color=cols(k % 10), ms=6, mec="white")
        ax.annotate(f"{k}", (sv["x"], sv["y"]), xytext=(4, 4), textcoords="offset points", color="white", fontsize=8)
    ax.set_xlim(0, size); ax.set_ylim(0, size); ax.set_aspect("equal"); ax.set_facecolor("#08140f")
    ax.tick_params(colors="#93a58c", labelsize=8)
    ax.set_title(f"{run}: where scent is noticeable most / some / now-and-then minutes\n"
                 + "; ".join(f"{k} {sv['name']}" for k, sv, _ in layers), color="#f1e9d6", fontsize=9)
    fig.savefig(FIELDS / f"{run}_scent.png", dpi=110, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)


# ---------------------------------------------------------------- selftest

def selftest(args) -> None:
    """Write a file in PALM's format from numpy and read it back."""
    import tempfile
    rng = np.random.default_rng(1)
    tmp = Path(tempfile.mkdtemp()) / "_000000"

    def rec(payload: bytes) -> bytes:
        ln = np.array([len(payload)], "<i4").tobytes()
        return ln + payload + ln

    parts = []
    with open(tmp, "wb") as fh:
        for hdr in (b"x" * 210, b"y" * 80, np.array([1.0], "<f8").tobytes(), b"z" * 320, b"w" * 28):
            fh.write(rec(hdr))
        for t in (10.0, 20.0):
            fh.write(rec(np.array([t], "<f8").tobytes()))
            fh.write(rec(np.zeros(5 * 7 * 9, "<i4").tobytes()))
            for cell in range(3):
                n = cell + 1
                a = np.zeros(n, PARTICLE_DT)
                a["x"] = rng.uniform(0, 100, n); a["y"] = rng.uniform(0, 100, n); a["z"] = rng.uniform(0, 10, n)
                a["group"] = cell + 1; a["mask"] = 1; a["age"] = t
                parts.append(a)
                fh.write(rec(a.tobytes()))
    got = read_rank(tmp)
    assert [g[0] for g in got] == [10.0, 20.0], got
    assert [len(g[1]) for g in got] == [6, 6]
    assert np.allclose(got[1][1]["x"], np.concatenate(parts[3:])["x"])
    assert list(got[0][1]["group"]) == [1, 2, 2, 3, 3, 3]
    print("selftest ok: two writes of six particles read back from the Fortran records")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("read", help="PALM's binary particle output -> <run>_particles.npz")
    a.add_argument("case"); a.add_argument("run"); a.add_argument("--tag", default="")
    a.add_argument("--output", help="the run's OUTPUT folder (default the case's JOBS/<run>/OUTPUT)")
    a.add_argument("--prefix", help="the output files' name prefix when palmrun ran under another name (run_case.sh --name)")
    a.add_argument("--as", dest="as_name", help="name the products after this instead of the run key")
    a.add_argument("--to", help="write <name>_particles.npz here instead of fields/ (ship_run.sh, on the machine that ran it)")
    a.set_defaults(fn=read)
    b = sub.add_parser("bands", help="<run>_particles.npz -> the how-often bands per source, a summary and a picture")
    b.add_argument("case"); b.add_argument("run"); b.add_argument("--tag", default="")
    b.add_argument("--as", dest="as_name", help="the name `read` used")
    b.set_defaults(fn=bands)
    c = sub.add_parser("selftest"); c.set_defaults(fn=selftest)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
