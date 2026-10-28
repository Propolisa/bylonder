# Writes Blender's result of Graph Editor and Dope Sheet operators on keyframes as fixtures (tests/fixtures/anim/*.json):
# an empty's keys inserted as keyframe_insert inserts them, a selection, then the operator run in the editor's main
# region, with the region's size and view, and every F-Curve's keys (point, handles, interpolation, handle types,
# selection, easing, keyframe type) before and after.
# usage: blender -b --factory-startup --python tools/blender-reference/anim-fixtures.py -- OUT_DIR
import bpy, json, os, sys

out_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out_dir, exist_ok=True)

# Keys per (RNA path, array index): (frame, value) pairs, inserted in this order.
KEYS = [("location", 0, [(1, 0.0), (10, 5.0), (20, 2.0), (30, 2.5)]),
        ("location", 2, [(1, 1.0), (15, 3.0), (30, -1.0)]),
        ("rotation_euler", 1, [(5, 0.0), (25, 1.5)])]
# Selections: (F-Curve index in KEYS, key index, part: key, left, right or all).
FIRST = [(0, 1, "all")]
TWO = [(0, 1, "all"), (1, 1, "all")]
GRAPH, DOPESHEET = "GRAPH_EDITOR", "DOPESHEET_EDITOR"
CASES = {
    "insert": (GRAPH, [], None, {}),
    "graph-select-all": (GRAPH, FIRST, "graph.select_all", {"action": "SELECT"}),
    "graph-deselect-all": (GRAPH, FIRST, "graph.select_all", {"action": "DESELECT"}),
    "graph-select-invert": (GRAPH, FIRST, "graph.select_all", {"action": "INVERT"}),
    "graph-interpolation-linear": (GRAPH, FIRST, "graph.interpolation_type", {"type": "LINEAR"}),
    "graph-interpolation-constant": (GRAPH, TWO, "graph.interpolation_type", {"type": "CONSTANT"}),
    "graph-interpolation-elastic": (GRAPH, FIRST, "graph.interpolation_type", {"type": "ELASTIC"}),
    "graph-handle-vector": (GRAPH, FIRST, "graph.handle_type", {"type": "VECTOR"}),
    "graph-handle-free": (GRAPH, FIRST, "graph.handle_type", {"type": "FREE"}),
    "graph-handle-auto": (GRAPH, TWO, "graph.handle_type", {"type": "AUTO"}),
    "graph-handle-aligned": (GRAPH, FIRST, "graph.handle_type", {"type": "ALIGNED"}),
    "graph-delete": (GRAPH, TWO, "graph.delete", {"confirm": False}),
    "graph-duplicate": (GRAPH, FIRST, "graph.duplicate", {}),
    "graph-extrapolation-linear": (GRAPH, FIRST, "graph.extrapolation_type", {"type": "LINEAR"}),
    "graph-easing-out": (GRAPH, FIRST, "graph.easing_type", {"type": "EASE_OUT"}),
    "graph-select-linked": (GRAPH, FIRST, "graph.select_linked", {}),
    "graph-select-leftright": (GRAPH, FIRST, "graph.select_leftright", {"mode": "RIGHT", "extend": False}),
    "graph-select-column": (GRAPH, FIRST, "graph.select_column", {"mode": "KEYS"}),
    "graph-select-more": (GRAPH, FIRST, "graph.select_more", {}),
    "graph-translate": (GRAPH, FIRST, "transform.translate", {"value": (5, 0, 0), "constraint_axis": (True, False, False)}),
    "graph-translate-y": (GRAPH, TWO, "transform.translate", {"value": (0, 1.5, 0), "constraint_axis": (False, True, False)}),
    "graph-translate-xy": (GRAPH, TWO, "transform.translate", {"value": (-2.5, 0.75, 0)}),
    "graph-resize-x": (GRAPH, TWO, "transform.resize", {"value": (2, 1, 1), "constraint_axis": (True, False, False)}),
    "graph-resize-y": (GRAPH, [(0, 1, "all"), (0, 2, "all")], "transform.resize", {"value": (1, 0.5, 1), "constraint_axis": (False, True, False)}),
    "graph-rotate": (GRAPH, [(0, 2, "all")], "transform.rotate", {"value": 0.3}),
    "graph-select-box": (GRAPH, [], "graph.select_box", {"xmin": 300, "xmax": 900, "ymin": 0, "ymax": 400, "mode": "SET"}),
    "graph-clickselect": (GRAPH, [], "graph.clickselect", {"mouse_x": 0, "mouse_y": 0, "deselect_all": True}),
    "dopesheet-select-all": (DOPESHEET, FIRST, "action.select_all", {"action": "SELECT"}),
    "dopesheet-interpolation-linear": (DOPESHEET, TWO, "action.interpolation_type", {"type": "LINEAR"}),
    "dopesheet-handle-vector": (DOPESHEET, TWO, "action.handle_type", {"type": "VECTOR"}),
    "dopesheet-keyframe-type": (DOPESHEET, FIRST, "action.keyframe_type", {"type": "BREAKDOWN"}),
    "dopesheet-delete": (DOPESHEET, TWO, "action.delete", {"confirm": False}),
    "dopesheet-duplicate": (DOPESHEET, FIRST, "action.duplicate", {}),
    "dopesheet-time-translate": (DOPESHEET, TWO, "transform.transform", {"mode": "TIME_TRANSLATE", "value": (4, 0, 0, 0)}),
    "dopesheet-time-scale": (DOPESHEET, TWO, "transform.transform", {"mode": "TIME_SCALE", "value": (2, 0, 0, 0)}),
    "dopesheet-select-column": (DOPESHEET, FIRST, "action.select_column", {"mode": "KEYS"}),
    "dopesheet-select-box": (DOPESHEET, [], "action.select_box", {"xmin": 300, "xmax": 900, "ymin": 0, "ymax": 1000, "mode": "SET"}),
    "dopesheet-mirror": (DOPESHEET, TWO, "action.mirror", {"type": "CFRA"}),
    "dopesheet-snap": (DOPESHEET, TWO, "action.snap", {"type": "NEAREST_FRAME"}),
}
FRAME = 12

