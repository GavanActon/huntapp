"""Score an old and a new micro grid against the field checks in a hunt-log
GPX: the model's own speed call at each check, scaled by the new grid's
head-height share over the old's at that cell, against the strength felt.
A proxy for the full model (the app's shelter and slot rules are left as
they were; they act on open cells, where the share is unchanged).

    python pipeline/towers/score.py <gpx> <old micro.hab> <new micro.hab>
"""
import gzip, json, re, struct, sys
from pathlib import Path
import numpy as np

STRENGTH = {"calm": 0.3, "drift": 1.5, "light": 5, "breezy": 12, "windy": 22}


def read_hab(path):
    raw = Path(path).read_bytes()
    if raw[:2] == b"\x1f\x8b": raw = gzip.decompress(raw)
    hlen = struct.unpack("<I", raw[:4])[0]; h = json.loads(raw[4:4 + hlen]); base, n = 4 + hlen, h["cols"] * h["rows"]
    def band(name):
        b = next(b for b in h["bands"] if b["name"] == name)
        return np.frombuffer(raw, dtype=np.dtype(b["dtype"]), count=n, offset=base + b["offset"]).reshape(h["rows"], h["cols"]).astype(np.float32) * b["scale"]
    return h, band


gpx = open(sys.argv[1], encoding="utf-8").read()
ho, bo = read_hab(sys.argv[2]); hn, bn = read_hab(sys.argv[3])
co, cn, th = bo("canopy"), bn("canopy"), bn("treeH")
cbo, cbn = bo("canopyBare"), bn("canopyBare")
rows = []
for lat, lon, body in re.findall(r'<wpt lat="([-\d.]+)" lon="([-\d.]+)">(.*?)</wpt>', gpx, re.S):
    if "<type>windcheck</type>" not in body: continue
    name = re.search(r"<name>(.*?)</name>", body).group(1)
    desc = re.search(r"<desc>(.*?)</desc>", body, re.S).group(1)
    felt = next((v for k, v in STRENGTH.items() if k in name.lower()), None)
    m = re.search(r"model: from \S+ ([\d.]+) km/h", desc)
    t = re.search(r"<time>(\d{4})-(\d\d)-(\d\d)", body)
    if felt is None or not m: continue
    kmh = float(m.group(1))
    c = int((float(lon) - ho["west"]) / ho["dLon"]); r = int((ho["north"] - float(lat)) / ho["dLat"])
    # the leaf state the app used: leaf-off ramps Sep 20 - Oct 15
    doy = int(t.group(2)) * 31 + int(t.group(3)); off = np.clip((doy - (9 * 31 + 20)) / 25, 0, 1)
    old = co[r, c] + (cbo[r, c] - co[r, c]) * off
    new = cn[r, c] + (cbn[r, c] - cn[r, c]) * off
    rows.append((felt, kmh, kmh * new / max(old, 1e-3), th[r, c], name))

rows = np.array([(a, b, c, d) for a, b, c, d, _ in rows])
felt, old, new, tree = rows.T
def score(call, label):
    moving = felt >= 1
    within2 = np.mean((call[moving] / felt[moving] >= 0.5) & (call[moving] / felt[moving] <= 2))
    ratio = np.median(felt[moving] / np.maximum(call[moving], 0.1))
    print(f"{label:4s}: {int(moving.sum())} moving checks, within 2x {within2:.0%}, felt/call median {ratio:.1f}x; "
          f"in stands ({int((moving & (tree > 0)).sum())}): felt/call {np.median(felt[moving & (tree > 0)] / np.maximum(call[moving & (tree > 0)], 0.1)):.1f}x")
print(f"{len(rows)} checks, {int((tree > 0).sum())} in stands")
score(old, "old"); score(new, "new")
