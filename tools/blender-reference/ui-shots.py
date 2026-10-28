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
from bpy_extras.view3d_utils import location_3d_to_region_2d

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
# The third channel row's centre below a channel region's top: the search row, two rows, half a row (as parity.mjs).
CHANNEL_ROW_2 = 67


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


def shift_click(x, y):
    move(x, y)
    window().event_simulate(type="LEFTMOUSE", value="PRESS", x=x, y=y, shift=True)
    window().event_simulate(type="LEFTMOUSE", value="RELEASE", x=x, y=y, shift=True)


# The text a key types, which numeric input reads.
TEXT = {"MINUS": "-", "ONE": "1", "TWO": "2", "THREE": "3", "FOUR": "4"}


def text(type):
    return {"unicode": TEXT[type]} if type in TEXT else {}


# A key press with the mouse at (x, y): simulated events carry their own mouse position.
def key(type, x, y, **modifiers):
    move(x, y)
    window().event_simulate(type=type, value="PRESS", x=x, y=y, **modifiers)
    window().event_simulate(type=type, value="RELEASE", x=x, y=y, **{k: v for k, v in modifiers.items() if k != "unicode"})


# A point of the scene in window pixels, as the 3D View shows it.
def view3d_project(co):
    view = area("VIEW_3D")
    region = next(r for r in view.regions if r.type == "WINDOW")
    p = location_3d_to_region_2d(region, view.spaces.active.region_3d, co)
    return round(region.x + p.x), round(region.y + p.y)


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


# The cube's location keyed at frames 1 and 40, then an area (the Timeline's) showing another editor.
def animation_editor(ui_type, kind="DOPESHEET_EDITOR"):
    cube = bpy.data.objects["Cube"]
    cube.keyframe_insert("location", frame=1)
    cube.location = (2, 0, 1)
    cube.keyframe_insert("location", frame=40)
    bpy.context.scene.frame_set(1)
    area(kind).ui_type = ui_type
# The sidebar of an area's editor on a tab (Region.active_panel_category).
def sidebar_tab(kind, category):
    region = next(r for r in area(kind).regions if r.type == "UI")
    region.active_panel_category = category


# The Graph Editor in the 3D View's area with a Generator and an Envelope added to the active F-Curve (X Location) by
# graph.fmodifier_add, as its Add Modifier menu adds them, its sidebar on the Modifiers tab.
def graph_fmodifiers():
    animation_editor("FCURVES", "VIEW_3D")
    graph = area("GRAPH_EDITOR")
    with bpy.context.temp_override(window=window(), area=graph, region=next(r for r in graph.regions if r.type == "WINDOW")):
        for type in ("GENERATOR", "ENVELOPE"):
            bpy.ops.graph.fmodifier_add(type=type, only_active=True)
    later(0.3, lambda: sidebar_tab("GRAPH_EDITOR", "Modifiers"))


# A driver on the cube's Y location (driver_add), the Drivers editor in the 3D View's area, the driver clicked in its
# channel list (the third row) to make it active, its sidebar on the Drivers tab.
def drivers_editor():
    bpy.data.objects["Cube"].driver_add("location", 1)
    view = area("VIEW_3D")
    view.ui_type = "DRIVERS"
    def click_driver():
        region = next(r for r in area("GRAPH_EDITOR").regions if r.type == "CHANNELS")
        click(region.x + 80, region.y + region.height - CHANNEL_ROW_2)
    later(0.5, click_driver)
    later(1.0, lambda: sidebar_tab("GRAPH_EDITOR", "Drivers"))


# The cube's location keyed, the 3D View's area a Dope Sheet in a mode (SpaceDopeSheetEditor.ui_mode).
def dope_sheet_mode(mode):
    def setup():
        view = area("VIEW_3D")
        animation_editor("DOPESHEET", "VIEW_3D")
        view.spaces.active.ui_mode = mode
    return setup


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


