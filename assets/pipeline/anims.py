"""Procedural keyframed clips on the contract skeleton (placeholders until AI motion lands).

Each clip is a function t (0..1, looping) -> {bone: [(axis, angle), ...]} plus an optional
pelvis bob. Axes are anatomical, resolved per bone from its rest orientation:
  fwd  - swing the bone's tail forward (-Y)    side - tail toward the character's left (+X)
  down - tail downward (-Z)                     twist - about the bone's own axis
Every clip becomes an NLA track, which the glTF exporter writes as one animation each.
"""
import math

import bpy
from mathutils import Quaternion, Vector

FPS = 24
TAU = math.tau

_TARGET = {"fwd": (Vector((1, 0, 0)), Vector((0, -1, 0))),
           "side": (Vector((0, 0, 1)), Vector((1, 0, 0))),
           "down": (Vector((0, 0, 1)), Vector((0, 0, -1)))}


def _axis(bone, kind):
    """Local rotation axis (signed) that moves the bone tail toward the named direction."""
    if kind == "twist":
        return Vector((0, 1, 0))
    local, target = _TARGET[kind]
    m = bone.matrix_local.to_3x3()
    d = m @ Vector((0, 1, 0))
    moved = Quaternion(m @ local, 0.1) @ d
    if (moved - d).dot(target) >= 0:
        return local.copy()
    return -local


def _sin(t, phase=0.0):
    return math.sin(TAU * t + phase)


# ---------------------------------------------------------------- clips

def idle(t):
    b = 0.025 * _sin(t)
    return {
        "spine": [("fwd", b * 0.5)], "chest": [("fwd", -b)], "head": [("side", 0.03 * _sin(t, 1.0))],
        "upperarm_L": [("down", 0.62), ("fwd", 0.05)], "upperarm_R": [("down", 0.62), ("fwd", 0.05)],
        "forearm_L": [("fwd", 0.12)], "forearm_R": [("fwd", 0.12)],
    }, 0.004 * _sin(t)


def _gait(t, stride, knee, arm, elbow, lean, drag=1.0):
    s = _sin(t)
    pose = {
        "thigh_L": [("fwd", stride * s)], "thigh_R": [("fwd", -stride * s * drag)],
        "shin_L": [("fwd", -knee * max(0.0, _sin(t, 1.5)))],
        "shin_R": [("fwd", -knee * drag * max(0.0, _sin(t, 1.5 + math.pi)))],
        "foot_L": [("fwd", 0.15 * stride * _sin(t, 0.6))], "foot_R": [("fwd", -0.15 * stride * _sin(t, 0.6))],
        "upperarm_L": [("down", 0.62), ("fwd", -arm * s)], "upperarm_R": [("down", 0.62), ("fwd", arm * s)],
        "forearm_L": [("fwd", elbow)], "forearm_R": [("fwd", elbow)],
        "spine": [("twist", 0.06 * s * stride)], "chest": [("fwd", lean), ("twist", -0.1 * s * stride)],
    }
    return pose, 0.025 * stride * abs(math.cos(TAU * t))


def walk(t):
    return _gait(t, stride=0.42, knee=0.6, arm=0.32, elbow=0.25, lean=0.04)


def run(t):
    pose, bob = _gait(t, stride=0.7, knee=1.2, arm=0.45, elbow=1.1, lean=0.18)
    return pose, bob * 1.6


def zombie_idle(t):
    s = _sin(t)
    return {
        "spine": [("fwd", 0.12)], "chest": [("fwd", 0.28 + 0.03 * s), ("side", 0.06)],
        "neck": [("fwd", -0.15)], "head": [("side", 0.22 + 0.05 * _sin(t, 2.0)), ("fwd", -0.1)],
        "upperarm_L": [("down", 0.7), ("fwd", 0.15 + 0.05 * s)], "upperarm_R": [("down", 0.55), ("fwd", 0.25)],
        "forearm_L": [("fwd", 0.2)], "forearm_R": [("fwd", 0.35)],
        "thigh_R": [("fwd", 0.08)], "shin_R": [("fwd", -0.15)],
    }, 0.006 * s


def shamble(t):
    pose, bob = _gait(t, stride=0.3, knee=0.35, arm=0.0, elbow=0.0, lean=0.0, drag=0.45)
    s = _sin(t)
    pose.update({
        "spine": [("fwd", 0.15), ("twist", 0.08 * s)], "chest": [("fwd", 0.3), ("side", 0.08 * s)],
        "neck": [("fwd", -0.2)], "head": [("side", 0.2 + 0.08 * s), ("fwd", -0.1)],
        "upperarm_L": [("down", 0.2), ("fwd", 1.05 + 0.08 * s)], "upperarm_R": [("down", 0.25), ("fwd", 0.95 - 0.08 * s)],
        "forearm_L": [("fwd", 0.2)], "forearm_R": [("fwd", 0.3)],
    })
    return pose, bob * 1.4


def zombie_attack(t):
    k = math.sin(math.pi * t) ** 2  # 0 -> 1 -> 0 lunge
    return {
        "spine": [("fwd", 0.15 + 0.2 * k)], "chest": [("fwd", 0.25 + 0.35 * k)],
        "neck": [("fwd", -0.25 * k)], "head": [("fwd", -0.2 * k)],
        "upperarm_L": [("down", 0.25 - 0.2 * k), ("fwd", 0.9 + 0.7 * k)],
        "upperarm_R": [("down", 0.25 - 0.2 * k), ("fwd", 0.8 + 0.8 * k)],
        "forearm_L": [("fwd", 0.5 - 0.4 * k)], "forearm_R": [("fwd", 0.5 - 0.4 * k)],
        "thigh_L": [("fwd", 0.35 * k)], "shin_L": [("fwd", -0.3 * k)],
        "thigh_R": [("fwd", -0.2 * k)],
    }, -0.04 * k


# name -> (function, seconds)
LIBRARY = {
    "idle": (idle, 2.4), "walk": (walk, 1.0), "run": (run, 0.66),
    "zombie_idle": (zombie_idle, 3.0), "shamble": (shamble, 1.6), "zombie_attack": (zombie_attack, 1.2),
}
CLIPS = {"survivor": ["idle", "walk", "run"], "zombie": ["zombie_idle", "shamble", "zombie_attack"]}


# ---------------------------------------------------------------- baking

def add_clips(rig, names):
    bpy.context.scene.render.fps = FPS
    ad = rig.animation_data or rig.animation_data_create()
    axes = {}
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        axes[pb.name] = {k: _axis(pb.bone, k) for k in ("fwd", "side", "down", "twist")}
    for name in names:
        fn, secs = LIBRARY[name]
        act = bpy.data.actions.new(name)
        ad.action = act
        frames = max(2, round(secs * FPS))
        for f in range(frames + 1):
            pose, bob = fn((f % frames) / frames)
            for pb in rig.pose.bones:
                q = Quaternion()
                for kind, angle in pose.get(pb.name, []):
                    q = q @ Quaternion(axes[pb.name][kind], angle)
                pb.rotation_quaternion = q
                pb.keyframe_insert("rotation_quaternion", frame=f + 1)
            pelvis = rig.pose.bones["pelvis"]
            pelvis.location = (0.0, bob, 0.0)  # pelvis local Y points up
            pelvis.keyframe_insert("location", frame=f + 1)
        ad.action = None
        track = ad.nla_tracks.new()
        track.name = name
        track.strips.new(name, 1, act)
    for pb in rig.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)
    return names
