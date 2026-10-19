"""Hand-built (scripted) olive sedan, modelled from Gen Images/Olive Sedan.png.

    blender -b --factory-startup -P assets/pipeline/hand_sedan.py

Side-profile extrusions for body and cabin, bevelled once; doors, hood, trunk and wheels are separate
objects (damage, looting). Every face UVs into a palette swatch. Car faces +X, Blender Z up.
Writes assets/build/sedan_olive_hand.glb.
"""
import math
import sys
from pathlib import Path

import bmesh
import bpy

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import export  # noqa: E402
import palette  # noqa: E402

PAL = palette.load()
PAINT, TRIM, DARK, GLASS = "cloth_olive", "cloth_khaki", "cloth_black", "glass"

WHEEL_R, WHEEL_W = 0.37, 0.25
ROOF = 1.50
AXLE_F, AXLE_R = 1.38, -1.32
HALF_W = 0.88          # body half width
CAB_HALF_W = 0.76      # cabin half width at the roof


def material():
    mat = bpy.data.materials.get("palette") or bpy.data.materials.new("palette")
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    if not any(n.type == "TEX_IMAGE" for n in nt.nodes):
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(str(export.BUILD / PAL["image"]))
        tex.interpolation = "Closest"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def new_obj(name, bm, swatch, bevel=0.0):
    """bmesh -> object, every face in one swatch, optional single chamfer on sharp edges."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material())
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width, mod.segments, mod.limit_method, mod.angle_limit = bevel, 1, "ANGLE", math.radians(30)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    paint(obj, swatch)
    return obj


def paint(obj, swatch, faces=None):
    me = obj.data
    uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    u = palette.uv(swatch, PAL)
    for p in me.polygons:
        if faces is None or p.index in faces:
            for li in p.loop_indices:
                uvl.data[li].uv = u


def profile(points, y0, y1):
    """Extrude an X-Z side profile (counter-clockwise) across Y."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y0, z)) for x, z in points]
    face = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, y1 - y0, 0),
                        verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def box(cx, cy, cz, sx, sy, sz):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(cx, cy, cz), verts=bm.verts)
    return bm


def arch(cx, r, n=6):
    """Wheel-arch points over the top, from rear to front (clockwise seen from +Y... reversed for CCW)."""
    return [(cx - r * math.cos(math.pi * i / n), WHEEL_R + r * math.sin(math.pi * i / n)) for i in range(n + 1)]


def body():
    r = WHEEL_R + 0.08
    pts = [(-2.22, 0.30)]
    pts += [(x, max(z, 0.30)) for x, z in arch(AXLE_R, r)]
    pts += [(x, max(z, 0.30)) for x, z in arch(AXLE_F, r)]
    pts += [(2.22, 0.30), (2.27, 0.56), (2.22, 0.80), (0.82, 0.90),
            (-1.40, 0.90), (-2.18, 0.88), (-2.26, 0.62)]
    # profile() needs CCW in X-Z seen from -Y; this list runs bottom rear -> front -> top rear, i.e. CCW.
    return new_obj("body", profile(pts, -HALF_W, HALF_W), PAINT, bevel=0.035)


def cabin():
    pts = [(0.82, 0.90), (0.20, ROOF), (-0.98, ROOF), (-1.46, 0.90)]
    bm = profile(pts, -HALF_W + 0.06, HALF_W - 0.06)
    # Tumblehome: pull the roof edge in.
    for v in bm.verts:
        if v.co.z > 1.2:
            v.co.y = math.copysign(CAB_HALF_W, v.co.y)
    return new_obj("cabin", bm, PAINT, bevel=0.03)


