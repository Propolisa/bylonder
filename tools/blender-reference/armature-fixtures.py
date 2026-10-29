# Writes Blender's result of armature operators as fixtures (tests/fixtures/armatures/*.json): each case is steps of
# operators run by their exec, and after each step the armature's mode, its bones (edit bones in Edit Mode: head, tail,
# roll, matrix, selection) and pose bones (location, rotation, scale, evaluated matrix), and the evaluated positions of
# a mesh the Armature modifier deforms by the bones' envelopes.
# usage: blender -b --factory-startup --python tools/blender-reference/armature-fixtures.py -- OUT_DIR
import bpy, json, os, sys

out_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out_dir, exist_ok=True)

EDIT = ("object.mode_set", {"mode": "EDIT"})
POSE = ("object.mode_set", {"mode": "POSE"})
OBJECT = ("object.mode_set", {"mode": "OBJECT"})
ADD = ("object.armature_add", {})
EXTRUDE = [("armature.extrude", {"forked": False}), ("transform.translate", {"value": (0, 0.5, 1)})]
TWO_BONES = [ADD, EDIT, *EXTRUDE, OBJECT]
ROTATE = ("transform.rotate", {"value": 0.6, "orient_axis": "X", "orient_type": "GLOBAL"})
# Not an operator: selects one pose bone, as clicking it does.
SELECT = ("select", {"bone": "Bone.001"})
CASES = {
    "add": [ADD],
    "add-located": [("object.armature_add", {"location": (1, 2, 0.5), "radius": 2})],
    "edit": [ADD, EDIT],
    "extrude": [ADD, EDIT, *EXTRUDE],
    "extrude-twice": [ADD, EDIT, *EXTRUDE, *EXTRUDE, OBJECT],
    "extrude-forked": [ADD, EDIT, ("armature.extrude", {"forked": True}), ("transform.translate", {"value": (1, 0, 0)}), OBJECT],
    "move": [ADD, EDIT, ("armature.select_all", {"action": "SELECT"}), ("transform.translate", {"value": (0.25, -1, 0.5)}), OBJECT],
    "pose": [*TWO_BONES, POSE],
    "pose-rotate": [*TWO_BONES, POSE, SELECT, ROTATE],
    "pose-rotate-all": [*TWO_BONES, POSE, ("pose.select_all", {"action": "SELECT"}), ROTATE],
    "pose-move": [*TWO_BONES, POSE, SELECT, ("transform.translate", {"value": (0.5, 0, 0)})],
    "pose-rotate-clear": [*TWO_BONES, POSE, SELECT, ROTATE, ("pose.rot_clear", {})],
    "deform": [*TWO_BONES, ("deform", {}), POSE, SELECT, ROTATE],
}
# A small box around the second bone, which its envelope reaches.
BOX = [(x, y, z) for x in (-0.1, 0.1) for y in (0.4, 0.6) for z in (1.4, 1.6)]
BOX_FACES = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]

r = lambda v: [round(x, 5) for x in v]
matrix = lambda m: [r(column) for column in m.transposed()]


def bones(ob):
    arm = ob.data
    if ob.mode == "EDIT":
        return [{"name": b.name, "parent": b.parent.name if b.parent else None, "head": r(b.head), "tail": r(b.tail), "roll": round(b.roll, 5),
                 "matrix": matrix(b.matrix), "select": b.select, "select_head": b.select_head, "select_tail": b.select_tail,
                 "use_connect": b.use_connect} for b in arm.edit_bones]
    return [{"name": b.name, "parent": b.parent.name if b.parent else None, "head": r(b.head_local), "tail": r(b.tail_local),
             "matrix": matrix(b.matrix_local), "use_connect": b.use_connect} for b in arm.bones]


def pose(ob):
    if not ob.pose:
        return []
    return [{"name": p.name, "location": r(p.location), "rotation_quaternion": r(p.rotation_quaternion), "scale": r(p.scale),
             "matrix": matrix(p.matrix), "select": p.select} for p in ob.pose.bones]


def deform(ob):
    mesh = bpy.data.meshes.new("Box")
    mesh.from_pydata(BOX, [], BOX_FACES)
    box = bpy.data.objects.new("Box", mesh)
    bpy.context.collection.objects.link(box)
    modifier = box.modifiers.new("Armature", "ARMATURE")
    modifier.object = ob
    modifier.use_vertex_groups = False
    modifier.use_bone_envelopes = True
    return box


for name, steps in CASES.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    states, box = [], None
    for idname, props in steps:
        if idname == "deform":
            box = deform(bpy.context.object)
            result = ["FINISHED"]
        elif idname == "select":
            bpy.context.object.pose.bones[props["bone"]].select = True
            result = ["FINISHED"]
        else:
            module, op = idname.split(".")
            result = sorted(getattr(getattr(bpy.ops, module), op)(**props))
        ob = bpy.context.view_layer.objects.active
        if ob.type != "ARMATURE":
            ob = bpy.data.objects["Armature"]
        state = {"operator": idname, "props": {k: list(v) if isinstance(v, tuple) else v for k, v in props.items()}, "result": result,
                 "mode": ob.mode, "location": r(ob.location), "bones": bones(ob), "pose": pose(ob)}
        if box:
            evaluated = box.evaluated_get(bpy.context.evaluated_depsgraph_get())
            state["box"] = {"positions": [r(v.co) for v in evaluated.data.vertices]}
        states.append(state)
    json.dump({"box": {"positions": [list(v) for v in BOX], "faces": [list(f) for f in BOX_FACES]}, "steps": states},
              open(os.path.join(out_dir, name + ".json"), "w"), indent=1)
print("armature fixtures:", len(CASES))
