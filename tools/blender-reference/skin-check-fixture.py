# Writes tests/fixtures/skin-check-rig.blend for tests/export-skin-check-clips-wasm.test.js: a rig on the native rig
# runtime (an Action constraint with no influence) whose B-Bone a tube is weighted to, a Corrective Smooth after its
# Armature. Its timeline action holds the B-Bone straight, where the smooth does nothing; a second action, shipped as a
# clip from a muted NLA track, bends it, where Babylon's skin, which leaves the smooth out, misses Blender's.
# usage: blender -b --factory-startup --python tools/blender-reference/skin-check-fixture.py -- OUT_DIR
import bpy, bmesh, os, sys

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, 10
arm = bpy.data.armatures.new("Rig")
rig = bpy.data.objects.new("Rig", arm)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
root = arm.edit_bones.new("root")
root.head, root.tail = (0, 0, 0), (0, 0, 0.5)
bend = arm.edit_bones.new("bend")
bend.head, bend.tail, bend.parent, bend.use_connect = (0, 0, 0.5), (0, 0, 2), root, True
bend.bbone_segments = 8
bpy.ops.object.mode_set(mode="OBJECT")
# The tube along the B-Bone, weighted to it alone.
mesh = bpy.data.meshes.new("Tube")
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.15, radius2=0.15, depth=1.5)
bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 1.25))
bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1], cuts=12, use_grid_fill=True)
bm.to_mesh(mesh)
tube = bpy.data.objects.new("Tube", mesh)
scene.collection.objects.link(tube)
group = tube.vertex_groups.new(name="bend")
group.add(range(len(mesh.vertices)), 1.0, "REPLACE")
tube.modifiers.new("Armature", "ARMATURE").object = rig
# A Corrective Smooth after it, which Babylon's skin leaves out: nothing to smooth while the B-Bone is straight.
smooth = tube.modifiers.new("Smooth", "CORRECTIVE_SMOOTH")
smooth.factor, smooth.iterations = 0.8, 8
tube.parent = rig
# A base Babylon skins plainly, on the root.
base_mesh = bpy.data.meshes.new("Base")
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=0.4)
bm.to_mesh(base_mesh)
base = bpy.data.objects.new("Base", base_mesh)
scene.collection.objects.link(base)
base.vertex_groups.new(name="root").add(range(len(base_mesh.vertices)), 1.0, "REPLACE")
base.modifiers.new("Armature", "ARMATURE").object = rig
base.parent = rig
# The timeline's action holds the B-Bone straight; the clip's bends it.
rig.animation_data_create()
def action(name, curve):
    act = bpy.data.actions.new(name)
    rig.animation_data.action = act
    pose = rig.pose.bones["bend"]
    for frame, value in ((1, 0.0), (10, curve)):
        pose.bbone_curveinx = pose.bbone_curveoutx = value
        pose.keyframe_insert("bbone_curveinx", frame=frame)
        pose.keyframe_insert("bbone_curveoutx", frame=frame)
    return act
bent = action("Bend", 0.6)
still = action("Still", 0.0)
track = rig.animation_data.nla_tracks.new()
track.strips.new("Bend", 1, bent)
track.mute = True
rig.animation_data.action = still
constraint = rig.pose.bones["root"].constraints.new("ACTION")
constraint.use_eval_time, constraint.eval_time, constraint.frame_start, constraint.frame_end = True, 0.5, 1, 10
constraint.use_bone_object_action, constraint.action, constraint.influence = False, bent, 0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "skin-check-rig.blend"), compress=True)
print("written", len(mesh.vertices), "vertices")
