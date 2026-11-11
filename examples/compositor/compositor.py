"""Builds compositor.blend: a noodle bar's neon sign in a wet alley at night, finished in the compositor (Glare's Fog
Glow, Lens Distortion, a Color Balance grade and a vignette), in Blender 5.2.3. The sign's fonts are in fonts/ (SIL Open
Font License).

usage: blender -b --factory-startup -P compositor.py
"""
import math
import os
import random
from contextlib import contextmanager

import bpy
from bpy_extras import anim_utils
from mathutils import Euler, Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
# Where the camera stands (x, y, eye height); the city and the people behind paper are placed from it.
EYE = (2.4, -3.6, 1.6)
# How the steam is made: 'particles' (noise-textured cards emitted by a particle system) or 'volume' (a Principled
# Volume domain with noise density).
STEAM = 'particles'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
collection = scene.collection
wobble = random.Random(3)
# The animation's phases, apart from `wobble` so the still frame stays as it was.
breeze = random.Random(5)
# The loop: 240 frames, 10 s at 24 fps. Every animation's period divides it, so the last frame runs into the first.
LOOP = 240
scene.frame_start, scene.frame_end, scene.render.fps = 1, LOOP, 24


def layer(of, view_layer=None):
    """The view layer's entry for a collection, which makes it the one new objects land in."""
    found = view_layer or bpy.context.view_layer.layer_collection
    return found if found.collection == of else next(filter(None, (layer(of, child) for child in found.children)), None)


def group(name, parent=None):
    """Puts the objects made from here on in the collection `name`, under `parent` (the scene's own by default)."""
    global collection
    collection = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    under = bpy.data.collections[parent] if parent else scene.collection
    if collection.name not in under.children:
        under.children.link(collection)
    bpy.context.view_layer.active_layer_collection = layer(collection)


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


@contextmanager
def merged(name):
    """Joins the objects made inside the block into one, so the scene stays a few hundred objects, not thousands."""
    before, group = set(bpy.data.objects), {}
    yield group
    parts = [obj for obj in bpy.data.objects if obj not in before]
    group['object'] = join(name, parts) if len(parts) > 1 else parts[0] if parts else None


def fcurves(owner):
    """The F-curves of what `owner` animates (its action's channels for its slot)."""
    data = owner.animation_data
    return anim_utils.action_get_channelbag_for_slot(data.action, data.action_slot).fcurves


def looping(owner, path, keys, index=-1, interpolation='BEZIER'):
    """Keys `path` of `owner` at (frame, value) pairs and repeats them with a Cycles modifier: the first and the last key
    are one period apart, a period that divides LOOP."""
    for frame, value in keys:
        if index < 0:
            setattr(owner, path, value)
        else:
            getattr(owner, path)[index] = value
        owner.keyframe_insert(path, index=index, frame=frame)
    full = path if owner == owner.id_data else owner.path_from_id(path)
    for channel in fcurves(owner.id_data):
        if channel.data_path == full and index in (-1, channel.array_index) and not channel.modifiers:
            channel.modifiers.new('CYCLES')
            for key in channel.keyframe_points:
                key.interpolation = interpolation
            channel.update()


def wave(owner, path, index, amplitude, period, phase=0.0):
    """A sine-like sway of `amplitude` about the current value, `period` frames long, its rise through the middle
    `phase` frames after frame 1."""
    middle = getattr(owner, path)[index]
    looping(owner, path, [(1 + phase + period * k / 4, middle + amplitude * (0, 1, 0, -1, 0)[k]) for k in range(5)], index)


def pivoted(obj, pivot):
    """Moves a mesh object's origin to `pivot` (world space), its shape staying where it is: what it turns about."""
    obj.data.transform(Matrix.Translation(-Vector(pivot)) @ obj.matrix_world)
    obj.matrix_world = Matrix.Translation(pivot)
    return obj


def sway(obj, amplitude, periods=(80, 120)):
    """Swings `obj` about its origin, `amplitude` degrees about X and two thirds of it about Y, at a random phase."""
    for axis, (degrees, period) in enumerate(((amplitude, periods[0]), (amplitude * 2 / 3, periods[1]))):
        wave(obj, 'rotation_euler', axis, math.radians(degrees), period, breeze.uniform(0, period))


def textured(name, color_a, color_b, scale, roughness=(0.5, 0.5), metallic=0.0, waves=0.0, bands='Z', distortion=6):
    """A Principled BSDF whose color and roughness a Noise Texture mixes between two ends, with bands (a Wave
    Texture) for wood grain, boards or ridges."""
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
        wave.inputs['Distortion'].default_value = distortion
        wave.bands_direction = bands
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


