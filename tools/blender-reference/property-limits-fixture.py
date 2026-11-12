# Saves a rig with custom properties that carry hard limits (tests/fixtures/property-limits.blend): an int on a pose
# bone (0 to 3) and a float on the armature object (-1 to 2), as a rig's IK parent switch and a slider have them.
# usage: blender -b --factory-startup --python tools/blender-reference/property-limits-fixture.py -- OUT.blend
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
pose['ik_parents'] = 1
pose.id_properties_ui('ik_parents').update(min=0, max=3)
rig['slider'] = 0.5
rig.id_properties_ui('slider').update(min=-1.0, max=2.0)
bpy.ops.wm.save_as_mainfile(filepath=out)
