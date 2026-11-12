"""Bouncing Ball: a 2D Grease Pencil animation, drawn on twos, made in Blender 5.2.

blender -b --factory-startup -P grease-pencil.py   (writes grease-pencil.blend beside this file)
"""
import math
import os

import bpy

FRAMES = 24
scene = bpy.context.scene
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob)
scene.frame_start, scene.frame_end, scene.render.fps = 1, FRAMES, 24
scene.render.resolution_x, scene.render.resolution_y = 1280, 720

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 50

camera.location = (0, -12, 1.2)
camera.rotation_euler = (math.pi / 2, 0, 0)
scene.collection.objects.link(camera)
scene.camera = camera

data = bpy.data.grease_pencils.new('Bouncing Ball')
ob = bpy.data.objects.new('Bouncing Ball', data)
scene.collection.objects.link(ob)


def material(name, stroke, fill):
    ma = bpy.data.materials.new(name)
    bpy.data.materials.create_gpencil_data(ma)
    ma.grease_pencil.color = stroke
    ma.grease_pencil.fill_color = fill
    # Drawn where its color shows (Blender's new material shows neither).
    ma.grease_pencil.show_stroke, ma.grease_pencil.show_fill = stroke[3] > 0, fill[3] > 0
    data.materials.append(ma)
    return len(data.materials) - 1


LINE = material('Line', (0.02, 0.02, 0.03, 1), (0, 0, 0, 0))
BALL = material('Ball', (0.08, 0.03, 0.01, 1), (0.9, 0.25, 0.05, 1))
SHADOW = material('Shadow', (0, 0, 0, 0), (0, 0, 0, 0.35))


def add_strokes(drawing, strokes):
    """Strokes of (points [(x, z)], radius, material, cyclic, fill id, stroke hidden), on the XZ plane."""
    drawing.add_strokes([len(points) for points, *_ in strokes])
    attributes = drawing.attributes
    for name, domain, kind in [('radius', 'POINT', 'FLOAT'), ('material_index', 'CURVE', 'INT'), ('cyclic', 'CURVE', 'BOOLEAN'),
                               ('fill_id', 'CURVE', 'INT'), ('hide_stroke', 'CURVE', 'BOOLEAN')]:
        if name not in attributes:
            attributes.new(name, kind, domain)
    positions = [c for points, *_ in strokes for x, z in points for c in (x, 0, z)]
    attributes['position'].data.foreach_set('vector', positions)
    attributes['radius'].data.foreach_set('value', [r for points, r, *_ in strokes for _ in points])
    for name, values in [('material_index', [m for *_, m, _, _, _ in strokes]), ('cyclic', [c for *_, c, _, _ in strokes]),
                         ('fill_id', [f for *_, f, _ in strokes]), ('hide_stroke', [h for *_, h in strokes])]:
        attributes[name].data.foreach_set('value', values)


def ellipse(cx, cz, rx, rz, n=32):
    return [(cx + rx * math.cos(2 * math.pi * i / n), cz + rz * math.sin(2 * math.pi * i / n)) for i in range(n)]


ground = data.layers.new('Ground')
add_strokes(ground.frames.new(1).drawing, [([(-3 + 0.25 * i, 0.0) for i in range(25)], 0.02, LINE, False, 0, False)])

shadow = data.layers.new('Shadow')
ball = data.layers.new('Ball')
# Flat 2D drawing: the layers take no lights (the scene has none), as a 2D Animation file's do.
for layer in data.layers:
    layer.use_lights = False
for frame in range(1, FRAMES + 1, 2):
    t = (frame - 1) / FRAMES
    x = -2.2 + 4.4 * t
    # Two bounces: height falls on a parabola, the ball squashes on the ground and stretches as it leaves it.
    phase = (2 * t) % 1
    height = 2.2 * 4 * phase * (1 - phase) * (0.65 if t > 0.5 else 1)
    squash = 1 - 0.35 * math.exp(-height * 6)
    stretch = 1 + 0.15 * min(1, height) * (1 - squash)
    rz, rx = 0.4 * squash * stretch, 0.4 / squash
    add_strokes(ball.frames.new(frame).drawing, [(ellipse(x, rz + height, rx, rz), 0.03, BALL, True, 1, False)])
    add_strokes(shadow.frames.new(frame).drawing, [(ellipse(x, 0.02, 0.5 / (1 + height), 0.06), 0.01, SHADOW, True, 1, True)])

data.layers.active = ball
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'grease-pencil.blend'), compress=True)
