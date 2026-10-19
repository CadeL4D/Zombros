"""Render built GLBs for review (writes tools/previews/<id>.png).

    blender -b --factory-startup -P assets/pipeline/render_preview.py -- id[:az:el] ...

az/el (degrees) use the same camera convention as stylize.py (glTF Y-up: az 0 looks from +Z, el up).
Without az:el, assets/source/ai/<id>_view.json is used (the view that matches the reference image).
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

REPO = Path(__file__).resolve().parents[2]
BUILD = REPO / "assets" / "build"
RAW = REPO / "assets" / "source" / "ai"
OUT = REPO / "tools" / "previews"
SIZE = 640


def view_dir(az, el):
    a, e = math.radians(az), math.radians(el)
    gl = (math.cos(e) * math.sin(a), math.sin(e), math.cos(e) * math.cos(a))
    return Vector((gl[0], -gl[2], gl[1]))  # glTF Y-up -> Blender Z-up


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = 0.9
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.2
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(40), math.radians(10), math.radians(-35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    scene.collection.objects.link(cam)
    scene.camera = cam
    return scene, cam


def render(asset_id, az, el):
    scene, cam = setup()
    bpy.ops.import_scene.gltf(filepath=str(BUILD / f"{asset_id}.glb"))
    meshes = [o for o in scene.objects if o.type == "MESH"]
    for o in meshes:
        for m in o.data.materials:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE":
                    n.interpolation = "Closest"
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    centre = sum(pts, Vector()) / len(pts)
    d = view_dir(az, el)
    cam.location = centre + d * 50
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = 200
    # Fit: project bbox corners onto camera plane.
    right = cam.matrix_world.to_3x3() @ Vector((1, 0, 0))
    up = cam.matrix_world.to_3x3() @ Vector((0, 1, 0))
    extent = max(max(abs((p - centre).dot(right)), abs((p - centre).dot(up))) for p in pts)
    cam.data.ortho_scale = extent * 2 * 1.1
    OUT.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(OUT / f"{asset_id}.png")
    bpy.ops.render.render(write_still=True)
    print(f"rendered {asset_id} az={az} el={el}")


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for a in args:
        parts = a.split(":")
        if len(parts) == 3:
            render(parts[0], float(parts[1]), float(parts[2]))
        else:
            v = json.loads((RAW / f"{a}_view.json").read_text())
            render(a, v["azimuth"], v["elevation"])


if __name__ == "__main__":
    main()
