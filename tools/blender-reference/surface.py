# Writes Blender's user-facing surface as a tree: per editor, its header menus (per mode in the 3D Viewport),
# sidebar and header panels, Properties tabs and panels, and keymap items. Menus are drawn into a recording
# layout, so the tree is exactly what Blender shows.
# usage: blender -b --factory-startup --python tools/blender-reference/surface.py -- OUT.json
import bpy, json, os, sys, types

out_path = sys.argv[sys.argv.index("--") + 1]
sys.path.append(os.path.join(bpy.utils.resource_path("LOCAL"), "scripts", "presets", "keyconfig", "keymap_data"))
import blender_default

EDITORS = [
    ("TOPBAR", "Top Bar", None),
    ("VIEW_3D", "3D Viewport", "VIEW3D_MT_editor_menus"),
    ("OUTLINER", "Outliner", "OUTLINER_MT_editor_menus"),
    ("PROPERTIES", "Properties", None),
    ("TIMELINE", "Timeline", "DOPESHEET_MT_editor_menus"),
    ("DOPESHEET", "Dope Sheet", "DOPESHEET_MT_editor_menus"),
    ("FCURVES", "Graph Editor", "GRAPH_MT_editor_menus"),
    ("DRIVERS", "Drivers", "GRAPH_MT_editor_menus"),
    ("NLA_EDITOR", "Nonlinear Animation", "NLA_MT_editor_menus"),
    ("ShaderNodeTree", "Shader Editor", "NODE_MT_editor_menus"),
    ("CompositorNodeTree", "Compositor", "NODE_MT_editor_menus"),
    ("GeometryNodeTree", "Geometry Node Editor", "NODE_MT_editor_menus"),
    ("SEQUENCE_EDITOR", "Video Sequencer", "SEQUENCER_MT_editor_menus"),
    ("IMAGE_EDITOR", "Image Editor", "IMAGE_MT_editor_menus"),
    ("UV", "UV Editor", "IMAGE_MT_editor_menus"),
    ("TEXT_EDITOR", "Text Editor", "TEXT_MT_editor_menus"),
    ("CONSOLE", "Python Console", "CONSOLE_MT_editor_menus"),
    ("INFO", "Info", "INFO_MT_editor_menus"),
    ("SPREADSHEET", "Spreadsheet", None),
    ("ASSETS", "Asset Browser", "FILEBROWSER_MT_editor_menus"),
    ("FILES", "File Browser", "FILEBROWSER_MT_editor_menus"),
    ("CLIP_EDITOR", "Movie Clip Editor", "CLIP_MT_editor_menus"),
    ("PREFERENCES", "Preferences", None),
]
MODES = [("OBJECT", "Object Mode"), ("EDIT", "Edit Mode"), ("SCULPT", "Sculpt Mode"), ("VERTEX_PAINT", "Vertex Paint"),
         ("WEIGHT_PAINT", "Weight Paint"), ("TEXTURE_PAINT", "Texture Paint")]
# Keymaps that belong to a 3D Viewport mode rather than an editor.
MODE_KEYMAPS = {"OBJECT": ["Object Mode", "Object Non-modal"], "EDIT": ["Mesh"], "SCULPT": ["Sculpt"],
                "VERTEX_PAINT": ["Vertex Paint"], "WEIGHT_PAINT": ["Weight Paint"], "TEXTURE_PAINT": ["Image Paint"]}
SPACE_OF = {"TIMELINE": "DOPESHEET_EDITOR", "DOPESHEET": "DOPESHEET_EDITOR", "ShaderNodeTree": "NODE_EDITOR",
            "CompositorNodeTree": "NODE_EDITOR", "GeometryNodeTree": "NODE_EDITOR", "UV": "IMAGE_EDITOR",
            "FILES": "FILE_BROWSER", "ASSETS": "FILE_BROWSER", "FCURVES": "GRAPH_EDITOR", "DRIVERS": "GRAPH_EDITOR", "TOPBAR": "TOPBAR", "PREFERENCES": "PREFERENCES"}
SKIP_PANEL_PREFIXES = ("CYCLES_", "WORKBENCH_", "HYDRA_", "EEVEE_NEXT_LEGACY")


def op_label(idname):
    try:
        module, name = idname.split(".", 1)
        return getattr(getattr(bpy.ops, module), name).get_rna_type().name or idname
    except Exception:
        return idname


