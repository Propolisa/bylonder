"""Builds drivers-and-graph-editor.blend: a small steam engine whose flywheel turns by two keys repeated by a Cycles
modifier, while drivers move the connecting rod, the crosshead, the governor and its balls from the flywheel's angle,
and a Noise modifier shakes the pressure gauge's needle, in Blender 5.2.3.

usage: blender -b --factory-startup -P drivers-and-graph-editor.py [-- RENDER.png]   (a Cycles preview at frame 10)
"""
import math
import os
import sys

import bpy
from bpy_extras.anim_utils import action_get_channelbag_for_slot
from mathutils import Matrix, Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end, scene.render.fps = 1, 96, 24
scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('World')
world.color = (0.09, 0.085, 0.08)
world.node_tree.nodes['Background'].inputs['Color'].default_value = (*world.color, 1)
scene.world = world

R, L, AXLE = 0.45, 1.5, 1.1   # crank radius, rod length, axle height


def material(name, color, roughness=0.5, metallic=0.0):
    ma = bpy.data.materials.new(name)
    bsdf = ma.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return ma


BRASS = material('Brass', (0.9, 0.62, 0.28), 0.28, 1.0)
IRON = material('Cast Iron', (0.05, 0.06, 0.055), 0.55, 0.6)
STEEL = material('Steel', (0.7, 0.72, 0.74), 0.22, 1.0)
RED = material('Engine Red', (0.32, 0.03, 0.02), 0.35)
WOOD = material('Plinth', (0.2, 0.09, 0.04), 0.45)
DIAL = material('Dial', (0.85, 0.8, 0.68), 0.6)
WALL = material('Wall', (0.3, 0.26, 0.22), 0.9)


def add(op, name, ma, parent=None, smooth=True, **kwargs):
    op(**kwargs)
    obj = bpy.context.object
    obj.name = obj.data.name = name
    obj.data.materials.append(ma)
    if smooth:
        bpy.ops.object.shade_smooth()
    if parent:
        obj.parent = parent
    return obj


def box(name, ma, location, size, parent=None):
    obj = add(bpy.ops.mesh.primitive_cube_add, name, ma, parent, smooth=False, size=1, location=location)
    obj.data.transform(Matrix.Diagonal((*size, 1)))
    bevel = obj.modifiers.new('Bevel', 'BEVEL')
    bevel.width, bevel.segments = 0.02, 2
    return obj


def cylinder(name, ma, location, radius, depth, rotation=(0, 0, 0), parent=None, vertices=48):
    obj = add(bpy.ops.mesh.primitive_cylinder_add, name, ma, parent, smooth=False, vertices=vertices, radius=radius,
              depth=depth, location=location, rotation=rotation)
    bevel = obj.modifiers.new('Bevel', 'BEVEL')
    bevel.width, bevel.segments, bevel.limit_method = min(0.015, radius / 4), 2, 'ANGLE'
    obj.data.polygons.foreach_set('use_smooth', [True] * len(obj.data.polygons))
    return obj


def fcurve(obj):
    """The object's first F-curve, in its action's channelbag."""
    return action_get_channelbag_for_slot(obj.animation_data.action, obj.animation_data.action_slot).fcurves[0]


def drive(obj, path, index, expression, variables):
    """A driver on obj.path[index]: `expression` over variables {name: (object, data path)}."""
    fc = obj.driver_add(path, index)
    fc.driver.type = 'SCRIPTED'
    for name, (target, data_path) in variables.items():
        var = fc.driver.variables.new()
        var.name, var.type = name, 'SINGLE_PROP'
        var.targets[0].id, var.targets[0].data_path = target, data_path
    fc.driver.expression = expression
    return fc


# The bed: a wooden plinth and an iron frame with two pedestals for the axle.
box('Plinth', WOOD, (1.0, 0, 0.1), (5.4, 1.6, 0.2))
box('Bed', IRON, (1.2, 0, 0.32), (4.6, 0.7, 0.24))
for y in (-0.32, 0.32):
    box('Pedestal', IRON, (0, y, 0.75), (0.3, 0.12, 0.7))