def weather(mat, streaks, base, rust=None, moss=0.0):
    """Darkens a textured material in vertical water streaks (a Noise Texture stretched along Z) and toward the ground,
    and mixes in rust and moss by noise."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    principled = nodes['Principled BSDF']
    color = principled.inputs['Base Color'].links[0].from_socket
    position = nodes.new('ShaderNodeNewGeometry').outputs['Position']
    stretch = nodes.new('ShaderNodeMapping')
    stretch.inputs['Scale'].default_value = (5, 5, 0.35)
    links.new(position, stretch.inputs['Vector'])
    streak = nodes.new('ShaderNodeTexNoise')
    streak.inputs['Scale'].default_value, streak.inputs['Detail'].default_value = 2.5, 4
    links.new(stretch.outputs['Vector'], streak.inputs['Vector'])
    height = nodes.new('ShaderNodeSeparateXYZ')
    links.new(position, height.inputs['Vector'])

    def ramp(source, low, high, at_low, at_high):
        node = nodes.new('ShaderNodeMapRange')
        node.inputs['From Min'].default_value, node.inputs['From Max'].default_value = low, high
        node.inputs['To Min'].default_value, node.inputs['To Max'].default_value = at_low, at_high
        links.new(source, node.inputs['Value'])
        return node.outputs['Result']

    def mix(a, b, factor, blend='MIX'):
        node = nodes.new('ShaderNodeMix')
        node.data_type, node.blend_type = 'RGBA', blend
        links.new(factor, node.inputs['Factor'])
        for socket, value in (('A', a), ('B', b)):
            if isinstance(value, tuple):
                node.inputs[socket].default_value = (*value, 1)
            else:
                links.new(value, node.inputs[socket])
        return node.outputs['Result']

    grime = nodes.new('ShaderNodeMath')
    grime.operation, grime.use_clamp = 'ADD', True
    links.new(ramp(streak.outputs['Fac'], 0.5, 0.7, 0, streaks), grime.inputs[0])
    links.new(ramp(height.outputs['Z'], 0, 0.7, base, 0), grime.inputs[1])
    color = mix(color, (0.25, 0.22, 0.18), grime.outputs['Value'], 'MULTIPLY')
    if rust:
        patches = nodes.new('ShaderNodeTexNoise')
        patches.inputs['Scale'].default_value, patches.inputs['Detail'].default_value = 1.2, 6
        links.new(position, patches.inputs['Vector'])
        color = mix(color, rust, ramp(patches.outputs['Fac'], 0.52, 0.68, 0, 0.9))
    if moss:
        cracks = nodes.new('ShaderNodeMath')
        cracks.operation = 'MULTIPLY'
        links.new(ramp(height.outputs['Z'], 0, 0.35, moss, 0), cracks.inputs[0])
        links.new(ramp(streak.outputs['Fac'], 0.4, 0.6, 0, 1), cracks.inputs[1])
        color = mix(color, (0.03, 0.05, 0.015), cracks.outputs['Value'])
    links.new(color, principled.inputs['Base Color'])
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
magenta = material('Neon Magenta', (1.0, 0.05, 0.42), emission=6)
cyan = material('Neon Cyan', (0.05, 0.75, 1.0), emission=5)
steam_neon = material('Neon White', (0.75, 0.9, 1.0), emission=3)
dark_metal = material('Dark Metal', (0.02, 0.02, 0.025), roughness=0.35, metallic=1)
backplate = material('Sign Backplate', (0.006, 0.006, 0.01), roughness=0.3, metallic=1)
# Black metal reflecting almost nothing: the tubes' light panels face it and must not show in it, nor the tubes in its
# screen-traced reflections.
backplate.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0
wood = textured('Crate Wood', (0.16, 0.09, 0.045), (0.05, 0.03, 0.02), 3, (0.55, 0.8), waves=6)
rubber = material('Rubber', (0.008, 0.008, 0.008), roughness=0.6)
rusty_paint = textured('Rusty Paint', (0.3, 0.03, 0.02), (0.1, 0.035, 0.012), 14, (0.3, 0.85), metallic=0.3)
chrome = material('Chrome', (0.6, 0.6, 0.62), roughness=0.2, metallic=1)
mirror = material('Puddle', (0.003, 0.003, 0.004), roughness=0.02)

# The facades: dark timber boards below, weathered plaster or corrugated metal above, tiled eaves between.
timber = textured('Timber', (0.1, 0.055, 0.03), (0.03, 0.018, 0.01), 2, (0.5, 0.8), waves=5, bands='X', distortion=0.4)
weathered_plaster = textured('Weathered Plaster', (0.3, 0.25, 0.18), (0.12, 0.1, 0.07), 1.5, (0.8, 0.95))
corrugated = textured('Corrugated Metal', (0.15, 0.11, 0.08), (0.05, 0.035, 0.025), 3, (0.35, 0.7), metallic=0.5, waves=20, bands='X', distortion=0)
roof_tiles = textured('Roof Tiles', (0.045, 0.045, 0.05), (0.015, 0.015, 0.018), 4, (0.3, 0.55), waves=25, bands='X', distortion=0)
weather(timber, 0.5, 0.7, moss=0.7)
weather(weathered_plaster, 0.8, 0.5)
weather(corrugated, 0.4, 0.4, rust=(0.22, 0.07, 0.02))

group('Bar')
wall = box('Wall', (8.6, 0.3, 2.9), (0.1, 0.15, 1.3), timber)
upper_wall = box('Upper Wall', (8.6, 0.3, 3.4), (0.1, 0.15, 4.45), weathered_plaster)
openings = [box('Window Opening', (2.8, 1.0, 1.5), (-1.6, 0.15, 1.75), None),
            box('Door Opening', (1.15, 1.0, 2.25), (2.4, 0.15, 1.125), None)]
for opening in openings:
    cut = wall.modifiers.new(opening.name, 'BOOLEAN')
    cut.operation, cut.object = 'DIFFERENCE', opening
    bpy.context.view_layer.objects.active = wall
    bpy.ops.object.modifier_apply(modifier=opening.name)
    bpy.data.objects.remove(opening)

group('Lane')
# The street: a narrow road between raised sidewalks, wet asphalt with grain, and puddles that mirror the neon.
asphalt = textured('Wet Asphalt', (0.022, 0.022, 0.024), (0.008, 0.008, 0.009), 1.5, (0.25, 0.08))
box('Sidewalk', (60, 1.2, 0.15), (-15, -0.6, -0.075), asphalt)
box('Road', (60, 2.8, 0.15), (-15, -2.6, -0.225), asphalt)
box('Far Sidewalk', (60, 0.8, 0.15), (-15, -4.4, -0.075), asphalt)
for y in (-1.2, -4.0):
    box('Curb', (60, 0.18, 0.17), (-15, y, -0.065), dark_metal, bevel=0.02)

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


for i, (x, y, z, rx, ry) in enumerate(((0.5, -2.6, -0.15, 2.2, 0.8), (-4.5, -2.5, -0.15, 2.6, 0.8), (-9.5, -2.7, -0.15, 3.0, 0.8),
                                       (-1.3, -0.7, 0.0, 0.9, 0.3), (2.6, -2.9, -0.15, 1.6, 0.7))):
    puddle(f'Puddle {i + 1}', x, y, z, rx, ry, i * 1.7)
for i in range(6):
    puddle(f'Puddle {i + 6}', wobble.uniform(-22, -3), wobble.uniform(-3.4, -1.8), -0.15, wobble.uniform(0.3, 1.6), wobble.uniform(0.15, 0.5), i)

group('Sign')
# The sign: script words and a bowl of noodles in glass tubes, standing off a dark backplate.
box('Backplate', (3.6, 0.05, 1.3), (0.2, -0.05, 3.6), backplate, bevel=0.04)
with merged('Standoffs'):
    for x, z in ((-1.45, 4.1), (1.85, 4.1), (-1.45, 3.1), (1.85, 3.1)):
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


kanji = bpy.data.fonts.load(os.path.join(HERE, 'fonts', 'ZenMaruGothic-Light.ttf'))
display = bpy.data.fonts.load(os.path.join(HERE, 'fonts', 'PoiretOne-Regular.ttf'))
sign = neon_text('Menya Akari', '麺屋 灯', kanji, (0.7, -0.2, 3.75), 0.62, magenta, 0.016, -0.005)
# One tube of 灯 is dead: the sign's rightmost contour is unlit glass.
bpy.ops.object.select_all(action='DESELECT')
sign.select_set(True)
bpy.context.view_layer.objects.active = sign
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='LOOSE')
bpy.ops.object.mode_set(mode='OBJECT')
contours = list(bpy.context.selected_objects)
dead = max(contours, key=lambda part: sum((part.matrix_world @ v.co).x for v in part.data.vertices) / len(part.data.vertices))
dead.data.materials[0] = material('Dead Neon', (0.04, 0.02, 0.03), roughness=0.15)
# Once a loop it stutters back to life for a moment, then dies again.
dying = dead.data.materials[0].node_tree.nodes['Principled BSDF']
dying.inputs['Emission Color'].default_value = magenta.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value
looping(dying.inputs['Emission Strength'], 'default_value', [(1, 0), (150, 4), (151, 0), (154, 5), (156, 0), (157, 3), (158, 0), (1 + LOOP, 0)],
        interpolation='CONSTANT')
# The cyan tubes hum: their light dips for a frame or two, twice a loop.
looping(cyan.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'], 'default_value',
        [(1, 5), (88, 3.8), (89, 5), (91, 4.3), (92, 5), (203, 4), (205, 5), (1 + LOOP, 5)], interpolation='CONSTANT')
sign = join('Menya Akari', [sign] + [part for part in contours if part is not sign])
neon_text('Open Late', 'MENYA AKARI   OPEN LATE', display, (0.7, -0.2, 3.24), 0.15, cyan, 0.009, -0.003, 1.25)

# The bowl: a half circle under a rim, chopsticks and three wisps of steam, drawn at half size around (bx, bz).
bx, by, bz, k = -1.0, -0.2, 3.55, 0.5


def icon(dx, dz):
    return (bx + k * dx, by, bz + k * dz)


curve('Bowl', [icon(0.62 * math.cos(a), 0.55 * math.sin(a)) for a in [math.pi + i * math.pi / 8 for i in range(9)]], cyan, 0.018)
curve('Rim', [icon(-0.75, 0.02), icon(0.75, 0.02)], cyan, 0.018, smooth=False)
curve('Foot', [icon(-0.22, -0.62), icon(0.22, -0.62)], cyan, 0.018, smooth=False)
curve('Chopstick', [icon(0.1, 0.25), icon(0.85, 1.0)], magenta, 0.015, smooth=False)
curve('Chopstick 2', [icon(0.25, 0.18), icon(1.0, 0.85)], magenta, 0.015, smooth=False)
with merged('Neon Steam'):
    for i, dx in enumerate((-0.4, -0.1, 0.2)):
        curve(f'Steam {i + 1}', [icon(dx + 0.08 * math.sin(t * 2.2), 0.2 + t * 0.22) for t in range(5)], steam_neon, 0.012)

def ellipsoid(name, scale, location, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=1, location=location)
    obj = finish(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def steam(name, x, y, z, width, height, density=6.0, drift=(0.0, 0.0), count=10):
    """Steam rising from (x, y, z), `width` across and `height` tall, leaning by `drift`: made as STEAM says."""
    if STEAM == 'volume':
        return steam_volume(name, x, y, z, width, height, density, drift)
    return steam_particles(name, x, y, z, width, height, drift, count)


def puff_material():
    """A steam card's look: thin white, unlit by itself, its alpha a vertically stretched, distorted Noise Texture (streaks,
    not blobs) inside a soft oval, fading in above its foot and out toward its top."""
    mat = bpy.data.materials.get('Steam Puff')
    if mat:
        return mat
    mat = bpy.data.materials.new('Steam Puff')
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    principled = nodes['Principled BSDF']
    principled.inputs['Base Color'].default_value = (0.92, 0.92, 0.9, 1)
    principled.inputs['Roughness'].default_value = 1.0
    principled.inputs['Emission Color'].default_value = (1.0, 0.92, 0.82, 1)
    principled.inputs['Emission Strength'].default_value = 0.1
    coord = nodes.new('ShaderNodeTexCoord')

    def node(kind, *inputs, **settings):
        n = nodes.new(kind)
        for key, value in settings.items():
            setattr(n, key, value)
        for i, value in enumerate(inputs):
            if value is None:
                continue
            if isinstance(value, (int, float, tuple)):
                n.inputs[i].default_value = value
            else:
                links.new(value, n.inputs[i])
        return n

    centered = node('ShaderNodeMapping', coord.outputs['Generated'], (-1, 0, -1), None, (2, 0, 2))
    oval = node('ShaderNodeTexGradient', centered.outputs['Vector'], gradient_type='SPHERICAL')
    stretched = node('ShaderNodeMapping', coord.outputs['Object'], None, None, (1, 1, 0.3))
    noise = node('ShaderNodeTexNoise', stretched.outputs['Vector'], None, 1.2, 8, 0.6)
    noise.inputs['Distortion'].default_value = 2.5
    streaks = node('ShaderNodeMapRange', noise.outputs['Fac'], 0.45, 0.75, 0.0, 1.0)
    height = node('ShaderNodeSeparateXYZ', coord.outputs['Generated'])
    # Transparent at the foot, densest a fifth of the way up, gone at the top.
    rise = node('ShaderNodeFloatCurve', None, height.outputs['Z'])
    points = rise.mapping.curves[0].points
    points[0].location, points[1].location = (0, 0), (1, 0)
    points.new(0.22, 1.0)
    rise.mapping.update()
    alpha = node('ShaderNodeMath', oval.outputs['Fac'], streaks.outputs['Result'], operation='MULTIPLY')
    alpha = node('ShaderNodeMath', alpha.outputs[0], rise.outputs['Value'], operation='MULTIPLY')
    alpha = node('ShaderNodeMath', alpha.outputs[0], 0.2, operation='MULTIPLY')
    links.new(alpha.outputs[0], principled.inputs['Alpha'])
    # Thin enough to pass the room's light through from behind: half translucent, cut by the same alpha.
    glow = node('ShaderNodeBsdfTranslucent', (0.95, 0.93, 0.9, 1))
    see_through = node('ShaderNodeBsdfTransparent')
    lit_through = node('ShaderNodeMixShader', alpha.outputs[0], see_through.outputs[0], glow.outputs[0])
    both = node('ShaderNodeMixShader', 0.5, principled.outputs['BSDF'], lit_through.outputs[0])
    links.new(both.outputs[0], nodes['Material Output'].inputs['Surface'])
    mat.surface_render_method = 'BLENDED'
    return mat


def steam_particles(name, x, y, z, width, height, drift, count):
    """A disk over the source emitting noise-textured cards, `count` at a time, that rise, drift, wander (Brownian motion), turn
    toward the camera and grow over their short life."""
    # Cards three times taller than wide, a single face each.
    puff = outline(f'{name} Card', [(x - 0.5, y, -21.5), (x + 0.5, y, -21.5), (x + 0.5, y, -18.5), (x - 0.5, y, -18.5)], puff_material())
    puff.location = (0, 0, 0)
    puff.data.transform(Matrix.Translation((-x, -y, 20)))
    bpy.ops.mesh.primitive_circle_add(vertices=12, radius=width / 3, fill_type='NGON', location=(x, y, z))
    emitter = finish(bpy.context.object, f'{name} Emitter', None)
    emitter.show_instancer_for_render = emitter.show_instancer_for_viewport = False
    # Turned so its Y axis points at the camera: the cards, aligned to it, face the camera.
    emitter.rotation_euler.z = math.atan2(-(EYE[0] - x), EYE[1] - y)
    system = emitter.modifiers.new(name, 'PARTICLE_SYSTEM').particle_system
    settings = system.settings
    settings.name = name
    # `count` alive at a time: emitted evenly from well before the first frame (already rising at frame 1) to after the
    # loop's last; a life of 40 frames divides the loop.
    settings.frame_start, settings.frame_end = -120, LOOP + 10
    settings.lifetime, settings.lifetime_random = 40, 0.3
    settings.count = int(count * (settings.frame_end - settings.frame_start) // settings.lifetime)
    # Rising about half a meter over its life (1.7 s at 24 fps), a little sideways.
    settings.emit_from, settings.normal_factor, settings.factor_random = 'FACE', 0.35, 0.05
    settings.object_align_factor = (drift[0], drift[1], 0)
    settings.brownian_factor = 0.15
    settings.effector_weights.gravity = 0
    settings.render_type, settings.instance_object = 'OBJECT', puff
    settings.use_rotations, settings.rotation_mode, settings.phase_factor_random = True, 'OB_Y', 2.0
    settings.particle_size, settings.size_random = width * 0.7, 0.3
    # Each card grows over its life: a Blend texture along the particle's age scales its size.
    grow = bpy.data.textures.new(f'{name} Growth', 'BLEND')
    slot = settings.texture_slots.add()
    slot.texture, slot.texture_coords = grow, 'STRAND'
    slot.use_map_time, slot.use_map_size, slot.size_factor = False, True, 1.0
    system.seed = len(name)
    return emitter


def steam_volume(name, x, y, z, width, height, density=6.0, drift=(0.0, 0.0)):
    """Steam rising from (x, y, z): a box domain `width` wide and `height` tall with a Principled Volume whose density
    is a fine Noise Texture, strongest at the bottom center and gone toward the top and the sides, leaning by `drift`
    (its top's offset, meters). White, thin and breaking up as it rises."""
    mat = bpy.data.materials.new(f'{name} Volume')
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.remove(nodes['Principled BSDF'])
    volume = nodes.new('ShaderNodeVolumePrincipled')
    volume.inputs['Color'].default_value = (0.95, 0.93, 0.9, 1)
    coord, noise, mapping = nodes.new('ShaderNodeTexCoord'), nodes.new('ShaderNodeTexNoise'), nodes.new('ShaderNodeMapping')
    noise.inputs['Scale'].default_value, noise.inputs['Detail'].default_value, noise.inputs['Roughness'].default_value = 6, 6, 0.65
    # Generated coordinates run 0..1 over the box: shear them by the drift so the plume leans.
    mapping.inputs['Location'].default_value = (0, 0, 0)
    links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    parts = nodes.new('ShaderNodeSeparateXYZ')
    links.new(coord.outputs['Generated'], parts.inputs['Vector'])

    def node(kind, *inputs, operation=None):
        n = nodes.new(kind)
        if operation:
            n.operation = operation
        for i, value in enumerate(inputs):
            if isinstance(value, (int, float)):
                n.inputs[i].default_value = value
            else:
                links.new(value, n.inputs[i])
        return n.outputs[0]

    # Fades: up the box (thinning as it rises), and out from the plume's leaning axis.
    rise = node('ShaderNodeMath', 1.0, parts.outputs['Z'], operation='SUBTRACT')
    axis_x = node('ShaderNodeMath', parts.outputs['X'], node('ShaderNodeMath', node('ShaderNodeMath', parts.outputs['Z'], drift[0] / width, operation='MULTIPLY'), 0.5, operation='ADD'), operation='SUBTRACT')
    axis_y = node('ShaderNodeMath', parts.outputs['Y'], node('ShaderNodeMath', node('ShaderNodeMath', parts.outputs['Z'], drift[1] / width, operation='MULTIPLY'), 0.5, operation='ADD'), operation='SUBTRACT')
    off = node('ShaderNodeMath', node('ShaderNodeMath', axis_x, axis_x, operation='MULTIPLY'), node('ShaderNodeMath', axis_y, axis_y, operation='MULTIPLY'), operation='ADD')
    spread = node('ShaderNodeMath', 0.04, node('ShaderNodeMath', parts.outputs['Z'], 0.12, operation='MULTIPLY'), operation='ADD')
    radial = node('ShaderNodeMath', 1.0, node('ShaderNodeMath', off, spread, operation='DIVIDE'), operation='SUBTRACT')
    shape = node('ShaderNodeMath', node('ShaderNodeMath', rise, radial, operation='MULTIPLY'), 0.0, operation='MAXIMUM')
    wisps = nodes.new('ShaderNodeMapRange')
    wisps.inputs['From Min'].default_value, wisps.inputs['From Max'].default_value = 0.5, 0.75
    links.new(noise.outputs['Fac'], wisps.inputs['Value'])
    density_value = node('ShaderNodeMath', node('ShaderNodeMath', shape, wisps.outputs['Result'], operation='MULTIPLY'), density, operation='MULTIPLY')
    links.new(density_value, volume.inputs['Density'])
    links.new(volume.outputs['Volume'], nodes['Material Output'].inputs['Volume'])
    return box(name, (width, width, height), (x, y, z + height / 2), mat)


group('Bar')
# The bar: one shallow room behind the window and the door, plaster walls, a wooden counter, a row of menu tags over
# the cook, paper lanterns and a stockpot.
plaster = textured('Plaster', (0.6, 0.4, 0.22), (0.5, 0.32, 0.17), 4, (0.8, 0.9))
counter_wood = textured('Counter Wood', (0.3, 0.16, 0.07), (0.12, 0.06, 0.03), 3, (0.35, 0.6), waves=5)
dark_wood = material('Dark Wood', (0.03, 0.015, 0.01), roughness=0.6)
porcelain = material('Porcelain', (0.8, 0.75, 0.65), roughness=0.25)
paper = material('Menu Paper', (0.9, 0.8, 0.6), roughness=0.9, emission=0.1)
slip_paper = material('Slip Paper', (0.32, 0.28, 0.2), roughness=0.9)
lantern_paper = material('Lantern Paper', (1.0, 0.12, 0.03), emission=2.5)
white_lantern = material('White Lantern', (1.0, 0.8, 0.55), emission=2.2)
steel = material('Steel', (0.5, 0.48, 0.45), roughness=0.3, metallic=1)

box('Back Wall', (10.0, 0.1, 3.0), (-1.55, 2.5, 1.5), plaster)
box('Ceiling', (10.0, 2.3, 0.1), (-1.55, 1.35, 2.95), dark_wood)
box('Floor', (10.0, 2.3, 0.15), (-1.55, 1.35, 0.075), dark_wood)
for x in (-6.55, 3.45):
    box('Side Wall', (0.1, 2.3, 3.0), (x, 1.35, 1.5), plaster)
box('Counter', (9.4, 0.4, 1.37), (-1.7, 1.6, 0.685), timber)
box('Wainscot', (3.0, 0.04, 1.1), (2.0, 2.43, 0.55), dark_wood)
for sx in (1.5, 2.25):
    cylinder('Bar Stool', 0.17, 0.05, (sx, 1.15, 0.85), counter_wood, vertices=16)
    cylinder('Stool Leg', 0.03, 0.7, (sx, 1.15, 0.5), dark_metal, vertices=8)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.15, minor_radius=0.012, major_segments=16, minor_segments=4, location=(sx, 1.15, 0.36))
    finish(bpy.context.object, 'Footrest', dark_metal)
box('Counter Top', (9.5, 0.5, 0.05), (-1.7, 1.55, 1.395), counter_wood, bevel=0.01)
box('Counter Edge', (9.5, 0.03, 0.06), (-1.7, 1.29, 1.39), material('Hinoki Edge', (0.55, 0.38, 0.2), roughness=0.4))
box('Menu Board', (2.9, 0.04, 0.42), (-4.7, 2.43, 2.25), dark_wood)
sake_glass = material('Sake Bottle', (0.05, 0.12, 0.05), roughness=0.1)
# Through the door: a shelf of sake bottles and a calendar.
with merged('Doorway Shelf'):
    box('Bottle Shelf', (1.0, 0.2, 0.03), (2.4, 2.38, 1.55), dark_wood)
    for i in range(7):
        cylinder('Sake Bottle', 0.04, 0.3, (1.98 + i * 0.14, 2.38, 1.72), sake_glass if i % 3 else porcelain, vertices=10)
    box('Calendar', (0.36, 0.01, 0.5), (2.55, 2.44, 2.05), slip_paper, (0, math.radians(2), 0))
    box('Calendar Picture', (0.3, 0.012, 0.22), (2.55, 2.435, 2.17), material('Calendar Picture', (0.2, 0.3, 0.35), roughness=0.8), (0, math.radians(2), 0))
tube_light = material('Tube Light', (1.0, 0.88, 0.72), emission=2.5)
odd_tube = material('Odd Tube', (0.55, 1.0, 0.65), emission=2.5)
with merged('Tube Lights'):
    for i, x in enumerate((-5.7, -4.6, -3.5)):
        cylinder('Tube Light', 0.018, 0.9, (x, 2.42, 2.58), odd_tube if i == 1 else tube_light, (0, math.pi / 2, 0), 8)
with merged('Menu Tags'):
    for i in range(11):
        box(f'Menu Tag {i + 1}', (0.12, 0.02, 0.32), (-6.0 + i * 0.26, 2.4, 2.25), slip_paper)
box('Bowl Shelf', (0.7, 0.18, 0.03), (-3.6, 2.36, 1.75), dark_wood)


def bowl(name, x, y, z, radius=0.08, mat=porcelain):
    """A bowl: a cone wide at the top on a short foot."""
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=radius * 0.5, radius2=radius, depth=radius * 0.8, location=(x, y, z + radius * 0.4))
    return finish(bpy.context.object, name, mat)


with merged('Bowls'):
    for i, x in enumerate((-3.85, -3.7, -3.55, -3.4, -3.25)):
        for k in range(2 if i % 2 else 3):
            bowl('Shelf Bowl', x, 2.35, 1.765 + k * 0.05, 0.065)
    for x in (-4.1, -2.9, -1.9):
        bowl('Counter Bowl', x, 1.45, 1.42)
for x in (-4.1, -2.9, -1.9):
    steam('Bowl Steam', x, 1.45, 1.47, 0.25, 0.45, density=4)
cylinder('Stockpot', 0.2, 0.35, (-4.8, 2.2, 1.475), steel, vertices=20)
with merged('Traces'):
    bowl('Half-Eaten Bowl', -1.55, 1.45, 1.42)
    for dy in (-0.012, 0.012):
        box('Resting Chopstick', (0.22, 0.008, 0.008), (-1.55, 1.45 + dy, 1.495), dark_wood, (0, 0, math.radians(8)))
    cylinder('Umbrella Stand', 0.13, 0.5, (3.35, -0.3, 0.25), dark_metal, vertices=14)
    for k, (tilt, color) in enumerate(((6, (0.55, 0.58, 0.6)), (-8, (0.02, 0.03, 0.09)), (3, (0.35, 0.02, 0.02)))):
        bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.012, radius2=0.055, depth=0.75, location=(3.32 + k * 0.04, -0.3, 0.62),
                                        rotation=(math.radians(tilt), math.radians(tilt * 0.6), 0))
        finish(bpy.context.object, 'Closed Umbrella', material('Closed Umbrella', color, roughness=0.3))
    for bx_, turn in ((1.95, 8), (2.15, -5), (2.55, 15)):
        cylinder('Rubber Boot', 0.055, 0.3, (bx_, -0.25, 0.15), material('Boot Rubber', (0.02, 0.03, 0.02), roughness=0.4), vertices=10)
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.24, radius2=0.12, depth=0.8, location=(2.95, 2.36, 1.45))
    finish(bpy.context.object, 'Coat on a Hook', material('Hung Coat', (0.04, 0.07, 0.04), roughness=0.9))
    box('Radio', (0.24, 0.12, 0.14), (2.75, 2.36, 1.64), material('Radio Case', (0.25, 0.08, 0.04), roughness=0.4))
    box('Radio Dial', (0.12, 0.01, 0.04), (2.75, 2.29, 1.66), material('Radio Dial', (1.0, 0.6, 0.2), emission=4))
