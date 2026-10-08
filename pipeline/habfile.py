"""The band-file container the app's grids are kept in (.hab): the habitat
grid, the microclimate grid and the going grid, each a lattice of bands.

Two layouts are read; one is written.

v1 (until 2026-10-07): gzip( u32 header-length · JSON header · bands… ),
    one stream, so the phone had to pull the whole file (the micro grid's
    6 MB, 4 MB of it the momentum solve's 16 directions) before it could
    read a byte of it.

v2: "HAB2" · u32 header-length · JSON header · band blobs…, each band its
    own zlib stream, with its byte offset and length in the header, so the
    app reads just the bands it needs by HTTP range (or a slice of the
    stored copy): the base bands first, the two momentum directions the
    hour's wind sits between next, the rest when the map is up. The bands a
    writer names `late` go last, and header["first"] is where they start
    (relative to the data start, after the header), the one range the page
    asks for before the app has loaded. Size is the same as v1 within 2%.

Header fields the app reads: region, generated, cols, rows, west, north,
dLon, dLat, cellM, coverNames, landformNames, lakes, bands[{name, dtype,
scale, offset, meaning}], and for v2 codec, first and per band cOff, cLen.
"""
from __future__ import annotations

import gzip
import json
import struct
import zlib
from pathlib import Path
from typing import Iterable

import numpy as np

MAGIC = b"HAB2"
LEVEL = 9

Band = tuple[str, np.ndarray, float, str]  # name, array, scale, meaning


def write_hab(path: Path, header: dict, bands: list[Band], late: Iterable[str] = (), early: Iterable[str] = ()) -> dict:
    """Write bands as a v2 file; returns {raw, size, bands}. `header` is
    copied with its bands list replaced (and codec/first added). Bands named
    `early` go first (the preview's; header["previewEnd"] is where they end),
    `late` last (header["first"] is where they start)."""
    late = set(late)
    early = set(early)
    ordered = [b for b in bands if b[0] in early] + [b for b in bands if b[0] not in late and b[0] not in early] + [b for b in bands if b[0] in late]
    h = dict(header)
    h["bands"] = []
    h["codec"] = "zlib"
    blobs: list[bytes] = []
    raw_off = 0
    c_off = 0
    first = None
    preview_end = 0
    for name, arr, scale, meaning in ordered:
        arr = np.ascontiguousarray(arr)
        raw = arr.tobytes()
        c = zlib.compress(raw, LEVEL)
        if name in late and first is None:
            first = c_off
        h["bands"].append({"name": name, "dtype": str(arr.dtype), "scale": scale, "offset": raw_off, "meaning": meaning, "cOff": c_off, "cLen": len(c)})
        raw_off += len(raw)
        c_off += len(c)
        if name in early:
            preview_end = c_off
        blobs.append(c)
    h["first"] = c_off if first is None else first
    if early:
        h["previewEnd"] = preview_end
    hj = json.dumps(h, separators=(",", ":")).encode("utf-8")
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".part")
    with open(tmp, "wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<I", len(hj)))
        f.write(hj)
        for c in blobs:
            f.write(c)
    tmp.replace(path)
    return {"raw": raw_off, "size": path.stat().st_size, "bands": len(ordered)}


def read_header(path: Path) -> dict:
    """A file's header alone (v1 or v2)."""
    path = Path(path)
    with open(path, "rb") as f:
        head = f.read(8)
        if head[:4] == MAGIC:
            n = struct.unpack("<I", head[4:8])[0]
            return json.loads(f.read(n))
    with gzip.open(path, "rb") as g:
        n = struct.unpack("<I", g.read(4))[0]
        return json.loads(g.read(n))


def band_shape(header: dict, name: str) -> tuple[int, int]:
    """(rows, cols) of a band: the preview's lattice for a p: band, else the grid's."""
    pv = header.get("preview")
    if pv and name.startswith(PREVIEW_PREFIX):
        return pv["rows"], pv["cols"]
    return header["rows"], header["cols"]


