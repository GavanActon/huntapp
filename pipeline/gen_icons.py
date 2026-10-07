"""Generate the app icons from the site's mark: a dot for the hunter and an
orange wedge, the scent cone, opening from it, on forest black. Writes
app/public/icons/icon-192.png, icon-512.png, maskable-512.png and
apple-touch-icon.png, plus app/public/favicon.svg (site/icon.svg on a tile)."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG = (10, 16, 11)  # #0a100b, the site's and the app's black
SCENT = (255, 157, 77)  # #ff9d4d, orange is scent and nothing else
INK = (243, 248, 239)  # #f3f8ef
SS = 4  # drawn this many times larger, then scaled down for smooth edges

# The mark in site/icon.svg's 24-unit box: the dot's left edge to the far
# curve of the wedge.
X0, X1 = 3.4, 21.8

FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
<rect width="24" height="24" rx="5" fill="#0a100b"/>
<path d="M8 12 L21 6.5 Q22.6 12 21 17.5 Z" fill="#ff9d4d"/>
<circle cx="6" cy="12" r="2.6" fill="#f3f8ef"/>
</svg>
"""


def wedge(n=48):
    """M8 12 L21 6.5 Q22.6 12 21 17.5 Z as points."""
    pts = [(8, 12), (21, 6.5)]
    for i in range(1, n):
        t = i / n
        pts.append((
            (1 - t) ** 2 * 21 + 2 * (1 - t) * t * 22.6 + t ** 2 * 21,
            (1 - t) ** 2 * 6.5 + 2 * (1 - t) * t * 12 + t ** 2 * 17.5,
        ))
    pts.append((21, 17.5))
    return pts


def draw_icon(size, span):
    """The mark centred on forest black, `span` of the width across."""
    big = size * SS
    img = Image.new("RGB", (big, big), BG)
    d = ImageDraw.Draw(img)
    k = span * big / (X1 - X0)
    ox = (big - (X1 - X0) * k) / 2 - X0 * k
    oy = big / 2 - 12 * k

    def at(x, y):
        return (ox + x * k, oy + y * k)

    d.polygon([at(x, y) for x, y in wedge()], fill=SCENT)
    cx, cy = at(6, 12)
    r = 2.6 * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=INK)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    draw_icon(192, 0.70).save(OUT / "icon-192.png")
    draw_icon(512, 0.70).save(OUT / "icon-512.png")
    draw_icon(180, 0.70).save(OUT / "apple-touch-icon.png")
    # maskable: kept inside the central 80% circle a launcher may crop to
    draw_icon(512, 0.56).save(OUT / "maskable-512.png")
    (ROOT / "app" / "public" / "favicon.svg").write_text(FAVICON, encoding="utf-8")
    print("wrote", OUT)
