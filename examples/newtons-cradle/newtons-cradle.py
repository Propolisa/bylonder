"""Builds newtons-cradle.blend: a Newton's cradle on a walnut desk, its two outer balls keyed with Sine easing so they
fall fast into the row and slow at the top of each swing, in Blender 5.2.3.

usage: blender -b --factory-startup -P newtons-cradle.py
"""
import math
import os

import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end, scene.render.fps = 1, 60, 24
scene.render.resolution_x, scene.render.resolution_y = 1280, 800

BALL, SPACING, TOP, DEPTH, SWING = 0.5, 0.5, 2.6, 0.9, math.radians(40)


def material(name, color, metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def wood(name, light, dark, scale, distortion):
    """Walnut: a Wave Texture's stretched rings into a Color Ramp."""
    mat = material(name, light, roughness=0.35)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    wave = nodes.new('ShaderNodeTexWave')
    wave.inputs['Scale'].default_value = 1.2
    wave.inputs['Distortion'].default_value = distortion
    wave.inputs['Detail'].default_value = 3
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = scale
    links.new(nodes.new('ShaderNodeTexCoord').outputs['Object'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], wave.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].color = (*light, 1)
    links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
    return mat


def add(op, name, mat, **kw):
    op(**kw)
    ob = bpy.context.object
    ob.name = ob.data.name = name
    ob.data.materials.append(mat)
    return ob


def polished(name, color):
    """Two Glossy BSDFs mixed: a sharp mirror lobe over a soft sheen, as polished brass reads under studio lights."""
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.remove(nodes['Principled BSDF'])
    sharp, soft = nodes.new('ShaderNodeBsdfGlossy'), nodes.new('ShaderNodeBsdfGlossy')
    for node, roughness in ((sharp, 0.06), (soft, 0.35)):
        node.inputs['Color'].default_value = (*color, 1)
        node.inputs['Roughness'].default_value = roughness
    mix = nodes.new('ShaderNodeMixShader')
    mix.inputs['Fac'].default_value = 0.5
    links.new(sharp.outputs['BSDF'], mix.inputs[1])
    links.new(soft.outputs['BSDF'], mix.inputs[2])
    links.new(mix.outputs['Shader'], nodes['Material Output'].inputs['Surface'])
    return mat


brass = polished('Brass', (1.0, 0.72, 0.38))
steel = material('Brushed Steel', (0.6, 0.6, 0.62), metallic=1, roughness=0.3)
thread = material('Thread', (0.85, 0.82, 0.75), roughness=0.8)
walnut = wood('Walnut', (0.16, 0.07, 0.03), (0.05, 0.02, 0.008), (0.6, 5, 1), 6)
desk = wood('Oak Desk', (0.36, 0.22, 0.11), (0.28, 0.16, 0.07), (0.8, 6, 1), 2)
backdrop = material('Backdrop', (0.006, 0.03, 0.035), roughness=0.9)

# The base: a bevelled walnut slab.
base = add(bpy.ops.mesh.primitive_cube_add, 'Base', walnut, size=1, location=(0, 0, 0.08))
base.scale = (3.6, 1.6, 0.16)
bevel = base.modifiers.new('Bevel', 'BEVEL')
bevel.width, bevel.segments = 0.03, 3

# The frame: four steel posts and two rails along the top.
for x in (-1.55, 1.55):
    for y in (-DEPTH / 2, DEPTH / 2):
        add(bpy.ops.mesh.primitive_cylinder_add, 'Post', steel, radius=0.035, depth=TOP - 0.16, location=(x, y, 0.16 + (TOP - 0.16) / 2))
for y in (-DEPTH / 2, DEPTH / 2):
    rail = add(bpy.ops.mesh.primitive_cylinder_add, 'Rail', steel, radius=0.035, depth=3.17, location=(0, y, TOP), rotation=(0, math.pi / 2, 0))

# Five pendulums, each a pivot on the rails' axis with its ball and two threads as children.
pendulums = []
hang = TOP - 0.85
for i in range(5):
    x = (i - 2) * SPACING
    pivot = bpy.data.objects.new(f'Pendulum {i + 1}', None)
    pivot.location = (x, 0, TOP)
    pivot.empty_display_size = 0.15
    scene.collection.objects.link(pivot)
    ball = add(bpy.ops.mesh.primitive_uv_sphere_add, f'Ball {i + 1}', brass, radius=BALL / 2, segments=48, ring_count=24, location=(x, 0, hang))
    bpy.ops.object.shade_smooth()
    length = math.hypot(DEPTH / 2, TOP - hang)
    tilt = math.atan2(DEPTH / 2, TOP - hang)
    threads = [add(bpy.ops.mesh.primitive_cylinder_add, 'Thread', thread, radius=0.006, depth=length, vertices=8,
                   location=(x, side * DEPTH / 4, (TOP + hang) / 2), rotation=(side * tilt, 0, 0)) for side in (-1, 1)]
    for child in [ball, *threads]:
        child.parent = pivot
        child.location -= pivot.location
    pendulums.append(pivot)


def swing(ob, keys):
    """Keys the pivot's Y rotation; each key's interpolation is Sine with its easing, so a fall speeds up and a rise
    slows down."""
    for frame, angle, easing in keys:
        ob.rotation_euler.y = angle
        ob.keyframe_insert('rotation_euler', index=1, frame=frame)
    for fcurve in ob.animation_data.action.layers[0].strips[0].channelbag(ob.animation_data.action_slot).fcurves:
        for point, (_, _, easing) in zip(fcurve.keyframe_points, keys):
            point.interpolation = 'SINE'
            point.easing = easing


# The left ball falls (Ease In) into the row at frame 16, the right one leaves it (Ease Out), falls back at 46 and
# the left one rises again: one 60 frame cycle.
swing(pendulums[0], [(1, SWING, 'EASE_IN'), (16, 0, 'EASE_OUT'), (46, 0, 'EASE_OUT'), (61, SWING, 'EASE_IN')])
swing(pendulums[4], [(1, 0, 'EASE_OUT'), (16, 0, 'EASE_OUT'), (31, -SWING, 'EASE_IN'), (46, 0, 'EASE_OUT')])

# The desk and a teal backdrop sweeping up behind it.
add(bpy.ops.mesh.primitive_plane_add, 'Desk', desk, size=14, location=(0, 1, 0))
bpy.ops.mesh.primitive_plane_add(size=1)
wall = bpy.context.object
wall.name = wall.data.name = 'Backdrop'
wall.data.materials.append(backdrop)
wall.scale = (20, 1, 8)
wall.location, wall.rotation_euler = (0, 3.5, 4), (math.pi / 2, 0, 0)

def light(name, kind, location, rotation, energy, color, size):
    data = bpy.data.lights.new(name, kind)
    data.energy, data.color = energy, color
    if kind == 'SUN':
        data.angle = size
    else:
        data.shadow_soft_size = size
    if kind == 'SPOT':
        data.spot_size, data.spot_blend = math.radians(60), 0.6
    ob = bpy.data.objects.new(name, data)
    ob.location, ob.rotation_euler = location, rotation
    scene.collection.objects.link(ob)
    return ob


# A warm key from the front left, a cool rim from behind the right, and a low fill.
light('Key', 'SPOT', (-3.5, -4, 5.5), (math.radians(50), 0, math.radians(-40)), 1800, (1, 0.85, 0.7), 0.4)
light('Rim', 'SPOT', (3.5, 3.5, 4), (math.radians(-55), 0, math.radians(-140)), 900, (0.6, 0.8, 1), 0.2)
light('Fill', 'SUN', (0, 0, 5), (math.radians(70), 0, math.radians(20)), 0.6, (0.9, 0.95, 1), math.radians(10))

world = bpy.data.worlds.new('Studio')
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.1, 0.08, 0.06, 1)
scene.world = world

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 50
camera.location = (3.5, -6.8, 2.2)
camera.rotation_euler = (camera.location - Vector((0.1, 0, 1.25))).to_track_quat('Z', 'Y').to_euler()
scene.collection.objects.link(camera)
scene.camera = camera

scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
pendulums[0].select_set(True)
bpy.context.view_layer.objects.active = pendulums[0]
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'newtons-cradle.blend'), compress=True)
