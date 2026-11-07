"""Builds framed-print.blend: a screen print of mountains at dusk, framed on a gallery wall under a spotlight, its
colors one image and its paper's grain another, on an oak floor whose boards are a third, in Blender 5.2.3.

usage: blender -b --factory-startup -P framed-print.py
"""
import math
import os

import bpy
import numpy as np
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
rng = np.random.default_rng(3)


def packed(name, pixels, non_color=False):
    """An image of `pixels` (rows from the bottom, RGB), packed into the file."""
    h, w = pixels.shape[:2]
    image = bpy.data.images.new(name, w, h, is_data=non_color)
    image.pixels.foreach_set(np.dstack([pixels, np.ones((h, w))]).astype(np.float32).ravel())
    image.pack()
    if non_color:
        image.colorspace_settings.name = 'Non-Color'
    return image


def octaves(w, h, base, count, seed):
    """Smooth value noise, `count` octaves from `base` cells across."""
    out = np.zeros((h, w))
    r = np.random.default_rng(seed)
    for o in range(count):
        cells = base * 2 ** o
        grid = r.random((cells + 1, cells + 1))
        x = np.linspace(0, cells, w, endpoint=False)
        y = np.linspace(0, cells, h, endpoint=False)
        xi, yi = x.astype(int), y.astype(int)
        fx, fy = (x - xi), (y - yi)
        fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        a = grid[np.ix_(yi, xi)] * (1 - fx) + grid[np.ix_(yi, xi + 1)] * fx
        b = grid[np.ix_(yi + 1, xi)] * (1 - fx) + grid[np.ix_(yi + 1, xi + 1)] * fx
        out += (a * (1 - fy[:, None]) + b * fy[:, None]) / 2 ** o
    return out / (2 - 2 ** (1 - count))


# The print: a dusk sky in flat bands, a low sun, and five mountain ridges in ink layers, nearer ones darker.
W, H = 1200, 1600
x, y = np.meshgrid(np.arange(W) / W, np.arange(H) / H)
sky = [(0.0, (0.98, 0.62, 0.3)), (0.45, (0.95, 0.42, 0.3)), (0.62, (0.62, 0.3, 0.42)), (0.8, (0.28, 0.2, 0.4)), (1.0, (0.12, 0.12, 0.3))]
art = np.zeros((H, W, 3))
for (y0, c0), (y1, c1) in zip(sky, sky[1:]):
    t = np.clip((y - y0) / (y1 - y0), 0, 1)[..., None]
    band = ((y >= y0) & (y < y1))[..., None]
    steps = np.floor(t * 4) / 4  # screen-print bands, not a smooth gradient
    art = np.where(band, np.array(c0) * (1 - steps) + np.array(c1) * steps, art)
sun = np.hypot((x - 0.62) * W / H, y - 0.5) < 0.09
art[sun] = (1.0, 0.86, 0.62)
ridges = [(0.5, 0.06, (0.55, 0.26, 0.38)), (0.42, 0.08, (0.4, 0.18, 0.32)), (0.33, 0.1, (0.26, 0.12, 0.25)),
          (0.22, 0.09, (0.15, 0.08, 0.17)), (0.1, 0.08, (0.07, 0.04, 0.08))]
for i, (height, rough, color) in enumerate(ridges):
    line = octaves(W, 1, 3 + i, 5, 10 + i)[0]
    crest = height + rough * (line - 0.5) * 2 + 0.04 * np.sin(x[0] * (5 + i) * math.pi + i)
    art[y < crest[None, :].repeat(H, 0)] = color
# Ink sits unevenly on paper: a little mottling, and a cream border the frame's mat shows.
art *= (0.94 + 0.06 * octaves(W, H, 40, 3, 5))[..., None]
border = (x < 0.06) | (x > 0.94) | (y < 0.05) | (y > 0.95)
art[border] = (0.93, 0.9, 0.84)
print_image = packed('Dusk Print', art)

# The paper's grain: fine noise as height, data rather than color.
grain = packed('Paper Grain', np.repeat(octaves(512, 512, 64, 3, 7)[..., None], 3, 2), non_color=True)

# The floor: oak boards, each its own tone, with grain streaks along it and dark gaps between boards.
FW, FH = 1024, 1024
fx, fy = np.meshgrid(np.arange(FW) / FW, np.arange(FH) / FH)
boards = 8
board = np.floor(fy * boards).astype(int)
offset = rng.random(boards)[board]
along = (fx + offset) % 1
tone = 0.75 + 0.35 * rng.random(boards)[board]
streaks = octaves(FW, FH, 6, 4, 9)
streaks = 0.75 + 0.25 * np.sin((fy * boards % 1) * 40 + streaks * 25 + along * 3)
gap = (np.abs((fy * boards % 1) - 0.5) > 0.49) | (np.abs(((fx + offset) * 2 % 1) - 0.5) > 0.497)
oak = np.array((0.62, 0.38, 0.19)) * (tone * streaks)[..., None]
oak[gap] = (0.05, 0.03, 0.02)
floor_image = packed('Oak Boards', oak)


