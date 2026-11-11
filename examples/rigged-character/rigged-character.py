"""Builds rigged-character.blend: a figure skinned to a humanoid armature by automatic weights, for posing. Its arms
and legs reach for IK targets with pole targets, its head looks at an empty within limits, and its hands turn with
their IK targets; an animation waves, crouches and looks around.

usage: blender -b --factory-startup -P rigged-character.py
"""
import bpy, math, os
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
# Joints of a simple figure, and the bones between them (name, head, tail, parent).
J = {'hips': (0, 0, 1.0), 'chest': (0, 0, 1.45), 'neck': (0, 0, 1.7), 'head': (0, 0, 2.05),
     'shoulder.L': (0.22, 0, 1.6), 'elbow.L': (0.55, 0.04, 1.45), 'hand.L': (0.85, 0, 1.3), 'fingers.L': (0.97, 0, 1.25),
     'shoulder.R': (-0.22, 0, 1.6), 'elbow.R': (-0.55, 0.04, 1.45), 'hand.R': (-0.85, 0, 1.3), 'fingers.R': (-0.97, 0, 1.25),
     'hip.L': (0.12, 0, 0.95), 'knee.L': (0.14, -0.04, 0.5), 'foot.L': (0.15, 0, 0.05),
     'hip.R': (-0.12, 0, 0.95), 'knee.R': (-0.14, -0.04, 0.5), 'foot.R': (-0.15, 0, 0.05)}
BONES = [('spine', 'hips', 'chest', None), ('chest', 'chest', 'neck', 'spine'), ('head', 'neck', 'head', 'chest'),
         ('upper_arm.L', 'shoulder.L', 'elbow.L', 'chest'), ('forearm.L', 'elbow.L', 'hand.L', 'upper_arm.L'),
         ('upper_arm.R', 'shoulder.R', 'elbow.R', 'chest'), ('forearm.R', 'elbow.R', 'hand.R', 'upper_arm.R'),
         ('hand.L', 'hand.L', 'fingers.L', 'forearm.L'), ('hand.R', 'hand.R', 'fingers.R', 'forearm.R'),
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
radius = {'head': 0.17, 'neck': 0.07, 'chest': 0.17, 'hips': 0.15, 'hand.L': 0.05, 'hand.R': 0.05, 'fingers.L': 0.04, 'fingers.R': 0.04, 'foot.L': 0.06, 'foot.R': 0.06}
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
# Controls that deform nothing, added after skinning so they have no vertex groups: IK targets at the hands and feet,
# pole targets behind the elbows and in front of the knees.
CONTROLS = {'hand_ik.L': ('hand.L', (0.12, 0, 0)), 'hand_ik.R': ('hand.R', (-0.12, 0, 0)),
            'foot_ik.L': ('foot.L', (0, -0.15, 0)), 'foot_ik.R': ('foot.R', (0, -0.15, 0))}
POLES = {'elbow_pole.L': (0.55, 0.6, 1.45), 'elbow_pole.R': (-0.55, 0.6, 1.45), 'knee_pole.L': (0.14, -0.6, 0.5), 'knee_pole.R': (-0.14, -0.6, 0.5)}
bpy.ops.object.mode_set(mode='EDIT')
for name, (joint, tail) in CONTROLS.items():
    b = arm_data.edit_bones.new(name)
    b.head = J[joint]
    b.tail = Vector(J[joint]) + Vector(tail)
    b.use_deform = False
for name, at in POLES.items():
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = at, Vector(at) + Vector((0, 0, 0.1))
    b.use_deform = False
# The pole angle that keeps each chain's rest pose: its root bone's X axis turned toward the pole.
pole_angles = {}
for chain, pole in (('upper_arm', 'elbow_pole'), ('thigh', 'knee_pole')):
    for side in 'LR':
        root = arm_data.edit_bones[f'{chain}.{side}']
        x, z = root.matrix.col[0].xyz, root.matrix.col[2].xyz
        to_pole = Vector(POLES[f'{pole}.{side}']) - root.head
        pole_angles[f'{chain}.{side}'] = math.atan2(to_pole.dot(z), to_pole.dot(x))
bpy.ops.object.mode_set(mode='OBJECT')
look = bpy.data.objects.new('Look', None)
look.empty_display_type = 'SPHERE'
look.empty_display_size = 0.08
look.location = (0, -2, 1.85)
scene.collection.objects.link(look)
for side in 'LR':
    for owner, root, target, pole in ((f'forearm.{side}', f'upper_arm.{side}', f'hand_ik.{side}', f'elbow_pole.{side}'),
                                      (f'shin.{side}', f'thigh.{side}', f'foot_ik.{side}', f'knee_pole.{side}')):
        ik = rig.pose.bones[owner].constraints.new('IK')
        ik.target, ik.subtarget, ik.pole_target, ik.pole_subtarget = rig, target, rig, pole
        ik.pole_angle, ik.chain_count = pole_angles[root], 2
    turn = rig.pose.bones[f'hand.{side}'].constraints.new('COPY_ROTATION')
    turn.target, turn.subtarget = rig, f'hand_ik.{side}'
head = rig.pose.bones['head']
track = head.constraints.new('DAMPED_TRACK')
track.target = look
# The head's forward axis: the one of its local Z axes that points to -Y, the front.
track.track_axis = 'TRACK_NEGATIVE_Z' if arm_data.bones['head'].matrix_local.col[2].y > 0 else 'TRACK_Z'
limit = head.constraints.new('LIMIT_ROTATION')
limit.owner_space = 'LOCAL'
limit.use_limit_x = limit.use_limit_z = True
limit.min_x, limit.max_x, limit.min_z, limit.max_z = -0.35, 0.35, -0.7, 0.7
# The animation: the left hand waves, the hips crouch with the feet planted, the head follows the empty.
scene.frame_start, scene.frame_end = 1, 72
def key(owner, frame, location):
    owner.location = location
    owner.keyframe_insert('location', frame=frame)
def move(bone, frame, offset):
    """Keys a pose bone's location at an offset in the armature's axes."""
    key(rig.pose.bones[bone], frame, arm_data.bones[bone].matrix_local.to_3x3().inverted() @ Vector(offset))
for frame, x, z in ((1, 0, 0), (18, -0.25, 0.45), (30, -0.15, 0.55), (42, -0.25, 0.45), (60, 0, 0), (72, 0, 0)):
    move('hand_ik.L', frame, (x, -0.1 * z, z))
for frame, z in ((1, 0), (24, 0), (40, -0.25), (56, 0), (72, 0)):
    move('spine', frame, (0, 0, z))
for frame, x in ((1, -1.2), (36, 1.4), (72, -1.2)):
    key(look, frame, (x, -2, 1.85 + 0.15 * abs(x)))
scene.frame_set(1)
# The file opens with the rig alone selected, as clicking it selects it.
body.select_set(False)
look.select_set(False)
cam_data = bpy.data.cameras.new('Camera'); cam_data.lens = 50
cam = bpy.data.objects.new('Camera', cam_data); scene.collection.objects.link(cam)
cam.location = (0, -6.5, 1.3); cam.rotation_euler = (1.5708, 0, 0); scene.camera = cam
light = bpy.data.objects.new('Key', bpy.data.lights.new('Key', 'AREA')); light.data.energy = 500; light.data.size = 3
light.location = (2.5, -3, 3.5); light.rotation_euler = (0.9, 0.2, 0.6); scene.collection.objects.link(light)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rigged-character.blend'), compress=True)
