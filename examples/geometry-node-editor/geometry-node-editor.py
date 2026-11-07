"""Builds geometry-node-editor.blend: sunflowers whose seeds and petals a node group lays out by the golden angle.

usage: blender -b --factory-startup -P geometry-node-editor.py
"""
import math
import os

import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, roughness=0.6, sheen=0.0):
    ma = bpy.data.materials.new(name)
    ma.diffuse_color = color
    bsdf = ma.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Sheen Weight'].default_value = sheen
    return ma


def add(build, name, color=None, roughness=0.6, collection=None):
    bpy.ops.object.select_all(action='DESELECT')
    build()
    ob = bpy.context.object
    ob.name = ob.data.name = name
    if collection:
        for c in ob.users_collection:
            c.objects.unlink(ob)
        collection.objects.link(ob)
    if color:
        ob.data.materials.append(material(name, color, roughness))
    return ob


# The parts the node group instances, in a hidden collection: two seeds (the young ones at the middle are darker) and
# a petal lying along +X from its origin.
seeds_kinds = bpy.data.collections.new('Seeds')
petals_kind = bpy.data.collections.new('Petals')
for parts in (seeds_kinds, petals_kind):
    scene.collection.children.link(parts)
seed_shape = lambda: bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=1, scale=(0.011, 0.008, 0.006))
add(seed_shape, 'Seed 1 Young', (0.05, 0.035, 0.012, 1), 0.7, seeds_kinds)
add(seed_shape, 'Seed 2 Ripe', (0.16, 0.08, 0.025, 1), 0.55, seeds_kinds)
petal = add(lambda: bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=1), 'Petal', (0.85, 0.36, 0.01, 1), 0.5, petals_kind)
for v in petal.data.vertices:
    x = v.co.x
    v.co = Vector(((x + 1) * 0.11, v.co.y * 0.028 * (1.2 - 0.5 * (x + 1) / 2), v.co.z * 0.004 + 0.02 * ((x + 1) / 2) ** 2))
bpy.ops.object.shade_smooth()
for parts in (seeds_kinds, petals_kind):
    for ob in parts.objects:
        ob.data.transform(ob.matrix_basis)
        ob.matrix_basis.identity()
    scene.view_layers[0].layer_collection.children[parts.name].exclude = True

group = bpy.data.node_groups.new('Sunflower', 'GeometryNodeTree')
interface = group.interface
interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
for name, kind, value, low, high in [('Seeds', 'NodeSocketInt', 1100, 0, 4000),
                                     ('Golden Angle', 'NodeSocketFloat', 137.508, 0.0, 360.0),
                                     ('Spacing', 'NodeSocketFloat', 0.0042, 0.0, 0.02),
                                     ('Petals', 'NodeSocketInt', 34, 0, 89)]:
    socket = interface.new_socket(name, in_out='INPUT', socket_type=kind)
    socket.default_value, socket.min_value, socket.max_value = value, low, high
N, L = group.nodes, group.links


def node(idname, x, y, frame=None, label=None, **inputs):
    n = N.new(idname)
    n.location = (x, y)
    if label:
        n.label = label
    for key, value in inputs.items():
        if key.startswith('_'):
            setattr(n, key[1:], value)
        else:
            n.inputs[key.replace('__', ' ')].default_value = value
    n.parent = frame
    return n


def math_node(operation, x, y, frame, b=None, label=None):
    n = node('ShaderNodeMath', x, y, frame, label, _operation=operation)
    if b is not None:
        n.inputs[1].default_value = b
    return n


def frame(label, color):
    f = N.new('NodeFrame')
    f.label = label
    f.use_custom_color, f.color = True, color
    return f


def link(a, out, b, into):
    L.new(a.outputs[out], b.inputs[into])


