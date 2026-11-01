# The pose library's asset shelf with real input, for tests/pose-library-wasm.test.js: a rig of a chain of two bones
# in Pose Mode, Pose > Create Pose Asset on a bent pose, the pose cleared; then View > Asset Shelf, a click on the
# pose's tile (VIEW3D_AST_pose_library's activate operator, Apply Pose) and a drag from it (its drag operator, Blend Pose
# Asset). After each, the asset shelf's regions and every pose bone's rotation. Events are in region pixels of the shelf.
# Run inside an X server, with event simulation:
#   blender --factory-startup --enable-event-simulate --python pose-library-fixtures.py -- OUT.json
import json
import sys

import bpy
from mathutils import Quaternion

out = sys.argv[sys.argv.index("--") + 1]
BONES = [("Root", (0, 0, 0), (0, 0, 1), None), ("Tip", (0, 0, 1), (0, 0, 2), "Root")]
POSE = {"Root": (0.9238795, 0.3826834, 0, 0), "Tip": (0.7071068, 0, 0.7071068, 0)}
# Region pixels in the asset shelf: inside the first tile, and how far right a drag goes from there.
TILE = (30, 30)
DRAG = 60


def window():
    return bpy.context.window_manager.windows[0]


def view3d():
    area = next(a for a in window().screen.areas if a.type == "VIEW_3D")
    return area, {r.type: r for r in area.regions}


def rotations(ob):
    return {b.name: [round(c, 5) for c in b.rotation_quaternion] for b in ob.pose.bones}


def regions():
    _, by_type = view3d()
    return {t: [r.x - by_type["WINDOW"].x, r.y - by_type["WINDOW"].y, r.width, r.height]
            for t, r in by_type.items() if t in {"ASSET_SHELF", "ASSET_SHELF_HEADER", "WINDOW"}}


def steps():
    # The interface at scale 1, as the module's, whatever the X server's resolution.
    prefs = bpy.context.preferences
    prefs.view.ui_scale /= prefs.system.ui_scale
    yield 0.5
    area, by_type = view3d()
    region = by_type["WINDOW"]
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
        bpy.ops.object.mode_set(mode="POSE")
        bpy.ops.pose.select_all(action="SELECT")
        for name, rotation in POSE.items():
            ob.pose.bones[name].rotation_quaternion = Quaternion(rotation)
        bpy.ops.poselib.create_pose_asset(pose_name="Bent")
        bpy.ops.pose.rot_clear()
    yield 0.5
    results = {"hidden": {"shown": area.spaces.active.show_region_asset_shelf, "rotations": rotations(ob)}}
    area.spaces.active.show_region_asset_shelf = True
    yield 1.5
    results["shown"] = {"shown": area.spaces.active.show_region_asset_shelf, "regions": regions()}
    shelf = view3d()[1]["ASSET_SHELF"]

    def send(type, value, x, y):
        window().event_simulate(type=type, value=value, x=shelf.x + x, y=shelf.y + y)

    # A click on the shelf's empty space first: the window takes the first click for its focus.
    for event in (["MOUSEMOVE", "NOTHING", 1000, 30], ["LEFTMOUSE", "PRESS", 1000, 30], ["LEFTMOUSE", "RELEASE", 1000, 30]):
        send(*event)
        yield 0.1
    cases = {
        "click": [["MOUSEMOVE", "NOTHING", *TILE], ["LEFTMOUSE", "PRESS", *TILE], ["LEFTMOUSE", "RELEASE", *TILE]],
        "drag": [["MOUSEMOVE", "NOTHING", *TILE], ["LEFTMOUSE", "PRESS", *TILE]] +
                [["MOUSEMOVE", "NOTHING", TILE[0] + DRAG * i // 6, TILE[1]] for i in range(1, 7)] +
                [["LEFTMOUSE", "RELEASE", TILE[0] + DRAG, TILE[1]]],
    }
    for name, events in cases.items():
        with bpy.context.temp_override(window=window(), area=area, region=region):
            bpy.ops.pose.rot_clear()
        yield 0.3
        for event in events:
            send(*event)
            yield 0.1
        yield 0.5
        results[name] = {"events": events, "rotations": rotations(ob)}
    with open(out, "w") as file:
        json.dump({"bones": BONES, "pose": POSE, "cases": results}, file, indent=1)
    print("fixture done", flush=True)
    bpy.ops.wm.quit_blender()


queue = steps()
bpy.app.timers.register(lambda: next(queue, None), first_interval=2.0, persistent=True)
