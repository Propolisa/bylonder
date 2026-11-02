"""CPython's startup script in Bylonder (Blender's scripts/startup, registered by bpy.utils.load_scripts). The interface
is the transpiled tree's (src/bl_py): Blender's own startup packages (bl_ui, bl_operators) are importable modules here,
not registered. What runs Python itself registers here, replacing the tree's classes of the same names: the console's
operators, the operators that manage add-ons, and Preferences' add-on and extension panels, which list add-ons through
addon_utils.

A UI type the tree registered (VIEW3D_MT_add) is drawn by the tree; functions an add-on adds to it here
(VIEW3D_MT_add.append(fn)) are drawn before or after it, into the same layout (draw_added, python.cc python_draw_added)."""
import io
import json
import os
import sys
import traceback

import bpy
from _bpy_types import _GenericUI
from bl_operators import console, userpref
from bl_ui import space_userpref


def add_on_ui(cls):
    name = cls.__name__.lower()
    return name.startswith("userpref_") and ("addon" in name or "extension" in name)


classes = (*console.classes, *userpref.classes, *filter(add_on_ui, space_userpref.classes))


def register():
    for cls in classes:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


def tree_draw(self, context):
    """The draw of a UI type the transpiled tree registered, which the tree runs itself."""


def _dyn_ui_initialize(cls, initialize=_GenericUI._dyn_ui_initialize.__func__):
    if getattr(cls, "draw", None) is None:
        cls.draw = tree_draw
    return initialize(cls)


# port-override: a UI type of the tree has no draw in CPython; its own runs in the tree.
_GenericUI._dyn_ui_initialize = classmethod(_dyn_ui_initialize)


def draw_added(self, before):
    funcs = getattr(type(self).draw, "_draw_funcs", ())
    if tree_draw not in funcs:
        return
    at = funcs.index(tree_draw)
    for func in funcs[:at] if before else funcs[at + 1:]:
        try:
            func(self, bpy.context)
        except Exception:
            traceback.print_exc()


def _blender_ext_json_0(args, use_idle, *, python_args):
    """bl_pkg's command line tool (cli/blender_ext.py) run in this interpreter, as WebAssembly starts no process; its
    messages are yielded once it finishes, as the subprocess's would be."""
    import bl_pkg
    from importlib.util import module_from_spec, spec_from_file_location
    spec = spec_from_file_location("_bl_pkg_blender_ext", os.path.join(os.path.dirname(bl_pkg.__file__), "cli", "blender_ext.py"))
    blender_ext = module_from_spec(spec)
    spec.loader.exec_module(blender_ext)
    out, sys.stdout = sys.stdout, io.StringIO()
    try:
        blender_ext.main([*args, "--output-type=JSON_0"], args_internal=True)
        output = sys.stdout.getvalue()
    finally:
        sys.stdout = out
    yield [tuple(json.loads(message)) for message in output.split("\0") if message.strip()]


def extensions_loaded():
    """After the Preferences' add-ons and extensions are enabled (python.cc python_start)."""
    utils = sys.modules.get("bl_pkg.bl_extension_utils")
    if utils:
        # port-override: bl_pkg runs blender_ext.py in a subprocess (command_output_from_json_0).
        utils.command_output_from_json_0 = _blender_ext_json_0
