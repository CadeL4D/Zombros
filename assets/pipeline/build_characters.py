"""Build every generated character in content/characters/roster.json:

    blender -b --factory-startup -P assets/pipeline/build_characters.py [-- --only id1,id2] [--render]

MPFB source -> contract rig + slot meshes (mpfb_character) -> clips (anims) ->
validate -> GLB + manifest entry. --render writes a front lineup to tools/previews/characters.png.
"""
import importlib
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import anims  # noqa: E402
import base_human  # noqa: E402
import export  # noqa: E402
import mpfb_character  # noqa: E402
import palette  # noqa: E402
import validate  # noqa: E402

import bpy  # noqa: E402


def _arg(name):
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if name not in argv:
        return None
    i = argv.index(name)
    return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else True


def build_one(spec, roster):
    r = mpfb_character.build(spec, roster["proxy"], roster.get("style"), roster.get("boneScale"), roster.get("facet"))
    rig, meshes = r["rig"], r["meshes"]
    validate.check_character(rig, meshes)
    clips = anims.add_clips(rig, anims.CLIPS[spec["kind"]])
    export.export_glb(spec["id"], [rig, *meshes], animations=True)
    skel = base_human.load_contract("skeleton")
    return export.register({
        "id": spec["id"],
        "kind": "character",
        "file": f"{spec['id']}.glb",
        "slots": {m.name: m.name for m in meshes},
        "tris": {m.name: export.mesh_tris(m) for m in meshes},
        "skeleton": skel["version"],
        "animations": clips,
        "tags": [spec["kind"], "generated", "mpfb", "placeholder"],
    })


def render_lineup(ids, path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for i, cid in enumerate(ids):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(export.BUILD / f"{cid}.glb"))
        for o in set(bpy.data.objects) - before:
            if o.parent is None:
                o.location.x = i * 0.9
            if o.type == "ARMATURE":
                o.data.pose_position = "REST"
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 1800, 760
    scene.world = bpy.data.worlds.new("w")
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    aspect = scene.render.resolution_x / scene.render.resolution_y
    cam.data.ortho_scale = max(len(ids) * 0.9 + 0.3, 2.1 * aspect)
    cam.location = ((len(ids) - 1) * 0.45, -6, 0.95)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    for m in (palette, base_human, export, validate, mpfb_character, anims):
        importlib.reload(m)
    roster = mpfb_character.load_roster()
    only = _arg("--only")
    specs = [c for c in roster["characters"] if not isinstance(only, str) or c["id"] in only.split(",")]
    for spec in specs:
        print(build_one(spec, roster))
    if _arg("--render"):
        render_lineup([s["id"] for s in specs], export.REPO / "tools" / "previews" / "characters.png")


if __name__ == "__main__":
    main()
