# Writes Blender's Curve and Text objects as fixtures (tests/fixtures/curves/*.json): each case (an object added by its
# Add operator, settings by RNA path, Edit Mode operators on a selection, modifiers and text on a curve), the Curve's
# splines and text as RNA reads them after it, and the evaluated mesh (positions, edges, faces and corner vertices in
# Blender's element order), as tests/curves-wasm.test.js replays them.
# usage: blender -b --factory-startup --python tools/blender-reference/curve-fixtures.py -- OUT_DIR
import bpy, json, os, re, sys

out_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out_dir, exist_ok=True)

BEZIER, CIRCLE = "curve.primitive_bezier_curve_add", "curve.primitive_bezier_circle_add"
NURBS, NURBS_CIRCLE, PATH, TEXT = "curve.primitive_nurbs_curve_add", "curve.primitive_nurbs_circle_add", "curve.primitive_nurbs_path_add", "object.text_add"
# The target a case's modifiers and follow_curve name: a Bezier curve, bent.
TARGET = {"add": BEZIER, "set": {"splines[0].bezier_points[1].co": [2.0, 1.0, 0.0], "splines[0].bezier_points[1].handle_left": [1.0, 1.5, 0.0],
                                  "splines[0].bezier_points[1].handle_right": [3.0, 0.5, 0.0]}}