r = lambda v: [round(x, 4) for x in v]


def fcurves(ob):
    action = ob.animation_data.action
    return [fc for layer in action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


def keys():
    ob = bpy.data.objects["Empty"]
    return [{"rna_path": fc.data_path, "index": fc.array_index, "group": fc.group.name if fc.group else "",
             "extrapolation": fc.extrapolation, "select": fc.select,
             "keys": [{"co": r(k.co), "left": r(k.handle_left), "right": r(k.handle_right), "interpolation": k.interpolation,
                       "left_type": k.handle_left_type, "right_type": k.handle_right_type, "easing": k.easing, "type": k.type,
                       "select": [k.select_left_handle, k.select_control_point, k.select_right_handle]}
                      for k in fc.keyframe_points]} for fc in fcurves(ob)]


def build(selection):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    ob = bpy.data.objects.new("Empty", None)
    scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    for path, index, points in KEYS:
        for frame, value in points:
            getattr(ob, path)[index] = value
            ob.keyframe_insert(path, index=index, frame=frame)
    scene.frame_set(FRAME)
    for i, fc in enumerate(fcurves(ob)):
        for j, k in enumerate(fc.keyframe_points):
            parts = [part for (c, kk, part) in selection if (c, kk) == (i, j)]
            k.select_control_point = any(p in ("key", "all") for p in parts)
            k.select_left_handle = any(p in ("left", "all") for p in parts)
            k.select_right_handle = any(p in ("right", "all") for p in parts)


def area_for(space):
    window = bpy.context.window_manager.windows[0]
    area = max(window.screen.areas, key=lambda a: a.width * a.height)
    area.type = space
    if space == DOPESHEET:
        area.ui_type = "DOPESHEET"
    region = next(r for r in area.regions if r.type == "WINDOW")
    return window, area, region


for name, (space, selection, idname, props) in CASES.items():
    build(selection)
    window, area, region = area_for(space)
    before = keys()
    result = []
    view = None
    with bpy.context.temp_override(window=window, area=area, region=region):
        if space == GRAPH:
            bpy.ops.graph.view_all()
        else:
            bpy.ops.action.view_all()
        # The view (View2D.cur): its region's corner pixels in view space. Background mode has no interface scale, so
        # View All leaves no margins there; the tests set this view rather than run View All.
        view = {"width": region.width, "height": region.height, "min": list(region.view2d.region_to_view(0, 0)),
                "max": list(region.view2d.region_to_view(region.width - 1, region.height - 1))}
        if idname == "graph.clickselect":
            props = {**props, "mouse_x": region.view2d.view_to_region(10, 5)[0], "mouse_y": region.view2d.view_to_region(10, 5)[1]}
        if idname:
            module, op = idname.split(".")
            result = sorted(getattr(getattr(bpy.ops, module), op)(**props))
    data = {"space": space, "selection": selection, "frame": FRAME, "operator": idname, "props": props, "result": result,
            "view": view, "keys": KEYS, "before": before, "after": keys()}
    with open(os.path.join(out_dir, name + ".json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
print("fixtures written", len(CASES))
