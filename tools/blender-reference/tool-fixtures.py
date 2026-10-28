# The 3D View's Edit Mode tools used with real input on the default cube, for tests/tools-wasm.test.js: per fixture
# the view (matrices and region size), the input in region pixels, and the mesh before and after. A drag runs the
# active tool wherever it starts (Drag: Active Tool), as the tools' handle gizmos run it from the handle; it starts
# away from gizmos that take a drag themselves (Shear's).
# Run inside an X server, with event simulation:
#   blender --factory-startup --enable-event-simulate START.blend --python tool-fixtures.py -- OUT.json
import json
import sys

import bmesh
import bpy
from bpy_extras.view3d_utils import location_3d_to_region_2d
from mathutils import Quaternion

out = sys.argv[sys.argv.index("--") + 1]
STEPS = 8


# A left drag from `start` to `end`, in mouse moves.
def drag(start, end):
    moves = [(start[0] + (end[0] - start[0]) * i / STEPS, start[1] + (end[1] - start[1]) * i / STEPS) for i in range(1, STEPS + 1)]
    return [("MOUSEMOVE", "NOTHING", start), ("LEFTMOUSE", "PRESS", start)] + \
        [("MOUSEMOVE", "NOTHING", p) for p in moves] + [("LEFTMOUSE", "RELEASE", end)]


# Left clicks at `points`, then a key.
def clicks(points, key=None):
    events = [e for p in points for e in [("MOUSEMOVE", "NOTHING", p), ("LEFTMOUSE", "PRESS", p), ("LEFTMOUSE", "RELEASE", p)]]
    return events + ([(key, "PRESS", points[-1]), (key, "RELEASE", points[-1])] if key else [])


# Tool, the cube's selected vertices by position (all when None) and the input in pixels from the first selected
# vertex, or the region's center.
FIXTURES = [
    ("builtin.shrink_fatten", None, drag((60, 20), (140, 40))),
    ("builtin.push_pull", None, drag((60, 20), (130, 60))),
    ("builtin.to_sphere", [(1, 1, 1), (1, -1, 1), (-1, -1, 1)], drag((20, -10), (80, -40))),
    ("builtin.shear", None, drag((250, 150), (340, 160))),
    ("builtin.smooth", None, drag((0, 0), (120, 0))),
    ("builtin.randomize", None, drag((0, 0), (90, 0))),
    ("builtin.vertex_slide", [(1, 1, 1)], drag((0, 0), (-40, -25))),
    ("builtin.spin", None, drag((0, 0), (30, 0))),
    ("builtin.rip_region", [(1, 1, 1)], drag((0, 0), (40, 25))),
    ("builtin.knife", None, clicks([(-70, 20), (60, 35)], "RET")),
    ("builtin.extrude_to_cursor", [(1, 1, 1)], clicks([(80, 40)])),
]
VIEW = {"rotation": (0.82, 0.42, 0.19, 0.33), "distance": 9.0}


def window():
    return bpy.context.window_manager.windows[0]


def view3d():
    area = next(a for a in window().screen.areas if a.type == "VIEW_3D")
    return area, next(r for r in area.regions if r.type == "WINDOW")


def flat(matrix):
    return [matrix[r][c] for c in range(4) for r in range(4)]


def mesh_data(ob):
    me = ob.data
    return {
        "vert_positions": [x for v in me.vertices for x in v.co],
        "edges": [i for e in me.edges for i in e.vertices],
        "face_offsets": [p.loop_start for p in me.polygons] + [len(me.loops)],
        "corner_verts": [l.vertex_index for l in me.loops],
    }


# What the tool's operator ran with, as its redo panel shows it.
def plain(value):
    if hasattr(value, "bl_rna"):
        return {p.identifier: plain(getattr(value, p.identifier)) for p in value.bl_rna.properties if p.identifier != "rna_type"}
    if hasattr(value, "__len__") and not isinstance(value, str):
        return [plain(v) for v in value]
    return value


def operator_values(op):
    return {"idname": op.bl_idname, "properties": plain(op.properties)}


def steps():
    results = []
    for tool, select, input_events in FIXTURES:
        with bpy.context.temp_override(window=window()):
            bpy.ops.wm.read_homefile()
        yield 1.0
        area, region = view3d()
        cube = bpy.data.objects["Cube"]
        start_mesh = mesh_data(cube)
        with bpy.context.temp_override(window=window(), area=area, region=region, object=cube, active_object=cube):
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_mode(type="VERT")
            bpy.ops.mesh.select_all(action="SELECT" if select is None else "DESELECT")
            bpy.ops.wm.tool_set_by_id(name=tool)
        if select is not None:
            bm = bmesh.from_edit_mesh(cube.data)
            for v in bm.verts:
                v.select = tuple(v.co) in select
            bm.select_flush(True)
            bmesh.update_edit_mesh(cube.data)
        bpy.context.scene.tool_settings.workspace_tool_type = "DEFAULT"
        rv3d = area.spaces.active.region_3d
        rv3d.view_perspective = "PERSP"
        rv3d.view_rotation = Quaternion(VIEW["rotation"]).normalized()
        rv3d.view_distance = VIEW["distance"]
        rv3d.view_location = (0, 0, 0)
        yield 0.5
        active = bpy.context.workspace.tools.from_space_view3d_mode("EDIT_MESH").idname
        assert active == tool, (active, tool)
        origin = location_3d_to_region_2d(region, rv3d, select[0]) if select else (region.width / 2, region.height / 2)
        events = [(type, value, round(origin[0] + dx), round(origin[1] + dy)) for type, value, (dx, dy) in input_events]
        for type, value, x, y in events:
            window().event_simulate(type=type, value=value, x=region.x + x, y=region.y + y)
            yield 0.1
        yield 0.5
        with bpy.context.temp_override(window=window(), area=area, region=region):
            bpy.ops.object.mode_set(mode="OBJECT")
        results.append({
            "tool": tool, "select": select, "events": events,
            "view": {"viewmat": flat(rv3d.view_matrix), "winmat": flat(rv3d.window_matrix), "winx": region.width,
                     "winy": region.height, "persp": rv3d.is_perspective},
            "start": start_mesh, "mesh": mesh_data(cube),
            "operator": operator_values(bpy.context.window_manager.operators[-1]),
        })
        print("fixture", tool, flush=True)
    with open(out, "w") as file:
        json.dump(results, file, indent=1)
    bpy.ops.wm.quit_blender()


queue = steps()
bpy.app.timers.register(lambda: next(queue, None), first_interval=2.0, persistent=True)
