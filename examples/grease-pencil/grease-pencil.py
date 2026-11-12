"""Dusk Lake: a 2D Grease Pencil diorama, made in Blender 5.2.

Each layer is a flat drawing (filled shapes and ink strokes) placed at its own depth: sky, sun, far mountains, hills,
the lake with the sun's reflection, a sailing boat, a pine shore, birds and reeds in front. The camera slides sideways
over 120 frames, so the near layers pass faster than the far ones (parallax). The boat, the birds and the reeds are
drawn on twos: a key every second frame.

blender -b --factory-startup -P grease-pencil.py   (writes grease-pencil.blend beside this file)
"""
import math
import os
import random

import bpy

FRAMES = 120
random.seed(7)
scene = bpy.context.scene
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob)
scene.frame_start, scene.frame_end, scene.render.fps = 1, FRAMES, 24
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
scene.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("Dusk")
world.color = (0.05, 0.04, 0.1)
scene.world = world

camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.lens = 50
camera.rotation_euler = (math.pi / 2, 0, 0)
scene.collection.objects.link(camera)
scene.camera = camera
for frame, x in ((1, -0.6), (FRAMES, 0.6)):
    camera.location = (x, -12, 0)
    camera.keyframe_insert("location", frame=frame)
for point in camera.animation_data.action.layers[0].strips[0].channelbag(camera.animation_data.action.slots[0]).fcurves[0].keyframe_points:
    point.interpolation = "SINE"
    point.easing = "EASE_IN_OUT"

data = bpy.data.grease_pencils.new("Dusk Lake")
ob = bpy.data.objects.new("Dusk Lake", data)
scene.collection.objects.link(ob)


FILL_ONLY = set()


def linear(color):
    """A display (sRGB) color as the scene linear one Grease Pencil stores."""
    return color and tuple([c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in color[:3]] + [color[3]])


def material(name, stroke=None, fill=None):
    if stroke is None:
        FILL_ONLY.add(len(data.materials))
    stroke, fill = linear(stroke), linear(fill)
    ma = bpy.data.materials.new(name)
    bpy.data.materials.create_gpencil_data(ma)
    gp = ma.grease_pencil
    gp.show_stroke, gp.show_fill = stroke is not None, fill is not None
    gp.color = stroke or fill
    gp.fill_color = fill or (0, 0, 0, 0)
    data.materials.append(ma)
    return len(data.materials) - 1


SKY = [material(f"Sky {i}", fill=c) for i, c in enumerate([
    (0.07, 0.06, 0.2, 1), (0.2, 0.1, 0.3, 1), (0.48, 0.18, 0.32, 1), (0.85, 0.36, 0.28, 1), (1.0, 0.62, 0.32, 1)])]
SUN = material("Sun", fill=(1.0, 0.9, 0.62, 1))
HALO = material("Halo", fill=(1.0, 0.75, 0.45, 0.25))
FAR = material("Far Mountains", fill=(0.42, 0.2, 0.36, 1))
HILLS = material("Hills", stroke=(0.12, 0.05, 0.14, 1), fill=(0.24, 0.1, 0.24, 1))
LAKE = material("Lake", fill=(0.12, 0.07, 0.2, 1))
GLINT = material("Glint", fill=(1.0, 0.68, 0.38, 1))
INK_FILL = material("Ink Fill", fill=(0.02, 0.02, 0.04, 1))
SHORE = material("Shore", stroke=(0.02, 0.02, 0.04, 1), fill=(0.04, 0.03, 0.07, 1))
SAIL = material("Sail", stroke=(0.05, 0.03, 0.06, 1), fill=(0.98, 0.78, 0.6, 1))