steam('Pot Steam', -4.8, 2.2, 1.66, 0.6, 1.1, density=6, drift=(0.1, -0.1))


def lantern(name, x, y, z, mat=lantern_paper, top=2.9, size=1.0):
    """A paper lantern (chochin) on a cord: an egg of glowing paper between dark caps, one object hung from the cord's
    top, which it swings about."""
    z += wobble.uniform(-0.06, 0.06)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.12 * size, location=(x, y, z))
    shade = finish(bpy.context.object, name, mat)
    shade.scale.z = 1.35
    shade.rotation_euler = (math.radians(wobble.uniform(-6, 6)), math.radians(wobble.uniform(-6, 6)), 0)
    caps = [cylinder('Lantern Cap', 0.06 * size, 0.03 * size, (x, y, z + dz * size), dark_wood, vertices=12) for dz in (-0.155, 0.155)]
    cord = curve('Lantern Cord', [(x, y, z + 0.17 * size), (x, y, top)], rubber, 0.005, smooth=False)
    return pivoted(join(name, [shade, *caps, cord]), (x, y, top))


with merged('Lanterns'):
    for i, (x, z) in enumerate(((-4.2, 2.08), (-3.15, 2.08), (-2.1, 2.08), (2.3, 1.7))):
        lantern(f'Lantern {i + 1}', x, 1.15, z)


# Clothes.
coats = [material(name, color, roughness=0.8) for name, color in (('Dark Coat', (0.02, 0.018, 0.018)), ('Denim Jacket', (0.05, 0.09, 0.18)),
                                                                   ('Beige Trench', (0.3, 0.22, 0.13)), ('Grey Parka', (0.12, 0.12, 0.11)))]
umbrellas = [material(name, color, roughness=0.3) for name, color in (('Clear Umbrella Canopy', (0.55, 0.58, 0.6)), ('Navy Umbrella Canopy', (0.02, 0.03, 0.09)),
                                                                       ('Red Umbrella Canopy', (0.35, 0.02, 0.02)))]
hair = material('Hair', (0.01, 0.008, 0.007), roughness=0.6)

# People from CC0 models (models/), each seated from its own rig: its own sitting animation where it has one, else its
# legs bent at the hips and knees; its arms turned to bring both hands together at the chest, round a cup.
# Bone names of the rigs these models come with, {} for the side's name.
RIGS = {
    'HumanArmature': dict(sides=('L', 'R'), arm='UpperArm.{}', forearm='LowerArm.{}', hand='Palm.{}', thigh='UpperLeg.{}',
                          shin='LowerLeg.{}', foot='Foot.{}'),
    'CharacterArmature': dict(sides=('L', 'R'), arm='UpperArm.{}', forearm='LowerArm.{}', hand='Wrist.{}', thigh='UpperLeg.{}',
                              shin='LowerLeg.{}', foot='Foot.{}'),
    'Armature': dict(sides=('Left', 'Right'), arm='{}Arm', forearm='{}ForeArm', hand='{}Hand', thigh='{}UpLeg', shin='{}Leg',
                     foot='{}Foot'),
}


def holding(rig, bones, sit, sip=False):
    """Directions (world space, facing -Y) that seat the rig and bring its hands together at the chest: its legs only
    when it has no sitting animation of its own. Sipping, the hands come up to the mouth and the head lifts to them."""
    pose, world = rig.pose.bones, rig.matrix_world
    directions = []
    for side in bones['sides']:
        out = 1 if (world @ pose[bones['arm'].format(side)].head).x > 0 else -1
        if not sit:
            directions += [(bones['thigh'].format(side), (0.12 * out, -1, -0.05)), (bones['shin'].format(side), (0.04 * out, 0.12, -1)),
                           (bones['foot'].format(side), (0, -1, -0.3))]
        # Elbows in near the body, forearms rising to the chest, wrists relaxed round the cup.
        forearm, hand = ((-0.5 * out, -0.55, 0.68), (-0.5 * out, -0.2, 0.85)) if sip else ((-0.55 * out, -0.75, 0.4), (-0.55 * out, -0.35, 0.75))
        directions += [(bones['arm'].format(side), (0.12 * out, -0.2, -1)), (bones['forearm'].format(side), forearm),
                       (bones['hand'].format(side), hand)]
    # The head bowed until the face points down into the cup.
    return directions + [('Head', (0, -0.62, 0.78) if sip else (0, -0.8, 0.6))]


def curl_fingers(rig, angle=70):
    """Curls every finger joint of the rig's hands, as round a cup."""
    for bone in rig.pose.bones:
        if any(finger in bone.name for finger in ('Index', 'Middle', 'Ring', 'Pinky', 'Thumb', 'Fingers')):
            bone.rotation_mode = 'XYZ'
            bone.rotation_euler.x += math.radians(angle if 'Thumb' not in bone.name else angle / 2)
    bpy.context.view_layer.update()


def posed(rig, directions):
    """Turns each bone to point where `directions` says (world space, the body facing -Y), parents first."""
    pose, to_rig = rig.pose.bones, rig.matrix_world.to_3x3().inverted()
    for bone, world_direction in directions:
        direction = to_rig @ Vector(world_direction)
        matrix = pose[bone].matrix.copy()
        turn = matrix.to_3x3().col[1].normalized().rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4()
        head = matrix.translation.copy()
        matrix = turn @ matrix.normalized()
        matrix.translation = head
        pose[bone].matrix = matrix @ Matrix.Diagonal(pose[bone].matrix.to_scale()).to_4x4()
        bpy.context.view_layer.update()
    return pose




def repaint(body, palette):
    """Recolours a model's palette texture: each pixel nearest a color of `palette` (sRGB) gets its new color."""
    for slot in body.material_slots:
        texture = next((node for node in slot.material.node_tree.nodes if node.type == 'TEX_IMAGE'), None)
        if not texture:
            continue
        image = texture.image.copy()
        pixels = list(image.pixels)
        for i in range(0, len(pixels), 4):
            old = min(palette, key=lambda color: sum((a - b) ** 2 for a, b in zip(color, pixels[i:i + 3])))
            if sum((a - b) ** 2 for a, b in zip(old, pixels[i:i + 3])) < 0.01:
                pixels[i:i + 3] = palette[old]
        image.pixels = pixels
        image.pack()
        texture.image = image
        principled = slot.material.node_tree.nodes['Principled BSDF']
        principled.inputs['Roughness'].default_value = 0.75
        principled.inputs['Specular IOR Level'].default_value = 0.3


def shape(obj):
    """The world positions of an object's vertices as evaluated (posed by its rig)."""
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    points = [evaluated.matrix_world @ v.co for v in evaluated.to_mesh().vertices]
    evaluated.to_mesh_clear()
    return points


def seated(name, model, x, y, facing, seat, palette=None, floor=0.0, rigged=False):
    """A person from `model` (a .glb in models/) seated with the hips `seat` meters above the feet on a floor at `floor`,
    turned `facing` degrees from facing -Y, holding a cup at the chest, recoloured by `palette` (repaint()); returns the
    figure, where its hands meet, the top of the head, the underside of the hips (where a seat goes) and, `rigged`, its
    rig (posed as it sits, the pose its own, no longer its animation's) with each bone's rotation for a sip of the cup;
    else the pose is the mesh's and the rig is gone."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, 'models', model))
    imported = [obj for obj in bpy.data.objects if obj not in before]
    rig = next(obj for obj in imported if obj.type == 'ARMATURE')
    bones = next(names for names in RIGS.values() if names['hand'].format(names['sides'][0]) in rig.pose.bones)
    sit = next((action for action in bpy.data.actions if action.name.split('|')[-1] in ('Man_Sitting', 'Female_Sitting', 'SitIdle')), None)
    rig.animation_data_create().action = sit
    if not sit:
        for bone in rig.pose.bones:
            bone.matrix_basis.identity()
    scene.frame_set(int(sum(sit.frame_range) / 2) if sit else 1)
    pose = posed(rig, holding(rig, bones, sit))
    curl_fingers(rig)
    world = rig.matrix_world
    hands = [world @ pose[bones['hand'].format(side)].tail for side in bones['sides']]
    hips, feet = world @ pose['Hips'].head, world @ pose[bones['foot'].format(bones['sides'][0])].head
    sip = None
    if rigged:
        rest = {bone.name: bone.rotation_quaternion.copy() for bone in pose}
        posed(rig, holding(rig, bones, sit, sip=True))
        sip = {bone: pose[bone].rotation_quaternion.copy() for bone, rotation in rest.items() if pose[bone].rotation_quaternion != rotation}
        for bone, rotation in rest.items():
            pose[bone].rotation_quaternion = rotation
        rig.animation_data.action = None
        matrix = rig.matrix_world.copy()
        rig.parent = None
        rig.matrix_world = matrix
    parts = [obj for obj in imported if obj.type == 'MESH' and obj.parent is rig]
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if not rigged:
        bpy.ops.object.convert(target='MESH')
        for part in parts:
            matrix = part.matrix_world.copy()
            part.parent = None
            part.matrix_world = matrix
    bpy.ops.object.join()
    body = bpy.context.object
    if not rigged:
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for obj in imported:
        if obj not in parts and not (rigged and obj is rig):
            bpy.data.objects.remove(obj)
    scene.frame_set(1)
    body.name = name
    # Sized so the head's top sits 0.85 m above the hips, as a seated adult's does.
    top = max(co.z for co in shape(body))
    k = 0.85 / (top - hips.z)
    cup = (hands[0] + hands[1]) / 2
    placement = (Matrix.Translation((x, y, floor + seat)) @ Matrix.Rotation(math.radians(facing), 4, 'Z') @ Matrix.Scale(k, 4)
                 @ Matrix.Translation(-Vector((hips.x, hips.y, hips.z))))
    if rigged:
        rig.name = f'{name} Rig'
        rig.matrix_world = placement @ rig.matrix_world
        # Up until her soles rest on the floor, the seat below her (made from what this returns) as high.
        lift = Matrix.Translation((0, 0, floor - min(co.z for co in shape(body))))
        placement = lift @ placement
        rig.matrix_world = lift @ rig.matrix_world
    else:
        body.matrix_world = placement
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    if palette:
        repaint(body, palette)
    points = shape(body)
    head = max(points, key=lambda co: co.z)
    under = [co for co in points if (co.xy - Vector((x, y))).length < 0.12]
    return body, placement @ cup, head, min(co.z for co in under), rig if rigged else None, sip




def key_pose(rig, frame, rotations, bones=None, keyed=None):
    """Keys the rotation of each of `bones` (all, unset) at `frame`: `rotations` by bone name, rest where it has none;
    a quaternion on the side of the bone's last key in `keyed`, so its F-curves turn the short way between keys."""
    for bone in rig.pose.bones:
        if bones is not None and bone.name not in bones:
            continue
        path = 'rotation_quaternion' if bone.rotation_mode == 'QUATERNION' else 'rotation_euler'
        rotation = rotations.get(bone.name, Quaternion() if path == 'rotation_quaternion' else Euler()).copy()
        if path == 'rotation_quaternion' and keyed is not None:
            if bone.name in keyed:
                rotation.make_compatible(keyed[bone.name])
            keyed[bone.name] = rotation
        setattr(bone, path, rotation)
        bone.keyframe_insert(path, frame=frame)
        if bone.name == 'Hips':
            bone.location = rotations.get('Hips location', Vector())
            bone.keyframe_insert('location', frame=frame)


def rotations(rig):
    """Each bone's rotation as posed, and the hips' location."""
    pose = rig.pose.bones
    return {'Hips location': pose['Hips'].location.copy(), **{bone.name: (bone.rotation_quaternion if bone.rotation_mode == 'QUATERNION'
                                                                          else bone.rotation_euler).copy() for bone in pose}}


def face(rig, facing):
    """Turns her hips about the vertical so that she faces `facing` degrees from facing -Y (her left towards +X)."""
    world, hips = rig.matrix_world, rig.pose.bones['Hips']
    bpy.context.view_layer.update()
    left = (world @ rig.pose.bones['LeftUpLeg'].head - world @ rig.pose.bones['RightUpLeg'].head).xy
    pivot = (world @ hips.matrix).translation
    turn = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(facing) - math.atan2(left.y, left.x), 4, 'Z') @ Matrix.Translation(-pivot)
    hips.matrix = world.inverted() @ turn @ world @ hips.matrix
    bpy.context.view_layer.update()


def stride(rig, facing, phase):
    """Poses her `phase` radians into a stride (0: feet together, arms down), from the rig's rest turned to face as she
    sits (`facing` degrees from facing -Y): her rest faces elsewhere."""
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    face(rig, facing)
    turn, swing = Matrix.Rotation(math.radians(facing), 3, 'Z'), math.sin(phase)
    ahead = lambda angle, out=0.0: turn @ Vector((out, -math.sin(angle), -math.cos(angle)))
    directions = []
    for side, sign in (('Left', 1), ('Right', -1)):
        leg = 0.5 * swing * sign
        knee = leg - 0.9 * max(0.0, -swing * sign)
        arm = -0.35 * swing * sign
        directions += [(f'{side}UpLeg', ahead(leg)), (f'{side}Leg', ahead(knee)), (f'{side}Foot', ahead(knee + 1.3)),
                       (f'{side}Arm', ahead(arm, 0.15 * sign)), (f'{side}ForeArm', ahead(arm + 0.3, 0.08 * sign)),
                       (f'{side}Hand', ahead(arm + 0.3, 0.08 * sign))]
    posed(rig, directions)


def soles(body):
    """Her lowest vertices (within 3 cm of the lowest), as posed."""
    points = shape(body)
    low = min(co.z for co in points)
    return [co for co in points if co.z < low + 0.03]


def planted(rig, body, spot, feet=False):
    """Moves her hips so her soles touch the floor (z 0) and, with `feet`, so their middle is over `spot` (x, y), else
    so the hips are."""
    hips = rig.pose.bones['Hips']
    world = rig.matrix_world @ hips.matrix
    low = soles(body)
    at = sum((co for co in low), Vector()) / len(low) if feet else world.translation
    hips.matrix = rig.matrix_world.inverted() @ Matrix.Translation((spot.x - at.x, spot.y - at.y, -min(co.z for co in low))) @ world
    bpy.context.view_layer.update()


