"""Builds tin-cans.blend: four food cans whose labels and lids come from one image, each can's UV islands placed on
its label, in Blender 5.2.3.

usage: blender -b --factory-startup -P tin-cans.py
"""
import math
import os

import bpy
import numpy as np
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

RADIUS, HEIGHT = 0.33, 0.95
LABELS = [  # base, stripe, fruit, leaf
    ((0.55, 0.04, 0.03), (0.93, 0.86, 0.68), (0.8, 0.06, 0.03), (0.12, 0.35, 0.08)),
    ((0.08, 0.26, 0.12), (0.93, 0.86, 0.68), (0.35, 0.62, 0.12), (0.06, 0.3, 0.1)),
    ((0.9, 0.42, 0.08), (0.2, 0.1, 0.05), (0.98, 0.6, 0.2), (0.15, 0.4, 0.1)),
]
BAND = 0.25  # each label is a band of the image this tall; the lid is in the bottom band

# The atlas: three labels stacked from the top, then the lid. Each label is drawn in the can's own units (around by
# up), so its circles stay round however the band is stretched.
S = 2048
u, v = np.meshgrid((np.arange(S) + 0.5) / S, (np.arange(S) + 0.5) / S)
image = np.zeros((S, S, 3))
around, up = u * 2 * math.pi * RADIUS, (v % BAND) / BAND * HEIGHT


def disc(cx, cy, r, soft=0.004):
    dx = (around - cx + math.pi * RADIUS) % (2 * math.pi * RADIUS) - math.pi * RADIUS
    return np.clip((r - np.hypot(dx, up - cy)) / soft, 0, 1)[..., None]


def strip(y0, y1, soft=0.002):
    return (np.clip((up - y0) / soft, 0, 1) * np.clip((y1 - up) / soft, 0, 1))[..., None]


for index, (base, stripe, fruit, leaf) in enumerate(LABELS):
    label = np.broadcast_to(np.array(base), image.shape).copy()
    for y0, y1 in ((0.06, 0.09), (0.86, 0.89)):
        label = label * (1 - strip(y0, y1)) + np.array(stripe) * strip(y0, y1)
    # A cream medallion on the front with the fruit, a highlight and a leaf; smaller fruit around the back.
    for cx, scale in ((math.pi * RADIUS, 1.0), (0.25 * math.pi * RADIUS, 0.45), (1.75 * math.pi * RADIUS, 0.45)):
        medallion = disc(cx, 0.48, 0.27 * scale)
        label = label * (1 - medallion) + np.array((0.95, 0.9, 0.78)) * medallion
        ring = disc(cx, 0.48, 0.25 * scale) * (1 - disc(cx, 0.48, 0.235 * scale))
        label = label * (1 - ring) + np.array(base) * ring
        body = disc(cx, 0.45, 0.14 * scale)
        label = label * (1 - body) + np.array(fruit) * body
        leaf_mask = disc(cx + 0.05 * scale, 0.45 + 0.15 * scale, 0.04 * scale)
        label = label * (1 - leaf_mask) + np.array(leaf) * leaf_mask
    rows = (v >= 1 - BAND * (index + 1)) & (v < 1 - BAND * index)
    image[rows] = label[rows]

# The lid: brushed tin, its ridges rings around the middle of the bottom-left square.
lid = np.hypot(u - BAND / 2, v - BAND / 2) / (BAND / 2)
ridges = 0.62 + 0.08 * np.cos(lid * 40) * (lid > 0.7) + 0.05 * np.sin(u * 3000 + v * 1700) * 0.3
in_lid = (u < BAND) & (v < BAND)
image[in_lid] = (ridges[in_lid, None] * np.array((0.95, 0.95, 0.97)))
image[(v < BAND) & ~in_lid] = 0.5

atlas = bpy.data.images.new('Can Labels', S, S)
atlas.pixels.foreach_set(np.dstack([image, np.ones((S, S))]).astype(np.float32).ravel())
atlas.pack()

