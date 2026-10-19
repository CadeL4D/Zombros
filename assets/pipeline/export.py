"""EXPORT + MANIFEST stages: write a GLB to assets/build and register it in manifest.json."""
import json
from pathlib import Path

import bpy

REPO = Path(__file__).resolve().parents[2]
BUILD = REPO / "assets" / "build"
MANIFEST = BUILD / "manifest.json"


def export_glb(asset_id, objects, animations=False):
    BUILD.mkdir(parents=True, exist_ok=True)
    path = BUILD / f"{asset_id}.glb"
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_morph=True,
        export_morph_normal=False,  # flat shaded in-game; morph normals would double the file
        export_animations=animations,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_materials="EXPORT",
    )
    return path


def register(entry):
    """Add or replace an entry (by id) in manifest.json."""
    data = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {"version": 1, "assets": []}
    data["assets"] = [a for a in data["assets"] if a["id"] != entry["id"]] + [entry]
    data["assets"].sort(key=lambda a: a["id"])
    MANIFEST.write_text(json.dumps(data, indent=2) + "\n")
    return entry


def mesh_tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)