def girl_actions(rig, body, facing, sip):
    """Her four actions, made from her seated pose (as the rig holds it), `sip` (the sipping bones' rotations) and her
    rig's rest: Idle (1 to 121, the chest rising and falling), Sip (1 to 65, the cup up and down), Walk (a stride, 1 to
    21) and Sit (1 to 25, from standing to seated). The rig's origin is moved to the floor under her seated feet, where
    a game stands her: she walks in place over it with her soles on the floor, and sits down keeping her feet on it."""
    feet = soles(body)
    spot = sum((co for co in feet), Vector()) / len(feet)
    spot.z = 0
    hips = rig.pose.bones['Hips']
    seated_hips = rig.matrix_world @ hips.matrix
    rig.matrix_world = Matrix.Translation(spot - rig.matrix_world.translation) @ rig.matrix_world
    hips.matrix = rig.matrix_world.inverted() @ seated_hips
    bpy.context.view_layer.update()
    seated_pose = rotations(rig)
    data = rig.animation_data_create()
    for track in list(data.nla_tracks):
        data.nla_tracks.remove(track)

    def action(name, keys):
        data.action, keyed = bpy.data.actions.new(name), {}
        for frame, pose, bones in keys:
            key_pose(rig, frame, pose, bones, keyed)
        made, data.action = data.action, None
        return made

    def walking(phase):
        stride(rig, facing, phase)
        planted(rig, body, spot)
        return rotations(rig)

    def sitting(t):
        """Her pose `t` of the way from standing to seated, her feet kept where they are."""
        for bone in rig.pose.bones:
            start, end = standing[bone.name], seated_pose[bone.name]
            if bone.rotation_mode == 'QUATERNION':
                bone.rotation_quaternion = start.slerp(end, t)
            else:
                bone.rotation_euler = Euler([a + (b - a) * t for a, b in zip(start, end)], bone.rotation_mode)
        planted(rig, body, spot, feet=True)
        return rotations(rig)

    breath = dict(seated_pose, Spine2=seated_pose['Spine2'] @ Quaternion((1, 0, 0), math.radians(1.5)))
    idle = action('Idle', [(1, seated_pose, None), (61, breath, None), (121, seated_pose, None)])
    sipping = action('Sip', [(frame, dict(seated_pose, **(sip if up else {})), set(sip)) for frame, up in ((1, False), (23, True), (43, True), (65, False))])
    walk = action('Walk', [(1 + 20 * k / 8, walking(math.tau * k / 8), None) for k in range(9)])
    standing = walking(0.0)
    sit_down = action('Sit', [(1, standing, None), *((1 + 6 * k, sitting(k / 4), None) for k in range(1, 4)), (25, seated_pose, None)])
    for bone in rig.pose.bones:
        setattr(bone, 'rotation_quaternion' if bone.rotation_mode == 'QUATERNION' else 'rotation_euler', seated_pose[bone.name])
    hips.location = seated_pose['Hips location']
    return idle, sipping, walk, sit_down


def girl_track(name, action, start):
    """An NLA track of the tea break's rig playing `action` from `start`."""
    track = drinker_rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, start, action)
    return track


whites = material('Cook Whites', (0.7, 0.66, 0.6), roughness=0.8)

# The window: blinds raised to the top, a worn painted frame and sill.
worn_paint = textured('Weathered Wood', (0.06, 0.035, 0.02), (0.025, 0.015, 0.01), 9, (0.4, 0.85))
with merged('Window Frame'):
    for i in range(4):
        box(f'Blind {i + 1}', (2.76, 0.03, 0.06), (-1.6, 0.22, 2.46 - i * 0.055), worn_paint, (math.radians(-10), 0, 0))
    box('Blind Bar', (2.78, 0.05, 0.03), (-1.6, 0.22, 2.27), worn_paint)
    box('Window Sill', (3.1, 0.25, 0.08), (-1.6, -0.08, 0.96), worn_paint, bevel=0.015)
    for side, x in (('Left', -3.05), ('Right', -0.15)):
        box(f'Window Frame {side}', (0.1, 0.1, 1.5), (x, -0.02, 1.75), worn_paint)
    box('Window Frame Top', (3.0, 0.1, 0.1), (-1.6, -0.02, 2.53), worn_paint)
fog = material('Fogged Glass', (0.8, 0.7, 0.6), roughness=0.5)
fog_nodes = fog.node_tree.nodes
fog_height = fog_nodes.new('ShaderNodeSeparateXYZ')
fog_fade = fog_nodes.new('ShaderNodeMapRange')
fog_fade.inputs['From Min'].default_value, fog_fade.inputs['From Max'].default_value = 1.0, 1.3
fog_fade.inputs['To Min'].default_value, fog_fade.inputs['To Max'].default_value = 0.22, 0.0
fog.node_tree.links.new(fog_nodes.new('ShaderNodeNewGeometry').outputs['Position'], fog_height.inputs['Vector'])
fog.node_tree.links.new(fog_height.outputs['Z'], fog_fade.inputs['Value'])
fog.node_tree.links.new(fog_fade.outputs['Result'], fog_nodes['Principled BSDF'].inputs['Alpha'])
fog.surface_render_method = 'BLENDED'
with merged('Fogged Glass'):
    for side in ((-3.0, -2.215, -1.715, -3.0), (-0.2, -2.185, -1.685, -0.2)):
        outline('Fog', [(side[0], 0.05, 1.0), (side[1], 0.05, 1.0), (side[2], 0.05, 1.6), (side[3], 0.05, 1.6)], fog)
# Paper menu slips taped inside the glass, in the lower corner.
with merged('Menu Slips'):
    for i, (x, z, turn) in enumerate(((-0.45, 1.16, 4), (-0.62, 1.14, -3))):
        box(f'Menu Slip {i + 1}', (0.15, 0.005, 0.2), (x, 0.32, z), slip_paper, (0, math.radians(turn), 0))

# The door: slid open behind the wall, a noren of four indigo panels hanging across the top, each swaying from the rod.
with merged('Noren Rod'):
    box('Door Frame Top', (1.4, 0.12, 0.12), (2.4, -0.04, 2.3), worn_paint)
    cylinder('Noren Rod', 0.015, 1.3, (2.4, -0.12, 2.24), dark_metal, (0, math.pi / 2, 0), 8)
noren = material('Noren', (0.015, 0.025, 0.08), roughness=1.0)
norens = []
for i in range(4):
    drop = 0.85 + wobble.uniform(-0.04, 0.03)
    panel = box(f'Noren {i + 1}', (0.27, 0.012, drop), (1.95 + i * 0.3, -0.12, 2.22 - drop / 2), noren,
                (math.radians(wobble.uniform(-4, 4)), 0, math.radians(wobble.uniform(-2, 2))))
    norens.append(pivoted(panel, (1.95 + i * 0.3, -0.12, 2.22)))
    sway(norens[-1], 2.5, (60, 120))
paper_screen = material('Paper Screen', (1.0, 0.6, 0.28), roughness=0.9, emission=0.3)
paper_screen.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.45
paper_screen.surface_render_method = 'BLENDED'
lamplit = material('Lamplit Wall', (1.0, 0.55, 0.25), emission=2.5)


def room(wall, x, z, w, h, depth=1.1, front=0.0, out=-1):
    """A lit room behind a pane in `wall`: the wall cut open there, a lamp-lit wall `depth` behind it and the pane as
    translucent paper, so what sits between shows through softened."""
    hole = box('Opening', (w, 1.0, h), (x, front, z), None)
    cut = wall.modifiers.new('Opening', 'BOOLEAN')
    cut.operation, cut.object = 'DIFFERENCE', hole
    bpy.context.view_layer.objects.active = wall
    bpy.ops.object.modifier_apply(modifier='Opening')
    bpy.data.objects.remove(hole)
    # The lit wall where the camera's view through the pane lands, wide enough to fill it.
    eye = Vector(EYE)
    ray = (Vector((x, front, z)) - eye).normalized()
    seen = Vector((x, front, z)) + ray * (-out * depth / abs(ray.y))
    box('Room Wall', (w + 2.5, 0.05, h + 1.5), (seen.x, front - out * depth, seen.z), lamplit)
    y = front + out * 0.01
    return outline('Paper Pane', [(x - w / 2, y, z - h / 2), (x + w / 2, y, z - h / 2), (x + w / 2, y, z + h / 2), (x - w / 2, y, z + h / 2)], paper_screen)


with merged('Shop Front'):
    box('Shop Eave', (8.8, 0.75, 0.06), (0.1, -0.37, 2.8), roof_tiles, (math.radians(-14), 0, 0))
    box('Shop Roof Eave', (8.8, 0.5, 0.06), (0.1, -0.25, 6.15), roof_tiles, (math.radians(-14), 0, 0))
    room(upper_wall, -1.6, 4.85, 2.4, 1.0)
    for i in range(9):
        box('Mullion', (0.025, 0.03, 1.0), (-2.8 + i * 0.3, -0.03, 4.85), dark_wood)
    for dz in (-0.5, -0.17, 0.17, 0.5):
        box('Mullion', (2.4, 0.03, 0.025), (-1.6, -0.03, 4.85 + dz), dark_wood)
    box('Air Conditioner', (0.8, 0.45, 0.55), (2.2, -0.23, 4.8), dark_metal, bevel=0.03)
# The lanterns under the eave sway in the wind, each at its own phase.
for i, x in enumerate((-2.7, -1.6, -0.5)):
    sway(lantern(f'Shop Lantern {i + 1}', x, -0.6, 2.35, lantern_paper if i % 2 == 0 else white_lantern, 2.75, 1.25), 2.5)
frosted = material('Frosted Pane', (0.4, 0.26, 0.13), roughness=0.4, emission=0.5)
frosted_low = material('Frosted Pane Low', (0.4, 0.26, 0.13), roughness=0.4, emission=0.3)
box('Kitchen Vent', (0.35, 0.25, 0.3), (3.85, -0.12, 2.3), dark_metal, bevel=0.02)
steam('Vent Steam', 3.85, -0.6, 2.35, 0.8, 1.4, density=5, drift=(-0.15, -0.25))
with merged('Sliding Door'):
    box('Door Frame', (0.6, 0.05, 2.22), (2.67, 0.12, 1.11), worn_paint)
    for dz in (0.55, 1.15, 1.75):
        box('Door Pane', (0.24, 0.02, 0.52), (2.53, 0.1, dz), frosted if dz > 1 else frosted_low)
        box('Door Pane', (0.24, 0.02, 0.52), (2.81, 0.1, dz), frosted if dz > 1 else frosted_low)
    box('Step', (1.3, 0.4, 0.1), (2.4, -0.2, 0.05), timber)
    box('Mat', (0.9, 0.3, 0.012), (2.3, -0.22, 0.106), material('Mat', (0.25, 0.04, 0.03), roughness=1))
sway(lantern('Door Lantern', 1.72, -0.55, 2.25, lantern_paper, 2.75, 1.4), 2.0)
# A paper lightbox beside the door: らーめん in red on lit paper.
box('Lightbox', (0.36, 0.08, 1.3), (1.45, -0.04, 1.95), paper, bevel=0.01)


def lettering(name, text, x, y, z, size, mat, facing=-1):
    """Flat letters written top to bottom on a sign facing -Y (or +Y); the long vowel mark turns upright, as in
    vertical Japanese."""
    with merged(name):
        letters(name, text, x, y, z, size, mat, facing)


def letters(name, text, x, y, z, size, mat, facing):
    for i, char in enumerate(text):
        turn = math.pi / 2 if char == 'ー' else 0
        bpy.ops.object.text_add(location=(x, y, z - i * size * 1.05), rotation=(math.pi / 2, turn, 0 if facing < 0 else math.pi))
        glyph = bpy.context.object
        glyph.data.body, glyph.data.font, glyph.data.size, glyph.data.offset = char, kanji, size, size * 0.02
        glyph.data.align_x, glyph.data.align_y = 'CENTER', 'CENTER'
        finish(glyph, name, mat)
        bpy.ops.object.convert(target='MESH')


with merged('Noren Mark'):
    bpy.ops.object.text_add(location=(2.4, -0.135, 1.85), rotation=(math.pi / 2, 0, 0))
    mark = bpy.context.object
    mark.data.body, mark.data.font, mark.data.size, mark.data.offset = '麺', kanji, 0.42, 0.006
    mark.data.align_x, mark.data.align_y = 'CENTER', 'CENTER'
    finish(mark, 'Noren Mark', material('Noren White', (0.75, 0.72, 0.66), roughness=0.9))
    bpy.ops.object.convert(target='MESH')
# The mark is dyed across the middle two panels: cut at the gap between them, each half sways with its panel.
mark = bpy.data.objects['Noren Mark']
halves = [mark, mark.copy()]
halves[1].data = mark.data.copy()
collection.objects.link(halves[1])
for half, panel, keep in zip(halves, norens[1:3], ('LEFT', 'RIGHT')):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = half
    half.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.bisect(plane_co=(2.395, 0, 0), plane_no=(1, 0, 0), clear_inner=keep == 'RIGHT', clear_outer=keep == 'LEFT', use_fill=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    half.name = f'Noren Mark {keep.title()}'
    half.parent = panel
    half.matrix_parent_inverse = panel.matrix_world.inverted()
lettering('Ramen', 'らーめん', 1.45, -0.085, 2.43, 0.3, material('Lightbox Ink', (0.5, 0.02, 0.01), roughness=0.6))

group('Lane')
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


with merged('Crates'):
    for i, (x, y, z, turn) in enumerate(((-15.6, -0.4, 0, 4), (-15.0, -0.45, 0, -6), (-15.3, -0.4, 0.36, 9))):
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

group('Rain', 'Lane')
# Rain: thin streaks facing the camera, slanted by the wind, faint and soft-ended (alpha a vertical gradient along each
# streak's UV), glossy so they glint where they pass a light; longer and fainter far off, denser there.
rain_streak = bpy.data.materials.new('Rain')
nodes, links = rain_streak.node_tree.nodes, rain_streak.node_tree.links
principled = nodes['Principled BSDF']
principled.inputs['Base Color'].default_value = (0.7, 0.75, 0.8, 1)
principled.inputs['Roughness'].default_value = 0.05
principled.inputs['Emission Color'].default_value = (0.6, 0.65, 0.75, 1)
principled.inputs['Emission Strength'].default_value = 0.08
uv = nodes.new('ShaderNodeUVMap')
along = nodes.new('ShaderNodeSeparateXYZ')
links.new(uv.outputs['UV'], along.inputs['Vector'])
soft = nodes.new('ShaderNodeFloatCurve')
links.new(along.outputs['Y'], soft.inputs['Value'])
points = soft.mapping.curves[0].points
points[0].location, points[1].location = (0, 0), (1, 0)
points.new(0.6, 1.0)
soft.mapping.update()
faint = nodes.new('ShaderNodeAttribute')
faint.attribute_type, faint.attribute_name = 'GEOMETRY', 'opacity'
alpha = nodes.new('ShaderNodeMath')
alpha.operation = 'MULTIPLY'
links.new(soft.outputs['Value'], alpha.inputs[0])
links.new(faint.outputs['Fac'], alpha.inputs[1])
# Drawn only below 6.5 m, where the rain starts: the copy falling in from above shows once it gets there.
height = nodes.new('ShaderNodeSeparateXYZ')
links.new(nodes.new('ShaderNodeNewGeometry').outputs['Position'], height.inputs['Vector'])
below = nodes.new('ShaderNodeMath')
below.operation, below.inputs[1].default_value = 'LESS_THAN', 6.5
links.new(height.outputs['Z'], below.inputs[0])
within = nodes.new('ShaderNodeMath')
within.operation = 'MULTIPLY'
links.new(alpha.outputs[0], within.inputs[0])
links.new(below.outputs[0], within.inputs[1])
links.new(within.outputs[0], principled.inputs['Alpha'])
rain_streak.surface_render_method = 'BLENDED'
streaks = bpy.data.meshes.new('Rain')
verts, faces, opacity = [], [], []
rng = random.Random(7)
eye = Vector(EYE)
RAIN_FALL = 6.6
for k in range(1600):
    x, y, z = rng.uniform(-24.0, 6.0), rng.uniform(-4.4, -0.4), rng.uniform(-0.1, 6.5)
    far = min(1.0, (Vector((x, y, z)) - eye).length / 25)
    # Short: Render Image's motion blur draws them out as they fall.
    length, width = rng.uniform(0.12, 0.22) * (1 + far), 0.004 * (1 + 2 * far)
    # Across the streak, square to the line of sight.
    side = (Vector((x, y, z)) - eye).cross(Vector((0, 0, 1))).normalized() * width
    lean = Vector((0.08 * length, 0, length))
    alpha = rng.uniform(0.12, 0.22) * (1 - 0.5 * far)
    # Twice, one fall apart: as the rain falls through its 6.6 m, the copy above takes its place.
    for lift in (0.0, RAIN_FALL):
        root = Vector((x, y, z + lift))
        n = len(verts)
        verts += [tuple(root - side), tuple(root + side), tuple(root + side + lean), tuple(root - side + lean)]
        faces.append((n, n + 1, n + 2, n + 3))
        opacity += [alpha] * 4
streaks.from_pydata(verts, [], faces)
corners = streaks.uv_layers.new(name='UVMap')
corners.data.foreach_set('uv', [v for _ in faces for v in (0, 0, 1, 0, 1, 1, 0, 1)])
streaks.attributes.new('opacity', 'FLOAT', 'POINT').data.foreach_set('value', opacity)
streaks.materials.append(rain_streak)
rain = bpy.data.objects.new('Rain', streaks)
collection.objects.link(rain)
# A few big drops close to the camera refract what is behind them (EEVEE's raytraced transmission) and glint.
drop_glass = material('Rain Drop', (1, 1, 1), roughness=0.05)
glass = drop_glass.node_tree.nodes['Principled BSDF']
glass.inputs['Transmission Weight'].default_value, glass.inputs['IOR'].default_value = 1.0, 1.33
drop_glass.use_raytrace_refraction = True
with merged('Rain Near') as near:
    for k in range(40):
        x, y, z = rng.uniform(-1.5, 3.0), rng.uniform(-3.0, -2.0), rng.uniform(0.2, 3.2)
        for lift in (0.0, RAIN_FALL):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.006, location=(x, y, z + lift))
            drop = finish(bpy.context.object, 'Drop', drop_glass)
            drop.scale.z = 6
