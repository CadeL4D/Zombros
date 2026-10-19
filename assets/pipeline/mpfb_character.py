"""SOURCE + STYLIZE + RIG for generated characters: MPFB (MakeHuman for Blender) -> contract.

For each entry in content/characters/roster.json:
  1. MPFB builds a human from macro sliders with its game_engine rig, the low-poly
     proxy body, a suit, shoes, hair and an optional hat (all CC0 MakeHuman assets).
  2. The 53-bone MPFB rig is folded into the 22-bone skeleton contract: a new armature
     is built at the character's own joint positions and vertex weights are merged.
  3. Each piece becomes a slot mesh (body, head, top, bottom, shoes, hair, hat),
     decimated to its slot budget; body faces hidden under clothes are removed.
  4. Faces are painted with palette swatches; zombies get torn clothes and blood.

Needs MPFB + the makehuman_system_assets pack (tools/setup.sh).
"""
import importlib
import json
import math
import random
from pathlib import Path

import addon_utils
import bmesh
import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

import base_human
import palette

REPO = Path(__file__).resolve().parents[2]
ROSTER = REPO / "content" / "characters" / "roster.json"

_MPFB = "bl_ext.blender_org.mpfb"

# MPFB game_engine bone -> contract bone (weights are summed into the target).
WEIGHT_MAP = {
    "Root": "pelvis", "pelvis": "pelvis",
    "spine_01": "spine", "spine_02": "spine", "spine_03": "chest",
    "neck_01": "neck", "head": "head",
}
for _s, _S in (("l", "L"), ("r", "R")):
    WEIGHT_MAP.update({
        f"clavicle_{_s}": f"clavicle_{_S}", f"upperarm_{_s}": f"upperarm_{_S}",
        f"lowerarm_{_s}": f"forearm_{_S}", f"hand_{_s}": f"hand_{_S}",
        f"thigh_{_s}": f"thigh_{_S}", f"calf_{_s}": f"shin_{_S}",
        f"foot_{_s}": f"foot_{_S}", f"ball_{_s}": f"toe_{_S}",
    })
    for _f in ("thumb", "index", "middle", "ring", "pinky"):
        for _i in (1, 2, 3):
            WEIGHT_MAP[f"{_f}_0{_i}_{_s}"] = f"hand_{_S}"

# Contract bone -> (MPFB bone for head, MPFB bone for tail[, use its tail]).
JOINTS = {
    "pelvis": ("pelvis", "pelvis"), "spine": ("spine_01", "spine_02"), "chest": ("spine_03", "spine_03"),
    "neck": ("neck_01", "neck_01"), "head": ("head", "head"),
}
for _s, _S in (("l", "L"), ("r", "R")):
    JOINTS.update({
        f"clavicle_{_S}": (f"clavicle_{_s}", f"clavicle_{_s}"), f"upperarm_{_S}": (f"upperarm_{_s}", f"upperarm_{_s}"),
        f"forearm_{_S}": (f"lowerarm_{_s}", f"lowerarm_{_s}"), f"hand_{_S}": (f"hand_{_s}", f"middle_01_{_s}"),
        f"thigh_{_S}": (f"thigh_{_s}", f"thigh_{_s}"), f"shin_{_S}": (f"calf_{_s}", f"calf_{_s}"),
        f"foot_{_S}": (f"foot_{_s}", f"foot_{_s}"), f"toe_{_S}": (f"ball_{_s}", f"ball_{_s}"),
    })

LOWER = {"pelvis", "thigh_L", "thigh_R", "shin_L", "shin_R", "foot_L", "foot_R", "toe_L", "toe_R"}


def _services():
    addon_utils.enable(_MPFB, default_set=True)
    svc = lambda n: importlib.import_module(f"{_MPFB}.services.{n}")
    return (svc("humanservice").HumanService, svc("targetservice").TargetService,
            svc("locationservice").LocationService)


def load_roster():
    return json.loads(ROSTER.read_text())


# ---------------------------------------------------------------- MPFB source

