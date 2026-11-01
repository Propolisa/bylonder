# Sculpt Mode on Suzanne with real input, for tests/sculpt-wasm.test.js: the brush and tool settings entering Sculpt
# Mode gives, the view (matrices and region size), a left drag in region pixels and the mesh before and after the
# stroke.
# Run inside an X server, with event simulation:
#   blender --factory-startup --enable-event-simulate START.blend --python sculpt-fixtures.py -- OUT.json
import json
import sys

import bpy
from mathutils import Quaternion

out = sys.argv[sys.argv.index("--") + 1]
STEPS = 12
# Front view, Suzanne's face filling the region's middle.
VIEW = {"rotation": (0.7071068, 0.7071068, 0, 0), "distance": 4.0}
# The drag across the face, from the region's center.
DRAG = ((-90, 30), (90, 10))


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
        "face_offsets": [p.loop_start for p in me.polygons] + [len(me.loops)],
        "corner_verts": [l.vertex_index for l in me.loops],
    }


def steps():
    area, region = view3d()
    with bpy.context.temp_override(window=window(), area=area, region=region):
        for ob in list(bpy.data.objects):
            bpy.data.objects.remove(ob)
        bpy.ops.mesh.primitive_monkey_add()
        suzanne = bpy.context.object
        start = mesh_data(suzanne)
        bpy.ops.object.mode_set(mode="SCULPT")
    rv3d = area.spaces.active.region_3d
    rv3d.view_perspective = "PERSP"
    rv3d.view_rotation = Quaternion(VIEW["rotation"]).normalized()
    rv3d.view_distance = VIEW["distance"]
    rv3d.view_location = (0, 0, 0)
    yield 0.5
    sculpt = bpy.context.scene.tool_settings.sculpt
    brush, ups = sculpt.brush, sculpt.unified_paint_settings
    (x0, y0), (x1, y1) = DRAG
    cx, cy = region.width // 2, region.height // 2
    moves = [(cx + round(x0 + (x1 - x0) * i / STEPS), cy + round(y0 + (y1 - y0) * i / STEPS)) for i in range(STEPS + 1)]
    events = [("MOUSEMOVE", "NOTHING", *moves[0]), ("LEFTMOUSE", "PRESS", *moves[0])] + \
        [("MOUSEMOVE", "NOTHING", *p) for p in moves[1:]] + [("LEFTMOUSE", "RELEASE", *moves[-1])]
    for type, value, x, y in events:
        window().event_simulate(type=type, value=value, x=region.x + x, y=region.y + y)
        yield 0.1
    yield 0.5
    result = {
        "tool": bpy.context.workspace.tools.from_space_view3d_mode("SCULPT").idname,
        "brush": {"name": brush.name, "library": bpy.path.basename(brush.library.filepath) if brush.library else None,
                  "size": brush.size, "strength": brush.strength, "direction": brush.direction,
                  "sculpt_brush_type": brush.sculpt_brush_type, "curve_distance_falloff_preset": brush.curve_distance_falloff_preset},
        "unified_paint_settings": {"size": ups.size, "strength": ups.strength, "use_unified_size": ups.use_unified_size,
                                   "use_unified_strength": ups.use_unified_strength},
        "events": events,
        "view": {"viewmat": flat(rv3d.view_matrix), "winmat": flat(rv3d.window_matrix), "winx": region.width,
                 "winy": region.height, "persp": rv3d.is_perspective},
        "start": start, "mesh": mesh_data(suzanne),
        "operator": bpy.context.window_manager.operators[-1].bl_idname if bpy.context.window_manager.operators else None,
    }
    with open(out, "w") as file:
        json.dump(result, file, indent=1)
    print("fixture", result["operator"], flush=True)
    bpy.ops.wm.quit_blender()


queue = steps()
bpy.app.timers.register(lambda: next(queue, None), first_interval=2.0, persistent=True)
