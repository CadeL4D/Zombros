"""Palette contract helpers. Pure Python (no bpy) so it runs anywhere.

    python assets/pipeline/palette.py      -> writes assets/build/palette.png
"""
import json
import struct
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PALETTE_JSON = REPO / "content" / "contracts" / "palette.json"
BUILD = REPO / "assets" / "build"


def load():
    return json.loads(PALETTE_JSON.read_text())


def uv(name, pal=None):
    """UV (0-1, origin bottom-left as in Blender/glTF-before-flip) of a swatch centre."""
    pal = pal or load()
    col, row = pal["swatches"][name]["cell"]
    return ((col + 0.5) / pal["columns"], 1.0 - (row + 0.5) / pal["rows"])


def _hex(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def write_png(path=None, pal=None):
    pal = pal or load()
    cs, cols, rows = pal["cellSize"], pal["columns"], pal["rows"]
    w, h = cs * cols, cs * rows
    grid = [[_hex("#808080")] * cols for _ in range(rows)]
    for sw in pal["swatches"].values():
        c, r = sw["cell"]
        grid[r][c] = _hex(sw["color"])
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw.extend(grid[y // cs][x // cs])

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path = Path(path or BUILD / pal["image"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    return path


if __name__ == "__main__":
    print(write_png())
