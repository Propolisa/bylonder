# Selecting bones with real input, for tests/bone-select-wasm.test.js: a rig of a chain of three bones and one apart,
# seen from the front, then in Pose Mode and in Edit Mode a click, a Shift click, the Select Box tool's drag, L
# (select_linked_pick), Ctrl click (shortest_path_pick, Edit Mode), C (circle select) and a Ctrl right drag (lasso);
# after each, which bones (and joints) are selected. Events are in region pixels.
# Run inside an X server, with event simulation:
#   blender --factory-startup --enable-event-simulate --python bone-select-fixtures.py -- OUT.json
import json
import sys

import bpy
from bpy_extras.view3d_utils import location_3d_to_region_2d
from mathutils import Quaternion, Vector

out = sys.argv[sys.argv.index("--") + 1]
BONES = [("Root", (0, 0, 0), (0, 0, 1), None), ("Mid", (0, 0, 1), (0, 0, 2), "Root"), ("Tip", (0, 0, 2), (0, 0, 3), "Mid"),
         ("Side", (1.5, 0, 0), (1.5, 0, 1), None)]
VIEW = {"rotation": (0.7071068, 0.7071068, 0, 0), "location": (0.75, 0, 1.5), "distance": 5.0}


def window():
    return bpy.context.window_manager.windows[0]


def view3d():
    area = next(a for a in window().screen.areas if a.type == "VIEW_3D")
    return area, next(r for r in area.regions if r.type == "WINDOW")


def flat(matrix):
    return [matrix[r][c] for c in range(4) for r in range(4)]


def selection(ob):
    if ob.mode == "EDIT":
        return {b.name: [b.select, b.select_head, b.select_tail] for b in ob.data.edit_bones}
    return {b.name: b.select for b in ob.pose.bones}


