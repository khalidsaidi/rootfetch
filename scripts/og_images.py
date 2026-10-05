"""Social share images (1200x630 PNG) for rootfetch.com pages. Needs Pillow."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONTS = Path(__file__).resolve().parent / "fonts"
W, H = 1200, 630
BG = (13, 18, 24)
PANEL = (21, 28, 37)
INK = (231, 236, 242)
MUTED = (135, 146, 161)
LINE = (39, 50, 65)
SIGNAL = (57, 135, 229)
FALL = (144, 133, 233)
CRITICAL = (208, 59, 59)


def _display(size: int, weight: str = "ExtraBold") -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(FONTS / "Archivo.ttf"), size)
    font.set_variation_by_name(weight)
    return font


def _mono(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / "JetBrainsMono-SemiBold.ttf"), size)


def _fit(draw: ImageDraw.ImageDraw, text: str, max_w: int, start: int, weight: str = "ExtraBold") -> ImageFont.FreeTypeFont:
    size = start
    while size > 40:
        font = _display(size, weight)
        if draw.textlength(text, font=font) <= max_w:
            return font
        size -= 6
    return _display(size, weight)


def _brand(draw: ImageDraw.ImageDraw) -> None:
    draw.rounded_rectangle((64, 56, 108, 100), radius=11, fill=INK)
    draw.line([(73, 88), (81, 80), (88, 84), (99, 69)], fill=BG, width=4, joint="curve")
    draw.ellipse((95, 62, 104, 71), fill=CRITICAL)
    draw.text((124, 58), "RootFetch", font=_display(34, "ExtraBold"), fill=INK)
    draw.text((W - 64, 66), "rootfetch.com", font=_mono(24), fill=MUTED, anchor="ra")


def _chart(draw: ImageDraw.ImageDraw, points: list[tuple[str, int]], box: tuple[int, int, int, int], color) -> None:
    x0, y0, x1, y1 = box
    if len(points) < 2:
        return
    d0 = date.fromisoformat(points[0][0]).toordinal()
    d1 = date.fromisoformat(points[-1][0]).toordinal()
    vals = [v for _, v in points]
    lo, hi = min(vals), max(vals)
    span = (hi - lo) or 1
    xy = [
        (x0 + (date.fromisoformat(d).toordinal() - d0) / max(1, d1 - d0) * (x1 - x0), y1 - (v - lo) / span * (y1 - y0))
        for d, v in points
    ]
    draw.polygon(xy + [(xy[-1][0], y1), (xy[0][0], y1)], fill=tuple(int(c * 0.22 + b * 0.78) for c, b in zip(color, BG)))
    draw.line(xy, fill=color, width=6, joint="curve")
    cx, cy = xy[-1]
    draw.ellipse((cx - 9, cy - 9, cx + 9, cy + 9), fill=color, outline=BG, width=3)


def tld_image(path: Path, name: str, count: int, change_line: str, points: list[tuple[str, int]], up: bool, stamp: str) -> None:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    _brand(draw)
    title = f".{name}"
    font = _fit(draw, title, 1072, 150)
    draw.text((64, 140), title, font=font, fill=INK)
    draw.text((64, 330), f"{count:,} domains", font=_mono(52), fill=INK)
    draw.text((64, 400), change_line, font=_mono(30), fill=SIGNAL if up else FALL)
    _chart(draw, points, (600, 360, 1136, 560), SIGNAL if up else FALL)
    draw.line((64, 580, 1136, 580), fill=LINE, width=2)
    draw.text((64, 590), stamp, font=_mono(22), fill=MUTED)
    img.save(path, "PNG", optimize=True)


def site_image(path: Path, headline: str, sub: str, points: list[tuple[str, int]] | None = None) -> None:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    _brand(draw)
    # wrap headline into at most 3 lines
    font = _display(76)
    words, lines, cur = headline.split(), [], ""
    for wd in words:
        trial = f"{cur} {wd}".strip()
        if draw.textlength(trial, font=font) > 1072 and cur:
            lines.append(cur)
            cur = wd
        else:
            cur = trial
    lines.append(cur)
    y = 150
    for ln in lines[:3]:
        draw.text((64, y), ln, font=font, fill=INK)
        y += 88
    draw.text((64, y + 20), sub, font=_mono(28), fill=MUTED)
    if points:
        _chart(draw, points, (64, 470, 1136, 560), SIGNAL)
    img.save(path, "PNG", optimize=True)


def logo_image(path: Path) -> None:
    size = 512
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)
    k = size / 26
    draw.line([(5 * k, 18.5 * k), (10 * k, 14 * k), (14 * k, 16.5 * k), (21 * k, 7.5 * k)], fill=INK, width=int(2.4 * k), joint="curve")
    draw.ellipse((18.4 * k, 4.9 * k, 23.6 * k, 10.1 * k), fill=CRITICAL)
    img.save(path, "PNG", optimize=True)
