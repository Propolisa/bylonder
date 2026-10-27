# Writes Blender's evaluated mesh for modifiers on a default cube as fixtures (tests/fixtures/modifiers/*.json):
# positions, edges, faces and corner vertices in Blender's element order, with the settings by RNA identifier.
# usage: blender -b --factory-startup --python tools/blender-reference/modifier-fixtures.py -- OUT_DIR
import bpy, json, os, re, sys

out_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out_dir, exist_ok=True)

DEFAULTS = ["ARRAY", "BEVEL", "BUILD", "DECIMATE", "EDGE_SPLIT", "MIRROR", "REMESH", "SCREW", "SKIN", "SOLIDIFY", "SUBSURF", "TRIANGULATE",
            "WELD", "WIREFRAME", "CAST", "DISPLACE", "SIMPLE_DEFORM", "SMOOTH", "CORRECTIVE_SMOOTH", "LAPLACIANSMOOTH", "WAVE", "WEIGHTED_NORMAL"]
CASES = {
    **{t.lower(): [(t, {})] for t in DEFAULTS},
    "subsurf-2": [("SUBSURF", {"levels": 2})],
    "array-3-merge": [("ARRAY", {"count": 3, "use_merge_vertices": True, "relative_offset_displace[0]": 0.5})],
    "mirror-y-bisect": [("MIRROR", {"use_axis[0]": False, "use_axis[1]": True, "use_bisect_axis[1]": True})],
    "bevel-segments": [("BEVEL", {"width": 0.2, "segments": 3, "affect": "EDGES"})],
    "solidify-even": [("SOLIDIFY", {"thickness": 0.3, "use_even_offset": True})],
    "simple-deform-bend": [("SIMPLE_DEFORM", {"deform_method": "BEND", "angle": 1.0})],
    "mirror-subsurf": [("MIRROR", {}), ("SUBSURF", {"levels": 1})],
    "array-bevel-subsurf": [("ARRAY", {"count": 2}), ("BEVEL", {"width": 0.1}), ("SUBSURF", {})],
}


def set_path(md, path, value):
    name, index = re.match(r"(\w+)(?:\[(\d+)\])?$", path).groups()
    if index is None:
        setattr(md, name, value)
    else:
        getattr(md, name)[int(index)] = value


r = lambda v: [round(x, 5) for x in v]
for name, stack in CASES.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_cube_add()
    ob = bpy.context.object
    for type, values in stack:
        md = ob.modifiers.new(type.title(), type)
        for path, value in values.items():
            set_path(md, path, value)
    me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    data = {
        "stack": [{"type": t, "values": v} for t, v in stack],
        "positions": [r(v.co) for v in me.vertices],
        "edges": [list(e.vertices) for e in me.edges],
        "face_offsets": [p.loop_start for p in me.polygons] + [len(me.loops)],
        "corner_verts": [l.vertex_index for l in me.loops],
    }
    with open(os.path.join(out_dir, name + ".json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
print("fixtures written", len(CASES))