def _mpfb_human(spec, proxy, style=None):
    HumanService, TargetService, LocationService = _services()
    data = Path(LocationService.get_user_data())
    detail = TargetService.get_default_macro_info_dict()
    detail.update(spec["macros"])
    basemesh = HumanService.create_human(macro_detail_dict=detail)
    targets = {**(style or {}), **spec.get("style", {})}
    if targets:
        TargetService.bulk_load_targets(basemesh, [{"target": k, "value": v} for k, v in targets.items()])
    HumanService.add_builtin_rig(basemesh, "game_engine")

    def add(kind, folder, name):
        ext = "proxy" if folder == "proxymeshes" else "mhclo"
        return HumanService.add_mhclo_asset(str(data / folder / name / f"{name}.{ext}"), basemesh,
                                            asset_type=kind, subdiv_levels=0, material_type="NONE")

    out = {"rig": basemesh.parent, "body": add("Proxymeshes", "proxymeshes", proxy)}
    o = spec["outfit"]
    out["suit"] = add("Clothes", "clothes", o["suit"])
    out["shoes"] = add("Clothes", "clothes", o["shoes"])
    out["hair"] = add("Hair", "hair", o["hair"])
    if o.get("hat"):
        out["hat"] = add("Clothes", "clothes", o["hat"])
    out["features"] = _face_features(basemesh)
    bpy.data.objects.remove(basemesh, do_unlink=True)
    for obj in out.values():
        if not isinstance(obj, bpy.types.Object):
            continue
        if obj.type == "MESH":
            for mod in list(obj.modifiers):
                if mod.type != "ARMATURE":
                    obj.modifiers.remove(mod)
    return out


def _face_features(basemesh):
    """Eye and mouth centres/radii (world space) from MPFB helper groups on the shaped basemesh."""
    shown = [(m, m.show_viewport) for m in basemesh.modifiers]
    for m, _ in shown:
        m.show_viewport = False  # keep vertex indices: shape keys only, no mask
    dg = bpy.context.evaluated_depsgraph_get()
    ev = basemesh.evaluated_get(dg)
    me = ev.to_mesh()
    idx = {g.name: g.index for g in basemesh.vertex_groups}
    pts = {k: [] for k in ("helper-l-eye", "helper-r-eye", "lips")}
    for v in basemesh.data.vertices:
        for g in v.groups:
            for k in pts:
                if g.group == idx.get(k) and g.weight > 0.5:
                    pts[k].append(basemesh.matrix_world @ me.vertices[v.index].co)
    ev.to_mesh_clear()
    for m, vis in shown:
        m.show_viewport = vis
    feats = {}
    for key, name in (("helper-l-eye", "eye_L"), ("helper-r-eye", "eye_R"), ("lips", "mouth")):
        p = pts[key]
        c = sum(p, Vector()) / len(p)
        feats[name] = {"center": c, "radius": max((q - c).length for q in p),
                       "halfWidth": max(abs(q.x - c.x) for q in p)}
    return feats


# ---------------------------------------------------------------- rig folding

def _contract_skeleton(mpfb_rig):
    """The contract bone list, moved to this character's MPFB joint positions."""
    skel = base_human.load_contract("skeleton")
    mw = mpfb_rig.matrix_world
    bones = mpfb_rig.data.bones
    pos = {}
    for name, (h, t) in JOINTS.items():
        pos[name] = (mw @ bones[h].head_local, mw @ bones[t].tail_local)
    out = []
    for b in skel["bones"]:
        b = dict(b)
        if b["name"] in pos:
            b["head"], b["tail"] = [list(v) for v in pos[b["name"]]]
        elif b["name"].startswith("prop_"):
            hh, ht = pos["hand_" + b["name"][-1]]
            mid = hh.lerp(ht, 0.6) + Vector((0, -0.01, 0))
            b["head"], b["tail"] = list(mid), list(mid + Vector((0, -0.1, 0)))
        out.append(b)
    # Parents' tails meet children's heads where the contract chains them.
    by = {b["name"]: b for b in out}
    for b in out:
        p = by.get(b["parent"]) if b["parent"] else None
        if p and p["name"] not in ("root", "chest", "pelvis", "hand_L", "hand_R"):
            p["tail"] = list(b["head"])
    by["spine"]["tail"] = list(by["chest"]["head"])
    by["pelvis"]["tail"] = list(by["spine"]["head"])
    by["chest"]["tail"] = list(by["neck"]["head"])
    skel["bones"] = out
    return skel