class Layer:
    """A layer drawn in screen units at a depth: u across the frame (-1 to 1), v up from the horizon (-0.5625 to 0.5625)."""

    def __init__(self, name, depth):
        self.layer = data.layers.new(name)
        self.layer.use_lights = False  # flat colors: the dusk is in the palette, not the world's light
        self.half = 0.36 * depth  # half the frame's width at that depth, for a 50 mm lens and a 36 mm sensor
        self.depth = depth

    def draw(self, frame, strokes):
        """Strokes of (points [(u, v)], radius, material, cyclic, filled)."""
        drawing = self.layer.frames.new(frame).drawing
        drawing.add_strokes([len(points) for points, *_ in strokes])
        attributes = drawing.attributes
        for name, domain, kind in [("radius", "POINT", "FLOAT"), ("opacity", "POINT", "FLOAT"), ("material_index", "CURVE", "INT"),
                                   ("cyclic", "CURVE", "BOOLEAN"), ("fill_id", "CURVE", "INT"),
                                   ("hide_stroke", "CURVE", "BOOLEAN")]:
            if name not in attributes:
                attributes.new(name, kind, domain)
        h = self.half
        attributes["position"].data.foreach_set("vector", [c for points, *_ in strokes for u, v in points for c in (u * h, self.depth - 12, v * h)])
        attributes["radius"].data.foreach_set("value", [r * h for points, r, *_ in strokes for _ in points])
        attributes["opacity"].data.foreach_set("value", [1.0] * len(attributes["opacity"].data))
        attributes["material_index"].data.foreach_set("value", [m for _, _, m, _, _ in strokes])
        attributes["cyclic"].data.foreach_set("value", [c for _, _, _, c, _ in strokes])
        attributes["hide_stroke"].data.foreach_set("value", [m in FILL_ONLY for _, _, m, _, _ in strokes])
        attributes["fill_id"].data.foreach_set("value", [i + 1 if f else 0 for i, (*_, f) in enumerate(strokes)])


def ridge(u0, u1, base, heights, n):
    """A filled ridge from u0 to u1 above `base`: (u, v) along its top, then down to the base."""
    top = [(u0 + (u1 - u0) * i / (n - 1), base + sum(a * math.sin(f * i / (n - 1) * math.pi + p) for a, f, p in heights)) for i in range(n)]
    return top + [(u1, base - 0.9), (u0, base - 0.9)]


def ribbon(points, width, taper=True):
    """A thin filled shape around a polyline: `width` at its start, narrowing to a point at its end when `taper`."""
    left, right = [], []
    for i, (u, v) in enumerate(points):
        (u0, v0), (u1, v1) = points[max(i - 1, 0)], points[min(i + 1, len(points) - 1)]
        length = math.hypot(u1 - u0, v1 - v0) or 1
        w = width * (1 - i / len(points) if taper else 1) / 2
        nu, nv = -(v1 - v0) / length * w, (u1 - u0) / length * w
        left.append((u + nu, v + nv))
        right.append((u - nu, v - nv))
    return left + right[::-1]


def ellipse(cu, cv, ru, rv, n=40):
    return [(cu + ru * math.cos(2 * math.pi * i / n), cv + rv * math.sin(2 * math.pi * i / n)) for i in range(n)]


sky = Layer("Sky", 70)
bands = [0.6, 0.32, 0.17, 0.08, 0.02, -0.1]
sky.draw(1, [([(-1.4, top), (1.4, top), (1.4, bottom), (-1.4, bottom)], 0.001, SKY[i], True, True)
             for i, (top, bottom) in enumerate(zip(bands, bands[1:]))])

sun = Layer("Sun", 66)
sun.draw(1, [(ellipse(0.22, 0.07, 0.16, 0.16), 0.001, HALO, True, True), (ellipse(0.22, 0.07, 0.075, 0.075), 0.001, SUN, True, True)])

far = Layer("Far Mountains", 45)
far.draw(1, [(ridge(-1.5, 1.5, 0.02, [(0.07, 3, 0.4), (0.03, 9, 1.0), (0.015, 23, 0.2)], 90), 0.001, FAR, True, True)])

hills = Layer("Hills", 28)
hills.draw(1, [(ridge(-1.6, 1.6, -0.01, [(0.05, 2, 2.2), (0.02, 6, 0.3)], 80), 0.01, HILLS, True, True)])

lake = Layer("Lake", 18)
glints = [(ribbon([(u - w, v), (u, v), (u + w, v)], 0.008, False), 0.001, GLINT, True, True)
          for v, w in [(-0.04 - 0.035 * i, 0.09 - 0.012 * i) for i in range(7)] for u in [0.22 + random.uniform(-0.03, 0.03)]]