cylinder('Axle', STEEL, (0, 0, AXLE), 0.05, 1.1, rotation=(math.pi / 2, 0, 0))

# The flywheel: a rim, six spokes and a hub, turning about Y; its crank pin at radius R in front.
wheel = add(bpy.ops.mesh.primitive_torus_add, 'Flywheel', RED, major_radius=0.85, minor_radius=0.07,
            major_segments=96, minor_segments=16, location=(0, -0.48, AXLE), rotation=(math.pi / 2, 0, 0))
# Stood up in its mesh, so its only rotation is the turn about Y (Bylonder keeps rotations in Euler YXZ).
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
for i in range(6):
    a = i * math.pi / 3
    cylinder('Spoke', RED, (0.42 * math.cos(a), -0.48, AXLE + 0.42 * math.sin(a)), 0.03, 0.8,
             rotation=(0, math.pi / 2 - a, 0), vertices=16)
cylinder('Hub', BRASS, (0, -0.48, AXLE), 0.12, 0.16, rotation=(math.pi / 2, 0, 0))
cylinder('Crank Pin', STEEL, (R, -0.6, AXLE), 0.045, 0.25, rotation=(math.pi / 2, 0, 0))
# Spokes, hub and crank pin joined into the flywheel's mesh, each keeping its material.
for part in bpy.data.objects:
    for modifier in part.modifiers:
        bpy.context.view_layer.objects.active = part
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    part.select_set(part.name.startswith(('Spoke', 'Hub', 'Crank Pin', 'Flywheel')))
bpy.context.view_layer.objects.active = wheel
bpy.ops.object.join()

# The flywheel turns once every 48 frames: two linear keys, repeated by a Cycles modifier.
wheel.rotation_euler = (0, 0, 0)
wheel.keyframe_insert('rotation_euler', index=1, frame=1)
wheel.rotation_euler[1] = -2 * math.pi
wheel.keyframe_insert('rotation_euler', index=1, frame=49)
turn = fcurve(wheel)
for key in turn.keyframe_points:
    key.interpolation = 'LINEAR'
turn.modifiers.new('CYCLES')

# The crosshead slides in two guides; the rod joins it to the crank pin. Angle a: the flywheel's turn.
A = {'a': (wheel, 'rotation_euler[1]')}
for z in (AXLE - 0.17, AXLE + 0.17):
    box('Guide', STEEL, (2.05, -0.6, z), (1.6, 0.14, 0.05))
crosshead = box('Crosshead', BRASS, (R + L, -0.6, AXLE), (0.28, 0.2, 0.26))
drive(crosshead, 'location', 0, f'{R}*cos(a) + sqrt({L * L} - {R}*sin(a)*{R}*sin(a))', A)
rod = box('Connecting Rod', STEEL, (0, -0.68, AXLE), (L, 0.06, 0.1))
rod.data.transform(Matrix.Translation((L / 2, 0, 0)))
drive(rod, 'location', 0, f'{R}*cos(a)', A)
drive(rod, 'location', 2, f'{AXLE} - {R}*sin(a)', A)
drive(rod, 'rotation_euler', 1, f'-asin({R}*sin(a)/{L})', A)
piston_rod = cylinder('Piston Rod', STEEL, (R + L + 0.7, -0.6, AXLE), 0.035, 1.4, rotation=(0, math.pi / 2, 0), vertices=24)
drive(piston_rod, 'location', 0, f'{R}*cos(a) + sqrt({L * L} - {R}*sin(a)*{R}*sin(a)) + 0.7', A)
cylinder('Steam Cylinder', BRASS, (3.25, -0.6, AXLE), 0.3, 0.9, rotation=(0, math.pi / 2, 0), vertices=64)
for x in (2.8, 3.7):
    cylinder('Cylinder Cover', IRON, (x, -0.6, AXLE), 0.34, 0.06, rotation=(0, math.pi / 2, 0), vertices=64)
