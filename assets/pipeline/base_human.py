"""Base human: canonical skeleton + body + head, palette UVs, body shape keys.

Live (Blender MCP):   sys.path.insert(0, "<repo>/assets/pipeline"); import base_human; base_human.build()
Headless:             blender -b --factory-startup -P assets/pipeline/build_all.py

Everything is generated from content/contracts/*.json, so changing a contract and rebuilding
is all it takes.
"""
import json
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

import palette

REPO = Path(__file__).resolve().parents[2]
CONTRACTS = REPO / "content" / "contracts"
COLLECTION = "BaseHuman"

BODY_TRIS = 2000
SKIN = "skin_2"

# Skin-modifier graph for the left half + centre line (mirrored on X).
# name: (position, (radius_x, radius_y), parent)
BODY_GRAPH = {
    "pelvis":    ((0, 0.00, 0.95), (0.170, 0.118), None),
    "waist":     ((0, 0.00, 1.10), (0.158, 0.108), "pelvis"),
    "chest":     ((0, -0.01, 1.28), (0.200, 0.132), "waist"),
    "ribtop":    ((0, 0.00, 1.40), (0.195, 0.118), "chest"),
    "neck":      ((0, 0.01, 1.48), (0.068, 0.066), "ribtop"),
    "neck_top":  ((0, 0.01, 1.56), (0.064, 0.062), "neck"),
    "shoulder":  ((0.17, 0.00, 1.40), (0.080, 0.080), "ribtop"),
    "elbow":     ((0.375, 0.02, 1.215), (0.058, 0.058), "shoulder"),
    "forearm":   ((0.465, 0.01, 1.125), (0.056, 0.050), "elbow"),
    "wrist":     ((0.555, 0.00, 1.035), (0.040, 0.034), "forearm"),
    "palm":      ((0.615, -0.005, 0.975), (0.056, 0.028), "wrist"),
    "fingers":   ((0.682, -0.005, 0.908), (0.046, 0.024), "palm"),
    "thumb":     ((0.600, -0.055, 0.990), (0.018, 0.018), "wrist"),
    "hip":       ((0.10, 0.00, 0.90), (0.108, 0.108), "pelvis"),
    "thigh_mid": ((0.105, -0.01, 0.72), (0.094, 0.094), "hip"),
    "knee":      ((0.11, -0.02, 0.52), (0.072, 0.072), "thigh_mid"),
    "calf":      ((0.115, 0.00, 0.36), (0.070, 0.070), "knee"),
    "ankle":     ((0.12, 0.01, 0.10), (0.052, 0.052), "calf"),
    "heel":      ((0.12, 0.02, 0.045), (0.054, 0.048), "ankle"),
    "toes":      ((0.12, -0.17, 0.035), (0.058, 0.034), "heel"),
}


def load_contract(name):
    return json.loads((CONTRACTS / f"{name}.json").read_text())


# ---------------------------------------------------------------- scene helpers

def _collection():
    col = bpy.data.collections.get(COLLECTION)
    if col is None:
        col = bpy.data.collections.new(COLLECTION)
        bpy.context.scene.collection.children.link(col)
    for obj in list(col.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Armature):
                bpy.data.armatures.remove(data)
    return col


def _bake(obj):
    """Apply all modifiers of obj in place."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    bpy.data.meshes.remove(old)
    me.name = obj.name


def _tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ---------------------------------------------------------------- material / uv

def palette_material():
    png = palette.write_png()
    mat = bpy.data.materials.get("palette") or bpy.data.materials.new("palette")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.get("palette.png")
    if img is None:
        img = bpy.data.images.load(str(png))
    else:
        img.filepath = str(png)
        img.reload()
    tex.image = img
    tex.interpolation = "Closest"
    bsdf.inputs["Roughness"].default_value = 0.85
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def paint(obj, swatch_for_face):
    """Point every face's UVs at a palette swatch centre. swatch_for_face(polygon) -> name."""
    pal = palette.load()
    me = obj.data
    uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        u, v = palette.uv(swatch_for_face(poly), pal)
        for li in poly.loop_indices:
            uvl.data[li].uv = (u, v)


# ---------------------------------------------------------------- skeleton

def build_armature(col, skel):
    arm = bpy.data.armatures.new("human_rig")
    obj = bpy.data.objects.new("human_rig", arm)
    col.objects.link(obj)
    arm.display_type = "STICK"
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = {}
    for b in skel["bones"]:
        eb = arm.edit_bones.new(b["name"])
        eb.head, eb.tail = b["head"], b["tail"]
        eb.use_deform = b["deform"]
        if b["parent"]:
            eb.parent = bones[b["parent"]]
            eb.use_connect = (Vector(eb.parent.tail) - Vector(b["head"])).length < 1e-4
        bones[b["name"]] = eb
    # Roll: limb bones' local Z points forward (-Y) so bends are consistent L/R.
    for eb in arm.edit_bones:
        eb.align_roll(Vector((0, -1, 0)) if abs(eb.vector.z) > abs(eb.vector.y) else Vector((0, 0, 1)))
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


