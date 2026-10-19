"""NORMALIZE + STYLIZE stages for AI props: raw mesh -> low-poly, flat-shaded, palette-coloured GLB.

Runs in the project venv (not Blender):

    python assets/pipeline/stylize.py [id ...]      # default: every prop in content/props/ai_props.json

For each prop (raw mesh from ai_shapegen.py in assets/source/ai/):
  1. decimate to the tri budget (quadric edge collapse, planar-aware)
  2. find the camera that sees the mesh like the reference image (silhouette match)
  3. paint each visible face with the reference colour under it, snapped to the palette
     (2-4 swatches per object); hidden faces inherit from their neighbours
  4. scale to real size, stand on y=0, centre, UV every face into its swatch centre
Writes assets/build/<id>.glb and assets/source/ai/<id>_view.json (camera, for preview renders).
"""
import json
import sys
from collections import Counter, deque
from pathlib import Path

import numpy as np
import pymeshlab
import trimesh
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import palette  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "assets" / "source" / "ai"
BUILD = REPO / "assets" / "build"
SPECS = REPO / "content" / "props" / "ai_props.json"

# Swatches a prop may snap to unless its spec lists its own.
PROP_SWATCHES = [
    "cloth_white", "cloth_grey", "cloth_black", "cloth_denim", "cloth_navy", "cloth_red", "cloth_green",
    "cloth_olive", "cloth_khaki", "cloth_brown", "cloth_yellow", "cloth_orange", "terrain_dirt", "terrain_sand",
    "terrain_rock", "foliage_pine", "foliage_leaf", "bark", "wood_light", "wood_dark", "metal_light",
    "metal_dark", "concrete", "brick", "asphalt", "glass", "rubber", "bone",
]
MAX_SWATCHES = 4
SIL = 128        # silhouette match resolution
PAINT = 512      # colour sampling resolution


# ---------- colour ----------

def srgb_to_lab(rgb):
    c = np.asarray(rgb, float) / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    xyz = c @ np.array([[0.4124, 0.2126, 0.0193], [0.3576, 0.7152, 0.1192], [0.1805, 0.0722, 0.9505]])
    xyz /= np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lab_dist(a, b):
    # Lighting in the reference shifts lightness far more than hue, so lightness counts for less.
    d = a[..., None, :] - b
    return np.sqrt((0.5 * d[..., 0]) ** 2 + d[..., 1] ** 2 + d[..., 2] ** 2)


# ---------- geometry ----------

def decimate(mesh, tris):
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(mesh.vertices, mesh.faces))
    ms.meshing_merge_close_vertices()
    ms.meshing_decimation_quadric_edge_collapse(
        targetfacenum=int(tris), preservenormal=True, planarquadric=True,
        optimalplacement=True, qualitythr=0.4, autoclean=True)
    m = ms.current_mesh()
    return trimesh.Trimesh(m.vertex_matrix(), m.face_matrix(), process=True)


def camera(az, el):
    """Orthographic camera on the unit sphere looking at the origin (Y up). Returns right, up, toward-camera."""
    a, e = np.radians(az), np.radians(el)
    d = np.array([np.cos(e) * np.sin(a), np.sin(e), np.cos(e) * np.cos(a)])
    right = np.cross([0, 1, 0], d)
    right /= np.linalg.norm(right)
    return right, np.cross(d, right), d


def project(verts, cam):
    right, up, d = cam
    return np.stack([verts @ right, verts @ up], -1), verts @ d


def fit(pts2d, size, pad=0.04):
    """Map 2D points into a size x size image, bbox fitted and centred (y down)."""
    lo, hi = pts2d.min(0), pts2d.max(0)
    s = (1 - 2 * pad) * size / max(hi - lo)
    off = (size - s * (hi - lo)) / 2
    p = (pts2d - lo) * s + off
    p[:, 1] = size - p[:, 1]
    return p


