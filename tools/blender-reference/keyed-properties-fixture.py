# Saves a rig whose integer and boolean custom properties are keyed (tests/fixtures/keyed-properties.blend), as a rig's
# IK parent switch and a toggle are: an int on a pose bone (0 to 3) keyed linearly from 0 at frame 1 to 4 at frame 11,
# past its maximum, and a bool on the armature object keyed off at frame 1 and on at frame 6; a cube the rig skins, so
# that the export draws its skeleton, and a camera.
# usage: blender -b --factory-startup --python tools/blender-reference/keyed-properties-fixture.py -- OUT.blend
import bpy, sys

out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
rig = bpy.data.objects.new('Rig', bpy.data.armatures.new('Rig'))
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
bone = rig.data.edit_bones.new('Properties')
bone.head, bone.tail = (0, 0, 0), (0, 0, 1)
bpy.ops.object.mode_set(mode='OBJECT')
pose = rig.pose.bones['Properties']
pose['ik_parents'] = 0
pose.id_properties_ui('ik_parents').update(min=0, max=3)
rig['toggle'] = False
for frame, value in ((1, 0), (11, 4)):
    pose['ik_parents'] = value
    rig.keyframe_insert('pose.bones["Properties"]["ik_parents"]', frame=frame)
for frame, value in ((1, False), (6, True)):
    rig['toggle'] = value
    rig.keyframe_insert('["toggle"]', frame=frame)
ad = rig.animation_data
for fc in ad.action.layers[0].strips[0].channelbag(ad.action_slot).fcurves:
    if fc.data_path.endswith('["ik_parents"]'):
        for key in fc.keyframe_points:
            key.interpolation = 'LINEAR'
bpy.ops.mesh.primitive_cube_add(size=0.5)
cube = bpy.context.active_object
cube.vertex_groups.new(name='Properties').add(range(len(cube.data.vertices)), 1.0, 'REPLACE')
cube.modifiers.new('Armature', 'ARMATURE').object = rig
camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
bpy.context.scene.collection.objects.link(camera)
camera.location = (0, -6, 1)
camera.rotation_euler = (1.5708, 0, 0)
bpy.context.scene.camera = camera
bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 12
bpy.ops.wm.save_as_mainfile(filepath=out)
