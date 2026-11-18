"""Turns product photos into 1000x600 WhatsApp card pictures (public/img/gXX.jpg).

Each photo is shown whole in the middle, over a soft blurred copy of itself.
Usage: python3 tools/make_cards.py <photo> <id> [left top right bottom]
"""
import sys
from pathlib import Path
from PIL import Image, ImageFilter, ImageEnhance

W, H = 1000, 600
OUT = Path(__file__).resolve().parent.parent / "public" / "img"


def load(path: str, box=None) -> Image.Image:
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        im = bg
    im = im.convert("RGB")
    if box:
        im = im.crop(box)
    return im


def has_white_border(im: Image.Image) -> bool:
    """True when the four corners are white, i.e. a cut-out product shot."""
    g = im.convert("L")
    w, h = g.size
    n = max(4, min(w, h) // 20)
    corners = [g.crop((0, 0, n, n)), g.crop((w - n, 0, w, n)), g.crop((0, h - n, n, h)), g.crop((w - n, h - n, w, h))]
    data = b"".join(c.tobytes() for c in corners)
    return sum(data) / len(data) > 235


def card(im: Image.Image) -> Image.Image:
    if has_white_border(im):
        bg = Image.new("RGB", (W, H), "white")
        fit = min((W - 80) / im.width, (H - 40) / im.height)
        fg = im.resize((round(im.width * fit), round(im.height * fit)), Image.LANCZOS)
        bg.paste(fg, ((W - fg.width) // 2, (H - fg.height) // 2))
        return bg
    # Background: photo stretched to cover, blurred and lightened.
    scale = max(W / im.width, H / im.height)
    bg = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left, top = (bg.width - W) // 2, (bg.height - H) // 2
    bg = bg.crop((left, top, left + W, top + H)).filter(ImageFilter.GaussianBlur(28))
    bg = ImageEnhance.Brightness(bg).enhance(1.15)
    bg = Image.blend(bg, Image.new("RGB", (W, H), "white"), 0.35)
    # Foreground: whole photo, fitted with a margin.
    fit = min((W - 80) / im.width, (H - 40) / im.height)
    fg = im.resize((round(im.width * fit), round(im.height * fit)), Image.LANCZOS)
    bg.paste(fg, ((W - fg.width) // 2, (H - fg.height) // 2))
    return bg


if __name__ == "__main__":
    src, pid = sys.argv[1], sys.argv[2]
    box = tuple(int(v) for v in sys.argv[3:7]) if len(sys.argv) >= 7 else None
    OUT.mkdir(parents=True, exist_ok=True)
    card(load(src, box)).save(OUT / f"{pid}.jpg", quality=88, optimize=True)
    print(f"{pid}.jpg")
