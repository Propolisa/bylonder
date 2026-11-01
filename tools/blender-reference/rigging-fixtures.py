# Writes Blender's result of rigging in Pose Mode as fixtures (tests/fixtures/rigging/*.json): each case is steps run in
# the 3D View of Blender's window (operators by their exec, values set through RNA, frame changes), and after each step
# the armature's mode, rest bones, pose, bone collections, bone colors, selection sets, constraints and F-Curves.
# usage: blender -b --factory-startup --python tools/blender-reference/rigging-fixtures.py -- OUT_DIR
import bpy, json, os, sys

out_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out_dir, exist_ok=True)

# Steps: ("op", idname, props), ("set", owner path from the object, attribute, value), ("frame", frame).
op = lambda idname, **props: ("op", idname, props)
POSE_RIG = [op("object.armature_add"), op("object.mode_set", mode="EDIT"), op("armature.extrude", forked=False),
            op("transform.translate", value=(0.5, 0, 0.5)), op("object.mode_set", mode="POSE"), op("pose.select_all", action="SELECT")]
ROOT, TIP = 'pose.bones["Bone"]', 'pose.bones["Bone.001"]'
POSED = [("set", ROOT, "location", [0.1, 0.2, 0.3]), ("set", TIP, "rotation_quaternion", [0.9, 0.1, 0.3, 0.2]),
         ("set", TIP, "scale", [1, 2, 1])]
SELECT_ROOT = [op("pose.select_all", action="DESELECT"), ("set", ROOT, "select", True)]
CASES = {
    "clears": [*POSE_RIG, *POSED, op("pose.loc_clear"), op("pose.rot_clear"), op("pose.scale_clear")],
    "copy-paste": [*POSE_RIG, *POSED, op("pose.copy"), op("pose.transforms_clear"), op("pose.paste", flipped=False),
                   op("pose.transforms_clear"), op("pose.paste", flipped=True)],
    "apply-rest": [*POSE_RIG, *POSED, op("pose.armature_apply", selected=False)],
    "collections": [*POSE_RIG, op("armature.collection_add"), *SELECT_ROOT, op("armature.collection_assign"),
                    op("armature.collection_add"), op("armature.collection_remove_unused")],
    "solo": [*POSE_RIG, op("armature.collection_add"), ("set", "data.collections[0]", "is_solo", True),
             ("set", "data.collections[1]", "is_visible", False), op("armature.collection_unsolo_all"),
             op("armature.collection_show_all")],
    "bone-color": [*POSE_RIG, ("set", ROOT + ".color", "palette", "THEME04"), ("set", "data.bones", "active", 'data.bones["Bone"]'),
                   op("armature.copy_bone_color_to_selected", bone_type="POSE")],
    "selection-sets": [*POSE_RIG, *SELECT_ROOT, op("pose.selection_set_add"), op("pose.selection_set_assign"),
                       op("pose.select_all", action="DESELECT"), op("pose.selection_set_select"), op("pose.selection_set_add"),
                       op("pose.select_all", action="SELECT"), op("pose.selection_set_assign"), op("pose.selection_set_deselect"),
                       op("pose.selection_set_remove")],
    "constraints": [*POSE_RIG, op("pose.constraint_add", type="COPY_ROTATION"), op("pose.constraint_add", type="IK"),
                    op("object.constraint_add", type="COPY_LOCATION")],
    "keying": [*POSE_RIG, op("anim.keyframe_insert"), ("frame", 10), ("set", ROOT, "rotation_quaternion", [0.7071, 0.7071, 0, 0]),
               op("anim.keyframe_insert_by_name", type="Rotation"), ("frame", 5), ("frame", 1)],
    "keying-sets": [*POSE_RIG, *SELECT_ROOT, op("anim.keyframe_insert_by_name", type="Location"), ("frame", 4),
                    op("anim.keyframe_insert_by_name", type="Scaling"), ("frame", 8),
                    op("anim.keyframe_insert_by_name", type="Available"),
                    op("anim.keyframe_insert_by_name", type="WholeCharacter")],
}

r = lambda v: [round(x, 5) for x in v]


def state(ob):
    arm = ob.data
    bones = [{"name": b.name, "head": r(b.head_local), "tail": r(b.tail_local), "collections": [c.name for c in b.collections],
              "color": b.color.palette} for b in arm.bones]
    pose = [{"name": p.name, "location": r(p.location), "rotation_quaternion": r(p.rotation_quaternion), "scale": r(p.scale),
             "select": p.select, "color": p.color.palette, "constraints": [[c.type, c.name] for c in p.constraints]} for p in ob.pose.bones]
    collections = [{"name": c.name, "is_visible": c.is_visible, "is_solo": c.is_solo} for c in arm.collections_all]
    sets = [{"name": s.name, "bones": [b.name for b in s.bone_ids]} for s in ob.selection_sets]
    fcurves = []
    if ob.animation_data and ob.animation_data.action:
        bag = ob.animation_data.action.layers[0].strips[0].channelbag(ob.animation_data.action_slot)
        fcurves = [{"data_path": f.data_path, "index": f.array_index, "group": f.group.name if f.group else None,
                    "keys": [r(k.co) for k in f.keyframe_points]} for f in bag.fcurves]
    return {"mode": ob.mode, "bones": bones, "pose": pose, "collections": collections, "selection_sets": sets,
            "active_selection_set": ob.active_selection_set, "constraints": [[c.type, c.name] for c in ob.constraints], "fcurves": fcurves}


def view3d():
    window = bpy.context.window_manager.windows[0]
    area = next(a for a in window.screen.areas if a.type == "VIEW_3D")
    return dict(window=window, area=area, region=next(r for r in area.regions if r.type == "WINDOW"))


for name, steps in CASES.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    states = []
    for step in steps:
        with bpy.context.temp_override(**view3d()):
            ob = bpy.data.objects.get("Armature")
            if step[0] == "op":
                module, idname = step[1].split(".")
                result = sorted(getattr(getattr(bpy.ops, module), idname)("EXEC_DEFAULT", **step[2]))
            elif step[0] == "set":
                owner = ob.path_resolve(step[1]) if step[1] else ob
                value = ob.path_resolve(step[3]) if isinstance(step[3], str) and step[3].startswith("data.") else step[3]
                setattr(owner, step[2], value)
                result = ["FINISHED"]
            else:
                bpy.context.scene.frame_set(step[1])
                result = ["FINISHED"]
            ob = bpy.data.objects["Armature"]
            states.append({"step": [list(s) if isinstance(s, tuple) else s for s in step], "result": result, **state(ob)})
    json.dump({"steps": states}, open(os.path.join(out_dir, name + ".json"), "w"), indent=1,
              default=lambda v: list(v))
print("rigging fixtures:", len(CASES))
