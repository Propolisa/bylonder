"""Builds carousel.blend: a carousel at dusk whose six riders share two actions, Gallop and Rock, placed as strips in the
Nonlinear Animation editor with a different start on each rider, in Blender 5.2.3.

usage: blender -b --factory-startup -P carousel.py
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end, scene.render.fps = 1, 96, 24
scene.render.resolution_x, scene.render.resolution_y = 1280, 800

RIDERS, RADIUS, CYCLE = 6, 2.3, 24


def material(name, color, metallic=0.0, roughness=0.5, emission=0.0):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
    return mat


def add(op, name, mats, parent=None, **kw):
    op(**kw)
    ob = bpy.context.object
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(40))
    ob.name = ob.data.name = name
    for mat in mats:
        ob.data.materials.append(mat)
    if parent:
        ob.parent = parent
    return ob


gold = material('Gold', (1.0, 0.72, 0.32), metallic=1, roughness=0.2)
red = material('Carousel Red', (0.6, 0.04, 0.05), roughness=0.35)
cream = material('Cream', (0.9, 0.82, 0.65), roughness=0.4)
bulb = material('Bulb', (1.0, 0.75, 0.4), emission=6)
beak = material('Beak', (0.9, 0.35, 0.05), roughness=0.3)
paints = [material(f'Rider {i + 1}', c, roughness=0.2) for i, c in enumerate(
    [(0.9, 0.88, 0.82), (0.35, 0.55, 0.85), (0.95, 0.6, 0.65), (0.9, 0.88, 0.82), (0.4, 0.75, 0.6), (0.95, 0.75, 0.3)])]
ground_mat = material('Cobbles', (0.08, 0.08, 0.09), roughness=0.55)
voronoi = ground_mat.node_tree.nodes.new('ShaderNodeTexVoronoi')
voronoi.inputs['Scale'].default_value = 6
voronoi.feature = 'DISTANCE_TO_EDGE'
ramp = ground_mat.node_tree.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.01, 0.01, 0.012, 1)
ramp.color_ramp.elements[1].position = 0.12
ramp.color_ramp.elements[1].color = (0.09, 0.085, 0.08, 1)
ground_mat.node_tree.links.new(voronoi.outputs['Distance'], ramp.inputs['Fac'])
ground_mat.node_tree.links.new(ramp.outputs['Color'], ground_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])

# The turning part: platform, center column and striped canopy, all children of Platform.
platform = add(bpy.ops.mesh.primitive_cylinder_add, 'Platform', [red, gold], vertices=48, radius=3, depth=0.3, location=(0, 0, 0.35))
column = add(bpy.ops.mesh.primitive_cylinder_add, 'Column', [cream], platform, vertices=24, radius=0.35, depth=3.2, location=(0, 0, 1.6))
canopy = add(bpy.ops.mesh.primitive_cone_add, 'Canopy', [red, cream], platform, vertices=16, radius1=3.3, depth=1.2, location=(0, 0, 3.65))
for face in canopy.data.polygons:
    face.material_index = face.index % 2
valance = add(bpy.ops.mesh.primitive_cylinder_add, 'Valance', [cream], platform, vertices=48, radius=3.3, depth=0.35, location=(0, 0, 2.9), end_fill_type='NOTHING')
for i in range(32):
    a = 2 * math.pi * i / 32
    add(bpy.ops.mesh.primitive_uv_sphere_add, 'Bulb', [bulb], platform, radius=0.06, segments=12, ring_count=6,
        location=(3.34 * math.cos(a), 3.34 * math.sin(a), 2.9))
for ob in (column, canopy, valance):
    ob.location.z -= platform.location.z
for ob in platform.children:
    if ob.name.startswith('Bulb'):
        ob.location.z -= platform.location.z

# Base under the platform, not turning.
add(bpy.ops.mesh.primitive_cylinder_add, 'Base', [gold], vertices=48, radius=3.15, depth=0.2, location=(0, 0, 0.1))


def rider_mesh(name):
    """A carousel swan as one smooth mesh, centered on its pole: body, wings, an S neck, head and beak (material 1)."""
    bm = bmesh.new()

    def blob(scale, offset, tilt=0.0, beak=False):
        verts = bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1)['verts']
        bmesh.ops.scale(bm, vec=scale, verts=verts)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(tilt, 3, 'Y'), verts=verts)
        bmesh.ops.translate(bm, vec=offset, verts=verts)
        if beak:
            for face in {f for v in verts for f in v.link_faces}:
                face.material_index = 1

    blob((0.42, 0.2, 0.17), (0, 0, 0))
    blob((0.12, 0.08, 0.12), (-0.38, 0, 0.1), 0.6)
    for side in (-1, 1):
        blob((0.32, 0.04, 0.12), (-0.08, side * 0.16, 0.12), 0.45)
    for t in range(16):
        a = t / 15
        r = 0.075 - 0.02 * a
        blob((r, r * 0.9, r), (0.3 + 0.16 * math.sin(a * math.pi) - 0.05 * a, 0, 0.06 + 0.58 * a))
    blob((0.1, 0.075, 0.075), (0.3, 0, 0.66), -0.2)
    blob((0.09, 0.03, 0.03), (0.42, 0, 0.63), 0.15, beak=True)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    for p in mesh.polygons:
        p.use_smooth = True
    return mesh


def action(name, path, index, keys):
    act = bpy.data.actions.new(name)
    holder = bpy.data.objects.new(name + ' Keys', None)
    holder.animation_data_create().action = act
    for frame, value in keys:
        getattr(holder, path)[index] = value
        holder.keyframe_insert(path, index=index, frame=frame)
    for point in holder.animation_data.action.layers[0].strips[0].channelbag(holder.animation_data.action_slot).fcurves[0].keyframe_points:
        point.interpolation = 'SINE'
        point.easing = 'EASE_IN_OUT'
    holder.animation_data.action = None
    bpy.data.objects.remove(holder)
    act.use_fake_user = True
    return act


# One cycle each: Gallop raises the rider up its pole and back, Rock pitches it nose up then down.
gallop = action('Gallop', 'location', 2, [(1, -0.25), (CYCLE / 2 + 1, 0.1), (CYCLE + 1, -0.25)])
rock = action('Rock', 'rotation_euler', 1, [(1, 0.12), (CYCLE / 2 + 1, -0.12), (CYCLE + 1, 0.12)])
spin = bpy.data.actions.new('Spin')
platform.animation_data_create().action = spin
for frame, angle in [(1, 0), (97, -math.pi / 3)]:
    platform.rotation_euler.z = angle
    platform.keyframe_insert('rotation_euler', index=2, frame=frame)
fcurve = spin.layers[0].strips[0].channelbag(platform.animation_data.action_slot).fcurves[0]
for point in fcurve.keyframe_points:
    point.interpolation = 'LINEAR'
fcurve.extrapolation = 'LINEAR'
spin.use_fake_user = True


def strip(ob, track_name, act, start, blend='REPLACE'):
    track = ob.animation_data.nla_tracks.new()
    track.name = track_name
    s = track.strips.new(act.name, int(start), act)
    s.repeat = 6
    s.blend_type = blend
    s.extrapolation = 'HOLD'
    return s


# Each rider rides its pole; its strips start a quarter cycle after the previous rider's, so the six move as a wave
# from the same two actions.
for i in range(RIDERS):
    a = 2 * math.pi * i / RIDERS
    x, y = RADIUS * math.cos(a), RADIUS * math.sin(a)
    pole = add(bpy.ops.mesh.primitive_cylinder_add, f'Pole {i + 1}', [gold], platform, vertices=12, radius=0.04, depth=2.5,
               location=(x, y, 1.45))
    pole.location.z -= platform.location.z
    rider = bpy.data.objects.new(f'Rider {i + 1}', rider_mesh(f'Rider {i + 1}'))
    rider.data.materials.append(paints[i])
    rider.data.materials.append(beak)
    scene.collection.objects.link(rider)
    rider.parent = pole
    rider.rotation_euler = (0, 0, a + math.pi / 2)
    rider.animation_data_create()
    offset = 1 - CYCLE + (i * CYCLE // 4) % CYCLE
    strip(rider, 'Gallop', gallop, offset)
    strip(rider, 'Rock', rock, offset - 3, 'ADD')

ground = add(bpy.ops.mesh.primitive_plane_add, 'Square', [ground_mat], size=40)
# Lamp posts around the square, their globes glowing.
for x, y in [(-6, 5), (2, 9), (9, 3), (-10, -2)]:
    add(bpy.ops.mesh.primitive_cylinder_add, 'Lamp Post', [ground_mat], vertices=12, radius=0.07, depth=3.2, location=(x, y, 1.6))
    add(bpy.ops.mesh.primitive_uv_sphere_add, 'Globe', [bulb], radius=0.22, segments=16, ring_count=8, location=(x, y, 3.3))


def light(name, kind, location, rotation, energy, color, size):
    data = bpy.data.lights.new(name, kind)
    data.energy, data.color = energy, color
    if kind == 'SUN':
        data.angle = size
    else:
        data.shadow_soft_size = size
    if kind == 'SPOT':
        data.spot_size, data.spot_blend = math.radians(70), 0.5
    ob = bpy.data.objects.new(name, data)
    ob.location, ob.rotation_euler = location, rotation
    scene.collection.objects.link(ob)
    return ob


# Warm light under the canopy, a cool moon, a warm front light and a lamp post from the left.
light('Canopy Light', 'POINT', (0, 0, 2.5), (0, 0, 0), 1200, (1, 0.7, 0.4), 0.8)
light('Moon', 'SUN', (0, 0, 10), (math.radians(55), 0, math.radians(150)), 0.8, (0.55, 0.65, 1), math.radians(2))
front = light('Front', 'SPOT', (7, -9, 5), (0, 0, 0), 4000, (1, 0.85, 0.65), 0.5)
front.rotation_euler = (front.location - Vector((0, 0, 1.5))).to_track_quat('Z', 'Y').to_euler()
light('Lamp Post', 'SPOT', (-7, -5, 6), (math.radians(55), 0, math.radians(-55)), 7000, (1, 0.8, 0.55), 0.3)

world = bpy.data.worlds.new('Dusk')
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.03, 0.035, 0.08, 1)
scene.world = world

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 32
camera.location = (5.2, -6.6, 1.5)
camera.rotation_euler = (camera.location - Vector((0, 0, 1.6))).to_track_quat('Z', 'Y').to_euler()
scene.collection.objects.link(camera)
scene.camera = camera

scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
rider = bpy.data.objects['Rider 1']
rider.select_set(True)
bpy.context.view_layer.objects.active = rider
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'carousel.blend'), compress=True)