class Recorder:
    def __init__(self, out):
        self.out = out

    def operator(self, idname, text=None, **kw):
        node = {"k": "op", "id": idname, "l": text or op_label(idname)}
        self.out.append(node)
        return Props(node)

    def operator_menu_enum(self, idname, prop=None, text=None, **kw):
        prop = prop or kw.get("property")
        self.out.append({"k": "menu", "id": idname + ":" + prop, "l": text or op_label(idname), "c": enum_items(idname, prop)})

    def operator_enum(self, idname, prop=None, **kw):
        self.out.extend(enum_items(idname, prop or kw.get("property")))

    def menu(self, name, text=None, **kw):
        cls = getattr(bpy.types, name, None)
        self.out.append({"k": "menu", "id": name, "l": text or getattr(cls, "bl_label", name)})

    def menu_contents(self, name):
        self.menu(name)

    def popover(self, panel, text=None, **kw):
        cls = getattr(bpy.types, panel, None)
        self.out.append({"k": "panel", "id": panel, "l": text or getattr(cls, "bl_label", panel)})

    def __getattr__(self, name):
        if name in ("row", "column", "split", "box", "column_flow", "grid_flow", "menu_pie", "panel", "panel_prop"):
            return lambda *a, **k: self if name not in ("panel", "panel_prop") else (Header(self), self)
        return lambda *a, **k: None

    operator_context = "INVOKE_REGION_WIN"


class Header(Recorder):
    pass


# Typed operators (node.add_node type=..., object.modifier_add type=..., wm.call_menu name=...) become one leaf per
# value, so node types, modifier types and called menus are counted one by one.
KEYED_PROPS = ("type", "name", "mode", "action", "direction", "axis")


class Props:
    def __init__(self, node):
        self.__dict__["node"] = node

    def __getattr__(self, k):
        return Props({"id": ":"})

    def __call__(self, *a, **k):
        return Props({"id": ":"})

    def __setitem__(self, k, v):
        pass

    def __setattr__(self, k, v):
        if k in KEYED_PROPS and isinstance(v, str) and ":" not in self.node["id"]:
            self.node["id"] += ":" + v


def enum_items(idname, prop):
    try:
        module, name = idname.split(".", 1)
        rna = getattr(getattr(bpy.ops, module), name).get_rna_type().properties[prop]
        return [{"k": "op", "id": idname + ":" + item.identifier, "l": item.name} for item in rna.enum_items]
    except Exception:
        return [{"k": "op", "id": idname, "l": op_label(idname)}]


class Instance:
    """Stands in for a menu instance: class attributes and methods of the menu, plus a recording layout."""

    def __init__(self, cls, layout):
        self.__dict__.update(cls=cls, layout=layout)

    def __getattr__(self, name):
        value = getattr(self.cls, name)
        return types.MethodType(value, self) if isinstance(value, types.FunctionType) else value


class Context:
    def __init__(self, **overrides):
        self.__dict__["o"] = overrides

    def __getattr__(self, name):
        if name in self.o:
            return self.o[name]
        return getattr(bpy.context, name)


def draw_menu(name, ctx, seen):
    cls = getattr(bpy.types, name, None)
    # Swap menus repeat the Add menus.
    if cls is None or name in seen or name.endswith("_swap"):
        return []
    seen = seen | {name}
    out = []
    try:
        cls.draw(Instance(cls, Recorder(out)), ctx)
    except Exception as error:
        print("draw failed", name, repr(error)[:120])
    result = []
    for node in out:
        if node["k"] == "menu" and not node.get("c"):
            node["c"] = draw_menu(node["id"], ctx, seen)
        result += node["c"] if node["k"] == "menu" and not node["l"] else [node]
    return dedupe(result)


def dedupe(nodes):
    seen, result = set(), []
    for n in nodes:
        key = (n["k"], n["id"], n["l"])
        if key not in seen:
            seen.add(key)
            result.append(n)
    return result


PANEL_CLASSES = {}
ADD_MENUS = {"modifier": ["OBJECT_MT_modifier_add"]}
ADD_ENUMS = {"constraint": ("object.constraint_add", "type", "Add Object Constraint")}


# Panels Blender registers in C, which bpy.types does not list (view3d_buttons_register).
C_PANELS = [type(name, (), {"bl_space_type": "VIEW_3D", "bl_region_type": "UI", "bl_label": label, "bl_category": "Item"})
            for name, label in [("VIEW3D_PT_transform", "Transform"), ("VIEW3D_PT_vgroup", "Vertex Weights"), ("VIEW3D_PT_curves", "Curve Data")]]


