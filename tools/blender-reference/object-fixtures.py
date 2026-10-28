# Writes Blender's result of Object Mode operators on scenes of cubes and empties as fixtures
# (tests/fixtures/objects/*.json): each object's transform, parent inverse and world matrix, and each mesh's positions and
# corners in Blender's element order, before and after the operator, with its properties and result.
# usage: blender -b --factory-startup --python tools/blender-reference/object-fixtures.py -- OUT_DIR
import bpy, json, os, sys

out_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out_dir, exist_ok=True)

# Objects: name, type (MESH is a default cube with its first vertex moved, so it is not symmetric), transform, parent,
# selected; the last selected is active unless the case names one.
TRANSFORMED = {"location": (1, 2, 3), "rotation_mode": "YXZ", "rotation_euler": (0.3, 0.5, 0.7), "scale": (2, 1, 0.5)}
CUBE = {"name": "Cube", "type": "MESH", **TRANSFORMED}
PARENT = {"name": "Parent", "type": "MESH", "location": (0, 1, 0), "rotation_mode": "YXZ", "rotation_euler": (0, 0, 0.8), "scale": (1.5, 1.5, 1.5)}
CHILD = {"name": "Child", "type": "MESH", "parent": "Parent", "location": (2, 0, 0), "rotation_mode": "YXZ", "rotation_euler": (0.2, 0, 0),
         "scale": (1, 2, 1), "select": False}
EMPTY = {"name": "Empty", "type": "EMPTY", "location": (0, 0, 1), "rotation_mode": "YXZ", "rotation_euler": (0, 0.4, 0), "scale": (2, 3, 1)}
APPLY = "object.transform_apply"
CASES = {
    "apply-all": ([CUBE], APPLY, {}),
    "apply-location": ([CUBE], APPLY, {"rotation": False, "scale": False}),
    "apply-rotation": ([CUBE], APPLY, {"location": False, "scale": False}),
    "apply-scale": ([CUBE], APPLY, {"location": False, "rotation": False}),
    "apply-rotation-scale": ([CUBE], APPLY, {"location": False}),
    "apply-location-rotation": ([CUBE], APPLY, {"scale": False}),
    "apply-location-scale": ([CUBE], APPLY, {"rotation": False}),
    "apply-nothing": ([CUBE], APPLY, {"location": False, "rotation": False, "scale": False}),
    "apply-negative-scale": ([{**CUBE, "scale": (-1, 2, 1)}], APPLY, {}),
    "apply-negative-scale-no-flip": ([{**CUBE, "scale": (-1, 2, 1)}], APPLY, {"corrective_flip_normals": False}),
    "apply-quaternion": ([{**CUBE, "rotation_mode": "QUATERNION", "rotation_quaternion": (0.8, 0.2, -0.4, 0.4)}], APPLY, {}),
    "apply-xyz": ([{**CUBE, "rotation_mode": "XYZ"}], APPLY, {"location": False}),
    "apply-parent": ([PARENT, CHILD], APPLY, {}),
    "apply-parent-rotation": ([PARENT, CHILD], APPLY, {"location": False, "scale": False}),
    "apply-parent-and-child": ([PARENT, {**CHILD, "select": True}], APPLY, {}),
    "apply-empty": ([EMPTY, {**CHILD, "parent": "Empty"}], APPLY, {"location": False}),
    "apply-unselected": ([{**CUBE, "select": False}], APPLY, {}),
    "location-clear": ([CUBE, {**PARENT, "select": False}], "object.location_clear", {}),
    "rotation-clear": ([CUBE], "object.rotation_clear", {}),
    "rotation-clear-quaternion": ([{**CUBE, "rotation_mode": "QUATERNION", "rotation_quaternion": (0.8, 0.2, -0.4, 0.4)}], "object.rotation_clear", {}),
    "scale-clear": ([CUBE], "object.scale_clear", {}),
    "scale-clear-parent": ([PARENT, CHILD], "object.scale_clear", {}),
    "origin-geometry": ([CUBE], "object.origin_set", {"type": "ORIGIN_GEOMETRY"}),
    "origin-geometry-bounds": ([CUBE], "object.origin_set", {"type": "ORIGIN_GEOMETRY", "center": "BOUNDS"}),
    "origin-geometry-parent": ([PARENT, CHILD], "object.origin_set", {"type": "ORIGIN_GEOMETRY"}),
    "geometry-origin": ([CUBE], "object.origin_set", {"type": "GEOMETRY_ORIGIN"}),
    "origin-cursor": ([CUBE], "object.origin_set", {"type": "ORIGIN_CURSOR"}),
    "origin-center-of-mass": ([CUBE], "object.origin_set", {"type": "ORIGIN_CENTER_OF_MASS"}),
    "origin-center-of-volume": ([CUBE], "object.origin_set", {"type": "ORIGIN_CENTER_OF_VOLUME"}),
}
CURSOR = (0.5, -1, 2)

r = lambda v: [round(x, 5) for x in v]
matrix = lambda m: [r(column) for column in m.transposed()]


def build(objects):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.cursor.location = CURSOR
    made = {}
    for spec in objects:
        if spec["type"] == "MESH":
            bpy.ops.mesh.primitive_cube_add()
            ob = bpy.context.object
            ob.data.vertices[0].co = (-0.5, -1.25, -1)
        else:
            ob = bpy.data.objects.new(spec["name"], None)
            bpy.context.collection.objects.link(ob)
        ob.name = spec["name"]
        if ob.data:
            ob.data.name = spec["name"]
        ob.rotation_mode = spec["rotation_mode"]
        ob.location, ob.scale = spec["location"], spec["scale"]
        if spec["rotation_mode"] == "QUATERNION":
            ob.rotation_quaternion = spec["rotation_quaternion"]
        else:
            ob.rotation_euler = spec["rotation_euler"]
        if "parent" in spec:
            ob.parent = made[spec["parent"]]
        made[spec["name"]] = ob
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for spec in objects:
        if spec.get("select", True):
            made[spec["name"]].select_set(True)
            bpy.context.view_layer.objects.active = made[spec["name"]]
    bpy.context.view_layer.update()


def state():
    def one(ob):
        data = {"name": ob.name, "location": r(ob.location), "rotation_euler": r(ob.rotation_euler), "rotation_quaternion": r(ob.rotation_quaternion),
                "scale": r(ob.scale), "matrix_parent_inverse": matrix(ob.matrix_parent_inverse), "matrix_world": matrix(ob.matrix_world)}
        if ob.type == "MESH":
            data["positions"] = [r(v.co) for v in ob.data.vertices]
            data["corner_verts"] = [l.vertex_index for l in ob.data.loops]
        if ob.type == "EMPTY":
            data["empty_display_size"] = round(ob.empty_display_size, 5)
        return data
    bpy.context.view_layer.update()
    return [one(ob) for ob in sorted(bpy.data.objects, key=lambda ob: ob.name)]


for name, (objects, idname, props) in CASES.items():
    build(objects)
    before = state()
    module, op = idname.split(".")
    result = getattr(getattr(bpy.ops, module), op)(**props)
    data = {"objects": objects, "cursor": CURSOR, "operator": idname, "props": props, "result": sorted(result), "before": before, "after": state()}
    with open(os.path.join(out_dir, name + ".json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
print("fixtures written", len(CASES))
