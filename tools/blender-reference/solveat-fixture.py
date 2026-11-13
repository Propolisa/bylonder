# Writes the two rig states tests/character-solveat-wasm.test.js patches between: the Rigged Character on the native
# rig runtime (an Action constraint on its chest), and the same with a Copy Rotation that turns its chest, and the
# head with it, as its left upper arm, as tests/fixtures/solveat-rig.blend and tests/fixtures/solveat-rig-copied.blend.
# usage: blender -b --factory-startup --python tools/blender-reference/solveat-fixture.py -- EXAMPLE_BLEND OUT_DIR
import bpy, os, sys

source, out = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.open_mainfile(filepath=source)
rig = bpy.data.objects["Rig"]
action = rig.pose.bones["chest"].constraints.new("ACTION")
action.use_eval_time, action.eval_time, action.frame_start, action.frame_end = True, 0.5, 1, 21
action.use_bone_object_action = False
action.action = rig.animation_data.action
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "solveat-rig.blend"), compress=True)
copy = rig.pose.bones["chest"].constraints.new("COPY_ROTATION")
copy.target, copy.subtarget = rig, "upper_arm.L"
bpy.context.view_layer.update()
print("head", tuple(rig.pose.bones["head"].matrix.translation))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "solveat-rig-copied.blend"), compress=True)