def _fold_weights(obj):
    """Sum MPFB vertex groups into contract groups, keep 4 strongest, normalise."""
    old = {g.index: g.name for g in obj.vertex_groups}
    acc = [dict() for _ in obj.data.vertices]
    for v in obj.data.vertices:
        for g in v.groups:
            tgt = WEIGHT_MAP.get(old[g.group])
            if tgt and g.weight > 0:
                acc[v.index][tgt] = acc[v.index].get(tgt, 0.0) + g.weight
    obj.vertex_groups.clear()
    groups = {}
    for i, ws in enumerate(acc):
        top = sorted(ws.items(), key=lambda kv: kv[1], reverse=True)[:4]
        total = sum(w for _, w in top)
        for name, w in top:
            if name not in groups:
                groups[name] = obj.vertex_groups.new(name=name)
            groups[name].add([i], w / total, "REPLACE")
    return acc


def _rebind(obj, rig):
    obj.modifiers.clear()
    mw = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = mw
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig


def _dominant(obj, poly):
    w = {}
    for vi in poly.vertices:
        for g in obj.data.vertices[vi].groups:
            n = obj.vertex_groups[g.group].name
            w[n] = w.get(n, 0.0) + g.weight
    return max(w, key=w.get) if w else None


# ---------------------------------------------------------------- mesh ops

def _apply_transform(obj):
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)


def _split(obj, pick, name_a, name_b):
    """Split obj into two objects by a face predicate (True -> name_b)."""
    b = obj.copy()
    b.data = obj.data.copy()
    bpy.context.scene.collection.objects.link(b)
    for o, keep in ((obj, False), (b, True)):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        polys = list(o.data.polygons)
        drop = [f for f in bm.faces if pick(o, polys[f.index]) != keep]
        bmesh.ops.delete(bm, geom=drop, context="FACES")
        bm.to_mesh(o.data)
        bm.free()
    obj.name, b.name = name_a, name_b
    obj.data.name, b.data.name = name_a, name_b
    return obj, b


def _tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


FACET = {"budget": 1.0, "planarDegrees": 0, "clothInflate": 0.0}


def _decimate(obj, max_tris):
    """Collapse to a share of the slot budget, then merge near-flat faces into bigger facets."""
    planar = FACET["planarDegrees"]
    if planar:
        mod = obj.modifiers.new("Planar", "DECIMATE")
        mod.decimate_type = "DISSOLVE"
        mod.angle_limit = math.radians(planar)
        mod.delimit = {"NORMAL"}
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        _triangulate(obj)
    max_tris = int(max_tris * FACET["budget"])
    if _tris(obj) <= max_tris:
        return
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.use_collapse_triangulate = True
    mod.ratio = max_tris / _tris(obj) * 0.97
    bpy.context.view_layer.objects.active = obj
    for _ in range(4):
        dg = bpy.context.evaluated_depsgraph_get()
        me = obj.evaluated_get(dg).to_mesh()
        n = len(me.polygons)
        obj.evaluated_get(dg).to_mesh_clear()
        if n <= max_tris:
            break
        mod.ratio *= max_tris / n * 0.97
    bpy.ops.object.modifier_apply(modifier=mod.name)


def _inflate(obj, dist):
    """Push a piece out along its normals so decimated clothes don't let the body poke through."""
    if dist:
        me = obj.data
        for v in me.vertices:
            v.co += v.normal * dist