CASES = {
    "bezier": {"add": BEZIER},
    "bezier-bevel": {"add": BEZIER, "set": {"bevel_depth": 0.2, "bevel_resolution": 3}},
    "bezier-extrude": {"add": BEZIER, "set": {"extrude": 0.3}},
    "bezier-extrude-bevel-offset": {"add": BEZIER, "set": {"extrude": 0.2, "bevel_depth": 0.05, "offset": 0.1}},
    "bezier-bevel-caps": {"add": BEZIER, "set": {"bevel_depth": 0.2, "use_fill_caps": True, "resolution_u": 6}},
    "bezier-bevel-factor": {"add": BEZIER, "set": {"bevel_depth": 0.1, "bevel_factor_start": 0.2, "bevel_factor_end": 0.7}},
    "bezier-bevel-profile": {"add": BEZIER, "set": {"bevel_depth": 0.1, "bevel_mode": "PROFILE"}},
    "bezier-tangent-twist": {"add": BEZIER, "set": {"bevel_depth": 0.1, "twist_mode": "TANGENT", "splines[0].bezier_points[0].tilt": 0.7}},
    "bezier-radius": {"add": BEZIER, "set": {"bevel_depth": 0.1, "splines[0].bezier_points[1].radius": 2.5}},
    "bezier-2d": {"add": BEZIER, "set": {"dimensions": "2D", "extrude": 0.1}},
    "circle": {"add": CIRCLE},
    "circle-2d-fill": {"add": CIRCLE, "set": {"dimensions": "2D", "fill_mode": "BOTH"}},
    "circle-2d-front-extrude": {"add": CIRCLE, "set": {"dimensions": "2D", "fill_mode": "FRONT", "extrude": 0.25}},
    "circle-bevel-resolution": {"add": CIRCLE, "set": {"bevel_depth": 0.3, "resolution_u": 3, "bevel_resolution": 1}},
    "nurbs": {"add": NURBS},
    "nurbs-bevel": {"add": NURBS, "set": {"bevel_depth": 0.1, "splines[0].order_u": 3, "splines[0].use_endpoint_u": True}},
    "nurbs-circle": {"add": NURBS_CIRCLE, "set": {"extrude": 0.1}},
    "path": {"add": PATH},
    "path-resolution": {"add": PATH, "set": {"resolution_u": 3, "bevel_depth": 0.05}},
    # Edit Mode operators, on all points (as an Add operator leaves them selected) or on `select`: (spline, point) pairs.
    "edit-subdivide": {"add": BEZIER, "edit": [["curve.subdivide", {"number_cuts": 2}]]},
    "edit-handle-vector": {"add": BEZIER, "edit": [["curve.handle_type_set", {"type": "VECTOR"}]]},
    "edit-handle-auto": {"add": BEZIER, "edit": [["curve.handle_type_set", {"type": "AUTOMATIC"}]]},
    "edit-cyclic": {"add": BEZIER, "edit": [["curve.cyclic_toggle", {}]]},
    "edit-delete-vert": {"add": CIRCLE, "select": [[0, 1]], "edit": [["curve.delete", {"type": "VERT"}]]},
    "edit-delete-segment": {"add": CIRCLE, "select": [[0, 1], [0, 2]], "edit": [["curve.delete", {"type": "SEGMENT"}]]},
    "edit-extrude": {"add": BEZIER, "select": [[0, 1]], "edit": [["curve.extrude", {}], ["transform.translate", {"value": [1.0, 0.5, 0.0]}]]},
    "edit-translate": {"add": BEZIER, "edit": [["transform.translate", {"value": [0.5, 1.0, 0.25]}]]},
    "edit-translate-knot": {"add": BEZIER, "select": [[0, 0]], "edit": [["transform.translate", {"value": [0.0, 1.0, 0.0]}]]},
    "edit-rotate": {"add": CIRCLE, "edit": [["transform.rotate", {"value": 0.5, "orient_axis": "Z"}]]},
    "edit-resize": {"add": CIRCLE, "edit": [["transform.resize", {"value": [2.0, 1.0, 1.0]}]]},
    "edit-switch-direction": {"add": BEZIER, "edit": [["curve.switch_direction", {}]]},
    "edit-spline-poly": {"add": BEZIER, "edit": [["curve.spline_type_set", {"type": "POLY"}]]},
    "edit-spline-nurbs": {"add": BEZIER, "edit": [["curve.spline_type_set", {"type": "NURBS"}]]},
    "edit-duplicate": {"add": BEZIER, "edit": [["curve.duplicate", {}], ["transform.translate", {"value": [0.0, 0.0, 1.0]}]]},
    "edit-add-circle": {"add": BEZIER, "edit": [["curve.primitive_bezier_circle_add", {"radius": 0.5}]]},
    "edit-nurbs-subdivide": {"add": NURBS, "edit": [["curve.subdivide", {"number_cuts": 1}]]},
    "edit-select-invert-delete": {"add": NURBS, "select": [[0, 0]], "edit": [["curve.select_all", {"action": "INVERT"}], ["curve.delete", {"type": "VERT"}]]},
    "text": {"add": TEXT},
    "text-size-shear": {"add": TEXT, "set": {"size": 2.0, "shear": 0.3}},
    "text-lines-spacing": {"add": TEXT, "body": "Hello World\nLine Two", "set": {"space_character": 1.5, "space_word": 2.0, "space_line": 1.2}},
    "text-center": {"add": TEXT, "body": "Ab\nCdef", "set": {"align_x": "CENTER", "align_y": "CENTER"}},
    "text-right-bottom": {"add": TEXT, "body": "Ab\nCdef", "set": {"align_x": "RIGHT", "align_y": "BOTTOM"}},
    "text-justify-box": {"add": TEXT, "body": "The quick brown fox jumps over the lazy dog", "set": {"align_x": "JUSTIFY", "text_boxes[0].width": 6.0}},
    "text-flush-box": {"add": TEXT, "body": "The quick brown fox", "set": {"align_x": "FLUSH", "text_boxes[0].width": 8.0}},
    "text-offset": {"add": TEXT, "set": {"offset_x": 0.5, "offset_y": -0.3}},
    "text-extrude-bevel": {"add": TEXT, "set": {"extrude": 0.1, "bevel_depth": 0.02, "bevel_resolution": 1}},
    "text-underline": {"add": TEXT, "body": "Under", "format": {"use_underline": True}, "set": {"underline_position": -0.1, "underline_height": 0.1}},
    "text-small-caps": {"add": TEXT, "body": "Small Caps", "format": {"use_small_caps": True}, "set": {"small_caps_scale": 0.6}},
    "text-kerning": {"add": TEXT, "body": "AVA", "set": {"body_format[1].kerning": 0.5}},
    "text-box-scale": {"add": TEXT, "body": "Overflowing text in a box", "set": {"overflow": "SCALE", "text_boxes[0].width": 3.0, "text_boxes[0].height": 1.0}},
    "text-box-truncate": {"add": TEXT, "body": "Overflowing text in a box", "set": {"overflow": "TRUNCATE", "text_boxes[0].width": 3.0, "text_boxes[0].height": 1.0}},
    "text-edit": {"add": TEXT, "edit": [["font.delete", {"type": "PREVIOUS_OR_SELECTION"}], ["font.text_insert", {"text": "xt é!"}],
                                        ["font.line_break", {}], ["font.text_insert", {"text": "Two"}], ["font.move", {"type": "PREVIOUS_WORD"}],
                                        ["font.move_select", {"type": "LINE_BEGIN"}], ["font.style_toggle", {"style": "BOLD"}]]},
    "text-edit-select-all-delete": {"add": TEXT, "edit": [["font.select_all", {}], ["font.delete", {"type": "PREVIOUS_OR_SELECTION"}],
                                                       ["font.text_insert", {"text": "New"}]]},
    "text-follow-curve": {"add": TEXT, "target": TARGET, "set": {"follow_curve": "TARGET"}},
    "text-curve-modifier": {"add": TEXT, "target": TARGET, "modifiers": [["CURVE", {"object": "TARGET"}]]},
    "text-curve-modifier-extrude": {"add": TEXT, "target": TARGET, "set": {"extrude": 0.05}, "modifiers": [["CURVE", {"object": "TARGET", "deform_axis": "POS_X"}]]},
}


