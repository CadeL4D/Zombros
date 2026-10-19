"""Spike: generate rigged low-poly humans with MPFB (MakeHuman for Blender).

    blender -b --factory-startup -P assets/pipeline/experiments/mpfb_humans.py

Needs the MPFB extension and the CC0 makehuman_system_assets pack installed in
tools/blender-user (see tools/env.sh). Writes GLBs + renders to tools/ai/mpfb_spike/.
"""
import importlib
import json
import math
import os
import sys
from pathlib import Path

import addon_utils
import bpy

ROOT = Path(os.environ.get("ZOMBROS_ROOT", Path(__file__).resolve().parents[3]))
OUT = ROOT / "tools" / "ai" / "mpfb_spike"
OUT.mkdir(parents=True, exist_ok=True)

addon_utils.enable("bl_ext.blender_org.mpfb", default_set=True)
mpfb = "bl_ext.blender_org.mpfb.services."
HumanService = importlib.import_module(mpfb + "humanservice").HumanService
AssetService = importlib.import_module(mpfb + "assetservice").AssetService
TargetService = importlib.import_module(mpfb + "targetservice").TargetService

RIG = sys.argv[sys.argv.index("--rig") + 1] if "--rig" in sys.argv else "game_engine"
PROXY = sys.argv[sys.argv.index("--proxy") + 1] if "--proxy" in sys.argv else "proxy741"

PEOPLE = {
    "survivor_m": dict(gender=1.0, age=0.5, muscle=0.6, weight=0.5, height=0.55),
    "survivor_f": dict(gender=0.0, age=0.45, muscle=0.5, weight=0.45, height=0.45),
    "heavy_old_m": dict(gender=1.0, age=0.85, muscle=0.2, weight=1.0, height=0.4),
    "thin_young_f": dict(gender=0.0, age=0.3, muscle=0.2, weight=0.0, height=0.6),
    "muscular_m": dict(gender=0.9, age=0.5, muscle=1.0, weight=0.65, height=0.7),
}


def find_proxy(name):
    for p in AssetService.list_proxy_assets():
        if p.name.lower() == f"{name}.mhclo" or p.stem.lower() == name:
            return str(p)
    names = [p.stem for p in AssetService.list_proxy_assets()]
    raise SystemExit(f"proxy {name!r} not found; available: {names}")


def tris(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    mesh = obj.evaluated_get(deps).to_mesh()
    mesh.calc_loop_triangles()
    n = len(mesh.loop_triangles)
    obj.evaluated_get(deps).to_mesh_clear()
    return n


def build(name, macros):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    detail = TargetService.get_default_macro_info_dict()
    detail.update(macros)
    basemesh = HumanService.create_human(macro_detail_dict=detail, detailed_helpers=False)
    HumanService.add_builtin_rig(basemesh, RIG)
    proxy = HumanService.add_mhclo_asset(find_proxy(PROXY), basemesh, asset_type="Proxymeshes",
                                         subdiv_levels=0, material_type="NONE")
    rig = basemesh.parent
    # Keep only rig + low-poly proxy for export.
    for mod in list(proxy.modifiers):
        if mod.type == "SUBSURF":
            proxy.modifiers.remove(mod)
    bpy.data.objects.remove(basemesh, do_unlink=True)
    for o in list(bpy.data.objects):
        if o not in (rig, proxy):
            bpy.data.objects.remove(o, do_unlink=True)
    for poly in proxy.data.polygons:
        poly.use_smooth = False

    info = {
        "id": name,
        "rig": RIG,
        "proxy": PROXY,
        "bones": len(rig.data.bones),
        "deform_bones": sum(b.use_deform for b in rig.data.bones),
        "tris": tris(proxy),
        "height_m": round(max(v.co.z for v in proxy.data.vertices) - min(v.co.z for v in proxy.data.vertices), 3),
        "vertex_groups": len(proxy.vertex_groups),
    }
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(OUT / f"{name}.glb"), use_selection=True, export_apply=True)
    render(name, rig, proxy)
    return info


def render(name, rig, proxy):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 512, 768
    scene.render.film_transparent = False
    h = max((proxy.matrix_world @ v.co).z for v in proxy.data.vertices)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.location = (2.2, -3.6, h * 0.6)
    cam.rotation_euler = (math.radians(85), 0, math.radians(31))
    cam.data.lens = 50
    scene.camera = cam
    scene.render.filepath = str(OUT / f"{name}.png")
    bpy.ops.render.render(write_still=True)


def lineup(names, tag):
    """Front view of every exported GLB side by side."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for i, name in enumerate(names):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(OUT / f"{name}.glb"))
        for o in set(bpy.data.objects) - before:
            if o.parent is None:
                o.location.x = i * 0.9
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 1400, 700
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = max(2.3, len(names) * 0.9 + 0.4)
    cam.location = ((len(names) - 1) * 0.45, -6, 1.0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam
    scene.render.filepath = str(OUT / f"lineup_{tag}.png")
    bpy.ops.render.render(write_still=True)


def main():
    results = [build(n, m) for n, m in PEOPLE.items()]
    (OUT / f"results_{PROXY}.json").write_text(json.dumps(results, indent=2))
    lineup(list(PEOPLE), PROXY)
    for r in results:
        print(r)


main()