def _triangulate(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(obj.data)
    bm.free()


def _transfer_weights(src, dst):
    dst.vertex_groups.clear()
    for g in src.vertex_groups:
        dst.vertex_groups.new(name=g.name)
    mod = dst.modifiers.new("WT", "DATA_TRANSFER")
    mod.object = src
    mod.use_vert_data = True
    mod.data_types_verts = {"VGROUP_WEIGHTS"}
    mod.vert_mapping = "POLYINTERP_NEAREST"
    mod.layers_vgroup_select_src = "ALL"
    mod.layers_vgroup_select_dst = "NAME"
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.modifier_apply(modifier=mod.name)


def _solidify_hair(hair, max_tris):
    """MakeHuman hair is alpha cards; turn it into a solid low-poly shell."""
    src = hair.copy()
    src.data = hair.data.copy()
    bpy.context.scene.collection.objects.link(src)
    hair.modifiers.clear()
    sol = hair.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = 0.03
    sol.offset = 0
    rem = hair.modifiers.new("Remesh", "REMESH")
    rem.mode = "VOXEL"
    rem.voxel_size = 0.012
    bpy.context.view_layer.objects.active = hair
    bpy.ops.object.modifier_apply(modifier=sol.name)
    bpy.ops.object.modifier_apply(modifier=rem.name)
    _decimate(hair, max_tris)
    _transfer_weights(src, hair)
    bpy.data.objects.remove(src, do_unlink=True)
    _rebind(hair, hair.parent)


def _remove_hidden_body(body, covers):
    """Delete body faces whose outward ray hits clothing within a few cm."""
    trees = []
    dg = bpy.context.evaluated_depsgraph_get()
    for c in covers:
        bm = bmesh.new()
        bm.from_mesh(c.data)
        trees.append(BVHTree.FromBMesh(bm))
        bm.free()
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    hidden = []
    for f in bm.faces:
        c, n = f.calc_center_median(), f.normal
        hit = 0
        for v in [f.calc_center_median()] + [vt.co for vt in f.verts]:
            o = c.lerp(v, 0.8) - n * 0.004
            if any(t.ray_cast(o, n, 0.12)[0] is not None for t in trees):
                hit += 1
        if hit == len(f.verts) + 1:
            hidden.append(f)
    bmesh.ops.delete(bm, geom=hidden, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(body.data)
    bm.free()


def _scale_bone_regions(meshes, rig, scales, features=None):
    """Grow head/hands/feet about their joints, blended by skin weight (cartoon proportions)."""
    pivots = {}
    for part, factor in scales.items():
        for name in (part, f"{part}_L", f"{part}_R"):
            bone = rig.data.bones.get(name)
            if bone is None:
                continue
            pivot = rig.matrix_world @ bone.head_local
            if part == "foot":
                pivot = Vector((pivot.x, pivot.y, 0.0))  # keep soles on the ground
            pivots[name] = (pivot, factor)
    for obj in meshes:
        idx = {g.name: g.index for g in obj.vertex_groups}
        for v in obj.data.vertices:
            co = v.co.copy()
            for name, (pivot, factor) in pivots.items():
                gi = idx.get(name)
                if gi is None:
                    continue
                w = next((g.weight for g in v.groups if g.group == gi), 0.0)
                if w > 0:
                    co += (v.co - pivot) * (factor - 1.0) * w
            v.co = co
    if features and "head" in pivots:
        pivot, factor = pivots["head"]
        for f in features.values():
            f["center"] = pivot + (f["center"] - pivot) * factor
            f["radius"] *= factor
            f["halfWidth"] *= factor


def _face_swatch(poly, feats, zombie):
    """Painted face: eyes (and sockets/bloody mouth on zombies) on front-facing head faces."""
    if poly.normal.y > -0.2:
        return None
    c = poly.center
    for side in ("eye_L", "eye_R"):
        e = feats[side]
        d = (c - e["center"]).length
        if d < e["radius"] * 1.15:
            return "zombie_eye" if zombie else "eye_dark"
        if zombie and d < e["radius"] * 1.6 and c.z > e["center"].z - e["radius"] * 0.8:
            return "eye_socket"
    m = feats["mouth"]
    dx, dz = abs(c.x - m["center"].x), c.z - m["center"].z
    if zombie:
        if dx < m["halfWidth"] * 0.9 and abs(dz) < m["radius"] * 0.4:
            return "blood_fresh"
        if dx < m["halfWidth"] * 0.5 and -m["radius"] * 1.8 < dz < 0:
            return "blood_fresh"  # chin drip
    elif dx < m["halfWidth"] * 0.7 and abs(dz) < m["radius"] * 0.25:
        return "lips"
    return None


def _blood_swatch(obj, poly, name, z, off):
    """Big Synty-style blood splashes: hands, chest drip under the mouth, low-frequency blobs."""
    c = poly.center
    if name == "body":
        dom = _dominant(obj, poly) or ""
        if dom.startswith("hand"):
            return "blood_fresh" if noise.noise(c * 14 + off) > -0.5 else "blood_dry"
        if dom.startswith("forearm") and noise.noise(c * 8 + off) > 0.1:
            return "blood_dry"
    if name in ("top", "body") and poly.normal.y < -0.3 and abs(c.x) < 0.07 and 1.1 < c.z < 1.45:
        if noise.noise(Vector((c.x * 30, 0, c.z * 4)) + off) > 0.1:
            return "blood_fresh"
    if name == "head":
        return None
    n = noise.noise(c * 3.2 + off)
    if n > 0.78 - z["blood"] * 0.4:
        return "blood_fresh" if noise.noise(c * 11 - off) > 0 else "blood_dry"
    return None


def _zombify(obj, z, swatch, rng):
    """Tear holes in clothing with noise and mark blood faces. Returns blood face set."""
    off = Vector((rng.random() * 100, rng.random() * 100, rng.random() * 100))
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    tear = [f for f in bm.faces if noise.noise(f.calc_center_median() * 9 + off) > 1 - z["torn"] * 1.6]
    bmesh.ops.delete(bm, geom=tear, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    blood = set()
    for p in obj.data.polygons:
        if noise.noise(p.center * 6 + off * 0.5) > 1 - z["blood"] * 1.4:
            blood.add(p.index)
    return blood


def _limit_and_clean(obj):
    base_human.limit_weights(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(FACET.get("smoothDegrees", 50)))


# ---------------------------------------------------------------- build

def build(spec, proxy="proxy741", style=None, bone_scale=None, facet=None):
    FACET.update(facet or {})
    bpy.ops.wm.read_factory_settings(use_empty=True)
    slots = {s["id"]: s for s in base_human.load_contract("slots")["slots"]}
    src = _mpfb_human(spec, proxy, style)
    skel = _contract_skeleton(src["rig"])

    col = bpy.context.scene.collection
    rig = base_human.build_armature(col, skel)
    rig.name = rig.data.name = f"{spec['id']}_rig"

    pieces = {k: v for k, v in src.items() if k not in ("rig", "features")}
    features = src["features"]
    for obj in pieces.values():
        _fold_weights(obj)
        _rebind(obj, rig)
        bpy.context.view_layer.objects.active = obj
        _apply_transform(obj)
    bpy.data.objects.remove(src["rig"], do_unlink=True)

    body, head = _split(pieces["body"], lambda o, p: _dominant(o, p) == "head", "body", "head")
    top, bottom = _split(pieces["suit"], lambda o, p: _dominant(o, p) in LOWER, "top", "bottom")
    pieces["shoes"].name = pieces["shoes"].data.name = "shoes"
    hair = pieces["hair"]
    hair.name = hair.data.name = "hair"
    meshes = {"body": body, "head": head, "top": top, "bottom": bottom, "shoes": pieces["shoes"], "hair": hair}
    if "hat" in pieces:
        pieces["hat"].name = pieces["hat"].data.name = "hat"
        meshes["hat"] = pieces["hat"]

    _solidify_hair(hair, slots["hair"]["maxTris"])
    for name in ("top", "bottom", "shoes", "hat"):
        if name in meshes:
            _decimate(meshes[name], slots[name]["maxTris"])
            _inflate(meshes[name], FACET["clothInflate"])
    colors = spec["colors"]
    z = spec.get("zombie")
    rng = random.Random(z["seed"] if z else 0)
    blood = {}
    if z:
        for name in ("top", "bottom"):
            blood[name] = _zombify(meshes[name], z, colors[name], rng)
    _remove_hidden_body(body, [top, bottom, meshes["shoes"]])
    _decimate(body, slots["body"]["maxTris"])
    _decimate(head, slots["head"]["maxTris"])

    if bone_scale:
        _scale_bone_regions(meshes.values(), rig, bone_scale, features)

    mat = base_human.palette_material()
    for name, obj in meshes.items():
        base = colors["skin"] if name in ("body", "head") else colors[name]
        off = Vector((rng.random() * 50, rng.random() * 50, rng.random() * 50))

        def swatch(p, obj=obj, name=name, base=base, off=off):
            if name == "head":
                f = _face_swatch(p, features, bool(z))
                if f:
                    return f
            if z and name in ("body", "top", "bottom", "head"):
                b = _blood_swatch(obj, p, name, z, off)
                if b:
                    return b
            if p.index in blood.get(name, ()):
                return "blood_dry"
            return base

        base_human.paint(obj, swatch)
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        _limit_and_clean(obj)
        # Every vertex needs a bone (validate): drop any unweighted loose verts.
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.verts.ensure_lookup_table()
        loose = [bm.verts[v.index] for v in obj.data.vertices if not v.groups]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
    return {"rig": rig, "meshes": list(meshes.values())}