def fit_image(alpha_img, rgb_img, size, pad=0.04):
    a = np.asarray(alpha_img)
    ys, xs = np.nonzero(a > 127)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    w, h = box[2] - box[0], box[3] - box[1]
    s = (1 - 2 * pad) * size / max(w, h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    ox, oy = (size - nw) // 2, (size - nh) // 2
    out_a = Image.new("L", (size, size), 0)
    out_a.paste(alpha_img.crop(box).resize((nw, nh), Image.BILINEAR), (ox, oy))
    out_c = Image.new("RGB", (size, size), (0, 0, 0))
    out_c.paste(rgb_img.crop(box).resize((nw, nh), Image.BILINEAR), (ox, oy))
    return np.asarray(out_a) > 127, np.asarray(out_c)


def silhouette(mesh, cam, size):
    p2, _ = project(mesh.vertices, cam)
    p = fit(p2, size)
    img = Image.new("1", (size, size), 0)
    draw = ImageDraw.Draw(img)
    for f in mesh.faces:
        draw.polygon([tuple(p[i]) for i in f], fill=1)
    return np.asarray(img)


def face_ids(mesh, cam, size):
    """Painter's-algorithm face-id buffer (-1 = background)."""
    p2, depth = project(mesh.vertices, cam)
    p = fit(p2, size)
    order = np.argsort(depth[mesh.faces].mean(1))  # far first
    img = Image.new("I", (size, size), -1)
    draw = ImageDraw.Draw(img)
    for fi in order:
        draw.polygon([tuple(p[i]) for i in mesh.faces[fi]], fill=int(fi))
    return np.asarray(img)


def iou(a, b):
    return (a & b).sum() / max(1, (a | b).sum())


def best_view(mesh, ref_sil):
    best = (-1, 0, 0)
    for az in range(0, 360, 15):
        for el in range(-15, 76, 15):
            best = max(best, (iou(silhouette(mesh, camera(az, el), SIL), ref_sil), az, el))
    _, az0, el0 = best
    for az in np.arange(az0 - 12, az0 + 12.1, 3):
        for el in np.arange(el0 - 12, el0 + 12.1, 3):
            best = max(best, (iou(silhouette(mesh, camera(az, el), SIL), ref_sil), float(az), float(el)))
    return best


# ---------- painting ----------

def paint(mesh, cam, ref_rgb, ref_mask, swatch_names, pal):
    ids = face_ids(mesh, cam, PAINT)
    lab = srgb_to_lab(ref_rgb)
    names = list(swatch_names)
    sw_lab = srgb_to_lab([palette._hex(pal["swatches"][n]["color"]) for n in names])

    nf = len(mesh.faces)
    face_lab = np.full((nf, 3), np.nan)
    valid = (ids >= 0) & ref_mask
    flat_ids, flat_lab = ids[valid], lab[valid]
    order = np.argsort(flat_ids)
    flat_ids, flat_lab = flat_ids[order], flat_lab[order]
    uniq, starts, counts = np.unique(flat_ids, return_index=True, return_counts=True)
    for fi, s, c in zip(uniq, starts, counts):
        if c >= 3:
            face_lab[fi] = np.median(flat_lab[s:s + c], 0)

    seen = ~np.isnan(face_lab[:, 0])
    label = np.full(nf, -1)
    label[seen] = lab_dist(face_lab[seen], sw_lab).argmin(1)

    # Keep the object's few dominant swatches (by visible area) and re-snap the rest to them.
    area = Counter()
    for fi in np.nonzero(seen)[0]:
        area[label[fi]] += mesh.area_faces[fi]
    total = sum(area.values())
    keep = [k for k, a in area.most_common(MAX_SWATCHES) if a / total > 0.03] or [area.most_common(1)[0][0]]
    label[seen] = np.array(keep)[lab_dist(face_lab[seen], sw_lab[keep]).argmin(1)]

    # Hidden faces: flood from painted neighbours.
    nbrs = [[] for _ in range(nf)]
    for a, b in mesh.face_adjacency:
        nbrs[a].append(b)
        nbrs[b].append(a)
    q = deque(np.nonzero(label >= 0)[0])
    while q:
        f = q.popleft()
        for n in nbrs[f]:
            if label[n] < 0:
                label[n] = label[f]
                q.append(n)
    label[label < 0] = keep[0]

    # One smoothing pass: a lone face that disagrees with all its neighbours joins them.
    for f in range(nf):
        votes = Counter(label[n] for n in nbrs[f])
        if votes and label[f] not in votes:
            label[f] = votes.most_common(1)[0][0]
    return [names[i] for i in label]


def to_glb(mesh, face_swatch, pal, path):
    mesh = mesh.copy()
    mesh.unmerge_vertices()  # flat shading: every face owns its corners
    uv = np.zeros((len(mesh.vertices), 2))
    for fi, name in enumerate(face_swatch):
        uv[mesh.faces[fi]] = palette.uv(name, pal)
    tex = Image.open(BUILD / pal["image"])
    mat = trimesh.visual.material.PBRMaterial(baseColorTexture=tex, metallicFactor=0.0, roughnessFactor=1.0)
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat)
    path.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(path)


def normalize(mesh, size):
    mesh = mesh.copy()
    ext = mesh.extents
    mesh.apply_scale(size / ext.max())
    lo, hi = mesh.bounds
    mesh.apply_translation([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
    return mesh


def stylize(spec, pal):
    pid = spec["id"]
    raw = trimesh.load(RAW / f"{pid}.glb", force="mesh")
    mesh = decimate(raw, spec["tris"])
    mesh.apply_translation(-mesh.bounds.mean(0))

    cut = Image.open(RAW / f"{pid}_cutout.png").convert("RGBA")
    ref_sil, _ = fit_image(cut.getchannel("A"), cut.convert("RGB"), SIL)
    score, az, el = best_view(mesh, ref_sil)
    ref_mask, ref_rgb = fit_image(cut.getchannel("A"), cut.convert("RGB"), PAINT)

    swatches = spec.get("swatches", PROP_SWATCHES)
    face_swatch = paint(mesh, camera(az, el), ref_rgb, ref_mask, swatches, pal)

    mesh = normalize(mesh, spec["size"])
    to_glb(mesh, face_swatch, pal, BUILD / f"{pid}.glb")
    used = sorted(set(face_swatch))
    (RAW / f"{pid}_view.json").write_text(json.dumps({"azimuth": az, "elevation": el, "iou": round(score, 3)}))
    print(f"{pid}: {len(raw.faces)} -> {len(mesh.faces)} tris, view az={az:.0f} el={el:.0f} "
          f"(silhouette IoU {score:.2f}), swatches {used}", flush=True)
    return mesh, used


if __name__ == "__main__":
    want = set(sys.argv[1:])
    pal = palette.load()
    for spec in json.loads(SPECS.read_text())["props"]:
        if not want or spec["id"] in want:
            stylize(spec, pal)
