"""Generate PWA icons: rounded dark-green tile, amber compass rose over three
contour arcs. Writes app/public/icons/icon-192.png, icon-512.png and
maskable-512.png, plus app/public/favicon.svg."""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "app" / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG = (15, 26, 18, 255)
BG_TOP = (26, 42, 28, 255)
AMBER = (255, 180, 84, 255)
GREEN = (120, 200, 120, 255)
CYAN = (63, 200, 255, 255)


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_icon(size, rounded=True, pad_scale=1.0):
    img = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        d.line([(0, y), (size, y)], fill=tuple(int(BG_TOP[i] * (1 - t) + BG[i] * t) for i in range(3)) + (255,))
    s = size / 100.0 * pad_scale
    cx = cy = size / 2
    # contour arcs: the land
    for i, (r, a) in enumerate([(40, 200), (48, 120), (56, 60)]):
        d.arc([cx - r * s, cy - r * s, cx + r * s, cy + r * s], start=150, end=390, fill=GREEN[:3] + (a,), width=max(2, int(2.2 * s)))
    # a lake
    d.ellipse([cx - 14 * s, cy + 10 * s, cx + 20 * s, cy + 28 * s], fill=CYAN[:3] + (170,))
    # compass rose: the north point in amber
    n = [(cx, cy - 34 * s), (cx + 7 * s, cy), (cx, cy - 6 * s), (cx - 7 * s, cy)]
    sth = [(cx, cy + 22 * s), (cx + 7 * s, cy), (cx, cy + 6 * s), (cx - 7 * s, cy)]
    d.polygon(sth, fill=(230, 220, 180, 200))
    d.polygon(n, fill=AMBER)
    if rounded:
        img.putalpha(rounded_mask(size, int(size * 0.22)))
    return img


draw_icon(192).save(OUT / "icon-192.png")
draw_icon(512).save(OUT / "icon-512.png")
draw_icon(512, rounded=False, pad_scale=0.8).save(OUT / "maskable-512.png")

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#0f1a12"/>
<circle cx="50" cy="50" r="40" fill="none" stroke="#78c878" stroke-opacity=".8" stroke-width="2.2"/>
<circle cx="50" cy="50" r="48" fill="none" stroke="#78c878" stroke-opacity=".35" stroke-width="2.2"/>
<ellipse cx="53" cy="69" rx="17" ry="9" fill="#3fc8ff" fill-opacity=".65"/>
<polygon points="50,72 57,50 50,56 43,50" fill="#e6dcb4" fill-opacity=".8"/>
<polygon points="50,16 57,50 50,44 43,50" fill="#ffb454"/>
</svg>"""
(OUT.parent / "favicon.svg").write_text(SVG, encoding="utf-8")
print("icons written to", OUT)
