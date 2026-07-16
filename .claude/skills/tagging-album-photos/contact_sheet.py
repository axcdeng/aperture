#!/usr/bin/env python3
"""Build labeled contact-sheet montages for the triage pass.

Tiles name-sorted images into grids (default 5x5), each cell outlined and
captioned with its filename, so the agent can classify robot vs non-robot from
ONE cheap image per ~25 photos and map each cell back to its file by the label.

Usage:
    python3 contact_sheet.py <src_dir> <out_dir> [cols] [rows]

Prints one line per sheet: "sheet_001.jpg: FILE1, FILE2, ..." (reading order).
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
CELL = 300      # max px per tile image
LABEL_H = 22    # px reserved under each tile for the filename
PAD = 5
BG = (17, 17, 17)
OUTLINE = (255, 255, 255)


def load_font():
    for p in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/SFNS.ttf",
    ):
        try:
            return ImageFont.truetype(p, 14)
        except Exception:
            pass
    return ImageFont.load_default()


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    src, out = sys.argv[1], sys.argv[2]
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    rows = int(sys.argv[4]) if len(sys.argv) > 4 else 5
    per = cols * rows

    files = sorted(f for f in os.listdir(src) if os.path.splitext(f)[1].lower() in EXTS)
    if not files:
        print(f"no images in {src}", file=sys.stderr)
        return 1
    os.makedirs(out, exist_ok=True)
    font = load_font()

    cw, ch = CELL + 2 * PAD, CELL + LABEL_H + 2 * PAD
    for s in range(0, len(files), per):
        chunk = files[s : s + per]
        r = math.ceil(len(chunk) / cols)
        sheet = Image.new("RGB", (cols * cw, r * ch), BG)
        d = ImageDraw.Draw(sheet)
        for i, fn in enumerate(chunk):
            cx, cy = (i % cols) * cw, (i // cols) * ch
            try:
                im = Image.open(os.path.join(src, fn)).convert("RGB")
            except Exception:
                continue
            im.thumbnail((CELL, CELL))
            ox = cx + PAD + (CELL - im.width) // 2
            oy = cy + PAD + (CELL - im.height) // 2
            sheet.paste(im, (ox, oy))
            d.rectangle(
                [cx + PAD - 1, cy + PAD - 1, cx + PAD + CELL, cy + PAD + CELL],
                outline=OUTLINE,
                width=2,
            )
            d.text((cx + PAD, cy + PAD + CELL + 3), fn, fill=OUTLINE, font=font)
        name = f"sheet_{s // per + 1:03d}.jpg"
        sheet.save(os.path.join(out, name), quality=80)
        print(f"{name}: {', '.join(chunk)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