# The rain falls 8 m/s, round and round through its 6.6 m every 20 frames: what motion blur draws as it falls.
for falling in (rain, near['object']):
    looping(falling, 'location', [(1, 0.0), (21, -RAIN_FALL)], index=2, interpolation='LINEAR')


group('Lane')
# Plastic stools under the window, a bucket by the crates and an A-frame menu board.
red_plastic = material('Red Plastic', (0.45, 0.02, 0.02), roughness=0.35)


def stool(name, x, y, z=0.0, height=0.425):
    """A plastic stool at (x, y) standing on z, its seat's top `height` up."""
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.17, radius2=0.13, depth=height - 0.025, location=(x, y, z + (height - 0.025) / 2))
    finish(bpy.context.object, name, red_plastic)
    cylinder('Stool Seat', 0.15, 0.03, (x, y, z + height - 0.015), red_plastic, vertices=16)


with merged('Stools and Board'):
    stool('Stool', -2.75, -0.55)
    stool('Stool', -2.1, -0.7)
    stool('Stool', -2.1, -0.7, 0.18)
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.13, radius2=0.17, depth=0.32, location=(4.15, -0.4, 0.16))
    finish(bpy.context.object, 'Bucket', material('Blue Plastic', (0.02, 0.1, 0.35), roughness=0.4))
    chalkboard = material('Chalkboard', (0.012, 0.02, 0.016), roughness=0.9)
    chalk = material('Chalk', (0.5, 0.48, 0.42), roughness=1, emission=0.15)
    for side in (-1, 1):
        box('A-Frame Board', (0.6, 0.03, 0.9), (1.25, -0.85 + side * 0.1, 0.44), chalkboard, (math.radians(side * 12), 0, 0), bevel=0.01)
    for i, width in enumerate((0.42, 0.3, 0.36, 0.22)):
        box('Chalk Line', (width, 0.005, 0.025), (1.25 - (0.42 - width) / 2, -0.965, 0.72 - i * 0.12), chalk, (math.radians(-12), 0, 0))

group('Street')
# The street: a yokocho of narrow two-storey frontages, timber below and plaster or corrugated metal above, tiled
# eaves, lanterns, vertical signboards and noren; one more izakaya open, a kissa with its shutter half down, others
# shut, warm upstairs windows.
shutter = textured('Shutter', (0.2, 0.19, 0.17), (0.06, 0.06, 0.06), 2, (0.3, 0.6), metallic=0.7, waves=14)
weather(shutter, 0.5, 0.5, rust=(0.2, 0.07, 0.02))
shoji = material('Shoji', (1.0, 0.62, 0.3), emission=0.5)
dark_window = material('Dark Window', (0.01, 0.012, 0.018), roughness=0.08)
dim_shop = material('Dim Shop', (1.0, 0.45, 0.15), emission=0.25)
doorway_glow = material('Doorway Glow', (1.0, 0.5, 0.18), emission=0.7)
red_noren = material('Red Noren', (0.6, 0.04, 0.02), roughness=0.9, emission=0.35)
sign_paper = material('Sign Paper', (1.0, 0.92, 0.75), emission=0.5)
neighbor_lantern = material('Neighbor Lantern', (1.0, 0.12, 0.03), emission=1.1)
neighbor_white = material('Neighbor White Lantern', (1.0, 0.8, 0.55), emission=0.9)
sign_ink = material('Sign Ink', (0.04, 0.02, 0.015), roughness=0.6)


aquarium = material('Aquarium', (0.1, 0.8, 0.65), emission=1.3)
unlit_lantern = material('Unlit Lantern', (0.25, 0.05, 0.03), roughness=0.8)
meter_gray = material('Meter Gray', (0.35, 0.36, 0.34), roughness=0.5)
flyers = [textured(name, a, b, 6, (0.7, 0.9)) for name, a, b in (('Faded Flyer', (0.55, 0.5, 0.4), (0.3, 0.27, 0.2)),
                                                                   ('Red Flyer', (0.45, 0.08, 0.05), (0.3, 0.2, 0.15)),
                                                                   ('Blue Flyer', (0.08, 0.15, 0.35), (0.3, 0.3, 0.3)))]
laundry = [material(name, color, roughness=0.9) for name, color in (('White Towel', (0.7, 0.68, 0.62)), ('Blue Towel', (0.05, 0.12, 0.35)),
                                                                      ('Pink Towel', (0.6, 0.2, 0.25)))]


def frontage(name, x0, x1, kind, height=5.8, upper=weathered_plaster, front=0.0, out=-1, lit=True, sign=None, upstairs=None, dead=None):
    """A narrow two-storey front from x0 to x1, its face at y = front facing out (-1: -Y, +1: +Y): timber below, `upper`
    above, a tiled eave between and one at the top, an upstairs window (shoji, lit or dark), and a ground floor that is
    an open izakaya (a glowing doorway under a lit noren, a row of red and white chochin along the eave, one maybe
    `dead`, a standing lightbox with its name), a shutter half down over a dim glow, or a shutter shut. Flyers, a
    conduit and a meter box on every front; `upstairs`: an aquarium, a jacket drying or laundry."""
    with merged(name):
        frontage_parts(name, x0, x1, kind, height, upper, front, out, lit, sign, upstairs, dead)


def frontage_parts(name, x0, x1, kind, height, upper, front, out, lit, sign, upstairs, dead):
    x, w = (x0 + x1) / 2, x1 - x0

    def at(depth):
        return front + out * depth

    box(f'{name} Lower', (w, 0.3, 2.9), (x, at(-0.15), 1.3), timber)
    wall = box(f'{name} Upper', (w, 0.3, height - 2.75), (x, at(-0.15), (height + 2.75) / 2), upper)
    for z, depth in ((2.85, 0.75), (height, 0.5)):
        box(f'{name} Eave', (w + 0.1, depth, 0.06), (x, at(depth / 2), z), roof_tiles, (math.radians(out * 14), 0, 0))
    if upstairs == 'room':
        room(wall, x, 4.3, min(w - 0.8, 1.8), 1.0, front=front, out=out)
    else:
        box(f'{name} Window', (min(w - 0.8, 1.8), 0.02, 1.0), (x, at(0.01), 4.3), aquarium if upstairs == 'aquarium' else shoji if lit else dark_window)
    for dx in (-0.45, 0, 0.45):
        box('Lattice', (0.03, 0.03, 1.0), (x + dx, at(0.03), 4.3), dark_wood)
    box('Lattice', (min(w - 0.8, 1.8), 0.03, 0.03), (x, at(0.03), 4.3), dark_wood)
    if kind == 'izakaya':
        box(f'{name} Doorway', (1.2, 0.02, 2.1), (x, at(0.01), 1.05), doorway_glow)
        for i in range(3):
            box(f'{name} Noren', (0.38, 0.01, 0.7), (x - 0.4 + i * 0.4, at(0.12), 1.75 + wobble.uniform(-0.04, 0.03)), red_noren,
                (math.radians(wobble.uniform(-6, 6)), 0, math.radians(wobble.uniform(-3, 3))))
        count = int(w / 0.7)
        for i in range(count):
            shade = unlit_lantern if i == dead else neighbor_lantern if i % 3 else neighbor_white
            lantern(f'{name} Lantern', x - (count - 1) * 0.35 + i * 0.7 + wobble.uniform(-0.08, 0.08), at(0.6), 2.4, shade, 2.75, 1.25)
    elif kind == 'half':
        box(f'{name} Inside', (w - 0.4, 0.02, 0.7), (x, at(0.01), 0.35), dim_shop)
        box(f'{name} Shutter', (w - 0.4, 0.06, 1.9), (x, at(0.04), 1.65), shutter)
    else:
        box(f'{name} Shutter', (w - 0.4, 0.06, 2.6), (x, at(0.04), 1.3), shutter)
    if sign:
        text, mat = sign
        tall = len(text) * 0.33 + 0.25
        sx = x1 - 0.45 if out < 0 else x0 + 0.45
        with merged(f'{name} Sign') as standing:
            box(f'{name} Signboard', (0.36, 0.25, tall), (sx, at(0.45), tall / 2 + 0.1), mat, bevel=0.015)
            lettering(f'{name} Letters', text, sx, at(0.58), tall + 0.1 - 0.28, 0.28, sign_ink, out)
        standing['object'].rotation_euler.y = math.radians(wobble.uniform(-2.5, 2.5))
    cylinder('Downpipe', 0.04, height, (x1 - 0.06, at(0.08), height / 2), dark_metal, vertices=8)
    cylinder('Conduit', 0.022, w, (x, at(0.04), 2.68), dark_metal, (0, math.pi / 2, 0), 8)
    box('Meter Box', (0.22, 0.12, 0.3), (x0 + 0.3, at(0.06), 1.75), meter_gray)
    for fx in (x0 + 0.35 + wobble.uniform(0, 0.3), x1 - 1.1 - wobble.uniform(0, 0.3)):
        box('Flyer', (0.24, 0.01, 0.34), (fx, at(0.01), wobble.uniform(1.15, 1.6)), wobble.choice(flyers),
            (0, math.radians(wobble.uniform(-7, 7)), 0))
    if upstairs == 'laundry':
        cylinder('Laundry Pole', 0.015, w - 0.4, (x, at(0.45), 4.95), dark_metal, (0, math.pi / 2, 0), 6)
        for k, tx in enumerate((-0.7, -0.25, 0.3, 0.75)):
            box('Laundry', (0.3, 0.01, 0.5 + 0.1 * (k % 2)), (x + tx, at(0.45), 4.65 - 0.05 * (k % 2)), wobble.choice(laundry),
                (math.radians(wobble.uniform(-5, 5)), 0, 0))


machine_paint = material('Machine Paint', (0.2, 0.22, 0.25), roughness=0.4)
cans = [material(f'{name} Can', hue, 0.4, emission=0.8)
        for name, hue in (('Red', (0.9, 0.1, 0.05)), ('Blue', (0.1, 0.4, 0.9)), ('Yellow', (0.95, 0.7, 0.1)), ('Green', (0.1, 0.6, 0.2)))]
styrofoam_white = material('Styrofoam', (0.75, 0.75, 0.72), roughness=0.9)
clay = material('Clay Pot', (0.25, 0.08, 0.03), roughness=0.8)
leaves = material('Leaves', (0.02, 0.05, 0.015), roughness=0.7)
yellow_plastic = material('Yellow Crate', (0.6, 0.35, 0.02), roughness=0.4)
sold_out = material('Sold Out', (1.0, 0.05, 0.03), emission=3)


def vending(name, x, y, glow, left_can=False):
    box(name, (0.95, 0.7, 1.85), (x, y, 0.925), machine_paint, bevel=0.02)
    box(f'{name} Window', (0.8, 0.02, 0.95), (x, y - 0.36, 1.25), glow)
    for row in range(3):
        for col in range(6):
            box('Can', (0.07, 0.02, 0.14), (x - 0.28 + col * 0.11, y - 0.38, 1.48 - row * 0.3), cans[(row + col * 2) % 4])
    box(f'{name} Slot', (0.5, 0.04, 0.16), (x, y - 0.37, 0.35), rubber)
    for col in range(6):
        box('Sold Out', (0.06, 0.015, 0.02), (x - 0.28 + col * 0.11, y - 0.38, 1.37), sold_out)
    if left_can:
        cylinder('Left Can', 0.033, 0.12, (x + 0.27, y - 0.15, 1.91), material('Left Can', (0.5, 0.05, 0.03), roughness=0.3, metallic=0.6), vertices=12)


def styrofoam(x, y, count):
    for k in range(count):
        box('Styrofoam Box', (0.55, 0.38, 0.22), (x, y, 0.11 + k * 0.22), styrofoam_white, (0, 0, math.radians(k * 7 - 5)))


def plant(x, y, size=1.0):
    cylinder('Pot', 0.16 * size, 0.3 * size, (x, y, 0.15 * size), clay, vertices=12)
    ellipsoid('Plant', (0.25 * size, 0.22 * size, 0.35 * size), (x, y, 0.55 * size), leaves)


def beer_crates(x, y, count):
    for k in range(count):
        box('Beer Crate', (0.45, 0.33, 0.3), (x, y, 0.15 + k * 0.3), yellow_plastic, (0, 0, math.radians(k * 9 - 4)))


# Our side, down the street.
frontage('Kissa', -7.6, -4.9, 'half', upper=corrugated, upstairs='room', sign=('喫茶', material('Kissa Sign', (0.8, 0.65, 0.4), emission=0.35)))
frontage('Yakitori', -11.2, -7.6, 'izakaya', sign=('やきとり', sign_paper), dead=3)
frontage('Shut', -14.2, -11.2, 'shut', upper=corrugated, upstairs='aquarium')
frontage('Izakaya', -17.8, -14.2, 'izakaya', height=6.2, sign=('居酒屋', sign_paper))
frontage('Second Kissa', -21.0, -17.8, 'half', upper=corrugated)
frontage('Bar', -25.0, -21.0, 'izakaya', sign=('酒', sign_paper))
frontage('End', -30.0, -25.0, 'izakaya', lit=False)
frontage('Corner', 4.4, 8.0, 'shut', upper=corrugated, lit=False)
frontage('Corner 2', 8.0, 12.0, 'half')
# The near side of the lane, across from the shop. Each front is an object of its own, so it is lit by the few lights
# near it.
signs = ('酒', 'やきとり', '居酒屋')
for i, (x0, x1, kind) in enumerate(((-30, -26, 'izakaya'), (-26, -22, 'half'), (-22, -18.5, 'izakaya'), (-18.5, -15, 'shut'),
                                    (-15, -11, 'izakaya'), (-11, -7.5, 'half'), (-7.5, -4, 'izakaya'), (-4, 0, 'half'), (0, 4, 'shut'))):
    frontage(f'Near {i + 1}', x0, x1, kind, height=5.8 + (i % 3) * 0.4, upper=corrugated if i % 2 else weathered_plaster,
             front=-4.8, out=1, lit=i % 3 != 1, sign=(signs[i % 3], sign_paper) if kind == 'izakaya' else None,
             upstairs='laundry' if i in (1, 6) else None)
with merged('Vending Machines'):
    vending('Vending Machine', -7.0, -0.42, material('Vending Glow', (0.55, 0.75, 1.0), emission=0.5), left_can=True)
    vending('Far Vending Machine', -12.2, -0.42, material('Far Vending Glow', (0.9, 0.95, 1.0), emission=0.7))
