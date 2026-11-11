"""Builds rigged-character.blend: a figure skinned to a humanoid armature by automatic weights, for posing. Its arms
and legs reach for IK targets with pole targets, its head looks at an empty within limits, and its hands turn with
their IK targets; a tail is one B-Bone of eight segments that curls; an animation waves, crouches, looks around and
swishes the tail. Custom properties on the rig switch the
left arm between IK and FK and swell the chest; a corrective shape key keeps the left elbow's volume as it bends.

usage: blender -b --factory-startup -P rigged-character.py
"""
import bpy, math, os
from mathutils import Quaternion, Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
# Joints of a simple figure, and the bones between them (name, head, tail, parent).
J = {'hips': (0, 0, 1.0), 'chest': (0, 0, 1.45), 'neck': (0, 0, 1.7), 'head': (0, 0, 2.05),
     'shoulder.L': (0.22, 0, 1.6), 'elbow.L': (0.55, 0.04, 1.45), 'hand.L': (0.85, 0, 1.3), 'fingers.L': (0.97, 0, 1.25),
     'shoulder.R': (-0.22, 0, 1.6), 'elbow.R': (-0.55, 0.04, 1.45), 'hand.R': (-0.85, 0, 1.3), 'fingers.R': (-0.97, 0, 1.25),
     'hip.L': (0.12, 0, 0.95), 'knee.L': (0.14, -0.04, 0.5), 'foot.L': (0.15, 0, 0.05),
     'hip.R': (-0.12, 0, 0.95), 'knee.R': (-0.14, -0.04, 0.5), 'foot.R': (-0.15, 0, 0.05),
     'tail_root': (0, 0.13, 0.98), 'tail_tip': (0, 0.85, 0.8)}
BONES = [('spine', 'hips', 'chest', None), ('chest', 'chest', 'neck', 'spine'), ('head', 'neck', 'head', 'chest'),
         ('upper_arm.L', 'shoulder.L', 'elbow.L', 'chest'), ('forearm.L', 'elbow.L', 'hand.L', 'upper_arm.L'),
         ('upper_arm.R', 'shoulder.R', 'elbow.R', 'chest'), ('forearm.R', 'elbow.R', 'hand.R', 'upper_arm.R'),
         ('hand.L', 'hand.L', 'fingers.L', 'forearm.L'), ('hand.R', 'hand.R', 'fingers.R', 'forearm.R'),
         ('thigh.L', 'hip.L', 'knee.L', 'spine'), ('shin.L', 'knee.L', 'foot.L', 'thigh.L'),
         ('thigh.R', 'hip.R', 'knee.R', 'spine'), ('shin.R', 'knee.R', 'foot.R', 'thigh.R'), ('tail', 'tail_root', 'tail_tip', 'spine')]
# Points along the tail, so that its skin has loops to bend at.
TAIL = [Vector(J['tail_root']).lerp(Vector(J['tail_tip']), i / 6) for i in range(1, 6)]
# The body: a Skin modifier over the same skeleton as edges, smoothed, applied.
names = list(J)
mesh = bpy.data.meshes.new('Body')
edges = [(names.index(h), names.index(t)) for _, h, t, _ in BONES] + [(names.index('chest'), names.index('shoulder.L')), (names.index('chest'), names.index('shoulder.R')), (names.index('hips'), names.index('hip.L')), (names.index('hips'), names.index('hip.R'))]
tail = [names.index('tail_root'), *range(len(names), len(names) + len(TAIL)), names.index('tail_tip')]
edges = [e for e in edges if set(e) != {tail[0], tail[-1]}] + [(names.index('hips'), tail[0])] + list(zip(tail, tail[1:]))
mesh.from_pydata([J[n] for n in names] + [tuple(p) for p in TAIL], edges, [])
body = bpy.data.objects.new('Body', mesh)
scene.collection.objects.link(body)
bpy.context.view_layer.objects.active = body
body.select_set(True)
skin = body.modifiers.new('Skin', 'SKIN')
radius = {'head': 0.17, 'neck': 0.07, 'chest': 0.17, 'hips': 0.15, 'hand.L': 0.05, 'hand.R': 0.05, 'fingers.L': 0.04, 'fingers.R': 0.04, 'foot.L': 0.06, 'foot.R': 0.06,
          'tail_root': 0.05, 'tail_tip': 0.015}
