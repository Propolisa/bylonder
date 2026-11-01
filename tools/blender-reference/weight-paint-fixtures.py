# Weight Paint Mode on a grid skinned to a two bone armature, with real input, for tests/weight-paint-wasm.test.js:
# parented With Automatic Weights, the armature selected and the grid active, Weight Paint Mode entered (the armature
# goes to Pose Mode); then an Alt click on each bone (selecting it and its vertex group), a left drag across the grid
# and a Ctrl click (painting the inverse weight). After each, the pose
# selection, the active vertex group and every vertex's weight in each group. Events are in region pixels.
# Run inside an X server, with event simulation:
#   blender --factory-startup --enable-event-simulate --python weight-paint-fixtures.py -- OUT.json
import json
import sys

import bpy
from bpy_extras.view3d_utils import location_3d_to_region_2d
from mathutils import Quaternion, Vector

out = sys.argv[sys.argv.index("--") + 1]
VIEW = {"rotation": (0.7071068, 0.7071068, 0, 0), "location": (0, 0, 1), "distance": 4.0}


def window():
    return bpy.context.window_manager.windows[0]


def view3d():
    area = next(a for a in window().screen.areas if a.type == "VIEW_3D")
    return area, next(r for r in area.regions if r.type == "WINDOW")


def flat(matrix):
    return [matrix[r][c] for c in range(4) for r in range(4)]


def state(grid, rig):
    groups = [g.name for g in grid.vertex_groups]
    weights = {name: [0.0] * len(grid.data.vertices) for name in groups}
    for v in grid.data.vertices:
        for g in v.groups:
            weights[groups[g.group]][v.index] = round(g.weight, 5)
    return {"mode": grid.mode, "rig_mode": rig.mode, "selected": [b.name for b in rig.pose.bones if b.select],
            "active_group": grid.vertex_groups.active.name if grid.vertex_groups.active else None, "weights": weights}


def steps():
    area, region = view3d()
    rv3d = area.spaces.active.region_3d
    with bpy.context.temp_override(window=window(), area=area, region=region):
        for ob in list(bpy.data.objects):
            bpy.data.objects.remove(ob)
        bpy.ops.mesh.primitive_grid_add(x_subdivisions=8, y_subdivisions=8, size=2, location=(0, 0, 1), rotation=(1.5707963, 0, 0))
        grid = bpy.context.object
        bpy.ops.object.armature_add(location=(0, 0, 0))
        rig = bpy.context.object
        bpy.ops.object.mode_set(mode="EDIT")
        rig.data.edit_bones[0].tail = (0, 0, 1)
        bpy.ops.armature.extrude_move(TRANSFORM_OT_translate={"value": (0, 0, 1)})
        bpy.ops.object.mode_set(mode="OBJECT")
        grid.select_set(True)
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        start = state(grid, rig)
        bpy.context.view_layer.objects.active = grid
        bpy.ops.paint.weight_paint_toggle()
    rv3d.view_perspective = "ORTHO"
    rv3d.view_rotation = Quaternion(VIEW["rotation"]).normalized()
    rv3d.view_distance = VIEW["distance"]
    rv3d.view_location = VIEW["location"]
    yield 0.5

    def at(x, z):
        return [round(c) for c in location_3d_to_region_2d(region, rv3d, Vector((x, 0, z)))]

    upper, lower, a, b = at(0.03, 1.5), at(0.03, 0.5), at(-0.9, 0.6), at(0.9, 0.6)
    drag = [[a[0] + (b[0] - a[0]) * i // 10, a[1]] for i in range(11)]

    def click(p, key):
        return [["MOUSEMOVE", "NOTHING", *p], [key, "PRESS", *p], ["LEFTMOUSE", "PRESS", *p], ["LEFTMOUSE", "RELEASE", *p], [key, "RELEASE", *p]]

    cases = [
        ("alt click upper", click(upper, "LEFT_ALT")),
        ("alt click lower", click(lower, "LEFT_ALT")),
        ("stroke", [["MOUSEMOVE", "NOTHING", *drag[0]], ["LEFTMOUSE", "PRESS", *drag[0]]] + [["MOUSEMOVE", "NOTHING", *p] for p in drag[1:]] +
         [["LEFTMOUSE", "RELEASE", *drag[-1]]]),
        ("ctrl click", click(lower, "LEFT_CTRL")),
    ]
    # A click off the grid first: the window takes the first click for its focus.
    for type, value in (("MOUSEMOVE", "NOTHING"), ("LEFTMOUSE", "PRESS"), ("LEFTMOUSE", "RELEASE")):
        window().event_simulate(type=type, value=value, x=region.x + 10, y=region.y + 10)
        yield 0.1
    results = []
    for name, events in cases:
        held = set()
        for type, value, x, y in events:
            if type in ("LEFT_ALT", "LEFT_CTRL"):
                (held.add if value == "PRESS" else held.discard)(type)
            window().event_simulate(type=type, value=value, x=region.x + x, y=region.y + y, alt="LEFT_ALT" in held, ctrl="LEFT_CTRL" in held)
            yield 0.1
        yield 0.5
        results.append({"name": name, "events": events, **state(grid, rig)})
    brush = bpy.context.scene.tool_settings.weight_paint.brush
    result = {"view": {"viewmat": flat(rv3d.view_matrix), "winmat": flat(rv3d.window_matrix), "winx": region.width,
                       "winy": region.height, "persp": rv3d.is_perspective},
              "brush": {"name": brush.name, "weight": brush.weight, "strength": brush.strength, "size": brush.size},
              "start": start, "cases": results}
    with open(out, "w") as file:
        json.dump(result, file, indent=1)
    print("fixture done", flush=True)
    bpy.ops.wm.quit_blender()


queue = steps()
bpy.app.timers.register(lambda: next(queue, None), first_interval=2.0, persistent=True)