# Clutter: styrofoam boxes, potted plants, beer crates, a scooter at the curb.
with merged('Clutter'):
    styrofoam(-8.0, -0.4, 3)
    styrofoam(-10.6, -0.45, 2)
    for x, size in ((-3.75, 1.0), (-11.0, 1.2), (-14.4, 0.9)):
        plant(x, -0.35, size)
    beer_crates(-13.7, -0.4, 4)
    beer_crates(-13.2, -0.45, 2)
    scooter_paint = material('Scooter Paint', (0.25, 0.45, 0.4), roughness=0.3)
    for x in (-7.3, -6.2):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.2, minor_radius=0.06, major_segments=24, minor_segments=8,
                                         location=(x, -1.55, 0.05), rotation=(math.pi / 2, 0, 0))
        finish(bpy.context.object, 'Scooter Wheel', rubber)
    box('Scooter Body', (0.95, 0.32, 0.3), (-6.95, -1.55, 0.33), scooter_paint, bevel=0.1)
    box('Scooter Seat', (0.6, 0.28, 0.1), (-7.0, -1.55, 0.53), rubber, bevel=0.04)
    box('Scooter Shield', (0.14, 0.4, 0.75), (-6.35, -1.55, 0.55), scooter_paint, (0, math.radians(-15), 0), bevel=0.05)
    curve('Scooter Handlebar', [(-6.25, -1.9, 0.95), (-6.3, -1.55, 0.97), (-6.25, -1.2, 0.95)], chrome, 0.015)
# A utility pole with a transformer and signs, and power lines tangled between it, the next pole and the eaves.
soil = material('Soil', (0.03, 0.02, 0.015), roughness=1)
tomato = material('Tomato', (0.6, 0.05, 0.02), roughness=0.3)
old_chopstick = material('Old Chopstick', (0.35, 0.25, 0.14), roughness=0.7)
bottle_glass = material('Bottle Glass', (0.12, 0.05, 0.01), roughness=0.1)
tape = material('Gray Tape', (0.3, 0.3, 0.3), roughness=0.6)
with merged('Leftovers'):
    # Herbs and a leggy tomato in a styrofoam fish box, staked with old chopsticks, under the window and by the yakitori.
    for gx, gy in ((-1.3, -0.3), (-9.0, -0.35)):
        box('Fish Box', (0.6, 0.4, 0.26), (gx, gy, 0.13), styrofoam_white)
        box('Soil', (0.54, 0.34, 0.02), (gx, gy, 0.25), soil)
        for hx in (-0.18, 0.0, 0.17):
            ellipsoid('Herbs', (0.1, 0.09, 0.08), (gx + hx, gy + wobble.uniform(-0.05, 0.05), 0.3), leaves)
        stem = [(gx + 0.12 + 0.05 * math.sin(t * 2.0), gy, 0.26 + t * 0.14) for t in range(7)]
        curve('Tomato Stem', stem, leaves, 0.008)
        for sx, sz in ((0.08, 0.6), (0.17, 0.82), (0.1, 0.95)):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.025, location=(gx + sx, gy - 0.03, sz))
            finish(bpy.context.object, 'Tomato', tomato)
        for cx in (0.05, 0.2):
            box('Chopstick Stake', (0.008, 0.008, 0.85), (gx + cx, gy + 0.02, 0.6), old_chopstick,
                (0, math.radians(wobble.uniform(-6, 6)), 0))
    # A mop beside the bucket, a delivery box on the scooter, umbrellas at the yakitori's door, empty bottles.
    cylinder('Mop', 0.015, 1.3, (4.0, -0.25, 0.63), material('Mop Handle', (0.1, 0.3, 0.15), roughness=0.4), (math.radians(-12), math.radians(4), 0), 8)
    box('Mop Head', (0.25, 0.12, 0.1), (4.0, -0.4, 0.05), styrofoam_white)
    box('Delivery Box', (0.42, 0.4, 0.36), (-7.4, -1.55, 0.78), material('Delivery Red', (0.45, 0.03, 0.02), roughness=0.4), bevel=0.02)
    for name, ux, color in (('Clear Umbrella', -8.45, (0.7, 0.72, 0.75)), ('Navy Umbrella', -8.3, (0.02, 0.03, 0.1))):
        bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.01, radius2=0.06, depth=0.8, location=(ux, -0.2, 0.42),
                                        rotation=(math.radians(-8), math.radians(ux * 20 % 9), 0))
        finish(bpy.context.object, name, material(name, color, roughness=0.3))
    for k in range(5):
        cylinder('Bottle', 0.035, 0.28, (-12.9 + k * 0.09, -0.75 + wobble.uniform(-0.05, 0.05), 0.14),
                 bottle_glass, vertices=10)
    # An orange extension cord from the ramen bar across the lane to the neighbor's lightbox, taped down twice,
    # sagging into the puddle.
    cord = [(1.7, -0.02, 0.4), (1.6, -0.15, 0.01), (1.0, -1.05, 0.01), (0.85, -1.3, -0.14), (0.3, -2.2, -0.14),
            (-0.3, -2.75, -0.16), (-1.0, -3.4, -0.14), (-1.6, -3.95, -0.14), (-1.75, -4.1, 0.01), (-3.3, -4.3, 0.02), (-3.45, -4.32, 0.15)]
    curve('Extension Cord', cord, material('Orange Cord', (0.8, 0.22, 0.02), roughness=0.5), 0.012)
    for tx, ty, tz, turn in ((1.3, -0.6, 0.012, 40), (-1.0, -3.4, -0.128, 45)):
        box('Tape', (0.14, 0.05, 0.004), (tx, ty, tz), tape, (0, 0, math.radians(turn)))
    # Upstairs over the bar, the cook's white jacket hung to dry.
    box('Jacket', (0.42, 0.04, 0.55), (0.0, -0.18, 4.75), whites, (0, math.radians(3), 0))
    for side in (-1, 1):
        box('Jacket Sleeve', (0.1, 0.04, 0.42), (side * 0.27, -0.18, 4.78), whites, (0, math.radians(side * -12), 0))
    curve('Hanger', [(-0.2, -0.18, 5.05), (0.0, -0.18, 5.12), (0.2, -0.18, 5.05)], chrome, 0.006)
    cylinder('Drying Rod', 0.012, 1.2, (0.0, -0.18, 5.13), dark_metal, (0, math.pi / 2, 0), 6)
# The cook on a smoke break in the gap beside the bar, on an upturned crate, face lit by a phone.
with merged('Gap'):
    for gx in (-4.85, -4.25):
        box('Gap Wall', (0.1, 0.9, 6.0), (gx, 0.45, 2.85), corrugated)
    box('Gap Back', (0.7, 0.1, 6.0), (-4.55, 0.9, 2.85), weathered_plaster)
beer_crates(-4.55, 0.5, 1)
with merged('Poles and Lines'):
    pole_concrete = material('Pole Concrete', (0.18, 0.18, 0.17), roughness=0.8)
    transformer_gray = material('Transformer Gray', (0.3, 0.32, 0.3), roughness=0.5)
    for px in (-5.9, -19.0):
        cylinder('Utility Pole', 0.14, 9.0, (px, -1.0, 4.5), pole_concrete, vertices=12)
        box('Crossarm', (0.08, 1.4, 0.1), (px, -1.0, 8.2), dark_metal)
        cylinder('Transformer', 0.22, 0.6, (px + 0.3, -1.0, 6.8), transformer_gray, vertices=12)
    box('Pole Sign', (0.06, 0.32, 1.1), (-5.9, -1.15, 2.6), material('Pole Sign Yellow', (0.7, 0.5, 0.05), roughness=0.6))
    box('Pole Sign', (0.06, 0.28, 0.8), (-5.9, -0.85, 3.6), material('Pole Sign Blue', (0.03, 0.1, 0.35), roughness=0.6))
    lines = [((-5.9, -0.4, 8.2), (-19.0, -0.4, 8.2), 0.6), ((-5.9, -1.6, 8.2), (-19.0, -1.6, 8.2), 0.7),
             ((-5.9, -1.0, 7.6), (-19.0, -1.0, 7.6), 0.9), ((-5.9, -0.4, 8.2), (4.3, -0.1, 6.0), 0.8),
             ((-5.9, -1.6, 8.2), (6.0, -4.7, 6.4), 1.0), ((-5.9, -1.0, 7.6), (-9.0, -0.1, 5.6), 0.4),
             ((-5.9, -1.0, 7.6), (-4.0, -4.7, 5.9), 0.6), ((-19.0, -1.0, 7.6), (-15.0, -0.1, 6.0), 0.4),
             ((-19.0, -1.0, 7.6), (-23.0, -4.7, 5.9), 0.5), ((-5.9, -1.6, 8.2), (2.0, -0.1, 6.1), 1.4)]
    for i, (start, end, sag) in enumerate(lines):
        points = [tuple(a + (b - a) * t for a, b in zip(start, end)) for t in (0, 0.25, 0.5, 0.75, 1)]
        points = [(x, y, z - sag * 4 * t * (1 - t)) for (x, y, z), t in zip(points, (0, 0.25, 0.5, 0.75, 1))]
        curve(f'Power Line {i + 1}', points, rubber, 0.012)

group('People')
# People, by implication: shadows on the shoji, the cook and a customer behind the glass, one person outside on a
# tea break.


def simple_bike(name, x, y, facing, lamp=False):
    """A bicycle along its local Y: two wheels, a frame, a handlebar and, lit, a headlamp."""
    with merged(name) as group:
        for wy in (-0.5, 0.5):
            bpy.ops.mesh.primitive_torus_add(major_radius=0.32, minor_radius=0.025, major_segments=24, minor_segments=6,
                                             location=(0, wy, 0.33), rotation=(0, math.pi / 2, 0))
            finish(bpy.context.object, 'Wheel', rubber)
        for a, b in (((0, -0.5, 0.33), (0, -0.05, 0.75)), ((0, -0.05, 0.75), (0, 0.4, 0.8)), ((0, 0.4, 0.8), (0, 0.5, 0.33)),
                     ((0, -0.5, 0.33), (0, 0.0, 0.35)), ((0, 0.0, 0.35), (0, -0.05, 0.75)), ((0, 0.4, 0.8), (0, 0.38, 0.98))):
            curve('Bike Tube', [a, b], dark_metal, 0.02, smooth=False)
        curve('Handlebar', [(-0.25, 0.36, 0.98), (0.25, 0.36, 0.98)], dark_metal, 0.015, smooth=False)
        if lamp:
            cylinder('Bike Lamp', 0.035, 0.05, (0, 0.47, 0.9), material('Bike Lamp', (1.0, 0.95, 0.8), emission=12), (math.pi / 2, 0, 0), 10)
    group['object'].matrix_world = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(math.radians(facing), 4, 'Z')


with merged('Passers-by'):
    # Under the noren, empty stools: a bag at one's foot, an umbrella leaning on the other.
    box('Bag', (0.32, 0.14, 0.24), (1.85, 1.05, 0.27), material('Leather Bag', (0.12, 0.05, 0.02), roughness=0.5), (0, 0, math.radians(12)), bevel=0.02)
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.012, radius2=0.055, depth=0.8, location=(2.42, 1.0, 0.42), rotation=(0, math.radians(-14), 0))
    finish(bpy.context.object, 'Leaning Umbrella', umbrellas[1])
# People in the lit rooms, seen as soft shapes: the same model seated behind paper or fogged glass, between it and
# the room's light, cut by the window frame (rooms(), frontage()).
# Turned three-quarters away, toward the bar's window, so the window rims the outline.


# A diner behind the bar's window, a dark shape against its lit wall, traced as
# filled 2D Bezier curves in profile (facing +X, meters, the feet or the hips at 0), about 7.5 heads tall, arms and
# held things as tubes.
HEAD = [(-0.055, 0.0), (-0.085, 0.035), (-0.115, 0.09), (-0.11, 0.16), (-0.07, 0.205), (0.0, 0.225), (0.06, 0.2),
        (0.085, 0.16), (0.092, 0.12), (0.118, 0.088), (0.096, 0.072), (0.1, 0.052), (0.078, 0.03), (0.045, 0.022),
        (0.035, 0.0)]
SEATED = [(-0.13, 0.0), (-0.14, 0.2), (-0.12, 0.42), (-0.08, 0.55), (-0.06, 0.6), (0.035, 0.6), (0.045, 0.57),
          (0.085, 0.53), (0.1, 0.44), (0.09, 0.28), (0.1, 0.06), (0.14, 0.04), (0.42, 0.06), (0.47, 0.01), (0.45, -0.05),
          (0.42, -0.4), (0.49, -0.45), (0.49, -0.47), (0.35, -0.47), (0.36, -0.1), (0.02, -0.08), (-0.12, -0.05)]


def placed(points, x=0.0, z=0.0, turn=0.0):
    """Points turned `turn` degrees (positive tips them back) about the origin, then moved to (x, z)."""
    c, s = math.cos(math.radians(turn)), math.sin(math.radians(turn))
    return [(x + px * c - pz * s, z + px * s + pz * c) for px, pz in points]


def ellipse(cx, cz, rx, rz, steps=12):
    return [(cx + rx * math.cos(a), cz + rz * math.sin(a)) for a in (i * math.tau / steps for i in range(steps))]


def filled(points, mat):
    """A closed, filled 2D Bezier curve through the points, standing in the local XZ plane."""
    data = bpy.data.curves.new('Silhouette', 'CURVE')
    data.dimensions, data.fill_mode, data.resolution_u = '2D', 'BOTH', 8
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for point, (px, pz) in zip(spline.bezier_points, points):
        point.co = (px, pz, 0)
        point.handle_left_type = point.handle_right_type = 'AUTO'
    spline.use_cyclic_u = True
    data.materials.append(mat)
    obj = bpy.data.objects.new('Silhouette', data)
    obj.rotation_euler = (math.pi / 2, 0, 0)
    collection.objects.link(obj)
    return obj


def silhouette(name, fills, tubes, mat, x, y, z, facing, mirror=False, within=None, pivot=(0.0, 0.0)):
    """One figure from its filled outlines and its (points, radius) tubes, set at (x, y, z) with its plane turned
    `facing` degrees about Z; mirrored, it faces -X. `within` (x0, x1, z0, z1) cuts it to a pane, as a shadow on it.
    Its origin is at `pivot` (in the figure's plane), what it turns about."""
    with merged(name) as group:
        for points in fills:
            filled(points, mat)
        for points, radius in tubes:
            curve('Limb', [(px, 0, pz) for px, pz in points], mat, radius)
    figure = group['object']
    bpy.ops.object.select_all(action='DESELECT')
    figure.select_set(True)
    bpy.context.view_layer.objects.active = figure
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    figure.data.transform(Matrix.Translation((-pivot[0], 0, -pivot[1])))
    flip = -1 if mirror else 1
    figure.location = Vector((x, y, z)) + Matrix.Rotation(math.radians(facing), 3, 'Z') @ Vector((flip * pivot[0], 0, pivot[1]))
    figure.rotation_euler.z, figure.scale.x = math.radians(facing), flip
    if within:
        x0, x1, z0, z1 = within
        pane = box('Pane', (x1 - x0, 1, z1 - z0), ((x0 + x1) / 2, y, (z0 + z1) / 2), None)
        cut = figure.modifiers.new('Pane', 'BOOLEAN')
        cut.operation, cut.object = 'INTERSECT', pane
        bpy.context.view_layer.objects.active = figure
        bpy.ops.object.modifier_apply(modifier='Pane')
        bpy.data.objects.remove(pane)
    return figure


def eating():
    """Seated, a bowl raised to the chin; apart, the forearm with chopsticks lifting noodles to the mouth, from the
    elbow."""
    fills = [SEATED, placed(HEAD, 0.0, 0.6, -10), ellipse(0.19, 0.645, 0.085, 0.045)]
    tubes = [([(0.0, 0.55), (0.07, 0.38), (0.16, 0.6)], 0.042), ([(-0.03, 0.55), (0.1, 0.43)], 0.04)]
    forearm = [([(0.1, 0.43), (0.21, 0.74)], 0.04), ([(0.3, 0.79), (0.1, 0.705)], 0.005), ([(0.31, 0.77), (0.11, 0.695)], 0.005)]
    return fills, tubes, forearm


