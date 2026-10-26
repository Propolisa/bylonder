# Writes Blender's output for mesh operators as fixtures (tests/fixtures/mesh/*.json): positions, edges, faces,
# corner vertices and UVs of the resulting Mesh, in Blender's element order.
# usage: blender -b --factory-startup --python tools/blender-reference/mesh-fixtures.py -- OUT_DIR
import bpy, json, os, sys

out_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out_dir, exist_ok=True)

CASES = {
    "cube": ("primitive_cube_add", {}),
    "cube-size-3": ("primitive_cube_add", {"size": 3}),
    "plane": ("primitive_plane_add", {}),
    "grid": ("primitive_grid_add", {}),
    "grid-3x2": ("primitive_grid_add", {"x_subdivisions": 3, "y_subdivisions": 2, "size": 4}),
    "circle": ("primitive_circle_add", {}),
    "circle-ngon": ("primitive_circle_add", {"vertices": 8, "fill_type": "NGON"}),
    "circle-trifan": ("primitive_circle_add", {"vertices": 8, "fill_type": "TRIFAN"}),
    "cylinder": ("primitive_cylinder_add", {}),
    "cylinder-trifan": ("primitive_cylinder_add", {"vertices": 6, "end_fill_type": "TRIFAN"}),
    "cylinder-nothing": ("primitive_cylinder_add", {"vertices": 6, "end_fill_type": "NOTHING"}),
    "cone": ("primitive_cone_add", {}),
    "cone-radius2": ("primitive_cone_add", {"vertices": 6, "radius2": 0.5}),
    "uv-sphere": ("primitive_uv_sphere_add", {}),
    "uv-sphere-small": ("primitive_uv_sphere_add", {"segments": 6, "ring_count": 4}),
    "ico-sphere": ("primitive_ico_sphere_add", {}),
    "ico-sphere-1": ("primitive_ico_sphere_add", {"subdivisions": 1}),
    "torus": ("primitive_torus_add", {}),
    "monkey": ("primitive_monkey_add", {}),
}

# Edit Mode operators: a primitive, a select mode, the selected element indices, then the operator.
EDIT_CASES = {
    "delete-vert": (("primitive_cube_add", {}), "VERT", [0], "delete", {"type": "VERT"}),
    "delete-edge": (("primitive_cube_add", {}), "EDGE", [0], "delete", {"type": "EDGE"}),
    "delete-face": (("primitive_grid_add", {"x_subdivisions": 3, "y_subdivisions": 3}), "FACE", [4], "delete", {"type": "FACE"}),
    "delete-edge-face": (("primitive_cube_add", {}), "EDGE", [0], "delete", {"type": "EDGE_FACE"}),
    "delete-only-face": (("primitive_cube_add", {}), "FACE", [0, 1], "delete", {"type": "ONLY_FACE"}),
}


def select(kind, indices):
    import bmesh
    bpy.ops.mesh.select_mode(type=kind)
    bpy.ops.mesh.select_all(action="DESELECT")
    bm = bmesh.from_edit_mesh(bpy.context.object.data)
    seq = {"VERT": bm.verts, "EDGE": bm.edges, "FACE": bm.faces}[kind]
    seq.ensure_lookup_table()
    for i in indices:
        seq[i].select_set(True)
    bm.select_flush_mode()
    bmesh.update_edit_mesh(bpy.context.object.data)


r = lambda v: [round(x, 6) for x in v]
for name, case in {**CASES, **EDIT_CASES}.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    (op, props), edit = (case, None) if name in CASES else (case[0], case[1:])
    getattr(bpy.ops.mesh, op)(**props)
    if edit:
        bpy.ops.object.mode_set(mode="EDIT")
        select(edit[0], edit[1])
        getattr(bpy.ops.mesh, edit[2])(**edit[3])
        bpy.ops.object.mode_set(mode="OBJECT")
    me = bpy.context.object.data
    uv = me.uv_layers.active
    data = {
        "operator": "mesh." + op, "props": props,
        **({"edit": {"select_mode": edit[0], "select": edit[1], "operator": "mesh." + edit[2], "props": edit[3]}} if edit else {}),
        "positions": [r(v.co) for v in me.vertices],
        "edges": [list(e.vertices) for e in me.edges],
        "face_offsets": [p.loop_start for p in me.polygons] + [len(me.loops)],
        "corner_verts": [l.vertex_index for l in me.loops],
        "corner_edges": [l.edge_index for l in me.loops],
        "uv": [r(d.uv) for d in uv.data] if uv else None,
        "sharp_face": [not p.use_smooth for p in me.polygons],
    }
    with open(os.path.join(out_dir, name + ".json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
print("fixtures written", len(CASES) + len(EDIT_CASES))