# ---------------------------------------------------------------- body

def build_body(col):
    names = list(BODY_GRAPH)
    verts = [BODY_GRAPH[n][0] for n in names]
    edges = [(names.index(p), i) for i, n in enumerate(names) if (p := BODY_GRAPH[n][2])]
    me = bpy.data.meshes.new("body")
    me.from_pydata(verts, edges, [])
    obj = bpy.data.objects.new("body", me)
    col.objects.link(obj)

    mirror = obj.modifiers.new("Mirror", "MIRROR")
    mirror.use_clip = True
    mirror.use_mirror_merge = True
    skin = obj.modifiers.new("Skin", "SKIN")
    skin.use_smooth_shade = False
    skin.branch_smoothing = 0.6
    for i, n in enumerate(names):
        sv = me.skin_vertices[0].data[i]
        sv.radius = BODY_GRAPH[n][1]
        sv.use_root = n == "pelvis"
    sub = obj.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = 1
    _bake(obj)

    if _tris(obj) > BODY_TRIS:
        dec = obj.modifiers.new("Decimate", "DECIMATE")
        dec.use_symmetry = True
        dec.symmetry_axis = "X"
        dec.ratio = BODY_TRIS / _tris(obj)
        _bake(obj)
    for p in obj.data.polygons:
        p.use_smooth = False

    def swatch(p):
        c = p.center
        if 0.84 < c.z < 1.03 and abs(c.x) < 0.2:
            return "underwear"
        return SKIN

    paint(obj, swatch)
    return obj


# ---------------------------------------------------------------- head

HEAD_C = Vector((0, -0.005, 1.675))
HEAD_R = Vector((0.108, 0.126, 0.138))


def build_head(col):
    me = bpy.data.meshes.new("head")
    bm = bmesh.new()
    tag = bm.faces.layers.int.new("swatch")
    tags = [SKIN]
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=8, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        # Rough skull: narrower jaw, flatter back, a little chin and nose.
        jaw = 1.0 - 0.26 * max(0.0, -z)
        v.co.x = x * HEAD_R.x * jaw
        v.co.y = y * HEAD_R.y * (0.9 if y > 0 else 1.0)
        v.co.z = z * HEAD_R.z
        if y < -0.9 and -0.3 < z < 0.3:
            v.co.y -= 0.02   # nose ridge
        if y < -0.6 and z < -0.6:
            v.co.y -= 0.012  # chin
        v.co += HEAD_C

    def add(geom, swatch):
        if swatch not in tags:
            tags.append(swatch)
        for f in {f for v in geom["verts"] for f in v.link_faces}:
            f[tag] = tags.index(swatch)

    # Eyes and brows: small separate facets on the face.
    front = HEAD_C.y - HEAD_R.y * 0.9
    for side in (1, -1):
        eye = bmesh.ops.create_cone(bm, segments=6, radius1=0.017, radius2=0.015, depth=0.012, cap_ends=True)
        bmesh.ops.rotate(bm, verts=eye["verts"], cent=(0, 0, 0), matrix=_rot_x(math.pi / 2))
        bmesh.ops.scale(bm, verts=eye["verts"], vec=(1.0, 1.0, 1.15))
        bmesh.ops.translate(bm, verts=eye["verts"], vec=(side * 0.042, front - 0.004, HEAD_C.z + 0.008))
        add(eye, "eye_dark")
        brow = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, verts=brow["verts"], vec=(0.04, 0.014, 0.011))
        bmesh.ops.translate(bm, verts=brow["verts"], vec=(side * 0.044, front - 0.002, HEAD_C.z + 0.04))
        add(brow, "hair_brown")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("head", me)
    col.objects.link(obj)
    for p in me.polygons:
        p.use_smooth = False
    attr = me.attributes["swatch"]
    paint(obj, lambda p: tags[attr.data[p.index].value])
    me.attributes.remove(attr)
    return obj

def _rot_x(a):
    from mathutils import Matrix
    return Matrix.Rotation(a, 3, "X")


# ---------------------------------------------------------------- shape keys

def _bone_segments(skel):
    return [(b["name"], Vector(b["head"]), Vector(b["tail"])) for b in skel["bones"] if b["deform"]]


def _nearest_axis(co, segs):
    best = None
    for name, h, t in segs:
        p, f = intersect_point_line(co, h, t)
        f = max(0.0, min(1.0, f))
        p = h.lerp(t, f)
        d = (co - p).length
        if best is None or d < best[0]:
            best = (d, name, p)
    return best[1], best[2]