# One material: the atlas as Base Color; where the UVs sit in the lid's band, the surface is metal.
material = bpy.data.materials.new('Can')
nodes, links = material.node_tree.nodes, material.node_tree.links
principled = nodes['Principled BSDF']
texture = nodes.new('ShaderNodeTexImage')
texture.image = atlas
texture.location = (-500, 300)
coord = nodes.new('ShaderNodeTexCoord')
coord.location = (-900, -100)
split = nodes.new('ShaderNodeSeparateXYZ')
split.location = (-700, -100)
is_lid = nodes.new('ShaderNodeMath')
is_lid.operation = 'LESS_THAN'
is_lid.inputs[1].default_value = BAND
is_lid.location = (-500, -100)
roughness = nodes.new('ShaderNodeMapRange')
roughness.inputs['To Min'].default_value = 0.35
roughness.inputs['To Max'].default_value = 0.22
roughness.location = (-300, -150)
links.new(texture.outputs['Color'], principled.inputs['Base Color'])
links.new(coord.outputs['UV'], split.inputs['Vector'])
links.new(split.outputs['Y'], is_lid.inputs[0])
links.new(is_lid.outputs[0], principled.inputs['Metallic'])
links.new(is_lid.outputs[0], roughness.inputs['Value'])
links.new(roughness.outputs['Result'], principled.inputs['Roughness'])


def can(name, label, location, rotation=(0, 0, 0)):
    """A cylinder whose side is unwrapped onto label `label`'s band and whose two caps onto the lid."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=RADIUS, depth=HEIGHT, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    mesh = obj.data
    uv = mesh.uv_layers.active.data
    top = 1 - BAND * label
    for poly in mesh.polygons:
        cap = abs(poly.normal.z) > 0.5
        for loop_index in poly.loop_indices:
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            if cap:
                uv[loop_index].uv = (BAND / 2 + co.x / RADIUS * BAND * 0.48, BAND / 2 + co.y / RADIUS * BAND * 0.48)
            else:
                angle = (math.atan2(co.y, co.x) + math.pi / 2) % (2 * math.pi)
                uv[loop_index].uv = (angle / (2 * math.pi), top - BAND + (co.z / HEIGHT + 0.5) * BAND)
        # The seam's faces wrap from U 1 back to 0: their last column is at U 1.
        if not cap:
            us = [uv[i].uv.x for i in poly.loop_indices]
            if max(us) - min(us) > 0.5:
                for i in poly.loop_indices:
                    if uv[i].uv.x < 0.5:
                        uv[i].uv.x += 1
    bevel = obj.modifiers.new('Bevel', 'BEVEL')
    bevel.width = 0.012
    bevel.segments = 3
    bevel.limit_method = 'ANGLE'
    bpy.ops.object.shade_auto_smooth()
    mesh.materials.append(material)
    return obj


cans = [
    can('Tomato', 0, (-0.36, 0, HEIGHT / 2), (0, 0, math.radians(8))),
    can('Pea', 1, (0.36, 0.05, HEIGHT / 2), (0, 0, math.radians(-12))),
    can('Peach', 2, (0, 0.1, HEIGHT * 1.5 + 0.002), (0, 0, math.radians(4))),
    can('Tomato Lying', 0, (1.05, -0.55, RADIUS), (math.radians(90), 0, math.radians(58))),
]

# The counter and the wall behind: a pale stone top and a deep teal wall, so the labels stand out.
bpy.ops.mesh.primitive_plane_add(size=12)
counter = bpy.context.object
counter.name = 'Counter'
stone = bpy.data.materials.new('Counter')
stone.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.62, 0.58, 0.52, 1)
stone.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.35
counter.data.materials.append(stone)
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 1.4, 3), rotation=(math.pi / 2, 0, 0))
wall = bpy.context.object
wall.name = 'Wall'
paint = bpy.data.materials.new('Wall')
paint.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.03, 0.12, 0.13, 1)
paint.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
wall.data.materials.append(paint)

# A soft key from the front left, a rim from the right behind; the world a dim fill.
for name, direction, energy, color, angle in (('Key', (1.0, 1.4, -1.1), 4.0, (1, 0.94, 0.86), 6), ('Rim', (-1.2, -0.6, -0.5), 2.5, (0.75, 0.88, 1), 2)):
    light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
    light.data.energy, light.data.color, light.data.angle = energy, color, math.radians(angle)
    light.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(light)
world = bpy.data.worlds.new('Shop')
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.12, 0.13, 0.14, 1)
scene.world = world

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 50
camera.location = (1.6, -6.2, 1.55)
camera.rotation_euler = (math.radians(84), 0, math.radians(13))
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1280, 800

for obj in scene.objects:
    obj.select_set(False)
cans[0].select_set(True)
bpy.context.view_layer.objects.active = cans[0]
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tin-cans.blend'), compress=True)