def material(name, color=None, roughness=0.5):
    mat = bpy.data.materials.new(name)
    principled = mat.node_tree.nodes['Principled BSDF']
    if color:
        principled.inputs['Base Color'].default_value = (*color, 1)
    principled.inputs['Roughness'].default_value = roughness
    return mat, mat.node_tree.nodes, mat.node_tree.links


def image_node(nodes, image, x, y, interpolation='Linear'):
    node = nodes.new('ShaderNodeTexImage')
    node.image, node.interpolation, node.location = image, interpolation, (x, y)
    return node


def box(name, size, location, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name, obj.scale = name, size
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(mat)
    return obj


# The print on its sheet: the print's colors into Base Color, the paper grain through Bump into Normal.
paper, nodes, links = material('Print', roughness=0.85)
colors = image_node(nodes, print_image, -500, 300)
grain_node = image_node(nodes, grain, -700, -150)
mapping = nodes.new('ShaderNodeMapping')
mapping.inputs['Scale'].default_value = (3, 4, 1)
mapping.location = (-900, -150)
uv = nodes.new('ShaderNodeTexCoord')
uv.location = (-1100, -150)
bump = nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.15
bump.location = (-300, -150)
links.new(colors.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
links.new(uv.outputs['UV'], mapping.inputs['Vector'])
links.new(mapping.outputs['Vector'], grain_node.inputs['Vector'])
links.new(grain_node.outputs['Color'], bump.inputs['Height'])
links.new(bump.outputs['Normal'], nodes['Principled BSDF'].inputs['Normal'])

PW, PH, Z = 1.2, 1.6, 1.75
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -0.03, Z), rotation=(math.pi / 2, 0, 0))
sheet = bpy.context.object
sheet.name = 'Print'
sheet.scale = (PW, PH, 1)
sheet.data.materials.append(paper)

# The frame: four bars of black-stained ash around a white mat, standing off the wall.
frame_mat, _, _ = material('Frame', (0.02, 0.018, 0.016), 0.4)
mat_board, _, _ = material('Mat', (0.9, 0.89, 0.86), 0.9)
M, B, D = 0.22, 0.06, 0.06
box('Mat', (PW + 2 * M, 0.01, PH + 2 * M), (0, -0.02, Z), mat_board)
for name, size, location in (('Frame Top', (PW + 2 * M + 2 * B, D, B), (0, -D / 2, Z + PH / 2 + M + B / 2)),
                             ('Frame Bottom', (PW + 2 * M + 2 * B, D, B), (0, -D / 2, Z - PH / 2 - M - B / 2)),
                             ('Frame Left', (B, D, PH + 2 * M), (-PW / 2 - M - B / 2, -D / 2, Z)),
                             ('Frame Right', (B, D, PH + 2 * M), (PW / 2 + M + B / 2, -D / 2, Z))):
    box(name, size, location, frame_mat)

# The wall and the floor: plain warm grey plaster, and the oak boards image repeated by a Mapping node.
plaster, _, _ = material('Plaster', (0.55, 0.52, 0.48), 0.92)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 2.5), rotation=(math.pi / 2, 0, 0))
wall = bpy.context.object
wall.name = 'Wall'
wall.scale = (10, 5, 1)
wall.data.materials.append(plaster)
oak_mat, nodes, links = material('Oak Floor', roughness=0.3)
boards_node = image_node(nodes, floor_image, -500, 300)
floor_map = nodes.new('ShaderNodeMapping')
floor_map.inputs['Scale'].default_value = (2, 2, 1)
floor_map.location = (-700, 300)
floor_uv = nodes.new('ShaderNodeTexCoord')
floor_uv.location = (-900, 300)
links.new(floor_uv.outputs['UV'], floor_map.inputs['Vector'])
links.new(floor_map.outputs['Vector'], boards_node.inputs['Vector'])
links.new(boards_node.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
bpy.ops.mesh.primitive_plane_add(size=10, location=(0, -5, 0))
floor = bpy.context.object
floor.name = 'Floor'
floor.data.materials.append(oak_mat)

# A bench in front, its seat oak and legs black, for scale.
box('Bench Seat', (1.8, 0.45, 0.06), (0.4, -1.6, 0.45), oak_mat)
for lx in (-0.35, 1.15):
    box('Bench Leg', (0.05, 0.4, 0.42), (lx, -1.6, 0.21), frame_mat)

# A spotlight from the ceiling washes the print, its soft size softening the frame's shadow on the wall; a dim cool
# world fills the room.
spot = bpy.data.objects.new('Spot', bpy.data.lights.new('Spot', 'SPOT'))
spot.data.energy = 900
spot.data.color = (1, 0.9, 0.78)
spot.data.spot_size = math.radians(55)
spot.data.spot_blend = 0.6
spot.data.shadow_soft_size = 0.15
spot.location = (0.3, -2.4, 4.6)
spot.rotation_euler = (Vector((0, -0.03, Z)) - spot.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(spot)
world = bpy.data.worlds.new('Gallery')
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.2, 0.2, 0.21, 1)
scene.world = world

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 35
camera.location = (2.6, -6.4, 1.5)
camera.rotation_euler = (math.radians(88), 0, math.radians(20))
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1280, 800

for obj in scene.objects:
    obj.select_set(False)
sheet.select_set(True)
bpy.context.view_layer.objects.active = sheet
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'framed-print.blend'), compress=True)
