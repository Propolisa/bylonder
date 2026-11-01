# Writes what Blender's armature overlay draws from, as a fixture (tests/fixtures/armature-draw.json): a chain of three
# bones whose middle one is a B-Bone of four curved segments, posed, with names and axes shown; per bone its pose matrix,
# length, envelope radii and B-Bone segment points (bbone_segment_matrix, the points the overlay's segments start at),
# the edit bones' matrices, and the theme colors the overlay reads.
# usage: blender -b --factory-startup --python tools/blender-reference/armature-draw-fixtures.py -- OUT_FILE
import bpy, json, sys

out = sys.argv[sys.argv.index("--") + 1]
r = lambda v: [round(x, 5) for x in v]
matrix = lambda m: [r(column) for column in m.transposed()]

bpy.ops.object.armature_add()
ob = bpy.context.object
bpy.ops.object.mode_set(mode="EDIT")
for _ in range(2):
    bpy.ops.armature.extrude(forked=False)
    bpy.ops.transform.translate(value=(0, 0.5, 1))
# An unconnected child, which the overlay links to its parent by a relationship line.
arm = ob.data
arm.edit_bones["Bone.002"].use_connect = False
arm.edit_bones["Bone.002"].head = (0, 0.5, 2.2)
bpy.ops.object.mode_set(mode="OBJECT")
bone = arm.bones["Bone.001"]
bone.bbone_segments = 4
bone.bbone_curveinx = 0.3
bone.bbone_curveoutz = -0.2
arm.show_names = True
arm.show_axes = True
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.select_all(action="DESELECT")
ob.pose.bones["Bone.001"].select = True
arm.bones.active = arm.bones["Bone.001"]
bpy.ops.transform.rotate(value=0.6, orient_axis="X", orient_type="GLOBAL")
bpy.context.view_layer.update()

theme = bpy.context.preferences.themes[0].view_3d
fixture = {
    "matrix_world": matrix(ob.matrix_world),
    "pose": [{"name": p.name, "matrix": matrix(p.matrix), "length": round(p.bone.length, 5), "head": r(p.head), "tail": r(p.tail),
              "segments": p.bone.bbone_segments, "head_radius": round(p.bone.head_radius, 5), "tail_radius": round(p.bone.tail_radius, 5),
              "envelope_distance": round(p.bone.envelope_distance, 5), "bbone_x": round(p.bone.bbone_x, 5), "bbone_z": round(p.bone.bbone_z, 5),
              "select": p.select, "use_connect": p.bone.use_connect,
              "bbone_points": [r(p.bbone_segment_matrix(i).translation) for i in range(p.bone.bbone_segments + 1)] if p.bone.bbone_segments > 1 else []}
             for p in ob.pose.bones],
    "theme": {name: r(getattr(theme, name)) for name in ("bone_solid", "bone_pose", "bone_pose_active", "vertex", "vertex_select", "edge_select",
                                                        "wire", "wire_edit", "object_active", "object_selected")},
    "text": r(theme.space.text), "text_hi": r(theme.space.text_hi),
}
bpy.ops.object.mode_set(mode="EDIT")
fixture["edit"] = [{"name": b.name, "matrix": matrix(b.matrix), "length": round(b.length, 5), "select": b.select, "select_head": b.select_head,
                    "select_tail": b.select_tail} for b in arm.edit_bones]
json.dump(fixture, open(out, "w"), indent=1)
