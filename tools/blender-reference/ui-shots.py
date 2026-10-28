# Screenshots of Blender's UI in the states of ui-states.json, for the visual parity harness (parity.mjs).
# Run inside an X server with ImageMagick's `import`, with event simulation so the states come from real input:
#   blender --factory-startup --enable-event-simulate START.blend --python ui-shots.py -- OUT_DIR [STATE ...]
# START.blend is the factory startup saved as a file, which skips the splash screen. Coordinates assume a
# 1600 x 950 window at UI scale 1 (an X server at 96 DPI).
import json
import os
import subprocess
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
out, only = args[0], args[1:]
bpy.context.preferences.view.show_tooltips = False
STATES = json.load(open(os.path.join(os.path.dirname(__file__), "ui-states.json")))

# Header buttons, in window pixels from the bottom left.
FILE_MENU = (42, 938)
OBJECT_MENU = (318, 913)
# The Move tool, the third button of the 3D View's toolbar.
MOVE_TOOL = (30, 772)
# Where the mouse rests, as a fraction of the 3D View from its top left; the same point as parity.mjs uses.
REST = (0.25, 0.75)


def window():
    return bpy.context.window_manager.windows[0]


def area(kind):
    return next(a for a in window().screen.areas if a.type == kind)


def view3d_point(fx, fy):
    region = next(r for r in area("VIEW_3D").regions if r.type == "WINDOW")
    return round(region.x + region.width * fx), round(region.y + region.height * (1 - fy))


def move(x, y):
    window().event_simulate(type="MOUSEMOVE", value="NOTHING", x=x, y=y)


def click(x, y):
    move(x, y)
    window().event_simulate(type="LEFTMOUSE", value="PRESS", x=x, y=y)
    window().event_simulate(type="LEFTMOUSE", value="RELEASE", x=x, y=y)


# A key press with the mouse at (x, y): simulated events carry their own mouse position.
def key(type, x, y, **modifiers):
    move(x, y)
    window().event_simulate(type=type, value="PRESS", x=x, y=y, **modifiers)
    window().event_simulate(type=type, value="RELEASE", x=x, y=y, **modifiers)


def outliner_point(fx, fy):
    region = next(r for r in area("OUTLINER").regions if r.type == "WINDOW")
    return round(region.x + region.width * fx), round(region.y + region.height * (1 - fy))


def rest():
    move(*view3d_point(*REST))


def add_subdivision():
    cube = bpy.data.objects["Cube"]
    with bpy.context.temp_override(window=window(), object=cube, active_object=cube):
        bpy.ops.object.modifier_add(type="SUBSURF")
    area("PROPERTIES").spaces.active.context = "MODIFIER"


# The cube's location keyed at frames 1 and 40, then the Timeline's area showing another of its editors.
def animation_editor(ui_type):
    cube = bpy.data.objects["Cube"]
    cube.keyframe_insert("location", frame=1)
    cube.location = (2, 0, 1)
    cube.keyframe_insert("location", frame=40)
    bpy.context.scene.frame_set(1)
    area("DOPESHEET_EDITOR").ui_type = ui_type
def properties_tab(name, tab):
    """The object made active and selected alone, and the Properties editor on a tab."""
    def setup():
        layer = window().view_layer
        for ob in layer.objects:
            ob.select_set(ob.name == name, view_layer=layer)
        layer.objects.active = bpy.data.objects[name]
        area("PROPERTIES").spaces.active.context = tab
    return setup


def click_tool():
    # A toolbar button takes events once a redraw after the hover has made it active.
    for i, (kind, value) in enumerate([("MOUSEMOVE", "NOTHING"), ("LEFTMOUSE", "PRESS"), ("LEFTMOUSE", "RELEASE")]):
        bpy.app.timers.register(lambda kind=kind, value=value: window().event_simulate(type=kind, value=value, x=MOVE_TOOL[0], y=MOVE_TOOL[1]) and None,
                                first_interval=0.1 + 0.3 * i)


def set_tool(name):
    with bpy.context.temp_override(window=window(), area=area("VIEW_3D")):
        bpy.ops.wm.tool_set_by_id(name=name)


# A step once the events sent before it are handled.
def later(seconds, step):
    bpy.app.timers.register(lambda: step() and None, first_interval=seconds)


def cursor_tool():
    set_tool("builtin.cursor")
    later(0.5, lambda: click(*view3d_point(0.55, 0.42)))


def inset_tool():
    key("TAB", *view3d_point(*REST))
    later(0.5, lambda: key("A", *view3d_point(*REST)))
    later(1.0, lambda: set_tool("builtin.inset_faces"))


SETUP = {
    "startup": lambda: None,
    "object-menu": lambda: click(*OBJECT_MENU),
    "file-menu": lambda: click(*FILE_MENU),
    "add-menu": lambda: key("A", *view3d_point(0.5, 0.5), shift=True),
    "edit-mode": lambda: key("TAB", *view3d_point(*REST)),
    "modifier-tab": add_subdivision,
    "graph-editor": lambda: animation_editor("FCURVES"),
    "dope-sheet": lambda: animation_editor("DOPESHEET"),
    "object-tab": properties_tab("Cube", "OBJECT"),
    "light-data": properties_tab("Light", "DATA"),
    "camera-data": properties_tab("Camera", "DATA"),
    "toolbar": click_tool,
    "cursor-tool": cursor_tool,
    "inset-tool": inset_tool,
    "sidebar-item": lambda: key("N", *view3d_point(*REST)),
    "outliner-expanded": lambda: key("A", *outliner_point(0.5, 0.5), shift=True),
}


def steps():
    for state in STATES:
        if only and state["id"] not in only:
            continue
        with bpy.context.temp_override(window=window()):
            bpy.ops.wm.read_homefile()
        yield 1.0
        rest()
        yield 0.3
        SETUP[state["id"]]()
        # Seconds to settle: the sidebar fades in slowly under Xvfb.
        yield state.get("settle", 1.5)
        subprocess.run(["import", "-window", "root", os.path.join(out, state["id"] + ".png")], check=True)
        areas[state["id"]] = [
            {"type": a.type, "x": a.x, "y": window().height - a.y - a.height, "width": a.width, "height": a.height}
            for a in window().screen.areas
        ]
        print("shot", state["id"], flush=True)
    with open(AREAS, "w") as file:
        json.dump(areas, file, indent=1)
    bpy.ops.wm.quit_blender()


# Area rectangles per state from the top left, for mismatch scores per editor.
AREAS = os.path.join(out, "areas.json")
areas = json.load(open(AREAS)) if os.path.exists(AREAS) else {}


queue = steps()
bpy.app.timers.register(lambda: next(queue, None), first_interval=2.0, persistent=True)