def glass_panels():
    """Windows: a khaki frame panel with a slightly smaller glass panel on top, proud of the cabin."""
    objs = []
    roof, belt = ROOF, 0.90

    def side_y(z):  # cabin side surface at height z (linear tumblehome)
        t = (z - belt) / (roof - belt)
        return (HALF_W - 0.06) * (1 - t) + CAB_HALF_W * t

    side_windows = [  # (x at belt, x at roof) pairs: front edge, rear edge
        ((0.68, 0.24), (-0.02, -0.02)),
        ((-0.12, -0.12), (-1.34, -0.90)),
    ]
    for side in (-1, 1):
        for wi, ((fb, ft), (rb, rt)) in enumerate(side_windows):
            for layer, inset, sw, off in (("frame", 0.0, TRIM, 0.006), ("glass", 0.045, GLASS, 0.012)):
                zb, zt = belt + 0.04 + inset, roof - 0.05 - inset
                quad = [(fb - inset, zb), (ft - inset * 0.6, zt), (rt + inset * 0.6, zt), (rb + inset, zb)]
                bm = bmesh.new()
                vs = [bm.verts.new((x, side * (side_y(z) + off), z)) for x, z in quad]
                f = bm.faces.new(vs if side < 0 else vs[::-1])
                bmesh.ops.solidify(bm, geom=[f], thickness=0.01)
                objs.append(new_obj(f"window_{layer}_{wi}_{side}", bm, sw))

    def slope_panel(name, a, b, half_w, inset, sw, lift):
        # a/b: (x, z) bottom and top centre of a sloped window; panel spans +-half_w.
        (xa, za), (xb, zb) = a, b
        nx, nz = -(zb - za), (xb - xa)
        n = math.hypot(nx, nz)
        nx, nz = nx / n * lift, nz / n * lift
        dx, dz = (xb - xa), (zb - za)
        L = math.hypot(dx, dz)
        ux, uz = dx / L, dz / L
        a2 = (xa + ux * inset + nx, za + uz * inset + nz)
        b2 = (xb - ux * inset + nx, zb - uz * inset + nz)
        wb, wt = half_w - inset, half_w - 0.08 - inset
        bm = bmesh.new()
        vs = [bm.verts.new(p) for p in ((a2[0], -wb, a2[1]), (a2[0], wb, a2[1]), (b2[0], wt, b2[1]), (b2[0], -wt, b2[1]))]
        f = bm.faces.new(vs)
        bmesh.ops.solidify(bm, geom=[f], thickness=0.01)
        return new_obj(name, bm, sw)

    for layer, inset, sw, lift in (("frame", 0.0, TRIM, 0.006), ("glass", 0.05, GLASS, 0.012)):
        objs.append(slope_panel(f"windshield_{layer}", (0.76, 0.94), (0.24, ROOF - 0.04), HALF_W - 0.1, inset, sw, -lift))
        objs.append(slope_panel(f"rear_window_{layer}", (-1.40, 0.94), (-1.00, ROOF - 0.04), HALF_W - 0.1, inset, sw, lift))
    return objs


