"""Builds rigged-character.blend: a figure skinned to a humanoid armature by automatic weights, for posing.

usage: blender -b --factory-startup -P rigged-character.py
"""
import bpy, os
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
# Joints of a simple figure, and the bones between them (name, head, tail, parent).
J = {'hips': (0, 0, 1.0), 'chest': (0, 0, 1.45), 'neck': (0, 0, 1.7), 'head': (0, 0, 2.05),
     'shoulder.L': (0.22, 0, 1.6), 'elbow.L': (0.55, 0, 1.45), 'hand.L': (0.85, 0, 1.3),
     'shoulder.R': (-0.22, 0, 1.6), 'elbow.R': (-0.55, 0, 1.45), 'hand.R': (-0.85, 0, 1.3),
     'hip.L': (0.12, 0, 0.95), 'knee.L': (0.14, 0, 0.5), 'foot.L': (0.15, 0, 0.05),
     'hip.R': (-0.12, 0, 0.95), 'knee.R': (-0.14, 0, 0.5), 'foot.R': (-0.15, 0, 0.05)}
BONES = [('spine', 'hips', 'chest', None), ('chest', 'chest', 'neck', 'spine'), ('head', 'neck', 'head', 'chest'),
         ('upper_arm.L', 'shoulder.L', 'elbow.L', 'chest'), ('forearm.L', 'elbow.L', 'hand.L', 'upper_arm.L'),
         ('upper_arm.R', 'shoulder.R', 'elbow.R', 'chest'), ('forearm.R', 'elbow.R', 'hand.R', 'upper_arm.R'),
         ('thigh.L', 'hip.L', 'knee.L', 'spine'), ('shin.L', 'knee.L', 'foot.L', 'thigh.L'),
         ('thigh.R', 'hip.R', 'knee.R', 'spine'), ('shin.R', 'knee.R', 'foot.R', 'thigh.R')]
# The body: a Skin modifier over the same skeleton as edges, smoothed, applied.
names = list(J)
mesh = bpy.data.meshes.new('Body')
edges = [(names.index(h), names.index(t)) for _, h, t, _ in BONES] + [(names.index('chest'), names.index('shoulder.L')), (names.index('chest'), names.index('shoulder.R')), (names.index('hips'), names.index('hip.L')), (names.index('hips'), names.index('hip.R'))]
mesh.from_pydata([J[n] for n in names], edges, [])
body = bpy.data.objects.new('Body', mesh)
scene.collection.objects.link(body)
bpy.context.view_layer.objects.active = body
body.select_set(True)
skin = body.modifiers.new('Skin', 'SKIN')
radius = {'head': 0.17, 'neck': 0.07, 'chest': 0.17, 'hips': 0.15, 'hand.L': 0.05, 'hand.R': 0.05, 'foot.L': 0.06, 'foot.R': 0.06}
for i, n in enumerate(names):
    r = radius.get(n, 0.07)
    mesh.skin_vertices[0].data[i].radius = (r, r)
mesh.skin_vertices[0].data[names.index('hips')].use_root = True
body.modifiers.new('Subdivision', 'SUBSURF').levels = 2
bpy.ops.object.modifier_apply(modifier='Skin')
bpy.ops.object.modifier_apply(modifier='Subdivision')
bpy.ops.object.shade_smooth()
mat = bpy.data.materials.new('Skin')
mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.75, 0.45, 0.32, 1)
mesh.materials.append(mat)
# The armature.
arm_data = bpy.data.armatures.new('Rig')
rig = bpy.data.objects.new('Rig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, h, t, parent in BONES:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = J[h], J[t]
    if parent:
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = (Vector(arm_data.edit_bones[parent].tail) - Vector(b.head)).length < 1e-4
bpy.ops.object.mode_set(mode='OBJECT')
arm_data.display_type = 'OCTAHEDRAL'
rig.show_in_front = True
# Skin to the rig with automatic weights, as Ctrl P > With Automatic Weights.
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
cam_data = bpy.data.cameras.new('Camera'); cam_data.lens = 50
cam = bpy.data.objects.new('Camera', cam_data); scene.collection.objects.link(cam)
cam.location = (0, -6.5, 1.3); cam.rotation_euler = (1.5708, 0, 0); scene.camera = cam
light = bpy.data.objects.new('Key', bpy.data.lights.new('Key', 'AREA')); light.data.energy = 500; light.data.size = 3
light.location = (2.5, -3, 3.5); light.rotation_euler = (0.9, 0.2, 0.6); scene.collection.objects.link(light)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rigged-character.blend'), compress=True)
