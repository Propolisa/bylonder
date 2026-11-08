"""Builds compositor.blend: a noodle bar's neon sign in a wet alley at night, finished in the compositor (Glare's Fog
Glow, Lens Distortion, a Color Balance grade and a vignette), in Blender 5.2.3. The sign's fonts are in fonts/ (SIL Open
Font License).

usage: blender -b --factory-startup -P compositor.py
"""
import math
import os
import random

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
collection = scene.collection


def material(name, color, roughness=0.5, metallic=0.0, emission=0.0):
    mat = bpy.data.materials.new(name)
    principled = mat.node_tree.nodes['Principled BSDF']
    principled.inputs['Base Color'].default_value = (*color, 1)
    principled.inputs['Roughness'].default_value = roughness
    principled.inputs['Metallic'].default_value = metallic
    if emission:
        principled.inputs['Emission Color'].default_value = (*color, 1)
        principled.inputs['Emission Strength'].default_value = emission
    return mat


def finish(obj, name, mat):
    obj.name = name
    if mat:
        obj.data.materials.append(mat)
    return obj


def box(name, size, location, mat, rotation=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new('Bevel', 'BEVEL')
        modifier.width, modifier.segments = bevel, 3
        bpy.ops.object.modifier_apply(modifier='Bevel')
    return finish(obj, name, mat)


def cylinder(name, radius, depth, location, mat, rotation=(0, 0, 0), vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    return finish(bpy.context.object, name, mat)


def join(name, parts):
    """One mesh object from parts, curves converted to their meshes."""
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    return obj


def textured(name, color_a, color_b, scale, roughness=(0.5, 0.5), metallic=0.0, waves=0.0):
    """A Principled BSDF whose color and roughness a Noise Texture mixes between two ends, with grain bands (a Wave
    Texture) for wood."""
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    principled = nodes['Principled BSDF']
    principled.inputs['Metallic'].default_value = metallic
    coord = nodes.new('ShaderNodeTexCoord')
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = scale
    noise.inputs['Detail'].default_value = 8
    links.new(coord.outputs['Object'], noise.inputs['Vector'])
    factor = nodes.new('ShaderNodeMapRange')
    factor.inputs['From Min'].default_value, factor.inputs['From Max'].default_value = 0.4, 0.65
    links.new(noise.outputs['Fac'], factor.inputs['Value'])
    if waves:
        wave = nodes.new('ShaderNodeTexWave')
        wave.inputs['Scale'].default_value = waves
        wave.inputs['Distortion'].default_value = 6
        wave.bands_direction = 'Z'
        links.new(coord.outputs['Object'], wave.inputs['Vector'])
        grain = nodes.new('ShaderNodeMath')
        grain.operation = 'MULTIPLY'
        links.new(noise.outputs['Fac'], grain.inputs[0])
        links.new(wave.outputs['Fac'], grain.inputs[1])
        links.new(grain.outputs['Value'], factor.inputs['Value'])
        factor.inputs['From Min'].default_value, factor.inputs['From Max'].default_value = 0.1, 0.5
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value, mix.inputs['B'].default_value = (*color_a, 1), (*color_b, 1)
    links.new(factor.outputs['Result'], mix.inputs['Factor'])
    links.new(mix.outputs['Result'], principled.inputs['Base Color'])
    rough = nodes.new('ShaderNodeMapRange')
    rough.inputs['To Min'].default_value, rough.inputs['To Max'].default_value = roughness
    links.new(factor.outputs['Result'], rough.inputs['Value'])
    links.new(rough.outputs['Result'], principled.inputs['Roughness'])
    return mat


def curve(name, points, mat, radius, cyclic=False, smooth=True, resolution=6):
    """A tube through (x, y, z) points: a Bezier curve with auto handles, beveled round."""
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.bevel_depth, data.bevel_resolution, data.use_fill_caps = radius, 2, True
    data.resolution_u = resolution
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for point, co in zip(spline.bezier_points, points):
        point.co = co
        point.handle_left_type = point.handle_right_type = 'AUTO' if smooth else 'VECTOR'
    spline.use_cyclic_u = cyclic
    data.materials.append(mat)
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    return obj


# Materials: neon glass in two colors, the warm light behind the window and the door, and the alley's surfaces.
magenta = material('Neon Magenta', (1.0, 0.05, 0.42), emission=12)
cyan = material('Neon Cyan', (0.05, 0.75, 1.0), emission=9)
steam_neon = material('Neon White', (0.75, 0.9, 1.0), emission=5)
amber = material('Warm Interior', (1.0, 0.38, 0.09), emission=1.6)
dark_metal = material('Dark Metal', (0.02, 0.02, 0.025), roughness=0.35, metallic=1)
backplate = material('Sign Backplate', (0.006, 0.006, 0.01), roughness=0.3)
# Matte black: the tubes' light panels face it and must not show in it.
backplate.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0
paint = material('Green Paint', (0.01, 0.03, 0.025), roughness=0.45)
wood = textured('Crate Wood', (0.16, 0.09, 0.045), (0.05, 0.03, 0.02), 3, (0.55, 0.8), waves=6)
rubber = material('Rubber', (0.008, 0.008, 0.008), roughness=0.6)
rusty_paint = textured('Rusty Paint', (0.3, 0.03, 0.02), (0.1, 0.035, 0.012), 14, (0.3, 0.85), metallic=0.3)
chrome = material('Chrome', (0.6, 0.6, 0.62), roughness=0.2, metallic=1)
silhouette = material('Silhouette', (0.0, 0.0, 0.0), roughness=1)
rain = material('Rain', (0.6, 0.65, 0.7), roughness=0.2)
mirror = material('Puddle', (0.003, 0.003, 0.004), roughness=0.02)

# The wall: a slab with the window and the door cut out, Brick Texture over its object coordinates in meters.
brick_mat = bpy.data.materials.new('Brick')
nodes, links = brick_mat.node_tree.nodes, brick_mat.node_tree.links
principled = nodes['Principled BSDF']
principled.inputs['Roughness'].default_value = 0.75
coord = nodes.new('ShaderNodeTexCoord')
facade = nodes.new('ShaderNodeMapping')
facade.inputs['Rotation'].default_value = (math.pi / 2, 0, 0)
brick = nodes.new('ShaderNodeTexBrick')
brick.inputs['Scale'].default_value = 0.8
brick.inputs['Color1'].default_value = (0.11, 0.035, 0.028, 1)
brick.inputs['Color2'].default_value = (0.05, 0.028, 0.024, 1)
brick.inputs['Mortar'].default_value = (0.02, 0.02, 0.022, 1)
brick.inputs['Mortar Size'].default_value = 0.025
brick.inputs['Bias'].default_value = 0.3
bump = nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.5
links.new(coord.outputs['Object'], facade.inputs['Vector'])
links.new(facade.outputs['Vector'], brick.inputs['Vector'])
links.new(brick.outputs['Color'], principled.inputs['Base Color'])
links.new(brick.outputs['Fac'], bump.inputs['Height'])
links.new(bump.outputs['Normal'], principled.inputs['Normal'])

wall = box('Wall', (16, 0.3, 7.5), (1, 0.15, 3.6), brick_mat)
box('Side Wall', (0.3, 12, 7.5), (-6.15, -6, 3.6), brick_mat)
openings = [box('Window Opening', (2.8, 1.0, 1.5), (-1.6, 0.15, 1.75), None),
            box('Door Opening', (1.15, 1.0, 2.25), (2.4, 0.15, 1.125), None)]
for opening in openings:
    cut = wall.modifiers.new(opening.name, 'BOOLEAN')
    cut.operation, cut.object = 'DIFFERENCE', opening
    bpy.context.view_layer.objects.active = wall
    bpy.ops.object.modifier_apply(modifier=opening.name)
    bpy.data.objects.remove(opening)

# The street: a raised sidewalk and the road below its curb, wet asphalt with grain, and puddles that mirror the
# neon.
asphalt = textured('Wet Asphalt', (0.022, 0.022, 0.024), (0.008, 0.008, 0.009), 1.5, (0.45, 0.2))
box('Sidewalk', (16, 2.2, 0.15), (1, -1.1, -0.075), asphalt)
box('Road', (16, 14, 0.15), (1, -9.2, -0.225), asphalt)
box('Curb', (16, 0.18, 0.17), (1, -2.2, -0.065), dark_metal, bevel=0.02)


def outline(name, verts, mat):
    """A flat face through the points."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [list(range(len(verts)))])
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def puddle(name, x, y, z, rx, ry, seed):
    """An irregular outline a little above the ground."""
    angles = [i * math.tau / 40 for i in range(40)]
    wobble = [1 + 0.15 * math.sin(3 * a + seed) + 0.08 * math.sin(7 * a + 2 * seed) for a in angles]
    return outline(name, [(x + rx * w * math.cos(a), y + ry * w * math.sin(a), z + 0.003) for a, w in zip(angles, wobble)], mirror)


for i, (x, y, z, rx, ry) in enumerate(((1.0, -7.6, -0.15, 2.6, 1.3), (-2.6, -4.6, -0.15, 1.5, 0.7), (4.6, -5.0, -0.15, 1.2, 0.6),
                                       (-1.3, -1.2, 0.0, 1.1, 0.45), (5.2, -3.4, -0.15, 0.7, 0.35))):
    puddle(f'Puddle {i + 1}', x, y, z, rx, ry, i * 1.7)

# The sign: script words and a bowl of noodles in glass tubes, standing off a dark backplate.
box('Backplate', (7.0, 0.05, 2.5), (-0.4, -0.05, 4.05), backplate, bevel=0.06)
for x, z in ((-3.6, 5.0), (2.8, 5.0), (-3.6, 3.1), (2.8, 3.1)):
    cylinder('Standoff', 0.04, 0.12, (x, -0.13, z), dark_metal, (math.pi / 2, 0, 0), 8)


def neon_text(name, body, font, location, size, mat, tube, offset, spacing=1.0):
    bpy.ops.object.text_add(location=location, rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    obj.data.body = body
    obj.data.font = font
    obj.data.align_x, obj.data.align_y = 'CENTER', 'CENTER'
    obj.data.size, obj.data.space_character = size, spacing
    obj.data.offset, obj.data.bevel_depth, obj.data.bevel_resolution = offset, tube, 2
    obj.data.resolution_u = 4
    finish(obj, name, mat)
    # A mesh, so the letters keep their font wherever the file opens.
    bpy.ops.object.convert(target='MESH')
    return obj


script = bpy.data.fonts.load(os.path.join(HERE, 'fonts', 'Sacramento-Regular.ttf'))
display = bpy.data.fonts.load(os.path.join(HERE, 'fonts', 'PoiretOne-Regular.ttf'))
sign = neon_text('Noodles', 'Noodles', script, (0.6, -0.2, 4.25), 2.2, magenta, 0.03, -0.012)
neon_text('Open Late', 'OPEN  LATE', display, (0.6, -0.2, 3.25), 0.42, cyan, 0.018, -0.008, 1.25)

# The bowl: a half circle under a rim, chopsticks and three wisps of steam.
bx, by, bz = -2.75, -0.2, 3.8
bowl = [(bx + 0.62 * math.cos(a), by, bz + 0.55 * math.sin(a)) for a in [math.pi + i * math.pi / 8 for i in range(9)]]
curve('Bowl', bowl, cyan, 0.03)
curve('Rim', [(bx - 0.75, by, bz + 0.02), (bx + 0.75, by, bz + 0.02)], cyan, 0.03, smooth=False)
curve('Foot', [(bx - 0.22, by, bz - 0.62), (bx + 0.22, by, bz - 0.62)], cyan, 0.03, smooth=False)
curve('Chopstick', [(bx + 0.1, by, bz + 0.25), (bx + 0.85, by, bz + 1.0)], magenta, 0.025, smooth=False)
curve('Chopstick 2', [(bx + 0.25, by, bz + 0.18), (bx + 1.0, by, bz + 0.85)], magenta, 0.025, smooth=False)
for i, dx in enumerate((-0.4, -0.1, 0.2)):
    wisp = [(bx + dx + 0.08 * math.sin(t * 2.2), by, bz + 0.2 + t * 0.22) for t in range(5)]
    curve(f'Steam {i + 1}', wisp, steam_neon, 0.02)

# The window: warm light behind blinds, a figure's silhouette between them.
box('Window Glow', (2.8, 0.02, 1.5), (-1.6, 0.6, 1.75), amber)
for i in range(6):
    box(f'Blind {i + 1}', (2.76, 0.03, 0.06), (-1.6, 0.22, 2.46 - i * 0.055), paint, (math.radians(-10), 0, 0))
box('Blind Bar', (2.78, 0.05, 0.03), (-1.6, 0.22, 2.16), paint)
# The figure: a bust's outline, half of it mirrored, raising a bowl to the chin with chopsticks.
half = [(0.46, 0), (0.46, 0.3), (0.44, 0.42), (0.37, 0.5), (0.22, 0.55), (0.08, 0.58), (0.065, 0.62)]
half += [(0.115 * math.cos(math.radians(a)), 0.75 + 0.14 * math.sin(math.radians(a))) for a in range(-55, 91, 15)]
bust = half + [(-x, z) for x, z in reversed(half)]
fx, fy, fz = -1.05, 0.45, 0.95
outline('Figure', [(fx + x, fy, fz + z) for x, z in bust], silhouette)
outline('Bowl in Hand', [(fx + 0.27 + 0.15 * math.cos(math.radians(a)), fy - 0.02, fz + 0.57 + 0.07 * math.sin(math.radians(a)))
                         for a in range(180, 361, 15)], silhouette)
for end in (0.05, 0.08):
    curve('Chopstick', [(fx + 0.3, fy - 0.02, fz + 0.59), (fx + end, fy - 0.02, fz + 0.72)], silhouette, 0.01, smooth=False)
box('Window Sill', (3.1, 0.25, 0.08), (-1.6, -0.08, 0.96), paint, bevel=0.015)
for side, x in (('Left', -3.05), ('Right', -0.15)):
    box(f'Window Frame {side}', (0.1, 0.1, 1.5), (x, -0.02, 1.75), paint)
box('Window Frame Top', (3.0, 0.1, 0.1), (-1.6, -0.02, 2.53), paint)

# The door: ajar, the warm interior behind it.
box('Door Glow', (1.15, 0.02, 2.25), (2.4, 1.6, 1.125), amber)
swing = math.radians(65)
box('Door Leaf', (1.13, 0.05, 2.2), (1.85 + 0.56 * math.cos(swing), 0.3 + 0.56 * math.sin(swing), 1.11), paint, (0, 0, swing))
box('Door Frame Top', (1.4, 0.12, 0.12), (2.4, -0.04, 2.3), paint)

# Pipes and cables: a drainpipe, a conduit under the roofline and power lines sagging across the alley.
cylinder('Drainpipe', 0.07, 7.5, (3.3, -0.1, 3.75), dark_metal)
cylinder('Conduit', 0.045, 12, (0, -0.1, 6.1), dark_metal, (0, math.pi / 2, 0))
for i, (start, end, sag) in enumerate((((-6.0, -4.0, 6.6), (2.0, 0.0, 6.4), 0.9), ((-6.0, -6.5, 6.0), (5.0, 0.0, 6.8), 1.2),
                                       ((-0.6, -0.1, 5.3), (-0.6, -0.1, 6.1), 0.0))):
    cable = [tuple(s + (e - s) * t for s, e in zip(start, end)) for t in (0, 0.25, 0.5, 0.75, 1)]
    cable = [(x, y, z - sag * 4 * t * (1 - t)) for (x, y, z), t in zip(cable, (0, 0.25, 0.5, 0.75, 1))]
    curve(f'Cable {i + 1}', cable, rubber, 0.012)

# Props: wooden crates stacked by the door and a rusty bicycle leaning on the wall.


def crate(name, x, y, z, turn):
    w, d, h = 0.6, 0.42, 0.36
    parts = [box('Post', (0.05, 0.05, h), (sx * (w - 0.05) / 2, sy * (d - 0.05) / 2, 0), None) for sx in (-1, 1) for sy in (-1, 1)]
    parts.append(box('Bottom', (w, d, 0.02), (0, 0, -h / 2 + 0.01), None))
    for k in range(3):
        sz = -h / 2 + 0.06 + k * 0.12
        parts += [box('Slat', (w, 0.015, 0.08), (0, sy * d / 2, sz), None) for sy in (-1, 1)]
        parts += [box('Slat', (0.015, d, 0.08), (sx * w / 2, 0, sz), None) for sx in (-1, 1)]
    obj = finish(join(name, parts), name, wood)
    obj.location, obj.rotation_euler = (x, y, z + h / 2), (0, 0, math.radians(turn))
    return obj


for i, (x, y, z, turn) in enumerate(((3.95, -0.4, 0, 4), (4.6, -0.45, 0, -6), (4.25, -0.4, 0.36, 9))):
    crate(f'Crate {i + 1}', x, y, z, turn)

bike = []
for x in (-4.65, -3.6):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.33, minor_radius=0.025, major_segments=32, minor_segments=6,
                                     location=(x, -0.3, 0.36), rotation=(math.pi / 2, 0, 0))
    bike.append(finish(bpy.context.object, 'Wheel', rubber))
    for k in range(12):
        a = k * math.tau / 12
        bike.append(curve('Spoke', [(x, -0.3, 0.36), (x + 0.31 * math.cos(a), -0.3, 0.36 + 0.31 * math.sin(a))], chrome, 0.003, smooth=False))
frame = [((-4.65, -0.3, 0.36), (-4.15, -0.3, 0.38)), ((-4.15, -0.3, 0.38), (-3.72, -0.3, 0.86)),
         ((-4.65, -0.3, 0.36), (-4.25, -0.3, 0.88)), ((-4.25, -0.3, 0.88), (-4.15, -0.3, 0.38)),
         ((-4.25, -0.3, 0.88), (-3.75, -0.3, 0.9)), ((-3.6, -0.3, 0.36), (-3.75, -0.3, 1.05))]
for start, end in frame:
    bike.append(curve('Bike Tube', [start, end], rusty_paint, 0.022, smooth=False))
bike.append(curve('Seat Post', [(-4.25, -0.3, 0.88), (-4.3, -0.3, 1.0)], chrome, 0.013, smooth=False))
for side in (-0.55, -0.05):
    bike.append(curve('Handlebar', [(-3.75, -0.3, 1.05), (-3.85, side, 1.1), (-3.98, side, 1.08)], chrome, 0.012))
bike.append(curve('Fender', [(-4.65 + 0.38 * math.cos(math.radians(a)), -0.3, 0.36 + 0.38 * math.sin(math.radians(a)))
                             for a in (160, 120, 80, 40)], rusty_paint, 0.02))
bike.append(cylinder('Chainring', 0.1, 0.015, (-4.15, -0.33, 0.38), chrome, (math.pi / 2, 0, 0), 24))
bike.append(box('Crank', (0.03, 0.02, 0.32), (-4.15, -0.36, 0.38), dark_metal, (0, math.radians(30), 0)))
bike.append(box('Saddle', (0.24, 0.1, 0.05), (-4.32, -0.3, 1.02), rubber, bevel=0.02))
# Leaned on the wall between the window and the door: turned about the line where the wheels touch the ground.
lean = Matrix.Translation((4.9, -0.3, 0)) @ Matrix.Rotation(math.radians(-9), 4, 'X') @ Matrix.Translation((0, 0.3, 0))
for part in bike:
    part.matrix_world = lean @ part.matrix_world
join('Bicycle', bike)

# Rain: thin streaks, slanted by the wind, that catch the light of whatever they pass.
streaks = bpy.data.meshes.new('Rain')
verts, faces = [], []
rng = random.Random(7)
for k in range(900):
    x, y, z = rng.uniform(-5.5, 6.0), rng.uniform(-5.0, -0.6), rng.uniform(-0.1, 6.8)
    length = rng.uniform(0.25, 0.45)
    dx = 0.08 * length
    n = len(verts)
    verts += [(x - 0.003, y, z), (x + 0.003, y, z), (x + 0.003 + dx, y, z + length), (x - 0.003 + dx, y, z + length)]
    faces.append((n, n + 1, n + 2, n + 3))
streaks.from_pydata(verts, [], faces)
streaks.materials.append(rain)
collection.objects.link(bpy.data.objects.new('Rain', streaks))

# An air conditioner on the wall above the crates.
box('Air Conditioner', (0.8, 0.5, 0.55), (5.3, -0.25, 2.4), dark_metal, bevel=0.03)


def light(name, kind, color, energy, location, radius=0.1, rotation=(0, 0, 0), specular=1.0):
    data = bpy.data.lights.new(name, kind)
    data.color, data.energy = color, energy
    if kind == 'SUN':
        data.angle = radius
    elif kind == 'AREA':
        data.size, data.size_y = radius
    else:
        data.shadow_soft_size = radius
    data.specular_factor = specular
    obj = bpy.data.objects.new(name, data)
    obj.location, obj.rotation_euler = location, rotation
    collection.objects.link(obj)
    return obj


# The tubes' light: panels facing the wall, so the puddles see only their backs; no highlights on the backplate.
glow = (math.pi / 2, 0, 0)
light('Magenta Light', 'AREA', (1, 0.08, 0.45), 600, (0.4, -0.8, 4.1), (5, 2), glow, specular=0).data.shape = 'RECTANGLE'
light('Cyan Light', 'AREA', (0.1, 0.65, 1), 220, (-2.75, -0.7, 3.9), (1.6, 1.6), glow, specular=0)
# The window's and the door's light on the street (no highlights of their own: the puddles mirror the openings), a
# cold moon from above and a street lamp off to the right.
light('Window Light', 'POINT', (1, 0.45, 0.15), 160, (-1.6, -0.7, 1.7), 0.5, specular=0)
light('Door Light', 'POINT', (1, 0.45, 0.15), 140, (2.4, -0.4, 1.2), 0.3, specular=0)
light('Moon', 'SUN', (0.35, 0.5, 1), 0.08, (0, 0, 10), 0.1, (math.radians(35), math.radians(-20), 0))
lamp = light('Street Lamp', 'SPOT', (0.3, 0.7, 1), 700, (7.5, -4.0, 5.0), 0.2)
lamp.rotation_euler = (Vector((5.0, -0.8, 0.8)) - lamp.location).to_track_quat('-Z', 'Y').to_euler()
lamp.data.spot_size, lamp.data.spot_blend = math.radians(50), 0.6

world = bpy.data.worlds.new('Night')
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.002, 0.004, 0.012, 1)
scene.world = world

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 17
camera.location = (1.6, -10.0, 0.45)
camera.rotation_euler = (math.radians(90), 0, math.radians(8))
collection.objects.link(camera)
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
scene.view_settings.view_transform = 'Standard'
# Blender's EEVEE reflects the neon in the puddles by ray tracing.
scene.eevee.use_raytracing = True
scene.eevee.taa_render_samples = 64

# The compositor: Render Layers, Glare's Fog Glow around what is brighter than 1, a little Lens Distortion with color
# fringes, a Color Balance that cools the shadows and warms the highlights, then a vignette: a soft Ellipse Mask
# multiplied over the image.
tree = bpy.data.node_groups.new('Compositor Nodes', 'CompositorNodeTree')
tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
scene.compositing_node_group = tree
nodes, links = tree.nodes, tree.links


def socket(sockets, identifier):
    return next(s for s in sockets if s.identifier == identifier)


def node(idname, location, **inputs):
    n = nodes.new(idname)
    n.location = location
    for identifier, value in inputs.items():
        socket(n.inputs, identifier.replace('_', ' ')).default_value = value
    return n


layers = node('CompositorNodeRLayers', (-700, 0))
glare = node('CompositorNodeGlare', (-450, 0), Type='Fog Glow', Quality='High', Highlights_Threshold=0.7, Size=0.85, Strength=1.8)
lens = node('CompositorNodeLensdist', (-200, 0), Distortion=-0.03, Dispersion=0.04)
grade = node('CompositorNodeColorBalance', (50, 0))
grade.inputs['Color Lift'].default_value = (0.99, 1.0, 1.02, 1)
grade.inputs['Color Gain'].default_value = (1.05, 1.0, 0.95, 1)
mask = node('CompositorNodeEllipseMask', (-200, -380), Size=(0.95, 0.8))
soft = node('CompositorNodeBlur', (50, -380), Size=(160, 160))
vignette = nodes.new('ShaderNodeMix')
vignette.data_type, vignette.blend_type = 'RGBA', 'MULTIPLY'
vignette.location = (300, 0)
socket(vignette.inputs, 'Factor_Float').default_value = 0.5
output = nodes.new('NodeGroupOutput')
output.location = (550, 0)
viewer = nodes.new('CompositorNodeViewer')
viewer.location = (550, -200)
links.new(layers.outputs['Image'], glare.inputs['Image'])
links.new(glare.outputs['Image'], lens.inputs['Image'])
links.new(lens.outputs['Image'], grade.inputs['Image'])
links.new(grade.outputs['Image'], socket(vignette.inputs, 'A_Color'))
links.new(mask.outputs['Mask'], soft.inputs['Image'])
links.new(soft.outputs['Image'], socket(vignette.inputs, 'B_Color'))
links.new(socket(vignette.outputs, 'Result_Color'), output.inputs[0])
links.new(socket(vignette.outputs, 'Result_Color'), viewer.inputs['Image'])

sign.select_set(True)
bpy.context.view_layer.objects.active = sign
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'compositor.blend'), compress=True)