for i, n in enumerate(names):
    r = radius.get(n, 0.07)
    mesh.skin_vertices[0].data[i].radius = (r, r)
for k, i in enumerate(tail[1:-1], 1):
    r = 0.05 - 0.035 * k / 6
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
arm_data.edit_bones['tail'].bbone_segments = 8
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
# The tail swishes side to side, curling against the swing.
tail_bone = rig.pose.bones['tail']
for frame, side in ((1, 0), (18, 1), (36, 0), (54, -1), (72, 0)):
    tail_bone.rotation_quaternion = Quaternion((0, 0, 1), 0.5 * side)
    tail_bone.bbone_curveinx, tail_bone.bbone_curveoutx = -0.15 * side, 0.3 * side
    tail_bone.keyframe_insert('rotation_quaternion', frame=frame)
    tail_bone.keyframe_insert('bbone_curveinx', frame=frame)
    tail_bone.keyframe_insert('bbone_curveoutx', frame=frame)
# Rig controls: custom properties on the rig, which drivers read. ik_fk.L blends the left arm between FK and IK (the
# IK constraint's influence); breathe swells the chest (a shape key); the left elbow keeps its volume when it bends
# (a corrective shape key driven by the angle between upper arm and forearm).
def driver(owner, path, expression, variables, index=-1):
    fc = owner.driver_add(path, index) if index >= 0 else owner.driver_add(path)
    fc.driver.type = 'SCRIPTED'
    fc.driver.expression = expression
    for name, kind, targets in variables:
        v = fc.driver.variables.new()
        v.name, v.type = name, kind
        for t, settings in zip(v.targets, targets):
            for k, value in settings.items():
                setattr(t, k, value)
    return fc
rig['ik_fk.L'] = 1.0
rig.id_properties_ui('ik_fk.L').update(min=0.0, max=1.0, description='Left arm: 0 FK, 1 IK')
rig['breathe'] = 0.0
rig.id_properties_ui('breathe').update(min=0.0, max=1.0, description='Chest breath')
driver(rig, 'pose.bones["forearm.L"].constraints["IK"].influence', 'switch',
       [('switch', 'SINGLE_PROP', [{'id_type': 'OBJECT', 'id': rig, 'data_path': '["ik_fk.L"]'}])])
body.shape_key_add(name='Basis')
breathe = body.shape_key_add(name='Breathe', from_mix=False)
elbow = body.shape_key_add(name='Elbow.L', from_mix=False)
chest, elbow_at = Vector(J['chest']) + Vector((0, 0, 0.08)), Vector(J['elbow.L'])
for i, v in enumerate(mesh.vertices):
    d = (v.co - chest).length
    if d < 0.25:
        out = Vector((v.co.x - chest.x, v.co.y - chest.y, 0))
        breathe.data[i].co = v.co + out * 0.25 * (1 - d / 0.25)
    d = (v.co - elbow_at).length
    if d < 0.12:
        elbow.data[i].co = v.co + (v.co - elbow_at).normalized() * 0.03 * (1 - d / 0.12)
key = mesh.shape_keys
driver(key, 'key_blocks["Breathe"].value', 'breathe', [('breathe', 'SINGLE_PROP', [{'id_type': 'OBJECT', 'id': rig, 'data_path': '["breathe"]'}])])
driver(key, 'key_blocks["Elbow.L"].value', 'min(bend / 1.2, 1)', [('bend', 'ROTATION_DIFF', [{'id': rig, 'bone_target': 'upper_arm.L'}, {'id': rig, 'bone_target': 'forearm.L'}])])
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