def spiral(count_socket, x, y, f, radius_of):
    """Points turned by the golden angle each, at a radius radius_of(index node) returns: Vogel's model."""
    points = node('GeometryNodePoints', x, y, f)
    link(inputs, count_socket, points, 'Count')
    index = node('GeometryNodeInputIndex', x, y - 200, f)
    turn = math_node('MULTIPLY', x + 200, y - 300, f, label='Turn')
    link(index, 0, turn, 0)
    link(radians, 0, turn, 1)
    radius = radius_of(index, x + 200, y - 140)
    along_x = node('ShaderNodeCombineXYZ', x + 400, y - 140, f)
    link(radius, 0, along_x, 'X')
    rotate = node('ShaderNodeVectorRotate', x + 600, y - 140, f, _rotation_type='Z_AXIS')
    link(along_x, 0, rotate, 'Vector')
    link(turn, 0, rotate, 'Angle')
    placed = node('GeometryNodeSetPosition', x + 800, y, f)
    link(points, 0, placed, 'Geometry')
    link(rotate, 0, placed, 'Position')
    facing = node('ShaderNodeCombineXYZ', x + 800, y - 300, f, label='Facing')
    link(turn, 0, facing, 'Z')
    return placed, radius, facing


inputs = node('NodeGroupInput', -1500, 0)
output = node('NodeGroupOutput', 1500, 0)
radians = node('ShaderNodeMath', -1300, -300, None, label='Degrees to Radians', _operation='RADIANS')
link(inputs, 'Golden Angle', radians, 0)

# Seeds: the n-th seed at angle n times the golden angle and radius sqrt(n) times the spacing, so every seed has the
# same area; the head domes slightly, and seeds grow and ripen toward the rim.
seeds = frame('Seeds', (0.3, 0.22, 0.14))


def seed_radius(index, x, y):
    root = math_node('SQRT', x, y, seeds)
    link(index, 0, root, 0)
    spaced = math_node('MULTIPLY', x, y - 50, seeds)
    link(root, 0, spaced, 0)
    link(inputs, 'Spacing', spaced, 1)
    return spaced


placed, radius, facing = spiral('Seeds', -1100, 300, seeds, seed_radius)
dome = math_node('POWER', -100, 120, seeds, b=2.0, label='Dome')
link(radius, 0, dome, 0)
sink = node('ShaderNodeMath', 100, 120, seeds, _operation='MULTIPLY_ADD')
sink.inputs[1].default_value, sink.inputs[2].default_value = -0.9, 0.022
link(dome, 0, sink, 0)
lift = node('ShaderNodeCombineXYZ', 300, 120, seeds)
link(sink, 0, lift, 'Z')
domed = node('GeometryNodeSetPosition', 300, 300, seeds)
link(placed, 0, domed, 'Geometry')
link(lift, 0, domed, 'Offset')
grow = node('ShaderNodeMapRange', 300, -60, seeds, label='Size', **{'From Max': 0.14, 'To Min': 0.55, 'To Max': 1.25})
link(radius, 0, grow, 'Value')
ripe = node('FunctionNodeCompare', 300, -280, seeds, _data_type='FLOAT', _operation='GREATER_THAN', B=0.045)
link(radius, 0, ripe, 'A')
kinds = node('GeometryNodeCollectionInfo', 500, -280, seeds, _transform_space='ORIGINAL', Collection=seeds_kinds, **{'Separate Children': True, 'Reset Children': True})
seed_instances = node('GeometryNodeInstanceOnPoints', 700, 300, seeds, **{'Pick Instance': True})
link(domed, 0, seed_instances, 'Points')
link(kinds, 0, seed_instances, 'Instance')
link(ripe, 0, seed_instances, 'Instance Index')
link(facing, 0, seed_instances, 'Rotation')
link(grow, 'Result', seed_instances, 'Scale')

# Petals: the same spiral at the rim, a little apart, tilted up and out.
petals = frame('Petals', (0.36, 0.3, 0.1))


def rim(index, x, y):
    ring = math_node('MULTIPLY', x, y, petals, b=0.0006)
    link(index, 0, ring, 0)
    out = math_node('ADD', x, y - 50, petals, b=0.14)
    link(ring, 0, out, 0)
    return out


