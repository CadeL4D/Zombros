"""Rebuild every asset. Works live (Blender MCP) or headless:

    blender -b --factory-startup -P assets/pipeline/build_all.py

Characters are runtime capsules for now (packages/client), so the only built asset is the palette.
"""
import importlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import palette  # noqa: E402


def main():
    importlib.reload(palette)
    print(palette.write_png())


if __name__ == "__main__":
    main()