def _gauss(x, c, w):
    return math.exp(-((x - c) / w) ** 2)


def add_shape_keys(obj, skel, is_head=False):
    segs = _bone_segments(skel)
    obj.shape_key_add(name="Basis", from_mix=False)
    base = [v.co.copy() for v in obj.data.vertices]
    info = [_nearest_axis(c, segs) for c in base]

    def key(name, fn):
        sk = obj.shape_key_add(name=name, from_mix=False)
        for i, c in enumerate(base):
            sk.data[i].co = fn(c, *info[i])

    def radial(c, axis_pt, k):
        return axis_pt + (c - axis_pt) * k

    torso = {"pelvis", "spine", "chest"}

    def female(c, bone, p):
        if is_head:
            return Vector((c.x * 0.94, c.y, c.z - 0.004 * max(0, HEAD_C.z - c.z) / 0.1))
        n = c.copy()
        if bone in torso or bone.startswith("thigh"):
            n.x *= 1 + 0.10 * _gauss(c.z, 0.92, 0.09) - 0.08 * _gauss(c.z, 1.14, 0.06) - 0.05 * _gauss(c.z, 1.38, 0.05)
        if bone in torso and c.y < 0:
            n.y -= 0.035 * _gauss(c.z, 1.30, 0.045) * _gauss(abs(c.x), 0.085, 0.05)
        if bone in torso and c.y > 0:
            n.y += 0.025 * _gauss(c.z, 0.90, 0.07)
        if bone.startswith(("clavicle", "upperarm", "forearm", "hand")):
            n = radial(n, p, 0.9)
            n.x -= math.copysign(0.012, c.x)
        if bone.startswith(("thigh", "shin")):
            n = radial(n, p, 1.04)
        return n

    def heavy(c, bone, p):
        if is_head:
            return radial(c, Vector((HEAD_C.x, HEAD_C.y, c.z)), 1 + 0.12 * max(0, HEAD_C.z + 0.02 - c.z) / 0.12)
        n = radial(c, p, 1.22 if bone in torso else 1.14)
        if bone in torso and c.y < 0:
            n.y -= 0.07 * _gauss(c.z, 1.10, 0.12)
        return n

    def thin(c, bone, p):
        if is_head:
            return Vector((c.x * 0.94, c.y, c.z))
        return radial(c, p, 0.86)

    def muscular(c, bone, p):
        if is_head:
            return Vector((c.x * (1.04 if c.z < HEAD_C.z else 1.0), c.y, c.z))
        if bone.startswith(("upperarm", "forearm", "clavicle")):
            return radial(c, p, 1.2)
        if bone in torso:
            n = c.copy()
            n.x *= 1 + 0.12 * _gauss(c.z, 1.36, 0.08)
            if c.y < 0:
                n.y -= 0.02 * _gauss(c.z, 1.32, 0.06)
            return n
        if bone.startswith(("thigh", "shin")):
            return radial(c, p, 1.1)
        return c.copy()

    key("female", female)
    key("heavy", heavy)
    key("thin", thin)
    key("muscular", muscular)


# ---------------------------------------------------------------- skinning

def bind(meshes, rig):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for m in meshes:
        m.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    # The head follows only the head (and a little neck at the base).
    head = next(m for m in meshes if m.name == "head")
    for vg in list(head.vertex_groups):
        head.vertex_groups.remove(vg)
    g_head = head.vertex_groups.new(name="head")
    g_neck = head.vertex_groups.new(name="neck")
    for v in head.data.vertices:
        w = max(0.0, min(1.0, (v.co.z - 1.555) / 0.04))
        g_head.add([v.index], w, "REPLACE")
        if w < 1:
            g_neck.add([v.index], 1 - w, "REPLACE")


def limit_weights(obj, n=4):
    for v in obj.data.vertices:
        gs = sorted(v.groups, key=lambda g: g.weight, reverse=True)
        for g in gs[n:]:
            obj.vertex_groups[g.group].remove([v.index])
        total = sum(g.weight for g in v.groups) or 1.0
        for g in v.groups:
            g.weight /= total


# ---------------------------------------------------------------- build

def build():
    skel = load_contract("skeleton")
    col = _collection()
    mat = palette_material()
    rig = build_armature(col, skel)
    body = build_body(col)
    head = build_head(col)
    for m in (body, head):
        m.data.materials.clear()
        m.data.materials.append(mat)
    bind([body, head], rig)
    for m in (body, head):
        limit_weights(m)
        add_shape_keys(m, skel, is_head=m is head)
    return {"rig": rig, "body": body, "head": head, "tris": {"body": _tris(body), "head": _tris(head)}}
