"""VALIDATE stage: fail the build when an asset breaks a contract (tri budget, bones, palette)."""
import json
from pathlib import Path

import palette

REPO = Path(__file__).resolve().parents[2]
CONTRACTS = REPO / "content" / "contracts"


class ContractError(Exception):
    pass


def _load(name):
    return json.loads((CONTRACTS / f"{name}.json").read_text())


def _swatch_uvs():
    pal = palette.load()
    return {palette.uv(n, pal) for n in pal["swatches"]}


def check_palette_uvs(obj):
    allowed = _swatch_uvs()
    uvl = obj.data.uv_layers.active
    if uvl is None:
        raise ContractError(f"{obj.name}: no UVs")
    for d in uvl.data:
        u, v = d.uv
        if not any(abs(u - a) < 1e-4 and abs(v - b) < 1e-4 for a, b in allowed):
            raise ContractError(f"{obj.name}: UV {u:.4f},{v:.4f} is not a palette swatch centre")


def check_character(rig, meshes):
    skel = _load("skeleton")
    slots = {s["id"]: s for s in _load("slots")["slots"]}
    want = [b["name"] for b in skel["bones"]]
    have = [b.name for b in rig.data.bones]
    if have != want:
        raise ContractError(f"rig bones {have} != skeleton contract {want}")
    deform = {b["name"] for b in skel["bones"] if b["deform"]}
    for m in meshes:
        slot = slots.get(m.name)
        if slot is None:
            raise ContractError(f"{m.name}: not a slot name {list(slots)}")
        tris = sum(len(p.vertices) - 2 for p in m.data.polygons)
        if tris > slot["maxTris"]:
            raise ContractError(f"{m.name}: {tris} tris > budget {slot['maxTris']}")
        stray = {g.name for g in m.vertex_groups} - deform
        if stray:
            raise ContractError(f"{m.name}: vertex groups not on deform bones: {stray}")
        for v in m.data.vertices:
            if len(v.groups) == 0 or len(v.groups) > 4:
                raise ContractError(f"{m.name}: vertex {v.index} has {len(v.groups)} bone weights (need 1-4)")
        check_palette_uvs(m)