def panels_for(space, region=None, context=None):
    panels = C_PANELS + [p for p in bpy.types.Panel.__subclasses__() if getattr(p, "bl_space_type", None) == space]
    panels = [p for p in panels if getattr(p, "bl_space_type", None) == space]
    # Bylonder's engine stands in for EEVEE, so panels of other engines are left out.
    panels = [p for p in panels if not p.__name__.startswith(SKIP_PANEL_PREFIXES)
              and "BLENDER_EEVEE" in getattr(p, "COMPAT_ENGINES", {"BLENDER_EEVEE"})]
    if region:
        panels = [p for p in panels if getattr(p, "bl_region_type", "") == region]
    if context is not None:
        panels = [p for p in panels if getattr(p, "bl_context", "") == context]
    by_parent = {}
    for p in panels:
        PANEL_CLASSES[p.__name__] = p
        by_parent.setdefault(getattr(p, "bl_parent_id", ""), []).append(p)

    def tree(parent):
        return [{"k": "panel", "id": p.__name__, "l": getattr(p, "bl_label", p.__name__) or p.__name__, "c": tree(p.__name__)}
                for p in sorted(by_parent.get(parent, []), key=lambda p: getattr(p, "bl_order", 0))]
    return tree("")


def grouped(nodes, key, label):
    groups = {}
    for n in nodes:
        groups.setdefault(key(n), []).append(n)
    return [{"k": "group", "id": label + ":" + g, "l": g, "c": c} for g, c in groups.items()]


KEYMAPS = {name: (params, items["items"]) for name, params, items in blender_default.generate_keymaps(blender_default.Params(select_mouse='LEFT', spacebar_action='PLAY'))}


def key_text(event):
    parts = [m.capitalize() for m in ("shift", "ctrl", "alt", "oskey") if event.get(m)]
    if event.get("any"):
        parts.insert(0, "Any")
    key = event.get("type", "")
    if event.get("value") in ("CLICK_DRAG", "DOUBLE_CLICK"):
        parts.append({"CLICK_DRAG": "Drag", "DOUBLE_CLICK": "Double"}[event["value"]])
    return " ".join(parts + [key.replace("_", " ").title().replace("Ndof", "NDOF")])


CALLED = set()


def keymap_node(name):
    params, items = KEYMAPS[name]
    children = []
    for idname, event, extra in items:
        props = dict((extra or {}).get("properties", []) or [])
        label = op_label(idname)
        if idname in ("wm.call_menu", "wm.call_menu_pie", "wm.call_panel") and "name" in props:
            cls = getattr(bpy.types, props["name"], None)
            label = getattr(cls, "bl_label", props["name"]) + (" (pie)" if idname.endswith("pie") else "")
            idname = props["name"]
            CALLED.add(idname)
        children.append({"k": "key", "id": idname, "l": label, "x": key_text(event or {})})
    return {"k": "keymap", "id": "keymap:" + name, "l": name, "c": dedupe_keys(children)}


def dedupe_keys(nodes):
    seen, result = set(), []
    for n in nodes:
        key = (n["id"], n["x"])
        if key not in seen:
            seen.add(key)
            result.append(n)
    return result


# Modal keymaps of 3D View tools, listed under the 3D Viewport. Their items are modal events (propvalues such as
# AXIS_X, which C names TFM_MODAL_AXIS_X), counted per keymap.
VIEW3D_MODAL_KEYMAPS = ("Transform Modal Map", "Gesture Box", "View3D Gesture Circle", "Gesture Lasso", "Standard Modal Map",
                        "Knife Tool Modal Map", "Bevel Modal Map", "Custom Normals Modal Map", "Transform Axis Target Modal Map",
                        "View3D Rotate Modal", "View3D Move Modal", "View3D Zoom Modal", "View3D Dolly Modal", "View3D Fly Modal",
                        "View3D Walk Modal", "View3D Placement Modal", "Generic Gizmo Tweak Modal Map")
MODAL_IDS = set()


def modal_keymap_node(name):
    params, items = KEYMAPS[name]
    children = []
    for propvalue, event, _extra in items:
        MODAL_IDS.add(propvalue)
        children.append({"k": "key", "id": propvalue, "l": propvalue.replace("_", " ").title(), "x": key_text(event or {})})
    return {"k": "keymap", "id": "keymap:" + name, "l": name, "c": dedupe_keys(children)}


def keymaps_for(space):
    maps = [keymap_node(name) for name, (params, items) in KEYMAPS.items()
            if params.get("space_type") == space and not params.get("modal") and items]
    tools = [m for m in maps if " Tool: " in m["l"]]
    rest = [m for m in maps if m not in tools]
    return rest + ([{"k": "group", "id": space + ":tools", "l": "Tool Keymaps", "c": tools}] if tools else [])