def steps():
    area, region = view3d()
    rv3d = area.spaces.active.region_3d
    with bpy.context.temp_override(window=window(), area=area, region=region):
        for ob in list(bpy.data.objects):
            bpy.data.objects.remove(ob)
        bpy.ops.object.armature_add()
        ob = bpy.context.object
        bpy.ops.object.mode_set(mode="EDIT")
        arm = ob.data
        for bone in list(arm.edit_bones):
            arm.edit_bones.remove(bone)
        for name, head, tail, parent in BONES:
            bone = arm.edit_bones.new(name)
            bone.head, bone.tail = head, tail
            if parent:
                bone.parent = arm.edit_bones[parent]
                bone.use_connect = True
        bpy.ops.armature.select_all(action="DESELECT")
        bpy.ops.object.mode_set(mode="POSE")
        bpy.ops.pose.select_all(action="DESELECT")
    rv3d.view_perspective = "ORTHO"
    rv3d.view_rotation = Quaternion(VIEW["rotation"]).normalized()
    rv3d.view_distance = VIEW["distance"]
    rv3d.view_location = VIEW["location"]
    yield 0.5

    def at(x, z):
        return [round(c) for c in location_3d_to_region_2d(region, rv3d, Vector((x, 0, z)))]

    MODIFIERS = {"shift": "LEFT_SHIFT", "ctrl": "LEFT_CTRL"}

    def held(events, mods):
        """The events with the modifier keys pressed before and released after, at the first event's place."""
        keys = [MODIFIERS[m] for m in mods]
        x, y = events[0][2:]
        return [[k, "PRESS", x, y] for k in keys] + events + [[k, "RELEASE", *events[-1][2:]] for k in keys]

    def click(x, z, **mods):
        p = at(x, z)
        return held([["MOUSEMOVE", "NOTHING", *p], ["LEFTMOUSE", "PRESS", *p], ["LEFTMOUSE", "RELEASE", *p]], mods)

    def drag(button, start, end, **mods):
        a, b = at(*start), at(*end)
        path = [[a[0] + (b[0] - a[0]) * i // 6, a[1] + (b[1] - a[1]) * i // 6] for i in range(7)]
        return held([["MOUSEMOVE", "NOTHING", *a], [button, "PRESS", *a]] + [["MOUSEMOVE", "NOTHING", *p] for p in path[1:]] +
                    [[button, "RELEASE", *b]], mods)

    def lasso(points, **mods):
        p = [at(*q) for q in points]
        return held([["MOUSEMOVE", "NOTHING", *p[0]], ["RIGHTMOUSE", "PRESS", *p[0]]] + [["MOUSEMOVE", "NOTHING", *q] for q in p[1:] + p[:1]] +
                    [["RIGHTMOUSE", "RELEASE", *p[0]]], mods)

    def key(type, x, z):
        p = at(x, z)
        return [["MOUSEMOVE", "NOTHING", *p], [type, "PRESS", *p], [type, "RELEASE", *p]]

    def circle(x, z):
        p = at(x, z)
        return key("C", x, z) + [["LEFTMOUSE", "PRESS", *p], ["LEFTMOUSE", "RELEASE", *p]] + key("ESC", x, z)

    around = lambda x0, z0, x1, z1: [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    cases = {
        "POSE": [
            ("click", click(0, 1.5)),
            ("shift click", click(1.5, 0.5, shift=True)),
            ("box", drag("LEFTMOUSE", (-0.4, 0.3), (0.4, 1.7))),
            ("L", key("L", 0, 2.5)),
            ("box shift", drag("LEFTMOUSE", (1.2, 0.2), (1.8, 0.8), shift=True)),
            ("box ctrl", drag("LEFTMOUSE", (-0.4, 2.2), (0.4, 2.8), ctrl=True)),
            ("circle", circle(0, 2.5)),
            ("lasso shift", lasso(around(1.2, 0.2, 1.8, 0.8), ctrl=True, shift=True)),
        ],
        "EDIT": [
            ("click tail", click(0, 3)),
            ("ctrl click", click(0, 0.5, ctrl=True)),
            ("box body", drag("LEFTMOUSE", (-0.4, 0.3), (0.4, 0.7))),
            ("L", key("L", 1.5, 0.5)),
            ("click head", click(1.5, 0)),
            ("lasso", lasso(around(-0.4, 1.8, 0.4, 2.2), ctrl=True)),
            ("circle", circle(0, 1)),
            ("box joints", drag("LEFTMOUSE", (-0.4, -0.2), (1.8, 0.2))),
        ],
    }
    results = {}
    for mode, actions in cases.items():
        with bpy.context.temp_override(window=window(), area=area, region=region):
            bpy.ops.object.mode_set(mode=mode)
            (bpy.ops.armature if mode == "EDIT" else bpy.ops.pose).select_all(action="DESELECT")
        yield 0.3
        # A click on nothing first: the window takes the first click after a mode change for its focus.
        p = at(0.75, -1)
        for type, value in (("MOUSEMOVE", "NOTHING"), ("LEFTMOUSE", "PRESS"), ("LEFTMOUSE", "RELEASE")):
            window().event_simulate(type=type, value=value, x=region.x + p[0], y=region.y + p[1])
            yield 0.1
        yield 0.3
        results[mode] = []
        for name, events in actions:
            held_keys = set()
            for type, value, x, y in events:
                if type in MODIFIERS.values():
                    (held_keys.add if value == "PRESS" else held_keys.discard)(type)
                window().event_simulate(type=type, value=value, x=region.x + x, y=region.y + y,
                                        shift="LEFT_SHIFT" in held_keys, ctrl="LEFT_CTRL" in held_keys)
                yield 0.1
            yield 0.3
            results[mode].append({"name": name, "events": events, "selection": selection(ob)})
    result = {"view": {"viewmat": flat(rv3d.view_matrix), "winmat": flat(rv3d.window_matrix), "winx": region.width,
                       "winy": region.height, "persp": rv3d.is_perspective},
              "bones": [[name, head, tail, parent] for name, head, tail, parent in BONES], "cases": results}
    with open(out, "w") as file:
        json.dump(result, file, indent=1)
    print("fixture done", flush=True)
    bpy.ops.wm.quit_blender()


queue = steps()
bpy.app.timers.register(lambda: next(queue, None), first_interval=2.0, persistent=True)
