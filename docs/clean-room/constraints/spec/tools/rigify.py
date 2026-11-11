# Generates a Rigify human rig in an empty scene and saves it.
import bpy, sys
out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.preferences.addon_enable(module="rigify")
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
bpy.ops.object.armature_human_metarig_add()
bpy.ops.pose.rigify_generate()
bpy.ops.wm.save_as_mainfile(filepath=out)