petal_points, _, petal_facing = spiral('Petals', -1100, -600, petals, rim)
tilt = node('ShaderNodeCombineXYZ', -100, -900, petals, label='Tilt', Y=-0.18)
tilted = node('FunctionNodeRotateRotation', 100, -900, petals, _rotation_space='LOCAL')
link(petal_facing, 0, tilted, 'Rotation')
link(tilt, 0, tilted, 'Rotate By')
petal_info = node('GeometryNodeCollectionInfo', 100, -1100, petals, _transform_space='ORIGINAL', Collection=petals_kind)
petal_size = node('FunctionNodeRandomValue', 300, -1100, petals, _data_type='FLOAT', Min=0.85, Max=1.1)
petal_instances = node('GeometryNodeInstanceOnPoints', 500, -600, petals)
link(petal_points, 0, petal_instances, 'Points')
link(petal_info, 0, petal_instances, 'Instance')
link(tilted, 0, petal_instances, 'Rotation')
link(petal_size, 0, petal_instances, 'Scale')

join = node('GeometryNodeJoinGeometry', 1150, 0)
for geometry in (petal_instances, seed_instances):
    link(geometry, 0, join, 0)
L.new(inputs.outputs['Geometry'], join.inputs[0])
# One mesh per head: realized, every seed and petal keeps its material.
realize = node('GeometryNodeRealizeInstances', 1350, 0)
link(join, 0, realize, 0)
link(realize, 0, output, 0)

# The head's back and the stem, plain meshes; the node group adds the seeds and petals to the back.
back_material = material('Bract', (0.12, 0.2, 0.04, 1), 0.7, sheen=0.4)
stem_material = material('Stem', (0.16, 0.3, 0.06, 1), 0.65, sheen=0.5)


def sunflower(name, location, rotation, size, stem_length):
    head = add(lambda: bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.16, depth=0.03), name)
    for v in head.data.vertices:
        v.co.z = v.co.z - 0.016 if v.co.z < 0 else -0.004
    bpy.ops.object.shade_smooth()
    # The realized seeds' and petals' materials too, in the order Realize Instances gives them: Bylonder draws a mesh in
    # its object's slots.
    for ma in (back_material, *(bpy.data.materials[n] for n in ('Seed 1 Young', 'Seed 2 Ripe', 'Petal'))):
        head.data.materials.append(ma)
    head.modifiers.new('Sunflower', 'NODES').node_group = group
    head.location, head.rotation_euler, head.scale = location, rotation, (size,) * 3
    bpy.context.view_layer.update()
    bottom = head.matrix_world @ Vector((0, 0, -0.03))
    stem = add(lambda: bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.012 * size, depth=stem_length,
                                                           location=bottom - Vector((0, 0, stem_length / 2))), f'{name} Stem')
    stem.data.materials.append(stem_material)
    return head


hero = sunflower('Sunflower', (0, 0, 0), (math.radians(68), 0, math.radians(18)), 1.0, 3.0)
sunflower('Sunflower.001', (0.75, 1.4, 0.15), (math.radians(60), 0, math.radians(35)), 0.85, 3.0)
sunflower('Sunflower.002', (-1.0, 2.0, 0.05), (math.radians(64), 0, math.radians(-10)), 0.9, 3.0)

# A late afternoon sun behind the camera's left shoulder, sharp shadows of the petals on the seeds; a pale sky.
sun_data = bpy.data.lights.new('Sun', 'SUN')
sun_data.energy = 2.6
sun_data.angle = math.radians(2)
sun_data.color = (1.0, 0.9, 0.75)
sun = bpy.data.objects.new('Sun', sun_data)
sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
scene.collection.objects.link(sun)
world = bpy.data.worlds.new('Sky')
world.color = (0.35, 0.55, 0.85)
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.55, 0.85, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
scene.world = world

camera_data = bpy.data.cameras.new('Camera')
camera_data.lens = 55
camera = bpy.data.objects.new('Camera', camera_data)
camera.location = (0.75, -1.9, 0.2)
camera.rotation_euler = (Vector((0.12, 0.5, 0.0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1280, 800

for ob in scene.objects:
    ob.select_set(False)
hero.select_set(True)
bpy.context.view_layer.objects.active = hero
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'geometry-node-editor.blend'), compress=True)
