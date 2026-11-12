# Saves a rig whose collection is linked under two parents, excluded on the first path and included on the second
# (tests/fixtures/collection-two-paths.blend): Blender evaluates the rig, as it is in the view layer through the second.
# usage: blender -b --factory-startup --python tools/blender-reference/collection-two-paths-fixture.py -- OUT.blend
import bpy, sys, math

out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
rig = bpy.data.objects.new('Rig', bpy.data.armatures.new('Rig'))
shot, character = bpy.data.collections.new('Shot'), bpy.data.collections.new('Character')
scene.collection.children.link(shot)
shot.children.link(character)
scene.collection.children.link(character)
character.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
parent = rig.data.edit_bones.new('Parent')
parent.head, parent.tail = (0, 0, 0), (0, 0, 1)
child = rig.data.edit_bones.new('Child')
child.head, child.tail, child.parent = (0, 0, 0), (0, 0, 0.5), parent
bpy.ops.object.mode_set(mode='OBJECT')
bone = rig.pose.bones['Parent']
bone.rotation_mode = 'XYZ'
for frame, angle in ((1, 0), (10, math.pi / 2)):
    bone.rotation_euler = (angle, 0, 0)
    bone.keyframe_insert('rotation_euler', frame=frame)
bpy.context.view_layer.layer_collection.children['Shot'].exclude = True
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=out)
