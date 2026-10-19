"""Side-by-side review sheet: reference image | AI result | hand-built result (if any).

    python assets/pipeline/compare_sheet.py out.png "Gen Images/Boulder.png=boulder" "Gen Images/Olive Sedan.png=sedan_olive_ai,sedan_olive_hand"

Renders come from tools/previews/<id>.png (render_preview.py).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[2]
PREVIEWS = REPO / "tools" / "previews"
CELL, LABEL = 420, 34


def tile(img, text):
    img = img.convert("RGB")
    img.thumbnail((CELL, CELL))
    t = Image.new("RGB", (CELL, CELL + LABEL), "white")
    t.paste(img, ((CELL - img.width) // 2, LABEL + (CELL - img.height) // 2))
    d = ImageDraw.Draw(t)
    d.text((10, 8), text, fill=(30, 30, 30), font=ImageFont.load_default(size=20))
    return t


def main(out, rows):
    tiles = []
    for row in rows:
        ref, ids = row.split("=")
        cells = [tile(Image.open(REPO / ref), "Reference")]
        for i in ids.split(","):
            kind = "Hand-built" if i.endswith("_hand") else "AI + cleanup"
            cells.append(tile(Image.open(PREVIEWS / f"{i}.png"), f"{kind}: {i}"))
        tiles.append(cells)
    cols = max(len(r) for r in tiles)
    sheet = Image.new("RGB", (cols * CELL, len(tiles) * (CELL + LABEL)), "white")
    for y, r in enumerate(tiles):
        for x, t in enumerate(r):
            sheet.paste(t, (x * CELL, y * (CELL + LABEL)))
    sheet.save(out)
    print(out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