# Edit Mode with everything selected and an Edit Mode tool, the mouse over `anchor` (a scene point) or resting.
def edit_tool(name, anchor=None):
    def setup():
        key("TAB", *view3d_point(*REST))
        later(0.5, lambda: key("A", *view3d_point(*REST)))
        later(1.0, lambda: set_tool(name))
        later(1.5, lambda: move(*(view3d_project(anchor) if anchor else view3d_point(*REST))))
    return setup


# The cube deleted, then an object added by its operator in the 3D View, then Edit Mode, as Delete, the Add menu and
# Tab do in parity.mjs.
def add_and_edit(module, name, **props):
    bpy.data.objects.remove(bpy.data.objects["Cube"])
    view = area("VIEW_3D")
    region = next(r for r in view.regions if r.type == "WINDOW")
    with bpy.context.temp_override(window=window(), area=view, region=region):
        getattr(getattr(bpy.ops, module), name)(**props)
        bpy.ops.object.mode_set(mode="EDIT")


# Keys typed in turn with the mouse resting, as event types ("S", "THREE", "RET"), a quarter second apart so the view
# and a modal operator are ready for each; `shift` holds Shift for the first. Returns the seconds they take.
def keys(*types, start=0.0, shift=False):
    for i, type in enumerate(types):
        later(start + 0.25 * (i + 1), lambda type=type, i=i: key(type, *view3d_point(*REST), shift=shift and i == 0, **text(type)))
    return start + 0.25 * len(types)


# The cube duplicated and moved by typed values (Shift D, then axis and value keys). Returns the seconds it takes.
def duplicate(*moves):
    end = keys("D", *moves[0], "RET", shift=True)
    for move in moves[1:]:
        end = keys("G", *move, "RET", start=end)
    return end


SETUP = {
    "startup": lambda: None,
    "object-menu": lambda: click(*OBJECT_MENU),
    "file-menu": lambda: click(*FILE_MENU),
    "add-menu": lambda: key("A", *view3d_point(0.5, 0.5), shift=True),
    "edit-mode": lambda: key("TAB", *view3d_point(*REST)),
    "modifier-tab": add_subdivision,
    "graph-editor": lambda: animation_editor("FCURVES"),
    "dope-sheet": lambda: animation_editor("DOPESHEET"),
    "graph-editor-large": lambda: animation_editor("FCURVES", "VIEW_3D"),
    "graph-fmodifiers": graph_fmodifiers,
    "drivers-editor": drivers_editor,
    "action-editor": dope_sheet_mode("ACTION"),
    "object-tab": properties_tab("Cube", "OBJECT"),
    "light-data": properties_tab("Light", "DATA"),
    "camera-data": properties_tab("Camera", "DATA"),
    "toolbar": click_tool,
    "cursor-tool": cursor_tool,
    "inset-tool": inset_tool,
    "loop-cut-tool": edit_tool("builtin.loop_cut", (1, 1, 0)),
    "spin-tool": edit_tool("builtin.spin"),
    "poly-build-tool": edit_tool("builtin.poly_build", (1, 1, 0)),
    "sidebar-item": lambda: key("N", *view3d_point(*REST)),
    "curve-edit": lambda: add_and_edit("curve", "primitive_bezier_circle_add"),
    "text-edit": lambda: add_and_edit("object", "text_add"),
    "scripting": lambda: setattr(window(), "workspace", bpy.data.workspaces["Scripting"]),
    "outliner-expanded": lambda: key("A", *outliner_point(0.5, 0.5), shift=True),
    "outline-scale-3": lambda: keys("S", "THREE", "RET"),
    "outline-active-selected": lambda: later(duplicate(("Y", "THREE")) + 0.5, lambda: shift_click(*view3d_point(0.5, 0.5))),
    "outline-occluded": lambda: duplicate(("Y", "THREE"), ("X", "MINUS", "TWO")),
    "xray": lambda: later(0.25, lambda: key("Z", *view3d_point(*REST), alt=True)),
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
        # Draws what the last events changed: Blender redraws on events, and the last ones can be handled after.
        for a in window().screen.areas:
            a.tag_redraw()
        yield 0.5
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
