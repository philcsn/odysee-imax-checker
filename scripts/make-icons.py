#!/usr/bin/env python3
"""Generate app icons. Re-run after changing the design; output is committed."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
BG = (14, 17, 22)          # matches the dashboard background
FRAME = (122, 162, 255)    # accent blue
GLOW = (74, 222, 128)      # the "new session" green


def make(size):
    # Supersample, then downscale — cheap antialiasing for the circle and triangle.
    s = size * 4
    img = Image.new('RGB', (s, s), BG)
    d = ImageDraw.Draw(img)

    # Film-strip perforations down both edges
    hole_w, hole_h = int(s * 0.055), int(s * 0.075)
    gap = int(s * 0.045)
    y = gap
    while y + hole_h < s:
        for x in (int(s * 0.055), s - int(s * 0.055) - hole_w):
            d.rounded_rectangle([x, y, x + hole_w, y + hole_h],
                                radius=int(hole_w * 0.3), fill=(32, 38, 48))
        y += hole_h + gap

    # Centre ring + play triangle
    cx, cy, r = s // 2, s // 2, int(s * 0.26)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=FRAME, width=int(s * 0.035))
    t = int(r * 0.52)
    d.polygon([(cx - t * 0.55, cy - t), (cx - t * 0.55, cy + t), (cx + t * 0.85, cy)], fill=FRAME)

    # Small green dot: something new is being watched for
    dr = int(s * 0.055)
    d.ellipse([cx + int(r * 0.72), cy - int(r * 1.05) - dr,
               cx + int(r * 0.72) + dr * 2, cy - int(r * 1.05) + dr], fill=GLOW)

    return img.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
for n in (180, 192, 512):
    p = os.path.join(OUT, f'icon-{n}.png')
    make(n).save(p, 'PNG', optimize=True)
    print('wrote', os.path.relpath(p), os.path.getsize(p), 'bytes')