def node_tree(tree_type):
    if tree_type == "ShaderNodeTree":
        return bpy.data.materials["Material"].node_tree
    tree = bpy.data.node_groups.new(tree_type, tree_type)
    if tree_type == "CompositorNodeTree":
        bpy.context.scene.compositing_node_group = tree
    return tree


def set_mode(mode):
    if bpy.context.object.mode != mode:
        bpy.ops.object.mode_set(mode=mode)


bpy.context.view_layer.objects.active = bpy.data.objects["Cube"]
screen = bpy.data.screens["Layout"]
area = screen.areas[0]
editors = []
for ui_type, label, menus in EDITORS:
    children = []
    space_type = SPACE_OF.get(ui_type, ui_type)
    if ui_type == "TOPBAR":
        children.append({"k": "group", "id": "TOPBAR:menus", "l": "Menus", "c": draw_menu("TOPBAR_MT_editor_menus", Context(), set())})
        children += [keymap_node(n) for n in ("Window", "Screen", "Screen Editing", "User Interface", "Frames", "Animation", "Markers", "View2D") if n in KEYMAPS]
    elif ui_type == "PREFERENCES":
        children = grouped(panels_for("PREFERENCES", "WINDOW"), lambda n: n["id"].split("_PT_")[1].split("_")[0].title(), "PREFERENCES")
    else:
        area.ui_type = ui_type
        space = area.spaces.active
        if ui_type.endswith("NodeTree"):
            space.node_tree = node_tree(ui_type)
        ctx = Context(area=area, space_data=space, region=area.regions[0])
        if ui_type == "VIEW_3D":
            for mode, mode_label in MODES:
                set_mode(mode)
                mode_children = [{"k": "group", "id": "VIEW_3D:" + mode + ":menus", "l": "Header Menus", "c": draw_menu(menus, ctx, set())}]
                mode_children += [keymap_node(n) for n in MODE_KEYMAPS[mode] if n in KEYMAPS]
                children.append({"k": "mode", "id": "VIEW_3D:" + mode, "l": mode_label, "c": mode_children})
            set_mode("OBJECT")
        elif menus:
            children.append({"k": "group", "id": ui_type + ":menus", "l": "Header Menus", "c": draw_menu(menus, ctx, set())})
        if ui_type == "PROPERTIES":
            for context in ("render", "output", "view_layer", "scene", "world", "collection", "object", "modifier",
                            "particle", "physics", "constraint", "data", "material", "texture"):
                panels = panels_for("PROPERTIES", "WINDOW", context)
                for menu in ADD_MENUS.get(context, []):
                    panels.append({"k": "menu", "id": menu, "l": getattr(bpy.types, menu).bl_label, "c": draw_menu(menu, ctx, set())})
                if context in ADD_ENUMS:
                    idname, prop, menu_label = ADD_ENUMS[context]
                    panels.append({"k": "menu", "id": idname + ":" + prop, "l": menu_label, "c": enum_items(idname, prop)})
                children.append({"k": "group", "id": "PROPERTIES:" + context, "l": context.replace("_", " ").title(), "c": panels})
        elif space_type != "TOPBAR":
            sidebar = panels_for(space_type, "UI")
            if sidebar:
                children.append({"k": "group", "id": ui_type + ":sidebar", "l": "Sidebar", "c": grouped(sidebar, lambda n: getattr(PANEL_CLASSES[n["id"]], "bl_category", "") or "Misc", ui_type + ":sidebar")})
            popovers = panels_for(space_type, "HEADER")
            if popovers:
                children.append({"k": "group", "id": ui_type + ":popovers", "l": "Header Popovers", "c": popovers})
        children += keymaps_for(space_type)
        if ui_type == "VIEW_3D":
            children.append({"k": "group", "id": "VIEW_3D:modal", "l": "Modal Keymaps", "c": [modal_keymap_node(n) for n in VIEW3D_MODAL_KEYMAPS if n in KEYMAPS]})
    editors.append({"k": "area", "id": ui_type, "l": label, "c": children})

with open(out_path, "w") as f:
    ids = sorted({m + "." + o for m in dir(bpy.ops) for o in dir(getattr(bpy.ops, m))}
                 | {c.__name__ for c in bpy.types.Menu.__subclasses__() + bpy.types.Panel.__subclasses__() + bpy.types.Header.__subclasses__() + C_PANELS}
                 | {t for t in dir(bpy.types) if "_MT_" in t or "_PT_" in t or "_HT_" in t} | CALLED | MODAL_IDS)
    json.dump({"blender": bpy.app.version_string, "ids": ids, "tree": editors}, f, separators=(",", ":"))
print("surface written", out_path)
