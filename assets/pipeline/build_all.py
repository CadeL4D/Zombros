"""Rebuild every asset. Works live (Blender MCP) or headless:

    blender -b --factory-startup -P assets/pipeline/build_all.py
"""
import importlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import base_human  # noqa: E402
import export  # noqa: E402
import palette  # noqa: E402
import validate  # noqa: E402


def build_human():
    r = base_human.build()
    meshes = [r["body"], r["head"]]
    validate.check_character(r["rig"], meshes)
    export.export_glb("human_base", [r["rig"], *meshes])
    skel = base_human.load_contract("skeleton")
    return export.register({
        "id": "human_base",
        "kind": "character",
        "file": "human_base.glb",
        "slots": {"body": "body", "head": "head"},
        "tris": {m.name: export.mesh_tris(m) for m in meshes},
        "skeleton": skel["version"],
        "morphs": [k.name for k in r["body"].data.shape_keys.key_blocks[1:]],
        "tags": ["human", "base"],
    })


def main():
    for m in (palette, base_human, export, validate):
        importlib.reload(m)
    print(build_human())


if __name__ == "__main__":
    main()