def read_hab_raw(path: Path, want: Iterable[str] | None = None) -> tuple[dict, dict[str, np.ndarray]]:
    """Header and bands as stored (unscaled, the file's dtype), by name;
    `want` limits which (None: every band). v1 or v2."""
    path = Path(path)
    want_set = None if want is None else set(want)
    data = path.read_bytes()
    out: dict[str, np.ndarray] = {}
    if data[:4] == MAGIC:
        n = struct.unpack("<I", data[4:8])[0]
        h = json.loads(data[8 : 8 + n])
        base = 8 + n
        for b in h["bands"]:
            if want_set is not None and b["name"] not in want_set:
                continue
            rows, cols = band_shape(h, b["name"])
            raw = zlib.decompress(data[base + b["cOff"] : base + b["cOff"] + b["cLen"]])
            out[b["name"]] = np.frombuffer(raw, dtype=np.dtype(b["dtype"]), count=rows * cols).reshape(rows, cols)
        return h, out
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    n = struct.unpack("<I", data[:4])[0]
    h = json.loads(data[4 : 4 + n])
    base = 4 + n
    cells = h["cols"] * h["rows"]
    for b in h["bands"]:
        if want_set is not None and b["name"] not in want_set:
            continue
        out[b["name"]] = np.frombuffer(data, dtype=np.dtype(b["dtype"]), count=cells, offset=base + b["offset"]).reshape(h["rows"], h["cols"])
    return h, out


def read_hab(path: Path, want: Iterable[str] | None = None) -> tuple[dict, dict[str, np.ndarray]]:
    """Header and bands scaled to float32, by name (what most of the pipeline reads)."""
    h, raw = read_hab_raw(path, want)
    scale = {b["name"]: b["scale"] for b in h["bands"]}
    return h, {k: v.astype(np.float32) * scale[k] for k, v in raw.items()}


def late_bands(header: dict) -> list[str]:
    """The momentum solve's bands, the ones the app fetches second."""
    return [b["name"] for b in header["bands"] if b["name"][:2] in ("mU", "mV", "mT") and b["name"][2:3].isdigit()]


PREVIEW_PREFIX = "p:"
PREVIEW_STEP = 3


def with_preview(header: dict, bands: list[Band], skip: Iterable[str] = (), step: int = PREVIEW_STEP) -> tuple[dict, list[Band], list[str]]:
    """A coarse copy of the bands (every `step`th cell each way, the middle
    one of each block) for the first seconds of a cold open: the app draws
    the wind on it while the full bands come, a third of a megabyte against
    two and a half. Returns the header with its `preview` lattice, the bands
    with the preview's (named p:<name>) added, and the preview bands' names.
    `skip` names bands left out of it (the momentum solve's)."""
    skip = set(skip)
    half = step // 2
    pbands: list[Band] = []
    for name, arr, scale, meaning in bands:
        if name in skip or name.startswith(PREVIEW_PREFIX):
            continue
        pbands.append((PREVIEW_PREFIX + name, np.ascontiguousarray(arr[half::step, half::step]), scale, f"preview of {name}: every {step}rd cell"))
    if not pbands:
        return header, bands, []
    rows, cols = pbands[0][1].shape
    h = dict(header)
    h["preview"] = {
        "cols": cols,
        "rows": rows,
        "west": header["west"],
        "north": header["north"],
        "dLon": header["dLon"] * step,
        "dLat": header["dLat"] * step,
        "cellM": [round(header["cellM"][0] * step, 1), round(header["cellM"][1] * step, 1)],
        "step": step,
    }
    return h, [b for b in bands if not b[0].startswith(PREVIEW_PREFIX)] + pbands, [b[0] for b in pbands]


def convert(path: Path, out: Path | None = None, preview: bool | None = None) -> dict:
    """Rewrite a v1 file as v2 (or re-pack a v2 one), the momentum bands
    last and, for a micro grid (`preview` unsaid), a preview of the base
    bands first."""
    path = Path(path)
    h, raw = read_hab_raw(path)
    scale = {b["name"]: b["scale"] for b in h["bands"]}
    meaning = {b["name"]: b.get("meaning", "") for b in h["bands"]}
    bands: list[Band] = [(b["name"], raw[b["name"]], scale[b["name"]], meaning[b["name"]]) for b in h["bands"] if not b["name"].startswith(PREVIEW_PREFIX)]
    header = {k: v for k, v in h.items() if k not in ("bands", "codec", "first", "previewEnd", "preview")}
    late = late_bands(h)
    early: list[str] = []
    if preview or (preview is None and path.name.startswith("micro-")):
        header, bands, early = with_preview(header, bands, skip=late)
    return write_hab(out or path, header, bands, late=late, early=early)


if __name__ == "__main__":
    import sys

    for arg in sys.argv[1:]:
        p = Path(arg)
        before = p.stat().st_size
        r = convert(p)
        print(f"{p.name}: {before / 1e6:.2f} MB -> {r['size'] / 1e6:.2f} MB · {r['bands']} bands · raw {r['raw'] / 1e6:.1f} MB")