ink = material('Silhouette', (0.006, 0.005, 0.005), roughness=0.7)
# Facing away from the woman outside, so the two do not mirror each other.
fills, tubes, forearm = eating()
silhouette('Eating', fills, tubes, ink, -2.6, 1.0, 1.05, 47, mirror=True)
# Once a loop the chopsticks come up to the mouth, slowly, and go back down.
lifting = silhouette('Eating Forearm', [], forearm, ink, -2.6, 1.0, 1.05, 47, mirror=True, pivot=(0.1, 0.43))
looping(lifting, 'rotation_euler', [(1, 0), (60, 0), (84, math.radians(12)), (110, math.radians(12)), (130, 0), (1 + LOOP, 0)], index=1)

def behind(pane, depth, seat=0.46):
    """Where to seat someone `depth` behind a pane so that, seen from the camera, the head shows near `pane` (a point
    on it): the camera's line through that point, followed into the room, the hips below it."""
    eye = Vector(EYE)
    ray = (Vector(pane) - eye).normalized()
    head = Vector(pane) + ray * (depth / ray.y)
    return head.x, head.y, head.z - 0.75 - seat


# Two people upstairs, seen as soft shapes through the paper: the same model, seated, its head and shoulders cut by
# the window's frame.
for name, pane, depth, facing in (('Upstairs Kissa', (-6.0, 0.0, 4.25), 0.4, 90), ('Upstairs Bar', (-1.9, 0.0, 4.7), 0.45, -90)):
    x, y, floor = behind(pane, depth)
    seated(name, 'animated-woman.glb', x, y, facing, 0.46, floor=floor)
# A woman on a tea break, in muted colours: a dusty rose knit top, washed denim, brown hair, tan shoes.
TEA_BREAK = {(0.91, 0.4, 0.36): (0.55, 0.4, 0.39), (0.94, 0.28, 0.18): (0.42, 0.36, 0.3), (0.82, 0.76, 0.44): (0.18, 0.11, 0.07),
             (0.38, 0.53, 0.83): (0.25, 0.34, 0.5), (0.91, 0.74, 0.57): (0.84, 0.64, 0.52)}
drinker, cup_at, crown, seat_top, drinker_rig, sip = seated('Tea Break', 'animated-woman.glb', -0.35, -0.6, 140, 0.5,
                                                             palette=TEA_BREAK, rigged=True)
stool('Low Stool', -0.35, -0.6, height=seat_top)
tea_cup = cylinder('Tea Cup', 0.045, 0.1, tuple(cup_at), material('Tea Cup', (0.55, 0.45, 0.35), roughness=0.4), vertices=14)
tea_steam = steam('Tea Steam', cup_at.x, cup_at.y, cup_at.z + 0.05, 0.14, 0.3, density=4)
# The cup in her left hand (the steam over it), so it follows the hand.
for child, parent, bone in ((tea_cup, drinker_rig, 'LeftHand'), (tea_steam, tea_cup, '')):
    bpy.context.view_layer.update()
    matrix = child.matrix_world.copy()
    child.parent, child.parent_type, child.parent_bone = parent, 'BONE' if bone else 'OBJECT', bone
    bpy.context.view_layer.update()
    child.matrix_world = matrix
# Her actions, each a clip of its own: Idle (she breathes slowly as she sits), Sip (the cup to her lips), and Walk and
# Sit for a game to play. The scene plays Idle twice a loop and, once a loop, Sip over it, as NLA strips.
idle, sipping, walk, sit_down = girl_actions(drinker_rig, drinker, 140, sip)
girl_track('Idle', idle, 1).strips[0].repeat = 2
girl_track('Sip', sipping, 150).strips[0].extrapolation = 'NOTHING'
for action in (walk, sit_down):
    girl_track(action.name, action, 1).mute = True
# Her rig hidden in the viewport (H), as an animator leaves it: her body and cup still follow its bones.
drinker_rig.hide_set(True)
group('Lane')
simple_bike('Parked Bicycle', -5.4, -0.55, 92, lamp=True)
# Ripples in the puddles where the rain lands: each ring rises out of the water, spreads and sinks back, over and over.
ripple = material('Ripple', (0.15, 0.16, 0.18), roughness=0.2)
for i in range(14):
    rx, ry = wobble.choice(((0.5, -2.6), (3.8, -3.2), (-4.5, -2.4)))
    bpy.ops.mesh.primitive_torus_add(major_radius=wobble.uniform(0.03, 0.1), minor_radius=0.003, major_segments=20, minor_segments=4,
                                     location=(rx + wobble.uniform(-1.2, 1.2), ry + wobble.uniform(-0.4, 0.4), -0.145))
    ring = finish(bpy.context.object, f'Ripple {i + 1}', ripple)
    period = breeze.choice((24, 30, 40, 48))
    start = 1 - breeze.uniform(0, period)
    for axis in (0, 1):
        looping(ring, 'scale', [(start, 0.3), (start + period, 1.6)], index=axis, interpolation='LINEAR')
    looping(ring, 'location', [(start, -0.152), (start + 3, -0.145), (start + 0.7 * period, -0.145), (start + period, -0.152)], index=2,
            interpolation='LINEAR')


def light(name, kind, color, energy, location, radius=0.1, rotation=(0, 0, 0), specular=1.0, shadow=False):
    """A light; only the few whose shadows show cast them (each shadow costs a realtime view its maps)."""
    data = bpy.data.lights.new(name, kind)
    data.color, data.energy, data.use_shadow = color, energy, shadow
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


group('Sign')
# The tubes' light: panels facing the wall, so the puddles see only their backs; no highlights on the backplate.
glow = (math.pi / 2, 0, 0)
light('Magenta Light', 'AREA', (1, 0.08, 0.45), 140, (0.7, -0.6, 3.7), (2.6, 1.0), glow, specular=0).data.shape = 'RECTANGLE'
light('Cyan Light', 'AREA', (0.1, 0.65, 1), 50, (-1.0, -0.5, 3.6), (0.8, 0.8), glow, specular=0)
group('Bar')
# The window's and the door's light on the street (no highlights of their own: the puddles mirror the openings), a
# cold moon from above and a street lamp off to the right.
light('Window Light', 'POINT', (1, 0.45, 0.15), 260, (-1.6, -0.45, 0.5), 0.6, specular=0, shadow=True)
# A little of the window's light low on her shins, from the side the camera does not see.
light('Shin Rim', 'POINT', (1, 0.55, 0.25), 25, (-0.85, -0.35, 0.3), 0.15, specular=0.3)
light('Door Light', 'POINT', (1, 0.45, 0.15), 160, (2.0, -1.7, 0.4), 0.5, specular=0)
# The bar's own light: one over the counter, one inside the doorway; and the vending machine's cold glow.
light('Bar Light', 'POINT', (1, 0.6, 0.3), 200, (-3.5, 1.9, 2.5), 0.4, shadow=True)
light('Doorway Light', 'POINT', (1, 0.5, 0.2), 80, (2.0, 0.8, 1.2), 0.3)
group('Street')
light('Vending Light', 'POINT', (0.6, 0.8, 1), 25, (-7.0, -1.6, 1.3), 0.4, specular=0)
light('Yakitori Light', 'POINT', (1, 0.4, 0.12), 110, (-9.4, -0.9, 1.8), 0.5, specular=0)
light('Izakaya Light', 'POINT', (1, 0.45, 0.15), 90, (-16.0, -0.9, 1.8), 0.5, specular=0)
light('Far Izakaya Light', 'POINT', (1, 0.42, 0.14), 60, (-2.0, -3.9, 1.8), 0.5, specular=0)
light('Far End Light', 'POINT', (1, 0.45, 0.16), 220, (-24.0, -2.4, 2.6), 1.0, specular=0)
# Fill for the realtime engines, which bounce no light: warm light under the eaves onto the sidewalks, and a dim warm
# bounce from the wet lane up onto the fronts and the eaves' undersides.
down, up = (0, 0, 0), (math.pi, 0, 0)
group('Bar')
light('Bar Eave Light', 'AREA', (1, 0.5, 0.2), 160, (0.1, -0.55, 2.55), (8.0, 0.6), down, specular=0).data.shape = 'RECTANGLE'
group('Street')
light('Lane Eave Light', 'AREA', (1, 0.45, 0.18), 260, (-14.0, -0.55, 2.55), (20.0, 0.6), down, specular=0).data.shape = 'RECTANGLE'
group('Lane')
light('Lane Bounce', 'AREA', (1, 0.5, 0.3), 120, (-8.0, -2.4, 0.1), (26.0, 3.0), up, specular=0).data.shape = 'RECTANGLE'
group('City')
light('Moon', 'SUN', (0.35, 0.5, 1), 0.08, (0, 0, 10), 0.1, (math.radians(35), math.radians(-20), 0))

# The city beyond: megastructure towers far behind the lane's roofs, dark with sparse lit windows, red warning lights
# and tall video ads, half lost in banks of fog.
def gradient_ad(name, low, high, strength):
    """A video ad's glow: a vertical Gradient Texture between two colors, as emission."""
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    principled = nodes['Principled BSDF']
    principled.inputs['Base Color'].default_value = (0, 0, 0, 1)
    coord, mapping, gradient, mix = nodes.new('ShaderNodeTexCoord'), nodes.new('ShaderNodeMapping'), nodes.new('ShaderNodeTexGradient'), nodes.new('ShaderNodeMix')
    mapping.inputs['Rotation'].default_value = (0, -math.pi / 2, 0)
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value, mix.inputs['B'].default_value = (*low, 1), (*high, 1)
    links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], gradient.inputs['Vector'])
    links.new(gradient.outputs['Fac'], mix.inputs['Factor'])
    links.new(mix.outputs['Result'], principled.inputs['Emission Color'])
    principled.inputs['Emission Strength'].default_value = strength
    return mat


def fog_card(name, density, glow=1.0):
    """Haze: a pale card whose Alpha is a Noise Texture thinning upward, so the towers fade in and out behind it."""
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    principled = nodes['Principled BSDF']
    principled.inputs['Base Color'].default_value = (0.02, 0.025, 0.04, 1)
    principled.inputs['Emission Color'].default_value = (0.06, 0.05, 0.08, 1)
    principled.inputs['Emission Strength'].default_value = glow
    coord, noise, ramp = nodes.new('ShaderNodeTexCoord'), nodes.new('ShaderNodeTexNoise'), nodes.new('ShaderNodeMapRange')
    noise.inputs['Scale'].default_value, noise.inputs['Detail'].default_value = 2.5, 4
    ramp.inputs['From Min'].default_value, ramp.inputs['From Max'].default_value = 0.35, 0.7
    ramp.inputs['To Max'].default_value = density
    links.new(coord.outputs['Generated'], noise.inputs['Vector'])
    links.new(noise.outputs['Fac'], ramp.inputs['Value'])
    # Thinning out upward, so a bank has no edge.
    height, thin = nodes.new('ShaderNodeSeparateXYZ'), nodes.new('ShaderNodeFloatCurve')
    links.new(coord.outputs['Generated'], height.inputs['Vector'])
    links.new(height.outputs['Z'], thin.inputs['Value'])
    points = thin.mapping.curves[0].points
    points[0].location, points[1].location = (0, 1), (1, 0)
    points[1].handle_type = 'AUTO'
    thin.mapping.update()
    alpha = nodes.new('ShaderNodeMath')
    alpha.operation = 'MULTIPLY'
    links.new(ramp.outputs['Result'], alpha.inputs[0])
    links.new(thin.outputs['Value'], alpha.inputs[1])
    links.new(alpha.outputs[0], principled.inputs['Alpha'])
    mat.surface_render_method = 'BLENDED'
    return mat


ads = [gradient_ad('Ad Teal', (0.0, 0.25, 0.3), (0.1, 0.9, 0.8), 0.6), gradient_ad('Ad Magenta', (0.3, 0.0, 0.2), (1.0, 0.2, 0.6), 0.6),
       gradient_ad('Ad Amber', (0.35, 0.1, 0.0), (1.0, 0.6, 0.15), 0.5)]
city = random.Random(5)


def toward(yaw, distance):
    """A ground point `distance` meters from the camera, `yaw` degrees left of the lane's +Y, and the turn about Z that
    faces a card there back at the camera."""
    turn = math.radians(yaw)
    return (EYE[0] - distance * math.sin(turn), EYE[1] + distance * math.cos(turn)), turn


def card(name, yaw, distance, width, bottom, top, mat):
    """A flat card facing the camera, `width` wide from `bottom` to `top` meters up."""
    (x, y), turn = toward(yaw, distance)
    c, s_ = math.cos(turn), math.sin(turn)
    corners = [(-width / 2, bottom), (width / 2, bottom), (width / 2, top), (-width / 2, top)]
    return outline(name, [(x + u * c, y + u * s_, z) for u, z in corners], mat)


# The city's glow over the roofs to the left and at the lane's far end: light pollution from teal low to magenta,
# fading into the night sky.
# The city beyond, far and vast: megastructure towers 0.5 to 2 km off, several hundred meters tall, built by a
# Geometry Nodes group, lit as a city reads at that distance (floor bands, dark sections, edge strips, a fine noise of
# windows) and mostly lost in haze; a sky glowing from below, a cloud deck the tallest pierce, fog banks between; an
# arcology rising into the clouds and an airship drifting by with an ad.
def haze(nodes, links, color_socket, near=700.0, far=2800.0, most=0.97):
    """Fades a color toward the night's haze with the distance from the camera."""
    camera = nodes.new('ShaderNodeCameraData')
    fade = nodes.new('ShaderNodeMapRange')
    fade.inputs['From Min'].default_value, fade.inputs['From Max'].default_value = near, far
    fade.inputs['To Min'].default_value, fade.inputs['To Max'].default_value = 0.3, most
    links.new(camera.outputs['View Distance'], fade.inputs['Value'])
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['B'].default_value = (0.045, 0.025, 0.06, 1)
    links.new(fade.outputs['Result'], mix.inputs['Factor'])
    links.new(color_socket, mix.inputs['A'])
    return mix.outputs['Result'], fade.outputs['Result']


