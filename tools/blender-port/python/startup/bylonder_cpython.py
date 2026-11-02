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


def add_on_ui(cls):
    name = cls.__name__.lower()
    return name.startswith("userpref_") and ("addon" in name or "extension" in name)


classes = ()


def register():
    """The classes register in the first step after Python's start (start_step), which keeps that start short."""


def _import_packages(names):
    """Blender's packages imported a module per step: the packages are made, the modules each __init__ lists
    (`_modules`) are imported into them one at a time, then each __init__ runs, finding them imported, as `import bl_ui`
    would. The packages are all made first, as their modules import from each other."""
    import ast
    import importlib
    import importlib.util
    packages = []
    for name in names:
        spec = importlib.util.find_spec(name)
        sys.modules[name] = importlib.util.module_from_spec(spec)
        tree = ast.parse(spec.loader.get_source(name))
        listed = next(node.value for node in tree.body if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "_modules" for t in node.targets))
        packages.append((name, spec, ast.literal_eval(listed)))
    for name, _spec, modules in packages:
        for module in modules:
            importlib.import_module(f"{name}.{module}")
            yield
    for name, spec, _modules in packages:
        spec.loader.exec_module(sys.modules[name])
        yield


def _register_classes():
    global classes
    from bl_operators import console, userpref
    from bl_ui import space_userpref
    classes = (*console.classes, *userpref.classes, *filter(add_on_ui, space_userpref.classes))
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


def _load_scripts_extensions():
    """This script's classes, then blender-port: bpy.utils.load_scripts_extensions and addon_utils._initialize_once
    (scripts/modules), one add-on per step, so that the page runs between them (python.cc python_start_step). Blender enables its core add-ons from a set,
    whose order changes with each launch's hash seed; they are enabled sorted, so their menu entries keep one order."""
    import addon_utils
    yield from _import_packages(("bl_ui", "bl_operators"))
    _register_classes()
    yield
    if any(bpy.utils.app_template_paths()):
        import bl_app_template_utils
        bl_app_template_utils.reset(reload_scripts=False)
        yield
    for path in addon_utils.paths():
        bpy.utils._sys_path_ensure_append(path)
    addon_utils._stale_pending_check_and_remove_once()
    addon_utils._initialize_extensions_repos_once()
    yield
    for module_name in sorted(addon_utils._addons_hidden_core):
        addon_utils.enable(module_name, refresh_handled=True, default_set=False, persistent=True)
        yield
    for module_name in [addon.module for addon in bpy.context.preferences.addons]:
        if module_name not in addon_utils._addons_hidden_core:
            addon_utils.enable(module_name, refresh_handled=True)
            yield
    del addon_utils._initialize_once
    extensions_loaded()


_steps = None


def start_step():
    """The next step of loading the add-ons and extensions the Preferences enable: whether more follow."""
    global _steps
    _steps = _steps or _load_scripts_extensions()
    try:
        done = next(_steps, StopIteration) is StopIteration
    except BaseException:
        # As Blender prints what fails while its scripts load.
        traceback.print_exc()
        raise
    if done:
        _steps = None
        return False
    return True


def extensions_loaded():
    """After the Preferences' add-ons and extensions are enabled (python.cc python_start)."""
    utils = sys.modules.get("bl_pkg.bl_extension_utils")
    if utils:
        # port-override: bl_pkg runs blender_ext.py in a subprocess (command_output_from_json_0).
        utils.command_output_from_json_0 = _blender_ext_json_0