def trim():
    objs = []
    # Side sills between the arches, bumpers with a dark lower lip, arch flares.
    for side in (-1, 1):
        objs.append(new_obj(f"sill_{side}", box(0.03, side * (HALF_W + 0.01), 0.36, 1.86, 0.06, 0.12), TRIM, 0.015))
        for ax in (AXLE_F, AXLE_R):
            r = WHEEL_R + 0.12
            pts, inner = [], []
            for i in range(7):
                a = math.pi * i / 6
                pts.append((ax - r * math.cos(a), WHEEL_R + r * math.sin(a)))
                inner.append((ax - (r - 0.07) * math.cos(a), WHEEL_R + (r - 0.07) * math.sin(a)))
            bm = bmesh.new()
            y0, y1 = side * (HALF_W - 0.02), side * (HALF_W + 0.04)
            ring = pts + inner[::-1]
            vs = [bm.verts.new((x, y0, z)) for x, z in ring]
            f = bm.faces.new(vs)
            ext = bmesh.ops.extrude_face_region(bm, geom=[f])
            bmesh.ops.translate(bm, vec=(0, y1 - y0, 0), verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            objs.append(new_obj(f"flare_{ax:+.0f}_{side}", bm, TRIM))
    for x, name in ((2.27, "bumper_f"), (-2.27, "bumper_r")):
        objs.append(new_obj(name, box(x, 0, 0.44, 0.18, 1.86, 0.24), TRIM, 0.03))
        objs.append(new_obj(name + "_lip", box(x + math.copysign(0.02, x), 0, 0.33, 0.16, 1.4, 0.08), DARK, 0.01))
        objs.append(new_obj(name + "_plate", box(x + math.copysign(0.10, x), 0, 0.44, 0.02, 0.5, 0.13), DARK))
    # Front: grille, headlights, indicators. Rear: tail lights.
    objs.append(new_obj("grille", box(2.25, 0, 0.66, 0.06, 0.82, 0.2), DARK, 0.01))
    for side in (-1, 1):
        objs.append(new_obj(f"headlight_{side}", box(2.25, side * 0.6, 0.66, 0.06, 0.22, 0.17), "emit_lamp", 0.01))
        objs.append(new_obj(f"indicator_{side}", box(2.24, side * 0.79, 0.66, 0.06, 0.12, 0.17), "cloth_yellow", 0.01))
        objs.append(new_obj(f"taillight_{side}", box(-2.25, side * 0.68, 0.70, 0.06, 0.3, 0.16), "emit_red", 0.01))
        objs.append(new_obj(f"mirror_{side}", box(0.70, side * (HALF_W + 0.09), 0.98, 0.14, 0.12, 0.13), DARK, 0.02))
        objs.append(new_obj(f"mirror_arm_{side}", box(0.72, side * (HALF_W + 0.02), 0.95, 0.06, 0.08, 0.04), DARK))
    return objs


def panels():
    """Separate openable parts: 4 doors, hood, trunk (thin skins over the body)."""
    objs = []
    for side in (-1, 1):
        for name, x0, x1 in (("door_f", -0.02, 0.80), ("door_r", -0.92, -0.06)):
            bm = box((x0 + x1) / 2, side * (HALF_W + 0.012), 0.64, x1 - x0, 0.024, 0.5)
            door = new_obj(f"{name}_{'l' if side > 0 else 'r'}", bm, PAINT, 0.01)
            handle = new_obj("handle", box(x1 - 0.18, side * (HALF_W + 0.03), 0.8, 0.14, 0.02, 0.04), DARK)
            objs.append(join(door.name, [door, handle]))
    hood = profile([(2.20, 0.80), (0.86, 0.90), (0.86, 0.92), (2.20, 0.82)], -HALF_W + 0.05, HALF_W - 0.05)
    objs.append(new_obj("hood", hood, PAINT))
    trunk = profile([(-1.46, 0.90), (-2.16, 0.88), (-2.16, 0.90), (-1.46, 0.92)], -HALF_W + 0.05, HALF_W - 0.05)
    objs.append(new_obj("trunk", trunk, PAINT))
    return objs


def wheels():
    objs = []
    for ax, tag in ((AXLE_F, "f"), (AXLE_R, "r")):
        for side in (-1, 1):
            y = side * (HALF_W - WHEEL_W / 2 + 0.03)
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=WHEEL_R, radius2=WHEEL_R, depth=WHEEL_W)
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                             matrix=__import__("mathutils").Matrix.Rotation(math.pi / 2, 3, "X"))
            bmesh.ops.translate(bm, vec=(ax, y, WHEEL_R), verts=bm.verts)
            tyre = new_obj(f"wheel_{tag}{'l' if side > 0 else 'r'}", bm, "rubber", 0.02)
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.19, radius2=0.15, depth=0.05)
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                             matrix=__import__("mathutils").Matrix.Rotation(-side * math.pi / 2, 3, "X"))
            bmesh.ops.translate(bm, vec=(ax, y + side * (WHEEL_W / 2), WHEEL_R), verts=bm.verts)
            hub = new_obj("hub", bm, "metal_light")
            objs.append(join(tyre.name, [tyre, hub]))
    return objs


def join(name, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    shell = [body(), cabin()] + glass_panels() + trim()
    parts = [join("sedan_body", shell)]
    parts += panels()
    parts += wheels()
    for o in parts:
        o.data.shade_flat() if hasattr(o.data, "shade_flat") else None
    tris = sum(export.mesh_tris(o) for o in parts)
    path = export.export_glb("sedan_olive_hand", parts)
    print(f"sedan_olive_hand: {len(parts)} parts, {tris} tris -> {path}")


if __name__ == "__main__":
    main()