def resolve(owner, path):
    """The struct and property name an RNA path (`a.b[1].c`) names, from owner."""
    *parts, name = re.findall(r"(\w+)(?:\[(\d+)\])?", path)
    for part, index in parts:
        owner = getattr(owner, part)
        if index:
            owner = owner[int(index)]
    return owner, name


def set_path(owner, path, value, objects):
    owner, (name, index) = resolve(owner, path)
    value = objects.get(value, value) if isinstance(value, str) else value
    if index:
        getattr(owner, name)[int(index)] = value
    else:
        setattr(owner, name, value)


def add(case, objects):
    module, name = case["add"].split(".")
    getattr(getattr(bpy.ops, module), name)()
    ob = bpy.context.object
    if "body" in case:
        ob.data.body = case["body"]
    for key, value in case.get("format", {}).items():
        for char in ob.data.body_format:
            setattr(char, key, value)
    for path, value in case.get("set", {}).items():
        set_path(ob.data, path, value, objects)
    return ob


r = lambda v: [round(x, 5) for x in v]


def point_data(p, bezier):
    d = {"co": r(p.co), "radius": round(p.radius, 5), "tilt": round(p.tilt, 5), "hide": p.hide}
    if bezier:
        d.update(handle_left=r(p.handle_left), handle_right=r(p.handle_right), handle_left_type=p.handle_left_type,
                 handle_right_type=p.handle_right_type, select_left_handle=p.select_left_handle,
                 select_control_point=p.select_control_point, select_right_handle=p.select_right_handle)
    else:
        d.update(weight=round(p.weight, 5), select=p.select)
    return d


def curve_data(cu):
    d = {"splines": [{"type": s.type, "use_cyclic_u": s.use_cyclic_u, "order_u": s.order_u, "resolution_u": s.resolution_u,
                      "use_endpoint_u": s.use_endpoint_u, "use_bezier_u": s.use_bezier_u, "use_smooth": s.use_smooth,
                      "points": [point_data(p, s.type == "BEZIER") for p in (s.bezier_points if s.type == "BEZIER" else s.points)]}
                     for s in cu.splines],
         "dimensions": cu.dimensions, "use_path": cu.use_path}
    if cu.bl_rna.identifier == "TextCurve":
        d["body"] = cu.body
        d["body_format"] = [[c.use_bold, c.use_italic, c.use_underline, c.use_small_caps, round(c.kerning, 5)] for c in cu.body_format]
    return d


def mesh_data(ob):
    me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    if me is None:
        return None
    return {"positions": [r(v.co) for v in me.vertices], "edges": [list(e.vertices) for e in me.edges],
            "face_offsets": [p.loop_start for p in me.polygons] + [len(me.loops)], "corner_verts": [l.vertex_index for l in me.loops]}


for name, case in CASES.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objects = {}
    if "target" in case:
        objects["TARGET"] = add(case["target"], objects)
        objects["TARGET"].select_set(False)
    ob = add(case, objects)
    if "select" in case or "edit" in case:
        bpy.ops.object.mode_set(mode="EDIT")
        if "select" in case:
            bpy.ops.curve.select_all(action="DESELECT")
            for s, p in case["select"]:
                spline = ob.data.splines[s]
                if spline.type == "BEZIER":
                    point = spline.bezier_points[p]
                    point.select_control_point = point.select_left_handle = point.select_right_handle = True
                else:
                    spline.points[p].select = True
        for idname, props in case.get("edit", []):
            module, op = idname.split(".")
            getattr(getattr(bpy.ops, module), op)(**props)
        bpy.ops.object.mode_set(mode="OBJECT")
    for type, props in case.get("modifiers", []):
        md = ob.modifiers.new(type.title(), type)
        for path, value in props.items():
            set_path(md, path, value, objects)
    data = {"case": case, "curve": curve_data(ob.data), "mesh": mesh_data(ob)}
    with open(os.path.join(out_dir, name + ".json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
print("fixtures written", len(CASES))
