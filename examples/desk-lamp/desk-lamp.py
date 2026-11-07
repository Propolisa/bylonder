"""Builds desk-lamp.blend: an articulated desk lamp on a writing desk at night, one mesh skinned to a four bone rig with
its spot light parented to the Head bone, posed to light the notebook and keyed to look up at the viewer, in
Blender 5.2.3.

usage: blender -b --factory-startup -P desk-lamp.py
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

# Bones of the lamp, upright at rest: name, head height, tail height, parent.
BONES = [('Base', 0.0, 0.14, None), ('Lower Arm', 0.14, 1.0, 'Base'), ('Upper Arm', 1.0, 1.8, 'Lower Arm'), ('Head', 1.8, 1.95, 'Upper Arm')]


def material(name, color, roughness=0.5, metallic=0.0, emission=0.0):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
    return mat


enamel = material('Red Enamel', (0.55, 0.04, 0.03), roughness=0.25)
steel = material('Steel', (0.7, 0.7, 0.72), roughness=0.3, metallic=1)
bulb = material('Bulb', (1, 0.85, 0.6), emission=12)
liner = material('Shade Liner', (0.95, 0.9, 0.8), roughness=0.6)

# The rig.
rig_data = bpy.data.armatures.new('Rig')
rig = bpy.data.objects.new('Rig', rig_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, head, tail, parent in BONES:
    bone = rig_data.edit_bones.new(name)
    bone.head, bone.tail = (0, 0, head), (0, 0, tail)
    if parent:
        bone.parent = rig_data.edit_bones[parent]
        bone.use_connect = True
bpy.ops.object.mode_set(mode='OBJECT')

# The lamp, one mesh: each part a primitive in the bone's vertex group, weighted fully to it.
bm = bmesh.new()
parts = []


def part(group, mat, build, matrix):
    before = set(bm.verts)
    build()
    verts = [v for v in bm.verts if v not in before]
    bmesh.ops.transform(bm, matrix=matrix, verts=verts)
    for face in {f for v in verts for f in v.link_faces}:
        face.material_index = mat
    parts.append((group, verts))


T, R = Matrix.Translation, Matrix.Rotation
cyl = lambda r1, r2, depth, segments=32, cap=True: (lambda: bmesh.ops.create_cone(bm, cap_ends=cap, segments=segments, radius1=r1, radius2=r2, depth=depth))
part('Base', 0, cyl(0.38, 0.34, 0.08, 48), T((0, 0, 0.04)))
part('Base', 1, cyl(0.06, 0.06, 0.1), T((0, 0, 0.12)))
for x in (-0.045, 0.045):
    part('Lower Arm', 1, cyl(0.018, 0.018, 0.86, 12), T((x, 0, 0.57)))
    part('Upper Arm', 1, cyl(0.016, 0.016, 0.8, 12), T((x, 0, 1.4)))
part('Lower Arm', 1, cyl(0.04, 0.04, 0.14, 24), T((0, 0, 0.14)) @ R(math.pi / 2, 4, 'Y'))
part('Upper Arm', 1, cyl(0.045, 0.045, 0.14, 24), T((0, 0, 1.0)) @ R(math.pi / 2, 4, 'Y'))
part('Head', 1, cyl(0.04, 0.04, 0.14, 24), T((0, 0, 1.8)) @ R(math.pi / 2, 4, 'Y'))
part('Head', 0, cyl(0.07, 0.08, 0.16), T((0, 0, 1.9)))
part('Head', 0, cyl(0.08, 0.3, 0.32, 48, cap=False), T((0, 0, 2.14)))
part('Head', 3, cyl(0.078, 0.295, 0.31, 48, cap=False), T((0, 0, 2.14)))
part('Head', 2, lambda: bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=0.07), T((0, 0, 2.06)))
lamp_mesh = bpy.data.meshes.new('Lamp')
bm.to_mesh(lamp_mesh)
lamp_mesh.shade_smooth()
lamp_mesh.set_sharp_from_angle(angle=math.radians(35))
lamp = bpy.data.objects.new('Lamp', lamp_mesh)
for mat in (enamel, steel, bulb, liner):
    lamp_mesh.materials.append(mat)
scene.collection.objects.link(lamp)
index = {v: i for i, v in enumerate(bm.verts)}
for group, verts in parts:
    vg = lamp.vertex_groups.get(group) or lamp.vertex_groups.new(name=group)
    vg.add([index[v] for v in verts], 1.0, 'REPLACE')
lamp.parent = rig
lamp.modifiers.new('Armature', 'ARMATURE').object = rig

# The spot light inside the shade, parented to the Head bone so it aims wherever the head is posed.
spot = bpy.data.lights.new('Lamp Light', 'SPOT')
spot.energy, spot.color, spot.shadow_soft_size = 120, (1, 0.78, 0.5), 0.06
spot.spot_size, spot.spot_blend = math.radians(70), 0.3
light = bpy.data.objects.new('Lamp Light', spot)
scene.collection.objects.link(light)
# In the bone's space (Y along the bone), past the bulb and pointing along the bone.
light.parent, light.parent_type, light.parent_bone = rig, 'BONE', 'Head'
light.matrix_basis = T((0, 0.2, 0)) @ R(math.pi / 2, 4, 'X')

# Poses: lighting the notebook, then looking up toward the viewer.
POSES = {
    'Read': {'Base': (0, 0.85, 0), 'Lower Arm': (-0.45, 0, 0), 'Upper Arm': (1.75, 0, 0), 'Head': (1.15, 0, 0)},
    'Look': {'Base': (0, 0.2, 0), 'Lower Arm': (-0.3, 0, 0), 'Upper Arm': (1.25, 0, 0), 'Head': (-0.2, 0, 0.35)},
}
for pose_bone in rig.pose.bones:
    pose_bone.rotation_mode = 'XYZ'
for frame, pose in [(1, 'Read'), (30, 'Read'), (48, 'Look'), (72, 'Look'), (96, 'Read')]:
    for name, angles in POSES[pose].items():
        rig.pose.bones[name].rotation_euler = angles
        rig.pose.bones[name].keyframe_insert('rotation_euler', frame=frame)


def add(op, name, mat, **kw):
    op(**kw)
    ob = bpy.context.object
    ob.name = ob.data.name = name
    ob.data.materials.append(mat)
    return ob


# The desk: walnut top, a ruled notebook, a pencil and a mug, against a dark blue wall.
wood = material('Desk', (0.2, 0.09, 0.04), roughness=0.4)
paper = material('Paper', (0.92, 0.9, 0.84), roughness=0.8)
nodes, links = paper.node_tree.nodes, paper.node_tree.links
lines = nodes.new('ShaderNodeTexWave')
lines.wave_type, lines.bands_direction = 'BANDS', 'Y'
lines.inputs['Scale'].default_value = 14
ramp = nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.25, 0.4, 0.7, 1)
ramp.color_ramp.elements[1].position = 0.08
ramp.color_ramp.elements[1].color = (0.92, 0.9, 0.84, 1)
links.new(nodes.new('ShaderNodeTexCoord').outputs['Object'], lines.inputs['Vector'])
links.new(lines.outputs['Fac'], ramp.inputs['Fac'])
links.new(ramp.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
cover = material('Notebook Cover', (0.08, 0.16, 0.12), roughness=0.5)
pencil_paint = material('Pencil', (0.95, 0.65, 0.05), roughness=0.35)
ceramic = material('Ceramic', (0.85, 0.82, 0.75), roughness=0.15)
wall_paint = material('Wall', (0.04, 0.06, 0.12), roughness=0.9)

add(bpy.ops.mesh.primitive_plane_add, 'Desk', wood, size=1).scale = (6, 3.5, 1)
bpy.context.object.location = (0.4, -0.4, 0)
cover_ob = add(bpy.ops.mesh.primitive_cube_add, 'Notebook', cover, size=1, location=(0.75, -0.75, 0.012))
cover_ob.scale, cover_ob.rotation_euler = (1.0, 1.3, 0.024), (0, 0, -0.25)
page = add(bpy.ops.mesh.primitive_plane_add, 'Page', paper, size=1, location=(0.75, -0.75, 0.0245))
page.scale, page.rotation_euler = (0.94, 1.24, 1), (0, 0, -0.25)
add(bpy.ops.mesh.primitive_cylinder_add, 'Pencil', pencil_paint, vertices=6, radius=0.022, depth=0.9,
    location=(1.45, -0.5, 0.025), rotation=(math.pi / 2, 0, 0.5))
mug = add(bpy.ops.mesh.primitive_cylinder_add, 'Mug', ceramic, vertices=48, radius=0.2, depth=0.42, location=(-0.95, -0.4, 0.21))
mug.modifiers.new('Bevel', 'BEVEL').width = 0.01
wall = add(bpy.ops.mesh.primitive_plane_add, 'Wall', wall_paint, size=1, location=(0.4, 1.3, 2), rotation=(math.pi / 2, 0, 0))
wall.scale = (8, 4, 1)

# Moonlight from a window to the left, faint and blue.
moon = bpy.data.objects.new('Moonlight', bpy.data.lights.new('Moonlight', 'SUN'))
moon.data.energy, moon.data.color, moon.data.angle = 0.6, (0.5, 0.6, 1), math.radians(4)
moon.rotation_euler = (math.radians(60), 0, math.radians(-70))
scene.collection.objects.link(moon)
world = bpy.data.worlds.new('Night')
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.012, 0.015, 0.03, 1)
scene.world = world

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 40
camera.location = (2.7, -3.5, 1.7)
camera.rotation_euler = (camera.location - Vector((0.2, -0.3, 0.75))).to_track_quat('Z', 'Y').to_euler()
scene.collection.objects.link(camera)
scene.camera = camera

scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'desk-lamp.blend'), compress=True)
