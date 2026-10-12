"""Build installer/icon.ico from the BEKO logo.

    backend\\.venv\\Scripts\\python.exe installer\\make_icon.py

The logo is thin blue lines on white, which turns into a faint outline at
desktop-icon sizes. The icon therefore shows the logo in white on a solid
BEKO-blue rounded tile, drawn separately for each Windows icon size, with
slightly thicker strokes at the smallest sizes.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT / "renderer" / "src" / "assets" / "beko-logo.png"
OUT_ICO = ROOT / "installer" / "icon.ico"
OUT_PNG = ROOT / "installer" / "icon.png"
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
TOP, BOTTOM = (31, 78, 168), (16, 47, 120)  # BEKO blue, light to dark


def logo_mask() -> Image.Image:
    """Alpha mask of the logo's ink (blue strokes and lettering), cropped tight."""
    im = Image.open(LOGO).convert("L")
    mask = im.point(lambda v: 255 if v < 170 else int(max(0, (215 - v) * 255 / 45)) if v < 215 else 0)
    return mask.crop(mask.getbbox())


def tile(size: int) -> Image.Image:
    scale = 4  # draw large, then shrink, for smooth edges
    s = size * scale
    grad = Image.new("RGB", (1, s))
    for y in range(s):
        t = y / (s - 1)
        grad.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM, strict=True)))
    bg = grad.resize((s, s))
    shape = Image.new("L", (s, s), 0)
    ImageDraw.Draw(shape).rounded_rectangle((0, 0, s - 1, s - 1), radius=round(s * 0.22), fill=255)
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(bg, (0, 0), shape)
    return out.resize((size, size), Image.Resampling.LANCZOS)


def render(size: int, mask: Image.Image) -> Image.Image:
    icon = tile(size)
    pad = 0.13 if size >= 48 else 0.10
    box = round(size * (1 - 2 * pad))
    w, h = mask.size
    k = box / max(w, h)
    m = mask.resize((max(1, round(w * k)), max(1, round(h * k))), Image.Resampling.LANCZOS)
    if size <= 24:
        m = m.filter(ImageFilter.MaxFilter(3))  # thicken hairlines so they survive at tiny sizes
    elif size <= 48:
        m = m.point(lambda v: min(255, int(v * 1.6)))
    white = Image.new("RGBA", m.size, (255, 255, 255, 255))
    x = (size - m.size[0]) // 2
    y = (size - m.size[1]) // 2
    icon.paste(white, (x, y), m)
    return icon


def main() -> None:
    mask = logo_mask()
    images = [render(s, mask) for s in SIZES]
    big = images[-1]
    big.save(OUT_ICO, format="ICO", sizes=[(s, s) for s in SIZES], append_images=images[:-1])
    big.save(OUT_PNG)
    preview = Image.new("RGBA", (sum(SIZES) + 10 * len(SIZES), 256), (236, 240, 247, 255))
    x = 0
    for im in images:
        preview.paste(im, (x, 256 - im.size[1]), im)
        x += im.size[0] + 10
    preview.save(ROOT / "installer" / "out" / "icon-preview.png") if (ROOT / "installer" / "out").exists() else None
    print("wrote", OUT_ICO, "sizes", SIZES)


if __name__ == "__main__":
    main()
