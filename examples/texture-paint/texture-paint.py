"""Builds texture-paint.blend: a glazed vase hand painted in cobalt blue, its paint an image over a cylindrical
unwrap, and a small dish painted with a color attribute, on a wooden table in low window light, in Blender 5.2.3.

usage: blender -b --factory-startup -P texture-paint.py
"""
import math
import os

import bpy
import numpy as np
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
rng = np.random.default_rng(7)


def catmull_rom(points, t):
    """The height and radius of a smooth profile through `points` at t in 0..1."""
    points = np.asarray(points, float)
    n = len(points) - 1
    i = min(int(t * n), n - 1)
    p0, p1, p2, p3 = (points[max(0, min(n, k))] for k in (i - 1, i, i + 1, i + 2))
    s = t * n - i
    return 0.5 * (2 * p1 + (p2 - p0) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (3 * p1 - p0 - 3 * p2 + p3) * s ** 3)


def lathe(name, profile, around=72, rows=90):
    """A surface of revolution with a cylindrical UV map: U around, V up the profile, its seam at the back."""
    ring = [catmull_rom(profile, r / rows) for r in range(rows + 1)]
    verts, faces, uvs = [], [], []
    for z, radius in ring:
        for a in range(around + 1):
            angle = 2 * math.pi * a / around - math.pi / 2
            verts.append((radius * math.cos(angle), radius * math.sin(angle), z))
    for r in range(rows):
        for a in range(around):
            i = r * (around + 1) + a
            faces.append((i, i + 1, i + around + 2, i + around + 1))
            uvs += [(a / around, r / rows), ((a + 1) / around, r / rows), ((a + 1) / around, (r + 1) / rows), (a / around, (r + 1) / rows)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    uv = mesh.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', np.array(uvs, np.float32).ravel())
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.shade_smooth()
    obj.select_set(False)
    return obj


# The vase: a profile turned around Z, closed at the foot, thickened by Solidify.
vase = lathe('Vase', [(0.0, 0.0), (0.0, 0.2), (0.06, 0.27), (0.16, 0.36), (0.55, 0.56), (0.95, 0.47), (1.25, 0.25),
                      (1.42, 0.2), (1.55, 0.25), (1.6, 0.3)])
solidify = vase.modifiers.new('Solidify', 'SOLIDIFY')
solidify.thickness = 0.03

# The paint, as brush strokes would lay it in the UV space: cobalt bands at foot, shoulder and lip, a wave of vine with
# leaves around the belly, and flowers on it, over a warm white glaze. 2048 x 1024 matches the unwrap's proportions.
W, H = 2048, 1024
u, v = np.meshgrid((np.arange(W) + 0.5) / W, (np.arange(H) + 0.5) / H)
ink = np.zeros((H, W))


def stroke(distance, width, soft=1.5):
    """Coverage of a stroke `width` pixels wide at `distance` pixels from its center line, its edge soft."""
    return np.clip((width / 2 - distance) / soft + 0.5, 0, 1)


def band(center, width):
    return stroke(np.abs(v - center) * H, width)


def dab(cu, cv, radius_u, radius_v, angle=0.0):
    """An elliptic brush dab in pixels, wrapped around the seam."""
    du = (u - cu + 0.5) % 1 - 0.5
    x, y = du * W, (v - cv) * H
    c, s = math.cos(angle), math.sin(angle)
    d = np.sqrt(((x * c + y * s) / radius_u) ** 2 + ((-x * s + y * c) / radius_v) ** 2)
    return np.clip((1 - d) * 6, 0, 1)


for center, width in ((0.035, 10), (0.06, 4), (0.62, 5), (0.66, 14), (0.7, 5), (0.955, 12), (0.985, 4)):
    ink = np.maximum(ink, band(center, width))

# The vine: four waves around the belly, its stroke swelling and thinning as a brush does.
waves, mid, amp = 6, 0.36, 0.08
f = mid + amp * np.sin(2 * math.pi * waves * u)
slope = amp * 2 * math.pi * waves * np.cos(2 * math.pi * waves * u) * H / W
width = 6 + 4 * np.sin(2 * math.pi * 9 * u) ** 2
ink = np.maximum(ink, stroke(np.abs(v - f) * H / np.sqrt(1 + slope ** 2), width))
for k in range(waves * 4):
    cu = (k + 0.5) / (waves * 4)
    cv = mid + amp * math.sin(2 * math.pi * waves * cu)
    side = 1 if k % 2 else -1
    ink = np.maximum(ink, dab(cu + 0.006, cv + side * 0.045, 34, 12, side * 0.7))
for k in range(waves * 2):
    cu = (k + 0.25) / (waves * 2) * 1.0 + 0.0625 / waves
    cv = mid + amp * math.sin(2 * math.pi * waves * cu) + (0.1 if k % 2 == 0 else -0.1)
    for p in range(6):
        angle = p * math.pi / 3
        ink = np.maximum(ink, dab(cu + math.cos(angle) * 26 / W, cv + math.sin(angle) * 26 / H, 22, 10, angle))
    ink = np.maximum(ink, dab(cu, cv, 10, 10) * 0.6)
# Scallops above the foot, a brush dab each.
for k in range(36):
    ink = np.maximum(ink, dab((k + 0.5) / 36, 0.12, 22, 16) * (1 - dab((k + 0.5) / 36, 0.1, 14, 10)))
# Dots along the shoulder band, one per petal of a frieze.
for k in range(48):
    ink = np.maximum(ink, dab((k + 0.5) / 48, 0.81, 7, 7))
    ink = np.maximum(ink, dab((k + 0.5) / 48, 0.79 - 0.04 * (k % 2), 4, 4))

# Paint thins where a brush runs dry: the coverage varies with a little noise, the glaze too.
grain = np.repeat(np.repeat(rng.random((H // 8, W // 8)), 8, 0), 8, 1)
ink *= 0.75 + 0.25 * grain
glaze = np.array([0.86, 0.83, 0.76]) * (0.97 + 0.03 * grain[..., None])
cobalt = np.array([0.02, 0.06, 0.32])
color = glaze * (1 - ink[..., None]) + cobalt * ink[..., None]
pixels = np.dstack([color, np.ones((H, W))]).astype(np.float32)
image = bpy.data.images.new('Vase Paint', W, H)
image.pixels.foreach_set(pixels.ravel())
image.pack()

# The glaze: the image into Base Color of a glossy Principled BSDF, its Coat a second, sharper reflection.
glazed = bpy.data.materials.new('Glazed')
nodes, links = glazed.node_tree.nodes, glazed.node_tree.links
principled = nodes['Principled BSDF']
principled.inputs['Roughness'].default_value = 0.18
principled.inputs['Coat Weight'].default_value = 0.6
principled.inputs['Coat Roughness'].default_value = 0.04
texture = nodes.new('ShaderNodeTexImage')
texture.image = image
texture.location = (-400, 300)
links.new(texture.outputs['Color'], principled.inputs['Base Color'])
vase.data.materials.append(glazed)

# The dish: a shallow bowl whose color attribute Vertex Paint painted, read by a Color Attribute node.
dish = lathe('Dish', [(0.0, 0.0), (0.0, 0.22), (0.03, 0.3), (0.1, 0.4), (0.16, 0.46)], 64, 24)
dish.location = (1.15, -0.55, 0)
dish.modifiers.new('Solidify', 'SOLIDIFY').thickness = 0.02
colors = dish.data.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
for loop in dish.data.loops:
    co = dish.data.vertices[loop.vertex_index].co
    rim = min(1.0, max(0.0, (co.z - 0.1) / 0.05))
    colors.data[loop.index].color = (*(cobalt * rim + glaze[0, 0] * (1 - rim)), 1)
dish.data.color_attributes.active_color = colors
dish_material = bpy.data.materials.new('Dish Glaze')
nodes, links = dish_material.node_tree.nodes, dish_material.node_tree.links
attribute = nodes.new('ShaderNodeVertexColor')
attribute.layer_name = 'Color'
attribute.location = (-400, 300)
nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.15
links.new(attribute.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
dish.data.materials.append(dish_material)

# The table: a wide board whose grain is a Wave Texture stretched along X, distorted, through a Color Ramp.
bpy.ops.mesh.primitive_plane_add(size=1)
table = bpy.context.object
table.name = 'Table'
table.scale = (8, 5, 1)
bpy.ops.object.transform_apply(scale=True)
wood = bpy.data.materials.new('Oak')
nodes, links = wood.node_tree.nodes, wood.node_tree.links
coord = nodes.new('ShaderNodeTexCoord')
mapping = nodes.new('ShaderNodeMapping')
mapping.inputs['Scale'].default_value = (0.25, 6, 1)
wave = nodes.new('ShaderNodeTexWave')
wave.inputs['Scale'].default_value = 3.0
wave.inputs['Distortion'].default_value = 1.5
wave.inputs['Detail'].default_value = 4.0
grain_ramp = nodes.new('ShaderNodeValToRGB')
grain_ramp.color_ramp.elements[0].color = (0.22, 0.12, 0.055, 1)
grain_ramp.color_ramp.elements[1].color = (0.32, 0.18, 0.08, 1)
nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.45
links.new(coord.outputs['Object'], mapping.inputs['Vector'])
links.new(mapping.outputs['Vector'], wave.inputs['Vector'])
links.new(wave.outputs['Fac'], grain_ramp.inputs['Fac'])
links.new(grain_ramp.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
table.data.materials.append(wood)

# The wall behind, plaster colored, catching the window light.
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 1.6, 2), rotation=(math.pi / 2, 0, 0))
wall = bpy.context.object
wall.name = 'Wall'
wall.scale = (8, 4, 1)
plaster = bpy.data.materials.new('Plaster')
plaster.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.42, 0.36, 0.3, 1)
plaster.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
wall.data.materials.append(plaster)

# Low warm sun from the left as through a window, its angle softening the shadows; a cool world as the room's fill.
sun = bpy.data.objects.new('Window Light', bpy.data.lights.new('Window Light', 'SUN'))
sun.data.energy = 4.0
sun.data.color = (1.0, 0.86, 0.7)
sun.data.angle = math.radians(4)
sun.rotation_euler = Vector((1.0, 0.55, -0.55)).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(sun)
world = bpy.data.worlds.new('Room')
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.08, 0.1, 0.13, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
scene.world = world

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 50
camera.location = (0.9, -5.6, 1.55)
camera.rotation_euler = (math.radians(83), 0, math.radians(3.5))
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1280, 800

# The brushes' colors, as the color swatch in the tool settings sets them: cobalt, and fine
# brushes for the vase's lines and the dish's rim.
paint = scene.tool_settings
paint.image_paint.unified_paint_settings.use_unified_color = True
paint.image_paint.unified_paint_settings.color = cobalt
paint.image_paint.unified_paint_settings.use_unified_size = True
paint.image_paint.unified_paint_settings.size = 14
paint.vertex_paint.unified_paint_settings.use_unified_color = True
paint.vertex_paint.unified_paint_settings.color = cobalt
paint.vertex_paint.unified_paint_settings.use_unified_size = True
paint.vertex_paint.unified_paint_settings.size = 20

# The vase active and selected, as the Texture Paint workspace paints the active object.
for obj in scene.objects:
    obj.select_set(False)
vase.select_set(True)
bpy.context.view_layer.objects.active = vase
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'texture-paint.blend'), compress=True)
