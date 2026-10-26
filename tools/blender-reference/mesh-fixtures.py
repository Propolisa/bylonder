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

# Edit Mode operators: a primitive, a select mode, the selected element indices, then the operator. Extrude cases
# then move the selection by MOVE, so every vertex has its own position: Blender orders the new side faces by a
# pointer hash, which changes from run to run, so those results are compared as geometry rather than in order.
MOVE = (0.25, 0.5, 1.0)
EDIT_CASES = {
    "delete-vert": (("primitive_cube_add", {}), "VERT", [0], "delete", {"type": "VERT"}),
    "delete-edge": (("primitive_cube_add", {}), "EDGE", [0], "delete", {"type": "EDGE"}),
    "delete-face": (("primitive_grid_add", {"x_subdivisions": 3, "y_subdivisions": 3}), "FACE", [4], "delete", {"type": "FACE"}),
    "delete-edge-face": (("primitive_cube_add", {}), "EDGE", [0], "delete", {"type": "EDGE_FACE"}),
    "delete-only-face": (("primitive_cube_add", {}), "FACE", [0, 1], "delete", {"type": "ONLY_FACE"}),
    "dissolve-faces": (("primitive_grid_add", {"x_subdivisions": 3, "y_subdivisions": 3}), "FACE", [0, 1, 3, 4], "dissolve_faces", {}),
    "extrude-face-cube": (("primitive_cube_add", {}), "FACE", [0], "extrude_region", {}, MOVE),
    "extrude-faces-grid": (("primitive_grid_add", {"x_subdivisions": 3, "y_subdivisions": 3}), "FACE", [3, 4], "extrude_region", {}, MOVE),
    "extrude-plane": (("primitive_plane_add", {}), "FACE", [0], "extrude_region", {}, MOVE),
    "extrude-edge": (("primitive_plane_add", {}), "EDGE", [0], "extrude_region", {}, MOVE),
    "extrude-edges-circle": (("primitive_circle_add", {"vertices": 6}), "EDGE", [0, 1, 2], "extrude_region", {}, MOVE),
    "extrude-vert": (("primitive_plane_add", {}), "VERT", [0], "extrude_region", {}, MOVE),
    "extrude-verts-cube": (("primitive_cube_add", {}), "VERT", [0, 1, 2, 3], "extrude_region", {}, MOVE),
    "subdivide-cube": (("primitive_cube_add", {}), "FACE", [0, 1, 2, 3, 4, 5], "subdivide", {}),
    "subdivide-cube-3": (("primitive_cube_add", {}), "FACE", [0, 1, 2, 3, 4, 5], "subdivide", {"number_cuts": 3}),
    "subdivide-face": (("primitive_grid_add", {"x_subdivisions": 3, "y_subdivisions": 3}), "FACE", [4], "subdivide", {"number_cuts": 2}),
    "subdivide-edge": (("primitive_cube_add", {}), "EDGE", [0], "subdivide", {}),
    "subdivide-edge-quadtri": (("primitive_cube_add", {}), "EDGE", [0], "subdivide", {"ngon": False, "number_cuts": 2}),
    "subdivide-corner-path": (("primitive_grid_add", {"x_subdivisions": 2, "y_subdivisions": 2}), "EDGE", [0, 1], "subdivide", {"ngon": False, "quadcorner": "PATH"}),
    "subdivide-corner-innervert": (("primitive_grid_add", {"x_subdivisions": 2, "y_subdivisions": 2}), "EDGE", [0, 1], "subdivide", {"ngon": False, "number_cuts": 2}),
    "subdivide-corner-fan": (("primitive_grid_add", {"x_subdivisions": 2, "y_subdivisions": 2}), "EDGE", [0, 1], "subdivide", {"ngon": False, "quadcorner": "FAN"}),
    "subdivide-tris": (("primitive_circle_add", {"vertices": 5, "fill_type": "TRIFAN"}), "FACE", [0, 1, 2, 3, 4], "subdivide", {"number_cuts": 2}),
    "subdivide-ring": (("primitive_cylinder_add", {"vertices": 6}), "EDGE", [1, 4, 7], "subdivide", {}),
    "loopcut-cube": (("primitive_cube_add", {}), "EDGE", [], "loopcut", {"edge_index": 0, "object_index": 0}),
    "loopcut-cube-3": (("primitive_cube_add", {}), "VERT", [], "loopcut", {"edge_index": 4, "object_index": 0, "number_cuts": 3}),
    "loopcut-grid": (("primitive_grid_add", {"x_subdivisions": 4, "y_subdivisions": 3}), "FACE", [], "loopcut", {"edge_index": 5, "object_index": 0, "number_cuts": 2}),
    "loopcut-cylinder": (("primitive_cylinder_add", {"vertices": 8}), "EDGE", [], "loopcut", {"edge_index": 1, "object_index": 0}),
    "loopcut-circle-edge": (("primitive_circle_add", {"vertices": 6}), "VERT", [], "loopcut", {"edge_index": 2, "object_index": 0, "number_cuts": 2}),
    "edge-slide-column": (("primitive_grid_add", {"x_subdivisions": 4, "y_subdivisions": 3, "size": 2}), "EDGE", [5, 16, 25], "edge_slide", {"value": 0.5}),
    "edge-slide-column-back": (("primitive_grid_add", {"x_subdivisions": 4, "y_subdivisions": 3, "size": 2}), "EDGE", [5, 16, 25], "edge_slide", {"value": -0.3}),
    "edge-slide-inner": (("primitive_grid_add", {"x_subdivisions": 4, "y_subdivisions": 3, "size": 2}), "EDGE", [16], "edge_slide", {"value": 0.7}),
    "edge-slide-row": (("primitive_grid_add", {"x_subdivisions": 4, "y_subdivisions": 3, "size": 2}), "EDGE", [3, 6, 9, 12], "edge_slide", {"value": 0.25}),
    "edge-slide-even": (("primitive_grid_add", {"x_subdivisions": 4, "y_subdivisions": 3, "size": 2}), "EDGE", [5, 16, 25], "edge_slide", {"value": 0.5, "use_even": True}),
    "edge-slide-unclamped": (("primitive_grid_add", {"x_subdivisions": 4, "y_subdivisions": 3, "size": 2}), "EDGE", [5, 16, 25], "edge_slide", {"value": -0.4, "use_clamp": False}),
    "edge-slide-ngon": (("primitive_cylinder_add", {"vertices": 6}), "EDGE", [1, 5, 8, 11, 14, 17], "edge_slide", {"value": 0.5}),
    "edge-slide-ngon-back": (("primitive_cylinder_add", {"vertices": 6}), "EDGE", [1, 5, 8, 11, 14, 17], "edge_slide", {"value": -0.5}),
    "inset-cube": (("primitive_cube_add", {}), "FACE", [0], "inset", {"thickness": 0.2}),
    "inset-cube-depth": (("primitive_cube_add", {}), "FACE", [0, 1], "inset", {"thickness": 0.2, "depth": 0.1}),
    "inset-grid-region": (("primitive_grid_add", {"x_subdivisions": 4, "y_subdivisions": 3, "size": 2}), "FACE", [1, 2, 5, 6], "inset", {"thickness": 0.1}),
    "inset-grid-boundary": (("primitive_grid_add", {"x_subdivisions": 4, "y_subdivisions": 3, "size": 2}), "FACE", [0, 1], "inset", {"thickness": 0.1}),
    "inset-grid-no-boundary": (("primitive_grid_add", {"x_subdivisions": 4, "y_subdivisions": 3, "size": 2}), "FACE", [0, 1], "inset", {"thickness": 0.1, "use_boundary": False}),
    "inset-grid-not-even": (("primitive_grid_add", {"x_subdivisions": 4, "y_subdivisions": 3, "size": 2}), "FACE", [0, 1, 5], "inset", {"thickness": 0.1, "use_even_offset": False}),
    "inset-grid-relative-depth": (("primitive_grid_add", {"x_subdivisions": 5, "y_subdivisions": 5, "size": 2}), "FACE", [6, 7, 8, 11, 12, 13, 16, 17, 18], "inset", {"thickness": 0.05, "depth": 0.2, "use_relative_offset": True}),
    "inset-outset": (("primitive_grid_add", {"x_subdivisions": 4, "y_subdivisions": 3, "size": 2}), "FACE", [5, 6], "inset", {"thickness": 0.1, "use_outset": True}),
    "inset-edge-rail": (("primitive_cylinder_add", {"vertices": 8}), "FACE", [0, 1, 2], "inset", {"thickness": 0.1, "use_edge_rail": True}),
    "inset-select": (("primitive_cube_add", {}), "FACE", [2], "inset", {"thickness": 0.3, "use_select_inset": True}),
    "inset-cylinder-cap": (("primitive_cylinder_add", {"vertices": 8}), "FACE", [8], "inset", {"thickness": 0.2, "depth": -0.1}),
    "dissolve-faces-cube": (("primitive_cube_add", {}), "FACE", [0, 1], "dissolve_faces", {}),
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


def loopcut(edge_index, number_cuts=1, object_index=0):
    """mesh.loopcut needs a 3D Viewport region, so in background mode the fixture selects the quad ring through
    the edge and subdivides it with the arguments ringsel_finish passes to BM_mesh_esubdivide."""
    import bmesh
    me = bpy.context.object.data
    bm = bmesh.from_edit_mesh(me)
    bm.edges.ensure_lookup_table()
    for e in bm.edges:
        e.select_set(False)
    start = bm.edges[edge_index]
    ring, todo = {start}, [start]
    while todo:
        e = todo.pop()
        for f in e.link_faces:
            if len(f.edges) != 4:
                continue
            opposite = f.edges[(list(f.edges).index(e) + 2) % 4]
            if opposite not in ring:
                ring.add(opposite)
                todo.append(opposite)
    for e in ring:
        e.select_set(True)
    bmesh.update_edit_mesh(me)
    bpy.ops.mesh.subdivide(number_cuts=number_cuts, ngon=True, quadcorner="PATH")


r = lambda v: [round(x, 6) for x in v]
for name, case in {**CASES, **EDIT_CASES}.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    (op, props), edit = (case, None) if name in CASES else (case[0], case[1:])
    getattr(bpy.ops.mesh, op)(**props)
    if edit:
        bpy.ops.object.mode_set(mode="EDIT")
        select(edit[0], edit[1])
        {"loopcut": loopcut, "edge_slide": bpy.ops.transform.edge_slide}.get(edit[2], getattr(bpy.ops.mesh, edit[2], None))(**edit[3])
        if len(edit) > 4:
            bpy.ops.transform.translate(value=edit[4])
        bpy.ops.object.mode_set(mode="OBJECT")
    me = bpy.context.object.data
    uv = me.uv_layers.active
    data = {
        "operator": "mesh." + op, "props": props,
        **({"edit": {"select_mode": edit[0], "select": edit[1], "operator": ("transform." if edit[2] == "edge_slide" else "mesh.") + edit[2], "props": edit[3], **({"move": edit[4]} if len(edit) > 4 else {})}} if edit else {}),
        "positions": [r(v.co) for v in me.vertices],
        "edges": [list(e.vertices) for e in me.edges],
        "face_offsets": [p.loop_start for p in me.polygons] + [len(me.loops)],
        "corner_verts": [l.vertex_index for l in me.loops],
        "corner_edges": [l.edge_index for l in me.loops],
        "uv": [r(d.uv) for d in uv.data] if uv else None,
        "sharp_face": [not p.use_smooth for p in me.polygons],
        "selection": [[i for i, x in enumerate(seq) if x.select] for seq in (me.vertices, me.edges, me.polygons)],
    }
    with open(os.path.join(out_dir, name + ".json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
print("fixtures written", len(CASES) + len(EDIT_CASES))