box('Cylinder Saddle', IRON, (3.25, -0.6, 0.6), (0.7, 0.4, 0.4))

# The governor: a spindle turned twice as fast as the flywheel, its balls lifted by the spindle's speed.
spindle = cylinder('Governor Spindle', STEEL, (3.25, -0.6, AXLE + 0.75), 0.025, 0.9, vertices=16)
drive(spindle, 'rotation_euler', 2, '-2*a', A)
cylinder('Governor Cap', BRASS, (3.25, -0.6, AXLE + 1.22), 0.06, 0.06, vertices=24)
for side in (-1, 1):
    arm = box('Governor Arm', BRASS, (3.25, -0.6, AXLE + 1.15), (0.02, 0.02, 0.4))
    arm.data.transform(Matrix.Translation((0, 0, -0.2)))
    arm.parent = spindle
    arm.matrix_parent_inverse = spindle.matrix_world.inverted()
    arm.rotation_euler[1] = side * 0.6
    drive(arm, 'rotation_euler', 1, f'{side}*(0.55 + 0.08*sin(4*a))', A)
    ball = add(bpy.ops.mesh.primitive_uv_sphere_add, 'Governor Ball', BRASS, segments=32, ring_count=16, radius=0.07,
               location=(0, 0, -0.4))
    ball.parent = arm

# The pressure gauge: its needle shaken by a Noise modifier on its rotation's F-curve.
cylinder('Gauge Pipe', BRASS, (3.6, -0.6, AXLE + 0.55), 0.02, 0.4, vertices=12)
gauge = cylinder('Gauge', BRASS, (3.6, -0.66, AXLE + 0.85), 0.16, 0.05, rotation=(math.pi / 2, 0, 0), vertices=48)
face = cylinder('Gauge Face', DIAL, (3.6, -0.69, AXLE + 0.85), 0.135, 0.01, rotation=(math.pi / 2, 0, 0), vertices=48)
needle = box('Needle', IRON, (3.6, -0.7, AXLE + 0.85), (0.012, 0.01, 0.12))
needle.data.transform(Matrix.Translation((0, 0, 0.06)))
needle.rotation_euler[1] = 0.6
needle.keyframe_insert('rotation_euler', index=1, frame=1)
shake = fcurve(needle)
noise = shake.modifiers.new('NOISE')
noise.scale, noise.strength = 6, 0.35

# A back wall and the lights: a warm key from the front left, a cool rim from behind.
box('Wall', WALL, (1.0, 2.2, 2.5), (12, 0.2, 5)).modifiers.clear()
box('Floor', WALL, (1.0, 0, -0.05), (12, 8, 0.1)).modifiers.clear()
key = bpy.data.objects.new('Key Light', bpy.data.lights.new('Key Light', 'AREA'))
key.data.energy, key.data.color, key.data.size = 160, (1.0, 0.88, 0.72), 3.0
key.location = (-0.5, -4.0, 3.5)
key.rotation_euler = (Vector((1.6, 0, 1.0)) - key.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(key)
rim = bpy.data.objects.new('Rim Light', bpy.data.lights.new('Rim Light', 'POINT'))
rim.data.energy, rim.data.color, rim.data.shadow_soft_size = 120, (0.6, 0.75, 1.0), 1.0
rim.location = (3.5, 1.4, 3.0)
scene.collection.objects.link(rim)

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 35
camera.location = (2.9, -6.6, 2.9)
camera.rotation_euler = (Vector((1.75, 0, 1.15)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(camera)
scene.camera = camera

scene.frame_set(10)
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = wheel
wheel.select_set(True)
here = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(here, 'drivers-and-graph-editor.blend'), compress=True)

if '--' in sys.argv:
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_percentage = 30
    scene.render.filepath = sys.argv[sys.argv.index('--') + 1]
    bpy.ops.render.render(write_still=True)