def tower_material():
    """A distant tower's light: thin floor bands at irregular heights, vertical strips at some corners and columns, a fine
    noise of windows in lit sections, warm or cool, all fading into the haze; the facade itself dark."""
    mat = bpy.data.materials.new('City Tower')
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    principled = nodes['Principled BSDF']
    principled.inputs['Roughness'].default_value = 0.8
    geometry = nodes.new('ShaderNodeNewGeometry')
    parts = nodes.new('ShaderNodeSeparateXYZ')
    links.new(geometry.outputs['Position'], parts.inputs['Vector'])

    def op(kind, *inputs):
        n = nodes.new('ShaderNodeMath')
        n.operation = kind
        for i, value in enumerate(inputs):
            if isinstance(value, (int, float)):
                n.inputs[i].default_value = value
            else:
                links.new(value, n.inputs[i])
        return n.outputs[0]

    def noise_at(vector, scale, detail=2):
        n = nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value, n.inputs['Detail'].default_value = scale, detail
        links.new(vector, n.inputs['Vector'])
        return n.outputs['Fac']

    def white(*values):
        combine = nodes.new('ShaderNodeCombineXYZ')
        for i, value in enumerate(values):
            if isinstance(value, (int, float)):
                combine.inputs[i].default_value = value
            else:
                links.new(value, combine.inputs[i])
        n = nodes.new('ShaderNodeTexWhiteNoise')
        links.new(combine.outputs['Vector'], n.inputs['Vector'])
        return n.outputs['Value']

    floor = op('FLOOR', op('DIVIDE', parts.outputs['Z'], 4.0))
    column = op('FLOOR', op('DIVIDE', op('ADD', parts.outputs['X'], parts.outputs['Y']), 12.0))
    # Floor bands: a floor lit right across now and then, thin.
    bands = op('MULTIPLY', op('GREATER_THAN', white(floor, op('FLOOR', op('DIVIDE', parts.outputs['X'], 300))), 0.93),
               op('LESS_THAN', op('FRACT', op('DIVIDE', parts.outputs['Z'], 4.0)), 0.35))
    # Vertical strips: some columns' edge lit top to bottom.
    strips = op('MULTIPLY', op('GREATER_THAN', white(column, 3.0), 0.9),
                op('LESS_THAN', op('FRACT', op('DIVIDE', op('ADD', parts.outputs['X'], parts.outputs['Y']), 12.0)), 0.06))
    # A fine, noisy spread of windows in the lit sections only, never a grid.
    sections = op('GREATER_THAN', noise_at(geometry.outputs['Position'], 0.008), 0.55)
    specks = op('GREATER_THAN', noise_at(geometry.outputs['Position'], 2.5, 0), 0.68)
    windows = op('MULTIPLY', op('MULTIPLY', sections, specks), 0.35)
    light = op('MINIMUM', op('ADD', op('ADD', bands, strips), windows), 1.0)
    upright = nodes.new('ShaderNodeSeparateXYZ')
    links.new(geometry.outputs['Normal'], upright.inputs['Vector'])
    light = op('MULTIPLY', light, op('LESS_THAN', op('ABSOLUTE', upright.outputs['Z']), 0.5))
    tint = nodes.new('ShaderNodeMix')
    tint.data_type = 'RGBA'
    tint.inputs['A'].default_value, tint.inputs['B'].default_value = (1.0, 0.68, 0.38, 1), (0.55, 0.78, 1.0, 1)
    links.new(op('GREATER_THAN', white(column, floor), 0.6), tint.inputs['Factor'])
    # The air between: the farther, the more a tower is the sky's glow and the less its own lights.
    lit = nodes.new('ShaderNodeMix')
    lit.data_type = 'RGBA'
    links.new(light, lit.inputs['Factor'])
    lit.inputs['A'].default_value = (0, 0, 0, 1)
    links.new(tint.outputs['Result'], lit.inputs['B'])
    hazed, far = haze(nodes, links, lit.outputs['Result'])
    links.new(hazed, principled.inputs['Emission Color'])
    principled.inputs['Emission Strength'].default_value = 1.0
    principled.inputs['Base Color'].default_value = (0.0, 0.0, 0.0, 1)
    return mat


def tower_nodes(mat):
    """The towers' Geometry Nodes group: on each point, from its 'size' (width, depth, height) and 'turn' attributes, a
    base block, a set-back block, a smaller one, a crown and, at random, an antenna mast; realized, with `mat`."""
    group = bpy.data.node_groups.new('City Towers', 'GeometryNodeTree')
    group.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    group.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    nodes, links = group.nodes, group.links
    inp, out = nodes.new('NodeGroupInput'), nodes.new('NodeGroupOutput')
    size = nodes.new('GeometryNodeInputNamedAttribute')
    size.data_type, size.inputs['Name'].default_value = 'FLOAT_VECTOR', 'size'
    turn = nodes.new('GeometryNodeInputNamedAttribute')
    turn.data_type, turn.inputs['Name'].default_value = 'FLOAT', 'turn'
    rotation = nodes.new('ShaderNodeCombineXYZ')
    links.new(turn.outputs['Attribute'], rotation.inputs['Z'])
    size_parts = nodes.new('ShaderNodeSeparateXYZ')
    links.new(size.outputs['Attribute'], size_parts.inputs['Vector'])
    join = nodes.new('GeometryNodeJoinGeometry')

    def block(mesh_socket, scale, lift, select=None):
        """Instances `mesh_socket` (standing on z = 0) on every point, scaled by size x `scale`, raised by height x
        `lift`."""
        raise_by = nodes.new('ShaderNodeVectorMath')
        raise_by.operation = 'MULTIPLY'
        raise_by.inputs[1].default_value = (0, 0, lift)
        links.new(size.outputs['Attribute'], raise_by.inputs[0])
        moved = nodes.new('GeometryNodeSetPosition')
        links.new(inp.outputs['Geometry'], moved.inputs['Geometry'])
        links.new(raise_by.outputs['Vector'], moved.inputs['Offset'])
        scaled = nodes.new('ShaderNodeVectorMath')
        scaled.operation = 'MULTIPLY'
        scaled.inputs[1].default_value = scale
        links.new(size.outputs['Attribute'], scaled.inputs[0])
        put = nodes.new('GeometryNodeInstanceOnPoints')
        links.new(moved.outputs['Geometry'], put.inputs['Points'])
        links.new(mesh_socket, put.inputs['Instance'])
        links.new(scaled.outputs['Vector'], put.inputs['Scale'])
        links.new(rotation.outputs['Vector'], put.inputs['Rotation'])
        if select is not None:
            links.new(select, put.inputs['Selection'])
        links.new(put.outputs['Instances'], join.inputs['Geometry'])

    def standing(mesh_node):
        lift = nodes.new('GeometryNodeTransform')
        lift.inputs['Translation'].default_value = (0, 0, 0.5)
        links.new(mesh_node.outputs['Mesh'], lift.inputs['Geometry'])
        return lift.outputs['Geometry']

    cube = standing(nodes.new('GeometryNodeMeshCube'))
    mast = nodes.new('GeometryNodeMeshCylinder')
    mast.inputs['Vertices'].default_value = 6
    mast_standing = standing(mast)
    block(cube, (1, 1, 0.62), 0)
    block(cube, (0.78, 0.8, 0.25), 0.62)
    block(cube, (0.55, 0.6, 0.13), 0.87)
    block(cube, (0.3, 0.34, 0.04), 1.0)
    chance = nodes.new('FunctionNodeRandomValue')
    chance.data_type = 'BOOLEAN'
    chance.inputs['Probability'].default_value = 0.6
    block(mast_standing, (0.03, 0.03, 0.18), 1.04, chance.outputs[0])
    spire_flag = nodes.new('GeometryNodeInputNamedAttribute')
    spire_flag.data_type, spire_flag.inputs['Name'].default_value = 'BOOLEAN', 'spire'
    spire = nodes.new('GeometryNodeMeshCone')
    spire.inputs['Vertices'].default_value = 8
    spire.inputs['Radius Top'].default_value = 0.0
    block(standing(spire), (0.18, 0.2, 0.35), 1.04, spire_flag.outputs['Attribute'])
    realize = nodes.new('GeometryNodeRealizeInstances')
    links.new(join.outputs['Geometry'], realize.inputs['Geometry'])
    paint = nodes.new('GeometryNodeSetMaterial')
    paint.inputs['Material'].default_value = mat
    links.new(realize.outputs['Geometry'], paint.inputs['Geometry'])
    links.new(paint.outputs['Geometry'], out.inputs['Geometry'])
    return group


def sky_material(name, low, high, strength, alpha=None):
    """A vertical gradient of light from `low` at its foot to `high` at its top, as emission; with `alpha`, fading out
    toward its top."""
    mat = gradient_ad(name, low, high, strength)
    if alpha:
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        gradient = next(n for n in nodes if n.type == 'TEX_GRADIENT')
        fade = nodes.new('ShaderNodeMath')
        fade.operation, fade.inputs[0].default_value = 'SUBTRACT', alpha
        links.new(gradient.outputs['Fac'], fade.inputs[1])
        links.new(fade.outputs[0], nodes['Principled BSDF'].inputs['Alpha'])
        mat.surface_render_method = 'BLENDED'
    return mat


# The sky over the city glowing from below, magenta into teal, fading up into the night.
# Glowing only near the horizon and behind the towers, deep blue-violet above.
card('City Glow', 72, 3200, 9000, -200, 1100, sky_material('City Glow', (0.26, 0.09, 0.2), (0.012, 0.01, 0.035), 0.35))

# Towers in a wide band, nearer ones shorter, a few very tall.
skyline = random.Random(11)
TOWERS = []
for distance, count, (low, high) in ((950, 10, (200, 380)), (1350, 14, (260, 500)), (1850, 16, (320, 650)), (2500, 14, (400, 800))):
    for k in range(count):
        yaw = 44 + (k + skyline.uniform(0.1, 0.9)) * 60 / count
        w = skyline.uniform(28, 75)
        TOWERS.append((yaw, distance + skyline.uniform(-80, 80), w, w * skyline.uniform(0.7, 1.0), skyline.uniform(low, high)))
SPIRES = {len(TOWERS) - 25, len(TOWERS) - 7}
points = bpy.data.meshes.new('City Points')
spots = [toward(yaw, distance) for yaw, distance, *_ in TOWERS]
points.from_pydata([(x, y, -10) for (x, y), _ in spots], [], [])
points.attributes.new('size', 'FLOAT_VECTOR', 'POINT').data.foreach_set('vector', [v for *_, w, d, h in TOWERS for v in (w, d, h)])
points.attributes.new('turn', 'FLOAT', 'POINT').data.foreach_set('value', [turn for _, turn in spots])
points.attributes.new('spire', 'BOOLEAN', 'POINT').data.foreach_set('value', [i in SPIRES for i in range(len(TOWERS))])
towers = bpy.data.objects.new('City', points)
collection.objects.link(towers)
city_tower = tower_material()
towers.modifiers.new('City Towers', 'NODES').node_group = tower_nodes(city_tower)

# The arcology: a colossal stepped megastructure whose top is lost in the cloud deck, a ring of light round its waist.
ARCOLOGY = toward(76, 2100)
(ax, ay), aturn = ARCOLOGY
with merged('Arcology') as arcology:
    for k, (w, z0, z1) in enumerate(((420, -10, 380), (320, 380, 760), (230, 760, 1150), (150, 1150, 1700))):
        box('Arcology Block', (w, w * 0.8, z1 - z0), (ax, ay, (z0 + z1) / 2), city_tower, (0, 0, aturn))
    bpy.ops.mesh.primitive_torus_add(major_radius=200, minor_radius=6, major_segments=48, minor_segments=6, location=(ax, ay, 600))
    finish(bpy.context.object, 'Arcology Ring', material('Arcology Ring', (0.3, 0.9, 1.0), emission=4))

# A low cloud deck lit from below by the city, which the arcology and the tallest towers pierce.
cloud = bpy.data.materials.new('Cloud Deck')
nodes, links = cloud.node_tree.nodes, cloud.node_tree.links
principled = nodes['Principled BSDF']
principled.inputs['Base Color'].default_value = (0.02, 0.02, 0.03, 1)
principled.inputs['Emission Strength'].default_value = 0.6
billows = nodes.new('ShaderNodeTexNoise')
billows.inputs['Scale'].default_value, billows.inputs['Detail'].default_value = 0.0015, 8
links.new(nodes.new('ShaderNodeNewGeometry').outputs['Position'], billows.inputs['Vector'])
thick = nodes.new('ShaderNodeMapRange')
thick.inputs['From Min'].default_value, thick.inputs['From Max'].default_value = 0.45, 0.75
thick.inputs['To Max'].default_value = 0.6
links.new(billows.outputs['Fac'], thick.inputs['Value'])
links.new(thick.outputs['Result'], principled.inputs['Alpha'])
# Brighter where the city's light catches its underside, in patches; dark between.
patches = nodes.new('ShaderNodeTexNoise')
patches.inputs['Scale'].default_value, patches.inputs['Detail'].default_value = 0.0006, 4
links.new(billows.inputs['Vector'].links[0].from_socket, patches.inputs['Vector'])
underlit = nodes.new('ShaderNodeMix')
underlit.data_type = 'RGBA'
underlit.inputs['A'].default_value, underlit.inputs['B'].default_value = (0.06, 0.03, 0.08, 1), (0.6, 0.24, 0.42, 1)
catch = nodes.new('ShaderNodeMapRange')
catch.inputs['From Min'].default_value, catch.inputs['From Max'].default_value = 0.45, 0.7
links.new(patches.outputs['Fac'], catch.inputs['Value'])
links.new(catch.outputs['Result'], underlit.inputs['Factor'])
links.new(underlit.outputs['Result'], principled.inputs['Emission Color'])
cloud.surface_render_method = 'BLENDED'
(cx, cy), _ = toward(75, 1800)
outline('Cloud Deck', [(cx - 4000, cy - 4000, 950), (cx + 4000, cy - 4000, 950), (cx + 4000, cy + 4000, 950), (cx - 4000, cy + 4000, 950)], cloud)

# Fog banks drifting across at three depths.
with merged('City Fog'):
    for k, (distance, density, light) in enumerate(((420, 0.45, 0.8), (1000, 0.55, 1.2), (1600, 0.65, 1.6))):
        card('Fog Card', 72 + k * 2, distance, 2500 + k * 1500, -20, 260 + k * 120, fog_card(f'City Fog {k + 1}', density, light))
wave(bpy.data.objects['City Fog'], 'location', 0, 6.0, LOOP)

# An airship drifting slowly across, a giant ad on its flank, its lights blinking.
blink = material('Aircraft Light', (1.0, 0.1, 0.05), emission=8)
strength = blink.node_tree.nodes['Principled BSDF'].inputs['Emission Strength']
looping(strength, 'default_value', [(1, 8), (12, 0), (41, 8)], interpolation='CONSTANT')
ad_glow = sky_material('Airship Ad', (0.9, 0.15, 0.5), (0.1, 0.8, 0.9), 1.2)
mapping = next(n for n in ad_glow.node_tree.nodes if n.type == 'MAPPING')
wave(mapping.inputs['Location'], 'default_value', 0, 0.5, LOOP)
with merged('Airship') as airship:
    ellipsoid('Hull', (140, 32, 30), (0, 0, 0), material('Airship Hull', (0.01, 0.01, 0.015), roughness=0.6))
    outline('Ad', [(-90, -33, -18), (90, -33, -18), (90, -33, 18), (-90, -33, 18)], ad_glow)
    letters('Airship Kana', 'ラーメン', -60, -34, 8, 22, material('Airship Kana', (1, 0.95, 0.9), emission=2.5), -1)
    for end in (-140, 140):
        ellipsoid('Nav Light', (2, 2, 2), (end, 0, 0), blink)
ship = airship['object']
bpy.ops.object.select_all(action='DESELECT')
ship.select_set(True)
bpy.context.view_layer.objects.active = ship
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
(sx, sy), sturn = toward(72, 1150)
ship.matrix_world = Matrix.Translation((sx, sy, 300)) @ Matrix.Rotation(sturn, 4, 'Z') @ Matrix.Translation((-180, 0, 0))
# Riding the wind in place: a slow bob and a slight sway of its heading.
wave(ship, 'location', 2, 4.0, LOOP / 2)
wave(ship, 'rotation_euler', 2, math.radians(1.5), LOOP)

world = bpy.data.worlds.new('Night')
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.006, 0.006, 0.012, 1)
scene.world = world

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 16
# Far enough to see the city's towers.
camera.data.clip_end = 5000
camera.location = EYE
camera.rotation_euler = (math.radians(95), 0, math.radians(38))
# Breathing: a drift of a few centimeters, side to side once a loop and up and down twice.
wave(camera, 'location', 0, 0.03, LOOP)
wave(camera, 'location', 2, 0.015, LOOP / 2)
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
# Render Image blurs what moves (the rain, the steam, the airship), as EEVEE's final render does.
scene.render.use_motion_blur, scene.render.motion_blur_shutter = True, 0.5
scene.view_settings.view_transform = 'Standard'
# Blender's EEVEE reflects the neon in the puddles by ray tracing.
scene.eevee.use_raytracing = True
scene.eevee.taa_render_samples = 64
scene.eevee.shadow_pool_size = '1024'

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
lens = node('CompositorNodeLensdist', (-200, 0), Distortion=-0.03, Dispersion=0.012)
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