lake.draw(1, [([(-1.6, -0.02), (1.6, -0.02), (1.6, -0.9), (-1.6, -0.9)], 0.001, LAKE, True, True)] + glints)

boat = Layer("Boat", 15)
for frame in range(1, FRAMES + 1, 2):
    t = frame / FRAMES
    u, v, tilt = -0.25 + 0.12 * t, -0.07 + 0.006 * math.sin(t * 14), 0.05 * math.sin(t * 11)

    def at(du, dv):
        return (u + du * math.cos(tilt) - dv * math.sin(tilt), v + du * math.sin(tilt) + dv * math.cos(tilt))
    boat.draw(frame, [
        ([at(-0.07, 0.015), at(0.07, 0.015), at(0.05, -0.008), at(-0.055, -0.008)], 0.008, SHORE, True, True),
        ([at(0.0, 0.015), at(0.0, 0.16), at(0.055, 0.025)], 0.008, SAIL, True, True),
        ([at(-0.006, 0.02), at(-0.006, 0.13), at(-0.06, 0.025)], 0.008, SAIL, True, True),
    ])

shore = Layer("Pine Shore", 9)
pines = []
for i, (u, height) in enumerate([(-1.25, 0.42), (-1.12, 0.55), (-1.0, 0.38), (-0.88, 0.47), (-0.78, 0.3), (-0.7, 0.22), (1.05, 0.3), (1.18, 0.45), (1.3, 0.36)]):
    tiers = []
    for k in range(5):
        w, top, bottom = height * (0.28 - 0.045 * k), -0.05 + height * (0.35 + 0.15 * k), -0.05 + height * (0.12 + 0.15 * k)
        tiers += [(u - w, bottom), (u - w * 0.3, bottom + 0.01), (u, top), (u + w * 0.3, bottom + 0.01), (u + w, bottom)][: 3 if k < 4 else 5]
    pines.append(([(u - 0.012, -0.1), *tiers, *[(2 * u - pu, pv) for pu, pv in reversed(tiers)], (u + 0.012, -0.1)], 0.002, SHORE, True, True))
shore.draw(1, [([(-1.6, 0.0), (-0.9, -0.01), (-0.6, -0.05), (-0.45, -0.12), (-0.45, -0.9), (-1.6, -0.9)], 0.002, SHORE, True, True),
               ([(0.95, -0.03), (1.6, 0.01), (1.6, -0.9), (0.85, -0.9)], 0.002, SHORE, True, True)] + pines)

birds = Layer("Birds", 22)
flock = [(0.0, 0.0), (0.07, 0.03), (0.12, -0.015)]
for frame in range(1, FRAMES + 1, 2):
    t = frame / FRAMES
    strokes = []
    for k, (du, dv) in enumerate(flock):
        u, v, flap = -0.6 + 0.9 * t + du, 0.16 + dv + 0.01 * math.sin(t * 9 + k), math.sin(frame * 0.6 + k * 1.7)
        s = 0.022
        wing = [(u - s, v + flap * s * 0.6), (u - s * 0.4, v + s * 0.15), (u, v), (u + s * 0.4, v + s * 0.15), (u + s, v + flap * s * 0.6)]
        strokes.append((ribbon(wing, 0.004, False), 0.001, INK_FILL, True, True))
    birds.draw(frame, strokes)

reeds = Layer("Reeds", 4)
stems = [(random.uniform(0.35, 1.3), random.uniform(0.15, 0.36), random.uniform(0, 6)) for _ in range(16)]
for frame in range(1, FRAMES + 1, 2):
    strokes = []
    for u, height, phase in stems:
        sway = 0.025 * math.sin(frame * 0.12 + phase)
        stem = [(u + sway * (i / 7) ** 2, -0.56 + height * i / 7) for i in range(8)]
        strokes.append((ribbon(stem, 0.012), 0.001, INK_FILL, True, True))
        if phase > 3:
            tu, tv = stem[-1]
            strokes.append(([(tu, tv - 0.01), (tu + 0.006, tv + 0.04), (tu - 0.002, tv + 0.06), (tu - 0.007, tv + 0.03)], 0.004, SHORE, True, True))
    reeds.draw(frame, strokes)

data.layers.active = boat.layer
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), "grease-pencil.blend"), compress=True)
